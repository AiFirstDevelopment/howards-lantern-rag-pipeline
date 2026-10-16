import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addCandidate, questionKey } from '../src/eval-candidates'
import { PARTNER_NOW as NOW, applySchema } from './harness'

/**
 * The labelling queue holds a question once (docs/plans/eval-lifecycle-build.md,
 * decision 6a; Joel, 2026-10-15). Ten learners asking Florida's hydrant
 * question would otherwise be ten rows to label, nine of them wasted -- and
 * labelled twice, one question counted twice in every score. Driven through
 * the route a thumbs-down takes, since that is the writer that exists today.
 */
beforeEach(applySchema)

const THREAD = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

async function asked(question: string, state: string | null, turn: number): Promise<number> {
  const written = await env.DB.prepare(
    `INSERT INTO learner_questions (conversation, turn, asked_at, lang, state, question, answer, scope, sources, model)
     VALUES (?, ?, ?, 'en', ?, ?, 'At least 15 feet.', 'road-law', '[]', 'stub')`,
  )
    .bind(THREAD, turn, NOW, state, question)
    .run()
  return Number(written.meta.last_row_id)
}

const thumbsDown = (questionId: number) =>
  SELF.fetch('https://api.test/api/ask/rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation: THREAD, questionId, rating: -1 }),
  })

const queued = async () =>
  ((await env.DB.prepare('SELECT question_id FROM eval_candidates ORDER BY question_id').all<{ question_id: number }>()).results ?? []).map(
    (row) => row.question_id,
  )

describe('a question is a candidate once', () => {
  // Criterion 5a and guard 5a.
  it('queues the hydrant question once under Maryland however it is cased or punctuated, and again under Florida', async () => {
    const first = await asked('how far from a fire hydrant can i park', 'MD', 1)
    const again = await asked('How far from a fire  hydrant can I park?', 'MD', 2)
    const florida = await asked('How far from a fire hydrant can I park?', 'FL', 3)

    expect((await thumbsDown(first)).status).toBe(204)
    expect((await thumbsDown(again)).status).toBe(204)
    expect((await thumbsDown(florida)).status).toBe(204)

    expect(await queued()).toEqual([first, florida])
    // The rating is still kept: only the queue refuses the repeat.
    const rated = await env.DB.prepare('SELECT COUNT(*) AS c FROM answer_ratings').first<{ c: number }>()
    expect(rated?.c).toBe(3)
  })

  it('refuses a repeat of a question already labelled or skipped, not only an open one', async () => {
    const first = await asked('can i turn right on red', 'MD', 1)
    expect(await addCandidate(env.DB, first, 'rated_down', NOW)).toBe('added')
    await env.DB.prepare(`UPDATE eval_candidates SET status = 'skipped'`).run()
    const again = await asked('Can I turn right on red?', 'MD', 2)
    expect(await addCandidate(env.DB, again, 'rated_down', NOW)).toBe('duplicate')
    expect(await addCandidate(env.DB, first, 'rated_down', NOW)).toBe('duplicate')
    expect(await queued()).toEqual([first])
  })

  it('treats the book’s questions, asked with no state, as one state of their own', async () => {
    const book = await asked('how many devices', null, 1)
    const maryland = await asked('how many devices?', 'MD', 2)
    expect(await addCandidate(env.DB, book, 'rated_down', NOW)).toBe('added')
    expect(await addCandidate(env.DB, maryland, 'rated_down', NOW)).toBe('added')
  })
})

describe('questionKey', () => {
  it('lower-cases, trims, collapses whitespace and drops one trailing ? . or !', () => {
    expect(questionKey('  How far   from a Hydrant?  ')).toBe('how far from a hydrant')
    expect(questionKey('Stop!')).toBe('stop')
    expect(questionKey('15 ft.')).toBe('15 ft')
    // Punctuation inside the question is the learner's and stays.
    expect(questionKey('Is 0.08 the limit?')).toBe('is 0.08 the limit')
  })
})
