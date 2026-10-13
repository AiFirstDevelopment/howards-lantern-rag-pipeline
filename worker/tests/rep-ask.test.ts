import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
// The document itself, so "byte for byte" is checked against the file somebody
// edits rather than against the JSON built from it.
import REP_KNOWLEDGE_BASE from '../src/rep-knowledge-base.md?raw'
import {
  MAX_QUESTION_CHARS,
  NO_MATCH,
  PARTNER_CONTACT_EMAIL,
  PUBLIC_DAILY_QUESTIONS,
  QUESTION_RETENTION_SECONDS,
  REP_ENTRIES,
  type AskRequest,
  type Asker,
} from '../src/ask'
import type { MeshAsker, MeshRequest } from '../src/mesh-ask'
import { handlePartnersAsk, handleRepsAsk, type PartnerDeps } from '../src/partner-api'
import { PARTNER_NOW as NOW, applySchema, partnerDeps } from './harness'

/**
 * The sales-rep box, and the one property it exists to keep: **a rep is
 * answered from the rep's file and nothing else, and a partner prospect never
 * from the rep's.** A partner's 50% served to somebody deciding whether to
 * become a rep looks exactly like an answer, which is why every test below
 * drives a router that names the wrong file on purpose.
 */
beforeEach(applySchema)

const THREAD = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

function router(...ids: string[]): { ask: Asker; calls: AskRequest[] } {
  const calls: AskRequest[] = []
  let next = 0
  return {
    calls,
    ask: async (request) => {
      calls.push(request)
      const id = ids[Math.min(next, ids.length - 1)] ?? NO_MATCH
      next += 1
      return { id, model: 'stub' }
    },
  }
}

/** A mesh that counts what it is asked and answers nothing. */
function mesh(): { askMesh: MeshAsker; calls: MeshRequest[] } {
  const calls: MeshRequest[] = []
  return {
    calls,
    askMesh: async (request) => {
      calls.push(request)
      return { written: [], live: [], unavailable: [], model: 'stub-mesh' }
    },
  }
}

interface Answered {
  id: string
  answer?: string
  cite?: string | null
  citeUrl?: string | null
  contact?: string
  error?: string
}

type Handler = typeof handleRepsAsk

async function post(
  handler: Handler,
  path: string,
  body: unknown,
  injected: PartnerDeps,
): Promise<{ status: number; body: Answered }> {
  const response = await handler(
    new Request(`https://api.test${path}`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }),
    env.DB,
    {},
    injected,
  )
  return { status: response.status, body: (await response.json()) as Answered }
}

const askRep = (body: unknown, injected: PartnerDeps) =>
  post(handleRepsAsk, '/api/sales-rep/ask', body, injected)
const askPartners = (body: unknown, injected: PartnerDeps) =>
  post(handlePartnersAsk, '/api/partners/ask', body, injected)

const first = (question: string) => ({ conversation: THREAD, question, turnstile: 'good-token' })

async function logged(): Promise<{ partner_id: number | null; entry_id: string | null; question: string }[]> {
  const rows = await env.DB.prepare(
    'SELECT partner_id, entry_id, question FROM partner_questions ORDER BY id',
  ).all<{ partner_id: number | null; entry_id: string | null; question: string }>()
  return rows.results ?? []
}

describe('the rep box answers from the rep file, and only from it', () => {
  // Guard 6. The partner's own pitch, served to a prospective rep, would quote
  // them a 50% they will never be paid.
  it('refuses a partner entry the router names, and gives the address instead', async () => {
    const answered = await askRep(first('what would I earn?'), partnerDeps({ ask: router('join-offer').ask }))

    expect(answered.status).toBe(200)
    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(JSON.stringify(answered.body)).not.toContain('50%')
  })

  // Guard 7. The mirror: a school asking the partner box is never quoted a
  // rep's 15% as though it were theirs.
  it('keeps a rep entry out of the partner box', async () => {
    const answered = await askPartners(first('what would I earn?'), partnerDeps({ ask: router('rep-earning').ask }))

    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(JSON.stringify(answered.body)).not.toContain('15%')
  })

  // Guard 9. The router is offered the rep list; offered the partner one it
  // would choose among answers the rep box then refuses, every time.
  it('offers the router the rep list', async () => {
    const { ask, calls } = router('rep-earning')

    await askRep(first('what would I earn?'), partnerDeps({ ask }))

    expect(calls.map((call) => call.audience)).toEqual(['rep'])
  })

  // Guard 10. What a rep reads is the file, byte for byte, under a citation
  // that opens their agreement rather than a partner's -- whose §4 is a
  // different commission.
  it('serves the entry verbatim, citing the sales rep agreement', async () => {
    const answered = await askRep(first('what would I earn?'), partnerDeps({ ask: router('rep-earning').ask }))
    const written = REP_ENTRIES.find((entry) => entry.id === 'rep-earning')

    expect(answered.body.id).toBe('rep-earning')
    expect(answered.body.answer).toBe(written?.answer)
    expect(REP_KNOWLEDGE_BASE).toContain(answered.body.answer)
    expect(answered.body.cite).toBe('Sales rep agreement §4.')
    expect(answered.body.citeUrl).toBe('/sales-rep/agreement')
  })
})

