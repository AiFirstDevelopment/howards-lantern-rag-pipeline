import { isCodeChunk } from './code-chunks'
import { chooseLaws, poolSize, type Rerank } from './law-rerank'
import type { Search } from './law-retrieval'
import type { Rephrase } from './law-rephrase'
import { penaltyLaw, sectionOf, type LawsById, type LawsBySection, type NearLawsNationwide, type PenaltiesFor, type ProcessRowsFor } from './law-nationwide'
import type { ProcessFamily } from './process-families'
import { chooseTopics, type ChooseTopics, type NationwideTopic, type StateLaw } from './law-topics'
import { STATE_NAMES } from './states'
import Anthropic from '@anthropic-ai/sdk'
import { RETRIEVED_LAWS, citedPages, pagesNamedIn, retrieve, words, type AskLaw } from './law-retrieval'
// The attribute is for Node: the e2e suite runs `answerLearner` in-process
// (tests/e2e/learner-ask-law.spec.ts), and Node refuses a JSON import without it.
import learnerBank from './learner-knowledge-base.json' with { type: 'json' }

/**
 * The learner's ask box: a model that writes, from a book, under checks
 * (docs/plans/learner-ask.md).
 *
 * The partner box routes -- the model picks a written answer and nothing it
 * writes is ever shown -- because a paraphrase about somebody's money, slightly
 * wrong, in writing, on our site, is worse than no answer. This box is for a
 * learner asking how the app works, and a router has nothing to say to any
 * question the FAQ did not anticipate. So here the model writes, and the thing
 * that keeps it honest is `checkAnswer`: an answer is shown only if it stays in
 * scope, cites sections of the book, contains no number those sections do not,
 * names no price and runs no longer than three sentences should. Everything
 * else lands on the honest line and the support address, exactly as every
 * failure of the partner box does.
 */

export type Lang = 'en' | 'es'

/**
 * The current default model. The partner router stays on `ASK_MODEL` in ask.ts;
 * the two are measured separately (scripts/learner-ask-eval.ts) and move
 * separately.
 */
export const LEARNER_ASK_MODEL = 'claude-opus-5-5'

/**
 * The longest answer that is shown. Three sentences of the register the book
 * is written in run to about four hundred characters; past six hundred the
 * model has stopped answering the question and started answering the book.
 */
export const MAX_ANSWER_CHARS = 600

/** Questions a day from everybody who has not paid for anything: see PUBLIC_DAILY_QUESTIONS. */
export const LEARNER_DAILY_QUESTIONS = 300

export const SCOPES = ['app', 'road-law', 'price', 'promise', 'other'] as const
export type Scope = (typeof SCOPES)[number]

export interface BookSection {
  id: string
  title: string
  page: string | null
  sources: string
  text: string
}

export interface FaqSource {
  id: string
  lang: Lang
  question: string
  answer: string
}

export interface LearnerBank {
  book: BookSection[]
  faq: FaqSource[]
}

/** Built by scripts/build-learner-kb.ts; tests/unit/learner-knowledge-base.test.ts holds it to the book. */
export const LEARNER_BANK = learnerBank as LearnerBank

/** One thing the model may draw on: a section of the book, or a FAQ entry in the learner's language. */
export interface Source {
  id: string
  title: string
  page: string | null
  text: string
  /** The language the text is written in, which decides which number words count in it. */
  lang: Lang
}

/**
 * What a learner in `lang` may be answered from: the whole book, which is
 * English, and the FAQ in their language only. The Spanish FAQ gives the model
 * the register; the English FAQ would give it a second copy of the same facts
 * in the wrong language.
 */
export function sectionsFor(lang: Lang): Source[] {
  return [
    ...LEARNER_BANK.book.map(({ id, title, page, text }) => ({ id, title, page, text, lang: 'en' as const })),
    ...LEARNER_BANK.faq
      .filter((entry) => entry.lang === lang)
      .map((entry) => ({
        id: entry.id,
        title: entry.question,
        page: '#faq',
        text: `${entry.question}\n${entry.answer}`,
        lang: entry.lang,
      })),
  ]
}

export function sourceFor(lang: Lang, id: string): Source | null {
  return sectionsFor(lang).find((source) => source.id === id) ?? null
}

/**
 * The rules. Each is held by name in tests/unit/learner-prompt.test.ts, so a
 * rewrite that lost one fails before the eval has to find it. `roadLaw` is the
 * sixth, added when road law stopped being refused outright
 * (docs/plans/learner-ask-law.md). Its short sentences, two figures at most
 * and the cost last are Joel's high-beam answer (2026-10-11): two sentences,
 * inside the count, whose first ran 36 words with both distances joined by
 * "and Maryland law also says" -- "way too detailed and verbose. This is for
 * teenagers." The example is that answer as it should have read. The cost
 * is given only when asked for: with the example alone, all six measured
 * answers to "how far from a fire hydrant can i park" gained "Otherwise it's
 * a $60 ticket, no points, no court", which nobody asked. And short
 * sentences are never more of them: the whole eval on the first wording
 * split 11 answers past their two-sentence limit, against 4 before, the
 * cost-last sentence the third; the way out, where a law states one, still
 * comes after the cost.
 */
export const RULES = {
  scoped:
    'Answer the question that was asked and nothing else. If it is a yes-or-no question, the first word of your answer is "Yes" or "No" (in Spanish, "Sí" or "No"). At most three sentences. Add nothing the learner did not ask about, however relevant; they can ask.',
  sourced:
    'Every statement comes from the sections given below, or, for road law, from the laws given with the question. Nothing from memory about this app, any other app, or the law. Name the ids of the sections or laws you used in "sources". If the sections do not answer the question, say so in one sentence and name the page or address that does; do not guess.',
  numbers:
    'Never write a number the sections do not contain (for road law, the laws given), and never what this app costs, a date or a time. The price is shown at checkout.',
  scope:
    'Scope. A rule of the road, a sign, a speed limit, a fine, an age, a document, or a requirement of a particular state is "road-law". What the app costs is "price". Whether the learner will pass, whether a refund will be approved, or whether somebody will write back is "promise". Anything not about this app is "other". For "price", "promise" and "other", leave "answer" empty: the app writes those lines itself. One exception: a question about what follows a ticket or a stop that no road law decides — "will my parents find out", "will my insurance go up", "can the cop search my car" — is "other", and its answer is one sentence that names who decides, with no law, no figure and no sources: your insurer decides what you pay; the court sends its notices to the address on your license; whether a search is allowed is a question for a lawyer.',
  roadLaw:
    'Road law is answered only from the laws of the learner’s own state given with the question, never from memory or another state. Write for a sixteen-year-old who asked a friend who knows: plain words, "you", each figure once, and no law’s name or number in the sentences (the app shows them underneath). Short sentences, and never more of them than the sentence limits here allow: each under about 20 words, with at most two figures in a sentence; cut words rather than add a sentence, and leave out what was not asked rather than go over the limit. The cost (the fine, points, whether you go to court) goes in a sentence of its own after the rule, followed only by the way out where a law given states one. Give the cost only when the question asks what happens, what it costs or how you can get in trouble: a question about the rule itself (how far, how fast, when) is answered with the rule alone. Never join two rules with “and Maryland law also says” or the like: give each rule a short clause of its own. For example, a Maryland learner who asks how they can get in trouble using their high beams is answered: “Dim your high beams within 500 feet of an oncoming car, or 300 feet behind one. Otherwise it’s a $60 ticket, no points, no court.” Answer in the shape of the question with the law’s own figure, in at most two sentences, and put the ids of the laws you used (for example "FL-399") in "sources". When the question asks what happens, what if, will I, do I have to, or how much (in Spanish, qué pasa, y si, me van a, tengo que, cuánto), answer in at most three sentences in the order things happen: what the officer or the court does, then what it costs (the fine, points, whether you must go to court), then the way out, only if a law given states one. For example, a Texas learner who asks what happens if they are pulled over without their license is answered: “You can get a ticket with a fine of up to $200. If you bring your valid license to court, the charge is dropped.” A section’s other subsections are given with the one that matched, so a penalty or a defence in the same section is visible: use them. The learner’s words will not be the law’s: a law that sets a maximum speed answers a question about the highest posted limit, a law on an instruction permit answers one about a learner’s permit. When a law given states the rule the learner is asking about, answer from it with its figure and say what the law calls the thing, rather than nothing. When a law given states the duty the learner asks about and none states its penalty, answer the duty in one sentence and stop: never write that the laws given do not state something. If no law given touches the question, or no laws are given, leave "answer" empty and "sources" empty: the app says so itself. Some laws are marked as the state’s law rather than its manual: prefer the manual where it states the rule, use the state’s law for what the manual does not state or when the learner asks for the law as written, and when you answer from it say so in words, as “Maryland law” for a Maryland learner. Write figures in digits. The app shows the manual’s page or the law’s section under your answer, so do not write page or section numbers.',
  language:
    'Answer in the language the learner wrote in. The book is English; the answer is not a translation of it but an answer. Point to pages by the names the book uses: Terms of use, Privacy, Request a refund, Become a partner, About us, the FAQ.',
} as const

/**
 * The seventh rule, for a nationwide question only (docs/plans/nationwide.md,
 * decision 8). Not in `RULES`, so a state question's prompt is the prompt it
 * was, byte for byte: the state path's eval cases were measured against that
 * prompt, and a rule that applies only when every state's laws are given would
 * be one more thing for each of them to misread. It says it replaces
 * `roadLaw`'s own-state limit and two sentences, because without that the
 * model is told both at once.
 */
