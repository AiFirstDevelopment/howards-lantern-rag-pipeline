import { expect, test, type Page } from '@playwright/test'
import { STRINGS } from '../../src/strings'
import { seed } from './app'

/**
 * The one line under a road-law answer, and the law one tap below it.
 *
 * Joel asked "How can I get into trouble using my highbeams?" on his phone,
 * Maryland chosen, on 2026-10-11, and got two sentences above five quoted
 * citation paragraphs, each with its own "as of" line: "way too detailed and
 * verbose. This is for teenagers." The answer below is that answer's five
 * citations exactly as production sent them, stubbed at the network edge so
 * what the box draws can only have come from the wire.
 */

const API = 'https://paywall.test.invalid'
const LANG_KEY = 'teach-and-test/v1/lang'
const EN = STRINGS.en
const ES = STRINGS.es

const HIGH_BEAMS = {
  id: 'answer',
  answer:
    'You must switch to low beams at least 500 feet before you reach a car coming toward you, and Maryland law also says you can’t use high beams when you’re within 300 feet behind another car. If an officer stops you for either one, you get a $60 ticket that you can pay without going to court, with no points.',
  citations: [
    { id: 'MD-101', location: "p.27 (printed) — 'Change to low beams at least 500 feet before reaching vehicles coming toward you.'", asOf: '2026-09-06' },
    {
      id: 'MD-C-22-223-b',
      location: "Md. Code, Transp. § 22-223(b) — '(b) Whenever the driver of a vehicle approaches an oncoming vehicle within 500 feet, the driver shall use a distribution of light'",
      kind: 'statute',
      asOf: '2026-10-06',
    },
    {
      id: 'MD-C-22-223-c',
      location: "Md. Code, Transp. § 22-223(c) — '(c) Whenever the driver of a vehicle approaches another vehicle from the rear, within 300 feet, the driver shall use a distribution of light'",
      kind: 'statute',
      asOf: '2026-10-06',
    },
    {
      id: 'MD-P-22-223-b',
      location: "District Court of Maryland, DC-CR-090 (Rev. 10/2026) — '22 223 b Driver failure to dim lights when within 500 feet of oncoming vehicle $ 60.00 00'",
      kind: 'penalty',
      asOf: '2026-10-11',
    },
    {
      id: 'MD-P-22-223-c',
      location: "District Court of Maryland, DC-CR-090 (Rev. 10/2026) — '22 223 c Driver failure to reduce light distribution when within 300 feet approaching veh. from rear $ 60.00 00'",
      kind: 'penalty',
      asOf: '2026-10-11',
    },
  ],
}

const UNDER_THE_ANSWER = [
  'Maryland driver’s manual p. 27',
  'Md. Code, Transp. § 22-223',
  'District Court of Maryland, DC-CR-090 (Rev. 10/2026)',
].join(' · ')

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
    [LANG_KEY, `sources-line-lang-${(marker += 1)}`],
  )
}

