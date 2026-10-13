import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { statesOf } from '../../scripts/law-vectors'
import {
  handLawsOf,
  lawsOf as publishedLaws,
  readCoverage,
  readSources,
  supersededOf,
  topicLawsFrom,
  topicsOf,
} from '../../scripts/statutes/laws'
import { STRINGS } from '../../src/strings'
import { ANSWER_LAWS, CANDIDATE_LAWS, SEARCHED_CANDIDATE_LAWS, type Rerank } from '../../worker/src/law-rerank'
import { RETRIEVED_LAWS, retrieve, type AskLaw } from '../../worker/src/law-retrieval'
import { lawsByIdFor, nearLawsNationwide, type LawsBySection, type PenaltiesFor, type ProcessRowsFor } from '../../worker/src/law-nationwide'
import { lawsBySectionFromCorpus, penaltiesFromFiles, processRowsFromFiles } from '../../scripts/live'
import { NATIONWIDE_FAMILY_TOPICS, TOPIC_FAMILIES, haikuTopicsFor, type ChooseTopics, type StateLaw, type TopicsClient } from '../../worker/src/law-topics'
import { embeddingText } from '../../worker/src/law-vectors'
import {
  NATIONWIDE,
  NATIONWIDE_FAMILY_LAWS,
  NATIONWIDE_LAWS,
  answerLearner,
  figuresIn,
  withLaws,
  type LearnerAskRequest,
  type LearnerOutcome,
  type LearnerReply,
} from '../../worker/src/learner-ask'
import { STATE_NAMES } from '../../worker/src/states'
import { data, pickState, readProgress, seed, skipToCards, stateSelector, studyLawsFor } from './app'

/**
 * Road law in the learner's ask box, answered from the chosen state's manual
 * and nothing else (docs/plans/learner-ask-law.md).
 *
 * The worker is stubbed at the network edge, as in learner-ask.spec.ts, but
 * the stub answers by running the worker's own `answerLearner` over the real
 * corpus file for the state the page sent -- the real retrieval and the real
 * checks -- with only the model faked. So a guard on retrieval or on a check
 * goes red here, through /#ask, and not only in workerd: a retrieval that
 * reached Florida's laws for an Ohio learner would draw Florida's figure on
 * this screen, which is the failure the whole plan is shaped to prevent.
 */

const API = 'https://paywall.test.invalid'
const EN = STRINGS.en

/**
 * What Pages publishes at /ask-laws/<CODE>.json, built by the plugin's own
 * reader -- once per state: a state's code is hundreds of files, and a route
 * handler reading them on every request would time the test out.
 */
const BUILT = new Map<string, AskLaw[]>()
/**
 * States whose code is not in -- no sources and no hand-written laws. Since
 * Wyoming every state has a coverage block, so these are the blocked states
 * (Arkansas, Georgia, …), which answer from their manual alone.
 */
const CODELESS: Record<string, true> = Object.fromEntries(
  statesOf(process.cwd())
    .filter((code) => readSources(process.cwd(), code) === null && handLawsOf(process.cwd(), code) === null)
    .map((code) => [code, true]),
)
function lawsOf(code: string): AskLaw[] {
  if (!BUILT.has(code)) BUILT.set(code, publishedLaws(process.cwd(), code))
  return BUILT.get(code)!
}

/**
 * What Pages publishes at /ask-laws/topics/<topic>.json, built by the plugin's
 * own function over the states' files above -- once, on the first nationwide
 * question: it reads every state's laws, which no state test should pay for.
 */
let TOPIC_LAWS: Map<string, StateLaw[]> | null = null
function topicFiles(): Map<string, StateLaw[]> {
  TOPIC_LAWS ??= topicLawsFrom(topicsOf(process.cwd()), readCoverage(process.cwd()), lawsOf)
  return TOPIC_LAWS
}

/** The day a state's manual was fetched, read off the fetch record rather than off a published law. */
function manualDate(code: string): string {
  return (JSON.parse(readFileSync(path.join(process.cwd(), 'src/assets/drivers-manuals/SOURCES.json'), 'utf8')) as Record<string, { retrieved: string }>)[code].retrieved
}

type Model = (request: LearnerAskRequest) => LearnerReply | Promise<LearnerReply>