export const NATIONWIDE_RULE =
  'Nationwide. When the laws given are labelled by state, the learner asked across all the states, and this replaces the rule above about the learner’s own state and two sentences. The laws given are, for each state, what its manual or code says on the question, and the states with nothing are named. A state’s law may not answer: use only the laws that do. Compare across them: name the state or states the question asks for, each with its own figure, and say in a phrase how the rest stand — “most states”, or one of the counts given with the laws. Never count states yourself: “40 states set 0.08” is a number no law states, and the app refuses it. Mention no state whose law is not given. At most five sentences, written for a sixteen-year-old: plain words, "you", and no law’s name or number in the sentences. Short sentences, never more of them than five: each under about 20 words, with at most two figures in a sentence, cutting words rather than adding a sentence; a cost (a fine, points, whether you go to court) only when the question asks about one, in a sentence of its own; never join two rules with “and Utah law also says” or the like. Figures in digits, and every law you drew on in "sources" — at least one law for every figure you write, the one “most states” share included, or the app refuses the figure as one nobody cited. When the laws given come in several blocks, one for each question on one subject, compare on each and say which state is strictest overall, naming the rule that decides it.'

/**
 * The road-law rule for a learner who wrote in Spanish: the register, the
 * consequence shape and the empty-answer rule said in Spanish, as a text of
 * its own rather than the English with Spanish trigger words quoted inside it
 * (#799). Under the English rule the Spanish no-license question came back
 * empty four times in six, the Spanish insurance answer cited the one page row
 * without the line its "dos o más personas" came from and was refused as
 * ungrounded, and the Texas answer cited the manual where the section held the
 * way out. Same rules, same order, same limits as `RULES.roadLaw`, and two
 * sentences the English does not have, each for a Spanish miss: every law a
 * figure came from goes in "sources", a figure in words included, because
 * Spanish "dos" is a figure the checker grounds and the insurance answer
 * cited the row without it; and "no llevo mi licencia" is the duty to have
 * it in possession, not driving without one, because the laws are in English
 * and the learner's words are not. tests/unit/learner-prompt.test.ts holds
 * the shared rules' phrases in both.
 */
export const ROAD_LAW_ES =
  'Las leyes de tránsito se responden solo con las leyes del estado del estudiante que se dan con la pregunta, nunca de memoria ni con las de otro estado. Escribe para un chico de dieciséis años que le preguntó a un amigo que sabe: palabras sencillas, de «tú», cada cifra una sola vez, y ningún nombre ni número de ley en las oraciones (la app los muestra debajo). Oraciones cortas, y nunca más oraciones de las que permiten los límites de aquí: cada una de menos de unas 20 palabras, con dos cifras como máximo en una oración; quita palabras en vez de añadir una oración, y deja fuera lo que no se preguntó antes que pasarte del límite. Lo que cuesta (la multa, los puntos, si tienes que ir al tribunal) va en su propia oración después de la regla, seguida solo de la salida si una ley dada la establece. Da lo que cuesta solo cuando la pregunta es qué pasa, cuánto cuesta o cómo te puedes meter en problemas: una pregunta sobre la regla misma (a qué distancia, a qué velocidad, cuándo) se responde solo con la regla. Nunca unas dos reglas con «y la ley de Maryland también dice» ni nada parecido: dale a cada regla una frase corta propia. Por ejemplo, a un estudiante de Maryland que pregunta cómo se puede meter en problemas con las luces altas se le responde: «Baja las luces altas a 500 pies de un carro que viene de frente, o a 300 pies detrás de uno. Si no, es una multa de $60, sin puntos y sin ir al tribunal.» Responde con la forma de la pregunta y la cifra de la propia ley, en dos oraciones como máximo, y pon en "sources" los ids de las leyes que usaste (por ejemplo "FL-399"): cada ley de la que tomaste una cifra, también una cifra escrita con palabras, como «dos o más personas». Cuando la pregunta es qué pasa, y si, me van a, tengo que o cuánto, responde en tres oraciones como máximo, en el orden en que pasan las cosas: lo que hace el policía o el tribunal, luego lo que cuesta (la multa, los puntos, si tienes que ir al tribunal), y luego la salida, solo si una ley dada la establece. Por ejemplo, a un estudiante de Texas que pregunta qué pasa si lo para la policía y no lleva su licencia se le responde: «Te pueden poner una multa de hasta $200. Si llevas tu licencia válida al tribunal, se retira el cargo.» Con la subsección que coincidió se dan las demás subsecciones de su sección, para que se vea una multa o una defensa de la misma sección: úsalas. Las leyes están en inglés y las palabras del estudiante no serán las de la ley: no llevar la licencia encima es no tenerla «in possession» y no mostrarla «on demand», no manejar sin licencia; una ley que fija la velocidad máxima responde a una pregunta sobre el límite más alto, y una ley sobre el «instruction permit» responde a una sobre el permiso de aprendiz. Cuando una ley dada establece la regla por la que pregunta el estudiante, responde con ella y su cifra y di cómo llama la ley a la cosa, en vez de no decir nada. Cuando una ley dada establece el deber por el que pregunta y ninguna establece su castigo, responde el deber en una oración y para: nunca escribas que las leyes dadas no dicen algo. Si ninguna ley dada toca la pregunta, o no se da ninguna ley, deja "answer" vacío y "sources" vacío: la app lo dice por su cuenta. Algunas leyes están marcadas como la ley del estado y no su manual: prefiere el manual donde establece la regla, usa la ley del estado para lo que el manual no dice o cuando el estudiante pide la ley tal como está escrita, y cuando respondas con ella dilo con palabras, como «la ley de Maryland» para un estudiante de Maryland. Escribe las cifras con dígitos. La app muestra la página del manual o la sección de la ley debajo de tu respuesta, así que no escribas números de página ni de sección.'

/** `NATIONWIDE_RULE` for a learner who wrote in Spanish, for the reason `ROAD_LAW_ES` gives. */
export const NATIONWIDE_RULE_ES =
  'Todo el país. Cuando las leyes dadas llevan el nombre de su estado, el estudiante preguntó por todos los estados, y esto reemplaza la regla de arriba sobre el estado del propio estudiante y las dos oraciones. Las leyes dadas son, para cada estado, lo que su manual o su código dice sobre la pregunta, y se nombran los estados que no tienen nada. Puede que la ley de un estado no responda: usa solo las que sí. Compara entre ellas: nombra el estado o los estados por los que pregunta, cada uno con su cifra, y di en una frase cómo están los demás: «la mayoría de los estados», o uno de los conteos que se dan con las leyes. Nunca cuentes estados por tu cuenta: «40 estados fijan 0.08» es un número que ninguna ley dice, y la app lo rechaza. No menciones ningún estado cuya ley no se da. Cinco oraciones como máximo, escritas para un chico de dieciséis años: palabras sencillas, de «tú», y ningún nombre ni número de ley en las oraciones. Oraciones cortas, nunca más de cinco: cada una de menos de unas 20 palabras, con dos cifras como máximo en una oración, quitando palabras en vez de añadir una oración; lo que cuesta (una multa, los puntos, si tienes que ir al tribunal) solo cuando la pregunta lo pide, en su propia oración; nunca unas dos reglas con «y la ley de Utah también dice» ni nada parecido. Las cifras con dígitos, y en "sources" cada ley que usaste: al menos una ley por cada cifra que escribas, también la que comparte «la mayoría de los estados», o la app rechaza la cifra como una que nadie citó. Cuando las leyes dadas vienen en varios bloques, uno por cada pregunta sobre un mismo tema, compara en cada uno y di qué estado es el más estricto en general, nombrando la regla que lo decide.'

/** The rules a learner in `lang` is answered under: `RULES`, with the road-law rule in the learner's language. */
export function rulesFor(lang: Lang): Record<keyof typeof RULES, string> {
  return lang === 'es' ? { ...RULES, roadLaw: ROAD_LAW_ES } : RULES
}

/** The nationwide rule in the learner's language. */
export function nationwideRuleFor(lang: Lang): string {
  return lang === 'es' ? NATIONWIDE_RULE_ES : NATIONWIDE_RULE
}

/** The system prompt in two blocks: the rules, then the sources, which are the cached prefix. */
export function learnerPrompt(lang: Lang, nationwide = false): { rules: string; sources: string } {
  const rules = [
    'You answer a learner’s question about how this permit-practice app works, from a book about the app and nothing else.',
    '',
    ...[...Object.values(rulesFor(lang)), ...(nationwide ? [nationwideRuleFor(lang)] : [])].map((rule, index) => `${index + 1}. ${rule}`),
    '',
    'Reply as JSON: { "scope": one of "app", "road-law", "price", "promise", "other"; "answer": the answer, or empty; "sources": the ids of the sections the answer rests on }.',
  ].join('\n')
  const sources = sectionsFor(lang)
    .map((source) => `## ${source.id}: ${source.title}\n\n${source.text}`)
    .join('\n\n')
  return { rules, sources: `The sections:\n\n${sources}` }
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: [...SCOPES] },
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['scope', 'answer', 'sources'],
  additionalProperties: false,
} as const

/** One earlier turn, as it was logged: the question, and what the learner was shown. */
export interface LearnerTurn {
  question: string
  scope: Scope | null
  /** What was shown, or the empty string where nothing the model wrote was. */
  answer: string
  sources: string[]
}

export interface LearnerAskRequest {
  lang: Lang
  question: string
  history: LearnerTurn[]
  /**
   * The laws retrieved from the chosen state's manual for this question, or
   * null when no state is chosen. The only road law the model is shown.
   */
  laws: AskLaw[] | null
  /**
   * A nationwide question's laws, topic by topic: each state's verdict law and
   * the states with none. `laws` is then the same laws in one list, which is
   * what the answer may cite. Absent on every state question.
   */
  nationwide?: NationwideLaws
}

/**
 * What a nationwide question is answered from: one block per topic chosen, or
 * one block of each state's nearest laws when no topic matched and the index
 * was searched (`nearest`); none when neither could be read.
 */
export interface NationwideLaws {
  topics: { question: string; laws: StateLaw[]; absent: string[]; nearest?: true }[]
}

export type LearnerReply =
  | { kind: 'reply'; scope: Scope; answer: string; sources: string[]; model: string }
  /**
   * Why nothing came back: no key, the call failed, a reply that would not
   * parse, or the model's own safeguards declined. Written to the row so a run
   * of outages reads differently from a run of refusals.
   */
  | { kind: 'failed'; model: 'unavailable' | 'unreachable' | 'unparsed' | 'refused' }

