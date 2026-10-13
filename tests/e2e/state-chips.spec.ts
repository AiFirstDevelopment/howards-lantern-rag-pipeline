import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { ASK_QUOTA_KEY, ASK_WEEKLY_LIMITS, daysUntilReset } from '../../src/ask-quota'
import { CHIPS_PATH, stateChipsPath, stateChipsTappedKey, type StoredChip } from '../../src/chips'
import { STRINGS } from '../../src/strings'
import { TOTAL, seed, stateSelector } from './app'

/**
 * The state chips under the box (docs/plans/what-happens-if.md, phase 4,
 * decisions 24 and 25), from the outside.
 *
 * A state chip is a stored answer for the state the box is answering for.
 * The claims worth a browser: three show for that state and only while
 * Nationwide is unticked; a tap shows the answer as a live one is shown and
 * never reaches the worker or the week's count -- the failure that would cost
 * a class its questions; a learner can see that before tapping; and changing
 * the state changes the chips and takes the old state's answer away. The
 * published file is replaced with a pool of nine wherever the claim is about
 * drawing, so it does not depend on how many chips the last build stored.
 */

const API = 'https://paywall.test.invalid'
const ANALYTICS = 'https://analytics.test.invalid'
const LANG_KEY = 'teach-and-test/v1/lang'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const EN = STRINGS.en
const ES = STRINGS.es

function chip(code: string, n: number, lang = 'en'): StoredChip {
  return {
    id: `chip-${n}`,
    lang,
    question: lang === 'en' ? `${code} question ${n}?` : `¿${code} pregunta ${n}?`,
    answer: lang === 'en' ? `${code} answer ${n}: park at least 15 feet away.` : `${code} respuesta ${n}: a 15 pies.`,
    sources: [
      { id: `${code}-S01`, location: "p.30 (printed) — 'You may not stand or park a vehicle within 15 feet of a fire hydrant.'", asOf: '2026-09-06' },
      { id: `${code}-C-21-1003-m`, location: "Md. Code, Transp. § 21-1003(m) — '(m) A person may not stand or park a vehicle within 15 feet of a fire hydrant.'", kind: 'statute', asOf: '2026-10-06' },
    ],
    absent: [],
    asOf: '2026-10-11',
  }
}
const nine = (code: string) => [...Array.from({ length: 9 }, (_, index) => chip(code, index + 1)), ...Array.from({ length: 9 }, (_, index) => chip(code, index + 1, 'es'))]

function nationwideChip(n: number, lang = 'en'): StoredChip {
  return {
    ...chip('US', n, lang),
    id: `fact-${n}`,
    question: lang === 'en' ? `Fact number ${n}?` : `¿Dato número ${n}?`,
    sources: [{ id: 'UT-12', location: "p.52 (printed) — 'A driver over 0.05 is in violation.'", state: 'Utah', asOf: '2026-10-06' }],
  }
}

async function pools(page: Page): Promise<void> {
  await page.route(`**${stateChipsPath('MD')}`, (route) => route.fulfill({ json: nine('MD') }))
  await page.route(`**${stateChipsPath('TX')}`, (route) => route.fulfill({ json: nine('TX') }))
  await page.route(`**${CHIPS_PATH}`, (route) => route.fulfill({ json: [1, 2, 3, 4, 5].flatMap((n) => [nationwideChip(n), nationwideChip(n, 'es')]) }))
}

