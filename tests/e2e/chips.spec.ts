import { expect, test, type Page } from '@playwright/test'
import { ASK_WEEKLY_LIMITS, ASK_QUOTA_KEY } from '../../src/ask-quota'
import { CHIPS_PATH, CHIPS_TAPPED_KEY, type StoredChip } from '../../src/chips'
import { STRINGS } from '../../src/strings'
import { TOTAL, seed } from './app'

/**
 * The chips under the nationwide box (docs/plans/trusted-by-date.md,
 * decisions 17 and 18), from the outside.
 *
 * A chip is a stored answer: the claims worth a browser are that it is drawn
 * exactly as a live answer, that tapping it never reaches the worker or the
 * week's count -- the failure that would cost a teacher her class's questions
 * -- that the three change from load to load, and that a tapped one is not
 * offered again until the rest have been. The published file is replaced with
 * a pool of nine wherever the claim is about the drawing, so it does not
 * depend on how many chips the last build stored.
 */

const API = 'https://paywall.test.invalid'
const ANALYTICS = 'https://analytics.test.invalid'
const LANG_KEY = 'teach-and-test/v1/lang'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const EN = STRINGS.en

function chip(n: number, lang = 'en'): StoredChip {
  return {
    id: `chip-${n}`,
    lang,
    question: lang === 'en' ? `Fact number ${n}?` : `¿Dato número ${n}?`,
    answer: lang === 'en' ? `Utah sets 0.05 for fact ${n}; Nebraska law sets 0.08.` : `Utah fija 0.05 para el dato ${n}; la ley de Nebraska fija 0.08.`,
    sources: [
      { id: 'UT-12', location: "p.52 (printed) — 'A driver over 0.05 is in violation.'", state: 'Utah', asOf: '2026-10-06' },
      { id: 'NE-C-7', location: "Neb. Rev. Stat. § 60-6,196 — 'a concentration of eight-hundredths'", kind: 'statute', state: 'Nebraska', asOf: '2026-10-04' },
    ],
    absent: ['Wyoming'],
    asOf: '2026-10-10',
  }
}
const NINE = [...Array.from({ length: 9 }, (_, index) => chip(index + 1)), ...Array.from({ length: 9 }, (_, index) => chip(index + 1, 'es'))]

async function pool(page: Page, chips: StoredChip[] = NINE): Promise<void> {
  await page.route(`**${CHIPS_PATH}`, (route) => route.fulfill({ json: chips }))
}

/** The worker's /api/ask, answering every question and recording each one it was sent. */
async function stubAsk(page: Page): Promise<unknown[]> {
  const sent: unknown[] = []
  await page.route(`${API}/api/ask`, (route) => {
    sent.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: 'answer', answer: 'A live answer.', citations: [] } })
  })
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
  return sent
}

async function nationwide(page: Page): Promise<void> {
  await page.goto('/#ask')
  await page.getByTestId('ask-nationwide').check()
}

async function shownIds(page: Page): Promise<string[]> {
  await expect(page.getByTestId('ask-chip')).not.toHaveCount(0)
  return page.getByTestId('ask-chip').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-chip') ?? ''))
}

/** The tapped list as the test starts it: written on the first load only, so a reload reads what the page wrote. */
async function tappedOf(page: Page, ids: string[]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('chips-seeded') !== null) return
      sessionStorage.setItem('chips-seeded', '1')
      localStorage.setItem(key, value)
    },
    [CHIPS_TAPPED_KEY, JSON.stringify(ids)],
  )
}

test.beforeEach(async ({ page }) => {
  await seed(page, FRESH)
})