/** The worker's pipeline behind the page, with `model` in place of Anthropic. Records what the model was given. */
async function workerWith(
  page: Page,
  model: Model,
  /** What the vector index answers, by question; absent means no index, BM25 alone. */
  near?: (code: string, question: string) => string[],
  /** The cross-encoder's scores, text by text; absent means no reranker, today's eight. */
  rerank?: Rerank,
  /** The question in the law's words (law-rephrase.ts); absent means retrieval on the question alone. */
  rephrase?: (question: string) => string[],
  /** Haiku matching a nationwide question to topics (law-topics.ts); absent means the question's words do. */
  topicsFor?: ChooseTopics,
  /** A topic's every-state file; absent means the one the build publishes. */
  topicLawsFor?: (topic: string) => StateLaw[],
  /**
   * Nationwide phase 2's bindings -- the AI that embeds, the index and the D1
   * holding the `laws` table -- behind the worker's own loop and store reader
   * (law-nationwide.ts); absent means a worker without the index.
   */
  loop?: { ai: Ai; index: VectorizeIndex; db: D1Database },
  /** Every subsection of a chosen law's section, as the `laws` table answers it; absent means the laws chosen and no more. */
  lawsBySection?: LawsBySection,
  /** The court's fine schedule for those sections, as the `penalties` table answers it; absent means none. */
  penaltiesFor?: PenaltiesFor,
  /** A state's rows of its own page for one family, as the `laws` table answers it; absent means none are added by key. */
  processRowsFor?: ProcessRowsFor,
  /** The rephraser's family for the question, where the stub reads one. */
  family?: (question: string) => string | undefined,
): Promise<LearnerAskRequest[] & { outcomes: LearnerOutcome[] }> {
  const asked: LearnerAskRequest[] & { outcomes: LearnerOutcome[] } = Object.assign([], { outcomes: [] })
  await page.route(`${API}/api/ask`, async (route) => {
    const sent = route.request().postDataJSON() as { question: string; lang: string; state: string | null }
    const { body, outcome } = await answerLearner(
      { lang: sent.lang === 'es' ? 'es' : 'en', state: sent.state, question: sent.question },
      [],
      {
        askLearner: async (request) => {
          asked.push(request)
          return model(request)
        },
        // Nationwide guard 13: Pages publishes no US.json, so a worker that
        // asked for one would refuse every nationwide question.
        lawsFor: async (code) => {
          if (code === NATIONWIDE) throw new Error('/ask-laws/US.json answered 404')
          return lawsOf(code)
        },
        ...(near === undefined ? {} : { nearLaws: async (code: string, question: string) => near(code, question) }),
        ...(rerank === undefined ? {} : { rerank }),
        ...(rephrase === undefined
          ? {}
          : { rephrase: async (question: string) => Object.assign(rephrase(question), family?.(question) === undefined ? {} : { family: family(question) as never }) }),
        topics: async () => topicsOf(process.cwd()).filter((topic) => topicFiles().has(topic.id)),
        topicLawsFor: async (topic) => {
          if (topicLawsFor !== undefined) return topicLawsFor(topic)
          const laws = topicFiles().get(topic)
          if (laws === undefined) throw new Error(`/ask-laws/topics/${topic}.json answered 404`)
          return laws
        },
        ...(topicsFor === undefined ? {} : { topicsFor }),
        ...(loop === undefined ? {} : { nearLawsNationwide: nearLawsNationwide(loop.ai, loop.index), lawsById: lawsByIdFor(loop.db) }),
        ...(lawsBySection === undefined ? {} : { lawsBySection }),
        ...(penaltiesFor === undefined ? {} : { penaltiesFor }),
        ...(processRowsFor === undefined ? {} : { processRowsFor }),
        contact: 'support@example.test',
      },
    )
    asked.outcomes.push(outcome)
    await route.fulfill({ json: body })
  })
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render: (_selector, options) => { options.callback('a-token'); return 'w1' } }`,
    }),
  )
  return asked
}

/** A reranker that scores one law first and the rest by pool order, as the deployed one scores by text. */
const preferringAny = (law: AskLaw): Rerank => async (_question, texts) =>
  texts.map((text) => (text === embeddingText(law) ? 1 : 0.1 - texts.indexOf(text) / 1000))

const says = (scope: 'road-law' | 'app', answer: string, sources: string[]): LearnerReply => ({
  kind: 'reply',
  scope,
  answer,
  sources,
  model: 'stub',
})

/**
 * A faithful model: it answers from the hydrant law it was given, with that
 * law's own figure -- the digits from the rule or, where the rule spells them
 * ("ten feet"), from the manual's quoted words -- and cites it. It knows no
 * figure of its own, so whatever reaches the screen came through retrieval.
 */
const fromTheHydrantLaw: Model = (request) => {
  const law = request.laws?.find((each) => /hydrant/i.test(each.law))
  const feet = law === undefined ? null : /(\d+) feet/.exec(`${law.law} ${law.citation ?? ''}`)
  if (law === undefined || feet === null) return says('road-law', '', [])
  return says('road-law', `At least ${feet[1]} feet from the hydrant.`, [law.id])
}

async function askOnPage(page: Page, question: string): Promise<void> {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-submit').click()
}

/**
 * The citations, folded under the one sources line until it is tapped: Joel's
 * high-beam answer (2026-10-11) was two sentences above five quoted
 * paragraphs (src/sources-line.ts). The last answer's, where a thread has two.
 */
async function openSources(page: Page): Promise<void> {
  await page.getByTestId('ask-sources-open').last().click()
}

/** `pickState`, less its last check: the dialog closes on the choice, taking the box with it. */
async function chooseInDialog(page: Page, name: string): Promise<void> {
  await stateSelector(page).fill(name)
  await page.getByRole('option', { name, exact: true }).click()
}

const HYDRANT = 'How far from a fire hydrant can I park?'

test.describe('road law, from the chosen state’s manual', () => {
  // AC1, guard 2. The figure is Florida's and the page under it is the one the
  // card cites, drawn from the corpus in the card's words.
  test('answers Florida’s hydrant question with Florida’s figure and the page it is on', async ({ page }) => {
    await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    await openSources(page)
    const citation = page.getByTestId('ask-citation')
    await expect(citation).toHaveCount(1)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    await expect(citation).toContainText('15 feet of a fire hydrant.')
    // A road-law answer is not an answer about the app: no "Read more" to the book.
    await expect(page.getByTestId('ask-sources')).toHaveCount(0)
  })

  // AC2, guard 1. Same words, another state: that state's law, that state's page.
  test('answers the same question on Ohio with Ohio’s figure and page, and nothing of Florida’s', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'OH' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    const answer = page.getByTestId('ask-answer')
    await expect(answer).toContainText('10 feet')
    await expect(answer).not.toContainText('15')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.30'))
    await expect(page.getByTestId('ask-citation')).not.toContainText('p.66')
    // Every law the model was shown was Ohio's.
    expect(asked[0].laws?.length ?? 0).toBeGreaterThan(0)
    expect(asked[0].laws?.every((law) => law.id.startsWith('OH-'))).toBe(true)
  })

  // AC3, guard 3. Nothing in the manual: the worker says so, and no guess is shown.
  test('says in one sentence that the manual does not answer it, with no figure, no link and no contact line', async ({ page }) => {
    // The model shrugs with an answer of its own and cites nothing.
    await workerWith(page, () => says('road-law', 'Probably, but it is not a good idea.', []))
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, 'Is it legal to drive barefoot?')

    const pointer = page.getByTestId('ask-pointer')
    await expect(pointer).toHaveText('Your state’s manual doesn’t say, as far as I can find, so I won’t guess about road law.')
    // The sentence is the whole reply (2026-10-05): nothing to tap under it.
    await expect(page.getByTestId('ask-pointer-link')).toHaveCount(0)
    await expect(page.getByTestId('ask-contact')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    await expect(page.getByTestId('ask-no-match')).not.toContainText('Probably')
    expect(await page.getByTestId('ask-no-match').innerText()).not.toMatch(/\d/)
  })

  // AC4, guard 6. An app question takes the path it always took.
  test('answers an app question as before: the model’s sentence and the book’s page, no manual citation', async ({ page }) => {
    await workerWith(page, () =>
      says('app', 'Open the menu and tap Start over; your purchase is kept.', ['your-data']),
    )
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, 'How do I reset my progress?')

    await expect(page.getByTestId('ask-answer')).toContainText('Start over')
    await expect(page.getByTestId('ask-source-link')).toHaveAttribute('href', '#privacy')
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
    // Nor folded out of sight: no sources line to tap open.
    await expect(page.getByTestId('ask-sources-line')).toHaveCount(0)
  })

  // AC5, guard 4. A law nobody retrieved is a law from memory.
  test('refuses an answer citing a law that was not retrieved for the question', async ({ page }) => {
    // FL-001 is a real Florida law, with a citation, that the hydrant question
    // does not reach.
    await workerWith(page, (request) => {
      expect(request.laws?.some((law) => law.id === 'FL-001')).toBe(false)
      return says('road-law', 'Yes, as long as you are careful.', ['FL-001'])
    })
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    await expect(page.getByTestId('ask-no-match')).not.toContainText('careful')
  })

  // AC5, guard 4. A page the cited law is not on is a page made up -- even when
  // its digits happen to appear in the law.
  test('refuses an answer naming a page that no cited law is on', async ({ page }) => {
    await workerWith(page, (request) => {
      const law = request.laws?.find((each) => each.id === 'FL-399')
      expect(law?.citation).toContain('p.66')
      return says('road-law', 'At least 15 feet, as page 15 of the manual says.', ['FL-399'])
    })
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })

  // AC6, guard 5. No state, no generic answer: choose one first. Reported on
  // 2026-10-08: a "pick your state first" card with a link was one more tap to
  // an answer that only needed a state, so the picker opens instead, over this
  // page, and the card is never shown.
  test('opens the state picker over this page the moment a learner with no state asks, with no card behind it', async ({ page }) => {
    const asked = await workerWith(page, () => says('road-law', 'At least 15 feet.', ['MD-001']))
    await seed(page, {}, { stateChosen: false })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-state-dialog')).toBeVisible()
    expect(asked[0].laws).toBeNull()
    expect(await page.evaluate(() => window.location.hash)).toBe('#ask')
    await expect(page.getByText('Pick your state first')).toHaveCount(0)
    await expect(page.getByTestId('ask-choose-state')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })

  // Opening on its own must not trap anybody: a learner who backs out keeps
  // the question where they typed it, and asking again opens the picker again.
  test('lets a learner cancel the picker that opened on its own, keeping the question to ask again', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateChosen: false })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)
    await page.getByTestId('ask-state-cancel').click()

    await expect(page.getByTestId('ask-state-dialog')).toHaveCount(0)
    await expect(page.getByTestId('ask-input')).toHaveValue(HYDRANT)
    await expect(page.getByText('Pick your state first')).toHaveCount(0)
    await page.getByTestId('ask-submit').click()
    await chooseInDialog(page, 'Ohio')
    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    expect(asked.map((request) => request.question)).toEqual([HYDRANT, HYDRANT, HYDRANT])
  })

  // Reported on 2026-10-05: a visitor picked their state, asked before pressing
  // Start, and was told to pick their state. The picker's choice is the state.
  test('answers from the state chosen on the picker, before Start is pressed', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateChosen: false })
    await page.goto('/')
    await pickState(page, 'OH')
    await page.getByTestId('ask-trigger').click()
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    await expect(page.getByTestId('ask-choose-state')).toHaveCount(0)
    expect(asked[0].laws?.every((law) => law.id.startsWith('OH-'))).toBe(true)
  })

  // The same visitor arriving on a state's own page has chosen it by the link.
  test('answers from the state whose page the visitor is on', async ({ page }) => {
    await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateChosen: false })
    await page.goto('/drivers/OH/')
    await page.getByTestId('ask-trigger').click()
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
  })

  // Reported on 2026-10-05: after "Choose your state", the question was gone
  // and had to be typed again. Then 2026-10-07: choosing should not leave the
  // page at all. The state is chosen over it and the question answered for it.
  test('answers the waiting question for the state chosen in the picker, without leaving the page', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateChosen: false })
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state')).toContainText('No state chosen')
    await askOnPage(page, HYDRANT)
    await chooseInDialog(page, 'Ohio')

    await expect(page.getByTestId('ask-state-dialog')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Ohio')
    expect(asked.map((request) => request.question)).toEqual([HYDRANT, HYDRANT])
    expect(asked[1].laws?.every((law) => law.id.startsWith('OH-'))).toBe(true)
    // The front page's picker is holding the same choice.
    await page.getByTestId('ask-back').click()
    await expect(stateSelector(page)).toHaveValue('Ohio')
  })

  // Reported on 2026-10-07: the answer arrived for the chosen state, and above
  // it the thread still said "Pick your state first" to somebody who just had.
  test('drops the pick-your-state prompt once the waiting question is answered for the chosen state', async ({ page }) => {
    await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateChosen: false })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)
    await chooseInDialog(page, 'Ohio')

    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    await expect(page.getByTestId('ask-choose-state')).toHaveCount(0)
    await expect(page.getByText('Pick your state first')).toHaveCount(0)
  })

  // Reported on 2026-10-08: after choosing, nothing changed until the answer
  // came back, which read as the choice not having been taken. The question
  // shows as being asked at once, and its answer takes that place.
  test('shows the waiting question with a spinner the moment a state is chosen', async ({ page }) => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await workerWith(page, async (request) => {
      if (request.laws === null) return fromTheHydrantLaw(request)
      await held
      return fromTheHydrantLaw(request)
    })
    await seed(page, {}, { stateChosen: false })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)
    await chooseInDialog(page, 'Ohio')

    await expect(page.getByTestId('ask-asking')).toBeVisible()
    await expect(page.getByTestId('ask-choose-state')).toHaveCount(0)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    release()
    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    await expect(page.getByTestId('ask-asking')).toHaveCount(0)
    await expect(page.getByRole('listitem').filter({ hasText: HYDRANT })).toHaveCount(1)
  })

  // A learner mid-course sees which state answers, and changing it here is a
  // change of course: the next answer comes from the new state's manual.
  test('names the state being studied and answers for the one it is changed to', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Florida')
    await page.getByTestId('ask-change-state').click()
    await chooseInDialog(page, 'Ohio')
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Ohio')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('10 feet')
    expect(asked[0].laws?.every((law) => law.id.startsWith('OH-'))).toBe(true)
    // Nothing was waiting, so nothing was asked on the choice itself.
    expect(asked).toHaveLength(1)
  })

  // Reported on 2026-10-05: Alabama has a hydrant law, and "how far must i be
  // behing a firehydrant" reached none of it -- a typo and a run-together word,
  // which is how questions are typed on a phone.
  test('reaches the law through a typo and a run-together word', async ({ page }) => {
    await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'AL' })
    await page.goto('/#ask')
    await askOnPage(page, 'how far must i be behing a firehydrant')

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    await openSources(page)
    await expect(page.getByTestId('ask-citation')).toContainText('fire hydrant')
  })

  // Statute corpus AC1 (docs/plans/statute-corpus.md): Maryland's manual never
  // mentions a hydrant; Maryland's code does, and the answer says which it is.
  test('answers from the state’s code where the manual is silent, labelled as not the manual', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText(
      EN.ask.labels.inTheLaw('Md. Code, Transp. § 21-1003(m)'),
    )
    await expect(page.getByTestId('ask-citation')).toContainText(
      'A person may not stand or park a vehicle within 15 feet of a fire hydrant.',
    )
    await expect(page.getByTestId('ask-citation-page')).toHaveCount(0)
    expect(asked[0].laws?.find((law) => law.id === 'MD-S01')?.kind).toBe('statute')
  })

  // The section number is the reference, not a figure: "§ 21-1003" must not
  // ground "21 feet".
  test('refuses a figure only the statute’s section number contains', async ({ page }) => {
    await workerWith(page, () => says('road-law', 'At least 21 feet.', ['MD-S01']))
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })

  // Vehicle code AC3, guard 7 (docs/plans/vehicle-code.md): a question the
  // manual and the fifteen hand-written laws never touch, answered from a
  // chunk of the Transportation Article -- labelled as the law, not the manual,
  // with the subsection quoted, and the chunk among what the model was given.
  test('answers a question only the vehicle code answers, labelled as Maryland law with the subsection quoted', async ({ page }) => {
    const asked = await workerWith(page, (request) => {
      const law = request.laws?.find((each) => each.id === 'MD-C-21-1108-a')
      if (law === undefined) return says('road-law', '', [])
      return says('road-law', 'No. Maryland law says you may not coast downhill in neutral.', [law.id])
    })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'Can I coast downhill in neutral?')

    await expect(page.getByTestId('ask-answer')).toContainText('may not coast downhill in neutral')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText(EN.ask.labels.inTheLaw('Md. Code, Transp. § 21-1108(a)'))
    await expect(page.getByTestId('ask-citation')).toContainText(
      'the driver of the motor vehicle may not coast with the gears or transmission in neutral.',
    )
    await expect(page.getByTestId('ask-citation-page')).toHaveCount(0)
    expect(asked[0].laws?.find((law) => law.id === 'MD-C-21-1108-a')?.kind).toBe('statute')
  })

  // Vehicle code AC6, guard 4: a chunk's citation carries its section number,
  // and "§ 21-1003(m)" must no more ground "21 feet" than the hand law's did.
  test('refuses a figure that only a code chunk’s section number contains', async ({ page }) => {
    await workerWith(page, (request) => {
      expect(request.laws?.some((law) => law.id === 'MD-C-21-1003-m')).toBe(true)
      return says('road-law', 'At least 21 feet from the hydrant.', ['MD-C-21-1003-m'])
    })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })

  // Vehicle code AC17: every state whose hydrant verdict is a chunk of its
  // code gets this case by merging, read from coverage.json -- the figure, the
  // label as that state's law, and that state's chunk among what the model saw.
  for (const [code, block] of Object.entries(readCoverage(process.cwd()))) {
    const verdict = block['park-hydrant']
    if (verdict?.from !== 'code' || verdict.law === undefined) continue
    test(`${code}: answers the hydrant question from the state’s code, labelled as its law`, async ({ page }) => {
      const chunk = lawsOf(code).find((law) => law.id === verdict.law)!
      // The figure as the checker reads it: Arizona spells it, "fifteen feet".
      const feet = [...figuresIn(/[^.;]*\bfeet\b/i.exec(chunk.law)![0], 'en')][0]
      const asked = await workerWith(page, (request) =>
        request.laws?.some((law) => law.id === chunk.id)
          ? says('road-law', `At least ${feet} feet from the hydrant.`, [chunk.id])
          : says('road-law', '', []),
      )
      await seed(page, {}, { stateCode: code })
      await page.goto('/#ask')
      await askOnPage(page, HYDRANT)

      await expect(page.getByTestId('ask-answer')).toContainText(`${feet} feet`)
      await openSources(page)
      await expect(page.getByTestId('ask-citation-law')).toHaveText(EN.ask.labels.inTheLaw(chunk.citation!.split(' — ')[0]))
      expect(asked[0].laws?.some((law) => law.id === chunk.id)).toBe(true)
    })
  }

  // Vehicle code AC8 put a road-law example first so visitors saw road law
  // was in scope. The examples are gone (Joel, 2026-10-12): each was typed
  // into the box and counted against the week, while styled as the free
  // chips under it are, so it read as a chip that cost a question. The stored
  // chips now say what the box answers. Mutation: pass examples to the box.
  test('puts no typed question under the box dressed as a free chip: the one-tap questions are the stored chips', async ({ page }) => {
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await expect(page.getByTestId('ask-state-chip')).not.toHaveCount(0)
    await expect(page.getByTestId('ask-example')).toHaveCount(0)
  })

  // Vehicle code AC7, guard 9: the field under the site name on both front
  // pages opens the ask page, ready to type in.
  for (const [where, path, words] of [
    ['the welcome screen', '/', 'Ask any question about your state’s driving law'],
    ['Maryland’s page', '/drivers/MD/', 'Ask any question about Maryland driving law'],
  ] as const) {
    test(`opens the ask page with its input focused from the entry on ${where}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 })
      await seed(page, {}, { stateChosen: false })
      await page.goto(path)
      const entry = page.getByTestId('ask-entry')
      await expect(entry).toHaveText(words)
      await entry.click()

      await expect(page.getByRole('heading', { name: EN.ask.title, level: 1 })).toBeVisible()
      await expect(page.getByTestId('ask-input')).toBeFocused()
    })
  }

  // docs/plans/law-vectors.md: a question that shares no word with the law --
  // here Spanish against English text -- reaches it through the index. The
  // index is faked at its edge with what bge-m3 returns for it (FL-399 first).
  test('reaches the law through the meaning index when the question shares none of its words', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw, (code, question) =>
      code === 'FL' && question.includes('hidrante') ? ['FL-399'] : [],
    )
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, '¿A qué distancia de un hidrante puedo estacionar?')

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    expect(asked[0].laws?.map((law) => law.id)).toContain('FL-399')
  })

  // docs/plans/rerank.md. The law the reranker puts first is chosen from a
  // pool far wider than the eight retrieval used to send: here the coasting
  // rule is taken from deep in Maryland's pool for a question about parking,
  // and it -- not retrieval's first eight -- is what the model reads.
  test.describe('the reranker', () => {
    const PARK = 'Where may I not park?'
    const pool = () => retrieve(lawsOf('MD'), PARK, CANDIDATE_LAWS)
    /** Scores a law by its text, as the deployed reranker does: the one law it is told to prefer scores 1. */
    const preferring = (law: AskLaw): Rerank => async (_question, texts) =>
      texts.map((text) => (text === embeddingText(law) ? 1 : 0.1 - texts.indexOf(text) / 1000))

    // AC1, AC2, guards 1, 3, 4.
    test('gives the model the three it ranks first, and answers from the one it ranks first even past retrieval’s eight', async ({ page }) => {
      // A chunk of the code, from past the eight retrieval alone would send.
      const deep = pool().slice(RETRIEVED_LAWS).find((law) => law.kind === 'statute' && /-C-/.test(law.id))!
      const asked = await workerWith(
        page,
        (request) => says('road-law', 'Here is the rule that applies.', [request.laws![0].id]),
        undefined,
        preferring(deep),
      )
      await seed(page, {}, { stateCode: 'MD' })
      await page.goto('/#ask')
      await askOnPage(page, PARK)

      await expect(page.getByTestId('ask-answer')).toContainText('Here is the rule that applies.')
      await openSources(page)
      await expect(page.getByTestId('ask-citation')).toContainText(deep.citation!.split(' — ')[0])
      expect(asked[0].laws?.length).toBe(ANSWER_LAWS)
      expect(asked[0].laws?.[0].id).toBe(deep.id)
    })

    // AC3, guard 2. The meaning index names laws BM25 ranks 17th to 24th:
    // a 24-law pool reaches them by BM25 too and its first eight are other
    // laws, so the fallback must be retrieved as it was, not cut from the pool.
    test('falls back to exactly the eight retrieval gave before when the reranker fails, and still answers', async ({ page }) => {
      const nearIds = retrieve(lawsOf('FL'), HYDRANT, 48).slice(16, 24).map((law) => law.id)
      const asked = await workerWith(
        page,
        fromTheHydrantLaw,
        (code) => (code === 'FL' ? nearIds : []),
        async () => {
          throw new Error('reranker down')
        },
      )
      await seed(page, {}, { stateCode: 'FL' })
      await page.goto('/#ask')
      await askOnPage(page, HYDRANT)

      await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
      expect(asked[0].laws?.map((law) => law.id)).toEqual(retrieve(lawsOf('FL'), HYDRANT, RETRIEVED_LAWS, nearIds).map((law) => law.id))
    })

    // The manual stays first for what it states (vehicle-code.md). Left alone,
    // the reranker gave Maryland's adult blood-alcohol question three code
    // subsections that do not answer it and dropped the manual's ".08".
    test('keeps the manual’s best law among the three when the reranker ranks only the code above it', async ({ page }) => {
      const BAC = 'What is the legal blood alcohol limit for adult drivers?'
      const candidates = retrieve(lawsOf('MD'), BAC, CANDIDATE_LAWS)
      const code = candidates.filter((law) => /-C-/.test(law.id)).slice(0, 3)
      const manual = candidates.filter((law) => law.kind !== 'statute')
      const asked = await workerWith(
        page,
        (request) => says('road-law', 'Here is the rule that applies.', [request.laws![0].id]),
        undefined,
        async (_question, texts) =>
          texts.map((text) => (code.some((law) => embeddingText(law) === text) ? 1 : text === embeddingText(manual[1]) ? 0.5 : 0.1)),
      )
      await seed(page, {}, { stateCode: 'MD' })
      await page.goto('/#ask')
      await askOnPage(page, BAC)

      await expect(page.getByTestId('ask-answer')).toContainText('Here is the rule that applies.')
      expect(code.length).toBe(3)
      expect(manual.length).toBeGreaterThan(1)
      expect(asked[0].laws?.map((law) => law.id)).toEqual([code[0].id, code[1].id, manual[1].id])
    })

    // California's adult blood-alcohol question was given three under-21
    // limits and lost the 0.08% law retrieval ranked first; that law now
    // keeps a place, whatever the reranker thinks of it.
    test('keeps retrieval’s first law among the three when the reranker ranks it last', async ({ page }) => {
      const candidates = pool()
      const asked = await workerWith(
        page,
        (request) => says('road-law', 'Here is the rule that applies.', [request.laws![0].id]),
        undefined,
        async (_question, texts) => texts.map((text) => (text === embeddingText(candidates[0]) ? -1 : 1 - texts.indexOf(text) / 100)),
      )
      await seed(page, {}, { stateCode: 'MD' })
      await page.goto('/#ask')
      await askOnPage(page, PARK)

      await expect(page.getByTestId('ask-answer')).toContainText('Here is the rule that applies.')
      expect(asked[0].laws?.map((law) => law.id)).toEqual([candidates[1].id, candidates[2].id, candidates[0].id])
    })

    // Haiku names the laws that answer and leaves the rest unranked. Putting
    // retrieval's first or the manual's best back over a law it chose undid
    // the choice: Nevada's side-window tint answer lost § 484D.440(3)(a) to
    // the law retrieval ranked first. A protection stands only for a law the
    // reranker ranked at all.
    test('gives the model only the laws the reranker named when it leaves retrieval’s first unranked', async ({ page }) => {
      const candidates = pool()
      const named = candidates.filter((law) => law.kind === 'statute').slice(1, 4)
      const asked = await workerWith(
        page,
        (request) => says('road-law', 'Here is the rule that applies.', [request.laws![0].id]),
        undefined,
        async (_question, texts) => texts.map((text) => {
          const at = named.findIndex((law) => embeddingText(law) === text)
          return at < 0 ? Number.NEGATIVE_INFINITY : 5 - at
        }),
      )
      await seed(page, {}, { stateCode: 'MD' })
      await page.goto('/#ask')
      await askOnPage(page, PARK)

      await expect(page.getByTestId('ask-answer')).toContainText('Here is the rule that applies.')
      expect(asked[0].laws?.map((law) => law.id)).toEqual(named.map((law) => law.id))
    })

    // The same for the manual's best: Maryland's parking pool holds no manual
    // law, so this asks Florida's hydrant question, whose pool holds FL-399.
    test('gives the model only the code laws the reranker named when it leaves every manual law unranked', async ({ page }) => {
      const candidates = retrieve(lawsOf('FL'), HYDRANT, CANDIDATE_LAWS)
      expect(candidates.some((law) => law.kind !== 'statute'), 'a manual law in the pool').toBe(true)
      const named = candidates.filter((law) => law.kind === 'statute').slice(0, 3)
      const asked = await workerWith(
        page,
        (request) => says('road-law', 'Here is the rule that applies.', [request.laws![0].id]),
        undefined,
        async (_question, texts) => texts.map((text) => {
          const at = named.findIndex((law) => embeddingText(law) === text)
          return at < 0 ? Number.NEGATIVE_INFINITY : 5 - at
        }),
      )
      await seed(page, {}, { stateCode: 'FL' })
      await page.goto('/#ask')
      await askOnPage(page, HYDRANT)

      await expect(page.getByTestId('ask-answer')).toContainText('Here is the rule that applies.')
      expect(asked[0].laws?.map((law) => law.id)).toEqual(named.map((law) => law.id))
    })

    // AC4. A law the pool held but the reranker did not give is a law from memory.
    test('refuses an answer citing a law from the pool that was not among the three given', async ({ page }) => {
      const [kept, , , dropped] = pool()
      await workerWith(page, () => says('road-law', 'Yes, as the rule says.', [dropped.id]), undefined, preferring(kept))
      await seed(page, {}, { stateCode: 'MD' })
      await page.goto('/#ask')
      await askOnPage(page, PARK)

      await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
      await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    })
  })

  // The learner's words are not the law's. For "what is the highest posted
  // speed limit" both searches put the laws that contain "posted speed limit"
  // on top -- golf carts, scooters -- and Texas's 85 mph law ranked 44th, past
  // the pool; the box said the manual did not say. The question said again in
  // the law's words finds it.
  test('finds the law by the question said again in the law’s words, and answers from it', async ({ page }) => {
    const question = 'what is the highest posted speed limit'
    const eightyFive = lawsOf('TX').find((law) => law.id === 'TX-C-545.353-h-2')!
    expect(retrieve(lawsOf('TX'), question, CANDIDATE_LAWS).some((law) => law.id === eightyFive.id), 'the premise: the question alone misses it').toBe(false)
    const asked = await workerWith(
      page,
      (request) =>
        request.laws?.some((law) => law.id === eightyFive.id)
          ? says('road-law', 'Texas law lets the commission set a limit of up to 85 mph on part of the state highway system.', [eightyFive.id])
          : says('road-law', '', []),
      undefined,
      preferringAny(eightyFive),
      () => ['maximum speed limit highway'],
    )
    await seed(page, {}, { stateCode: 'TX' })
    await page.goto('/#ask')
    await askOnPage(page, question)

    await expect(page.getByTestId('ask-answer')).toContainText('85 mph')
    await openSources(page)
    await expect(page.getByTestId('ask-citation')).toContainText('§ 545.353(h-2)')
    expect(asked[0].laws?.some((law) => law.id === eightyFive.id)).toBe(true)
  })

  // Fusing the searches' rankings beside the question's moves laws out of the
  // pool as well as in: by words alone, Pennsylvania's move-over law is in the
  // 24 for this question and out of them once two searches are fused -- RRF
  // rewards a law mediocre in every ranking over one first in the question's
  // alone -- so the box would have refused a question the question alone
  // answered. The pool is wider when searches were fused into it.
  test('reads a wider pool when the question was also searched in the law’s words', async ({ page }) => {
    const question = 'What must you do when passing a stopped emergency vehicle with flashing lights?'
    const searches = ['stopped emergency vehicle flashing lights passing', 'emergency vehicle flashing lights driver responsibility']
    const moveOver = lawsOf('PA').find((law) => law.id === 'PA-C-3327-a')!
    const pool = (limit: number, fused: boolean) =>
      retrieve(lawsOf('PA'), question, limit, [], fused ? searches.map((search) => ({ search, near: [] })) : [])
    expect(pool(CANDIDATE_LAWS, false).some((law) => law.id === moveOver.id), 'the premise: the question alone reaches it').toBe(true)
    expect(pool(CANDIDATE_LAWS, true).some((law) => law.id === moveOver.id), 'the premise: the searches push it past 24').toBe(false)
    expect(pool(SEARCHED_CANDIDATE_LAWS, true).some((law) => law.id === moveOver.id), 'the premise: it is within 32').toBe(true)
    const asked = await workerWith(
      page,
      (request) =>
        request.laws?.some((law) => law.id === moveOver.id)
          ? says('road-law', 'Pennsylvania law says to pass in a lane not next to the emergency response area, or if you cannot, at no more than 20 mph below the posted limit.', [moveOver.id])
          : says('road-law', '', []),
      undefined,
      preferringAny(moveOver),
      () => searches,
    )
    await seed(page, {}, { stateCode: 'PA' })
    await page.goto('/#ask')
    await askOnPage(page, question)

    await expect(page.getByTestId('ask-answer')).toContainText('20 mph')
    await openSources(page)
    await expect(page.getByTestId('ask-citation')).toContainText('§ 3327(a)')
    expect(asked[0].laws?.some((law) => law.id === moveOver.id)).toBe(true)
  })

  // Statutes spell their figures and the model writes digits. Colorado's "closer
  // than five hundred feet" behind a fire truck was read as 5 and 100, and the
  // correct "500 feet" was refused as ungrounded; Arizona's golf cart, "less than
  // one thousand eight hundred pounds", is the same shape.
  test('grounds a figure the law spells as a compound: “one thousand eight hundred” is 1800', async ({ page }) => {
    await workerWith(page, (request) =>
      request.laws?.some((law) => law.id === 'AZ-C-28-101-38')
        ? says('road-law', 'Under Arizona law a golf cart weighs less than 1800 pounds unladen.', ['AZ-C-28-101-38'])
        : says('road-law', '', []),
    )
    await seed(page, {}, { stateCode: 'AZ' })
    await page.goto('/#ask')
    await askOnPage(page, 'What is the weight limit for a golf cart?')

    await expect(page.getByTestId('ask-answer')).toContainText('1800 pounds')
  })

  // The model writes a thousands comma the law never has: New York's crash
  // report law spells "one thousand dollars", and the correct "$1,000" was read
  // as 1 and 000 and refused as ungrounded.
  test('grounds a figure written with a thousands comma: “1,800” is 1800', async ({ page }) => {
    await workerWith(page, (request) =>
      request.laws?.some((law) => law.id === 'AZ-C-28-101-38')
        ? says('road-law', 'Under Arizona law a golf cart weighs less than 1,800 pounds unladen.', ['AZ-C-28-101-38'])
        : says('road-law', '', []),
    )
    await seed(page, {}, { stateCode: 'AZ' })
    await page.goto('/#ask')
    await askOnPage(page, 'What is the weight limit for a golf cart?')

    await expect(page.getByTestId('ask-answer')).toContainText('1,800 pounds')
  })

  // Connecticut writes its blood-alcohol limit as "eight-hundredths of one per
  // cent", and the correct "0.08" was ungroundable against the section that
  // sets it.
  test('grounds a blood-alcohol limit the law spells as hundredths of one per cent', async ({ page }) => {
    await workerWith(page, (request) =>
      request.laws?.some((law) => law.id === 'CT-C-14-227b-o')
        ? says('road-law', 'In Connecticut the limit for adult drivers is 0.08.', ['CT-C-14-227b-o'])
        : says('road-law', '', []),
    )
    await seed(page, {}, { stateCode: 'CT' })
    await page.goto('/#ask')
    await askOnPage(page, 'What is the legal blood alcohol limit for adult drivers?')

    await expect(page.getByTestId('ask-answer')).toContainText('0.08')
  })

  // Illinois's scooter answer -- "a 45 mph road is over the 35 mph limit" --
  // was refused two times in three for saying back the question's own 45.
  test('lets an answer repeat a figure the learner gave, and still refuses one nobody gave', async ({ page }) => {
    const answers = ['No: 10 feet is too close; you must park at least 15 feet away.', 'No: 10 feet is too close; you must park at least 20 feet away.']
    await workerWith(page, (request) => {
      const law = request.laws?.find((each) => each.id === 'MD-S01')
      return law === undefined ? says('road-law', '', []) : says('road-law', answers.shift()!, [law.id])
    })
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'Can I park 10 feet from a fire hydrant?')
    await expect(page.getByTestId('ask-answer')).toContainText('at least 15 feet away')

    await askOnPage(page, 'Can I park 10 feet from a fire hydrant?')
    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
  })

  // AC8, guard 8. The file the worker reads is one this build publishes.
  // Vermont's manual gives 15 days to show proof of insurance; its § 800(c)
  // gives seven business days, and an answer quoting the manual would cost a
  // learner the deadline. A manual line its state's code contradicts is not
  // published to the box; the statute that says otherwise still is.
  test('publishes no manual line its state’s code contradicts, and keeps the statute that does', async ({ request }) => {
    for (const [id, { by }] of Object.entries(supersededOf(process.cwd()))) {
      const code = id.slice(0, 2)
      const published = (await (await request.get(`/ask-laws/${code}.json`)).json()) as AskLaw[]
      expect(published.some((law) => law.id === id), `${id} is published`).toBe(false)
      expect(published.some((law) => law.id === by), `${by} is not published`).toBe(true)
    }
  })

  test('publishes each state’s laws and citations where the worker reads them', async ({ request }) => {
    const response = await request.get('/ask-laws/FL.json')
    expect(response.status()).toBe(200)
    const laws = (await response.json()) as AskLaw[]
    const hydrant = laws.find((law) => law.id === 'FL-399')
    expect(hydrant?.law).toContain('15 feet of a fire hydrant')
    expect(hydrant?.citation).toMatch(/^p\.66 /)

    // A state whose code is not in publishes its manual and nothing labelled
    // as law. Picked rather than named: this was Florida until Florida's code
    // went in, then any state with no coverage block, and none is left of those.
    const codeless = Object.keys(CODELESS)[0]
    expect(codeless, 'a state whose code is not in').toBeDefined()
    const manualOnly = (await (await request.get(`/ask-laws/${codeless}.json`)).json()) as AskLaw[]
    expect(manualOnly.length).toBeGreaterThan(0)
    expect(manualOnly.some((law) => law.kind === 'statute'), codeless).toBe(false)

    const maryland = (await (await request.get('/ask-laws/MD.json')).json()) as AskLaw[]
    const statute = maryland.find((law) => law.id === 'MD-S01')
    expect(statute?.kind).toBe('statute')
    expect(statute?.citation).toMatch(/^Md\. Code, Transp\. § 21-1003\(m\) — '/)
  })
})