export type LearnerAsker = (request: LearnerAskRequest) => Promise<LearnerReply>

/**
 * The asker the deployed worker uses. An unset key answers `failed`, which the
 * handler turns into the support address and an HTTP 200 -- the stance ask.ts
 * takes, for the reason it gives there.
 *
 * `client` is for tests/unit/learner-prompt.test.ts: every e2e test stubs the
 * asker whole, so without it nothing would see a nationwide question reach
 * Opus with every state's laws headed as the learner's own state's manual and
 * no nationwide rule.
 */
/**
 * The request the deployed asker sends, as the SDK takes it. Its own function
 * because the eval sends the very same request through a Message Batch
 * (scripts/eval-batch.ts) at half the price, and a batch built from a copy of
 * this would drift from what the worker sends.
 */
export function learnerRequestFor({ lang, question, history, laws, nationwide }: LearnerAskRequest): Anthropic.MessageCreateParamsNonStreaming {
  const prompt = learnerPrompt(lang, nationwide !== undefined)
  return {
    model: LEARNER_ASK_MODEL,
    max_tokens: 1024,
    system: [
      { type: 'text', text: prompt.rules },
      // The book is the stable prefix and the conversation goes after it,
      // so a follow-up reads the cache rather than rebuilding it.
      { type: 'text', text: prompt.sources, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      // Three sentences from a book is not a reasoning task.
      effort: 'low',
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    messages: [
      // Replayed as they were logged: the assistant's turn is what the
      // learner was shown, not what the model first wrote, so a refused
      // turn is a refused turn in the thread too.
      ...history.flatMap((turn): Anthropic.MessageParam[] => [
        { role: 'user', content: turn.question },
        {
          role: 'assistant',
          content: JSON.stringify({ scope: turn.scope ?? 'other', answer: turn.answer, sources: turn.sources }),
        },
      ]),
      { role: 'user', content: withLaws(question, laws, nationwide) },
    ],
  }
}

/**
 * What the model's message is read as: a reply in the fixed shape, or why
 * not. Throws on text that is not JSON, which the caller records as
 * `unreachable`, as it always has.
 */
export function learnerReplyFrom(response: Anthropic.Message): LearnerReply {
  if (response.stop_reason === 'refusal') return { kind: 'failed', model: 'refused' }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const parsed = JSON.parse(text) as { scope?: unknown; answer?: unknown; sources?: unknown }
  if (
    typeof parsed.scope !== 'string' ||
    !(SCOPES as readonly string[]).includes(parsed.scope) ||
    typeof parsed.answer !== 'string' ||
    !Array.isArray(parsed.sources)
  ) {
    return { kind: 'failed', model: 'unparsed' }
  }
  return {
    kind: 'reply',
    scope: parsed.scope as Scope,
    answer: parsed.answer,
    sources: parsed.sources.filter((id): id is string => typeof id === 'string'),
    model: LEARNER_ASK_MODEL,
  }
}

export function learnerAskerFor(apiKey: string | undefined, client?: Pick<Anthropic, 'messages'>): LearnerAsker {
  if (client === undefined && (apiKey === undefined || apiKey.length === 0)) {
    return async () => {
      console.error('no ANTHROPIC_API_KEY: every learner question answers with the support address')
      return { kind: 'failed', model: 'unavailable' }
    }
  }
  client ??= new Anthropic({ apiKey })
  return async (request) => {
    try {
      return learnerReplyFrom(await client.messages.create(learnerRequestFor(request)))
    } catch (error) {
      console.error('learner ask: could not reach the model', error)
      return { kind: 'failed', model: 'unreachable' }
    }
  }
}

/**
 * Small numbers as words, so "three full tests in a row" in a cited section
 * grounds a "3" in the answer. A copy of src/numbers.ts, because the worker and
 * the app are two builds; tests/unit/learner-knowledge-base.test.ts holds the
 * copy to the original.
 */
export const NUMBER_WORDS: Record<Lang, readonly string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'],
}

/**
 * Every number a text states, as digit strings: its digit runs and its spelled
 * small numbers **in the language the text is written in**. One language, not
 * both: the Spanish word for eleven is "once", and an English section that says
 * "Once you have paid" must not ground an "11" in an answer.
 */
export function numbersIn(text: string, lang: Lang): Set<string> {
  const found = new Set<string>(text.match(/\d+/g) ?? [])
  const lower = text.toLowerCase()
  NUMBER_WORDS[lang].forEach((word, value) => {
    if (new RegExp(`\\b${word}\\b`, 'u').test(lower)) found.add(String(value))
  })
  return found
}

/** A price in any form the model might write one, a spelled "nine dollars" included. */
const CURRENCY = /[$€£]|\bUSD\b|\b(dollars?|bucks|dólares?|euros?)\b/i

export type Checked =
  | { ok: true; answer: string; sources: Source[] }
  /** Why the model's text is not shown; written to the row's `model` column. */
  | { ok: false; reason: string }

/**
 * Whether what the model wrote may be shown, decided here and nowhere else.
 *
 * In order, because the first reason is the one worth reading in the log:
 * out of scope; citing nothing, or something this learner was never offered;
 * a price; a number the cited sections do not contain; too long. Each refusal
 * names itself, so a day of `ungrounded` rows reads as a prompt problem and a
 * day of `scope:road-law` rows reads as learners asking the wrong box.
 */
export function checkAnswer(reply: LearnerReply, lang: Lang): Checked {
  if (reply.kind === 'failed') return { ok: false, reason: reply.model }
  if (reply.scope !== 'app') return { ok: false, reason: `scope:${reply.scope}` }
  const answer = reply.answer.trim()
  if (answer.length === 0) return { ok: false, reason: 'empty' }
  // Each id once: the model repeating itself must not become two identical
  // "Read more" links.
  const sources = [...new Set(reply.sources)].map((id) => sourceFor(lang, id))
  if (sources.length === 0 || sources.some((source) => source === null)) {
    return { ok: false, reason: 'unsourced' }
  }
  const cited = sources as Source[]
  // The price before the digits: "$9.99" fails both, and the log should say
  // which one somebody has to read about.
  if (CURRENCY.test(answer)) return { ok: false, reason: 'priced' }
  const grounded = new Set<string>()
  for (const source of cited) {
    for (const number of numbersIn(`${source.title}\n${source.text}`, source.lang)) grounded.add(number)
  }
  // The answer's numbers, spelled or in digits: "seven devices" is as invented
  // as "7 devices".
  for (const number of numbersIn(answer, lang)) {
    if (!grounded.has(number)) return { ok: false, reason: 'ungrounded' }
  }
  if (answer.length > MAX_ANSWER_CHARS) return { ok: false, reason: 'overlong' }
  return { ok: true, answer, sources: cited }
}

/**
 * The line the worker writes for a scope the model declined, in the learner's
 * language. The model's text is never shown for these; what the learner reads
 * is ours, and it says where the answer actually is.
 */
export function pointerFor(
  scope: Exclude<Scope, 'app' | 'road-law'>,
  lang: Lang,
  contact: string,
): { pointer: string; pointerHref: string | null } {
  const lines: Record<Lang, Record<Exclude<Scope, 'app' | 'road-law'>, string>> = {
    en: {
      price: 'The price is shown before checkout, and it depends on whether a school sent you — so I don’t quote it here.',
      promise: `That is not something I can promise. Write to ${contact} and a person reads it.`,
      other: 'That is outside what I can answer here: I know how this app works, and not much else.',
    },
    es: {
      price: 'El precio se muestra antes de pagar y depende de si una escuela lo envió, así que no lo cito aquí.',
      promise: `Eso no es algo que yo pueda prometer. Escriba a ${contact} y una persona lo lee.`,
      other: 'Eso está fuera de lo que puedo responder aquí: sé cómo funciona esta aplicación, y poco más.',
    },
  }
  // The address is not a link here: the contact line under every refusal
  // already carries it, and twice is clutter.
  return { pointer: lines[lang][scope], pointerHref: null }
}

/**
 * The question as the model receives it: the learner's words, then the laws
 * retrieved for them. In the user turn rather than the system prompt, so the
 * book stays the cached prefix and an app question costs what it did.
 */
/**
 * A code chunk's section heading, where the state publishes one. A subsection
 * cut from its section often names nothing: Alaska's "(c) A person convicted
 * under this section … shall pay a mandatory fine of $500" is the fine for not
 * showing proof of insurance only because the section is headed "Proof of
 * insurance to be exhibited on demand; penalty". Without the heading the model
 * was right to refuse it. Not a figure the checker grounds on: it grounds on
 * the law and its quote alone.
 */
function heading(law: AskLaw): string {
  return isCodeChunk(law.id) && law.concept !== '' ? `, section: ${law.concept}` : ''
}

/**
 * A citation as the model is shown it: the reference alone -- the manual's
 * page, the code's section -- without the quote after it. The quote is the
 * law's own words again (verbatim, for a code chunk) and it was half of every
 * law block the model read: measured 2026-10-10, 49% of the characters for the
 * drunk-driving topics' 97 laws, 48% for Texas's code chunks, 51% for its
 * manual laws. The checker grounds figures on the law and the quote both,
 * server-side, from the citation itself and not from what the model saw, so
 * nothing the learner is shown changes; the model is told not to write page
 * or section numbers in any case.
 */
export function referenceOf(citation: string): string {
  const quoted = citation.indexOf(' — ')
  return quoted < 0 ? citation : citation.slice(0, quoted)
}

/**
 * What a row of the court's fine schedule is, said in the question's turn and
 * only when one is given (docs/plans/what-happens-if.md, decision 12). Not in
 * `RULES`: the system prompt is the cached prefix, the chips' answers carry
 * its hash (tests/unit/chips.test.ts), and every question without a schedule
 * row -- every nationwide one, every state without a schedule -- is asked
 * exactly as phase 1 measured it.
 */
export const PENALTY_LINE =
  'A law marked as the court’s fine schedule is what a driver actually pays for breaking the state’s law listed just above it: its figure, whether it can be paid without going to court, and its points where it gives them. Use it for what it costs. Where it says the court sets the fine, give its range and say the court decides; never give one figure from the range as the fine.'

/**
 * What a row of the state's own page is, said in the question's turn and only
 * when one is given (docs/plans/what-happens-if.md, phase 3, decision 15), for
 * the reason `PENALTY_LINE` gives. The page is the licensing agency's or the
 * court's word on how its own process runs -- how soon a test can be taken
 * again, how many days a ticket allows -- and no section states that. It is
 * not the rule of the road: a DMV's FAQ that says "park at least 15 feet from
 * a hydrant" is a paraphrase, and the manual or the code beside it is the rule.
 */
export const PROCESS_LINE =
  'A law marked as the state’s own page is what the state’s licensing agency or court says about how its process works. Prefer it for process — how soon you can take a test again, how long you hold a permit, what insurance you must carry, what to do with a ticket and how many days you have. Never answer a rule of the road (where to park, how fast, who goes first) from it when the manual or the state’s law given states the rule: answer from those.'

/** A page row's reference, as the model is shown it: the agency and the page's title, without the passage again. */
function pageOf(citation: string | null): string {
  if (citation === null) return ''
  const quoted = citation.indexOf(" — '")
  return quoted < 0 ? citation : citation.slice(0, quoted)
}

export function withLaws(question: string, laws: AskLaw[] | null, nationwide?: NationwideLaws): string {
  if (nationwide !== undefined) return withStatesLaws(question, nationwide)
  if (laws === null) return `${question}\n\n(No state is chosen, so no laws are given.)`
  if (laws.length === 0) return `${question}\n\n(No law in the learner’s state’s manual was found for this question.)`
  const listed = laws.map((law) =>
    law.kind === 'statute'
      ? `[${law.id}] (the state's law, not the manual${heading(law)}) ${law.law} (${referenceOf(law.citation ?? '')})`
      : law.kind === 'penalty'
        ? `[${law.id}] (the court's fine schedule) ${law.law} (${referenceOf(law.citation ?? '')})`
        : law.kind === 'process'
          ? `[${law.id}] (the state's own page) ${law.law} (${pageOf(law.citation)})`
          : `[${law.id}] ${law.law}${law.citation === null ? '' : ` (manual: ${referenceOf(law.citation)})`}`,
  )
  const lines = [
    ...(laws.some((law) => law.kind === 'penalty') ? [PENALTY_LINE] : []),
    ...(laws.some((law) => law.kind === 'process') ? [PROCESS_LINE] : []),
  ]
  return `${question}\n\nLaws from the learner’s state’s manual retrieved for this question:\n${listed.join('\n')}${lines.map((line) => `\n\n${line}`).join('')}`
}

/** A state's name, for a label the learner reads; the code where a file names a state nobody knows. */
export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code
}