test.describe('the chips in nationwide mode', () => {
  // AC20, against the file the build published rather than a fixture: the
  // stored answers reach the box, three at a time, only while ticked.
  test('shows three chips from the published answers while Nationwide is ticked, and none for a state', async ({ page }) => {
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-input')).toBeVisible()
    await expect(page.getByTestId('ask-chip')).toHaveCount(0)
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chip')).toHaveCount(3)
    await page.getByTestId('ask-nationwide').uncheck()
    await expect(page.getByTestId('ask-chip')).toHaveCount(0)
  })

  // Guard 21. Mutation: take the first three of the pool.
  test('draws a different three across ten reloads of a pool of nine', async ({ page }) => {
    await pool(page)
    await nationwide(page)
    const triples = new Set<string>()
    for (let load = 0; load < 10; load += 1) {
      if (load > 0) {
        await page.reload()
        await page.getByTestId('ask-nationwide').check()
      }
      const ids = await shownIds(page)
      expect(ids).toHaveLength(3)
      triples.add([...ids].sort().join(','))
    }
    expect(triples.size).toBeGreaterThan(1)
  })

  // Guard 22. Five of nine already tapped leaves four; tapping one of the
  // three shown leaves exactly three, so every later load must show those and
  // never the tapped one. Mutation: never write the tapped list.
  test('never offers a tapped chip again until every chip has been tapped, then offers the whole pool', async ({ page }) => {
    await pool(page)
    await tappedOf(page, ['chip-1', 'chip-2', 'chip-3', 'chip-4', 'chip-5'])
    await nationwide(page)
    const first = await shownIds(page)
    expect(first.every((id) => ['chip-6', 'chip-7', 'chip-8', 'chip-9'].includes(id))).toBe(true)
    const tapped = first[0]
    await page.locator(`[data-testid="ask-chip"][data-chip="${tapped}"]`).click()
    await expect(page.getByTestId('ask-chip-answer')).toHaveCount(1)
    const rest = ['chip-6', 'chip-7', 'chip-8', 'chip-9'].filter((id) => id !== tapped).sort()
    for (let load = 0; load < 5; load += 1) {
      await page.reload()
      await page.getByTestId('ask-nationwide').check()
      expect([...(await shownIds(page))].sort(), `load ${load + 1}`).toEqual(rest)
    }
    // The last three tapped: every chip has been, so the list starts again.
    for (const id of rest) await page.locator(`[data-testid="ask-chip"][data-chip="${id}"]`).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), CHIPS_TAPPED_KEY)).toBeNull()
    await page.reload()
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chip')).toHaveCount(3)
  })
})

test.describe('a pool spent in one language only', () => {
  // The tapped ids are shared by both languages; a Spanish pool every id of
  // which was tapped in English must not leave a Spanish visitor an empty row
  // while the list waits on English chips (verifier, 2026-10-10).
  test('offers the whole pool again when every chip of this language is tapped', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, 'es'), LANG_KEY)
    await pool(page, [...Array.from({ length: 9 }, (_, index) => chip(index + 1)), chip(1, 'es'), chip(2, 'es'), chip(3, 'es')])
    await tappedOf(page, ['chip-1', 'chip-2', 'chip-3'])
    await nationwide(page)
    expect([...(await shownIds(page))].sort()).toEqual(['chip-1', 'chip-2', 'chip-3'])
  })
})