/**
 * A link from a road-law answer to the card that teaches the law it cited
 * (docs/plans/ask-cards.md). Florida, because its hydrant law is a card deep in
 * the pass: card 399 of 591, so "reached" and "not reached" are both a seed away.
 */
/**
 * "What happens if I get pulled over without my license?" (docs/plans/what-happens-if.md,
 * phase 1). Texas's code prints the duty, the fine and the way out as
 * subsections of one section, § 521.025, and retrieval reached the duty and
 * never the other two; the learner was told the rule and a fine from the
 * manual, and never that bringing the license to court drops the charge.
 * Here the index's pick and the reranker choose the duty in (a), as they do,
 * and the section's other subsections come from the table -- read from the
 * corpus it is pushed from -- so the answer the learner sees can carry the
 * fine and the defence, each cited.
 */
test.describe('what happens if', () => {
  const NO_LICENSE = "What happens if I get pulled over and I don't have my license with me?"

  // Criterion 2 at the page: the fine and the defence, from subsections
  // retrieval never chose, under their own citations.
  test('answers Texas’s no-license question with the fine and the defence from the section the duty is in', async ({ page }) => {
    const duty = lawsOf('TX').find((law) => law.id === 'TX-C-521.025-a')!
    const asked = await workerWith(
      page,
      (request) => {
        const fine = request.laws?.find((law) => law.id === 'TX-C-521.025-c')
        const defence = request.laws?.find((law) => law.id === 'TX-C-521.025-d')
        if (fine === undefined || defence === undefined) return says('road-law', '', [])
        return says('road-law', 'You can get a ticket with a fine of up to $200. If you bring your valid license to court, the charge is dropped.', [fine.id, defence.id])
      },
      () => [duty.id],
      preferringAny(duty),
      undefined,
      undefined,
      undefined,
      undefined,
      lawsBySectionFromCorpus(process.cwd()),
    )
    await seed(page, {}, { stateCode: 'TX' })
    await page.goto('/#ask')
    await askOnPage(page, NO_LICENSE)

    await expect(page.getByTestId('ask-answer')).toContainText('a fine of up to $200')
    await expect(page.getByTestId('ask-answer')).toContainText('bring your valid license to court')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText([
      EN.ask.labels.inTheLaw('Tex. Transp. Code § 521.025(c)'),
      EN.ask.labels.inTheLaw('Tex. Transp. Code § 521.025(d)'),
    ])
    const given = asked[0].laws?.map((law) => law.id) ?? []
    expect(given.indexOf('TX-C-521.025-a')).toBeLessThan(given.indexOf('TX-C-521.025-c'))
    expect(given).toEqual(expect.arrayContaining(['TX-C-521.025-a', 'TX-C-521.025-b', 'TX-C-521.025-c', 'TX-C-521.025-d', 'TX-C-521.025-e', 'TX-C-521.025-f']))
  })

  // Criterion 12 at the page: Maryland's $50 is the District Court's
  // schedule and in no section of its code, so the duty's section is joined
  // to the schedule's row by the committed file the table is pushed from, and
  // the answer shows the schedule beneath it with its own line and its date.
  test('answers Maryland’s no-license question with the schedule’s $50, paid without court and no points, the schedule cited and dated beneath', async ({ page }) => {
    const duty = lawsOf('MD').find((law) => law.id === 'MD-C-16-112-b')!
    const schedule = JSON.parse(readFileSync(path.join(process.cwd(), 'resource/penalties/MD.json'), 'utf8')) as { rows: { id: string; quote: string; source_title: string; as_of: string }[] }
    const fine = schedule.rows.find((row) => row.id === 'MD-P-16-112-c')!
    const asked = await workerWith(
      page,
      (request) => {
        const given = request.laws?.find((law) => law.id === fine.id)
        if (given === undefined) return says('road-law', 'Carry your license and show it when an officer asks.', [duty.id])
        return says('road-law', 'If you’re licensed, you’ll usually get a $50 ticket you can pay without going to court, with no points.', [given.id])
      },
      () => [duty.id],
      preferringAny(duty),
      undefined,
      undefined,
      undefined,
      undefined,
      lawsBySectionFromCorpus(process.cwd()),
      penaltiesFromFiles(process.cwd()),
    )
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, NO_LICENSE)

    await expect(page.getByTestId('ask-answer')).toContainText('If you’re licensed, you’ll usually get a $50 ticket you can pay without going to court, with no points.')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText([EN.ask.labels.inTheLaw(fine.source_title)])
    await expect(page.getByTestId('ask-citation').locator('q')).toHaveText([fine.quote])
    await expect(page.getByTestId('ask-citation-asof')).toHaveText([EN.ask.labels.asOf(fine.as_of)])
    const given = asked[0].laws?.map((law) => law.id) ?? []
    const section = given.filter((id) => id.startsWith('MD-C-16-112-'))
    expect(section.length).toBeGreaterThan(1)
    const after = given.slice(given.indexOf(section[section.length - 1]) + 1)
    expect(after.slice(0, after.indexOf(fine.id) + 1).every((id) => id.startsWith('MD-P-16-112-'))).toBe(true)
  })

  // Criterion 17 at the page: "how soon can I retake it" shares no word with
  // the MVA's page, whose passage is added by the family the rephraser named,
  // and the answer shows the page beneath it -- the agency, the page's title,
  // its own passage and the day it was read -- labelled as not the manual.
  test('answers Maryland’s retake question from the MVA’s own page, the page cited and dated beneath', async ({ page }) => {
    const pages = JSON.parse(readFileSync(path.join(process.cwd(), 'resource/process/MD.json'), 'utf8')) as { families: Record<string, { title: string; agency: string; as_of: string; passages: string[] }> }
    const retake = pages.families['test-and-retake']
    const wait = retake.passages.find((passage) => /seven calendar days/.test(passage))!
    const asked = await workerWith(
      page,
      (request) => {
        const given = request.laws?.find((law) => law.law === wait)
        if (given === undefined) return says('road-law', '', [])
        return says('road-law', 'After a second fail you must wait at least 7 days to test again.', [given.id])
      },
      undefined,
      async (_question, texts) => texts.map((text) => (text.includes(wait) ? 5 : Number.NEGATIVE_INFINITY)),
      () => ['zzz'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      processRowsFromFiles(process.cwd()),
      () => 'test-and-retake',
    )
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'how soon can i go again if i flunk')

    await expect(page.getByTestId('ask-answer')).toContainText('After a second fail you must wait at least 7 days to test again.')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText([EN.ask.labels.inTheLaw(`${retake.agency} — ${retake.title}`)])
    await expect(page.getByTestId('ask-citation').locator('q')).toHaveText([wait])
    await expect(page.getByTestId('ask-citation-asof')).toHaveText([EN.ask.labels.asOf(retake.as_of)])
    expect(asked[0].laws?.find((law) => law.law === wait)?.kind).toBe('process')
  })

  // Criterion 7 at the page: one sentence naming who decides, with nothing
  // under it that would look like a law it rests on.
  test('answers “will my parents find out” in one sentence with no citation under it', async ({ page }) => {
    const sentence = 'The court sends its notices to the address on your license, so they may see the mail.'
    await workerWith(page, () => ({ kind: 'reply', scope: 'other', answer: sentence, sources: [], model: 'stub' }))
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, 'Will my parents find out if I get a ticket?')

    await expect(page.getByTestId('ask-answer')).toHaveText(sentence)
    await expect(page.getByTestId('ask-citation')).toHaveCount(0)
    await expect(page.getByTestId('ask-sources-line')).toHaveCount(0)
    await expect(page.getByTestId('ask-sources')).toHaveCount(0)
    await expect(page.getByTestId('ask-contact')).toHaveCount(0)
  })
})

