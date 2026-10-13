import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PARTNER_QUESTION_RETENTION_DAYS } from '../../src/legal'
import { STRINGS } from '../../src/strings'
import { ASK_WEEKLY_LIMITS, ASK_QUOTA_KEY, daysUntilReset, localWeek } from '../../src/ask-quota'
import { TOTAL, expectNoHorizontalScroll, onStudyCard, progressCounter, seed } from './app'

/**
 * The learner's ask page, from the outside (docs/plans/learner-ask.md).
 *
 * The worker is stubbed at the network edge, which makes this a test of the
 * page: that what the worker answers is what is drawn, that a refusal of scope
 * shows the worker's pointer and never an answer, that the box speaks Spanish
 * when the app does, that the two doors open it, and that the privacy page says
 * what it now has to. That the model's text reaches the wire only through the
 * checks is held in workerd by worker/tests/learner-ask.test.ts.
 */

const API = 'https://paywall.test.invalid'
const ANALYTICS = 'https://analytics.test.invalid'
const LANG_KEY = 'teach-and-test/v1/lang'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const EN = STRINGS.en
const ES = STRINGS.es

interface Sent {
  conversation: string
  question: string
  turnstile: string
  lang: string
  state: string | null
}

/** The worker, answering whatever the test says, and recording what it was sent. */
async function stubAsk(page: Page, answers: unknown[]): Promise<Sent[]> {
  const sent: Sent[] = []
  let next = 0
  await page.route(`${API}/api/ask`, (route) => {
    sent.push(route.request().postDataJSON() as Sent)
    const body = answers[Math.min(next, answers.length - 1)]
    next += 1
    return route.fulfill({ json: body })
  })
  return sent
}

/** Cloudflare's challenge, answered at once. */
async function stubChallenge(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
}

/**
 * The event names the worker accepts, read off its source rather than imported:
 * src/analytics.ts pulls the corpus loader in behind it, which Playwright's
 * transform cannot parse, and tests/unit/event-vocabulary.test.ts already holds
 * the app's list to this one.
 */
const ACCEPTED_EVENTS: string[] = (() => {
  const source = readFileSync(path.join(process.cwd(), 'worker/src/analytics.ts'), 'utf8')
  const block = /export const EVENT_NAMES = \[([^\]]+)\]/.exec(source)
  if (block === null) throw new Error('worker/src/analytics.ts no longer declares EVENT_NAMES')
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
})()

let marker = 0
async function chosenSpanish(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, flag]) => {
      if (sessionStorage.getItem(flag) !== null) return
      sessionStorage.setItem(flag, '1')
      localStorage.setItem(key, 'es')
    },
    [LANG_KEY, `ask-lang-${(marker += 1)}`],
  )
}

async function askOnPage(page: Page, question: string): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
}

const ANSWER = {
  id: 'answer',
  answer: 'Yes. The recovery code on your receipt moves your purchase to up to 5 devices.',
  sources: [
    { id: 'paying', title: 'Paying', page: '#terms' },
    { id: 'faq-account', title: 'Do I need an account?', page: '#faq' },
  ],
}

test.describe('the button in the top bar', () => {
  // The bubble beside the menu button opened feedback until this shipped. A
  // learner mid-card is the person most likely to have a question, so the
  // detour has to land back on the same card, not the start of the pass.
  test('opens the page from a study card and comes back to the same card', async ({ page }) => {
    await seed(page, { studyIndex: 1 })
    await page.goto('/')
    await onStudyCard(page, 1)
    const counter = await progressCounter(page).innerText()
    await page.getByTestId('ask-trigger').click()
    await expect(page.getByRole('heading', { name: EN.ask.title, level: 1 })).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe('#ask')
    await page.getByTestId('ask-back').click()
    await expect(progressCounter(page)).toHaveText(counter)
  })

  // It shipped as a bare speech bubble and the first person to see it on a
  // phone asked where "Ask a question" had gone: the words have to be on the
  // button, not only in its accessible name.
  test('says “Ask a question” on the button at 375px, and the footer link says the same', async ({ page }) => {
    await seed(page, {}, { stateChosen: false })
    await page.goto('/')
    const trigger = page.getByTestId('ask-trigger')
    await expect(trigger).toHaveAttribute('aria-label', EN.ask.title)
    // innerText, so the words have to be drawn, not merely present.
    await expect(trigger).toHaveText(EN.ask.title, { useInnerText: true })
    await expect(page.getByTestId('site-footer-ask')).toHaveText(EN.ask.title)
    // And the name beside it is still whole, not pushed under it or cut.
    const name = page.getByTestId('site-name')
    if ((await name.count()) > 0) {
      const nameBox = await name.boundingBox()
      const triggerBox = await trigger.boundingBox()
      expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(triggerBox!.x)
    }
    await expectNoHorizontalScroll(page, 'state picker with the labelled ask button')
  })

  test('says only “Ask” on a 320px phone, with the state name still on screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await seed(page, { studyIndex: 1 })
    await page.goto('/')
    await onStudyCard(page, 1)
    const trigger = page.getByTestId('ask-trigger')
    await expect(trigger).toHaveText(EN.ask.short, { useInnerText: true })
    await expect(trigger).toHaveAttribute('aria-label', EN.ask.title)
    await expect(page.getByTestId('state-name')).toBeVisible()
    await expectNoHorizontalScroll(page, 'study card at 320px with the ask button')
  })

  test('the ask page keeps feedback one tap away, for the learner who came to report a card', async ({
    page,
  }) => {
    await seed(page, FRESH)
    await page.goto('/#ask')
    await page.getByTestId('ask-feedback-link').click()
    await expect(page.getByTestId('feedback-send')).toBeVisible()
  })
})