test.describe('the sources under a road-law answer', () => {
  test('shows one line naming the documents and none of the law’s quoted paragraphs until the line is tapped', async ({ page }) => {
    await stubAsk(page, HIGH_BEAMS)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'How can I get into trouble using my highbeams?')

    await expect(page.getByTestId('ask-answer')).toContainText('$60 ticket')
    await expect(page.getByTestId('ask-sources-line')).toBeVisible()
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).not.toContainText('approaches another vehicle from the rear')

    await page.getByTestId('ask-sources-open').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(5)
    await expect(page.getByTestId('ask-citation').nth(2)).toBeVisible()
    await expect(page.getByTestId('ask-citation-asof')).toHaveCount(5)
    await expect(page.getByTestId('ask-sources-open')).toHaveText(EN.ask.labels.hideLaw)

    // And folds again, for a learner who opened it to look and is done.
    await page.getByTestId('ask-sources-open').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
  })

  test('names the manual once with its page, a code section once for its two subsections, and the fine schedule once for its two rows', async ({ page }) => {
    await stubAsk(page, HIGH_BEAMS)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'How can I get into trouble using my highbeams?')

    const line = page.getByTestId('ask-sources-line')
    await expect(line).toContainText(EN.ask.labels.sourcesLine(UNDER_THE_ANSWER))
    await expect(line).not.toContainText('22-223(b)')
    await expect(line).not.toContainText('22-223(c)')
  })

  test('dates the line once, by the earliest of its rows’ dates, where every row carries one', async ({ page }) => {
    await stubAsk(page, HIGH_BEAMS)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'How can I get into trouble using my highbeams?')

    await expect(page.getByTestId('ask-sources-asof')).toHaveText(EN.ask.labels.asOf('2026-09-06'))
    await expect(page.getByTestId('ask-sources-line')).toContainText(`${UNDER_THE_ANSWER} · as of 6 Sep 2026`)
  })

  // A date on the line covers every row under it; with one row undated, a
  // date there would claim a check of that row nobody made.
  test('dates no line one of whose rows came without a date', async ({ page }) => {
    const [first, ...rest] = HIGH_BEAMS.citations
    await stubAsk(page, { ...HIGH_BEAMS, citations: [{ id: first.id, location: first.location }, ...rest] })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'How can I get into trouble using my highbeams?')

    await expect(page.getByTestId('ask-sources-line')).toContainText(UNDER_THE_ANSWER)
    await expect(page.getByTestId('ask-sources-asof')).toHaveCount(0)
  })

  test('lists several manual pages after the manual’s name once', async ({ page }) => {
    const pages = [
      { id: 'MD-S01', location: "p.32 (printed) — 'Do not park within 15 feet of a fire hydrant.'", asOf: '2026-09-06' },
      HIGH_BEAMS.citations[0],
    ]
    await stubAsk(page, { ...HIGH_BEAMS, citations: pages })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'How can I get into trouble using my highbeams?')

    await expect(page.getByTestId('ask-sources-line')).toContainText(EN.ask.labels.sourcesLine('Maryland driver’s manual pp. 27, 32 · as of 6 Sep 2026'))
  })

  test('names a schedule whose title holds a dash by its whole title, and a state’s own page by its agency and title', async ({ page }) => {
    const citations = [
      {
        id: 'FL-P-318-18-2-b',
        location: "The 2026 Florida Statutes — 318.18 Amount of penalties. — '(b) For a nonmoving traffic violation, $30.'",
        kind: 'penalty',
        asOf: '2026-10-11',
      },
      {
        id: 'FL-R-ticket-procedure-1',
        location: "Florida Highway Safety and Motor Vehicles — Traffic Citations — 'You have 30 days to pay the citation.'",
        kind: 'process',
        asOf: '2026-10-11',
      },
    ]
    await stubAsk(page, { id: 'answer', answer: 'It’s a $30 ticket.', citations })
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, 'What happens if I don’t have my license with me?')

    await expect(page.getByTestId('ask-sources-line')).toContainText(
      EN.ask.labels.sourcesLine('The 2026 Florida Statutes — 318.18 Amount of penalties. · Florida Highway Safety and Motor Vehicles — Traffic Citations · as of 11 Oct 2026'),
    )
  })

  test('says the line and the tap in Spanish to a Spanish learner, the manual named as the English one', async ({ page }) => {
    await stubAsk(page, HIGH_BEAMS)
    await chosenSpanish(page)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, '¿Cómo me puedo meter en problemas con las luces altas?')

    const line = page.getByTestId('ask-sources-line')
    await expect(line).toContainText(
      ES.ask.labels.sourcesLine(['Manual de Maryland en inglés, p. 27', 'Md. Code, Transp. § 22-223', 'District Court of Maryland, DC-CR-090 (Rev. 10/2026)'].join(' · ')),
    )
    await expect(page.getByTestId('ask-sources-asof')).toHaveText('vigente al 6 sep 2026')
    await expect(page.getByTestId('ask-sources-open')).toHaveText(ES.ask.labels.showLaw)
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
    await page.getByTestId('ask-sources-open').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(5)
  })

  test('draws no line under an answer with nothing cited', async ({ page }) => {
    await stubAsk(page, { id: 'answer', answer: 'Your insurer decides what you pay.', citations: [] })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'Will my insurance go up?')

    await expect(page.getByTestId('ask-answer')).toContainText('Your insurer decides')
    await expect(page.getByTestId('ask-sources-line')).toHaveCount(0)
    await expect(page.getByTestId('ask-sources-open')).toHaveCount(0)
  })
})

test.describe('the sources under a nationwide answer', () => {
  const STATES = ['Utah', 'California', 'Texas', 'Ohio', 'Iowa', 'Idaho', 'Maine', 'Oregon']
  const NATIONWIDE_ANSWER = {
    id: 'answer',
    answer: 'Utah is the strictest at 0.05; most states set 0.08.',
    citations: STATES.map((state, index) => ({
      id: `${state.slice(0, 2).toUpperCase()}-${index}`,
      location: `p.${index + 10} (printed) — 'A driver over the limit is in violation.'`,
      state,
      asOf: '2026-10-06',
    })),
    absent: ['Wyoming'],
  }

  test('names the first two states and counts the rest on one line, and opens their citations, still folded after six, on the tap', async ({ page }) => {
    await stubAsk(page, NATIONWIDE_ANSWER)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, 'Which state is strictest on drinking and driving?')

    await expect(page.getByTestId('ask-sources-line')).toContainText(EN.ask.labels.sourcesLine('Utah, California and 6 more states’ laws · as of 6 Oct 2026'))
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
    await expect(page.getByTestId('ask-citations-more')).toHaveCount(0)

    await page.getByTestId('ask-sources-open').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(6)
    await expect(page.getByTestId('ask-citations-more')).toHaveText(EN.ask.labels.moreStates(2))
    await page.getByTestId('ask-citations-more').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(8)
  })

  test('names the states in Spanish to a Spanish learner', async ({ page }) => {
    await stubAsk(page, NATIONWIDE_ANSWER)
    await chosenSpanish(page)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, '¿Qué estado es el más estricto con el alcohol?')

    await expect(page.getByTestId('ask-sources-line')).toContainText(ES.ask.labels.sourcesLine('leyes de Utah, California y 6 estados más · vigente al 6 oct 2026'))
  })
})
