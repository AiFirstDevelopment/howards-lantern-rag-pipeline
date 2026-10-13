import { expect, test, type Page } from '@playwright/test'
import { stateChipsPath, type StoredChip } from '../../src/chips'
import { STRINGS } from '../../src/strings'
import { TOTAL, expectNoHorizontalScroll, seed } from './app'

/**
 * The thread under the learner's ask box, folded (Joel, 2026-10-12, on his
 * phone): "the question and answer history cards ... consume a lot of screen
 * real estate". Every exchange before the newest is one line holding its
 * question; a tap opens it, another folds it. The newest is drawn whole,
 * because somebody who has just asked must see the answer without a tap.
 *
 * The worker is stubbed at the network edge, as in learner-ask.spec.ts.
 */

const API = 'https://paywall.test.invalid'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }
const EN = STRINGS.en
const ES = STRINGS.es
const LANG_KEY = 'teach-and-test/v1/lang'

const answer = (text: string) => ({ id: 'answer', answer: text, sources: [] })

async function stubAsk(page: Page, answers: unknown[]): Promise<void> {
  let next = 0
  await page.route(`${API}/api/ask`, (route) => {
    const body = answers[Math.min(next, answers.length - 1)]
    next += 1
    return route.fulfill({ json: body })
  })
}

async function stubChallenge(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
}

async function askOnPage(page: Page, question: string, count: number): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
  await expect(page.getByTestId('ask-exchange')).toHaveCount(count)
}

const LONG = 'what happens if i get pulled over with my learner’s permit and nobody over twenty-one is in the car with me?'

test.describe('the thread folds what came before', () => {
  test.beforeEach(async ({ page }) => {
    await stubChallenge(page)
    await stubAsk(page, [
      answer('First answer: the curfew starts at midnight.'),
      answer('Second answer: one passenger under eighteen.'),
      answer('Third answer: hands-free only.'),
    ])
    await seed(page, FRESH)
    await page.goto('/#ask')
  })

  test('after two questions the first is folded to its question and the second is open with its answer showing', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)

    // Newest first: the second question asked is the first card drawn.
    const [first, second] = [page.getByTestId('ask-exchange').nth(1), page.getByTestId('ask-exchange').nth(0)]
    await expect(first).toHaveAttribute('data-open', 'false')
    await expect(first.getByTestId('ask-exchange-toggle')).toContainText('when is the curfew?')
    await expect(first.getByTestId('ask-answer')).toBeHidden()
    await expect(second).toHaveAttribute('data-open', 'true')
    await expect(second.getByTestId('ask-answer')).toBeVisible()
    await expect(second.getByTestId('ask-answer')).toContainText('Second answer')
  })

  test('tapping a folded question opens its answer, and tapping it again folds it', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)
    const first = page.getByTestId('ask-exchange').nth(1)
    const toggle = first.getByTestId('ask-exchange-toggle')

    await expect(toggle).toHaveAttribute('aria-label', EN.ask.labels.showAnswer)
    await toggle.click()
    await expect(first).toHaveAttribute('data-open', 'true')
    await expect(first.getByTestId('ask-answer')).toBeVisible()
    await expect(first.getByTestId('ask-answer')).toContainText('First answer')
    await expect(toggle).toHaveAttribute('aria-label', EN.ask.labels.hideAnswer)

    await toggle.click()
    await expect(first).toHaveAttribute('data-open', 'false')
    await expect(first.getByTestId('ask-answer')).toBeHidden()
  })

  test('a third question folds the second, so only the answer just asked for is drawn whole', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)
    await askOnPage(page, 'can i use my phone?', 3)

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges.nth(0)).toHaveAttribute('data-open', 'true')
    await expect(exchanges.nth(0).getByTestId('ask-answer')).toContainText('Third answer')
    await expect(exchanges.nth(1)).toHaveAttribute('data-open', 'false')
    await expect(exchanges.nth(1).getByTestId('ask-answer')).toBeHidden()
    await expect(exchanges.nth(2)).toHaveAttribute('data-open', 'false')
  })

  test('a long folded question stays on one line with its chevron on a 390px phone, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await askOnPage(page, LONG, 1)
    await askOnPage(page, 'how many passengers?', 2)

    const toggle = page.getByTestId('ask-exchange').nth(1).getByTestId('ask-exchange-toggle')
    const line = await toggle.boundingBox()
    const chevron = await toggle.locator('svg').boundingBox()
    expect(line).not.toBeNull()
    expect(chevron).not.toBeNull()
    // One line of 12px uppercase text: a wrapped question is two or more.
    expect(line!.height).toBeLessThan(28)
    expect(chevron!.x + chevron!.width).toBeLessThanOrEqual(390)
    await expect(toggle.locator('svg')).toBeInViewport()
    await expectNoHorizontalScroll(page, 'folded thread at 390px')
  })
})

