import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
// The document itself, so "byte for byte" is checked against the file somebody
// edits rather than against the JSON built from it -- which is the copy that
// could be wrong.
import KNOWLEDGE_BASE from '../src/knowledge-base.md?raw'
import {
  ENTRIES,
  MAX_QUESTION_CHARS,
  MAX_TURNS,
  NO_MATCH,
  PARTNER_CONTACT_EMAIL,
  PARTNER_DAILY_QUESTIONS,
  PUBLIC_DAILY_QUESTIONS,
  QUESTION_RETENTION_SECONDS,
  askerFor,
  entriesFor,
  routerPrompt,
  type AskRequest,
  type Asker,
} from '../src/ask'
import { handlePartnersAsk, type PartnerDeps } from '../src/partner-api'
import { discountedCents, partOf } from '../src/referral'
import {
  PARTNER_NOW as NOW,
  applySchema,
  callPartner,
  partnerDeps,
  seedCode,
  seedPartner,
  signIn,
} from './harness'

/**
 * The box that answers a question, and the two properties it exists to keep.
 *
 * **The model chooses an answer and never writes one.** Every assertion about
 * what a visitor reads is an assertion that they read the file, so the first
 * thing this suite drives is a router that returns the wrong thing on purpose.
 *
 * **A stranger cannot reach an account entry.** That is the first test in the
 * file rather than the last, because it is the guard the audience split exists
 * for and the only one here whose failure is invisible: a portal-only answer
 * served to the public page looks like an answer.
 */
beforeEach(applySchema)

const THREAD = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const OTHER_THREAD = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

/** A distinct conversation id per index, for a sweep that is not about threads. */
const thread = (index: number): string =>
  `3f2b1c4d-5e6f-4a7b-8c9d-${String(index).padStart(12, '0')}`

/** A router under the suite's control, and a record of what it was asked. */
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

interface Answered {
  id: string
  answer?: string
  cite?: string | null
  citeUrl?: string | null
  contact?: string
  handOff?: boolean
  error?: string
}

