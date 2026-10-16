/**
 * A nationwide question, matched to the topics every state's law has been
 * judged on (docs/plans/nationwide.md, decisions 1 and 2).
 *
 * A comparison across states cannot be searched for. "Which state has the
 * strictest drunk driving laws" shares no word with any state's blood-alcohol
 * law, and a search over every state's laws at once returns the five states
 * whose codes happen to phrase it like the question and nothing of the other
 * forty-six -- a comparison that is wrong by construction. What does exist is
 * resource/statutes/coverage.json: for each of 35 topics, the one law in each
 * state that answers it, chosen and checked by hand. So the question is matched
 * to a topic, and the laws are that topic's verdict laws, every state's, read
 * from a file the build wrote (`/ask-laws/topics/<topic>.json`). Nothing is
 * retrieved and nothing is ranked.
 *
 * Haiku matches the question to at most two topics, or to at most four of one
 * family (docs/plans/trusted-by-date.md, decision 3). Absent or failing, the
 * question's words do it over the topics' own questions, so "blood alcohol"
 * still finds the blood-alcohol topics while Anthropic is down.
 *
 * Narrowly, since phase 2 (law-nationwide.ts): a question no topic matches is
 * no longer refused but searched for in every state's namespace, so a loose
 * match now costs the learner the better answer. Told only "the topics whose
 * laws answer it", Haiku sent "how old must a child be to ride in the front
 * seat" to the car-seat topic, whose laws say nothing about the front seat,
 * and Opus could only say so (eval, 2026-10-09).
 */
import Anthropic from '@anthropic-ai/sdk'
import { retrieve, type AskLaw } from './law-retrieval'
import { carryingUsage, usageOf, type Usage } from './usage'

/** One topic the states can be compared on, as `/ask-laws/topics.json` lists it. */
export interface NationwideTopic {
  id: string
  question: string
  /** What the topic's search page is called: "Blood alcohol limit for adults". */
  title: string
  /** The subject it answers with others: `dui` for the limits, the refusal, open containers and the six penalties. */
  family?: string
}

/** One state's verdict law for a topic, as `/ask-laws/topics/<topic>.json` holds it. */
export type StateLaw = AskLaw & { state: string }

export const TOPICS_MODEL = 'claude-haiku-4-5-20251001'

/** How long the box waits before matching by words; it runs before every nationwide question. */
export const TOPICS_TIMEOUT_MS = 5000

/**
 * At most this many topics per answer. Two, because "strictest drunk driving
 * laws" is the adult limit and the under-21 limit; three is where the prompt
 * passes 15,000 tokens for an answer of five sentences.
 */
export const NATIONWIDE_TOPICS = 2

/**
 * At most this many topics when they are all of one family. "Which state is
 * hardest on drunk driving" spans the limits, the fine, jail, the suspension
 * and the interlock: read two of them and the answer is the lowest limit
 * again, which is what the site answered before the penalties were judged.
 * Four of one family is about 200 laws and 20,000 tokens, and stays one
 * subject the model can compare on.
 */
export const NATIONWIDE_FAMILY_TOPICS = 4

/**
 * The families a topic may belong to, each with the words the chooser is told
 * it covers. Declared here rather than read off topics.json, so a family
 * misspelt on one topic ("dwi") is a family of one that the chooser is never
 * told about -- tests/unit/statute-coverage.test.ts holds every topic's
 * family to this list.
 */
export const TOPIC_FAMILIES: Record<string, string> = {
  dui: 'drunk driving: the blood alcohol limits, refusing a test, open containers, and the penalties for a conviction',
}

export function topicsPath(): string {
  return '/ask-laws/topics.json'
}

export function topicPath(id: string): string {
  return `/ask-laws/topics/${id}.json`
}

/** What the chooser answers: the topics' ids, best first, and the family the question asks about as a whole, if any. */
export interface TopicChoice {
  topics: string[]
  family?: string
  /** What the chooser's call spent (usage.ts), counted into the question's tokens. */
  usage?: Usage
}

/** The topics for a question, best first; empty when no topic fits. A bare list is a choice that names no family. */
export type ChooseTopics = (question: string, topics: readonly NationwideTopic[]) => Promise<string[] | TopicChoice>

/** The part of the Anthropic client the chooser calls; a test passes its own. */
export type TopicsClient = Pick<Anthropic, 'messages'>

const RULES = `A learner driver asked a question to be answered by comparing the road law of every US state.
You are given the topics every state's law has been checked on, one per line as "id: question", or "id [family]: question" for a topic in a family.
Return the ids of the topics whose laws answer the learner's question, best first, at most two.
Some topics belong to a family, listed below with what it covers. A question about a family as a whole -- "strictest drunk driving laws", "DUI penalties", "which state is hardest on drunk driving" -- names the family in "family" and returns up to four of its topics, the ones that answer it best first; any other question leaves "family" empty.
"Strictest drunk driving laws" is the dui family, led by the blood alcohol limits; "where can you turn left on red" is the left-on-red topic alone.
A topic answers only what its own question asks: "how old must a child be to ride in the front seat" is not the car-seat topic, which says when a child needs a car seat and not where one may sit.
A question that compares the states on what a topic's question asks is that topic, in whatever words: "which state has the slowest school zone speed limit" is speed-school-zone, "which states make you wait until 16 for a learner's permit" is permit-age, "which states do not require adults in the back seat to wear a seat belt" is seat-belts, and the same questions in Spanish are the same topics. A question about one figure or condition inside a topic's subject is that topic too, though the topic's question names the subject and not the figure: "how much must you slow down passing a stopped emergency vehicle" is move-over, "how long after sunset must your headlights be on" and "which states make you turn on your headlights when your wipers are on" are headlights-when, "how far away must oncoming drivers see you before a U-turn" is u-turn, "which state lets you park farthest from the curb" is park-curb. A Spanish question uses its own words for the subject, and they are the same topic: "acera" or "bordillo" is the curb, "limpiaparabrisas" the wipers, "vehículo de emergencia detenido" the stopped emergency vehicle. A comparison on a family's subject -- "which state has the harshest first-offense DUI penalties" -- still names the family and returns its topics. The comparison is made afterwards from every state's law; the topic only has to hold the figure or rule being compared.
Return no ids if no topic's laws would answer it: a question about anything else, or about road law no topic covers. A question no topic answers is searched for in every state's own laws instead, so a topic that only brushes it is worse than none.`