test('the fold control speaks Spanish to a Spanish learner', async ({ page }) => {
  await stubChallenge(page)
  await stubAsk(page, [answer('Primera respuesta.'), answer('Segunda respuesta.')])
  await page.addInitScript(
    ([key]) => {
      if (sessionStorage.getItem('ask-thread-es') !== null) return
      sessionStorage.setItem('ask-thread-es', '1')
      localStorage.setItem(key, 'es')
    },
    [LANG_KEY],
  )
  await seed(page, FRESH)
  await page.goto('/#ask')
  await askOnPage(page, '¿cuándo empieza el toque de queda?', 1)
  await askOnPage(page, '¿cuántos pasajeros?', 2)

  await expect(page.getByTestId('ask-exchange').nth(1).getByTestId('ask-exchange-toggle')).toHaveAttribute(
    'aria-label',
    ES.ask.labels.showAnswer!,
  )
  await expect(page.getByTestId('ask-exchange').nth(0).getByTestId('ask-exchange-toggle')).toHaveAttribute(
    'aria-label',
    ES.ask.labels.hideAnswer!,
  )
})

test.describe('the thread is kept on this device', () => {
  test.beforeEach(async ({ page }) => {
    await stubChallenge(page)
    await stubAsk(page, [
      answer('First answer: the curfew starts at midnight.'),
      answer('Second answer: one passenger under eighteen.'),
      answer('Third answer: hands-free only.'),
    ])
    await seed(page, FRESH)
    await page.goto('/#ask')
  })

  test('a reload brings the questions and answers back, every one folded because nothing was just asked', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)
    await page.reload()

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(2)
    await expect(exchanges.nth(0)).toHaveAttribute('data-open', 'false')
    await expect(exchanges.nth(1)).toHaveAttribute('data-open', 'false')
    await expect(exchanges.nth(1).getByTestId('ask-exchange-toggle')).toContainText('when is the curfew?')
    await exchanges.nth(0).getByTestId('ask-exchange-toggle').click()
    await expect(exchanges.nth(0).getByTestId('ask-answer')).toContainText('Second answer: one passenger under eighteen.')
  })

  test('a question asked after a reload opens on its own answer, above the kept thread still folded', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await page.reload()
    await expect(page.getByTestId('ask-exchange')).toHaveCount(1)
    await askOnPage(page, 'how many passengers?', 2)

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges.nth(0)).toHaveAttribute('data-open', 'true')
    await expect(exchanges.nth(0).getByTestId('ask-answer')).toBeVisible()
    await expect(exchanges.nth(1)).toHaveAttribute('data-open', 'false')
  })
})

/**
 * Newest first, a delete control, and "Show less" (Joel, 2026-10-13, from the
 * screenshot): the thread grew downwards, so the answer just asked for sat
 * under every earlier question; nothing took a question out; and the list
 * of earlier questions could not be put away.
 */