test.describe('the two doors', () => {
  // Guard 15. A link with the wrong hash renders and does nothing.
  test('the footer’s Ask opens the page, with the hash set', async ({ page }) => {
    await seed(page, {}, { stateChosen: false })
    await page.goto('/')
    await page.getByTestId('site-footer-ask').click()
    await expect(page.getByRole('heading', { name: EN.ask.title, level: 1 })).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe('#ask')
  })

  test('the FAQ’s “Can’t find it?” row opens the page', async ({ page }) => {
    await seed(page, FRESH)
    await page.goto('/#faq')
    await page.getByTestId('faq-ask-link').click()
    await expect(page.getByRole('heading', { name: EN.ask.title, level: 1 })).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe('#ask')
  })
})

test.describe('the page', () => {
  // AC1, as it stands now. The paragraph above the box -- a model writes the
  // answers, what is kept and for how long -- was five lines nobody read
  // above the thing they came for (Joel, 2026-10-13: "no one cares"); the
  // privacy page and the footer's "How it works" say the same. The three
  // example questions used to sit under the box, styled as the free chips
  // are but typed into the box and counted against the week (Joel, 2026-10-12).
  test('puts nothing above the box -- no notice -- and no typed question under it dressed as a chip', async ({ page }) => {
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-input')).toBeVisible()
    await expect(page.getByTestId('ask-notice')).toHaveCount(0)
    await expect(page.getByTestId('ask-example')).toHaveCount(0)
    await expect(page.getByTestId('ask-input')).toBeVisible()
    await expect(page.getByTestId('site-footer')).toBeVisible()
  })

  test('fits a 320px phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-input')).toBeVisible()
    await expectNoHorizontalScroll(page, 'ask page at 320px')
  })
})

test.describe('what the worker answers is what is drawn', () => {
  // Guard 13. The model's sentence, and the pages it rests on, one tap away.
  test('shows the answer with a Read more link to each page it rests on', async ({ page }) => {
    await stubChallenge(page)
    const sent = await stubAsk(page, [ANSWER])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await askOnPage(page, 'can i use it on my laptop as well?')

    await expect(page.getByTestId('ask-answer')).toContainText('Yes. The recovery code')
    const sources = page.getByTestId('ask-sources')
    await expect(sources).toContainText(EN.ask.labels.readMore)
    await expect(sources.getByRole('link', { name: 'Paying' })).toHaveAttribute('href', '#terms')
    await expect(sources.getByRole('link', { name: 'Do I need an account?' })).toHaveAttribute('href', '#faq')
    // The chosen state and the language travel with the question, so the
    // worker picks the right book and can point at the right state's page.
    expect(sent[0].lang).toBe('en')
    expect(sent[0].state).toBe('MD')
    expect(sent[0].turnstile).toBe('a-token')
  })

  // Guard 14. A refusal of scope is the worker's line, never an answer.
  test('shows the worker’s pointer on a road-law question, and no answer', async ({ page }) => {
    await stubChallenge(page)
    const refusal = {
      id: 'no-match',
      pointer: 'I can’t answer road law here. The cards cite your state’s manual rule by rule.',
      pointerHref: '/drivers/MD/',
      contact: 'support@example.test',
      handOff: false,
    }
    await stubAsk(page, [refusal, { ...refusal, handOff: true }])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await askOnPage(page, 'can i turn right on red?')

    const pointer = page.getByTestId('ask-pointer')
    await expect(pointer).toBeVisible()
    await expect(pointer).toContainText('road law')
    await expect(page.getByTestId('ask-pointer-link')).toHaveAttribute('href', '/drivers/MD/')
    // A link with a name, not an arrow: "→" is nothing to a screen reader.
    await expect(page.getByTestId('ask-pointer-link')).toHaveText(EN.ask.labels.statePage)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    await expect(page.getByTestId('ask-contact').first()).toContainText('support@example.test')

    // Two road-law questions in a row is somebody who needs a person: the
    // hand-off line is said beside the second pointer, not swallowed by it.
    await askOnPage(page, 'and can i turn left on red?')
    await expect(page.getByTestId('ask-pointer')).toHaveCount(2)
    // Newest first: the hand-off is the second refusal, drawn above the first.
    await expect(page.getByTestId('ask-no-match').nth(0)).toContainText(EN.ask.labels.handOff)
  })

  test('a plain no-match says so and hands over the address', async ({ page }) => {
    await stubChallenge(page)
    await stubAsk(page, [{ id: 'no-match', contact: 'support@example.test', handOff: false }])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await askOnPage(page, 'what is the meaning of life?')

    await expect(page.getByTestId('ask-no-match')).toContainText(EN.ask.labels.noMatch)
    await expect(page.getByTestId('ask-contact')).toContainText('support@example.test')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })
})