describe('a rep question never reaches the mesh', () => {
  // Guard 8. The mesh serves the six partner domains; a rep question sent
  // there could only come back as a partner's answer or none.
  it('asks the direct router for a rep, and the mesh for a partner prospect', async () => {
    const direct = router('rep-earning')
    const meshed = mesh()
    const deps = partnerDeps({ ask: direct.ask, askMesh: meshed.askMesh })

    await askRep(first('what would I earn?'), deps)

    expect(direct.calls).toHaveLength(1)
    expect(meshed.calls).toHaveLength(0)

    await askPartners(
      { conversation: '8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', question: 'what does it cost?', turnstile: 'good-token' },
      deps,
    )

    expect(meshed.calls).toHaveLength(1)
  })
})

describe('the rep route has the public route’s limits', () => {
  // Guard 16, the challenge. A script pays for a solve before it costs a model
  // call, on this box as on the partner one.
  it('refuses a first question whose challenge did not pass, with the address', async () => {
    const { ask, calls } = router('rep-earning')

    const answered = await askRep(
      { conversation: THREAD, question: 'what would I earn?', turnstile: 'forged' },
      partnerDeps({ ask }),
    )

    expect(answered.status).toBe(400)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(calls).toEqual([])
  })

  // Guard 16, the pool. The day's public budget spent entirely by the partner
  // box stops the rep box too: one number bounds what the public may cost.
  it('shares the partner box’s daily ceiling, and asks nothing past it', async () => {
    await env.DB.batch(
      Array.from({ length: PUBLIC_DAILY_QUESTIONS }, (_unused, i) =>
        env.DB.prepare(
          `INSERT INTO partner_questions
             (partner_id, conversation, turn, asked_at, question, entry_id, model)
           VALUES (NULL, ?, 1, ?, 'earlier', 'join-cost', 'stub')`,
        ).bind(`${i}`, NOW - 60),
      ),
    )
    const { ask, calls } = router('rep-earning')

    const answered = await askRep(first('what would I earn?'), partnerDeps({ ask }))

    expect(answered.status).toBe(200)
    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(calls).toEqual([])
  })

  it('refuses a question longer than the cap without asking', async () => {
    const { ask, calls } = router('rep-earning')

    const answered = await askRep(first('x'.repeat(MAX_QUESTION_CHARS + 1)), partnerDeps({ ask }))

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('refuses an eleventh turn without asking', async () => {
    for (let turn = 1; turn <= 10; turn += 1) {
      await env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (NULL, ?, ?, ?, ?, 'rep-earning', 'stub')`,
      )
        .bind(THREAD, turn, NOW - 60, `question ${turn}`)
        .run()
    }
    const { ask, calls } = router('rep-earning')

    const answered = await askRep({ conversation: THREAD, question: 'and another?' }, partnerDeps({ ask }))

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
  })

  // Guard 17. The unmatched and matched questions are the only record of what
  // a prospective rep wanted to know; a rep question logged against nobody's
  // id and told apart by its `rep-` entry is what the plan's log reading rests on.
  it('writes the question down against nobody, under the rep entry that answered it', async () => {
    await askRep(first('what would I earn?'), partnerDeps({ ask: router('rep-earning').ask }))

    expect(await logged()).toEqual([
      { partner_id: null, entry_id: 'rep-earning', question: 'what would I earn?' },
    ])
  })

  it('forgets a rep question once the promised window has passed', async () => {
    await env.DB.prepare(
      `INSERT INTO partner_questions
         (partner_id, conversation, turn, asked_at, question, entry_id, model)
       VALUES (NULL, 'ancient', 1, ?, 'asked long ago', 'rep-earning', 'stub')`,
    )
      .bind(NOW - QUESTION_RETENTION_SECONDS - 1)
      .run()

    await askRep(first('what would I earn?'), partnerDeps({ ask: router('rep-earning').ask }))

    expect((await logged()).map((row) => row.question)).toEqual(['what would I earn?'])
  })

  // The route itself, through the router a browser reaches. An undeployed or
  // unrouted endpoint 404s while every old one keeps working.
  it('is routed, and refuses a body with no conversation rather than 404ing', async () => {
    const response = await SELF.fetch('https://api.test/api/sales-rep/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(400)
  })
})
