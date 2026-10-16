import type { Rerank } from './law-rerank'
import type { Rephrase } from './law-rephrase'
import type { LawsById, LawsBySection, NearLawsNationwide, PenaltiesFor, ProcessRowsFor } from './law-nationwide'
import type { ChooseTopics, NationwideTopic, StateLaw } from './law-topics'
import { HISTORY_TURNS, MAX_QUESTION_CHARS, QUESTION_RETENTION_SECONDS } from './ask'
import type { AskLaw } from './law-retrieval'
import { TOKENS_PER_QUESTION } from '../../src/pricing'
import { balanceOf, debit, normalizeQuestionCode, refund } from './questions'
import {
  LEARNER_DAILY_QUESTIONS,
  NATIONWIDE,
  answerLearner,
  missedTwice,
  type Lang,
  type LearnerAsker,
  type LearnerTurn,
  type Scope,
} from './learner-ask'
import type { TurnstileVerifier } from './turnstile'
import { SESSION, scrub } from './validate'
import { addCandidate } from './eval-candidates'

/**
 * `POST /api/ask`: the learner's box (docs/plans/learner-ask.md, decision 7).
 *
 * The same shape as `handlePublicAsk` in partner-api.ts -- the id check, the
 * ceiling before the challenge, the challenge on turn one, the turn claimed
 * before the model is asked, the purge on the write path -- against
 * its own table rather than a NULL-column convention in `partner_questions`. A
 * learner's question must never appear in the partner box's log or count
 * against its ceiling, and two handlers over one table is how that would
 * quietly happen. Written out rather than parameterising the partner handler,
 * so the handler that can reach account entries is never the one a learner
 * calls; the plan allowed either.
 *
 * Two things this does that the partner handler does not. **The question is
 * scrubbed before anything sees it** -- phone numbers, codes and email addresses
 * -- because learners are fifteen and nobody replies here, so an address typed
 * into this box has nowhere to go but a table and a third party. And **the
 * model's text is shown only after `checkAnswer` passes it**, or for road law
 * `checkLawAnswer` (docs/plans/learner-ask-law.md); what is written to the row
 * is what the learner saw, which is what the next turn replays.
 */
export interface LearnerDeps {
  askLearner: LearnerAsker
  /** The chosen state's retrieval file (law-retrieval.ts). Throws when it cannot be read. */
  lawsFor: (code: string) => Promise<AskLaw[]>
  /** The vector index's nearest ids for a question (law-vectors.ts); absent in a suite that does not drive it. */
  nearLaws?: (code: string, question: string) => Promise<string[]>
  /** The cross-encoder over the pool (law-rerank.ts); absent in a suite that does not drive it. */
  rerank?: Rerank
  /** The question in the law's words, for retrieval (law-rephrase.ts); absent in a suite that does not drive it. */
  rephrase?: Rephrase
  /** The topics the states are compared on, `/ask-laws/topics.json` (law-topics.ts); absent in a suite that does not drive Nationwide. */
  topics?: () => Promise<NationwideTopic[]>
  /** One topic's file of every state's verdict law. Throws when it cannot be read. */
  topicLawsFor?: (topic: string) => Promise<StateLaw[]>
  /** Haiku matching a nationwide question to topics; absent in a suite that does not drive it. */
  topicsFor?: ChooseTopics
  /** Every state's namespace searched for a nationwide question no topic matched (law-nationwide.ts); absent in a suite that does not drive it. */
  nearLawsNationwide?: NearLawsNationwide
  /** The `laws` table's rows by id. Throws when it cannot be read. */
  lawsById?: LawsById
  /** The `laws` table's rows by section, for a state question's whole sections; absent in a suite that does not drive it. */
  lawsBySection?: LawsBySection
  /** The `penalties` table's rows by section, the court's fine schedule; absent in a suite that does not drive it. */
  penaltiesFor?: PenaltiesFor
  /** The `laws` table's rows of a state's own page for one process family; absent in a suite that does not drive it. */
  processRowsFor?: ProcessRowsFor
  verifyTurnstile: TurnstileVerifier
  now: () => number
  /** The support address: every refusal here lands on it. */
  contact: string
}

interface AskBody {
  conversation?: string
  question?: string
  turnstile?: string
  lang?: string
  state?: string
  /** A question code, sent only when the browser means to pay for this question with it. */
  spend?: string
  /**
   * The question code this browser holds, sent with every question, paid or
   * free, so the row is kept under it and the code's history reads back on
   * any device that holds it.
   */
  code?: string
  /** The browser's analytics id, the one on its events: who asked, for the Learners tab. */
  session?: string
}

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const STATE = /^[A-Z]{2}$/