async function ask(
  body: unknown,
  injected: PartnerDeps = partnerDeps(),
): Promise<{ status: number; body: Answered }> {
  const url = new URL('https://api.test/api/partners/ask')
  const response = await handlePartnersAsk(
    new Request(url, {
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

interface QuestionRow {
  partner_id: number | null
  conversation: string
  turn: number
  question: string
  entry_id: string | null
  model: string
}

async function logged(): Promise<QuestionRow[]> {
  const rows = await env.DB.prepare(
    'SELECT partner_id, conversation, turn, question, entry_id, model FROM partner_questions ORDER BY id',
  ).all<QuestionRow>()
  return rows.results ?? []
}

/**
 * `PUBLIC_DAILY_QUESTIONS` prepared statements, bound one per row.
 *
 * The ceiling tests each need the public budget already spent, which is a fixed
 * number of rows and nothing else. Seeded one `await` at a time that was one D1
 * round-trip per row against vitest's 5s default, and it timed out on a loaded
 * CI runner three times in one evening -- twice on changes that could not
 * possibly have caused it, once on a pull request that only edited a markdown
 * file. Batched it is a single round-trip, so the seed stops competing with the
 * assertion for the same five seconds.
 */
function counted(
  bind: (i: number) => unknown[],
  sql: string,
): ReturnType<typeof env.DB.prepare>[] {
  return Array.from({ length: PUBLIC_DAILY_QUESTIONS }, (_unused, i) =>
    env.DB.prepare(sql).bind(...bind(i)),
  )
}

/** The public budget spent for the day, in one round-trip. */
async function fillPublicBudget(): Promise<void> {
  await env.DB.batch(
    counted(
      (i) => [`${i}`, NOW - 60],
      `INSERT INTO partner_questions
         (partner_id, conversation, turn, asked_at, question, entry_id, model)
       VALUES (NULL, ?, 1, ?, 'earlier', 'join-cost', 'stub')`,
    ),
  )
}

/** Rows for a conversation that already happened, so a test can start at turn N. */
async function seedQuestions(
  count: number,
  over: { conversation?: string; partnerId?: number | null; entryId?: string | null } = {},
): Promise<void> {
  for (let turn = 1; turn <= count; turn += 1) {
    await env.DB.prepare(
      `INSERT INTO partner_questions
         (partner_id, conversation, turn, asked_at, question, entry_id, model)
       VALUES (?, ?, ?, ?, ?, ?, 'stub')`,
    )
      .bind(
        over.partnerId ?? null,
        over.conversation ?? THREAD,
        turn,
        NOW - 60,
        `question ${turn}`,
        over.entryId === undefined ? 'join-cost' : over.entryId,
      )
      .run()
  }
}

const entryText = (id: string): string => {
  const entry = ENTRIES.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`no such entry: ${id}`)
  return entry.answer
}

describe('a stranger cannot be told something only a partner may be told', () => {
  /**
   * AC2. The router is made to return an account entry to the public route --
   * which is what a confused model, a prompt-injected one, or a merged handler
   * would do -- and the visitor gets the contact address instead.
   *
   * `earning-rate` is the right entry to test with: it is somebody's own
   * commission rate, and a stranger reading it would be reading terms we have
   * not agreed with them.
   */
  it('answers no-match when the router names a portal-only entry', async () => {
    const { ask: asker } = router('earning-rate')

    const answered = await ask(
      { conversation: THREAD, question: 'what do I earn?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(200)
    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(answered.body.answer).toBeUndefined()
    expect(JSON.stringify(answered.body)).not.toContain('Your own terms')
  })

  /**
   * The other half, and the reason the first half is a second lock rather than
   * the only one: the public router is never given the portal entries at all,
   * so there is no id it could return by knowing one.
   */
  it('never puts a portal-only entry in front of the public router', () => {
    const prompt = routerPrompt('anyone')
    for (const entry of ENTRIES.filter((candidate) => candidate.audience !== 'anyone')) {
      expect(prompt, `${entry.id} is named to the public router`).not.toContain(entry.id)
    }
    expect(entriesFor('anyone').length).toBeLessThan(ENTRIES.length)
    expect(routerPrompt('partner')).toContain('earning-rate')
  })

  it('writes the question down even when it refuses to answer it', async () => {
    const { ask: asker } = router('earning-rate')

    await ask(
      { conversation: THREAD, question: 'what do I earn?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    // Logged as unmatched, because from the public route's point of view that
    // is what happened: no entry it may serve answers this.
    expect(await logged()).toEqual([
      {
        partner_id: null,
        conversation: THREAD,
        turn: 1,
        question: 'what do I earn?',
        entry_id: null,
        model: 'stub',
      },
    ])
  })
})

describe('what a visitor reads is what the document says', () => {
  /**
   * AC10, against the markdown rather than against the JSON. Nothing is
   * summarized, re-wrapped or re-worded in transit, and the way to prove that
   * is to find the served answer in the file, verbatim.
   */
  it('serves an entry byte for byte', async () => {
    const { ask: asker } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost to join?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.body.id).toBe('join-cost')
    expect(answered.body.answer).toBe(entryText('join-cost'))
    expect(KNOWLEDGE_BASE).toContain(answered.body.answer)
  })

  it('names what proves it, and links the one document a visitor can open', async () => {
    const { ask: asker } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.body.cite).toBe('Agreement §4.')
    expect(answered.body.citeUrl).toBe('/partners/agreement')
  })

  /**
   * A citation proves an answer to whoever reads it, and the reader here is a
   * stranger on the open internet. `account-signin` proved itself by naming
   * `LINK_TTL_SECONDS` in `worker/src/partners.ts` and then adding, verbatim
   * under the answer, that one of our own documents is out of date -- a note
   * written for a code reviewer, published to anybody who asked how to sign in.
   * The proof stays in knowledge-base.md, where a maintainer reads it.
   */
  it('never shows a visitor a file inside a private repository', async () => {
    const { ask: asker } = router('account-signin')

    const answered = await ask(
      { conversation: THREAD, question: 'how do I sign in?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.body.id).toBe('account-signin')
    expect(answered.body.answer).toBe(entryText('account-signin'))
    expect(answered.body.cite).toBeNull()
    expect(JSON.stringify(answered.body)).not.toContain('worker/src')
  })

  /**
   * The offer a prospective partner is quoted, worked at the price the app
   * charges and the terms a new partner is seeded with. Written against the
   * live list price as a literal -- STRIPE_PRICE_ID in worker/wrangler.toml --
   * because after the move to $9.99 an entry left at $19.99 and $9.00 would
   * promise a school twice what a sale pays it.
   */
  it('quotes the offer at the price the app charges and the terms it seeds', async () => {
    const { ask: asker } = router('join-offer')
    const seeded = await env.DB.prepare('SELECT discount_bps, direct_bps FROM defaults WHERE id = 1').first<{
      discount_bps: number
      direct_bps: number
    }>()
    const list = 999
    const charged = discountedCents(list, seeded!.discount_bps)
    const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

    const answered = await ask(
      { conversation: THREAD, question: 'what do I earn per sale?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.body.id).toBe('join-offer')
    expect(answered.body.answer?.replace(/\s+/g, ' ')).toContain(
      `On the ${dollars(list)} list price, your buyer pays ${dollars(charged)} and you earn ` +
        `${dollars(partOf(charged, seeded!.direct_bps))}`,
    )
  })
})

describe('the conversation is what the table says it was', () => {
  /**
   * The mechanism behind AC3. A follow-up only resolves -- "what if I don't hit
   * that?" -- if the earlier turns reach the router, and they are read back
   * from what was logged rather than taken from the request: the only text a
   * stranger can put into the prompt is the question they just typed.
   */
  it('gives the router the earlier turns, as they were recorded', async () => {
    const first = router('join-paid')
    await ask(
      { conversation: THREAD, question: 'how do you pay?', turnstile: 'good-token' },
      partnerDeps({ ask: first.ask }),
    )

    // `paid-first-payment` rather than `paid-threshold`: the entry AC3 names is
    // portal-only, because it quotes the asker's own balance, and the public
    // answer about the $50 floor is this one.
    const second = router('paid-first-payment')
    const answered = await ask(
      { conversation: THREAD, question: "what if I don't hit that?" },
      partnerDeps({ ask: second.ask }),
    )

    expect(first.calls[0].history).toEqual([])
    expect(second.calls[0].history).toEqual([{ question: 'how do you pay?', id: 'join-paid' }])
    expect(answered.body.answer).toBe(entryText('paid-first-payment'))
    expect(answered.body.answer).toContain('$50')
  })

  it('numbers the turns of a conversation', async () => {
    const { ask: asker } = router('join-cost')
    const deps = partnerDeps({ ask: asker })

    await ask({ conversation: THREAD, question: 'one?', turnstile: 'good-token' }, deps)
    await ask({ conversation: THREAD, question: 'two?' }, deps)
    await ask({ conversation: OTHER_THREAD, question: 'elsewhere?', turnstile: 'good-token' }, deps)

    expect((await logged()).map((row) => [row.conversation, row.turn, row.question])).toEqual([
      [THREAD, 1, 'one?'],
      [THREAD, 2, 'two?'],
      [OTHER_THREAD, 1, 'elsewhere?'],
    ])
  })

  /**
   * A conversation id is minted by a browser, so it is guessable by anybody.
   * What it must not be is a way to read somebody else's thread into a prompt.
   */
  it('cannot read a signed-in partner’s thread from the public route', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })
    await seedQuestions(1, { partnerId, entryId: 'earning-rate' })
    const { ask: asker, calls } = router('join-cost')

    await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(calls[0].history).toEqual([])
  })
})

describe('when nothing answers the question', () => {
  /**
   * AC4. The unmatched questions are the most valuable thing this ships: they
   * are the first evidence anybody has of what a prospective partner wanted to
   * know and could not find out. Nothing is invented in the meantime.
   */
  it('names a person, invents nothing, and records the question', async () => {
    const { ask: asker } = router(NO_MATCH)

    const answered = await ask(
      { conversation: THREAD, question: 'where is your LLC registered?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(200)
    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(answered.body.answer).toBeUndefined()

    const rows = await logged()
    expect(rows[0].entry_id).toBeNull()
    expect(rows[0].question).toBe('where is your LLC registered?')
  })

  /**
   * AC5. Twice in a row is not a routing problem any more, and offering to try
   * again a third time is how somebody ends up typing the same question into a
   * box that was never going to answer it.
   */
  it('hands over to a person on the second consecutive miss', async () => {
    const { ask: asker } = router(NO_MATCH, NO_MATCH)
    const deps = partnerDeps({ ask: asker })

    const first = await ask(
      { conversation: THREAD, question: 'is my advert compliant?', turnstile: 'good-token' },
      deps,
    )
    const second = await ask({ conversation: THREAD, question: 'what about this one?' }, deps)

    expect(first.body.handOff).toBe(false)
    expect(second.body.handOff).toBe(true)
  })

  it('starts counting again once something has been answered', async () => {
    const { ask: asker } = router(NO_MATCH, 'join-cost', NO_MATCH)
    const deps = partnerDeps({ ask: asker })

    await ask({ conversation: THREAD, question: 'one?', turnstile: 'good-token' }, deps)
    await ask({ conversation: THREAD, question: 'two?' }, deps)
    const third = await ask({ conversation: THREAD, question: 'three?' }, deps)

    expect(third.body.handOff).toBe(false)
  })
})

describe('the limits on a route that costs money and has no session', () => {
  /**
   * AC6. The challenge is on the first message of a conversation and "first" is
   * decided by the rows the conversation already has -- so a fresh id, which is
   * what a script would send, is always turn one.
   */
  it('refuses a conversation that starts without a Turnstile token', async () => {
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
    expect(await logged()).toEqual([])
  })

  it('refuses a conversation that starts with a token that did not pass', async () => {
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'not-the-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('asks for the challenge once, not on every follow-up', async () => {
    const { ask: asker } = router('join-cost')
    const deps = partnerDeps({ ask: asker })

    await ask({ conversation: THREAD, question: 'first?', turnstile: 'good-token' }, deps)
    const second = await ask({ conversation: THREAD, question: 'second?' }, deps)

    expect(second.status).toBe(200)
    expect(second.body.id).toBe('join-cost')
  })

  /** AC7, the turn cap. A conversation, not a correspondence. */
  it('refuses an eleventh turn without calling the router', async () => {
    await seedQuestions(MAX_TURNS)
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'and another thing?' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(400)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(calls).toEqual([])
  })

  /** AC7, the length cap. A question box is not a way to send us prose. */
  it('refuses a question longer than the cap without calling the router', async () => {
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      {
        conversation: THREAD,
        question: 'x'.repeat(MAX_QUESTION_CHARS + 1),
        turnstile: 'good-token',
      },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
    expect((await ask(
      { conversation: THREAD, question: 'x'.repeat(MAX_QUESTION_CHARS), turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )).status).toBe(200)
  })

  /**
   * AC7, the ceiling -- and the one limit that answers 200. Past it the route
   * hands somebody an address rather than an error, because a cap that degrades
   * to the honest fallback is one nobody has to be paged about.
   */
  it('answers with the contact address past the daily ceiling, and asks nothing', async () => {
    await fillPublicBudget()
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(200)
    expect(answered.body.id).toBe(NO_MATCH)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(calls).toEqual([])
    // No row either: the ceiling counts rows, so writing one here would be the
    // cap feeding itself.
    expect((await logged()).length).toBe(PUBLIC_DAILY_QUESTIONS)
  })

  /**
   * Both predicates of the ceiling query, each seeded past the cap on its own.
   *
   * Written with a single row this passed with either predicate deleted, which
   * is the same as not testing them: drop `asked_at >` and the counter never
   * resets, so after the three-hundredth public question ever asked the route
   * answers with the contact address for the rest of the product's life and
   * nothing goes red. Drop `partner_id IS NULL` and signed-in partners spend
   * the public budget.
   */
  it('counts only the last day, and only the public route', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })
    await env.DB.batch([
      ...counted(
        (i) => [`old-${i}`, NOW - 86_400 - 1],
        `INSERT INTO partner_questions
             (partner_id, conversation, turn, asked_at, question, entry_id, model)
           VALUES (NULL, ?, 1, ?, 'yesterday', 'join-cost', 'stub')`,
      ),
      ...counted(
        (i) => [partnerId, `mine-${i}`, NOW - 60],
        `INSERT INTO partner_questions
             (partner_id, conversation, turn, asked_at, question, entry_id, model)
           VALUES (?, ?, 1, ?, 'theirs', 'join-cost', 'stub')`,
      ),
    ])
    const { ask: asker } = router('join-cost')

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.body.id).toBe('join-cost')
  })

  /**
   * The ceiling is checked before the challenge, and the order is the bug this
   * pins. Cloudflare redeems a token exactly once; verifying first spent the
   * visitor's only token on a request that never reached the model, and because
   * the ceiling writes no row their next question was still turn one and was
   * refused with a dead token -- and so was every one after it, for the rest of
   * the day, with no address anywhere on the screen.
   */
  it('does not spend a visitor’s challenge on a request the ceiling refuses', async () => {
    await fillPublicBudget()
    const spent: string[] = []
    const deps = partnerDeps({
      ask: router('join-cost').ask,
      // Redeemed once, exactly as siteverify behaves.
      verifyTurnstile: async (token) => {
        if (token !== 'good-token' || spent.includes(token)) return false
        spent.push(token)
        return true
      },
    })

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      deps,
    )

    expect(answered.status).toBe(200)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(spent).toEqual([])
  })

  /**
   * AC5's flag is a statement about what happened, and the ceiling used to
   * assert it unconditionally: somebody's very first question was answered
   * "that is two I could not answer".
   */
  it('does not claim two misses to somebody who has asked once', async () => {
    await fillPublicBudget()

    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: router('join-cost').ask }),
    )

    expect(answered.body.handOff).toBe(false)
  })

  /**
   * A refusal that gives somebody nowhere to go is the worst sentence on the
   * recruitment path, and this is the one refusal that also accuses them of
   * being a robot. A challenge fails for a VPN, a hardened browser, a widget
   * that has not finished loading -- every one of them a person.
   */
  it('gives an address to somebody the challenge refused', async () => {
    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'not-the-token' },
      partnerDeps({ ask: router('join-cost').ask }),
    )

    expect(answered.status).toBe(400)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
  })

  /**
   * The turn is claimed before the model is asked, and one request may hold it.
   *
   * Written afterwards -- which is how this shipped -- the turn number, the
   * challenge and the ceiling were all read from rows an in-flight request had
   * not written yet, so concurrent posts on one conversation each saw the same
   * history, each skipped the challenge as a follow-up, and each became a paid
   * model call off a single solve. The unique index is what bounds it.
   */
  it('lets one request hold a turn, so a conversation cannot cost more than its cap', async () => {
    const claim = () =>
      env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (NULL, ?, 1, ?, 'racing', NULL, 'asking')`,
      )
        .bind(THREAD, NOW)
        .run()

    await claim()

    await expect(claim()).rejects.toThrow()
  })

  it('writes the row before it asks, so an unanswered turn is still counted', async () => {
    let seen: number | null = null
    const asker: Asker = async () => {
      const rows = await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM partner_questions',
      ).first<{ c: number }>()
      seen = rows?.c ?? 0
      return { id: 'join-cost', model: 'stub' }
    }

    await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(seen).toBe(1)
  })

  /**
   * The 180 days promised above the box, in the partner privacy document and on
   * the app's privacy screen. All three shipped over a table nothing ever
   * deleted a row from, and the only guard was that the three sentences agreed
   * with each other. The deletion rides on the write path so that it cannot
   * quietly stop running.
   */
  it('forgets a question once the window it promised has passed', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (NULL, 'ancient', 1, ?, 'asked long ago', 'join-cost', 'stub')`,
      ).bind(NOW - QUESTION_RETENTION_SECONDS - 1),
      env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (NULL, 'recent', 1, ?, 'asked yesterday', 'join-cost', 'stub')`,
      ).bind(NOW - QUESTION_RETENTION_SECONDS + 86_400),
    ])

    await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: router('join-cost').ask }),
    )

    expect((await logged()).map((row) => row.question)).toEqual([
      'asked yesterday',
      'what does it cost?',
    ])
  })

  it('refuses a request with no conversation id', async () => {
    const { ask: asker, calls } = router('join-cost')

    const answered = await ask(
      { conversation: 'not-a-uuid', question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: asker }),
    )

    expect(answered.status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('the same box, signed in', () => {
  it('refuses without a session', async () => {
    const response = await callPartner('/ask', {
      body: { conversation: THREAD, question: 'what do I earn?' },
    })

    expect(response.status).toBe(401)
  })

  it('refuses without X-Partner, which is the CSRF defense', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })
    const response = await callPartner('/ask', {
      body: { conversation: THREAD, question: 'what do I earn?' },
      cookie: await signIn(partnerId),
      header: false,
    })

    expect(response.status).toBe(400)
  })

  /**
   * AC8. The sixteen portal-only entries are written with holes in them, and
   * the holes are filled from the partner's own row -- never by the model,
   * which is never shown a figure at all.
   */
  it('shows a partner their own figures', async () => {
    const partnerId = await seedPartner({
      email: 'school@example.test',
      payoutDetail: 'money@example.test',
    })
    await seedCode({ code: 'TOWSON7', partnerId, expiresAt: NOW + 86_400 })
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO purchases (id, stripe_session_id, recovery_code, created_at, amount_total)
         VALUES (1, 'cs_1', 'AAAAAAAA', ?, 1599)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO commissions (partner_id, purchase_id, kind, basis_cents, rate_bps,
                                  amount_cents, currency, clears_at, created_at)
         VALUES (?, 1, 'direct', 1599, 2000, 320, 'usd', ?, ?)`,
      ).bind(partnerId, NOW - 60, NOW - 60),
    ])

    const response = await callPartner(
      '/ask',
      { body: { conversation: THREAD, question: 'when does my code expire?' }, cookie: await signIn(partnerId) },
      partnerDeps({ ask: router('code-expiry').ask }),
    )
    const answered = (await response.json()) as Answered

    expect(answered.answer).toContain('TOWSON7')
    expect(answered.answer).not.toContain('{')

    const money = await callPartner(
      '/ask',
      { body: { conversation: OTHER_THREAD, question: 'why was I not paid?' }, cookie: await signIn(partnerId) },
      partnerDeps({ ask: router('paid-blocked-reasons').ask }),
    )
    const figures = (await money.json()) as Answered

    expect(figures.answer).toContain('$3.20')
    expect(figures.answer).toContain('money@example.test')
  })

  /**
   * The second half of AC8, and the case that actually happens: somebody
   * approved five minutes ago. Every placeholder still resolves to something,
   * because `{code}` in the middle of a sentence about money is the most
   * visible possible failure.
   */
  it('leaves no brace in an answer to a partner with nothing yet', async () => {
    const partnerId = await seedPartner({ email: 'new@example.test' })
    const cookie = await signIn(partnerId)
    const withHoles = ENTRIES.filter((entry) => /\{[a-z_]+\}/.test(entry.answer))
    expect(withHoles.length).toBeGreaterThan(0)

    // A conversation of its own per entry. Run down one thread this sweep sat
    // exactly on MAX_TURNS -- ten placeholder entries, a ten-turn cap -- so the
    // eleventh such entry, which the plan expects to be written as unmatched
    // questions accumulate, would have turned this red with a 400 and an
    // assertion about `undefined` that names neither AC8 nor the turn cap.
    for (const [index, entry] of withHoles.entries()) {
      const response = await callPartner(
        '/ask',
        { body: { conversation: thread(index), question: `about ${entry.id}` }, cookie },
        partnerDeps({ ask: router(entry.id).ask }),
      )
      expect(response.status, `${entry.id} was not answered at all`).toBe(200)
      const answered = (await response.json()) as Answered
      expect(answered.answer, `${entry.id} rendered a placeholder`).not.toContain('{')
    }
  })

  /**
   * The portal route spends money per request and shipped with no bound at all,
   * on the argument that a session makes a question attributable to an account
   * we can suspend. `partnerFromSession` accepts a `pending` row, so anybody who
   * can receive email has a session minutes after applying; `handleLogin`
   * refuses only `closed`, so a suspended one mails themselves a fresh link. A
   * loop over this route was an unbounded bill nobody would see until it
   * arrived.
   */
  it('stops a signed-in partner past a day’s worth of questions', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })
    const cookie = await signIn(partnerId)
    for (let i = 0; i < PARTNER_DAILY_QUESTIONS; i += 1) {
      await env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (?, ?, 1, ?, 'earlier', 'earning-rate', 'stub')`,
      )
        .bind(partnerId, `theirs-${i}`, NOW - 60)
        .run()
    }
    const { ask: asker, calls } = router('earning-rate')

    const response = await callPartner(
      '/ask',
      { body: { conversation: THREAD, question: 'what do I earn?' }, cookie },
      partnerDeps({ ask: asker }),
    )
    const answered = (await response.json()) as Answered

    expect(response.status).toBe(200)
    expect(answered.id).toBe(NO_MATCH)
    expect(answered.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect(calls).toEqual([])
  })

  /** And it is *their* day, not everybody's: one loud partner cannot mute another. */
  it('counts each partner’s day separately', async () => {
    const loud = await seedPartner({ email: 'loud@example.test' })
    const quiet = await seedPartner({ email: 'quiet@example.test' })
    for (let i = 0; i < PARTNER_DAILY_QUESTIONS; i += 1) {
      await env.DB.prepare(
        `INSERT INTO partner_questions
           (partner_id, conversation, turn, asked_at, question, entry_id, model)
         VALUES (?, ?, 1, ?, 'earlier', 'earning-rate', 'stub')`,
      )
        .bind(loud, `loud-${i}`, NOW - 60)
        .run()
    }

    const response = await callPartner(
      '/ask',
      { body: { conversation: THREAD, question: 'what do I earn?' }, cookie: await signIn(quiet) },
      partnerDeps({ ask: router('earning-rate').ask }),
    )
    const answered = (await response.json()) as Answered

    expect(answered.id).toBe('earning-rate')
  })

  it('records which partner asked', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })

    await callPartner(
      '/ask',
      { body: { conversation: THREAD, question: 'what do I earn?' }, cookie: await signIn(partnerId) },
      partnerDeps({ ask: router('earning-rate').ask }),
    )

    const rows = await logged()
    expect(rows[0].partner_id).toBe(partnerId)
    expect(rows[0].entry_id).toBe('earning-rate')
  })
})

describe('when there is no key', () => {
  /**
   * AC9, through the deployed worker rather than around it: `askerFor` is what
   * `partnerDeps` builds in index.ts, and this environment has no
   * ANTHROPIC_API_KEY -- which is also the state of production until somebody
   * runs `wrangler secret put`.
   *
   * Seeded to turn two so the request gets past Turnstile, which refuses
   * everything here for want of a secret of its own. That is the correct
   * direction for *that* failure and this is the correct direction for this
   * one: an address a person reads, and an HTTP 200.
   */
  it('answers with the contact address rather than a 500', async () => {
    await seedQuestions(1)

    const response = await SELF.fetch('https://api.test/api/partners/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: THREAD, question: 'what does it cost to join?' }),
    })
    const answered = (await response.json()) as Answered

    expect(response.status).toBe(200)
    expect(answered.id).toBe(NO_MATCH)
    expect(answered.contact).toBe(PARTNER_CONTACT_EMAIL)
  })

  /**
   * AC9 says *both* routes, and only the public one was driven. The signed-in
   * route has its own handler and its own limits; nothing about the public
   * one's behavior without a key proves anything about this one's.
   */
  it('answers a signed-in partner with the address too, rather than a 500', async () => {
    const partnerId = await seedPartner({ email: 'school@example.test' })

    const response = await callPartner(
      '/ask',
      { body: { conversation: THREAD, question: 'what do I earn?' }, cookie: await signIn(partnerId) },
      partnerDeps({ ask: askerFor(undefined) }),
    )
    const answered = (await response.json()) as Answered

    expect(response.status).toBe(200)
    expect(answered.id).toBe(NO_MATCH)
    expect(answered.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect((await logged())[0].model).toBe('unavailable')
  })

  it('says so in the row, so an outage is not read as a run of no-matches', async () => {
    const answered = await ask(
      { conversation: THREAD, question: 'what does it cost?', turnstile: 'good-token' },
      partnerDeps({ ask: askerFor(undefined) }),
    )

    expect(answered.status).toBe(200)
    expect(answered.body.contact).toBe(PARTNER_CONTACT_EMAIL)
    expect((await logged())[0].model).toBe('unavailable')
  })
})
