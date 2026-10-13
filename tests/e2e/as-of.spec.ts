import { expect, test, type Page } from '@playwright/test'
import { STRINGS } from '../../src/strings'
import { METHOD_PAGE } from '../../src/method-page'
import { TOTAL, seed } from './app'

/**
 * The date under a road-law citation, and the way to the page that says what
 * it means (docs/plans/trusted-by-date.md, decisions 7 and 8), from the
 * outside: the worker is stubbed at the network edge with a fixed date, so
 * what the box draws can only have come from the wire. The real pipeline's
 * date -- the published file's, through the worker's own `answerLearner` -- is
 * held in learner-ask-law.spec.ts; the served pages in routing.spec.ts.
 */

const API = 'https://paywall.test.invalid'
const LANG_KEY = 'teach-and-test/v1/lang'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const EN = STRINGS.en
const ES = STRINGS.es

/** A date no clock this suite runs on will read as today, so a box that drew its own date cannot pass. */
const FETCHED = '2026-10-06'

const DATED = {
  id: 'answer',
  answer: 'At least 15 feet from the hydrant.',
  citations: [
    { id: 'FL-399', location: "p.66 (printed) — 'Do not park within 15 feet of a fire hydrant.'", asOf: FETCHED },
    { id: 'MD-C-21-1003-m', location: "Md. Code, Transp. § 21-1003(m) — 'within 15 feet of a fire hydrant'", kind: 'statute', asOf: FETCHED },
  ],
}

async function stubAsk(page: Page, body: unknown): Promise<void> {
  await page.route(`${API}/api/ask`, (route) => route.fulfill({ json: body }))
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
}

async function askOnPage(page: Page, question: string): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
}

let marker = 0
async function chosenSpanish(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, flag]) => {
      if (sessionStorage.getItem(flag) !== null) return
      sessionStorage.setItem(flag, '1')
      localStorage.setItem(key, 'es')
    },
    [LANG_KEY, `as-of-lang-${(marker += 1)}`],
  )
}

test.describe('the date under a citation', () => {
  // AC10, guard 8. The worker's date, written the learner's way, under the
  // manual's citation and the code's alike.
  test('shows under each citation the date the worker sent, as 6 Oct 2026, and not today', async ({ page }) => {
    await stubAsk(page, DATED)
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, 'How far from a fire hydrant can I park?')
    // Folded under the sources line until tapped (src/sources-line.ts).
    await page.getByTestId('ask-sources-open').click()

    const dates = page.getByTestId('ask-citation').getByTestId('ask-citation-asof')
    await expect(dates).toHaveText(['as of 6 Oct 2026', 'as of 6 Oct 2026'])
  })

  test('says it in Spanish to a Spanish learner', async ({ page }) => {
    await stubAsk(page, DATED)
    await chosenSpanish(page)
    // Maryland: Spanish is offered only where a state's Spanish pack is built.
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, '¿A qué distancia de un hidrante puedo estacionar?')
    await page.getByTestId('ask-sources-open').click()

    await expect(page.getByTestId('ask-citation-asof').first()).toHaveText(ES.ask.labels.asOf(FETCHED))
    await expect(page.getByTestId('ask-citation-asof').first()).toHaveText('vigente al 6 oct 2026')
  })

  // The index path reads laws from a table with no date: a citation the
  // worker sent undated is drawn undated, never dated today.
  test('draws no date under a citation the worker sent without one', async ({ page }) => {
    await stubAsk(page, { ...DATED, citations: [{ id: 'FL-399', location: DATED.citations[0].location }] })
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, 'How far from a fire hydrant can I park?')
    await page.getByTestId('ask-sources-open').click()

    await expect(page.getByTestId('ask-citation')).toHaveCount(1)
    await expect(page.getByTestId('ask-citation-asof')).toHaveCount(0)
    await expect(page.getByTestId('ask-sources-asof')).toHaveCount(0)
  })
})

test.describe('the way to the method page', () => {
  // AC12 once had the ask page's notice link the method page too; the notice
  // is gone (Joel, 2026-10-13), so on the ask page the footer is the way.
  test('on the ask page there is no notice, and the footer is the way to the method page', async ({ page }) => {
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-input')).toBeVisible()
    await expect(page.getByTestId('ask-notice')).toHaveCount(0)
    await expect(page.getByTestId('ask-method-link')).toHaveCount(0)
    await expect(page.getByTestId('site-footer-method')).toHaveAttribute('href', METHOD_PAGE)
  })

  // AC12: the footer links it on every screen it is drawn on.
  test('links the method page from the footer', async ({ page }) => {
    await seed(page, FRESH)
    await page.goto('/')
    await expect(page.getByTestId('site-footer-method')).toHaveText(EN.footer.method)
    await expect(page.getByTestId('site-footer-method')).toHaveAttribute('href', METHOD_PAGE)
  })
})