interface Asked {
  conversation: string
  question: string
  lang: Lang
  state: string | null
  /** The code paying for this question, normalized; null on a free one. */
  credit: string | null
  /** The code the asking browser holds, normalized, whether or not it pays; null when it holds none. */
  held: string | null
  /**
   * The asking browser's analytics id, or null from a client too old to send
   * one -- which is still answered: who asked is the operator's question, not
   * a reason to refuse the learner's.
   */
  session: string | null
}

function readAsk(body: AskBody | null): Asked | { error: string } {
  const conversation = typeof body?.conversation === 'string' ? body.conversation : ''
  if (!CONVERSATION_ID.test(conversation)) return { error: 'a conversation id is required' }
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (question.length === 0) return { error: 'a question is required' }
  if (question.length > MAX_QUESTION_CHARS) {
    return { error: `a question can be at most ${MAX_QUESTION_CHARS} characters` }
  }
  const state = typeof body?.state === 'string' && STATE.test(body.state) ? body.state : null
  // A `spend` that is no code at all is still a request to pay, and is
  // answered as a code with nothing on it -- never quietly as a free question,
  // which would count against a browser that meant to use its tokens.
  const credit = body?.spend === undefined ? null : (normalizeQuestionCode(body.spend) ?? '')
  return { conversation, question, lang: body?.lang === 'es' ? 'es' : 'en', state, credit, held: normalizeQuestionCode(body?.code),
    session: typeof body?.session === 'string' && SESSION.test(body.session) ? body.session : null,
  }
}

/**
 * Whether a paid question's token goes back: when the model never answered,
 * or the laws it needed could not be read -- the learner got nothing for a
 * reason that was ours. Never for `not-covered` or a checker's refusal: the
 * model was asked and worked, and "the law does not say" is an answer.
 */
const REFUNDED = new Set(['unavailable', 'unreachable', 'unparsed', 'refused', 'road-law:no-laws'])

/** What a code with nothing on it is answered with: the box opens the purchase pop-up on it. */
function noTokens(cors: HeadersInit, contact: string): Response {
  return json({ error: 'no tokens left on that code', buy: true, tokens: { left: 0 }, contact }, 402, cors)
}

/**
 * The thread as it was logged -- the last `HISTORY_TURNS` of it, oldest
 * first, which is what the model is shown -- and the number this turn takes.
 *
 * The number comes from the highest turn written, not from the length of the
 * window: a conversation past its tenth question still numbers its eleventh
 * eleven, and a window counted as the thread would hand every turn after the
 * tenth the same number and refuse it at the unique index.
 */
async function turnsOf(db: D1Database, conversation: string): Promise<{ history: LearnerTurn[]; turn: number }> {
  const last = await db
    .prepare('SELECT COALESCE(MAX(turn), 0) AS last FROM learner_questions WHERE conversation = ?')
    .bind(conversation)
    .first<{ last: number }>()
  const rows = await db
    .prepare(
      `SELECT question, scope, answer, sources FROM learner_questions
        WHERE conversation = ? ORDER BY turn DESC LIMIT ?`,
    )
    .bind(conversation, HISTORY_TURNS)
    .all<{ question: string; scope: string | null; answer: string | null; sources: string | null }>()
  const history = (rows.results ?? []).reverse().map((row) => ({
    question: row.question,
    scope: row.scope as Scope | null,
    answer: row.answer ?? '',
    sources: row.sources === null ? [] : (JSON.parse(row.sources) as string[]),
  }))
  return { history, turn: (last?.last ?? 0) + 1 }
}

/**
 * The site's own ceiling, over free questions only. A paid question has its
 * bound already -- the balance -- and counting it here would let a classroom
 * spending a twenty-five dollar pack shut the free box for everybody else.
 * Counted by `paid`, not by `credit_code`: a free question from a browser
 * holding a code carries the code too, and counting by the code would let
 * anybody holding one ask free questions past the ceiling without limit.
 */
async function pastCeiling(db: D1Database, now: number): Promise<boolean> {
  const today = await db
    .prepare('SELECT COUNT(*) AS c FROM learner_questions WHERE asked_at > ? AND paid = 0')
    .bind(now - 86_400)
    .first<{ c: number }>()
  return (today?.c ?? 0) >= LEARNER_DAILY_QUESTIONS
}

