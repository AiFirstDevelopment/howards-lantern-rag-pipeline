/**
 * What learners say about the app, and the one thing they can tell us that no
 * event ever will: whether they passed the real exam.
 *
 * This is the third kind of row this worker writes, and it gets its own file
 * for the same reason it gets its own table. `events` is a closed enum.
 * `errors` is text nobody meant to send. This is text somebody typed on
 * purpose -- so it is the only payload here that may legitimately contain an
 * email address, and the only one whose contents must never reach the public
 * stats endpoint. Keeping the reader for it in this file is what makes that
 * structural: `computeStats` cannot publish a column it never names, and the
 * one query below that names `comment` at all asks whether there is one, not
 * what it says.
 */

import type { EventGeo } from './analytics'
import { PRODUCT, SESSION, STATE, isInteger, scrubComment } from './validate'

/** What happened at the licensing office. The only outcome that matters. */
export const OUTCOMES = ['passed', 'failed', 'not_yet'] as const
export type Outcome = (typeof OUTCOMES)[number]

/**
 * Long enough for a real complaint, short enough that the table cannot be
 * filled by one determined afternoon. Bounded on this side too: the client's
 * limit is a courtesy, not a control.
 */
export const COMMENT_LIMIT = 600

const MAX_RATING = 5
const MAX_QUESTIONS = 500
const MAX_LEVEL = 99
const MAX_TESTS = 9999
const RELEASE_LIMIT = 40

export interface FeedbackRow {
  session: string
  /** The browser a purchase attaches to, so an exam outcome reads against a sale. */
  device: string | null
  /**
   * Which exam they are rating. Which one somebody passed is the whole point
   * of asking whether they passed -- a five-star "I passed" about a hunting
   * license says nothing at all about the driving corpus.
   *
   * Null on the rows written before the column existed, which were all about
   * driving because that was the only exam there was.
   */
  product: string | null
  rating: number
  outcome: Outcome | null
  comment: string
  state: string | null
  level: number | null
  tests: number | null
  score: number | null
  total: number | null
  release: string | null
  /**
   * `'es'` for a comment written on a Spanish screen, `'en'` if a client says
   * so, and null when absent -- which is English, and every row before a pack
   * existed (docs/plans/spanish-app.md, §6).
   */
  lang: 'en' | 'es' | null
}

/**
 * The submitted feedback, or null if it is not ours.
 *
 * Unlike the two sinks, the caller of this one answers with a real status: a
 * person pressed Send and is watching. Null still says nothing about why --
 * the client validates first, so a rejection here is a bug or a probe, and
 * neither is owed an explanation of which payloads are accepted.
 *
 * Rating is the only required field. Everything else is optional because a
 * one-tap rating from many people is worth more than a full form from few.
 */
export function parseFeedback(body: unknown): FeedbackRow | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const input = body as Record<string, unknown>

  const allowed = new Set([
    'session', 'device', 'product', 'rating', 'outcome', 'comment',
    'state', 'level', 'tests', 'score', 'total', 'release', 'lang',
  ])
  for (const key of Object.keys(input)) if (!allowed.has(key)) return null

  const session = input.session
  if (typeof session !== 'string' || !SESSION.test(session)) return null

  // The browser that paid, so `outcome` -- the only record of what happened at
  // the real licensing office -- can be read against a purchase in one step.
  // Optional and validated as the same id shape `devices` is keyed by, since
  // that is what it has to join to: a sender who has never bought anything has
  // one anyway, and a malformed one is dropped rather than stored.
  let device: string | null = null
  if (input.device !== undefined && input.device !== null) {
    if (typeof input.device !== 'string' || !SESSION.test(input.device)) return null
    device = input.device
  }

  if (!isInteger(input.rating, 1, MAX_RATING)) return null
  const rating = input.rating

  let outcome: Outcome | null = null
  if (input.outcome !== undefined && input.outcome !== null) {
    if (typeof input.outcome !== 'string') return null
    if (!(OUTCOMES as readonly string[]).includes(input.outcome)) return null
    outcome = input.outcome as Outcome
  }

  // Scrubbed before it is bounded, so a redaction near the end cannot push
  // real text past the limit and a truncated code cannot survive the scrub.
  let comment = ''
  if (input.comment !== undefined && input.comment !== null) {
    if (typeof input.comment !== 'string') return null
    comment = scrubComment(input.comment).trim().slice(0, COMMENT_LIMIT)
  }

  // Shaped, not checked against a list, for the same reason `state` is not:
  // a second product ships as data.
  let product: string | null = null
  if (input.product !== undefined && input.product !== null) {
    if (typeof input.product !== 'string' || !PRODUCT.test(input.product)) return null
    product = input.product
  }

  let state: string | null = null
  if (input.state !== undefined && input.state !== null) {
    if (typeof input.state !== 'string' || !STATE.test(input.state)) return null
    state = input.state
  }

  // The sender's own progress, as numbers. What makes a comment readable:
  // "too easy" from level 0 is a different report from "too easy" from a
  // Prepared user who passed the real thing.
  const numbers: Record<string, [unknown, number, number]> = {
    level: [input.level, 0, MAX_LEVEL],
    tests: [input.tests, 0, MAX_TESTS],
    score: [input.score, 0, MAX_QUESTIONS],
    total: [input.total, 1, MAX_QUESTIONS],
  }
  const parsed: Record<string, number | null> = {}
  for (const [key, [value, min, max]] of Object.entries(numbers)) {
    if (value === undefined || value === null) {
      parsed[key] = null
      continue
    }
    if (!isInteger(value, min, max)) return null
    parsed[key] = value
  }
  if (parsed.total !== null && parsed.score !== null && parsed.score > parsed.total) return null

  let release: string | null = null
  if (input.release !== undefined && input.release !== null) {
    if (typeof input.release !== 'string') return null
    if (!/^[A-Za-z0-9._-]+$/.test(input.release)) return null
    release = input.release.slice(0, RELEASE_LIMIT)
  }

  // One of the two values or absent, and nothing else: a language this app has
  // no screens in is not a fact about a comment, it is a probe.
  const lang = input.lang ?? null
  if (lang !== null && lang !== 'en' && lang !== 'es') return null

  return {
    lang,
    session,
    device,
    product,
    rating,
    outcome,
    comment,
    state,
    level: parsed.level,
    tests: parsed.tests,
    score: parsed.score,
    total: parsed.total,
    release,
  }
}