/**
 * A nationwide question as the model receives it: each topic's question, then
 * every state's law on it labelled with the state's name, then the states with
 * none named. The label is the state's name rather than its code because the
 * answer names states in words, and "UT" beside a law the model must call
 * "Utah" is one more translation to get wrong. The absent states are named so
 * a comparison can say how many have no rule rather than guessing that the
 * ones not shown agree.
 */
function withStatesLaws(question: string, nationwide: NationwideLaws): string {
  if (nationwide.topics.length === 0) {
    return `${question}\n\n(Asked across all the states, but it matches nothing the states’ laws have been compared on, so no laws are given.)`
  }
  const blocks = nationwide.topics.map((topic) => {
    // States, not laws: the index gives a state up to two, and "the laws of 98
    // states" would hand the model a count that is neither. One law a state on
    // a topic, so a topic's heading reads as it did.
    const states = new Set(topic.laws.map((law) => law.state)).size
    const listed = topic.laws.map((law) =>
      law.kind === 'statute'
        ? `[${law.id}] ${stateName(law.state)} (the state's law, not the manual${heading(law)}): ${law.law} (${referenceOf(law.citation ?? '')})`
        : `[${law.id}] ${stateName(law.state)}: ${law.law}${law.citation === null ? '' : ` (manual: ${referenceOf(law.citation)})`}`,
    )
    const absent = topic.absent.length === 0 ? '' : `\nStates with no rule found on this: ${topic.absent.map(stateName).join(', ')}.`
    // The index's nearest law is not a verdict: Opus told "the laws of 49
    // states" on the question would read 49 states as having the rule.
    const what = topic.nearest === true
      ? `what the manuals and codes of ${states} states say nearest to it, at most two laws a state, labelled by state (a state’s nearest law may not answer it)`
      : `the laws of ${states} states, labelled by state`
    return `On “${topic.question}”, ${what}${topic.absent.length === 0 ? '' : `, and ${topic.absent.length} states with none`}:\n${listed.join('\n')}${absent}`
  })
  return `${question}\n\nAsked across all the states.\n\n${blocks.join('\n\n')}`
}

/**
 * Spelled figures past twelve, which `NUMBER_WORDS` stops at. Road law is
 * mostly larger numbers -- feet, miles an hour, days -- and "twenty feet" under
 * a citation that says fifteen is the wrong figure on the right page. Each word
 * counts as its own value ("twenty-five" is 20 and 5), so a spelled compound
 * is grounded only where the law spells it too: it fails closed, and the prompt
 * asks for digits.
 */
const LARGER_WORDS: Record<Lang, Record<string, number>> = {
  en: {
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100, thousand: 1000,
  },
  es: {
    trece: 13, catorce: 14, quince: 15, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
    cien: 100, ciento: 100, mil: 1000,
  },
}

/**
 * Every figure a road-law text states: `numbersIn`, the spelled figures above
 * twelve, and Spanish "veinti-" compounds as twenty. "0.02" is read as ".02",
 * the way the manuals write a blood alcohol level, so the leading zero is not
 * an ungrounded figure of its own. The word "one" (or "uno") is not a figure;
 * the digit 1 is.
 */
export function figuresIn(text: string, lang: Lang): Set<string> {
  // "1,000" is one figure, not 1 and 000: New York's crash report law spells
  // "one thousand dollars", and the correct "$1,000" was refused as ungrounded.
  const normalised = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/\b0(\.\d)/g, '$1')
  const found = numbersIn(normalised, lang)
  for (const word of normalised.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const value = LARGER_WORDS[lang][word]
    if (value !== undefined) found.add(String(value))
    else if (lang === 'es' && word.startsWith('veinti')) found.add('20')
  }
  if (lang === 'en') for (const value of compounds(normalised)) found.add(String(value))
  if (lang === 'en') for (const fraction of percentFractions(normalised)) found.add(fraction)
  // "One" is a pronoun far more often than a figure in a road-law answer --
  // "within 15 feet of one", "a one-way street" -- and read as 1 it refused a
  // correct hydrant answer half the time (eval, 2026-10-05). A digit 1 is
  // still a figure and still has to be grounded.
  if (!/(^|[^\d.])1(?![\d])/.test(normalised)) found.delete('1')
  return found
}

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/**
 * Spelled compounds as the whole numbers they are: "five hundred" is 500,
 * "twenty-five" is 25, "one thousand five hundred" is 1500. Statutes spell
 * their figures where the manuals print digits, and the prompt asks the model
 * for digits, so Colorado's "closer than five hundred feet" behind a fire
 * truck read as 5 and 100 and refused the correct "500 feet" as ungrounded.
 * Added beside the word-by-word values, never instead of them, so nothing
 * grounded before stops being grounded: a figure still has to be one the law
 * states. English only, where the codes are.
 */
function compounds(text: string): number[] {
  const out: number[] = []
  let total = 0
  let chunk = 0
  let open = false
  const close = () => {
    if (open) out.push(total + chunk)
    total = 0
    chunk = 0
    open = false
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (UNITS[word] !== undefined) chunk += UNITS[word]
    else if (TENS[word] !== undefined) chunk += TENS[word]
    else if (word === 'hundred' && open) chunk = (chunk === 0 ? 1 : chunk) * 100
    else if (word === 'thousand' && open) (total += (chunk === 0 ? 1 : chunk) * 1000), (chunk = 0)
    else if (word === 'and' && open) continue
    else {
      close()
      continue
    }
    open = true
  }
  close()
  return out
}

/**
 * A blood-alcohol limit spelled the way Connecticut's code writes it --
 * "eight-hundredths of one per cent" -- as the digits an answer's "0.08" or
 * ".08" is read as: "08". Without it a correct "0.08" was ungroundable against
 * the very section that sets the limit.
 */
function percentFractions(text: string): string[] {
  const out: string[] = []
  for (const match of text.toLowerCase().matchAll(/\b([a-z]+(?:[- ][a-z]+)?)[- ]hundredths? of (?:one|1|a) per ?cent\b/g)) {
    const [value] = compounds(match[1])
    if (value === undefined || value >= 100) continue
    out.push(String(value).padStart(2, '0'))
  }
  return out
}

const ORDINALS: Record<string, number> = {
  fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60,
  seventieth: 70, eightieth: 80, ninetieth: 90,
}

/**
 * The figures a law states as ordinals -- "ninth birthday" is 9, "twenty-first
 * birthday" 21 -- for the law's side of the check only. Statutes spell ages
 * this way where manuals print digits, and a nationwide answer reads far more
 * statutes than a state's: Wyoming's code keeps a child "who has not reached
 * his ninth birthday" out of the front seat, and the correct "until they turn
 * 9" was refused as ungrounded in English and in Spanish (eval, 2026-10-09).
 * Never read from the answer: "the first offense" there is not a figure, and
 * counting it as 1 would refuse answers that were shown before. And not below
 * fifth, on either side: "first offense" and "second or subsequent offense"
 * are in nearly every penalty section, and grounding 1 and 2 on them would let
 * an invented "2 points" or "1 year" through (verifier, 2026-10-09).
 */