test.describe('in Spanish', () => {
  // Guard 16. A Spanish learner met by an English placeholder would not
  // report it; they would not know it was meant to be otherwise.
  test('the heading, the notice, the box’s labels and the wire are Spanish', async ({ page }) => {
    await stubChallenge(page)
    const sent = await stubAsk(page, [
      { id: 'answer', answer: 'No. Recibe un código de recuperación en su recibo.', sources: [] },
    ])
    await chosenSpanish(page)
    await seed(page, FRESH)
    await page.goto('/#ask')

    await expect(page.getByRole('heading', { name: ES.ask.title, level: 1 })).toBeVisible()
    await expect(page.getByTestId('ask-notice')).toHaveCount(0)
    await expect(page.getByTestId('ask-input')).toHaveAttribute('placeholder', ES.ask.labels.placeholder)
    await expect(page.getByTestId('ask-submit')).toHaveText(ES.ask.labels.button)
    await expect(page.getByTestId('ask-example')).toHaveCount(0)
    expect(await page.locator('#root').innerText()).not.toContain(EN.ask.labels.placeholder)

    await askOnPage(page, '¿necesito una cuenta?')
    await expect(page.getByTestId('ask-answer')).toContainText('No. Recibe')
    expect(sent[0].lang).toBe('es')
  })
})

test.describe('the privacy page', () => {
  // Guard 17. A privacy page that has quietly stopped being true is a specific
  // false statement to somebody who believed it.
  test('says a model writes the answers, what is kept, and that the partner box is no longer the only one', async ({
    page,
  }) => {
    await seed(page, FRESH)
    await page.goto('/#privacy')
    const learner = page.getByTestId('privacy-learner-questions')
    await expect(learner).toBeVisible()
    await expect(learner).toContainText(String(PARTNER_QUESTION_RETENTION_DAYS))
    await expect(learner).toContainText('Anthropic')
    await expect(learner).toContainText('written by a model')
    await expect(page.getByTestId('privacy-partner-questions')).not.toContainText('only free text')
  })
})

test.describe('the view is counted', () => {
  // Guard 18. A page nobody counts is a page whose existence the admin table
  // cannot show; a new event name is a row the worker would drop.
  test('sends one page_viewed with page ask, and nothing the worker does not know', async ({ page }) => {
    const beacons: { name: string; page?: string }[] = []
    await page.route(`${ANALYTICS}/api/event`, (route) => {
      const body = route.request().postData()
      if (body !== null) beacons.push(JSON.parse(body) as { name: string; page?: string })
      return route.fulfill({ status: 204, body: '' })
    })
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByRole('heading', { name: EN.ask.title, level: 1 })).toBeVisible()

    await expect
      .poll(() => beacons.filter((beacon) => beacon.name === 'page_viewed' && beacon.page === 'ask'))
      .toHaveLength(1)
    for (const beacon of beacons) {
      expect(ACCEPTED_EVENTS.includes(beacon.name), beacon.name).toBe(true)
    }
  })
})

