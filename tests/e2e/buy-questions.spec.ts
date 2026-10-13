import { expect, test, type Page } from '@playwright/test'
import { ASK_QUOTA_KEY, ASK_WEEKLY_LIMITS, daysUntilReset, localWeek } from '../../src/ask-quota'
import { PACKS, TOKENS_PER_QUESTION, priceLabel } from '../../src/pricing'
import { STRINGS } from '../../src/strings'
import { TOTAL, seed } from './app'

/**
 * Question tokens, from the outside (docs/plans/trusted-by-date.md, phase 5).
 *
 * The worker and Stripe are both stubbed at the network edge, in the paywall
 * tests' shape: the checkout route answers with a Stripe address this suite
 * serves itself, and the way back is the address Stripe would send the buyer
 * to, opened by hand. What is held is the page: the pop-up on the question
 * that hit the limit, the question kept through a trip to Checkout and not
 * sent on return, a token spent only after one "Spend a token?", and the
 * balance moving with what the worker says. That the worker debits, refunds
 * and refuses is held in workerd by worker/tests/questions.test.ts.
 */

const API = 'https://paywall.test.invalid'
const STRIPE = 'https://checkout.stripe.test'
const EN = STRINGS.en
const ES = STRINGS.es
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const CODE = 'LQ-ABCDE-12345'
const QUESTION_CODE_KEY = 'teach-and-test/v1/question-code'
const LANG_KEY = 'teach-and-test/v1/lang'

const ANSWER = {
  id: 'answer',
  answer: 'Yes. The recovery code on your receipt moves your purchase to up to 5 devices.',
  sources: [{ id: 'paying', title: 'Paying', page: '#terms' }],
}

interface Sent {
  question: string
  conversation: string
  state: string | null
  spend?: string
}

/** The week's free questions, spent or as given, on every load. */
async function quota(page: Page, used: { state: number; nationwide: number }): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [ASK_QUOTA_KEY, JSON.stringify({ week: localWeek(), ...used })],
  )
}
const SPENT = { state: ASK_WEEKLY_LIMITS.state, nationwide: ASK_WEEKLY_LIMITS.nationwide }

let marker = 0
/** A code already on this browser, written once a tab, so a code claimed later is not overwritten on reload. */
async function holding(page: Page, code: string): Promise<void> {
  await page.addInitScript(
    ([key, value, flag]) => {
      if (sessionStorage.getItem(flag) !== null) return
      sessionStorage.setItem(flag, '1')
      localStorage.setItem(key, value)
    },
    [QUESTION_CODE_KEY, code, `buy-code-${(marker += 1)}`],
  )
}

async function stubChallenge(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
}

/** The worker's ask route, answering in turn, recording what it was sent. */
async function stubAsk(page: Page, answers: { status?: number; json: unknown }[]): Promise<Sent[]> {
  const sent: Sent[] = []
  let next = 0
  await page.route(`${API}/api/ask`, (route) => {
    sent.push(route.request().postDataJSON() as Sent)
    const answer = answers[Math.min(next, answers.length - 1)]
    next += 1
    return route.fulfill({ status: answer.status ?? 200, json: answer.json })
  })
  return sent
}

/**
 * The token routes and Stripe's own page. The checkout answers with a Stripe
 * address this suite serves; the claim answers with the code once paid.
 */