export function ordinalsIn(text: string): string[] {
  const pattern = new RegExp(`\\b(?:(${Object.keys(TENS).join('|')})[- ])?(${Object.keys(ORDINALS).join('|')})\\b`, 'g')
  return [...text.toLowerCase().matchAll(pattern)].map((match) => String((match[1] === undefined ? 0 : TENS[match[1]]) + ORDINALS[match[2]]))
}

/**
 * A law's spelled "one" before a unit -- "one year", "one point" -- as the 1
 * it is, for the law's side of the check only. `figuresIn` drops the word
 * "one" from every text, because in an answer it is a pronoun far more often
 * than a figure; on the law's side that left Texas's "confinement in jail for
 * a term not to exceed one year" unable to ground "up to 1 year in jail", and
 * the texting fine -- the answer the section was retrieved for -- was refused
 * as ungrounded four times in six (#799). Only before a unit: "one of the
 * following" and "at least one time" are in nearly every penalty section, and
 * grounding a 1 on them would ground a 1 under almost every cited section. A
 * "one <unit>" grounds the digit for any figure in the answer, as every
 * digit a law states already does: grounding is by figure, not by unit.
 */
export function spelledOnesIn(text: string): string[] {
  return /\bone[- ](?:years?|months?|weeks?|days?|hours?|points?|passengers?|miles?)\b/i.test(text) ? ['1'] : []
}

/** Why a road-law answer was not shown, written to the row; see `checkLawAnswer`. */
export type LawRefusal = 'no-state' | 'no-laws' | 'not-covered' | 'uncited' | 'ungrounded' | 'overlong' | 'no-topic'

export type LawChecked = { ok: true; answer: string; laws: AskLaw[] } | { ok: false; reason: LawRefusal }

/**
 * Whether a road-law answer may be shown, decided here and nowhere else
 * (docs/plans/learner-ask-law.md, decision 4).
 *
 * The model may only have written from `retrieved`, so that is the whole of
 * what it may cite: a law id outside it is a law nobody gave it, which means
 * memory, and a page the answer names that no cited law is on is a page it
 * made up. Every cited law must carry a manual citation, because the citation
 * is what the learner is shown under the answer and an answer without one is
 * the paraphrase this product refuses. The figures are grounded against the
 * cited laws' rule and the manual's own quoted words, both.
 */
export function checkLawAnswer(
  reply: Extract<LearnerReply, { kind: 'reply' }>,
  lang: Lang,
  laws: AskLaw[] | null | 'failed',
  retrieved: AskLaw[],
  /**
   * The learner's own words. A figure the learner gave may be said back --
   * "a 45 mph road is over the 35 mph limit" -- without the law stating it:
   * Illinois's scooter answer was refused two times in three for echoing the
   * question's 45. It grounds nothing the learner did not say.
   */
  question = '',
  /**
   * A nationwide answer's two extra figures and its longer limit
   * (docs/plans/nationwide.md, decision 9). "46 states set a limit" is a count
   * no law states, and refusing it would refuse the comparison itself; so the
   * number of laws given and the number of states without one are grounded,
   * and nothing else -- "39 states" is still a figure nobody gave. Five
   * sentences across the states run longer than two about one.
   */
  nationwide: { counts: number[]; maxChars: number } | null = null,
): LawChecked {
  if (laws === null) return { ok: false, reason: 'no-state' }
  if (laws === 'failed') return { ok: false, reason: 'no-laws' }
  const answer = reply.answer.trim()
  const ids = [...new Set(reply.sources)]
  if (answer.length === 0 || ids.length === 0) return { ok: false, reason: 'not-covered' }
  const cited = ids.map((id) => retrieved.find((law) => law.id === id) ?? null)
  if (cited.some((law) => law === null || law.citation === null)) return { ok: false, reason: 'uncited' }
  const sources = cited as AskLaw[]
  const pages = new Set(sources.flatMap((law) => citedPages(law.citation)))
  if (pagesNamedIn(answer).some((page) => !pages.has(page))) return { ok: false, reason: 'uncited' }
  // Grounded on the rule and the manual's quoted words, not on the page
  // reference in front of them: "p.66" must not ground "66 feet".
  const grounded = new Set<string>()
  for (const law of sources) {
    // The words after the reference: a page ("p.66 (printed) — '…'") or a
    // section ("Md. Code, Transp. § 21-1003(m) — '…'") grounds no figure.
    const citation = law.citation as string
    // A page row's citation is "<agency> — <title> — '<passage>'", and a
    // title can carry figures its passage does not state -- Washington's
    // "ages 16 to 17" would ground a "16" -- so it grounds on the passage alone.
    const from = law.kind === 'process' && citation.includes(" — '") ? citation.indexOf(" — '") : citation.indexOf(' — ')
    const quoted = from >= 0 ? citation.slice(from) : citation
    for (const number of figuresIn(`${law.law}\n${quoted}`, 'en')) grounded.add(number)
    for (const number of ordinalsIn(`${law.law}\n${quoted}`)) grounded.add(number)
    for (const number of spelledOnesIn(`${law.law}\n${quoted}`)) grounded.add(number)
  }
  for (const number of figuresIn(question, lang)) grounded.add(number)
  for (const count of nationwide?.counts ?? []) grounded.add(String(count))
  for (const number of figuresIn(answer, lang)) {
    if (!grounded.has(number)) return { ok: false, reason: 'ungrounded' }
  }
  if (answer.length > (nationwide?.maxChars ?? MAX_ANSWER_CHARS)) return { ok: false, reason: 'overlong' }
  return { ok: true, answer, laws: sources }
}

/**
 * The worker's own line when a road-law answer is not shown. The English lines
 * keep the words "road law" so the learner knows which box they are in; no
 * line in either language contains a figure.
 */
export function lawPointerFor(
  reason: LawRefusal,
  lang: Lang,
): { pointer: string; pointerHref: string | null; chooseState?: true } {
  const lines: Record<Lang, Record<'no-state' | 'not-covered' | 'refused', string>> = {
    en: {
      'no-state': 'Pick your state first: I answer road law only from your own state’s manual.',
      'not-covered': 'Your state’s manual doesn’t say, as far as I can find, so I won’t guess about road law.',
      refused: 'I can’t answer that from your state’s manual in a way I can check, so I won’t guess about road law.',
    },
    es: {
      'no-state': 'Primero elija su estado: respondo sobre las leyes de tránsito solo con el manual de su estado.',
      'not-covered': 'El manual de su estado no lo dice, hasta donde puedo encontrar, así que no voy a adivinar.',
      refused: 'No puedo responder eso con el manual de su estado de una forma que pueda comprobar, así que no voy a adivinar.',
    },
  }
  // One sentence and nothing under it: no state-page link and no contact line
  // (Joel, 2026-10-05: "just answer the question in prose"). The learner asked
  // about the road, and an address to write to is not an answer to that.
  if (reason === 'no-state') return { pointer: lines[lang]['no-state'], pointerHref: null, chooseState: true }
  const line = reason === 'not-covered' ? 'not-covered' : 'refused'
  return { pointer: lines[lang][line], pointerHref: null }
}

/** Where a nationwide refusal points: the page listing every topic the states are compared on. */
export const COMPARED_PAGE = '/drivers/laws/'

/**
 * The worker's own line when a nationwide answer is not shown
 * (docs/plans/nationwide.md, decision 12). Not the state lines: "your state’s
 * manual doesn’t say" under a box ticked for every state is a sentence about
 * the wrong thing. A question no topic matched names what can be compared and
 * links the page that lists it all, so the learner can ask again in a shape
 * that will be answered; no line contains a figure.
 */
export function nationwidePointerFor(reason: LawRefusal, lang: Lang): { pointer: string; pointerHref: string | null } {
  const lines: Record<Lang, Record<'no-topic' | 'not-covered' | 'refused', string>> = {
    en: {
      'no-topic':
        'I can compare the states on what their manuals and codes cover — fire hydrants, school buses, blood alcohol limits and more — and I couldn’t match this question to one of those, so I won’t guess.',
      'not-covered': 'I couldn’t find a rule on that in any state’s manual or code, so I won’t guess.',
      refused: 'I can’t answer that from the states’ manuals and codes in a way I can check, so I won’t guess.',
    },
    es: {
      'no-topic':
        'Puedo comparar los estados en lo que cubren sus manuales y códigos — hidrantes, autobuses escolares, límites de alcohol en la sangre y más — y no pude relacionar esta pregunta con ninguno de esos temas, así que no voy a adivinar.',
      'not-covered': 'No encontré una regla sobre eso en el manual ni en el código de ningún estado, así que no voy a adivinar.',
      refused: 'No puedo responder eso con los manuales y códigos de los estados de una forma que pueda comprobar, así que no voy a adivinar.',
    },
  }
  if (reason === 'no-topic') return { pointer: lines[lang]['no-topic'], pointerHref: COMPARED_PAGE }
  return { pointer: lines[lang][reason === 'not-covered' ? 'not-covered' : 'refused'], pointerHref: null }
}

/** What `/api/ask` answers with. src/ask.ts's `AskAnswer` is the client's reading of it. */
export interface LearnerBody {
  id: 'answer' | 'no-match'
  answer?: string
  sources?: { id: string; title: string; page: string | null }[]
  /**
   * A road-law answer's citations, verbatim: the manual's, which the app
   * renders as the cards do, or a statute's, which it labels as not the manual.
   * `asOf` is the date the law was true as of, from the published file
   * (docs/plans/trusted-by-date.md, decision 7) -- sent rather than left to
   * the browser, whose only date is today's.
   */
  citations?: { id: string; location: string; kind?: 'statute' | 'penalty' | 'process'; state?: string; asOf?: string }[]
  /**
   * A nationwide answer: the states with no law on any topic it was written
   * from, by name. The worker's own list, from the topic files, so the line
   * under the answer cannot name a state the model guessed about.
   */
  absent?: string[]
  pointer?: string
  pointerHref?: string | null
  chooseState?: true
  /** Present exactly when nothing the model wrote is shown. */
  contact?: string
  handOff?: boolean
}

/** What the row records about a turn: what was shown, and why, if nothing was. */
export interface LearnerOutcome {
  answer: string
  scope: Scope | null
  sources: string[]
  model: string
}