/**
 * The week's questions, counted in the browser (src/ask-quota.ts; Joel,
 * 2026-10-10): three nationwide, ten for a state, Monday to Sunday. The
 * worker's ceiling is for the whole site; this one is per visitor, and the
 * modal is what tells them.
 * Every case counts what reached the stubbed worker, because a limit that
 * shows a modal and sends the question anyway is the failure that costs money.
 */
test.describe('the week’s limit on questions', () => {
  const weekShifted = (weeks: number) => {
    const date = new Date()
    date.setDate(date.getDate() + 7 * weeks)
    return localWeek(date)
  }
  async function quotaOf(page: Page, quota: { week: string; state: number; nationwide: number }): Promise<void> {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [ASK_QUOTA_KEY, JSON.stringify(quota)])
  }
  async function answered(page: Page, question: string, count: number): Promise<void> {
    await askOnPage(page, question)
    await expect(page.getByTestId('ask-answer')).toHaveCount(count)
  }
  test.beforeEach(async ({ page }) => {
    await stubChallenge(page)
    await seed(page, FRESH)
  })

  test('stops the fourth nationwide question of the week at a modal, and sends nothing', async ({ page }) => {
    const sent = await stubAsk(page, [ANSWER])
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    for (let n = 1; n <= ASK_WEEKLY_LIMITS.nationwide; n += 1) await answered(page, `nationwide question ${n}`, n)
    await askOnPage(page, 'one more')
    await expect(page.getByTestId('ask-limit-dialog')).toBeVisible()
    await expect(page.getByTestId('ask-limit-body')).toHaveText(EN.ask.limitNationwide(ASK_WEEKLY_LIMITS.nationwide))
    expect(sent).toHaveLength(ASK_WEEKLY_LIMITS.nationwide)
    await expect(page.getByTestId('ask-input')).toHaveValue('one more')
    await page.getByTestId('ask-limit-close').click()
    await expect(page.getByTestId('ask-limit-dialog')).toBeHidden()
  })

  test('stops the eleventh question for a state the same way', async ({ page }) => {
    const sent = await stubAsk(page, [ANSWER])
    await page.goto('/#ask')
    for (let n = 1; n <= ASK_WEEKLY_LIMITS.state; n += 1) await answered(page, `question ${n}`, n)
    await askOnPage(page, 'one more')
    await expect(page.getByTestId('ask-limit-body')).toHaveText(EN.ask.limitState(ASK_WEEKLY_LIMITS.state))
    expect(sent).toHaveLength(ASK_WEEKLY_LIMITS.state)
  })

  test('starts the count again on a new week', async ({ page }) => {
    await quotaOf(page, { week: weekShifted(-1), state: ASK_WEEKLY_LIMITS.state, nationwide: ASK_WEEKLY_LIMITS.nationwide })
    const sent = await stubAsk(page, [ANSWER])
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await answered(page, 'a new week', 1)
    expect(sent).toHaveLength(1)
    await expect(page.getByTestId('ask-limit-dialog')).toHaveCount(0)
  })

  // Joel, 2026-10-10: what is left must be visible where the box is, not on
  // a page of its own, and it must move when a question is sent.
  test('shows the week’s remaining questions beside the box and counts one down after an ask', async ({ page }) => {
    await stubAsk(page, [ANSWER])
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.state, ASK_WEEKLY_LIMITS.state, daysUntilReset(), null))
    await answered(page, 'one question', 1)
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.state - 1, ASK_WEEKLY_LIMITS.state, daysUntilReset(), null))
    // The line is for the kind the box is set to: ticking Nationwide shows that allowance.
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.nationwide, ASK_WEEKLY_LIMITS.nationwide, daysUntilReset(), null))
    await answered(page, 'across the states', 2)
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.nationwide - 1, ASK_WEEKLY_LIMITS.nationwide, daysUntilReset(), null))
  })

  test('counts nationwide and state questions apart', async ({ page }) => {
    await quotaOf(page, { week: weekShifted(0), state: ASK_WEEKLY_LIMITS.state, nationwide: 0 })
    const sent = await stubAsk(page, [ANSWER])
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await answered(page, 'across the states', 1)
    expect(sent).toHaveLength(1)
    await page.getByTestId('ask-nationwide').uncheck()
    await askOnPage(page, 'for my state')
    await expect(page.getByTestId('ask-limit-body')).toHaveText(EN.ask.limitState(ASK_WEEKLY_LIMITS.state))
    expect(sent).toHaveLength(1)
  })
})
