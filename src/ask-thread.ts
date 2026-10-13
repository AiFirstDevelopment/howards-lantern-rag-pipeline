import type { AskAnswer, AskThreadEntry } from './ask'
import { NATIONWIDE } from './topics'

/**
 * A code's questions, read back on a device that holds it (worker/src/questions.ts,
 * `GET /api/questions/history`), turned into the thread the box draws, and
 * merged with the one this device kept.
 */
export interface HistoryRow {
  conversation: string
  question: string
  answer: string
  scope: string | null
  /** The section ids the answer rested on, as the worker logged them. */
  sources: string[]
  state: string | null
  lang: string
  /** Seconds. */
  asked_at: number
}

/** A law's manual citation in the published corpus of `state`, or null where that corpus does not hold the id. */
export type CitationOf = (state: string, id: string) => string | null

/** Whether a row's sources can be looked up in one state's published corpus. */
export function rebuildable(row: HistoryRow): row is HistoryRow & { state: string } {
  return row.scope === 'road-law' && row.state !== null && row.state !== NATIONWIDE && row.sources.length > 0
}

/**
 * The rows as kept exchanges, oldest first.
 *
 * The worker logs an answer's text and its section ids, not the citations it
 * drew, so the sources line is rebuilt here from the ids: a road-law answer
 * for one state gets each id's manual citation from that state's published
 * corpus, and an id the corpus does not hold -- a statute section, a law
 * since retired -- is left off rather than guessed at. A nationwide answer and
 * an answer about the app get no line at all: the first would mean reading up
 * to fifty-one states' files on a phone to label one old answer, and the
 * second's ids name knowledge-base entries, not laws.
 */
export function fromHistory(rows: readonly HistoryRow[], citationOf: CitationOf): AskThreadEntry[] {
  return [...rows]
    .sort((a, b) => a.asked_at - b.asked_at)
    .map((row) => {
      const citations = rebuildable(row)
        ? row.sources.flatMap((id) => {
            const location = citationOf(row.state, id)
            return location === null ? [] : [{ id, location }]
          })
        : []
      const answer: AskAnswer = { id: 'answer', answer: row.answer, ...(citations.length === 0 ? {} : { citations }) }
      return { question: row.question, answer, state: row.state, askedAt: new Date(row.asked_at * 1000).toISOString(), conversation: row.conversation }
    })
}

/** How far apart the device's clock and the worker's may put the same question: the worker writes its row as the question arrives. */
const SAME_QUESTION_MS = 120_000

interface Keyed {
  question: string
  askedAt?: string
  conversation?: string
}

/**
 * The thread with the cloud's exchanges added where this device does not
 * already have them, in the order they were asked.
 *
 * The same question is matched by conversation, and then by its words or --
 * only where the worker scrubbed a phone number out of what it kept, so the
 * words cannot match -- by being asked within two minutes. Time alone would
 * swallow a quick follow-up whose answer this device never received. The device's copy wins: it holds the answer as it was drawn,
 * citations and all, where the cloud's has only what could be rebuilt.
 */
export function mergeThread<T extends Keyed>(local: readonly T[], cloud: readonly AskThreadEntry[], wrap: (entry: AskThreadEntry) => T): T[] {
  const added = cloud.filter((entry) => !local.some((mine) => sameExchange(mine, entry)))
  if (added.length === 0) return [...local]
  const at = (each: Keyed) => {
    const time = Date.parse(each.askedAt ?? '')
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
  }
  return [...local, ...added.map(wrap)].sort((a, b) => at(a) - at(b))
}

/** Whether `mine`, kept on this device, is the cloud's `entry`: the rule mergeThread matches by. */
export function sameExchange(mine: Keyed, entry: AskThreadEntry): boolean {
  return (
    mine.conversation !== undefined &&
    mine.conversation === entry.conversation &&
    (mine.question === entry.question ||
      (entry.question.includes('<phone>') && Math.abs(Date.parse(mine.askedAt ?? '') - Date.parse(entry.askedAt)) <= SAME_QUESTION_MS))
  )
}

/** What this device remembers of an exchange its learner deleted, to know the cloud's copy of it. */
export interface Deleted {
  question: string
  askedAt?: string
  conversation?: string
}

/**
 * The code's history without the exchanges deleted on this device. The worker
 * still holds them, and without this a deleted question came back folded on
 * the next load, merged in as if this device had never seen it.
 */
export function withoutDeleted(cloud: readonly AskThreadEntry[], deleted: readonly Deleted[]): AskThreadEntry[] {
  return cloud.filter((entry) => !deleted.some((gone) => sameExchange(gone, entry)))
}

interface Answered {
  chip?: true | 'state'
  state?: string | null
}

/**
 * The thread as it should stand under a box answering for `state`: a state
 * chip's stored answer leaves with the state it was for, and everything else
 * stays -- typed answers, which name their own state's manual, and the
 * nationwide row's chips, which are every state's.
 *
 * A null `state` drops nothing. It means the state is not known yet -- a
 * visitor placed by GET /api/geo gets theirs a tick after the box draws --
 * and reading that as "no state" left out every kept Maryland chip answer on
 * load, after which the write that follows each change of the thread stored
 * `[]` (live, 2026-10-12). A state chip's answer with no state of its own is
 * taken to be the current state's and given it, so the next change of state
 * can tell it apart.
 */
export function keptFor<T extends Answered>(thread: readonly T[], state: string | null): T[] {
  if (state === null) return [...thread]
  return thread.flatMap((exchange) => {
    if (exchange.chip !== 'state') return [exchange]
    if (exchange.state === undefined || exchange.state === null) return [{ ...exchange, state }]
    return exchange.state === state ? [exchange] : []
  })
}