export interface LearnerPipeline {
  askLearner: LearnerAsker
  /** The retrieval file for one state. Throws when it cannot be read. */
  lawsFor: (code: string) => Promise<AskLaw[]>
  /**
   * The ids nearest the question in meaning, in that state's namespace of the
   * vector index (law-vectors.ts). Absent, or throwing, leaves BM25 alone: the
   * box answers exactly as it did before the index existed.
   */
  nearLaws?: (code: string, question: string) => Promise<string[]>
  /**
   * The cross-encoder that picks the model's laws from a wider pool
   * (law-rerank.ts). Absent, or throwing, the model gets the first eight of
   * the pool, exactly as before the reranker existed.
   */
  rerank?: Rerank
  /**
   * The question again in the law's words, for retrieval (law-rephrase.ts).
   * Absent, or throwing, retrieval runs on the question alone.
   */
  rephrase?: Rephrase
  /**
   * The topics the states can be compared on, `/ask-laws/topics.json`, and one
   * topic's file of every state's verdict law (docs/plans/nationwide.md). Both
   * throw when they cannot be read; absent, a nationwide question is refused
   * as `no-laws`, as a worker without them must.
   */
  topics?: () => Promise<NationwideTopic[]>
  topicLawsFor?: (topic: string) => Promise<StateLaw[]>
  /** Haiku matching a nationwide question to topics (law-topics.ts). Absent, or throwing, the question's words do. */
  topicsFor?: ChooseTopics
  /**
   * Phase 2 of Nationwide (law-nationwide.ts): every state's namespace of the
   * index searched for a question no topic matched, and the hits' words read
   * from the `laws` table by id. Either throwing refuses the question as
   * `no-laws`. Both absent -- a worker without the index -- the question gets
   * phase 1's line naming what can be compared, which is still true of it.
   */
  nearLawsNationwide?: NearLawsNationwide
  lawsById?: LawsById
  /**
   * Every subsection of the sections a state question's chosen laws are in,
   * from the `laws` table (docs/plans/what-happens-if.md, decision 2). Absent,
   * or throwing, the model is given the laws chosen and nothing more, exactly
   * as before.
   */
  lawsBySection?: LawsBySection
  /**
   * The court's fine schedule for the sections a state question's laws are in
   * (docs/plans/what-happens-if.md, phase 2, decision 12). Absent, or
   * throwing, the model is given the sections without it, exactly as before.
   */
  penaltiesFor?: PenaltiesFor
  /**
   * A state's rows of its own page for the process family the rephraser named
   * (docs/plans/what-happens-if.md, phase 3, decision 16). Absent, or
   * throwing, the pool is what retrieval found, exactly as before.
   */
  processRowsFor?: ProcessRowsFor
  contact: string
}

/**
 * What a ticked Nationwide box sends as the state (docs/plans/nationwide.md,
 * decision 7). Two capitals, so a worker that predates this reads it as one
 * more state it has no file for and refuses road law as `no-laws` -- the
 * harmless failure while Pages deploys first.
 */
export const NATIONWIDE = 'US'

/**
 * The most laws a nationwide question gives the model: two topics of at most
 * fifty-one. A ceiling the tests hold rather than a cut the code makes --
 * cutting would drop a state from a comparison, which is the failure the whole
 * design exists to prevent.
 */
export const NATIONWIDE_LAWS = 110

/**
 * The same ceiling when the topics are one family's (law-topics.ts,
 * `NATIONWIDE_FAMILY_TOPICS`): four topics of at most fifty-one. "Hardest on
 * drunk driving" needs the penalties beside the limits, and a comparison of
 * the limits alone is the answer the site gave before they were judged.
 */
export const NATIONWIDE_FAMILY_LAWS = 220

/** The longest nationwide answer shown: five sentences across the states, where a state answer has two. */
export const NATIONWIDE_ANSWER_CHARS = 900

/** At most this many laws of one section reach the model: Florida's specialty-plate section, § 320.08058, is 400 rows, and Wisconsin's definitions, § 340.01, 235. */
export const SECTION_LAWS = 12

/** At most this many laws reach the model on a state question once its sections are whole. */
export const GIVEN_LAWS = 40

/**
 * At most this many characters of neighbours join the chosen laws. Measured
 * 2026-10-11: of the corpus's 33,960 sections, 135 run past 20,000 characters
 * and 15 past 50,000 (one to 173,000), and twelve rows of one of those is a
 * prompt several times the size of the answer's worth. The chosen rows always
 * go; a neighbour that would cross the budget is skipped and the shorter ones
 * after it still fit, so a defence printed after a wall of text is not lost
 * with the wall.
 */
export const SECTION_CHARS = 24_000

/**
 * The laws chosen for a state question, each statute with the rest of its
 * section (docs/plans/what-happens-if.md, decision 2). A code is cut one
 * subsection a row and each row competes on its own words, so "what happens
 * if I'm pulled over without my license" reached the duty in Maryland's
 * § 16-112(b) alone, and the model said the laws did not state a penalty; in
 * Texas the fine is § 521.025(c) and the way out § 521.025(d), the same
 * section as the duty and never in the same pool. Once retrieval has found
 * the section the rest is a lookup, not a search.
 *
 * The chosen laws stay first, in the order they were chosen, so the matched
 * row is never pushed down by its neighbours; then each section's other rows
 * in the order the code prints them, at most `SECTION_LAWS` a section
 * counting the chosen ones and `GIVEN_LAWS` in all. A manual law has no
 * section and brings nothing. The table says only which ids are in a section:
 * the words given are the state's published file's, the same file the chosen
 * laws came from, and an id the file does not hold is dropped -- so a table
 * pushed behind the corpus can leave a neighbour out but never put an old
 * wording in front of the model. A table that cannot be read, or has no
 * `section` column yet, gives the chosen laws alone.
 */
export async function wholeSections(
  chosen: AskLaw[],
  file: AskLaw[],
  state: string,
  lawsBySection: LawsBySection | undefined,
): Promise<AskLaw[]> {
  const sections = [...new Set(chosen.map(sectionOf).filter((section): section is string => section !== null))]
  if (lawsBySection === undefined || sections.length === 0) return chosen
  let rows: StateLaw[]
  try {
    rows = await lawsBySection(state, sections)
  } catch (error) {
    console.error(`learner ask: could not read the sections of ${state}'s chosen laws`, error)
    return chosen
  }
  const byId = new Map(file.map((law) => [law.id, law]))
  const given = [...chosen]
  const seen = new Set(chosen.map((law) => law.id))
  let chars = 0
  for (const section of sections) {
    let count = chosen.filter((law) => sectionOf(law) === section).length
    for (const row of rows) {
      if (given.length >= GIVEN_LAWS) return given
      if (count >= SECTION_LAWS) break
      const law = byId.get(row.id)
      if (row.state !== state || law === undefined || seen.has(law.id) || sectionOf(law) !== section) continue
      if (chars + law.law.length > SECTION_CHARS) continue
      given.push(law)
      seen.add(law.id)
      count += 1
      chars += law.law.length
    }
  }
  return given
}

/** At most this many schedule rows join one section: Maryland's § 21-801.1 is a row a speed band, and a dozen bands are one answer's worth. */
export const SECTION_PENALTIES = 8

/** At most this many schedule rows join a question's laws in all. */
export const GIVEN_PENALTIES = 16

/**
 * The laws given, each statute section followed by its rows of the court's
 * fine schedule (docs/plans/what-happens-if.md, phase 2, decision 12). The
 * code says what a driver must do; what Maryland charges for not showing a
 * license is $50 in the District Court's schedule and in no section, so the
 * model said the laws given did not state a penalty -- true, and no use to a
 * learner. Once the section is found the figure is a lookup by it.
 *
 * Each row goes after the last law of its section, so it reads as the price
 * of the law above it, and the matched rows are never pushed down. A row is
 * placed by the section the store says it belongs to, and the store is asked
 * for the sections given and nothing else: a row for a section that was not
 * given has nowhere to go, and is put last rather than hidden, so a lookup
 * that matched too much is seen in what the model is given. A store that
 * cannot be read, or a worker deployed before the table exists, gives the
 * laws without it -- today's answer.
 */
export async function withPenalties(
  given: AskLaw[],
  state: string,
  penaltiesFor: PenaltiesFor | undefined,
  /** The laws chosen before their sections were made whole: the subsections the question matched, whose rows go first. */
  chosen: AskLaw[] = given,
): Promise<AskLaw[]> {
  const sections = [...new Set(given.map(sectionOf).filter((section): section is string => section !== null))]
  if (penaltiesFor === undefined || sections.length === 0) return given
  let rows: Awaited<ReturnType<PenaltiesFor>>
  try {
    rows = await penaltiesFor(state, sections)
  } catch (error) {
    console.error(`learner ask: could not read the fine schedule for ${state}'s sections`, error)
    return given
  }
  // The rows for the subsections the question matched come first, then the
  // section's others in the schedule's order: Maryland's § 21-1003 is thirty
  // parking rows, and in schedule order the cap stopped at (i), so the
  // hydrant's (m) -- the one the learner asked about -- was never given.
  // Matched means chosen, not given: the whole section is given, and ranking
  // by every subsection in it is schedule order again.
  const references = chosen.filter((law) => sectionOf(law) !== null).map((law) => referenceOf(law.citation ?? ''))
  const named = (row: (typeof rows)[number]) => {
    const own = `${row.section}${row.code.includes('(') ? row.code.slice(row.code.indexOf('(')) : ''}`
    return references.some((reference) => reference.startsWith(own) || own.startsWith(reference))
  }
  const ordered = [...rows.filter(named), ...rows.filter((row) => !named(row))]
  const after = new Map<string, AskLaw[]>()
  const last: AskLaw[] = []
  const counted = new Map<string, number>()
  let total = 0
  for (const row of ordered) {
    if (row.state !== state || total >= GIVEN_PENALTIES) continue
    if ((counted.get(row.section) ?? 0) >= SECTION_PENALTIES) continue
    counted.set(row.section, (counted.get(row.section) ?? 0) + 1)
    total += 1
    if (sections.includes(row.section)) after.set(row.section, [...(after.get(row.section) ?? []), penaltyLaw(row)])
    else last.push(penaltyLaw(row))
  }
  const lastOf = new Map(given.map((law, index) => [sectionOf(law), index]))
  const out: AskLaw[] = []
  given.forEach((law, index) => {
    out.push(law)
    for (const [section, laws] of after) if (lastOf.get(section) === index) out.push(...laws)
  })
  return [...out, ...last]
}