/** Every table keyed by a learner question's id, cleared of a purged question's rows on the same write. */
const ORPHANED = ['answer_ratings', 'answer_scores', 'eval_candidates', 'eval_labels'] as const

/**
 * Take this turn, and forget what the retention promise says is old -- on the
 * write path, for the reason `claimTurn` in partner-api.ts gives: a purge that
 * runs whenever a question is asked cannot be forgotten.
 */
async function claimTurn(
  db: D1Database,
  asked: Asked,
  turn: number,
  now: number,
  keptUnder: string | null,
): Promise<number | null> {
  await db.batch([
    db.prepare('DELETE FROM learner_questions WHERE asked_at < ?').bind(now - QUESTION_RETENTION_SECONDS),
    // What the eval lifecycle keeps beside a question goes with it
    // (docs/plans/eval-lifecycle-build.md, decision 8). The ids are never
    // reused, so an orphan is never misread as another question's -- but a
    // rating, a score or a label outliving the question it is about is kept
    // past the 180 days the privacy page promises, and every count of them
    // includes rows nobody can read back.
    ...ORPHANED.map((table) => db.prepare(`DELETE FROM ${table} WHERE question_id NOT IN (SELECT id FROM learner_questions)`)),
  ])
  try {
    const written = await db
      .prepare(
        `INSERT INTO learner_questions
           (conversation, turn, asked_at, lang, state, question, answer, scope, sources, model, credit_code, paid, session)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'asking', ?, ?, ?)`,
      )
      // The code with every question its holder asks, free ones too (Joel,
      // 2026-10-12): the code's history is what a second device that holds it
      // shows. Only a code that exists, and only the asking browser's own --
      // a row under a code nobody bought would be a history nobody can read.
      .bind(asked.conversation, turn, now, asked.lang, asked.state, asked.question, keptUnder, asked.credit === null ? 0 : 1, asked.session)
      .run()
    return Number(written.meta.last_row_id)
  } catch (error) {
    console.error('learner ask: this turn is already claimed', error)
    return null
  }
}

export async function handleLearnersAsk(
  request: Request,
  db: D1Database,
  cors: HeadersInit,
  deps: LearnerDeps,
): Promise<Response> {
  const body = await readJson<AskBody>(request)
  const read = readAsk(body)
  if ('error' in read) return json({ error: read.error, contact: deps.contact }, 400, cors)
  // Scrubbed here, once, so neither the model nor the row ever sees what was
  // removed. `scrub` is the feedback box's redaction -- codes, ids, query
  // strings -- plus the email address; the phone number is this box's own
  // addition, because the notice above it promises one.
  const asked: Asked = { ...read, question: withoutPhones(scrub(read.question)) }

  // The one thing the partner handler does here that this one does not is
  // end the thread at MAX_TURNS: a learner's question after the free ones is
  // a paid one, and the prompt is bounded by the window `turnsOf` reads, not
  // by ending the conversation (`HISTORY_TURNS` in ask.ts).
  const { history, turn } = await turnsOf(db, asked.conversation)

  const now = deps.now()
  // What this question costs, when it is paid for: a nationwide one reads
  // every state's law and costs five (src/pricing.ts).
  const cost = asked.state === NATIONWIDE ? TOKENS_PER_QUESTION.nationwide : TOKENS_PER_QUESTION.state
  if (asked.credit !== null) {
    // Looked at before the challenge, for the reason the ceiling is: a code
    // that cannot pay should not spend the visitor's Turnstile token too. Not
    // the debit -- that is below, after the challenge, in one statement.
    const left = asked.credit === '' ? null : await balanceOf(db, asked.credit)
    if (left === null || left < cost) return noTokens(cors, deps.contact)
  } else if (await pastCeiling(db, now)) {
    // Before the challenge, for the reason partner-api.ts gives: a Turnstile
    // token is redeemed once, and spending it on a request the ceiling was going
    // to refuse strands the visitor for the day.
    return json({ id: 'no-match', contact: deps.contact, handOff: missedTwice(history) }, 200, cors)
  }

  if (turn === 1) {
    const passed = await deps.verifyTurnstile(
      typeof body?.turnstile === 'string' ? body.turnstile : '',
      request.headers.get('CF-Connecting-IP'),
    )
    if (!passed) {
      return json({ error: 'that did not look like a person', contact: deps.contact }, 400, cors)
    }
  }

  // Debited before the model is asked (decision 24): the balance looked at
  // above can have been spent since by another device on the same code, and
  // only this conditional UPDATE decides.
  const credit = asked.credit
  let left: number | null = null
  if (credit !== null) {
    left = await debit(db, credit, cost)
    if (left === null) return noTokens(cors, deps.contact)
  }
  const giveBack = async () => {
    if (credit !== null) left = (await refund(db, credit, cost)) ?? left
  }

  // The paying code, or the held one when it is a code that exists.
  const keptUnder = credit ?? (asked.held !== null && (await balanceOf(db, asked.held)) !== null ? asked.held : null)
  const claimed = await claimTurn(db, asked, turn, now, keptUnder)
  if (claimed === null) {
    await giveBack()
    return json({ id: 'no-match', contact: deps.contact, handOff: missedTwice(history), ...tokens(left) }, 200, cors)
  }

  let answered: Awaited<ReturnType<typeof answerLearner>>
  // Wall time around the whole turn, the model's calls and the reads between
  // them, which is what the learner waits for.
  const started = Date.now()
  try {
    answered = await answerLearner(asked, history, deps)
  } catch (error) {
    // A throw here is a 500 from index.ts, and a token kept for it is a token
    // taken for nothing.
    await giveBack()
    throw error
  }
  const latency = Date.now() - started
  const { body: reply, outcome } = answered
  if (REFUNDED.has(outcome.model)) await giveBack()
  await db
    .prepare(
      `UPDATE learner_questions
          SET answer = ?, scope = ?, sources = ?, model = ?, latency_ms = ?, tokens_in = ?, tokens_out = ?, trace = ?
        WHERE id = ?`,
    )
    .bind(
      outcome.answer,
      outcome.scope,
      JSON.stringify(outcome.sources),
      outcome.model,
      latency,
      outcome.usage.input,
      outcome.usage.output,
      JSON.stringify(outcome.trace),
      claimed,
    )
    .run()
  // The row's id, so the browser that holds the thread can rate this answer
  // (`handleLearnersRate`). It means nothing outside this table.
  return json({ ...reply, questionId: claimed, ...tokens(left) }, 200, cors)
}