/** The worker's /api/ask, answering every question and recording each one it was sent. */
async function stubAsk(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = []
  await page.route(`${API}/api/ask`, (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
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

async function shownIds(page: Page): Promise<string[]> {
  await expect(page.getByTestId('ask-state-chip')).not.toHaveCount(0)
  return page.getByTestId('ask-state-chip').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-chip') ?? ''))
}

async function quota(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), ASK_QUOTA_KEY)
}

test.beforeEach(async ({ page }) => {
  await seed(page, FRESH)
})

test.describe('a state’s chips under the box', () => {
  // AC22: three for Maryland while unticked, the nationwide three while
  // ticked, and Maryland's same three back on unticking.
  test('shows three of Maryland’s chips while Nationwide is unticked, and swaps them for the nationwide three when it is ticked', async ({ page }) => {
    await pools(page)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Maryland')
    const first = await shownIds(page)
    expect(first).toHaveLength(3)
    await expect(page.getByTestId('ask-state-chip').first()).toContainText('MD question')
    await expect(page.getByTestId('ask-chip')).toHaveCount(0)
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chip')).toHaveCount(3)
    await expect(page.getByTestId('ask-state-chip')).toHaveCount(0)
    await expect(page.getByTestId('ask-chip').first()).toContainText('Fact number')
    await page.getByTestId('ask-nationwide').uncheck()
    expect(await shownIds(page)).toEqual(first)
  })

  // AC22, guard 17. A tap draws the stored answer folded under its one line
  // of sources, as a live answer is, reaches nothing, and leaves the week's
  // count and the counter beside the box where they were. Mutation: record
  // the tap as a question.
  test('answers a tap from the stored file with the folded sources line, sends nothing to /api/ask, and leaves the week’s count unchanged', async ({ page }) => {
    await pools(page)
    const sent = await stubAsk(page)
    await page.goto('/#ask')
    const [id] = await shownIds(page)
    const counter = await page.getByTestId('ask-balance').textContent()
    const before = await quota(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${id}"]`).click()
    const entry = page.getByTestId('ask-state-chip-answer')
    await expect(entry.getByTestId('ask-answer')).toContainText(`MD answer ${id.slice(5)}: park at least 15 feet away.`)
    await expect(entry.getByTestId('ask-sources-line')).toHaveText(
      `${EN.ask.labels.sourcesLine('Maryland driver’s manual p. 30 · Md. Code, Transp. § 21-1003')} · ${EN.ask.labels.asOf('2026-09-06')} ${EN.ask.labels.showLaw}`,
    )
    await expect(entry.getByTestId('ask-citation')).toHaveCount(0)
    await entry.getByTestId('ask-sources-open').click()
    await expect(entry.getByTestId('ask-citation')).toHaveCount(2)
    await expect(page.getByTestId('ask-balance')).toHaveText(counter ?? '')
    expect(await quota(page)).toBe(before)
    expect(sent).toHaveLength(0)
  })

  // AC22: not offered again on this device. Six of nine already tapped
  // leaves three; tapping one leaves two, and no reload offers it again.
  test('never offers a tapped Maryland chip again on this device, and keeps Maryland’s list apart from other states’', async ({ page }) => {
    await pools(page)
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('state-chips-seeded') !== null) return
      sessionStorage.setItem('state-chips-seeded', '1')
      localStorage.setItem(key, JSON.stringify(['chip-1', 'chip-2', 'chip-3', 'chip-4', 'chip-5', 'chip-6']))
    }, stateChipsTappedKey('MD'))
    await page.goto('/#ask')
    expect([...(await shownIds(page))].sort()).toEqual(['chip-7', 'chip-8', 'chip-9'])
    await page.locator('[data-testid="ask-state-chip"][data-chip="chip-8"]').click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    for (let load = 0; load < 3; load += 1) {
      await page.reload()
      expect([...(await shownIds(page))].sort(), `load ${load + 1}`).toEqual(['chip-7', 'chip-9'])
    }
    expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), stateChipsTappedKey('MD'))) ?? '[]')).toContain('chip-8')
    expect(await page.evaluate((key) => localStorage.getItem(key), stateChipsTappedKey('TX'))).toBeNull()
  })

  // A tapped chip used to leave a gap nothing filled, so three taps emptied
  // the row until the next page load -- and a device that had tapped most of
  // the pool lost the row on its first tap, which read as the chips going
  // away for having been used (Joel, 2026-10-12). Nine taps on a pool of
  // nine: the row stays at three while an untapped chip is left to draw,
  // shortens once only the ones on the row are untapped, and refills from
  // the whole pool when the last has been tapped. Mutation: drop the tapped
  // chip without drawing another.
  test('keeps three on the row after a tap, the tapped chip’s place taken by one this device has not tapped and the other two where they were', async ({ page }) => {
    await pools(page)
    await page.goto('/#ask')
    const first = await shownIds(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${first[0]}"]`).click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    const after = await shownIds(page)
    expect(after).toHaveLength(3)
    expect(after).not.toContain(first[0])
    expect(after.slice(1)).toEqual(first.slice(1))
    const onRowAfterTap = [3, 3, 3, 3, 3, 2, 1, 3]
    for (const [n, count] of onRowAfterTap.entries()) {
      await page.getByTestId('ask-state-chip').first().click()
      await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(n + 2)
      await expect(page.getByTestId('ask-state-chip'), `after tap ${n + 2}`).toHaveCount(count)
    }
    expect(await page.evaluate((key) => localStorage.getItem(key), stateChipsTappedKey('MD'))).toBeNull()
  })

  // Guard 18. Maryland's answer under a box now answering for Texas reads as
  // Texas's. Mutation: keep the chips drawn for the device, not the state.
  test('shows Texas’s chips and takes Maryland’s answer away when the state is changed to Texas', async ({ page }) => {
    await pools(page)
    await page.goto('/#ask')
    const [id] = await shownIds(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${id}"]`).click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    await page.getByTestId('ask-change-state').click()
    await stateSelector(page).fill('Texas')
    await page.getByRole('option', { name: 'Texas', exact: true }).click()
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Texas')
    await expect(page.getByTestId('ask-state-chip')).toHaveCount(3)
    for (const text of await page.getByTestId('ask-state-chip').allTextContents()) expect(text).toContain('TX question')
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(0)
  })

  // The same change of state, judged by the state kept on each exchange: the
  // rule that stopped a late geo answer emptying the thread (2026-10-12) must
  // still take a Maryland chip answer away under Texas, from the screen and
  // from what is kept, while the typed answer beside it stays.
  test('changing to Texas removes the Maryland chip answer from the thread and from storage, and keeps the typed answer asked for Maryland', async ({ page }) => {
    await pools(page)
    await stubAsk(page)
    await page.goto('/#ask')
    const [id] = await shownIds(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${id}"]`).click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    await page.getByTestId('ask-input').fill('when is the curfew?')
    await page.getByTestId('ask-submit').click()
    await expect(page.getByTestId('ask-exchange')).toHaveCount(2)

    await page.getByTestId('ask-change-state').click()
    await stateSelector(page).fill('Texas')
    await page.getByRole('option', { name: 'Texas', exact: true }).click()
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Texas')
    for (const text of await page.getByTestId('ask-state-chip').allTextContents()) expect(text).toContain('TX question')
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(0)
    await expect(page.getByTestId('ask-exchange')).toHaveCount(1)
    await expect(page.getByTestId('ask-exchange-toggle')).toContainText('when is the curfew?')
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('teach-and-test/v1/ask-thread'))) ?? '[]') as unknown[]
    expect(stored).toEqual([expect.objectContaining({ question: 'when is the curfew?', state: 'MD' })])
  })

  // Decision 24: a tap leaves the box ready, and what is typed next is asked
  // of the worker for the state, counted as a question.
  test('sends a follow-up typed after a tap to /api/ask for Maryland, and counts it', async ({ page }) => {
    await pools(page)
    const sent = await stubAsk(page)
    await page.goto('/#ask')
    await page.getByTestId('ask-state-chip').first().click()
    await page.getByTestId('ask-input').fill('And what about at night?')
    await page.getByTestId('ask-submit').click()
    await expect(page.getByTestId('ask-answer')).toHaveCount(2)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ question: 'And what about at night?', state: 'MD' })
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.state - 1, ASK_WEEKLY_LIMITS.state, daysUntilReset(), null))
  })

  // Decision 24: counted by the chip and the state, and nothing else.
  test('sends state_chip_tapped with the chip’s id and the state, and nothing else', async ({ page }) => {
    await pools(page)
    const beacons: Record<string, unknown>[] = []
    await page.route(`${ANALYTICS}/api/event`, (route) => {
      const body = route.request().postData()
      if (body !== null) beacons.push(JSON.parse(body) as Record<string, unknown>)
      return route.fulfill({ status: 204, body: '' })
    })
    await page.goto('/#ask')
    const [id] = await shownIds(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${id}"]`).click()
    await expect.poll(() => beacons.filter((beacon) => beacon.name === 'state_chip_tapped')).toHaveLength(1)
    const beacon = beacons.find((each) => each.name === 'state_chip_tapped')!
    expect(beacon).toMatchObject({ chip: id, state: 'MD' })
    expect(Object.keys(beacon).filter((key) => !['session', 'device', 'site', 'product', 'name', 'chip', 'state'].includes(key))).toEqual([])
    expect(beacons.filter((each) => each.name === 'chip_tapped')).toHaveLength(0)
  })

  // AC22 against the file the build published rather than a fixture.
  test('shows three chips from Maryland’s published answers', async ({ page }) => {
    const stored = JSON.parse(readFileSync(path.join(process.cwd(), 'resource/state-chips/MD.json'), 'utf8')) as { chips: { id: string; lang: string }[] }
    await page.goto('/#ask')
    const ids = await shownIds(page)
    expect(ids).toHaveLength(Math.min(3, stored.chips.filter((each) => each.lang === 'en').length))
    for (const id of ids) expect(stored.chips.map((each) => each.id)).toContain(id)
  })
})