/**
 * The reranker's pool with the named family's rows of the state's own page
 * added (docs/plans/what-happens-if.md, phase 3, decision 16). Retrieval
 * ranks by words and meaning, and a learner's "how soon can I retake the
 * test" shares neither reliably with a page that says "re-examination" or
 * "waiting period", so a question the rephraser read as `test-and-retake` is
 * given that family's rows whether or not retrieval found them, and the
 * reranker reads them beside everything else. After retrieval's own, so its
 * first choice keeps the place `chooseLaws` protects; each id once. A store
 * that cannot be read, or a question in no family, is the pool as it was.
 */
export async function withFamily(
  pool: AskLaw[],
  state: string,
  family: ProcessFamily | undefined,
  processRowsFor: ProcessRowsFor | undefined,
): Promise<AskLaw[]> {
  if (family === undefined || processRowsFor === undefined) return pool
  let rows: StateLaw[]
  try {
    rows = await processRowsFor(state, family)
  } catch (error) {
    console.error(`learner ask: could not read ${state}'s ${family} page rows`, error)
    return pool
  }
  const seen = new Set(pool.map((law) => law.id))
  const added = rows.filter((row) => !seen.has(row.id)).map(({ state: _state, ...law }) => law)
  return [...pool, ...added]
}

/**
 * The named family's best row, given beside what the reranker chose when it
 * chose none of the family's rows (docs/plans/what-happens-if.md, phase 3,
 * decision 15: the page is preferred for process). Texas's minimum-insurance
 * and passenger questions, and Virginia's permit question, were answered
 * right from the manual and never from the page, because the reranker had
 * the manual's line and no reason to take a second one saying the same. The
 * best row is the one sharing most of the question's and the searches' words,
 * else the page's first. Nothing is added for a question in no family.
 */
export function familyBeside(chosen: AskLaw[], pool: AskLaw[], family: ProcessFamily | undefined, texts: string[]): AskLaw[] {
  if (family === undefined) return chosen
  const rows = pool.filter((law) => law.kind === 'process' && law.concept === family)
  if (rows.length === 0 || chosen.some((law) => rows.includes(law))) return chosen
  const asked = new Set(texts.flatMap(words))
  const shared = (law: AskLaw) => new Set(words(law.law).filter((word) => asked.has(word))).size
  const best = rows.reduce((top, law) => (shared(law) > shared(top) ? law : top), rows[0])
  return [...chosen, best]
}

/**
 * The laws given, with the state's own page after the manual and the code
 * (decision 15): the page is preferred for process and never for the rule of
 * the road, and a page's paraphrase of the hydrant rule listed above the
 * manual's own would be read first by a model told to answer from what it is
 * given. Order within each kind is kept.
 */
export function pagesLast(laws: AskLaw[]): AskLaw[] {
  return [...laws.filter((law) => law.kind !== 'process'), ...laws.filter((law) => law.kind === 'process')]
}

/**
 * One turn, from a scrubbed question to what the learner is shown and what the
 * row records. Everything between the HTTP request and D1 is here, so the
 * workerd suite and the e2e stub (tests/e2e/learner-ask-law.spec.ts) run the
 * same retrieval and the same checks rather than two copies of them.
 *
 * Only the chosen state's laws are read. A state whose file cannot be read
 * still answers app questions -- the book does not need it -- and refuses road
 * law as `no-laws`, never by answering it without them.
 */
export async function answerLearner(
  asked: { lang: Lang; state: string | null; question: string },
  history: LearnerTurn[],
  pipeline: LearnerPipeline,
): Promise<{ body: LearnerBody; outcome: LearnerOutcome; path?: NationwidePath }> {
  // Before any state's file is asked for: there is no `/ask-laws/US.json`, and
  // asking for one would refuse every nationwide question as `no-laws`.
  if (asked.state === NATIONWIDE) return answerNationwide(asked, history, pipeline)
  let laws: AskLaw[] | null | 'failed' = null
  if (asked.state !== null) {
    try {
      laws = await pipeline.lawsFor(asked.state)
    } catch (error) {
      console.error(`learner ask: could not read the laws for ${asked.state}`, error)
      laws = 'failed'
    }
  }
  let near: string[] = []
  if (Array.isArray(laws) && asked.state !== null && pipeline.nearLaws !== undefined) {
    try {
      near = await pipeline.nearLaws(asked.state, asked.question)
    } catch (error) {
      console.error(`learner ask: the vector index did not answer for ${asked.state}`, error)
    }
  }
  // The question in the law's words, each search ranked by the index too: by
  // words alone the rewrite put Texas's 70 mph law 20th, which fused to 35th.
  let searches: Search[] = []
  let family: ProcessFamily | undefined
  if (Array.isArray(laws) && asked.state !== null && pipeline.rephrase !== undefined) {
    try {
      const state = asked.state
      const worded = await pipeline.rephrase(asked.question)
      family = worded.family
      searches = await Promise.all(
        worded.map(async (search) => ({ search, near: await (pipeline.nearLaws?.(state, search) ?? Promise.resolve([])).catch(() => []) })),
      )
    } catch (error) {
      console.error('learner ask: the rephraser did not answer', error)
    }
  }
  const fallback = Array.isArray(laws) ? retrieve(laws, asked.question, RETRIEVED_LAWS, near, searches) : []
  const retrieval = Array.isArray(laws) && pipeline.rerank !== undefined ? retrieve(laws, asked.question, poolSize(searches), near, searches) : []
  const pool = Array.isArray(laws) && asked.state !== null && pipeline.rerank !== undefined ? await withFamily(retrieval, asked.state, family, pipeline.processRowsFor) : retrieval
  const chosen = familyBeside(await chooseLaws(pool, fallback, asked.question, pipeline.rerank), pool, family, [asked.question, ...searches.map((each) => each.search)])
  const sectioned = Array.isArray(laws) && asked.state !== null ? await wholeSections(chosen, laws, asked.state, pipeline.lawsBySection) : chosen
  const retrieved = pagesLast(Array.isArray(laws) && asked.state !== null ? await withPenalties(sectioned, asked.state, pipeline.penaltiesFor, chosen) : sectioned)
  const reply = await pipeline.askLearner({
    lang: asked.lang,
    question: asked.question,
    history,
    laws: laws === null ? null : retrieved,
  })

  if (reply.kind === 'reply' && reply.scope === 'road-law') {
    const checked = checkLawAnswer(reply, asked.lang, laws, retrieved, asked.question)
    if (checked.ok) {
      return {
        body: {
          id: 'answer',
          answer: checked.answer,
          citations: checked.laws.map((law) => ({
            id: law.id,
            location: law.citation as string,
            ...(law.kind === undefined ? {} : { kind: law.kind }),
            ...(law.asOf === undefined ? {} : { asOf: law.asOf }),
          })),
        },
        outcome: { answer: checked.answer, scope: 'road-law', sources: checked.laws.map((law) => law.id), model: reply.model },
      }
    }
    return {
      // No `contact` and no hand-off: a road-law reply is the one sentence.
      body: { id: 'no-match', ...lawPointerFor(checked.reason, asked.lang) },
      outcome: { answer: '', scope: 'road-law', sources: reply.sources, model: `road-law:${checked.reason}` },
    }
  }
  return answerFromBook(reply, asked.lang, history, pipeline.contact, asked.question)
}

/**
 * Which way a nationwide answer was found (docs/plans/nationwide.md, decision
 * 6): from the topics' verdict laws, or from each state's nearest laws in the
 * index. Written to the row's `model` on an answer as `nationwide:<path>`, so
 * the log can tell an exact comparison from a searched one.
 */
export type NationwidePath = 'topic' | 'index'

/**
 * A question with Nationwide ticked (docs/plans/nationwide.md). Matched to at
 * most two topics, or four of one family (docs/plans/trusted-by-date.md), and
 * answered from every state's verdict law on them -- no retrieval, no index, no
 * reranker, because the verdicts already chose each
 * state's law and a comparison needs all of them. Only a question no topic
 * matches searches the index, each state's namespace on its own (phase 2):
 * the fallback, never a second opinion, because merging the two would bring
 * back the fusion that pushes a state's answer out of its own pool. A question
 * about the app is answered from the book exactly as with a state.
 */