test.describe('the thread is drawn newest first and can be trimmed', () => {
  test.beforeEach(async ({ page }) => {
    await stubChallenge(page)
    await stubAsk(page, [
      answer('First answer: the curfew starts at midnight.'),
      answer('Second answer: one passenger under eighteen.'),
      answer('Third answer: hands-free only.'),
    ])
    await seed(page, FRESH)
    await page.goto('/#ask')
  })

  // Mutation: drop the `.reverse()` in AskBox's thread map.
  test('the question just asked is drawn first, above every earlier one', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText('how many passengers?')
    await expect(exchanges.nth(0)).toHaveAttribute('data-open', 'true')
    await expect(exchanges.nth(1).getByTestId('ask-exchange-toggle')).toContainText('when is the curfew?')
    const [newest, earlier] = [await exchanges.nth(0).boundingBox(), await exchanges.nth(1).boundingBox()]
    expect(newest!.y).toBeLessThan(earlier!.y)
  })

  // Mutation: filter by the wrong index, or skip saveAskDeleted / the thread write.
  test('the delete control takes a question out of the thread, and it is still gone after a reload', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)
    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges.nth(1).getByTestId('ask-exchange-delete')).toHaveAttribute('aria-label', EN.ask.labels.deleteQuestion!)
    await exchanges.nth(1).getByTestId('ask-exchange-delete').click()

    await expect(exchanges).toHaveCount(1)
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText('how many passengers?')
    await page.reload()
    await expect(exchanges).toHaveCount(1)
    await expect(exchanges.nth(0).getByTestId('ask-exchange-toggle')).toContainText('how many passengers?')
  })

  // Mutation: drop the `hidden` on earlier cards, or the saveAskEarlierShown write.
  test('“Show less” puts every question but the newest away, says how many it put away, and the choice holds across a reload', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await askOnPage(page, 'how many passengers?', 2)
    await askOnPage(page, 'can i use my phone?', 3)
    const exchanges = page.getByTestId('ask-exchange')
    const toggle = page.getByTestId('ask-earlier-toggle')
    await expect(toggle).toHaveText(EN.ask.labels.showLess!)
    await expect(exchanges.nth(1)).toBeVisible()

    await toggle.click()
    await expect(toggle).toHaveText(EN.ask.labels.showEarlier!(2))
    await expect(exchanges.nth(0)).toBeVisible()
    await expect(exchanges.nth(0).getByTestId('ask-answer')).toContainText('Third answer')
    await expect(exchanges.nth(1)).toBeHidden()
    await expect(exchanges.nth(2)).toBeHidden()

    await page.reload()
    await expect(exchanges).toHaveCount(3)
    await expect(toggle).toHaveText(EN.ask.labels.showEarlier!(2))
    await expect(exchanges.nth(0)).toBeVisible()
    await expect(exchanges.nth(1)).toBeHidden()

    await toggle.click()
    await expect(toggle).toHaveText(EN.ask.labels.showLess!)
    await expect(exchanges.nth(1)).toBeVisible()
    await expect(exchanges.nth(2)).toBeVisible()
  })

  // Mutation: `thread.length > 0` as the control's condition.
  test('one question alone has nothing to put away, so no control is offered', async ({ page }) => {
    await askOnPage(page, 'when is the curfew?', 1)
    await expect(page.getByTestId('ask-earlier-toggle')).toHaveCount(0)
  })
})

test('the delete and show-less controls speak Spanish to a Spanish learner', async ({ page }) => {
  await stubChallenge(page)
  await stubAsk(page, [answer('Primera respuesta.'), answer('Segunda respuesta.')])
  await page.addInitScript(
    ([key]) => {
      if (sessionStorage.getItem('ask-trim-es') !== null) return
      sessionStorage.setItem('ask-trim-es', '1')
      localStorage.setItem(key, 'es')
    },
    [LANG_KEY],
  )
  await seed(page, FRESH)
  await page.goto('/#ask')
  await askOnPage(page, '¿cuándo empieza el toque de queda?', 1)
  await askOnPage(page, '¿cuántos pasajeros?', 2)

  await expect(page.getByTestId('ask-exchange').nth(0).getByTestId('ask-exchange-delete')).toHaveAttribute('aria-label', ES.ask.labels.deleteQuestion!)
  await expect(page.getByTestId('ask-earlier-toggle')).toHaveText(ES.ask.labels.showLess!)
  await page.getByTestId('ask-earlier-toggle').click()
  await expect(page.getByTestId('ask-earlier-toggle')).toHaveText(ES.ask.labels.showEarlier!(1))
})

test('a kept thread that cannot be read is an empty thread under a box that still asks', async ({ page }) => {
  await stubChallenge(page)
  await stubAsk(page, [answer('An answer after all.')])
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ask-thread-corrupt') !== null) return
    sessionStorage.setItem('ask-thread-corrupt', '1')
    localStorage.setItem('teach-and-test/v1/ask-thread', '[{"question": "half a wri')
  })
  await seed(page, FRESH)
  await page.goto('/#ask')

  await expect(page.getByTestId('ask-input')).toBeVisible()
  await expect(page.getByTestId('ask-exchange')).toHaveCount(0)
  await askOnPage(page, 'when is the curfew?', 1)
  await expect(page.getByTestId('ask-answer')).toContainText('An answer after all.')
})