/**
 * One per session per hour.
 *
 * A public unauthenticated write that accepts free text is a spam target, and
 * there is no login to rate-limit against. The analytics id is the only handle
 * there is, so this is not proof against anyone determined -- it is what turns
 * a flood into a trickle without building auth for a comment box. Reads
 * `idx_feedback_session` and nothing else.
 */
export const RATE_LIMIT_MS = 3_600_000

export async function sentRecently(
  db: D1Database,
  session: string,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM feedback WHERE session = ? AND at > ?')
    .bind(session, now - RATE_LIMIT_MS)
    .first<{ c: number }>()
  return (row?.c ?? 0) > 0
}

/**
 * One row in one table. `purchases` and `devices` are not named in this file,
 * and never may be: the whole point of minting the analytics id separately is
 * that an opinion cannot be attached to a paying identity.
 */
export async function recordFeedback(
  db: D1Database,
  row: FeedbackRow,
  at: number,
  geo: EventGeo,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO feedback ' +
        '(at, session, device, product, rating, outcome, comment, state, level, tests, score, total, release, ' +
        'country, region, city, postal_code, timezone, as_org, lang) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      at,
      row.session,
      row.device,
      row.product,
      row.rating,
      row.outcome,
      row.comment,
      row.state,
      row.level,
      row.tests,
      row.score,
      row.total,
      row.release,
      geo.country,
      geo.region,
      geo.city,
      geo.postalCode,
      geo.timezone,
      geo.asOrganization,
      row.lang,
    )
    .run()
}

export interface ExamTally {
  passed: number
  failed: number
  not_yet: number
  /** Rated the app but did not answer the exam question. */
  unanswered: number
}

export interface FeedbackTally {
  ratings: Record<string, number>
  exam: ExamTally
}

export interface FeedbackStats extends FeedbackTally {
  count: number
  /**
   * How many rows have something written in them. A number that says there is
   * something to read without publishing a word of it -- the comments are read
   * with `npm run feedback`, which goes through an authenticated wrangler.
   */
  withComment: number
}

/** A product or state nobody has rated yet: zeroes, not a missing key. */
export function emptyTally(): FeedbackTally {
  return {
    ratings: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    exam: { passed: 0, failed: 0, not_yet: 0, unanswered: 0 },
  }
}

/**
 * Counts, and only counts.
 *
 * One grouped query whose SELECT list is a state code, a rating, an outcome
 * and two counts. `comment` appears once, inside a CASE that can only produce
 * 0 or 1: the endpoint that serves this is public, so what it cannot select it
 * cannot publish, and a scrubbing mistake stays a stored mistake rather than
 * becoming a published one.
 */
export async function computeFeedbackStats(
  db: D1Database,
  since: number,
): Promise<{
  overall: FeedbackStats
  byState: Record<string, FeedbackTally>
  byProduct: Record<string, FeedbackTally>
}> {
  const rows = await db
    .prepare(
      // COALESCE, not a backfill: every row written before the column existed
      // was written by the driving app, because it was the only app there was.
      // An UPDATE could only ever write that same constant, and would rewrite
      // history to do it.
      "SELECT state, COALESCE(product, 'drivers') AS product, rating, outcome, COUNT(*) AS c, " +
        "SUM(CASE WHEN comment IS NOT NULL AND comment <> '' THEN 1 ELSE 0 END) AS commented " +
        // COALESCE repeated, not `GROUP BY product`: SQLite resolves that name
        // to the real column, which would split the null rows into their own
        // group and then label it 'drivers' too.
        "FROM feedback WHERE at >= ? GROUP BY state, COALESCE(product, 'drivers'), rating, outcome",
    )
    .bind(since)
    .all<{
      state: string | null
      product: string
      rating: number
      outcome: string | null
      c: number
      commented: number | null
    }>()

  const overall: FeedbackStats = { count: 0, withComment: 0, ...emptyTally() }
  const byState: Record<string, FeedbackTally> = {}
  const byProduct: Record<string, FeedbackTally> = {}

  for (const row of rows.results) {
    const outcome: keyof ExamTally =
      row.outcome === 'passed' || row.outcome === 'failed' || row.outcome === 'not_yet'
        ? row.outcome
        : 'unanswered'
    const rating = String(row.rating)

    overall.count += row.c
    overall.withComment += row.commented ?? 0
    if (rating in overall.ratings) overall.ratings[rating] += row.c
    overall.exam[outcome] += row.c

    const product = (byProduct[row.product] ??= emptyTally())
    if (rating in product.ratings) product.ratings[rating] += row.c
    product.exam[outcome] += row.c

    if (row.state === null) continue
    const stats = (byState[row.state] ??= emptyTally())
    if (rating in stats.ratings) stats.ratings[rating] += row.c
    stats.exam[outcome] += row.c
  }
  return { overall, byState, byProduct }
}