async function answerNationwide(
  asked: { lang: Lang; question: string },
  history: LearnerTurn[],
  pipeline: LearnerPipeline,
): Promise<{ body: LearnerBody; outcome: LearnerOutcome; path: NationwidePath }> {
  let given: NationwideLaws | 'failed'
  let path: NationwidePath = 'topic'
  try {
    if (pipeline.topics === undefined || pipeline.topicLawsFor === undefined) throw new Error('no topic files')
    const { topics: topicsFor, topicLawsFor, nearLawsNationwide, lawsById } = pipeline
    const topics = await topicsFor()
    const { topics: chosen } = await chooseTopics(asked.question, topics, pipeline.topicsFor)
    if (chosen.length === 0 && nearLawsNationwide !== undefined && lawsById !== undefined) {
      path = 'index'
      given = await nearestInEveryState(asked.question, nearLawsNationwide, lawsById, pipeline.rephrase)
    } else {
      given = {
        topics: await Promise.all(
          chosen.map(async (id) => {
            const laws = await topicLawsFor(id)
            const present = new Set(laws.map((law) => law.state))
            return {
              question: topics.find((topic) => topic.id === id)!.question,
              laws,
              absent: Object.keys(STATE_NAMES).filter((code) => !present.has(code)).sort(),
            }
          }),
        ),
      }
    }
  } catch (error) {
    console.error(`learner ask: could not read the nationwide laws (${path})`, error)
    given = 'failed'
  }
  const laws = given === 'failed' ? [] : given.topics.flatMap((topic) => topic.laws)
  const reply = await pipeline.askLearner({
    lang: asked.lang,
    question: asked.question,
    history,
    laws,
    nationwide: given === 'failed' ? { topics: [] } : given,
  })
  if (reply.kind !== 'reply' || reply.scope !== 'road-law') return { ...answerFromBook(reply, asked.lang, history, pipeline.contact), path }

  const refused = (reason: LawRefusal) => ({
    body: { id: 'no-match' as const, ...nationwidePointerFor(reason, asked.lang) },
    outcome: { answer: '', scope: 'road-law' as const, sources: reply.sources, model: `road-law:${reason}` },
    path,
  })
  if (given === 'failed') return refused('no-laws')
  if (given.topics.length === 0) return refused('no-topic')
  // No state had a law near the question: whatever the model wrote, it wrote
  // from nothing, and the honest line is that no state's law says.
  if (laws.length === 0) return refused('not-covered')
  const { absent, counts } = nationwideGrounds(given.topics)
  const checked = checkLawAnswer(reply, asked.lang, laws, laws, asked.question, { counts, maxChars: NATIONWIDE_ANSWER_CHARS })
  if (!checked.ok) return refused(checked.reason)
  return {
    body: {
      id: 'answer',
      answer: checked.answer,
      citations: nationwideCitations(checked.laws, laws),
      ...(absent.length === 0 ? {} : { absent: absent.map(stateName) }),
    },
    outcome: { answer: checked.answer, scope: 'road-law', sources: checked.laws.map((law) => law.id), model: `nationwide:${path}` },
    path,
  }
}

/**
 * What a nationwide answer's check is given beside the laws, and the absent
 * line under it. Its own function because a stored chip answer
 * (scripts/chips.ts, docs/plans/trusted-by-date.md, decision 16) is checked
 * offline by this very rule: a copy of it there would let a stored answer pass
 * a count the live box refuses, or fail one it shows.
 *
 * `absent` is the states absent from every topic given: a state with an
 * under-21 law cited above must not be named under the same answer as having
 * no rule. `counts` are the figures no law states that the answer may still
 * write -- each topic's states with a law and without one, and that absent
 * count.
 */
export function nationwideGrounds(topics: NationwideLaws['topics']): { absent: string[]; counts: number[] } {
  const absent = topics.map((topic) => topic.absent).reduce((left, right) => left.filter((code) => right.includes(code)))
  const counts = [...topics.flatMap((topic) => [new Set(topic.laws.map((law) => law.state)).size, topic.absent.length]), absent.length]
  return { absent, counts }
}

/** A nationwide answer's citations as the wire carries them: each law's own citation and date, under its state's name. */
export function nationwideCitations(cited: readonly AskLaw[], laws: readonly StateLaw[]): NonNullable<LearnerBody['citations']> {
  const stateOf = new Map(laws.map((law) => [law.id, law.state]))
  return cited.map((law) => ({
    id: law.id,
    location: law.citation as string,
    ...(law.kind === 'statute' ? { kind: 'statute' as const } : {}),
    ...(law.asOf === undefined ? {} : { asOf: law.asOf }),
    state: stateName(stateOf.get(law.id) as string),
  }))
}

/**
 * Phase 2's laws: each state's nearest, read from the store, in one block
 * headed by the learner's own question. The rephraser's searches go to every
 * namespace beside the question, because a nationwide question is the extreme
 * case of the learner's words not being the law's; failing, the question goes
 * alone, as on the state path. An id the store holds under another state
 * fails the question as `no-laws`; an id it does not hold at all is dropped;
 * and the question fails as `no-laws` only when the store holds none of the
 * ids. The verifier's case (2026-10-09) was the table created but never
 * filled, which must not read as "I couldn't find a rule on that in any
 * state's manual or code" -- a store outage recorded as `not-covered`. The
 * first rule written for it failed the question on any missing id, and on
 * 2026-10-10 that refused every index-path question in production:
 * `laws:embed` never deletes a vector, so one hit in 102 -- North Carolina's
 * § 20-137.1(a), re-chunked since it was embedded -- was a stale id, and one
 * was enough. An unfilled table still answers nothing for every id and is
 * still refused.
 */
async function nearestInEveryState(
  question: string,
  near: NearLawsNationwide,
  lawsById: LawsById,
  rephrase: Rephrase | undefined,
): Promise<NationwideLaws> {
  let searches: string[] = []
  if (rephrase !== undefined) {
    try {
      searches = await rephrase(question)
    } catch (error) {
      console.error('learner ask: the rephraser did not answer', error)
    }
  }
  const hits = await near(question, searches)
  const ids = Object.values(hits).flat()
  const stored = new Map((ids.length === 0 ? [] : await lawsById(ids)).map((law) => [law.id, law]))
  if (ids.length > 0 && stored.size === 0) {
    throw new Error(`the laws table holds none of the ${ids.length} laws the index found: has laws:store been pushed?`)
  }
  const laws = Object.keys(hits)
    .sort()
    .flatMap((state) =>
      hits[state].flatMap((id) => {
        const law = stored.get(id)
        if (law === undefined) {
          console.warn(`learner ask: the index holds ${id} and the laws table does not; a vector left behind, dropped`)
          return []
        }
        if (law.state !== state) throw new Error(`the laws table holds ${id} under ${law.state}, not ${state}`)
        return [law]
      }),
    )
  const present = new Set(laws.map((law) => law.state))
  return {
    topics: [{ question, laws, absent: Object.keys(STATE_NAMES).filter((code) => !present.has(code)).sort(), nearest: true }],
  }
}

/** The longest out-of-scope sentence shown: one sentence naming who decides runs to about a hundred characters. */
export const OTHER_ANSWER_CHARS = 200

/**
 * Whether an out-of-scope answer may be shown in place of the worker's own
 * line (docs/plans/what-happens-if.md, decision 8). "Will my parents find
 * out" and "will my insurance go up" follow a ticket, but no road law decides
 * them, and "That is outside what I can answer here: I know how this app
 * works" is a strange thing to tell a sixteen-year-old who just asked what a
 * ticket costs. So the model may answer one of these in one sentence naming
 * who decides -- and that sentence cites nothing, so it may state nothing that
 * would need citing: no figure in any form, no price, no section, one
 * sentence, short. Anything else out of scope, or a sentence that fails any of
 * that, gets the worker's line as before.
 *
 * And only for a question that is one of these, judged from the learner's
 * own words rather than the model's word for it: before this, nothing the
 * model wrote for "other" ever reached the screen, so "what is the capital of
 * France" -- or a question telling the model to call the app a scam -- could
 * not put a sentence there however the model answered (verifier, 2026-10-10).
 */
export const OUT_OF_SCOPE_CONSEQUENCE =
  /\b(parents?|mom|dad|family|insurance|insurer|premiums?|rates?|search|searched|searching)\b|\b(padres|mam[aá]|pap[aá]|familia|seguro|aseguradora|registrar|revisar|registro)\b/i

export function checkOtherAnswer(reply: LearnerReply, lang: Lang, question: string): string | null {
  if (reply.kind !== 'reply' || reply.scope !== 'other') return null
  if (!OUT_OF_SCOPE_CONSEQUENCE.test(question)) return null
  const answer = reply.answer.trim()
  if (answer === '' || answer.length > OTHER_ANSWER_CHARS) return null
  if (/[.!?]["”’)]?\s+["“¿¡(]?[\p{Lu}\d$]/u.test(answer)) return null
  if (figuresIn(answer, lang).size > 0 || /\d/.test(answer) || CURRENCY.test(answer) || answer.includes('§')) return null
  return answer
}

/** Anything but a road-law reply: the book's answer under `checkAnswer`, or the worker's own line. */
function answerFromBook(
  reply: LearnerReply,
  lang: Lang,
  history: LearnerTurn[],
  contact: string,
  /**
   * The learner's words, on a state question only: the nationwide path never
   * shows an out-of-scope sentence, since a question across every state is a
   * comparison, and "will my parents find out" is not one.
   */
  question?: string,
): { body: LearnerBody; outcome: LearnerOutcome } {
  const handOff = missedTwice(history)
  const other = question === undefined ? null : checkOtherAnswer(reply, lang, question)
  if (other !== null && reply.kind === 'reply') {
    // No sources and no citations: the sentence rests on nothing the app
    // could show under it, and says so by having nothing under it.
    return { body: { id: 'answer', answer: other }, outcome: { answer: other, scope: 'other', sources: [], model: reply.model } }
  }
  const checked = checkAnswer(reply, lang)
  const scope: Scope | null = reply.kind === 'reply' ? reply.scope : null
  if (checked.ok) {
    return {
      body: {
        id: 'answer',
        answer: checked.answer,
        sources: checked.sources.map(({ id, title, page }) => ({ id, title, page })),
      },
      outcome: {
        answer: checked.answer,
        scope,
        sources: checked.sources.map((source) => source.id),
        model: reply.kind === 'reply' ? reply.model : 'asking',
      },
    }
  }
  // Nothing the model wrote is shown. The row says why, and what was shown
  // instead is the empty answer, which is what the next turn replays.
  const outcome = { answer: '', scope, sources: reply.kind === 'reply' ? reply.sources : [], model: checked.reason }
  // Road law returned above; the narrowing is spelled out for the compiler.
  if (reply.kind === 'reply' && reply.scope !== 'app' && reply.scope !== 'road-law') {
    return { body: { id: 'no-match', ...pointerFor(reply.scope, lang, contact), contact, handOff }, outcome }
  }
  return { body: { id: 'no-match', contact, handOff }, outcome }
}

/** Twice in a row with nothing shown is not a wording problem any more. */
export function missedTwice(history: LearnerTurn[]): boolean {
  const previous = history[history.length - 1]
  return previous !== undefined && previous.answer === ''
}
