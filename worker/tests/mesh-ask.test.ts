import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handlePartner, handlePartnersAsk } from '../src/partner-api'
import { NO_MATCH, PARTNER_CONTACT_EMAIL } from '../src/ask'
import { meshAskerFor, meshEnabled, type MeshAsker, type MeshReply } from '../src/mesh-ask'
import { parseKnowledgeBase } from '../src/kb/rules'
import { applySchema, PARTNER_NOW, SESSION, partnerDeps, seedPartner } from './harness'
import { KNOWLEDGE_MARKDOWN, seedKnowledge } from './mesh'
import { forgetLiveEntries, liveEntryFor } from '../src/live-entries'
import { splitKnowledgeBase } from '../src/kb/split'
import { startSession } from '../src/partners'

/** The joining object exactly as `npm run kb:push` writes it. */
const KNOWLEDGE_JOINING = splitKnowledgeBase(
  KNOWLEDGE_MARKDOWN,
  'worker/src/knowledge-base.md',
).find((split) => split.domain === 'joining')!.markdown

/**
 * The seam, from the route that a browser actually calls.
 *
 * AC20 is the criterion this whole change is weighed on: with `ASK_VIA_MESH`
 * unset, `/api/partners/ask` and `/api/partner/ask` behave exactly as they do
 * today. Everything else here can be rebuilt; a silent change to what a
 * prospective partner is told cannot be taken back.
 */

const CONVERSATION = '11111111-2222-4333-8444-555555555556'

const ENTRIES = parseKnowledgeBase(KNOWLEDGE_MARKDOWN)

function entry(id: string) {
  const found = ENTRIES.find((each) => each.id === id)
  if (found === undefined) throw new Error(`no such entry: ${id}`)
  return found
}

/** A mesh that answers with whatever the test says, and records what it was asked. */
function meshAnswering(reply: Partial<MeshReply>): { asker: MeshAsker; seen: unknown[] } {
  const seen: unknown[] = []
  return {
    seen,
    asker: async (request) => {
      seen.push(request)
      return { written: [], live: [], unavailable: [], model: 'test-mesh', ...reply }
    },
  }
}

async function askPublic(deps: ReturnType<typeof partnerDeps>, question: string): Promise<Response> {
  return await handlePartnersAsk(
    new Request('https://api.test/api/partners/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: CONVERSATION, question, turnstile: 'good-token' }),
    }),
    env.DB,
    {},
    deps,
  )
}

beforeEach(async () => {
  await applySchema()
})

describe('the flag decides which path answers, and its default is the old one', () => {
  /**
   * The dependency is absent rather than the condition being false, which is
   * why no handler in `partner-api.ts` branches on a flag: there is nothing to
   * forget to check.
   */
  it('builds no mesh asker when the flag is unset, empty, or false', () => {
    for (const flag of [undefined, '', 'false', '0', 'no']) {
      expect(meshEnabled(flag), String(flag)).toBe(false)
      expect(
        meshAskerFor({ enabled: flag, privateKey: 'x', coarse: {} as Fetcher, now: () => 0 }),
      ).toBeUndefined()
    }
  })

  it('builds one when the flag is on, and only when the coarse server is bound', () => {
    expect(meshEnabled('1')).toBe(true)
    expect(
      meshAskerFor({ enabled: '1', privateKey: 'x', coarse: undefined, now: () => 0 }),
      'a flag with no binding must be the old path, not a broken box',
    ).toBeUndefined()
    expect(
      meshAskerFor({ enabled: 'true', privateKey: 'x', coarse: {} as Fetcher, now: () => 0 }),
    ).toBeDefined()
  })

  /**
   * AC20. The same route, the same body, the same answer -- and the mesh is
   * never consulted, because there is nothing to consult.
   */
  it('answers from the compiled knowledge base with the flag off, and asks no mesh', async () => {
    // The asker is built the way production builds it -- from the flag -- and
    // handed to the route whatever it turns out to be. This used to construct a
    // recorder, never pass it in, and assert the unused local was empty: a line
    // that could not fail. Here the coarse binding is real enough to record a
    // call, so "asks no mesh" is a claim about the code under test.
    const calls: string[] = []
    const coarse = {
      fetch: async () => {
        calls.push('asked')
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
      },
    } as unknown as Fetcher
    const deps = partnerDeps({
      ask: async () => ({ id: 'join-cost', model: 'test' }),
      askMesh: meshAskerFor({
        enabled: undefined,
        privateKey: 'x',
        coarse,
        now: () => PARTNER_NOW,
      }),
    })
    const response = await askPublic(deps, 'what does it cost to join')
    const body = (await response.json()) as { id: string; answer: string }
    expect(body.id).toBe('join-cost')
    expect(body.answer).toBe(entry('join-cost').answer)
    expect(calls, 'the flag was off and the mesh was asked anyway').toEqual([])
  })
})