test.describe('a tapped chip', () => {
  // AC21: drawn as a live nationwide answer is -- citations by state, the
  // statute labelled, the date under each, the absent line.
  test('shows its stored answer in the thread with each citation’s state and date, and the absent line', async ({ page }) => {
    await pool(page, [chip(1), chip(2), chip(3)])
    await nationwide(page)
    await page.locator('[data-testid="ask-chip"][data-chip="chip-2"]').click()
    const entry = page.getByTestId('ask-chip-answer')
    await expect(entry).toContainText('Fact number 2?')
    await expect(entry.getByTestId('ask-answer')).toContainText('Utah sets 0.05 for fact 2; Nebraska law sets 0.08.')
    // Folded under the sources line until tapped, as a live answer's are (src/sources-line.ts).
    await entry.getByTestId('ask-sources-open').click()
    await expect(entry.getByTestId('ask-citation-state')).toHaveText(['Utah', 'Nebraska'])
    await expect(entry.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.52'))
    await expect(entry.getByTestId('ask-citation-law')).toHaveText(EN.ask.labels.inTheLaw('Neb. Rev. Stat. § 60-6,196'))
    await expect(entry.getByTestId('ask-citation-asof')).toHaveText([EN.ask.labels.asOf('2026-10-06'), EN.ask.labels.asOf('2026-10-04')])
    await expect(entry.getByTestId('ask-absent')).toHaveText(EN.ask.labels.absent('Wyoming'))
    // Gone from the row once tapped, so the same fact is not offered twice on one screen.
    await expect(page.locator('[data-testid="ask-chip"][data-chip="chip-2"]')).toHaveCount(0)
  })

  // Guard 20, AC21. A tap reaches nothing; then, the week's three nationwide
  // questions spent, a tap still answers, nothing reaches /api/ask, and the
  // count is where it was. Mutation: route the tap through `send`.
  test('answers after the week’s nationwide questions are spent, sends nothing to the worker, and leaves the count alone', async ({ page }) => {
    await pool(page)
    const sent = await stubAsk(page)
    await nationwide(page)
    await page.getByTestId('ask-chip').first().click()
    await expect(page.getByTestId('ask-answer')).toHaveCount(1)
    expect(sent).toHaveLength(0)
    for (let n = 1; n <= ASK_WEEKLY_LIMITS.nationwide; n += 1) {
      await page.getByTestId('ask-input').fill(`live question ${n}`)
      await page.getByTestId('ask-submit').click()
      await expect(page.getByTestId('ask-answer')).toHaveCount(n + 1)
    }
    expect(sent).toHaveLength(ASK_WEEKLY_LIMITS.nationwide)
    await page.getByTestId('ask-chip').first().click()
    await expect(page.getByTestId('ask-chip-answer')).toHaveCount(2)
    await expect(page.getByTestId('ask-chip-answer').nth(0).getByTestId('ask-answer')).toBeVisible()
    await expect(page.getByTestId('ask-limit-dialog')).toHaveCount(0)
    expect(sent).toHaveLength(ASK_WEEKLY_LIMITS.nationwide)
    const quota = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), ASK_QUOTA_KEY)) ?? '{}') as { nationwide?: number }
    expect(quota.nationwide).toBe(ASK_WEEKLY_LIMITS.nationwide)
  })

  // AC22: counted with its id and nothing else, and no question sent, so no
  // learner_questions row can be written.
  test('sends chip_tapped with the chip’s id and nothing else, and no question', async ({ page }) => {
    await pool(page)
    const sent = await stubAsk(page)
    const beacons: Record<string, unknown>[] = []
    await page.route(`${ANALYTICS}/api/event`, (route) => {
      const body = route.request().postData()
      if (body !== null) beacons.push(JSON.parse(body) as Record<string, unknown>)
      return route.fulfill({ status: 204, body: '' })
    })
    await nationwide(page)
    const [id] = await shownIds(page)
    await page.locator(`[data-testid="ask-chip"][data-chip="${id}"]`).click()
    await expect.poll(() => beacons.filter((beacon) => beacon.name === 'chip_tapped')).toHaveLength(1)
    const beacon = beacons.find((each) => each.name === 'chip_tapped')!
    expect(beacon.chip).toBe(id)
    expect(Object.keys(beacon).filter((key) => !['session', 'device', 'site', 'product', 'name', 'chip'].includes(key))).toEqual([])
    expect(sent).toHaveLength(0)
  })

  test('is offered and answered in Spanish when the app is in Spanish', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, 'es'), LANG_KEY)
    await pool(page)
    await nationwide(page)
    await expect(page.getByTestId('ask-chips')).toContainText(STRINGS.es.ask.chipsLabel)
    await expect(page.getByTestId('ask-chip').first()).toContainText('¿Dato número')
    await page.getByTestId('ask-chip').first().click()
    await expect(page.getByTestId('ask-chip-answer').getByTestId('ask-answer')).toContainText('Utah fija 0.05')
    await page.getByTestId('ask-chip-answer').getByTestId('ask-sources-open').click()
    await expect(page.getByTestId('ask-chip-answer').getByTestId('ask-citation-asof').first()).toHaveText(STRINGS.es.ask.labels.asOf('2026-10-06'))
  })
})