/**
 * Free and unlimited, said where a learner looks (Joel, 2026-10-11): the
 * heading over either row of chips, one word on every chip, and the box's
 * own label saying a typed question is the one that counts.
 */
test.describe('what is free and what counts', () => {
  // The free-chips criterion. Mutation: drop "Free" from the headings.
  test('says the chips are free and unlimited and the typed question counts, for Maryland and nationwide, in English', async ({ page }) => {
    await pools(page)
    const sent = await stubAsk(page)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state-chips').getByTestId('ask-chips-label')).toHaveText('Free answers for Maryland — tap as many as you like')
    await expect(page.getByTestId('ask-state-chip').getByTestId('ask-chip-free')).toHaveText(['free', 'free', 'free'])
    await expect(page.getByTestId('ask-form').locator('label')).toContainText(EN.ask.ownQuestion)
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chips').getByTestId('ask-chips-label')).toHaveText('Free facts across the states — tap as many as you like')
    await expect(page.getByTestId('ask-chip').getByTestId('ask-chip-free')).toHaveText(['free', 'free', 'free'])
    await expect(page.getByTestId('ask-form').locator('label')).toContainText(EN.ask.ownQuestion)
    // The difference itself: a chip leaves the counter, a typed question moves it.
    const counter = await page.getByTestId('ask-balance').textContent()
    await page.getByTestId('ask-chip').first().click()
    await expect(page.getByTestId('ask-balance')).toHaveText(counter ?? '')
    await page.getByTestId('ask-input').fill('Which state is strictest?')
    await page.getByTestId('ask-submit').click()
    await expect(page.getByTestId('ask-balance')).toHaveText(EN.ask.questionsLeft(ASK_WEEKLY_LIMITS.nationwide - 1, ASK_WEEKLY_LIMITS.nationwide, daysUntilReset(), null))
    expect(sent).toHaveLength(1)
  })

  test('says the same in Spanish', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, 'es'), LANG_KEY)
    await pools(page)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state-chips').getByTestId('ask-chips-label')).toContainText('Respuestas gratis para')
    await expect(page.getByTestId('ask-state-chips').getByTestId('ask-chips-label')).toContainText('toque todas las que quiera')
    await expect(page.getByTestId('ask-state-chip').first()).toContainText('¿MD pregunta')
    await expect(page.getByTestId('ask-state-chip').getByTestId('ask-chip-free')).toHaveText([ES.ask.chipFree, ES.ask.chipFree, ES.ask.chipFree])
    await expect(page.getByTestId('ask-form').locator('label')).toContainText(ES.ask.ownQuestion)
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chips').getByTestId('ask-chips-label')).toHaveText('Datos gratis de todos los estados — toque todos los que quiera')
    await expect(page.getByTestId('ask-form').locator('label')).toContainText(ES.ask.ownQuestion)
  })
})

test.describe('a tapped answer is kept on this device', () => {
  test('keeps a tapped Maryland answer across a reload, folded, and still marked free', async ({ page }) => {
    await pools(page)
    await page.goto('/#ask')
    const [id] = await shownIds(page)
    await page.locator(`[data-testid="ask-state-chip"][data-chip="${id}"]`).click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    await page.reload()

    const kept = page.getByTestId('ask-exchange')
    await expect(kept).toHaveCount(1)
    await expect(kept).toHaveAttribute('data-open', 'false')
    await expect(kept.getByTestId('ask-exchange-free')).toHaveText(EN.ask.chipFree)
    await kept.getByTestId('ask-exchange-toggle').click()
    await expect(page.getByTestId('ask-state-chip-answer').getByTestId('ask-answer')).toContainText(`MD answer ${id.slice(5)}`)
  })
})