async function stubTokens(
  page: Page,
  options: { balance?: { code: string; left: number } | 'unknown'; claim?: { code: string; left: number }; checkout?: 'unavailable' } = {},
): Promise<{ checkouts: Record<string, unknown>[]; claims: string[] }> {
  const checkouts: Record<string, unknown>[] = []
  const claims: string[] = []
  await page.route(`${API}/api/questions/checkout`, (route) => {
    checkouts.push(route.request().postDataJSON() as Record<string, unknown>)
    if (options.checkout === 'unavailable') return route.fulfill({ status: 503, json: { error: 'not-for-sale' } })
    return route.fulfill({ json: { checkoutUrl: `${STRIPE}/c/pay/cs_test_paid` } })
  })
  await page.route(`${API}/api/questions/claim*`, (route) => {
    claims.push(new URL(route.request().url()).searchParams.get('session') ?? '')
    return route.fulfill({ json: options.claim ?? { code: CODE, left: 75 } })
  })
  await page.route(`${API}/api/questions/balance*`, (route) => {
    const balance = options.balance ?? { code: CODE, left: 12 }
    return balance === 'unknown'
      ? route.fulfill({ status: 404, json: { error: 'That code was not recognized' } })
      : route.fulfill({ json: balance })
  })
  await page.route(`${STRIPE}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Stripe Checkout</title><h1>Pay</h1>' }))
  return { checkouts, claims }
}

async function askOnPage(page: Page, question: string): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
}

test.beforeEach(async ({ page }) => {
  await stubChallenge(page)
  await seed(page, FRESH)
})

test.describe('the purchase pop-up', () => {
  // Criterion 27; guard 29's page half: every price is the one src/pricing.ts gives.
  test('opens on the very question that hit the limit, offering the four packs at the prices pricing.ts gives', async ({ page }) => {
    await quota(page, { state: 0, nationwide: ASK_WEEKLY_LIMITS.nationwide - 1 })
    await stubTokens(page)
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, 'the last free one')
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await askOnPage(page, 'which state is strictest on texting?')

    const sheet = page.getByTestId('buy-questions')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('ask-limit-body')).toHaveText(EN.ask.limitNationwide(ASK_WEEKLY_LIMITS.nationwide))
    await expect(page.getByTestId('buy-token-is')).toHaveText(EN.ask.tokenIs)
    await expect(page.getByTestId('buy-pack')).toHaveText(PACKS.map((pack) => EN.ask.buyPack(pack.tokens, priceLabel(pack))))
    await expect(page.getByTestId('buy-dollar-pack')).toHaveText(EN.ask.dollarPack)
    await expect(page.getByTestId('buy-classroom')).toHaveText(EN.ask.classroom)
    // Whoever is at the keyboard -- a learner, a teacher, a school office.
    await expect(sheet).not.toContainText(/your (state|test)/i)
    expect(sent).toHaveLength(1)
  })

  test('closes on Not now onto the thread, the tick and the question exactly as they were', async ({ page }) => {
    await quota(page, { state: 0, nationwide: ASK_WEEKLY_LIMITS.nationwide - 1 })
    await stubTokens(page)
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, 'the last free one')
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await askOnPage(page, 'which state is strictest on texting?')
    await page.getByTestId('ask-limit-close').click()

    await expect(page.getByTestId('ask-limit-dialog')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await expect(page.getByTestId('ask-nationwide')).toBeChecked()
    await expect(page.getByTestId('ask-input')).toHaveValue('which state is strictest on texting?')
    expect(sent).toHaveLength(1)
  })

  test('opens from the balance line at any time, as an offer rather than a stop', async ({ page }) => {
    await stubTokens(page)
    await page.goto('/#ask')
    await page.getByTestId('ask-balance').click()
    await expect(page.getByTestId('buy-questions')).toBeVisible()
    await expect(page.getByRole('heading', { name: EN.ask.buyTitle })).toBeVisible()
    await expect(page.getByTestId('ask-limit-body')).toHaveCount(0)
  })

  test('says the packs are not on sale yet when the worker has no Price ids, and stays on the page', async ({ page }) => {
    await quota(page, SPENT)
    await stubTokens(page, { checkout: 'unavailable' })
    await page.goto('/#ask')
    await askOnPage(page, 'one more')
    await page.locator('[data-testid="buy-pack"][data-pack="1"]').click()
    await expect(page.getByTestId('buy-unavailable')).toHaveText(EN.ask.notForSale)
    await expect(page).toHaveURL(/#ask$/)
  })

  test('speaks Spanish to a Spanish visitor, packs and all', async ({ page }) => {
    await page.addInitScript(([key]) => localStorage.setItem(key, 'es'), [LANG_KEY])
    await stubTokens(page)
    await page.goto('/#ask')
    await page.getByTestId('ask-balance').click()
    await expect(page.getByTestId('buy-token-is')).toHaveText(ES.ask.tokenIs)
    await expect(page.getByTestId('buy-pack')).toHaveText(PACKS.map((pack) => ES.ask.buyPack(pack.tokens, priceLabel(pack))))
    await expect(page.getByTestId('buy-questions')).not.toContainText(/su (estado|examen)/i)
  })
})

/** Spend the week, tick, type, hit the limit, tap the five-dollar pack, land on Stripe. */
async function toCheckout(page: Page): Promise<{ sent: Sent[]; checkouts: Record<string, unknown>[]; claims: string[] }> {
  await quota(page, SPENT)
  const stubs = await stubTokens(page)
  const sent = await stubAsk(page, [{ json: { ...ANSWER, tokens: { left: 70 } } }])
  await page.goto('/#ask')
  await page.getByTestId('ask-nationwide').check()
  await askOnPage(page, 'which state is strictest on texting?')
  await page.locator('[data-testid="buy-pack"][data-pack="5"]').click()
  await expect(page).toHaveURL(`${STRIPE}/c/pay/cs_test_paid`)
  return { sent, ...stubs }
}

test.describe('the trip to Checkout and back', () => {
  test('sends the pack, the language, no old code and the page to come back to', async ({ page }) => {
    const { checkouts } = await toCheckout(page)
    expect(checkouts).toEqual([{ pack: 5, lang: 'en', from: null, path: '/' }])
  })

  // Guard 28a; criterion 27a.
  test('comes back from a paid checkout with the question in the input and the tick as it was', async ({ page }) => {
    await toCheckout(page)
    await page.goto('/?session=cs_test_paid#ask')
    await expect(page.getByTestId('ask-input')).toHaveValue('which state is strictest on texting?')
    await expect(page.getByTestId('ask-nationwide')).toBeChecked()
  })

  // Criterion 27a: the code and the balance line.
  test('claims the code the session paid for, shows it, stores it, and puts the tokens on the balance line', async ({ page }) => {
    const { claims } = await toCheckout(page)
    await page.goto('/?session=cs_test_paid#ask')
    await expect(page.getByTestId('ask-tokens-ready')).toHaveText(EN.ask.tokensReady)
    await expect(page.getByTestId('ask-question-code')).toHaveText(EN.ask.questionCode(CODE))
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(0, ASK_WEEKLY_LIMITS.nationwide, daysUntilReset(), 75))
    expect(claims).toEqual(['cs_test_paid'])
    expect(await page.evaluate((key) => localStorage.getItem(key), QUESTION_CODE_KEY)).toBe(CODE)
    // The session is taken out of the address, so a reload does not claim it again.
    await expect(page).toHaveURL(/\/#ask$/)
  })

  // Guard 28b.
  test('sends nothing on return until Ask is tapped, and then pays for it with the new code', async ({ page }) => {
    const { sent } = await toCheckout(page)
    await page.goto('/?session=cs_test_paid#ask')
    await expect(page.getByTestId('ask-tokens-ready')).toBeVisible()
    // Long enough for a send-on-return to have reached the stub.
    await page.waitForTimeout(1500)
    expect(sent).toHaveLength(0)

    await page.getByTestId('ask-submit').click()
    await page.getByTestId('ask-spend-yes').click()
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ question: 'which state is strictest on texting?', state: 'US', spend: CODE })
  })

  // Verifier, fix round: the session stays in the address until the claim
  // lands, so the line's own advice -- reload in a minute -- can work.
  test('keeps the session in the address when the claim does not land, so a reload can claim it', async ({ page }) => {
    await toCheckout(page)
    await page.unroute(`${API}/api/questions/claim*`)
    await page.route(`${API}/api/questions/claim*`, (route) => route.fulfill({ status: 502, json: { error: 'Could not reach Stripe' } }))
    await page.goto('/?session=cs_test_paid#ask')
    await expect(page.getByTestId('ask-tokens-pending')).toHaveText(EN.ask.tokensPending)
    await expect(page).toHaveURL(/\?session=cs_test_paid#ask$/)
  })

  test('continues the conversation it left, so the worker can read the earlier turns', async ({ page }) => {
    await quota(page, { state: ASK_WEEKLY_LIMITS.state - 1, nationwide: ASK_WEEKLY_LIMITS.nationwide })
    await stubTokens(page)
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await askOnPage(page, 'the last free one')
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await askOnPage(page, 'and a follow-up')
    await page.locator('[data-testid="buy-pack"][data-pack="1"]').click()
    await expect(page).toHaveURL(`${STRIPE}/c/pay/cs_test_paid`)
    await page.goto('/?session=cs_test_paid#ask')
    // The answer from before the trip is kept on the device now, folded: the
    // thread the worker reads back is also the one the learner sees again.
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await expect(page.getByTestId('ask-exchange').first()).toHaveAttribute('data-open', 'false')
    // The quota above is written on every load, so the week has one free
    // question again here: this is about the thread, not the payment.
    await page.getByTestId('ask-submit').click()
    await expect(page.getByTestId('ask-answer')).toHaveCount(2)
    await expect(page.getByTestId('ask-exchange').first()).toHaveAttribute('data-open', 'true')
    expect(sent).toHaveLength(2)
    expect(sent[1].conversation).toBe(sent[0].conversation)
  })

  // Criterion 27a, the cancelled half.
  test('comes back from a cancelled checkout with the question restored and nothing else said', async ({ page }) => {
    const { sent, claims } = await toCheckout(page)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-input')).toHaveValue('which state is strictest on texting?')
    await expect(page.getByTestId('ask-nationwide')).toBeChecked()
    await expect(page.getByTestId('ask-limit-dialog')).toHaveCount(0)
    await expect(page.getByTestId('ask-tokens')).toHaveCount(0)
    expect(claims).toEqual([])
    expect(sent).toHaveLength(0)
  })
})

test.describe('spending a token', () => {
  // Criterion 25; guard 28's page half: a paid question is not counted against the week.
  test('asks once a visit, then spends one token on a state question and five on a nationwide one, moving the balance with the worker’s figure', async ({ page }) => {
    await quota(page, SPENT)
    await holding(page, CODE)
    await stubTokens(page, { balance: { code: CODE, left: 12 } })
    const sent = await stubAsk(page, [{ json: { ...ANSWER, tokens: { left: 11 } } }, { json: { ...ANSWER, tokens: { left: 10 } } }, { json: { ...ANSWER, tokens: { left: 5 } } }])
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(0, ASK_WEEKLY_LIMITS.state, daysUntilReset(), 12))

    await askOnPage(page, 'first paid')
    await expect(page.getByTestId('ask-spend-confirm')).toBeVisible()
    await expect(page.getByTestId('ask-spend-confirm')).toContainText(EN.ask.spendBody(TOKENS_PER_QUESTION.state, 12))
    expect(sent).toHaveLength(0)
    await page.getByTestId('ask-spend-yes').click()
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(0, ASK_WEEKLY_LIMITS.state, daysUntilReset(), 11))

    await askOnPage(page, 'second paid')
    await expect(page.getByTestId('ask-answer')).toHaveCount(2)
    await expect(page.getByTestId('ask-spend-confirm')).toHaveCount(0)

    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, 'across the states')
    await expect(page.getByTestId('ask-answer')).toHaveCount(3)
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(0, ASK_WEEKLY_LIMITS.nationwide, daysUntilReset(), 5))

    expect(sent.map((body) => [body.question, body.state === 'US', body.spend])).toEqual([
      ['first paid', false, CODE],
      ['second paid', false, CODE],
      ['across the states', true, CODE],
    ])
    const week = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), ASK_QUOTA_KEY)) ?? '{}')
    expect(week).toMatchObject(SPENT)
  })

  test('spends nothing and keeps the question when "Spend a token?" is answered Not now', async ({ page }) => {
    await quota(page, SPENT)
    await holding(page, CODE)
    await stubTokens(page)
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await askOnPage(page, 'maybe not')
    await page.getByTestId('ask-spend-no').click()
    await expect(page.getByTestId('ask-spend-confirm')).toHaveCount(0)
    await expect(page.getByTestId('ask-input')).toHaveValue('maybe not')
    expect(sent).toHaveLength(0)
  })

  // Criterion 27, the "code with no balance" half.
  test('opens the pop-up instead of asking when the code holds too few for the question', async ({ page }) => {
    await quota(page, SPENT)
    await holding(page, CODE)
    await stubTokens(page, { balance: { code: CODE, left: 3 } })
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(0, ASK_WEEKLY_LIMITS.state, daysUntilReset(), 3))
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, 'across the states')
    await expect(page.getByTestId('ask-limit-body')).toHaveText(EN.ask.limitNationwide(ASK_WEEKLY_LIMITS.nationwide))
    await expect(page.getByTestId('ask-spend-confirm')).toHaveCount(0)
    expect(sent).toHaveLength(0)
  })

  test('opens the pop-up over the question when the worker answers 402, and shows no failure line', async ({ page }) => {
    await quota(page, SPENT)
    await holding(page, CODE)
    await stubTokens(page, { balance: { code: CODE, left: 1 } })
    await stubAsk(page, [{ status: 402, json: { error: 'no tokens left on that code', buy: true, tokens: { left: 0 } } }])
    await page.goto('/#ask')
    await askOnPage(page, 'spent elsewhere')
    await page.getByTestId('ask-spend-yes').click()
    await expect(page.getByTestId('buy-questions')).toBeVisible()
    await expect(page.getByTestId('ask-input')).toHaveValue('spent elsewhere')
    await expect(page.getByTestId('ask-trouble')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })
})

test.describe('I have a code', () => {
  // Criterion 28.
  test('restores a balance on a browser that never bought it', async ({ page }) => {
    await stubTokens(page, { balance: { code: CODE, left: 72 } })
    await page.goto('/#ask')
    await page.getByTestId('ask-balance').click()
    await page.getByTestId('buy-have-code').click()
    await page.getByTestId('question-code-input').fill('lq abcde 12345')
    await page.getByTestId('question-code-submit').click()
    await expect(page.getByTestId('ask-limit-dialog')).toHaveCount(0)
    await expect(page.getByTestId('ask-code-restored')).toHaveText(EN.ask.codeRestored(CODE, 72))
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.state, ASK_WEEKLY_LIMITS.state, daysUntilReset(), 72))
    expect(await page.evaluate((key) => localStorage.getItem(key), QUESTION_CODE_KEY)).toBe(CODE)
  })

  test('says so when the code is nobody’s, and keeps nothing', async ({ page }) => {
    await stubTokens(page, { balance: 'unknown' })
    await page.goto('/#ask')
    await page.getByTestId('ask-balance').click()
    await page.getByTestId('buy-have-code').click()
    await page.getByTestId('question-code-input').fill('LQ-ZZZZZ-ZZZZZ')
    await page.getByTestId('question-code-submit').click()
    await expect(page.getByTestId('question-code-error')).toHaveText(EN.ask.codeUnknown)
    expect(await page.evaluate((key) => localStorage.getItem(key), QUESTION_CODE_KEY)).toBeNull()
  })
})

// Criterion 31.
test.describe('the pages that bind', () => {
  test('the Terms say what a token is, what each pack costs, that tokens do not expire and that an unused pack is refundable', async ({ page }) => {
    await page.goto('/#terms')
    const terms = page.getByTestId('terms-tokens')
    await expect(terms).toContainText('A token is one question about one state; a nationwide question costs five.')
    for (const pack of PACKS) await expect(terms).toContainText(`${pack.tokens} tokens for ${priceLabel(pack)}`)
    await expect(terms).toContainText('Tokens do not expire.')
    await expect(terms).toContainText('A pack none of whose tokens has been spent is refundable')
    await expect(terms).toContainText('kept with that code')
  })

  test('the privacy page says a paid question is kept with its code, a free one from a device holding the code is too, and one from a device holding none carries none', async ({ page }) => {
    await page.goto('/#privacy')
    const said = page.getByTestId('privacy-question-tokens')
    await expect(said).toContainText('Every question paid for with a token is kept with that code')
    // Free questions from a device holding a code carry it since the code's
    // history is shown on every device holding it (2026-10-12); a page still
    // saying they carry none would be a false statement about what is kept.
    await expect(said).toContainText('A free question asked on a device holding a code is kept with the code too')
    await expect(said).toContainText('a question from a device holding no code carries none.')
  })

  test('the refund page says an unused pack is refunded and tokens do not expire', async ({ page }) => {
    await page.goto('/#refund')
    const said = page.getByTestId('refund-tokens')
    await expect(said).toContainText('none of which has been spent is refundable')
    await expect(said).toContainText('Tokens do not expire')
  })

  test('the FAQ tells schools and teachers they may buy a pack and share its code, and that the receipt carries the business name', async ({ page }) => {
    await page.goto('/#faq')
    const classroom = page.getByTestId('faq-classroom')
    await expect(classroom).toContainText('Can a school or a teacher buy questions for a class?')
    await expect(classroom).toContainText('share its code with the class')
    await expect(classroom).toContainText('receipt carries the business name')
    await expect(classroom).toContainText('an unused pack is refundable')
    await expect(page.getByTestId('faq-tokens')).toContainText('a nationwide question is five')
    await expect(page.getByTestId('faq-tokens')).toContainText('tokens do not expire')
  })
})

test.describe('the code’s questions, on every device that holds it', () => {
  const ROAD = {
    conversation: '11111111-2222-4333-8444-555555555555',
    question: 'do i stop before the crosswalk?',
    answer: 'Yes. Stop at the stop line, or before the crosswalk where there is none.',
    scope: 'road-law',
    // MD-001 is in Maryland's published corpus; the statute section is not,
    // and is left off the line rather than guessed at.
    sources: ['MD-001', 'MD-C-21-707-a'],
    state: 'MD',
    lang: 'en',
    asked_at: Date.parse('2026-10-11T09:00:00Z') / 1000,
  }
  const APP = {
    conversation: '11111111-2222-4333-8444-555555555555',
    question: 'can i use it on my laptop?',
    answer: 'Yes, on up to 5 devices.',
    scope: 'app',
    sources: ['paying'],
    state: 'MD',
    lang: 'en',
    asked_at: Date.parse('2026-10-11T09:05:00Z') / 1000,
  }

  async function stubHistory(page: Page, rows: unknown[]): Promise<string[]> {
    const asked: string[] = []
    await page.route(`${API}/api/questions/history*`, (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('code') ?? '')
      return route.fulfill({ json: { code: CODE, questions: rows } })
    })
    return asked
  }

  test('a device that restores a code with “I have a code” shows the code’s questions and answers, folded, with the sources line rebuilt from Maryland’s corpus', async ({ page }) => {
    await stubTokens(page, { balance: { code: CODE, left: 72 } })
    // Newest first, as the worker answers.
    const asked = await stubHistory(page, [APP, ROAD])
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-exchange')).toHaveCount(0)
    await page.getByTestId('ask-balance').click()
    await page.getByTestId('buy-have-code').click()
    await page.getByTestId('question-code-input').fill('lq abcde 12345')
    await page.getByTestId('question-code-submit').click()

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(2)
    expect(asked).toContain(CODE)
    // Newest first: the app question was asked five minutes after the road one.
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText(APP.question)
    await expect(exchanges.nth(1).getByTestId('ask-exchange-toggle')).toContainText(ROAD.question)
    await expect(exchanges.nth(0)).toHaveAttribute('data-open', 'false')
    await expect(exchanges.nth(1)).toHaveAttribute('data-open', 'false')

    await exchanges.nth(1).getByTestId('ask-exchange-toggle').click()
    const road = exchanges.nth(1)
    await expect(road.getByTestId('ask-answer')).toContainText(ROAD.answer)
    await expect(road.getByTestId('ask-sources-line')).toContainText('Maryland driver’s manual p. 21')
    await road.getByTestId('ask-sources-open').click()
    await expect(road.getByTestId('ask-citation')).toHaveCount(1)
    await expect(road.getByTestId('ask-citation')).toContainText('complete stop at the stop line')

    await exchanges.nth(0).getByTestId('ask-exchange-toggle').click()
    await expect(exchanges.nth(0).getByTestId('ask-answer')).toContainText(APP.answer)
    await expect(exchanges.nth(0).getByTestId('ask-sources-line')).toHaveCount(0)
  })

  test('a device already holding the code reads the history on load, and a question it kept itself is not shown twice', async ({ page }) => {
    await holding(page, CODE)
    await stubTokens(page)
    await page.addInitScript(
      ([value]) => {
        if (sessionStorage.getItem('cloud-kept') !== null) return
        sessionStorage.setItem('cloud-kept', '1')
        localStorage.setItem('teach-and-test/v1/ask-thread', value)
      },
      [
        JSON.stringify([
          {
            question: APP.question,
            answer: { id: 'answer', answer: APP.answer, sources: [{ id: 'paying', title: 'Paying', page: '#terms' }] },
            state: 'MD',
            // The device's clock, a few seconds off the worker's.
            askedAt: new Date(APP.asked_at * 1000 - 4000).toISOString(),
            conversation: APP.conversation,
          },
        ]),
      ],
    )
    await stubHistory(page, [APP, ROAD])
    await page.goto('/#ask')

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(2)
    await expect(exchanges.nth(1).getByTestId('ask-exchange-toggle')).toContainText(ROAD.question)
    await exchanges.nth(0).getByTestId('ask-exchange-toggle').click()
    // The device's own copy, with the Read more link the cloud's cannot rebuild.
    await expect(exchanges.nth(0).getByTestId('ask-source-link')).toHaveText('Paying')
  })

  test('shows a quick follow-up whose answer this device never received, rather than taking it for the question before it', async ({ page }) => {
    await holding(page, CODE)
    await stubTokens(page)
    await page.addInitScript(
      ([value]) => {
        if (sessionStorage.getItem('cloud-follow-up') !== null) return
        sessionStorage.setItem('cloud-follow-up', '1')
        localStorage.setItem('teach-and-test/v1/ask-thread', value)
      },
      [
        JSON.stringify([
          { question: ROAD.question, answer: { id: 'answer', answer: ROAD.answer }, state: 'MD', askedAt: new Date(ROAD.asked_at * 1000).toISOString(), conversation: ROAD.conversation },
        ]),
      ],
    )
    // Thirty seconds after the first, in the same conversation: answered on
    // the worker, lost on the way back to this device.
    const followUp = { ...ROAD, question: 'and if there is no crosswalk?', answer: 'Stop before entering the intersection.', asked_at: ROAD.asked_at + 30 }
    await stubHistory(page, [followUp, ROAD])
    await page.goto('/#ask')

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(2)
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText(followUp.question)
  })

  // Joel, 2026-10-13: a delete control on each question. The worker still
  // holds a deleted exchange, so without the device remembering the deletion
  // the history read on the next load merged it straight back in, folded.
  // Mutation: pass `cloud` to the box in place of `withoutDeleted(cloud, deleted)`.
  test('a question deleted on this device does not come back from the code’s history on the next load', async ({ page }) => {
    await holding(page, CODE)
    await stubTokens(page)
    await stubHistory(page, [APP, ROAD])
    await page.goto('/#ask')

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(2)
    await expect(exchanges.nth(1).getByTestId('ask-exchange-toggle')).toContainText(ROAD.question)
    await exchanges.nth(1).getByTestId('ask-exchange-delete').click()
    await expect(exchanges).toHaveCount(1)

    await page.reload()
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText(APP.question)
    await expect(exchanges).toHaveCount(1)
  })

  test('sends the held code with a free question, and spends nothing', async ({ page }) => {
    await holding(page, CODE)
    await stubTokens(page)
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await askOnPage(page, 'a free one')
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    expect(sent[0]).toMatchObject({ question: 'a free one', code: CODE })
    expect(sent[0].spend).toBeUndefined()
  })

  test('sends no code from a device that holds none', async ({ page }) => {
    const sent = await stubAsk(page, [{ json: ANSWER }])
    await page.goto('/#ask')
    await askOnPage(page, 'a free one')
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    expect(sent[0]).not.toHaveProperty('code')
  })
})
