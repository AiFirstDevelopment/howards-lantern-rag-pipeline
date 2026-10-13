import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { citeFor } from '../../worker/src/cite'
import { TOTAL, expectNoHorizontalScroll, openMenuItem, seed } from './app'

/**
 * The box again, with the mesh behind it.
 *
 * AC21. The browser cannot tell the difference and must not have to: the same
 * screen, the same endpoint, the same body. What changes is the *shape of the
 * answer* -- a question can now be answered by two entries at once, a live
 * query can supply figures, and a domain can be missing -- and this is the
 * suite for the half of that a person actually sees.
 *
 * Deliberately a second file rather than an edit to `tests/e2e/ask.spec.ts`.
 * That one passing **untouched** is what says the mesh landed inert (AC20), and
 * a test file edited in the same change cannot say it.
 *
 * The worker is mocked at the network edge, per this repository's convention,
 * so what is proved here is the page. That the coarse server makes exactly one
 * model call, that both answers are the entries byte for byte, and that no
 * token reaches the model are held in workerd by worker/tests/mesh-coarse.test.ts.
 */

const API = 'https://paywall.test.invalid'
const FRESH = { studyIndex: TOTAL, coveredOnce: true, tests: [] }

interface Entry {
  id: string
  audience: string
  answer: string
  cite: string | null
}

const ENTRIES = JSON.parse(
  readFileSync(path.join(process.cwd(), 'worker/src/knowledge-base.json'), 'utf8'),
) as Entry[]

