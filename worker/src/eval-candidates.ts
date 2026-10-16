/**
 * The labelling queue's one writer (docs/plans/eval-lifecycle-build.md,
 * decision 6a). A thumbs-down adds a question here today; the nightly sampler
 * will add through the same function, so neither can queue what the other
 * already has.
 *
 * The rule (Joel, 2026-10-15): the same question never appears twice as a
 * candidate. Ten learners asking Florida's hydrant question would otherwise be
 * ten rows to label, nine of them wasted, and labelled twice it becomes two
 * cases in the fixture, one question scored double. "The same" is
 * `questionKey` under the same state: Maryland's hydrant question and
 * Florida's are two questions, because the right law differs.
 */

/**
 * The part of D1 the queue and the nightly jobs use: a statement, its bound
 * values, and a batch -- nothing workerd adds beyond that. Typed this narrowly
 * so the same functions can be driven over a past day from a Node script
 * through an adapter onto the D1 REST API, rather than a second copy of the
 * SQL being written for the script and drifting from the one the cron runs.
 */
export interface D1Like {
  prepare(sql: string): D1LikeStatement
  batch(statements: D1LikeStatement[]): Promise<unknown[]>
}

export interface D1LikeStatement {
  bind(...values: unknown[]): D1LikeStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results?: T[] }>
  run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>
}

/**
 * A question as the queue and the fixture compare it: lower-cased, trimmed,
 * whitespace collapsed and one trailing `?`, `.` or `!` dropped. "How far from
 * a fire hydrant can I park?" and "how far from a fire hydrant can i park" are
 * one question. Exported for the scripts that validate and promote cases, so
 * all three mean the same thing by a duplicate.
 */
export function questionKey(question: string): string {
  return question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?.!]$/, '').trim()
}

/**
 * Queue `questionId`, unless a candidate of any status -- open, labelled or
 * skipped -- already holds the same question under the same state. Throws for
 * an id with no question: the callers have just read the row, and a candidate
 * pointing at nothing is a queue entry nobody can open.
 */
export async function addCandidate(db: D1Like, questionId: number, reason: string, now: number): Promise<'added' | 'duplicate'> {
  const row = await db
    .prepare('SELECT question, state FROM learner_questions WHERE id = ?')
    .bind(questionId)
    .first<{ question: string; state: string | null }>()
  if (row === null) throw new Error(`no learner question ${questionId} to add as a candidate`)
  // In code rather than SQL: SQLite has no regex, and the key's collapse of
  // whitespace and trailing punctuation would be a second definition of it.
  // The queue under one state is tens of rows a night, not a scan to fear.
  const queued = await db
    .prepare(
      `SELECT q.question FROM eval_candidates c JOIN learner_questions q ON q.id = c.question_id
        WHERE q.state IS ?`,
    )
    .bind(row.state)
    .all<{ question: string }>()
  const key = questionKey(row.question)
  if ((queued.results ?? []).some((each) => questionKey(each.question) === key)) return 'duplicate'
  const written = await db
    .prepare(`INSERT OR IGNORE INTO eval_candidates (question_id, sampled_at, reason) VALUES (?, ?, ?)`)
    .bind(questionId, now, reason)
    .run()
  return (written.meta.changes ?? 0) > 0 ? 'added' : 'duplicate'
}