describe('the same box, answered through the mesh', () => {
  it('shows the written answer the mesh returned, unedited', async () => {
    const written = entry('join-cost')
    const mesh = meshAnswering({
      written: [
        { id: written.id, answer: written.answer, cite: written.cite, audience: 'anyone' },
      ],
    })
    const deps = partnerDeps({ askMesh: mesh.asker })
    const response = await askPublic(deps, 'what does it cost to join')
    const body = (await response.json()) as { id: string; answer: string; citeUrl: string }
    expect(body.id).toBe('join-cost')
    expect(body.answer).toBe(written.answer)
    expect(body.citeUrl).toBe('/partners/agreement')
  })

  /**
   * AC5, at the last hop. The whole aggregate-don't-route decision is worth
   * nothing if the second answer is dropped between the coarse server and the
   * screen.
   */
  it('carries the second answer of a two-domain question all the way out', async () => {
    const first = entry('refund-after-payment')
    const second = entry('paid-triggers')
    const mesh = meshAnswering({
      written: [
        { id: first.id, answer: first.answer, cite: first.cite, audience: 'anyone' },
        { id: second.id, answer: second.answer, cite: second.cite, audience: 'anyone' },
      ],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'refund after payment')
    const body = (await response.json()) as {
      id: string
      also: { id: string; answer: string }[]
    }
    expect(body.id).toBe('refund-after-payment')
    expect(body.also.map((each) => each.id)).toEqual(['paid-triggers'])
    expect(body.also[0].answer).toBe(second.answer)
  })

  /**
   * The second, independent no on the audience split -- in the worker that
   * knows who is asking from a session rather than from a claim. The fine
   * server already refuses to load an account entry into a policy-only
   * candidate set; if one somehow came back anyway, it does not reach a
   * stranger.
   */
  it('refuses to show a stranger an entry their audience may not see, whatever the mesh returned', async () => {
    const account = entry('account-session')
    const mesh = meshAnswering({
      written: [
        { id: account.id, answer: account.answer, cite: account.cite, audience: 'partner' },
      ],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'how long is a session')
    const body = (await response.json()) as { id: string; answer?: string; contact?: string }
    expect(body.id).toBe(NO_MATCH)
    expect(body.answer).toBeUndefined()
    expect(body.contact).toBe(PARTNER_CONTACT_EMAIL)
  })

  it('names a domain the mesh could not reach rather than letting half an answer pass for whole', async () => {
    const written = entry('join-cost')
    const mesh = meshAnswering({
      written: [{ id: written.id, answer: written.answer, cite: written.cite, audience: 'anyone' }],
      unavailable: ['refunds'],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'cost and refunds')
    const body = (await response.json()) as { unavailable: string[] }
    expect(body.unavailable).toEqual(['refunds'])
  })

  /**
   * Every failure lands on a person. A mesh that could not be reached is not
   * the same as a mesh that had no answer, and both end in the same place --
   * but `partner_questions.model` tells them apart afterwards, which is the
   * only way a run of outages can be distinguished from a run of no-matches.
   */
  it('answers with the contact address when the mesh cannot be reached, and records why', async () => {
    const deps = partnerDeps({ askMesh: async () => null })
    const response = await askPublic(deps, 'anything at all')
    const body = (await response.json()) as { id: string; contact: string }
    expect(body.id).toBe(NO_MATCH)
    expect(body.contact).toBe(PARTNER_CONTACT_EMAIL)

    const row = await env.DB.prepare('SELECT model, entry_id FROM partner_questions').first<{
      model: string
      entry_id: string | null
    }>()
    expect(row?.model).toBe('mesh-unreachable')
    expect(row?.entry_id).toBeNull()
  })

  /**
   * The seam that turns a live tool's JSON into what a partner reads, executed
   * rather than assumed.
   *
   * `figuresFrom`/`linesOf` had no test at all: no worker test ever put
   * anything in `MeshReply.live`, the coarse tests stop one hop earlier at
   * `reply.live[0].data`, and the e2e fixture hand-writes the exact `lines` it
   * then asserts -- so the only code that decides what a partner is shown about
   * their own money was never run by the suite.
   *
   * These pinned what it did before the flag went on -- cent integers under
   * their raw field names, and an array of ledger rows flattened into one
   * undelimited list -- and said what must not happen is either of them
   * changing without a test noticing. This is that change, noticed: escalation
   * 2 in docs/work/ask-mcp-mesh/verdict.md, settled on 2026-09-14.
   *
   * A tool that writes its own lines is taken at its word. A tool that does not
   * still gets the scalar fallback, because that path is what every future tool
   * will hit on the day somebody forgets.
   */
  it('renders a live tool’s own lines verbatim, and falls back to scalars for a tool that writes none', async () => {
    const mesh = meshAnswering({
      written: [
        {
          id: 'join-cost',
          answer: entry('join-cost').answer,
          cite: entry('join-cost').cite,
          audience: 'anyone',
        },
      ],
      live: [
        {
          tool: 'payout_status',
          data: {
            lines: [
              '$20.00 payable now',
              '$30.00 short of the $50.00 payout floor',
              'under the $50 threshold; rolls to the next run',
            ],
          },
        },
        {
          // No `lines`: the fallback, which is what a tool written next year
          // gets on the day somebody forgets.
          tool: 'code_status',
          data: { redemptions: 4 },
        },
      ],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'why was I not paid')
    const body = (await response.json()) as { figures?: { tool: string; lines: string[] }[] }

    expect(body.figures?.length).toBe(2)
    expect(body.figures![0].tool).toBe('payout_status')
    // Money as a partner reads it, and the shortfall rather than the floor --
    // "under the $50 threshold" is the rule, "$30.00 short" is the answer.
    expect(body.figures![0].lines).toEqual([
      '$20.00 payable now',
      '$30.00 short of the $50.00 payout floor',
      'under the $50 threshold; rolls to the next run',
    ])
    // Nothing reaches a partner as a field name and a cent integer any more.
    expect(body.figures![0].lines.join(' ')).not.toMatch(/Cents:|payableCents/)
    // And the untouched fallback, still doing what it always did.
    expect(body.figures![1].lines).toContain('redemptions: 4')
  })

  /**
   * A ledger keeps its row boundaries now.
   *
   * It used to be flattened key by key with every boundary dropped, so a
   * hundred rows arrived as one undelimited list in which no amount belonged to
   * any sale. `commission_ledger` writes its own lines, one per row, for the
   * same reason `payout_status` does: the tool knows which number is money and
   * which is a date, and the renderer cannot.
   */
  it('keeps a ledger’s rows apart, one line each', async () => {
    const mesh = meshAnswering({
      written: [
        {
          id: 'join-cost',
          answer: entry('join-cost').answer,
          cite: entry('join-cost').cite,
          audience: 'anyone',
        },
      ],
      live: [
        {
          tool: 'commission_ledger',
          data: {
            lines: [
              'September 2, 2026: $9.80 on $49.00 at 20% — clears October 2, 2026',
              'September 1, 2026: -$9.80 on $49.00 at 20% — paid',
            ],
          },
        },
      ],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'show me my commissions')
    const body = (await response.json()) as {
      id: string
      figures?: { tool: string; lines: string[] }[]
    }

    expect(body.figures![0].lines).toHaveLength(2)
    expect(body.figures![0].lines[0]).toBe(
      'September 2, 2026: $9.80 on $49.00 at 20% — clears October 2, 2026',
    )
  })

  /**
   * `figures` rides on an answer, so a question that matches no written entry
   * is shown none of them. Worth pinning on its own: it is the reason the case
   * above carries a written answer it does not otherwise need.
   */
  it('shows no figures at all when nothing written matched', async () => {
    const mesh = meshAnswering({
      written: [],
      live: [{ tool: 'commission_ledger', data: { lines: ['September 2, 2026: $9.80'] } }],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'show me my commissions')
    const body = (await response.json()) as { id: string; figures?: unknown }

    expect(body.id).toBe('no-match')
    expect(body.figures).toBeUndefined()
  })

  it('carries a ledger’s rows into the answer when a written entry came with them', async () => {
    const written = entry('join-cost')
    const mesh = meshAnswering({
      written: [
        { id: written.id, answer: written.answer, cite: written.cite, audience: 'anyone' },
      ],
      live: [
        {
          tool: 'commission_ledger',
          data: { entries: [{ id: 42, kind: 'direct', amountCents: 980 }] },
        },
      ],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'show me my commissions')
    const body = (await response.json()) as { figures?: { tool: string; lines: string[] }[] }
    // The row's own key is dropped and each field becomes its own line: there
    // is no row boundary in the output, which is exactly the follow-up.
    expect(body.figures![0].lines).toEqual(['id: 42', 'kind: direct', 'amountCents: 980'])
  })

  it('writes down which entry the mesh chose, and which model chose it', async () => {
    const written = entry('join-cost')
    const mesh = meshAnswering({
      written: [{ id: written.id, answer: written.answer, cite: written.cite, audience: 'anyone' }],
    })
    await askPublic(partnerDeps({ askMesh: mesh.asker }), 'what does it cost')
    const row = await env.DB.prepare('SELECT model, entry_id FROM partner_questions').first<{
      model: string
      entry_id: string
    }>()
    expect(row).toEqual({ model: 'test-mesh', entry_id: 'join-cost' })
  })
})

describe('what the mesh is told about who is asking', () => {
  it('sends no partner id and no status but anonymous for a stranger', async () => {
    const mesh = meshAnswering({})
    await askPublic(partnerDeps({ askMesh: mesh.asker }), 'anything')
    expect(mesh.seen[0]).toMatchObject({
      audience: 'anyone',
      principal: { partnerId: null, status: 'anonymous' },
    })
  })

  /**
   * AC10 from the route's side: the status the token's scopes are derived from
   * is read off the session row, so a `pending` partner -- who holds a session
   * minutes after applying -- is carried into the mesh as `pending` and gets no
   * `read:own-money` anywhere downstream.
   */
  it('sends a signed-in partner’s own id and their real status, not an assumed one', async () => {
    const partnerId = await seedPartner({ email: 'pending@example.test', status: 'pending' })
    await startSession(env.DB, partnerId, PARTNER_NOW, null, SESSION)
    const mesh = meshAnswering({})

    await handlePartner(
      new Request('https://api.test/api/partner/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Partner': '1',
          Cookie: `hl_partner=${SESSION}`,
        },
        body: JSON.stringify({ conversation: CONVERSATION, question: 'why no payment' }),
      }),
      env.DB,
      new URL('https://api.test/api/partner/ask'),
      {},
      partnerDeps({ askMesh: mesh.asker }),
    )
    expect(mesh.seen[0]).toMatchObject({
      audience: 'partner',
      principal: { partnerId, status: 'pending' },
    })
  })

  /**
   * The token is minted server-side and never leaves it. Nothing in the
   * response, and nothing a browser could read, carries one.
   */
  it('puts no token in anything the browser receives', async () => {
    const written = entry('join-cost')
    const mesh = meshAnswering({
      written: [{ id: written.id, answer: written.answer, cite: written.cite, audience: 'anyone' }],
    })
    const response = await askPublic(partnerDeps({ askMesh: mesh.asker }), 'cost')
    const text = await response.text()
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('eyJ')
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})

/**
 * An entry added through the editor, reaching an asker before the next deploy.
 *
 * This was escalation 1 in docs/work/ask-mcp-mesh/verdict.md and the sharpest
 * thing wrong with the mesh: the last-hop audience check resolved against
 * `knowledge-base.json`, compiled at build time, so an entry an operator *added*
 * at /admin passed the write gate, was written to R2, was served by the fine
 * server -- and was dropped at the final step. The asker got the contact address
 * for a question that now had a written answer, and the same happened to a
 * corrected `## ` heading.
 *
 * The check is still a check. It re-derives the audience from the bytes in the
 * bucket rather than believing the `audience` the mesh reported, which is the
 * independence it exists for.
 */
describe('an entry added since the last deploy', () => {
  beforeEach(() => {
    forgetLiveEntries()
  })

  /**
   * The bucket as production has it: all six objects, from the committed
   * markdown, with one of them replaced the way the editor replaces it.
   *
   * All six, because `liveEntryFor` reads all of them or none -- a partial map
   * would answer "no such entry" for a domain whose object happened to be
   * missing, which is the same wrong answer this whole change removes, reached
   * from the other side.
   */
  async function storeAllWith(domain: string, markdown: string): Promise<void> {
    await seedKnowledge()
    await env.KB!.put(`kb/${domain}.md`, markdown)
  }

  const ADDED_ENTRY = [
    '## join-weekends',
    '',
    '**Asks:** do you take applications at weekends · can I apply on a Sunday',
    '',
    '**Audience:** anyone',
    '',
    'Yes. Applications are read on the next working day.',
    '',
    '*Nothing gates the form by day: `worker/src/partner-api.ts` takes `/apply`',
    'whenever it is posted.*',
    ''
  ].join('\n')

  /**
   * The same entry, partner-only.
   *
   * Written by *removing* the audience line rather than by setting it to
   * "partner": the parser refuses that word outright -- `"partner" is not an
   * audience; write "anyone" or nothing` -- because a public entry must be
   * declared and everything else is the default. Getting this wrong made the
   * object unparseable, which `liveEntryFor` reports as "cannot read" and falls
   * back from, so the test passed for the wrong reason until it was driven
   * directly.
   */
  const PARTNER_ONLY_ENTRY = ADDED_ENTRY.replace('**Audience:** anyone\n\n', '')

  it('reaches an asker, though no build has ever seen it', async () => {
    await storeAllWith('joining', `${KNOWLEDGE_JOINING}\n${ADDED_ENTRY}`)
    const mesh = meshAnswering({
      written: [
        {
          id: 'join-weekends',
          answer: 'Yes. Applications are read on the next working day.',
          cite: 'the partner page',
          audience: 'anyone',
        },
      ],
    })

    const response = await askPublic(
      partnerDeps({ askMesh: mesh.asker, kb: env.KB! }),
      'do you take applications at weekends',
    )
    const body = (await response.json()) as { id: string; answer: string }

    expect(body.id).toBe('join-weekends')
    expect(body.answer).toContain('next working day')
  })

  /**
   * End to end, a partner-only entry does not reach a stranger.
   *
   * This does **not** isolate `liveEntryFor`'s own audience rule -- the
   * compiled fallback refuses this id too, so the case passes with that rule
   * removed. The rule is pinned directly below instead, which is where a
   * mutation of it actually goes red.
   */
  it('is still refused when the audience in the bucket says a stranger may not see it', async () => {
    await storeAllWith(
      'joining',
      `${KNOWLEDGE_JOINING}\n${PARTNER_ONLY_ENTRY}`,
    )
    const mesh = meshAnswering({
      written: [
        {
          id: 'join-weekends',
          answer: 'Yes. Applications are read on the next working day.',
          cite: 'the partner page',
          audience: 'anyone',
        },
      ],
    })

    const response = await askPublic(
      partnerDeps({ askMesh: mesh.asker, kb: env.KB! }),
      'do you take applications at weekends',
    )
    const body = (await response.json()) as { id: string }

    expect(body.id).toBe('no-match')
  })

  /**
   * The audience, decided from the bytes rather than from what the mesh said.
   *
   * The whole reason this check survives at all: the reviewer's suggestion was
   * to trust the `audience` field the mesh itself reports, which would make the
   * two guards one guard. Driven directly, because the route above cannot tell
   * this rule from the compiled fallback that also refuses.
   */
  it('decides the audience from the stored bytes, not from the mesh’s claim', async () => {
    await storeAllWith(
      'joining',
      `${KNOWLEDGE_JOINING}\n${PARTNER_ONLY_ENTRY}`,
    )
    forgetLiveEntries()

    const toStranger = await liveEntryFor(env.KB!, 'anyone', 'join-weekends', PARTNER_NOW)
    const toPartner = await liveEntryFor(env.KB!, 'partner', 'join-weekends', PARTNER_NOW)

    expect(toStranger, 'a partner-only entry was offered to a stranger').toBeNull()
    expect(toPartner?.id).toBe('join-weekends')
  })

  it('falls back to the compiled entries when the bucket cannot be read', async () => {
    // No objects at all, which is what an unreadable bucket looks like from
    // here. A bad minute in R2 costs a newly added entry and nothing else:
    // everything the build knows about still answers.
    const mesh = meshAnswering({
      written: [
        {
          id: 'join-cost',
          answer: entry('join-cost').answer,
          cite: entry('join-cost').cite,
          audience: 'anyone',
        },
      ],
    })

    const response = await askPublic(
      partnerDeps({ askMesh: mesh.asker, kb: env.KB! }),
      'what does it cost to join',
    )
    const body = (await response.json()) as { id: string }

    expect(body.id).toBe('join-cost')
  })
})