/** A thread this device kept on an earlier visit, written once a tab. */
async function kept(page: Page, thread: unknown[]): Promise<void> {
  await page.addInitScript(
    ([value]) => {
      if (sessionStorage.getItem('ask-thread-kept') !== null) return
      sessionStorage.setItem('ask-thread-kept', '1')
      localStorage.setItem('teach-and-test/v1/ask-thread', value)
    },
    [JSON.stringify(thread)],
  )
}

test.describe('what a kept thread does not change', () => {
  test('the free chips still show to a learner whose thread was kept from an earlier visit', async ({ page }) => {
    await kept(page, [{ question: 'when is the curfew?', answer: answer('Midnight.'), state: 'MD', askedAt: '2026-10-11T10:00:00Z' }])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-exchange')).toHaveCount(1)
    await expect(page.getByTestId('ask-state-chip')).toHaveCount(3)
  })

  test('an answer kept from Texas is labelled with Texas’s manual while the box answers for Maryland', async ({ page }) => {
    await kept(page, [
      {
        question: 'how fast on a highway?',
        answer: { id: 'answer', answer: 'Seventy, where posted.', citations: [{ id: 'TX-1', location: "p.30 (printed) — 'Seventy where posted.'" }] },
        state: 'TX',
        askedAt: '2026-10-11T10:00:00Z',
      },
    ])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state')).toContainText('Maryland')
    await page.getByTestId('ask-exchange-toggle').click()
    const line = page.getByTestId('ask-sources-line')
    await expect(line).toContainText('Texas driver’s manual')
    await expect(line).not.toContainText('Maryland')
  })

  test('a state chip’s answer kept from Texas is left out when the box opens answering for Maryland', async ({ page }) => {
    await kept(page, [
      { question: 'TX question 1?', answer: answer('TX answer 1.'), chip: 'state', state: 'TX', askedAt: '2026-10-11T10:00:00Z' },
      { question: 'a typed question', answer: answer('Typed answer.'), state: 'TX', askedAt: '2026-10-11T10:01:00Z' },
    ])
    await seed(page, FRESH)
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-exchange')).toHaveCount(1)
    await expect(page.getByTestId('ask-exchange-toggle')).toContainText('a typed question')
  })
})

/**
 * A first-time visitor's state comes from the edge (GET /api/geo), a tick
 * after the box has already drawn. Live on 2026-10-12, a Maryland chip's
 * answer survived until the reload and was gone after it, and the key then
 * held `[]`: the box opened with no state yet, so the kept chip answer read
 * as another state's and was left out, and the write that follows every
 * change of the thread made the loss permanent. Every test above seeds a
 * studied state, which is there on the first render, so none of them saw it.
 */
test.describe('a state that arrives after the box has drawn', () => {
  const chip = (n: number): StoredChip => ({
    id: `chip-${n}`,
    lang: 'en',
    question: `MD question ${n}?`,
    answer: `MD answer ${n}: park at least 15 feet away.`,
    sources: [],
    absent: [],
    asOf: '2026-10-11',
  })

  test.beforeEach(async ({ page }) => {
    await page.route(`${API}/api/geo`, (route) => route.fulfill({ json: { state: 'MD' } }))
    await page.route(`**${stateChipsPath('MD')}`, (route) => route.fulfill({ json: [1, 2, 3].map((n) => chip(n)) }))
  })

  test('keeps a tapped Maryland chip answer across a reload for a visitor placed in Maryland by where they are', async ({ page }) => {
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Maryland')
    const tapped = page.getByTestId('ask-state-chip').first()
    const id = (await tapped.getAttribute('data-chip')) ?? ''
    await tapped.click()
    await expect(page.getByTestId('ask-state-chip-answer')).toHaveCount(1)
    await page.reload()
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Maryland')

    const exchanges = page.getByTestId('ask-exchange')
    await expect(exchanges).toHaveCount(1)
    await expect(exchanges).toHaveAttribute('data-open', 'false')
    await exchanges.getByTestId('ask-exchange-toggle').click()
    await expect(exchanges.getByTestId('ask-answer')).toContainText(`MD answer ${id.slice(5)}`)
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('teach-and-test/v1/ask-thread'))) ?? '[]') as unknown[]
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ chip: 'state', state: 'MD' })
  })
})