function entry(id: string): Entry {
  const found = ENTRIES.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no such entry: ${id}`)
  if (found.audience !== 'anyone') throw new Error(`${id} is not answerable to a stranger`)
  return found
}

/** The same words with the wrapping and the two markers the entries use taken out. */
function asShown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function shown(page: Page, testId: string, nth = 0): Promise<string> {
  return (await page.getByTestId(testId).nth(nth).innerText()).replace(/\s+/g, ' ').trim()
}

/** The citation as the worker serves it — the worker's own function, not a copy. */
function served(cite: string | null): { cite: string | null; citeUrl: string | null } {
  const shownCite = citeFor(cite)
  return { cite: shownCite.cite, citeUrl: shownCite.url }
}

/** The mesh's answer, in the shape `/api/partners/ask` sends it with the flag on. */
async function stubMesh(page: Page, answer: Record<string, unknown>): Promise<void> {
  await page.route(`${API}/api/partners/ask`, (route: Route) => route.fulfill({ json: answer }))
}

async function openPartnerScreen(page: Page): Promise<void> {
  await seed(page, FRESH)
  await page.goto('/')
  await openMenuItem(page, 'menu-partner')
  await expect(page.getByRole('heading', { name: 'Become a partner', level: 1 })).toBeVisible()
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
}

test.describe('the box, answered through the mesh', () => {
  test('shows a single written answer exactly as it always did', async ({ page }) => {
    const chosen = entry('join-cost')
    await stubMesh(page, { id: chosen.id, answer: chosen.answer, ...served(chosen.cite) })
    await openPartnerScreen(page)

    await ask(page, 'what does it cost to join?')

    await expect(page.getByTestId('ask-answer')).toBeVisible()
    expect(await shown(page, 'ask-answer')).toContain(asShown(chosen.answer))
    await expect(page.getByTestId('ask-cite-link')).toHaveAttribute('href', '/partners/agreement')
    await expectNoHorizontalScroll(page, 'the mesh-answered partner page')
  })

  /**
   * AC5, as a person meets it. "What if a refund comes after you've paid me" is
   * a refunds question *and* a money question, and it is the single entry most
   * likely to decide whether somebody signs up. A router that picked one domain
   * would answer half of it and the page would look complete.
   *
   * The two are drawn as two answers rather than run together, because they are
   * two entries somebody wrote separately -- merging them would be composing,
   * which is the one thing this box is built never to do.
   */
  test('shows both answers when a question spanned two domains', async ({ page }) => {
    const first = entry('refund-after-payment')
    const second = entry('paid-triggers')
    await stubMesh(page, {
      id: first.id,
      answer: first.answer,
      ...served(first.cite),
      also: [{ id: second.id, answer: second.answer, ...served(second.cite) }],
    })
    await openPartnerScreen(page)

    await ask(page, "what if a refund comes after you've paid me?")

    await expect(page.getByTestId('ask-answer')).toBeVisible()
    expect(await shown(page, 'ask-answer')).toContain(asShown(first.answer))
    await expect(page.getByTestId('ask-also')).toHaveCount(1)
    expect(await shown(page, 'ask-also')).toContain(asShown(second.answer))
    await expectNoHorizontalScroll(page, 'a two-domain answer')
  })

  /**
   * AC6, at the far end. Half an answer that looks like a whole one is worse
   * than a shorter answer that says which part is missing -- somebody deciding
   * whether to sign a contract has no way to know a domain was unreachable
   * unless the page says so.
   */
  test('says which domain it could not reach rather than letting half pass for whole', async ({
    page,
  }) => {
    const chosen = entry('join-cost')
    await stubMesh(page, {
      id: chosen.id,
      answer: chosen.answer,
      ...served(chosen.cite),
      unavailable: ['refunds'],
    })
    await openPartnerScreen(page)

    await ask(page, 'what does it cost, and what about refunds?')

    await expect(page.getByTestId('ask-unavailable')).toBeVisible()
    expect(await shown(page, 'ask-unavailable')).toContain('refunds')
  })

  /**
   * The same, when *nothing* answered.
   *
   * A total outage -- every fine server unreachable, so the model is handed no
   * tools and names none -- comes back as a no-match with `unavailable` on it.
   * That branch used to return before the line was drawn, so the one case
   * where the mesh is entirely down was the one case that told the asker their
   * question simply has no written answer.
   */
  test('says the answers were unreachable rather than that none exists', async ({ page }) => {
    await stubMesh(page, {
      id: 'no-match',
      contact: 'partners@howardslantern.com',
      unavailable: ['joining', 'money', 'refunds', 'codes', 'promotion', 'account'],
    })
    await openPartnerScreen(page)

    await ask(page, 'what does it cost to join?')

    await expect(page.getByTestId('ask-no-match')).toBeVisible()
    await expect(page.getByTestId('ask-unavailable')).toBeVisible()
    expect(await shown(page, 'ask-unavailable')).toContain('joining')
    await expect(page.getByTestId('ask-contact')).toBeVisible()
  })

  /**
   * The capability the whole mesh exists for, as it reaches the screen: figures
   * from a live query, in the words the query itself produced. Nothing composes
   * them -- there is no turn on which a model sees them.
   */
  test('shows the figures a live query returned, under the written answer', async ({ page }) => {
    const chosen = entry('paid-triggers')
    await stubMesh(page, {
      id: chosen.id,
      answer: chosen.answer,
      ...served(chosen.cite),
      figures: [
        {
          tool: 'payout_status',
          lines: ['payableCents: 1280', 'under the $50 threshold; rolls to the next run'],
        },
      ],
    })
    await openPartnerScreen(page)

    await ask(page, 'why have I not been paid?')

    await expect(page.getByTestId('ask-figures')).toBeVisible()
    expect(await shown(page, 'ask-figures')).toContain('under the $50 threshold')
    // And the written half is still the written half, unchanged beside it.
    expect(await shown(page, 'ask-answer')).toContain(asShown(chosen.answer))
  })

  /**
   * Every failure still lands on a person. The mesh adds ways to fail -- a dead
   * server, an object that will not validate, an exchange that refused -- and
   * all of them arrive here as the same no-match the box has always drawn.
   */
  test('lands on a person when the mesh answered with nothing', async ({ page }) => {
    await stubMesh(page, {
      id: 'no-match',
      contact: 'partners@howardslantern.com',
      handOff: false,
      unavailable: ['money'],
    })
    await openPartnerScreen(page)

    await ask(page, 'should I register an LLC?')

    await expect(page.getByTestId('ask-no-match')).toBeVisible()
    await expect(page.getByTestId('ask-contact')).toContainText('partners@howardslantern.com')
  })
})