test.describe('a link from the answer to the card', () => {
  const FL = studyLawsFor('FL')
  const at = (id: string) => FL.findIndex((law) => law.id === id)
  const HYDRANT_LAW = FL[at('FL-399')]
  // The second law of its concept, so a card found by concept rather than by
  // id would be the hydrant card, not this one.
  const INTERSECTION_LAW = FL[at('FL-400')]
  const LANG_KEY = 'teach-and-test/v1/lang'
  // Paid, so the wall after the first section is not what hides a control:
  // the ceiling is the thing each test is about.
  const PAID_FL = { stateCode: 'FL', entitled: true }

  /**
   * On a study card, then the ask page from the chrome. A seeded frontier opens
   * on its section's questions, a quiz, where no card is linked; the subject
   * here is a learner reading the pass.
   */
  async function askFromTheCards(page: Page): Promise<void> {
    await page.goto('/')
    await skipToCards(page)
    await expect(page.getByTestId('study-card')).toBeVisible()
    await page.getByTestId('ask-trigger').click()
  }

  /** A model that cites exactly these laws, if retrieval gave them, with the hydrant law's figure. */
  const citing =
    (ids: string[], answer = 'At least 15 feet from the hydrant.'): Model =>
    (request) => {
      if (!ids.every((id) => request.laws?.some((law) => law.id === id))) return says('road-law', '', [])
      return says('road-law', answer, ids)
    }

  // AC1, guards 1 and 4. The control is there -- an id that matched nothing
  // would quietly draw no link -- and pressing it puts the cited card on
  // screen, not merely in state under the ask page.
  test('opens the hydrant card from Florida’s answer, without moving the pass', async ({ page }) => {
    await workerWith(page, citing(['FL-399']))
    const studyIndex = at('FL-399') + 6
    await seed(page, { studyIndex }, PAID_FL)
    await askFromTheCards(page)
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    const control = page.getByTestId('ask-citation').getByTestId('ask-card')
    await expect(control).toHaveText(EN.ask.labels.card)
    await control.click()

    await expect(page.getByTestId('ask-box')).toHaveCount(0)
    await expect(page.getByTestId('study-card')).toBeVisible()
    await expect(page.getByTestId('law-text')).toHaveText(HYDRANT_LAW.law)
    expect((await readProgress(page, 'FL'))?.studyIndex).toBe(studyIndex)
  })

  // Guard 2. By id, never by concept: the intersection law shares a concept
  // with the hydrant law, which comes first in it.
  test('opens the card of the law cited, not the first card of its concept', async ({ page }) => {
    await workerWith(page, citing(['FL-400'], 'At least 20 feet from an intersection.'))
    await seed(page, { studyIndex: at('FL-400') + 6 }, PAID_FL)
    await askFromTheCards(page)
    await askOnPage(page, 'How far from an intersection can I park?')

    await openSources(page)
    await page.getByTestId('ask-card').click()
    await expect(page.getByTestId('law-text')).toHaveText(INTERSECTION_LAW.law)
  })

  // AC2, guard 3. Before the pass reaches the card, the same answer and no
  // way past the study order.
  test('gives a learner the pass has not reached the same answer and no control', async ({ page }) => {
    await workerWith(page, citing(['FL-399']))
    // A section's start, so the learner stands on a card of the pass, well
    // short of the hydrant card.
    await seed(page, { studyIndex: 380 }, PAID_FL)
    await askFromTheCards(page)
    await askOnPage(page, HYDRANT)

    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    await expect(page.getByTestId('ask-card')).toHaveCount(0)
  })

  // Behind the frontier is not the same as taught: the short course walks
  // past cards without teaching them, and the arrows step over those. So
  // does this.
  test('gives no control for a card the short course walked past', async ({ page }) => {
    await workerWith(page, citing(['FL-399']))
    const studyIndex = at('FL-399') + 6
    await seed(
      page,
      {
        studyIndex,
        course: 'short',
        taught: FL.slice(0, studyIndex).map((law) => law.id).filter((id) => id !== 'FL-399'),
      },
      PAID_FL,
    )
    // Taught cards in this section already, so it opens on a card, not its questions.
    await page.goto('/')
    await expect(page.getByTestId('study-card')).toBeVisible()
    await page.getByTestId('ask-trigger').click()
    await askOnPage(page, HYDRANT)

    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    await expect(page.getByTestId('ask-card')).toHaveCount(0)
  })

  // AC3. The vehicle code is not a card.
  test('shows no control under an answer from the vehicle code', async ({ page }) => {
    await workerWith(page, (request) => {
      const law = request.laws?.find((each) => each.id === 'MD-C-21-1108-a')
      if (law === undefined) return says('road-law', '', [])
      return says('road-law', 'No. Maryland law says you may not coast downhill in neutral.', [law.id])
    })
    await seed(page, { studyIndex: 200 }, { stateCode: 'MD', entitled: true })
    await page.goto('/#ask')
    await askOnPage(page, 'Can I coast downhill in neutral?')

    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toBeVisible()
    await expect(page.getByTestId('ask-card')).toHaveCount(0)
  })

  // AC4.
  test('shows no control under an app answer', async ({ page }) => {
    await workerWith(page, () => says('app', 'Open the menu and tap Start over; your purchase is kept.', ['your-data']))
    await seed(page, { studyIndex: 590 }, PAID_FL)
    await page.goto('/#ask')
    await askOnPage(page, 'How do I reset my progress?')

    await expect(page.getByTestId('ask-answer')).toContainText('Start over')
    await expect(page.getByTestId('ask-card')).toHaveCount(0)
    await expect(page.getByTestId('ask-sources-line')).toHaveCount(0)
  })

  // AC5. A link that pulled somebody out of a paper half sat would be the
  // worse failure.
  test('shows no control while a test is in progress', async ({ page }) => {
    await workerWith(page, citing(['FL-399']))
    const pool = data.FL.laws.filter((law) => law.inPool).slice(0, 10).map((law) => law.id)
    await seed(
      page,
      {
        studyIndex: 590,
        activeTest: { mode: 'diagnostic', questionIds: pool, current: 2, correctCount: 1, missedIds: [], newlyMastered: 0, deadline: null },
      },
      PAID_FL,
    )
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await openSources(page)
    await expect(page.getByTestId('ask-citation-page')).toHaveText(EN.question.inTheManual('p.66'))
    await expect(page.getByTestId('ask-card')).toHaveCount(0)
  })

  // AC6. Maryland, for a Spanish pack that is real: Florida has none, and a
  // learner who chose Spanish there reads the app in English.
  test('names the control in Spanish for a Spanish learner', async ({ page }) => {
    await workerWith(page, citing(['MD-164'], 'Sí: debe detenerse.'))
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('ask-cards-lang') !== null) return
      sessionStorage.setItem('ask-cards-lang', '1')
      localStorage.setItem(key, 'es')
    }, LANG_KEY)
    // The school-bus card is 164th; the frontier at the next section's start.
    await seed(page, { studyIndex: 166 }, { stateCode: 'MD', entitled: true })
    await askFromTheCards(page)
    await askOnPage(page, 'When must I stop for a school bus?')

    await openSources(page)
    await expect(page.getByTestId('ask-card')).toHaveText(STRINGS.es.ask.labels.card)
  })

  // AC7. One control per cited card, on that citation's own line.
  test('draws one control, on the line of the cited law the pass has reached', async ({ page }) => {
    await workerWith(page, citing(['FL-399', 'FL-400']))
    // On the hydrant card: it is reached, the intersection card after it is not.
    await seed(page, { studyIndex: at('FL-399') }, PAID_FL)
    await askFromTheCards(page)
    await askOnPage(page, HYDRANT)

    await openSources(page)
    const citations = page.getByTestId('ask-citation')
    await expect(citations).toHaveCount(2)
    await expect(page.getByTestId('ask-card')).toHaveCount(1)
    await expect(citations.filter({ hasText: 'fire hydrant' }).getByTestId('ask-card')).toHaveCount(1)
  })
})

