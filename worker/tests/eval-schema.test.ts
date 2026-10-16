import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import schema from '../schema.sql?raw'
import { applySchema } from './harness'

/**
 * The eval lifecycle's phase 0 is a schema and nothing else
 * (docs/plans/eval-lifecycle-build.md, decisions 1-2), and it reaches
 * production in two different ways that can each fail on their own.
 *
 * Every test database is built from `schema.sql` whole, so a table every later
 * phase writes has to come out of that. Production is not: it already holds
 * every statement above the block, and Joel applies the block alone, by hand,
 * with one `wrangler d1 execute`. A block that only works on an empty database
 * -- a column added twice, a statement leaning on something written after it --
 * passes every test here and fails halfway through on production, where
 * SQLite has no ADD COLUMN IF NOT EXISTS and the half that ran cannot be run
 * again. So both are driven against a real D1.
 */

const MARKER = '-- The eval lifecycle, phase 0'

/** Split SQL text into statements exactly as the harness does. */
const statementsOf = (sql: string) =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const at = schema.indexOf(MARKER)
/** What production holds today: every statement above the block. */
const today = schema.slice(0, at)
/** What Joel runs by hand: the block, and only the block. */
const block = schema.slice(at)

/** Decision 1, retyped on purpose: the plan is the spec the file is checked against. */
const EXPECTED: Record<string, string[]> = {
  learner_questions: ['latency_ms', 'tokens_in', 'tokens_out', 'trace'],
  answer_ratings: ['question_id', 'rating', 'rated_at'],
  eval_candidates: ['question_id', 'sampled_at', 'reason', 'status'],
  eval_labels: [
    'question_id', 'labelled_at', 'verdict', 'contains', 'not_contains', 'gold', 'holdout',
    'promoted_at',
  ],
  answer_scores: [
    'question_id', 'scored_at', 'faithful', 'relevant', 'judge_model', 'judge_agreement',
  ],
  ask_daily: [
    'day', 'asked', 'shown', 'refused', 'reasons', 'faithful_rate', 'relevant_rate', 'rated_up',
    'rated_down', 'p50_latency_ms', 'p95_latency_ms', 'tokens_in', 'tokens_out', 'cost_usd',
  ],
  eval_runs: [
    'id', 'ran_at', 'trigger', 'commit_sha', 'prompt_sha', 'corpus_hash', 'cases', 'right',
    'recall', 'mrr', 'rerank_survival', 'widening', 'generation', 'refusal_precision',
    'refusal_recall', 'judge_agreement', 'cost_usd',
  ],
  eval_results: ['run_id', 'case_no', 'stage', 'ok', 'reasons', 'shown'],
}

async function columnsOf(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`)
    .bind(table)
    .all<{ name: string }>()
  return results.map((r) => r.name)
}

async function expectEveryEvalColumn(): Promise<void> {
  for (const [table, columns] of Object.entries(EXPECTED)) {
    expect(await columnsOf(table), table).toEqual(expect.arrayContaining(columns))
  }
  const index = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_eval_candidates_status'`,
  ).first()
  expect(index, 'idx_eval_candidates_status').not.toBeNull()
}

describe('the eval lifecycle schema', () => {
  it('is found in schema.sql as one block at the end, so the hand-applied statements are exactly the new ones', () => {
    expect(at, `schema.sql no longer carries "${MARKER}"`).toBeGreaterThan(0)
    expect(statementsOf(block)).toHaveLength(12)
  })

  it('creates every table and column a later phase writes when schema.sql is applied whole to an empty database', async () => {
    await applySchema()
    await expectEveryEvalColumn()
  })

  it('applies as the new statements alone to a database already at the schema production holds today', async () => {
    await env.DB.batch(statementsOf(today).map((s) => env.DB.prepare(s)))
    expect(await columnsOf('learner_questions')).not.toContain('trace')

    await env.DB.batch(statementsOf(block).map((s) => env.DB.prepare(s)))
    await expectEveryEvalColumn()
  })

  it('keeps a question row writable with the new columns left empty, so the worker live today still answers', async () => {
    await env.DB.batch(statementsOf(today).map((s) => env.DB.prepare(s)))
    await env.DB.batch(statementsOf(block).map((s) => env.DB.prepare(s)))
    const { results } = await env.DB.prepare(`SELECT name, "notnull" AS required, dflt_value AS fallback
       FROM pragma_table_info('learner_questions')
       WHERE name IN ('latency_ms', 'tokens_in', 'tokens_out', 'trace')`).all<{
      name: string
      required: number
      fallback: unknown
    }>()
    expect(results).toHaveLength(4)
    for (const column of results) expect(column.required, column.name).toBe(0)
  })
})