const SCHEMA = {
  type: 'object',
  properties: { topics: { type: 'array', items: { type: 'string' } }, family: { type: 'string' } },
  required: ['topics', 'family'],
  additionalProperties: false,
} as const

/**
 * Haiku as a `ChooseTopics`. Throws on anything it cannot read, so the caller
 * matches by words instead; an id that is not a topic is dropped by
 * `chooseTopics`, never fetched.
 */
export function haikuTopicsFor(apiKey: string | undefined, client?: TopicsClient): ChooseTopics | undefined {
  if (client === undefined && (apiKey === undefined || apiKey.length === 0)) return undefined
  const anthropic = client ?? new Anthropic({ apiKey, timeout: TOPICS_TIMEOUT_MS, maxRetries: 0 })
  return async (question, topics) => {
    const response = await anthropic.messages.create({
      model: TOPICS_MODEL,
      max_tokens: 128,
      system: `${RULES}\n\nThe families:\n${Object.entries(TOPIC_FAMILIES).map(([family, covers]) => `${family}: ${covers}`).join('\n')}\n\nThe topics:\n${topics.map((topic) => `${topic.id}${topic.family === undefined ? '' : ` [${topic.family}]`}: ${topic.question}`).join('\n')}`,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: question }],
    })
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('')
    let read: { topics?: unknown; family?: unknown }
    try {
      read = JSON.parse(text) as { topics?: unknown; family?: unknown }
      if (!Array.isArray(read.topics) || read.topics.some((id) => typeof id !== 'string')) {
        throw new Error(`the topic chooser answered with no topics: ${text}`)
      }
    } catch (error) {
      throw carryingUsage(error, response)
    }
    const { topics: chosen, family } = read
    return {
      topics: chosen as string[],
      ...(typeof family === 'string' && family.length > 0 ? { family } : {}),
      usage: usageOf(response),
    }
  }
}

/** The topics whose own question shares the learner's words, best first. */
export function topicsByWords(question: string, topics: readonly NationwideTopic[], limit = NATIONWIDE_TOPICS): string[] {
  const asLaws: AskLaw[] = topics.map((topic) => ({ id: topic.id, law: topic.question, question: '', concept: '', citation: null }))
  return retrieve(asLaws, question, limit).map((law) => law.id)
}

/**
 * The topics a nationwide question is answered from: the chooser's, known ids
 * only; by words when the chooser is absent or throws. A chooser that answered
 * "none" is believed -- that is what sends the question to the refusal rather
 * than to a topic the words merely brushed.
 *
 * At most `NATIONWIDE_TOPICS`, or `NATIONWIDE_FAMILY_TOPICS` when the topics
 * are one family's: a family the chooser named keeps only its own topics, and
 * topics all of one family count as that family. A mixed list keeps the cap of
 * two, because two subjects at four topics each is the 15,000-token prompt the
 * cap exists to prevent, spread over things that do not compare.
 */
export async function chooseTopics(
  question: string,
  topics: readonly NationwideTopic[],
  chooser: ChooseTopics | undefined,
): Promise<{ topics: string[]; family: string | null }> {
  let chosen: TopicChoice
  try {
    if (chooser === undefined) throw new Error('no topic chooser')
    const answered = await chooser(question, topics)
    chosen = Array.isArray(answered) ? { topics: answered } : answered
  } catch (error) {
    if (chooser !== undefined) console.error('learner ask: the topic chooser did not answer', error)
    chosen = { topics: topicsByWords(question, topics) }
  }
  const familyOf = new Map(topics.map((topic) => [topic.id, topic.family]))
  let ids = [...new Set(chosen.topics)].filter((id) => familyOf.has(id))
  // A family nobody declared is no family: "drunk" from the chooser must not lift the cap.
  const named = chosen.family !== undefined && Object.hasOwn(TOPIC_FAMILIES, chosen.family) ? chosen.family : null
  if (named !== null) ids = ids.filter((id) => familyOf.get(id) === named)
  // A chooser that names a family and no topic -- "harshest first-offense DUI
  // penalties" did it in two runs of six -- has still said what the question
  // is about; without this the question went to the index path, which cannot
  // compare the family's figures at all. The family's own topics, the ones
  // sharing the learner's words first, then the rest in their declared order.
  if (named !== null && ids.length === 0) {
    const own = topics.filter((topic) => topic.family === named)
    const byWords = topicsByWords(question, own, NATIONWIDE_FAMILY_TOPICS)
    ids = [...byWords, ...own.map((topic) => topic.id).filter((id) => !byWords.includes(id))]
  }
  const first = familyOf.get(ids[0] ?? '')
  const shared = first !== undefined && Object.hasOwn(TOPIC_FAMILIES, first) && ids.every((id) => familyOf.get(id) === first) ? first : null
  const family = named ?? shared
  return { topics: ids.slice(0, family === null ? NATIONWIDE_TOPICS : NATIONWIDE_FAMILY_TOPICS), family }
}