/**
 * Nationwide: one question across every state's law (docs/plans/nationwide.md,
 * phase 1). The same harness -- the worker's own `answerLearner` behind the
 * page, the model faked at the edge -- with the topic files built by the
 * plugin's own function. What each test holds the worker to is read off
 * coverage.json directly rather than off those files, so a file that drifted
 * from the verdicts disagrees with the test instead of agreeing with itself.
 */
test.describe('Nationwide, compared across every state', () => {
  const COVERAGE = readCoverage(process.cwd())
  const verdictIds = (topic: string) =>
    Object.keys(COVERAGE)
      .filter((code) => COVERAGE[code][topic] !== undefined && COVERAGE[code][topic].from !== 'none')
      .map((code) => COVERAGE[code][topic].law!)
  const noneOf = (topic: string) => Object.keys(COVERAGE).filter((code) => COVERAGE[code][topic]?.from === 'none').sort()
  const choosing = (...ids: string[]): ChooseTopics => async () => ids
  const failing: ChooseTopics = async () => {
    throw new Error('Haiku timed out')
  }
  const STRICTEST = 'Which state has the strictest drunk driving laws?'
  const TOLLS = 'Which states have the most toll roads?'
  // Utah's adult limit, Alabama's, and Kentucky's from its code: the manual law
  // that is the answer, one that is the rest, and a statute.
  const UTAH = 'UT-440'
  const ALABAMA = 'AL-165'
  const KENTUCKY = 'KY-C-189A.010-1-a'
  const strictest = says(
    'road-law',
    'Utah is the strictest: a driver over 0.05 violates the law, where Alabama and Kentucky set 0.08.',
    [UTAH, ALABAMA, KENTUCKY],
  )

  /** The state each request to the worker carried, in order. */
  function postedStates(page: Page): (string | null)[] {
    const states: (string | null)[] = []
    page.on('request', (request) => {
      if (request.url() === `${API}/api/ask`) states.push((request.postDataJSON() as { state: string | null }).state)
    })
    return states
  }

  async function askNationwide(page: Page, question: string, stateCode = 'FL'): Promise<void> {
    await seed(page, {}, { stateCode })
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await askOnPage(page, question)
  }

  // The verdicts this block rests on, checked rather than assumed.
  test('rests on Utah’s 0.05 at p.52 and on exactly five states with no adult limit', () => {
    const utah = lawsOf('UT').find((law) => law.id === UTAH)
    expect(COVERAGE.UT['bac-adult'].law).toBe(UTAH)
    expect(utah?.law).toContain('0.05')
    expect(utah?.citation).toMatch(/^p\.52 /)
    expect(noneOf('bac-adult')).toEqual(['MN', 'OK', 'SC', 'WI', 'WY'])
    expect(COVERAGE.KY['bac-adult'].law).toBe(KENTUCKY)
    expect(COVERAGE.AL['bac-adult'].law).toBe(ALABAMA)
  })

  // AC1, guard 1.
  test('ticks under the title, answers across every state with no Change control, and unticked posts the learner’s state', async ({ page }) => {
    await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult'))
    const posted = postedStates(page)
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')

    const box = page.getByTestId('ask-nationwide')
    await expect(box).not.toBeChecked()
    await expect(page.getByText(EN.ask.nationwide)).toBeVisible()
    await expect(page.getByTestId('ask-state')).toContainText('Answering for Florida.')
    await askOnPage(page, HYDRANT)
    await expect.poll(() => posted).toEqual(['FL'])

    await box.check()
    await expect(page.getByTestId('ask-state')).toHaveText(EN.ask.answeringNationwide)
    await expect(page.getByTestId('ask-change-state')).toHaveCount(0)
    await askOnPage(page, STRICTEST)
    await expect.poll(() => posted).toEqual(['FL', NATIONWIDE])
  })

  // Decision 11 swapped the examples for nationwide ones while ticked. The
  // examples are gone either way (Joel, 2026-10-12); the nationwide chips are
  // the one-tap row while ticked, the state's while not.
  test('puts no typed question under the box while Nationwide is ticked either', async ({ page }) => {
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-chip')).not.toHaveCount(0)
    await expect(page.getByTestId('ask-example')).toHaveCount(0)
    await page.getByTestId('ask-nationwide').uncheck()
    await expect(page.getByTestId('ask-state-chip')).not.toHaveCount(0)
    await expect(page.getByTestId('ask-example')).toHaveCount(0)
  })

  // AC2, guard 2.
  test('gives the model every verdict law of both blood-alcohol topics, each labelled with its state’s name, and nothing else', async ({ page }) => {
    const asked = await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult', 'bac-under-21'))
    await askNationwide(page, STRICTEST)

    await expect.poll(() => asked.length).toBe(1)
    const given = asked[0].laws ?? []
    expect(new Set(given.map((law) => law.id))).toEqual(new Set([...verdictIds('bac-adult'), ...verdictIds('bac-under-21')]))
    // What the model reads: each law under the name of the state whose verdict it is.
    const prompt = withLaws(asked[0].question, asked[0].laws, asked[0].nationwide)
    for (const topic of ['bac-adult', 'bac-under-21']) {
      for (const [code, verdicts] of Object.entries(COVERAGE)) {
        if (verdicts[topic].from !== 'none') expect(prompt, `${topic} ${code}`).toContain(`[${verdicts[topic].law}] ${STATE_NAMES[code]}`)
      }
    }
    await expect(page.getByTestId('ask-answer')).toContainText('Utah is the strictest: a driver over 0.05')
  })

  // AC2, guard 3.
  test('begins each citation line with the state whose law it is, the manual’s as the manual and the code’s as that state’s law', async ({ page }) => {
    await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult', 'bac-under-21'))
    await askNationwide(page, STRICTEST)

    await openSources(page)
    const citations = page.getByTestId('ask-citation')
    await expect(citations).toHaveCount(3)
    await expect(citations.nth(0)).toHaveText(/^Utah — In the manual, p\.52: /)
    await expect(citations.nth(1)).toHaveText(/^Alabama — In the manual, p\.33: /)
    await expect(citations.nth(2)).toHaveText(/^Kentucky — Not in your manual — KRS 189A\.010\(1\)\(a\): /)
  })

  // AC3, guard 4.
  test('names under the answer exactly the states with no adult limit, from the worker’s list and not the model’s words', async ({ page }) => {
    // The model names no state as absent: the line can only be the worker's.
    await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult'))
    await askNationwide(page, STRICTEST)

    await expect(page.getByTestId('ask-absent')).toHaveText(
      EN.ask.labels.absent(noneOf('bac-adult').map((code) => STATE_NAMES[code]).join(', ')),
    )
    await expect(page.getByTestId('ask-absent')).toHaveText(
      'No rule found in the manual or code of: Minnesota, Oklahoma, South Carolina, Wisconsin, Wyoming',
    )
  })

  // AC4, guard 5.
  test('answers from the first two of three topics the chooser names, and never gives the model more than the ceiling', async ({ page }) => {
    const asked = await workerWith(
      page,
      () => strictest,
      undefined,
      undefined,
      undefined,
      choosing('bac-adult', 'bac-under-21', 'park-hydrant'),
    )
    await askNationwide(page, STRICTEST)

    await expect(page.getByTestId('ask-answer')).toContainText('Utah')
    const given = asked[0].laws ?? []
    expect(given.length).toBeLessThanOrEqual(NATIONWIDE_LAWS)
    expect(given.length).toBe(verdictIds('bac-adult').length + verdictIds('bac-under-21').length)
  })

  // AC5.
  test('says what can be compared and links the list of it when no topic matches, with no answer', async ({ page }) => {
    const asked = await workerWith(page, () => says('road-law', 'Probably 16 everywhere.', []), undefined, undefined, undefined, choosing())
    await askNationwide(page, TOLLS)

    await expect(page.getByTestId('ask-pointer')).toContainText(
      'I can compare the states on what their manuals and codes cover — fire hydrants, school buses, blood alcohol limits and more',
    )
    await expect(page.getByTestId('ask-pointer-link')).toHaveAttribute('href', '/drivers/laws/')
    await expect(page.getByTestId('ask-pointer-link')).toHaveText(EN.ask.labels.comparePage)
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
    await expect(page.getByTestId('ask-no-match')).not.toContainText('16')
    expect(asked[0].laws).toEqual([])
  })

  // AC6, guard 6.
  test('shows a count that is the number of laws given or of states without one, and refuses a count that is neither', async ({ page }) => {
    const answers = [
      says('road-law', '46 states set a limit and 5 say nothing; Utah’s is the lowest at 0.05.', [UTAH]),
      says('road-law', '39 states set a limit; Utah’s is the lowest at 0.05.', [UTAH]),
    ]
    await workerWith(page, () => answers.shift()!, undefined, undefined, undefined, choosing('bac-adult'))
    expect(verdictIds('bac-adult').length).toBe(46)
    await askNationwide(page, STRICTEST)

    await expect(page.getByTestId('ask-answer')).toContainText('46 states set a limit and 5 say nothing')
    await askOnPage(page, STRICTEST)
    await expect(page.getByTestId('ask-pointer')).toHaveText(
      'I can’t answer that from the states’ manuals and codes in a way I can check, so I won’t guess.',
    )
    await expect(page.getByText('39 states')).toHaveCount(0)
  })

  // AC7.
  test('refuses a nationwide answer citing a law that was not given', async ({ page }) => {
    // FL-001 is a real Florida law that no blood-alcohol verdict names.
    await workerWith(page, () => says('road-law', 'Utah is the strictest at 0.05.', [UTAH, 'FL-001']), undefined, undefined, undefined, choosing('bac-adult'))
    await askNationwide(page, STRICTEST)

    await expect(page.getByTestId('ask-pointer')).toContainText('in a way I can check')
    await expect(page.getByTestId('ask-answer')).toHaveCount(0)
  })

  // AC8, guard 12.
  test('chooses the topics by the question’s words when the chooser fails, and still answers', async ({ page }) => {
    const asked = await workerWith(page, () => strictest, undefined, undefined, undefined, failing)
    await askNationwide(page, 'What is the blood alcohol limit for adults in every state?')

    await expect(page.getByTestId('ask-answer')).toContainText('Utah')
    const given = new Set((asked[0].laws ?? []).map((law) => law.id))
    for (const id of verdictIds('bac-adult')) expect(given.has(id), id).toBe(true)
  })

  // AC8: nothing by words either is the refusal of AC5.
  test('says what can be compared when the chooser fails and no topic shares the question’s words', async ({ page }) => {
    const asked = await workerWith(page, () => says('road-law', '', []), undefined, undefined, undefined, failing)
    // Not the toll-road question: its "have" is a word of the open-container topic.
    await askNationwide(page, 'Which state has the best tacos?')

    await expect(page.getByTestId('ask-pointer-link')).toHaveAttribute('href', '/drivers/laws/')
    expect(asked[0].laws).toEqual([])
  })

  // Guard 13.
  test('answers a nationwide question without asking for a state file named US', async ({ page }) => {
    // The harness's `lawsFor` throws for US, as Pages would answer 404.
    await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult'))
    await askNationwide(page, STRICTEST)

    await expect(page.getByTestId('ask-answer')).toContainText('Utah')
  })

  // Decision 10: the fold after six.
  test('folds the citations after six and opens the rest from a control naming how many states it hides', async ({ page }) => {
    const cited = [UTAH, ...verdictIds('bac-adult').filter((id) => id !== UTAH)].slice(0, 8)
    await workerWith(page, () => says('road-law', 'Utah is the strictest at 0.05.', cited), undefined, undefined, undefined, choosing('bac-adult'))
    await askNationwide(page, STRICTEST)

    await openSources(page)
    await expect(page.getByTestId('ask-citation')).toHaveCount(6)
    await expect(page.getByTestId('ask-citations-more')).toHaveText(EN.ask.labels.moreStates(2))
    await page.getByTestId('ask-citations-more').click()
    await expect(page.getByTestId('ask-citation')).toHaveCount(8)
    await expect(page.getByTestId('ask-citations-more')).toHaveCount(0)
  })

  // AC11.
  test('speaks Spanish to a Spanish learner: the checkbox, the line, the absent states, the answer and the refusal', async ({ page }) => {
    const answers = [says('road-law', 'Utah es el más estricto: más de 0.05 viola la ley.', [UTAH]), says('road-law', '', [])]
    const chosen = [['bac-adult'], []]
    await workerWith(page, () => answers.shift()!, undefined, undefined, undefined, async () => chosen.shift()!)
    await page.addInitScript(() => localStorage.setItem('teach-and-test/v1/lang', 'es'))
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')

    const es = STRINGS.es
    await expect(page.getByText(es.ask.nationwide)).toBeVisible()
    await page.getByTestId('ask-nationwide').check()
    await expect(page.getByTestId('ask-state')).toHaveText(es.ask.answeringNationwide)
    await askOnPage(page, '¿Qué estado tiene las leyes más estrictas contra conducir ebrio?')
    await expect(page.getByTestId('ask-answer')).toContainText('Utah es el más estricto')
    await expect(page.getByTestId('ask-absent')).toHaveText(
      es.ask.labels.absent('Minnesota, Oklahoma, South Carolina, Wisconsin, Wyoming'),
    )

    await askOnPage(page, '¿Qué estados tienen más autopistas de peaje?')
    await expect(page.getByTestId('ask-pointer')).toContainText('Puedo comparar los estados')
    await expect(page.getByTestId('ask-pointer-link')).toHaveText(es.ask.labels.comparePage)
  })

  // AC9, guard 7: what Pages publishes for the worker to read.
  test('publishes the topic list and one file per topic holding exactly the verdict laws, each as its state’s file holds it', async ({ request }) => {
    const listed = (await (await request.get('/ask-laws/topics.json')).json()) as { id: string; question: string; title: string }[]
    expect(listed).toEqual(topicsOf(process.cwd()))
    for (const topic of listed) {
      const response = await request.get(`/ask-laws/topics/${topic.id}.json`)
      expect(response.status(), topic.id).toBe(200)
      const laws = (await response.json()) as StateLaw[]
      const states = Object.keys(COVERAGE)
        .sort()
        .filter((code) => COVERAGE[code][topic.id].from !== 'none')
      expect(laws.map((law) => law.state), `${topic.id}: the states with a verdict law`).toEqual(states)
      for (const { state, ...law } of laws) {
        expect(law.id, `${topic.id} ${state}: the verdict's own law`).toBe(COVERAGE[state][topic.id].law)
        expect(law, `${topic.id} ${state}: as the state's file holds it`).toEqual(lawsOf(state).find((each) => each.id === law.id))
      }
    }
  })

  /**
   * A family of topics (docs/plans/trusted-by-date.md, phase 1): "hardest on
   * drunk driving" is the limits and the penalties, and read two topics at a
   * time it was answered as the lowest limit alone. The chooser here is the
   * worker's own Haiku chooser over a client that answers as Haiku would, so
   * what it parses and what it is told are the deployed code's.
   */
  test.describe('a family of topics', () => {
    const HARDEST = 'Which state is hardest on drunk driving?'
    /** The first verdict law on a topic that states a dollar figure, with the figure as the law writes it. */
    const withFine = (topic: string) => {
      for (const id of verdictIds(topic)) {
        const state = id.split('-')[0]
        const found = lawsOf(state).find((law) => law.id === id)
        const fine = found === undefined ? null : /\$\d[\d,]*/.exec(found.law)
        if (fine !== null) return { id, state, fine: fine[0] }
      }
      throw new Error(`no ${topic} verdict law states a dollar figure`)
    }
    /** The Anthropic client's one call, answering `reply` as JSON and recording the system prompt it was sent. */
    function haikuAnswering(reply: { topics: string[]; family: string }) {
      const systems: string[] = []
      const client = {
        messages: {
          create: async (request: { system: string }) => {
            systems.push(request.system)
            return { content: [{ type: 'text', text: JSON.stringify(reply) }] }
          },
        },
      } as unknown as TopicsClient
      return { chooser: haikuTopicsFor(undefined, client)!, systems }
    }

    // AC4, guard 2.
    test('reads the first four drunk-driving topics the chooser names with the family, and no topic outside it', async ({ page }) => {
      const fine = withFine('dui-first-fine')
      const named = ['bac-adult', 'park-hydrant', 'dui-first-fine', 'dui-first-jail', 'dui-first-suspension', 'dui-interlock']
      const read = ['bac-adult', 'dui-first-fine', 'dui-first-jail', 'dui-first-suspension']
      const { chooser, systems } = haikuAnswering({ topics: named, family: 'dui' })
      const answer = `Utah is strictest on the limit at 0.05; ${STATE_NAMES[fine.state]} sets a fine of ${fine.fine}.`
      const asked = await workerWith(page, () => says('road-law', answer, [UTAH, fine.id]), undefined, undefined, undefined, chooser)
      await askNationwide(page, HARDEST)

      await expect(page.getByTestId('ask-answer')).toContainText(answer)
      // The chooser was told the family and which topics are in it.
      expect(systems[0]).toContain(`dui: ${TOPIC_FAMILIES.dui}`)
      expect(systems[0]).toContain('dui-first-fine [dui]: ')
      expect(asked[0].nationwide?.topics.map((topic) => topic.question)).toEqual(
        read.map((id) => topicsOf(process.cwd()).find((topic) => topic.id === id)!.question),
      )
      const given = (asked[0].laws ?? []).map((law) => law.id)
      expect(new Set(given)).toEqual(new Set(read.flatMap(verdictIds)))
      expect(given.length).toBeLessThanOrEqual(NATIONWIDE_FAMILY_LAWS)
      expect(read.length).toBe(NATIONWIDE_FAMILY_TOPICS)
      await openSources(page)
      const citations = page.getByTestId('ask-citation')
      await expect(citations).toHaveCount(2)
      await expect(citations.nth(0)).toHaveText(/^Utah — In the manual, p\.52: /)
      await expect(citations.nth(1)).toHaveText(new RegExp(`^${STATE_NAMES[fine.state]} — `))
    })

    // AC5, guard 2: two subjects keep the cap of two.
    test('reads only the first two topics when the chooser names topics of different families', async ({ page }) => {
      const asked = await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult', 'texting-fine', 'dui-first-fine'))
      await askNationwide(page, STRICTEST)

      await expect(page.getByTestId('ask-answer')).toContainText('Utah')
      const given = (asked[0].laws ?? []).map((law) => law.id)
      expect(given.length).toBe(verdictIds('bac-adult').length + verdictIds('texting-fine').length)
      expect(new Set(given)).toEqual(new Set([...verdictIds('bac-adult'), ...verdictIds('texting-fine')]))
    })

    // AC6: a new topic answers from its verdicts with no page or worker change.
    test('answers a texting-fine question from every state’s texting-fine verdict and cites the state whose fine it names', async ({ page }) => {
      const fine = withFine('texting-fine')
      const answer = `${STATE_NAMES[fine.state]} sets a fine of ${fine.fine} for texting while driving.`
      const asked = await workerWith(page, () => says('road-law', answer, [fine.id]), undefined, undefined, undefined, choosing('texting-fine'))
      await askNationwide(page, 'What is the fine for texting while driving in each state?')

      await expect(page.getByTestId('ask-answer')).toContainText(answer)
      expect(new Set((asked[0].laws ?? []).map((law) => law.id))).toEqual(new Set(verdictIds('texting-fine')))
      await openSources(page)
      await expect(page.getByTestId('ask-citation')).toHaveText([new RegExp(`^${STATE_NAMES[fine.state]} — `)])
    })
  })

  /**
   * Phase 2 (docs/plans/nationwide.md, section F): a question no topic covers,
   * answered from each state's nearest laws. The worker's own loop and store
   * reader run behind the page; what is stubbed is what they call -- the AI
   * binding, which hands each text a vector naming it, the Vectorize binding,
   * which records every namespace each vector was sent to and answers from a
   * table, and the D1 holding the `laws` table, whose rows are the published
   * laws as `laws:store` writes them. Each hit the index answers carries a
   * decoy text, so a law whose words came off the vector shows the decoy.
   */
  test.describe('from every state’s nearest laws, when no topic covers the question', () => {
    const FRONT = 'How old must a child be to ride in the front seat?'
    const SEARCH = 'child front seat age requirement'
    // Alaska's and Minnesota's manuals, and Delaware's code: two figures, 13
    // and 12, and a statute among them.
    const ALASKA = 'AK-220'
    const MINNESOTA = 'MN-323'
    const DELAWARE = 'DE-C-4803-b'
    const DELAWARE_TOO = 'DE-C-4803-b-2'
    const DECOY = 'A decoy carried on the vector, which no learner may ever read.'
    const frontSeat = says(
      'road-law',
      'Minnesota requires children under 13 to ride in the back seat if one is available, and Delaware bars a child under 12 from a front seat with a live air bag; Alaska’s manual recommends the rear seat under 13.',
      [MINNESOTA, DELAWARE, ALASKA],
    )
    type Hits = Record<string, { id: string; score: number }[]>
    const NEAREST: Hits = {
      AK: [{ id: ALASKA, score: 0.71 }],
      DE: [
        { id: DELAWARE, score: 0.74 },
        { id: DELAWARE_TOO, score: 0.66 },
      ],
      MN: [{ id: MINNESOTA, score: 0.69 }],
    }

    /** The AI and Vectorize bindings: a vector per text, and every namespace each text's vector was asked. */
    function stubIndex(hits: Hits) {
      const texts: string[] = []
      const queried = new Map<string, string[]>()
      const ai = {
        run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map((text) => [texts.push(text) - 1]) }),
      } as unknown as Ai
      const index = {
        query: async (vector: number[], options: { namespace: string }) => {
          const text = texts[vector[0]]
          queried.set(text, [...(queried.get(text) ?? []), options.namespace])
          const matches = (hits[options.namespace] ?? []).map((hit) => ({ ...hit, metadata: { law: DECOY, citation: DECOY } }))
          return { matches, count: matches.length }
        },
      } as unknown as VectorizeIndex
      return { ai, index, queried }
    }

    /**
     * The D1 behind `lawsByIdFor`: the `laws` table's rows, which are the
     * published laws and their state, in the table's own column names --
     * `as_of`, not `asOf` -- so a reader that forgot to map the date column
     * shows no date here as it would in production.
     */
    const store = {
      prepare: () => ({
        bind: (ids: string) => ({
          all: async () => ({
            results: (JSON.parse(ids) as string[]).flatMap((id) => {
              const law = lawsOf(id.slice(0, 2)).find((each) => each.id === id)
              if (law === undefined) return []
              const { asOf, kind, ...rest } = law
              return [{ state: id.slice(0, 2), kind: kind ?? null, as_of: asOf ?? null, ...rest }]
            }),
          }),
        }),
      }),
    } as unknown as D1Database

    const loopOver = (hits: Hits) => {
      const stub = stubIndex(hits)
      return { stub, loop: { ai: stub.ai, index: stub.index, db: store } }
    }
    const lawOf = (id: string) => lawsOf(id.slice(0, 2)).find((law) => law.id === id)!

    // The laws this block rests on, checked rather than assumed.
    test('rests on Minnesota’s and Alaska’s 13 in their manuals and Delaware’s 12 in its code', () => {
      expect(lawOf(MINNESOTA).law).toContain('13')
      expect(lawOf(ALASKA).law).toContain('13')
      expect(lawOf(DELAWARE).law).toContain('under 12 years of age')
      expect(lawOf(DELAWARE).kind).toBe('statute')
      expect(lawOf(DELAWARE_TOO).kind).toBe('statute')
    })

    // AC16, guard 15.
    test('asks every one of the 51 states’ namespaces, with the question and with each of the rephraser’s searches', async ({ page }) => {
      const { stub, loop } = loopOver(NEAREST)
      await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-answer')).toContainText('Minnesota requires children under 13')
      for (const text of [FRONT, SEARCH]) {
        expect([...(stub.queried.get(text) ?? [])].sort(), `the namespaces asked with “${text}”`).toEqual(Object.keys(STATE_NAMES).sort())
      }
    })

    // AC16.
    test('gives the model each state’s nearest laws under its name, shows the answer cited by state, names the rest, and records the index path', async ({ page }) => {
      const { loop } = loopOver(NEAREST)
      const asked = await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-answer')).toContainText('Delaware bars a child under 12')
      expect((asked[0].laws ?? []).map((law) => law.id)).toEqual([ALASKA, DELAWARE, DELAWARE_TOO, MINNESOTA])
      const prompt = withLaws(asked[0].question, asked[0].laws, asked[0].nationwide)
      expect(prompt).toContain(`On “${FRONT}”`)
      expect(prompt).toContain(`[${MINNESOTA}] Minnesota: `)
      expect(prompt).toContain(`[${ALASKA}] Alaska: `)
      expect(prompt).toContain(`[${DELAWARE}] Delaware (the state's law, not the manual`)

      await openSources(page)
      const citations = page.getByTestId('ask-citation')
      await expect(citations).toHaveCount(3)
      await expect(citations.nth(0)).toHaveText(/^Minnesota — In the manual, p\.38: /)
      await expect(citations.nth(1)).toHaveText(/^Delaware — Not in your manual — 21 Del\. C\. § 4803\(b\)/)
      await expect(citations.nth(2)).toHaveText(/^Alaska — In the manual, p\.28: /)
      const absent = Object.keys(STATE_NAMES)
        .filter((code) => !['AK', 'DE', 'MN'].includes(code))
        .sort()
        .map((code) => STATE_NAMES[code])
      await expect(page.getByTestId('ask-absent')).toHaveText(EN.ask.labels.absent(absent.join(', ')))
      expect(asked.outcomes[0].model).toBe('nationwide:index')
    })

    // AC17, guard 16.
    test('quotes the store’s words for every law the index found, never anything carried on the vector', async ({ page }) => {
      const { loop } = loopOver(NEAREST)
      const asked = await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect.poll(() => asked.length).toBe(1)
      for (const law of asked[0].laws ?? []) {
        const { state, ...stored } = law as StateLaw
        // Every field of the published law, its date among them: the table's
        // `as_of` (docs/plans/trusted-by-date.md, phase 3) is what lets the
        // index path's citations be dated like the topic path's.
        expect(stored, law.id).toEqual(lawOf(law.id))
        expect(state, law.id).toBe(law.id.slice(0, 2))
      }
      expect(withLaws(asked[0].question, asked[0].laws, asked[0].nationwide)).not.toContain(DECOY)
      await openSources(page)
      await expect(page.getByTestId('ask-citation')).toHaveCount(3)
      await expect(page.getByTestId('ask-citation').nth(0)).toContainText('Children under 13 must ride in the back')
      await expect(page.getByText(DECOY)).toHaveCount(0)
    })

    // The index path's citations, dated like every other (phase 3, the `as_of`
    // column folded in from #782): before it, the table had no date, so these
    // three were the only citations in the box with nothing under them.
    test('dates each citation of an answer from the states’ nearest laws by the date the store holds for it', async ({ page }) => {
      const { loop } = loopOver(NEAREST)
      await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await openSources(page)
      const citations = page.getByTestId('ask-citation')
      await expect(citations).toHaveCount(3)
      await expect(citations.nth(0).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(manualDate('MN')))
      await expect(citations.nth(1).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(lawOf(DELAWARE).asOf!))
      await expect(citations.nth(2).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(manualDate('AK')))
    })

    // Guard 18.
    test('gives the model a state’s best two laws when the index finds six there', async ({ page }) => {
      const others = lawsOf('DE')
        .filter((law) => law.id !== DELAWARE && law.id !== DELAWARE_TOO)
        .slice(0, 4)
        .map((law, index) => ({ id: law.id, score: 0.62 - index / 100 }))
      const { loop } = loopOver({ ...NEAREST, DE: [others[0], ...NEAREST.DE, ...others.slice(1)] })
      const asked = await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-answer')).toContainText('Delaware')
      const delaware = (asked[0].laws ?? []).filter((law) => (law as StateLaw).state === 'DE').map((law) => law.id)
      expect(delaware).toEqual([DELAWARE, DELAWARE_TOO])
    })

    // Guard 19.
    test('names a state whose nearest law is under the cutoff as having no rule, and gives the model none of its laws', async ({ page }) => {
      const { loop } = loopOver({ ...NEAREST, MN: [{ id: MINNESOTA, score: 0.3 }] })
      const answer = says('road-law', 'Delaware bars a child under 12 from a front seat with a live air bag; Alaska’s manual recommends the rear seat under 13.', [DELAWARE, ALASKA])
      const asked = await workerWith(page, () => answer, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-absent')).toContainText('Minnesota')
      expect((asked[0].laws ?? []).map((law) => law.id)).not.toContain(MINNESOTA)
      expect(asked[0].nationwide?.topics[0].absent).toContain('MN')
    })

    // AC18, guard 20.
    test('never asks the index a question a topic covers, and records it as answered from the topic', async ({ page }) => {
      const { stub, loop } = loopOver(NEAREST)
      const asked = await workerWith(page, () => strictest, undefined, undefined, () => [SEARCH], choosing('bac-adult'), undefined, loop)
      await askNationwide(page, STRICTEST)

      await expect(page.getByTestId('ask-answer')).toContainText('Utah is the strictest')
      expect([...stub.queried.values()].flat()).toEqual([])
      expect(asked.outcomes[0].model).toBe('nationwide:topic')
    })

    // AC18: the other half.
    test('never reads a topic file for a question no topic covers', async ({ page }) => {
      const read: string[] = []
      const { loop } = loopOver(NEAREST)
      await workerWith(page, () => frontSeat, undefined, undefined, () => [SEARCH], choosing(), (topic) => {
        read.push(topic)
        return topicFiles().get(topic)!
      }, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-answer')).toContainText('Minnesota')
      expect(read).toEqual([])
    })

    // Found by the eval (2026-10-09): statutes spell ages as ordinals.
    test('shows a figure a cited law spells as an ordinal: Wyoming’s “ninth birthday” as 9', async ({ page }) => {
      const WYOMING = 'WY-C-31-5-1303-a'
      expect(lawOf(WYOMING).law).toContain('has not reached his ninth birthday')
      const { loop } = loopOver({ WY: [{ id: WYOMING, score: 0.7 }] })
      const answer = says('road-law', 'Wyoming law keeps a child out of the front seat until the child’s 9th birthday, unless the rear seats are full.', [WYOMING])
      await workerWith(page, () => answer, undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-answer')).toContainText('until the child’s 9th birthday')
    })

    // AC19, decision 12.
    test('says no state’s manual or code has the rule, and shows nothing the model wrote, when no state has a law near the question', async ({ page }) => {
      const { loop } = loopOver({ AK: [{ id: ALASKA, score: 0.3 }] })
      const asked = await workerWith(page, () => says('road-law', 'Probably 16 in every state.', [ALASKA]), undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      const posted = postedStates(page)
      await askNationwide(page, FRONT)

      await expect(page.getByTestId('ask-pointer')).toHaveText('I couldn’t find a rule on that in any state’s manual or code, so I won’t guess.')
      await expect(page.getByTestId('ask-answer')).toHaveCount(0)
      await expect(page.getByTestId('ask-no-match')).not.toContainText('16')
      expect(asked[0].laws).toEqual([])
      expect(posted).toEqual([NATIONWIDE])
      expect(asked.outcomes[0].model).toBe('road-law:not-covered')
    })

    // Decision 12, in Spanish too.
    test('says so in Spanish to a Spanish learner', async ({ page }) => {
      const { loop } = loopOver({})
      await workerWith(page, () => says('road-law', '', []), undefined, undefined, () => [SEARCH], choosing(), undefined, loop)
      await page.addInitScript(() => localStorage.setItem('teach-and-test/v1/lang', 'es'))
      // Maryland: Spanish is offered only where a state's Spanish pack is built.
      await askNationwide(page, '¿A qué edad puede un niño viajar en el asiento delantero?', 'MD')

      await expect(page.getByTestId('ask-pointer')).toHaveText(
        'No encontré una regla sobre eso en el manual ni en el código de ningún estado, así que no voy a adivinar.',
      )
    })
  })

  // Trusted by date AC10 (docs/plans/trusted-by-date.md), on a nationwide
  // answer: each state's line carries the date of that state's own law.
  test('dates each state’s line of a nationwide answer by that state’s own law', async ({ page }) => {
    await workerWith(page, () => strictest, undefined, undefined, undefined, choosing('bac-adult', 'bac-under-21'))
    await askNationwide(page, STRICTEST)

    await openSources(page)
    const citations = page.getByTestId('ask-citation')
    await expect(citations).toHaveCount(3)
    await expect(citations.nth(0).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(manualDate('UT')))
    await expect(citations.nth(1).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(manualDate('AL')))
    const kentucky = new Set(Object.values(readSources(process.cwd(), 'KY')!.files).map((source) => source.retrieved))
    expect(kentucky.size).toBe(1)
    await expect(citations.nth(2).getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf([...kentucky][0]))
  })
})

/**
 * The date each law was true as of, through the real pipeline
 * (docs/plans/trusted-by-date.md, decisions 6 and 7): the published file's
 * `asOf`, carried by the worker's own `answerLearner` onto the citation and
 * drawn under it. What the date must be is read here off the fetch records
 * -- the manual's in src/assets/drivers-manuals/SOURCES.json, the statute's
 * in its state's SOURCES.json -- not off the file the page was served, so a file that dated
 * a law wrongly disagrees with this test instead of agreeing with itself.
 */
test.describe('the date a cited law was true as of', () => {
  // AC10: a manual law's date is its manual's fetch.
  test('dates Florida’s manual citation by the day its manual was fetched', async ({ page }) => {
    const asked = await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'FL' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await expect(page.getByTestId('ask-answer')).toContainText('15 feet')
    const cited = asked[0].laws?.find((law) => /hydrant/i.test(law.law))
    expect(cited?.kind).toBeUndefined()
    await openSources(page)
    await expect(page.getByTestId('ask-citation').getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(manualDate('FL')))
  })

  // AC10: a statute's date is the day its section was fetched.
  test('dates Maryland’s code citation by the day its section was fetched', async ({ page }) => {
    await workerWith(page, fromTheHydrantLaw)
    await seed(page, {}, { stateCode: 'MD' })
    await page.goto('/#ask')
    await askOnPage(page, HYDRANT)

    await openSources(page)
    await expect(page.getByTestId('ask-citation-law')).toHaveText(EN.ask.labels.inTheLaw('Md. Code, Transp. § 21-1003(m)'))
    const fetched = readSources(process.cwd(), 'MD')!.files['gtr-21-1003'].retrieved
    await expect(page.getByTestId('ask-citation-asof')).toHaveText(EN.ask.labels.asOf(fetched))
  })
})