interface RateBody {
  conversation?: unknown
  questionId?: unknown
  rating?: unknown
}

/**
 * `POST /api/ask/rate`: a thumbs up or down on an answer
 * (docs/plans/eval-lifecycle-build.md, decision 6).
 *
 * Only for a row with that id **and** that conversation, so only the browser
 * holding the thread can rate it: the ids count up from one, and a check on
 * the id alone would let anybody rate every answer the box has given. A second
 * rating replaces the first. A thumbs-down also puts the question in the
 * labelling queue, once (eval-candidates.ts). No challenge: a rating spends
 * nothing, and the conversation id is the secret.
 */
export async function handleLearnersRate(request: Request, db: D1Database, cors: HeadersInit, now: () => number): Promise<Response> {
  const body = await readJson<RateBody>(request)
  const conversation = typeof body?.conversation === 'string' ? body.conversation : ''
  const questionId = body?.questionId
  const rating = body?.rating
  if (!CONVERSATION_ID.test(conversation) || !Number.isSafeInteger(questionId) || (questionId as number) < 1 || (rating !== 1 && rating !== -1)) {
    return json({ error: 'a conversation, a question id and a rating of 1 or -1 are required' }, 400, cors)
  }
  const at = now()
  const written = await db
    .prepare(
      `INSERT OR REPLACE INTO answer_ratings (question_id, rating, rated_at)
       SELECT id, ?, ? FROM learner_questions WHERE id = ? AND conversation = ?`,
    )
    .bind(rating, at, questionId, conversation)
    .run()
  if ((written.meta.changes ?? 0) === 0) return json({ error: 'no such answer in this conversation' }, 404, cors)
  if (rating === -1) await addCandidate(db, questionId as number, 'rated_down', at)
  return new Response(null, { status: 204, headers: cors })
}

/** The balance after a paid question, on its answer; nothing on a free one. */
function tokens(left: number | null): { tokens?: { left: number } } {
  return left === null ? {} : { tokens: { left } }
}

/**
 * A North American phone number, in the shapes people type it. Ten digits with
 * the usual punctuation; a bare "21 days" or a "25-question test" is not one.
 */
function withoutPhones(text: string): string {
  return text.replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '<phone>')
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}
