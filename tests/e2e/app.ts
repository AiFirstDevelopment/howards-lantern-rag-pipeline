import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { SYNTHETIC_PREFIX } from '../../src/data/pack'
import { practiceTestTitle, titleShape } from '../../src/method'

export interface RawAnswer {
  answer: string
  isCorrect: boolean
  /** Set on every answer of a picture question, or on none (#100, slice C). */
  sign?: string
}

export interface RawLaw {
  id: string
  category: string
  concept: string
  law: string
  /** Why the rule exists, shown under a missed question on the results screen. */
  why?: string
  question: string
  sign?: string
  diagram?: string
  answers: RawAnswer[]
  inPool: boolean
  examLikely?: boolean
  anchorRank?: number
  citations?: { source: string; location: string; supports?: string }[]
}

// Read the shipped fixture rather than importing it, so the tests know the same
// correct answers the app does without depending on a module loader.
export interface RawState {
  laws: RawLaw[]
  metadata: {
    stateName: string
    licensingAgency: string
    /**
     * `sections` and `shapeBasis` are declared because a spec now has to choose
     * which states to drive rather than driving whichever one it was written
     * for, and both are axes that change what the shared screens say. Optional
     * because most states carry neither: a paper with parts is two states of
     * nineteen, and a figure this app chose is three.
     */
    knowledgeTest: {
      questions: number
      passMark: number
      sections?: readonly unknown[]
      shapeBasis?: { questions: 'stated' | 'chosen'; passMark: string }
    }
    signImagery: { pictorialConcepts: string[] }
  }
}

/**
 * The product under test.
 *
 * Spelled out rather than imported from src/products.ts: this file runs under
 * Playwright rather than Vite, so it cannot resolve the virtual corpus module
 * the app is built from. It reads the same JSON off disk instead, which is
 * also what keeps it honest -- the fixtures are the files that ship, not the
 * app's own idea of them.
 */
export const PRODUCT = 'drivers'

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), relative), 'utf8'))
}

interface Manifest {
  products: { id: string; states: { code: string; name: string; published?: boolean }[] }[]
}

const manifest = readJson('resource/manifest.json') as Manifest
const product = manifest.products.find((entry) => entry.id === PRODUCT)
if (product === undefined) throw new Error(`manifest does not carry ${PRODUCT}`)

/** Every state of the product under test, keyed by code. */
export const data = Object.fromEntries(
  product.states.map((state) => [
    state.code,
    readJson(`resource/corpus/${PRODUCT}/${state.code}.json`) as RawState,
  ]),
) as Record<string, RawState>

/** Where this browser files progress: a product and a state, never a state alone. */
export function progressKeyFor(stateCode: string): string {
  return `teach-and-test/v1/${PRODUCT}/${stateCode}`
}

/** States shipped in the real corpus. The browser build appends this one test fixture. */
export const SHIPPED_STATES = Object.entries(data).map(([code, state]) => ({
  code,
  name: state.metadata.stateName,
}))

/**
 * The states the manifest actually offers, and the ones it conceals.
 *
 * Production currently publishes all eight, and these two sets are derived
 * rather than typed so that the day one is concealed again every spec below
 * follows without being edited (docs/plans/maryland-only.md records both
 * directions). A concealed state keeps everything except discovery: it is still
 * in `data`, still bundled, still corpus-checked by the unit suite, and still
 * opens at its own address -- which `deep-links.spec.ts` holds. What it loses
 * is the picker, so every spec that walks "every state" walks these.
 */
const OFFERED = new Set(
  product.states.filter((state) => state.published !== false).map((state) => state.code),
)
export const PUBLISHED_STATES = SHIPPED_STATES.filter(({ code }) => OFFERED.has(code))
export const CONCEALED_STATES = SHIPPED_STATES.filter(({ code }) => !OFFERED.has(code))
export const ALTERNATE_STATE = {
  code: 'TS',
  name: 'Test State',
  questions: 7,
  passMark: 5,
} as const
/**
 * The state the `app` build gives the synthetic `[es] ` pack (vite.config.ts,
 * `SPANISH_FIXTURE`). The Test State, because Maryland carries its real pack
 * and a spec asserting `[es] ` on Maryland would be asserting the fake one
 * ships. Its laws are Maryland's under another name, so `LAWS` and
 * `STUDY_LAWS` describe it exactly.
 */
export const SPANISH_FIXTURE_STATE = ALTERNATE_STATE.code
/**
 * The second synthetic state: a paper scored in two parts, the first of which
 * allows no misses. Mirrors what vite.config.ts assembles -- if these numbers
 * and that fixture drift apart, the spec that reads them fails rather than
 * quietly measuring the wrong paper.
 */
export const SECTIONED_STATE = {
  code: 'TP',
  name: 'Two-Part State',
  questions: 8,
  passMark: 7,
  signs: { id: 'signs', name: 'Road signs', questions: 3, passMark: 3 },
  general: { id: 'general', name: 'General knowledge', questions: 5, passMark: 4 },
} as const
/**
 * The third synthetic state: a paper scored on its total, with a floor under
 * one part and none under the other.
 *
 * `SECTIONED_STATE` cannot stand in for it. There, every part carries a bar and
 * the total is their sum, so a run that clears every part has cleared the total
 * by arithmetic. Here the total is its own condition, and the general part --
 * floor zero -- is a part the state sets no minimum on at all.
 */
export const TOTAL_SCORED_STATE = {
  code: 'TW',
  name: 'Whole-Paper State',
  questions: 8,
  passMark: 6,
  signs: { id: 'signs', name: 'Road signs', questions: 3, passMark: 2 },
  general: { id: 'general', name: 'General knowledge', questions: 5, passMark: 0 },
} as const
/**
 * The fourth synthetic state: a paper scored in parts whose parts are not on
 * one footing. The signs part is the state's own figures; the general part is
 * a length this app chose at the state's rate. North Carolina's shape, and
 * the one whose disclosure has to name a part rather than the paper.
 */
export const MIXED_STATE = {
  code: 'TM',
  name: 'Mixed-Part State',
  questions: 8,
  passMark: 7,
  signs: { id: 'signs', name: 'Road signs', questions: 3, passMark: 3 },
  general: { id: 'general', name: 'General knowledge', questions: 5, passMark: 4 },
  /** The placeholder citations vite.config.ts gives the paper and its signs part. */
  source: 'Rule 1',
  signsSource: 'Rule 2',
} as const
/**
 * Every state name this build's picker offers, in the order it offers them.
 *
 * Sorted, because the picker sorts: it renders alphabetically rather than in
 * manifest order, so a list assembled in manifest order and compared with
 * `toHaveText` would fail on the ordering alone. The sort is applied here, once,
 * rather than at each call site -- this constant exists to say what the picker
 * shows, and the order is part of that.
 */
export const ASSEMBLED_STATE_NAMES = [
  ...PUBLISHED_STATES.map(({ name }) => name),
  ALTERNATE_STATE.name,
  SECTIONED_STATE.name,
  TOTAL_SCORED_STATE.name,
  MIXED_STATE.name,
].sort((a, b) => a.localeCompare(b, 'en'))

/**
 * Every code the picker can be asked for, against the name it shows for it.
 *
 * The picker stopped taking codes when it stopped being a `<select>`: a visitor
 * types a name now, so the helper that drives it has to know the name. Built
 * from the corpus and the synthetic fixtures rather than typed, so a state
 * added to either is drivable without editing this.
 */
export const STATE_NAMES = new Map<string, string>([
  ...SHIPPED_STATES.map(({ code, name }) => [code, name] as const),
  [ALTERNATE_STATE.code, ALTERNATE_STATE.name],
  [SECTIONED_STATE.code, SECTIONED_STATE.name],
  [TOTAL_SCORED_STATE.code, TOTAL_SCORED_STATE.name],
  [MIXED_STATE.code, MIXED_STATE.name],
])

/**
 * Mirror the production study ordering for any state in the shipped corpus.
 *
 * Must stay in step with `createStateCatalog` in src/data/laws.ts: the pass
 * teaches every pooled law, grouped by first appearance of its concept, and
 * corpus order within a group. A stable sort, because Maryland leaves and
 * rejoins four of its concepts and the grouping is the whole point.
 */
/**
 * The authoring shorthand a citation carries between its page number and its
 * quotation: `(printed)` in six states, `(compiled)` in Ohio, whose page
 * numbers belong to a compilation rather than to anything the state printed,
 * and `(physical)` in Washington, whose guide prints no page number at all so
 * the only page a citation can name is the PDF's own.
 *
 * Derived from every shipped corpus rather than listed, because listing it is
 * how the guard went wrong before: the assertion held the one literal Maryland
 * happened to use, so Ohio's new word would have rendered onto a card with
 * nothing going red. Washington, the sixth state, did invent a third word,
 * which this picked up the day its corpus landed without an edit here; New
 * Jersey, the seventh, and New York, the eighth, both reuse `(printed)` and
 * needed none either.
 */
export const CITATION_SHORTHAND: string[] = [
  ...new Set(
    Object.values(data).flatMap((state) =>
      state.laws.flatMap((law) =>
        (law.citations ?? [])
          .filter((citation) => citation.source.startsWith('manual:'))
          .flatMap((citation) => {
            const between = /^\s*p{1,2}\.[^']*?(\([a-z]+\))/i.exec(citation.location)
            return between === null ? [] : [between[1]]
          }),
      ),
    ),
  ),
]

export function studyLawsFor(stateCode: string): RawLaw[] {
  const state = data[stateCode]
  if (state === undefined) throw new Error(`unknown shipped state ${stateCode}`)
  const conceptOrder = new Map<string, number>()
  for (const law of state.laws) {
    if (!conceptOrder.has(law.concept)) conceptOrder.set(law.concept, conceptOrder.size)
  }
  return state.laws
    .filter((law) => law.inPool)
    .map((law, index) => ({ law, index }))
    .sort(
      (a, b) =>
        (conceptOrder.get(a.law.concept) ?? 0) - (conceptOrder.get(b.law.concept) ?? 0) ||
        a.index - b.index,
    )
    .map(({ law }) => law)
}

/**
 * Whether a law belongs to the sectioned fixture's first part. Derived from
 * the same pictorial concepts vite.config.ts partitions on, so the test knows
 * which part a question came from without a list to keep in step.
 */
export function inSignSection(law: RawLaw): boolean {
  return PICTORIAL_CONCEPTS.has(law.concept)
}

export const FIXTURE_STATE = 'MD'
export const FIXTURE_NAME = data[FIXTURE_STATE].metadata.stateName
/** The `<title>` the fixture state's page is served with, built as the prerender builds it. */
export const FIXTURE_TITLE = practiceTestTitle(FIXTURE_NAME, titleShape(data[FIXTURE_STATE].metadata))
const PICTORIAL_CONCEPTS = new Set(
  data[FIXTURE_STATE].metadata.signImagery.pictorialConcepts,
)
export const LAWS: RawLaw[] = data[FIXTURE_STATE].laws
export const LAWS_BY_ID = new Map(LAWS.map((law) => [law.id, law]))

// Mirror src/data/laws.ts: the pass walks every pooled law, grouped by concept,
// and a test draws from the same set.
export const STUDY_LAWS: RawLaw[] = studyLawsFor(FIXTURE_STATE)

/** Reinforcement anchors: the second anchor on a high-yield concept, taught like the rest. */
export const RANK2_LAWS: RawLaw[] = LAWS.filter((law) => law.anchorRank === 2)
export const POOL_LAWS: RawLaw[] = LAWS.filter((law) => law.inPool)
export const POOL_IDS = new Set(POOL_LAWS.map((law) => law.id))

/**
 * Where the pass pauses, mirroring `sectionBoundaries` in src/data/laws.ts: a
 * section ends when the concept changes or after six laws of one concept.
 * Derived rather than listed so a corpus edit moves the tests with it.
 */
export const SECTION_MAX = 6
export function sectionBoundariesFor(laws: readonly RawLaw[]): number[] {
  const boundaries: number[] = []
  let runConcept: string | null = null
  let runLength = 0
  laws.forEach((law, index) => {
    const sameRun = law.concept === runConcept && runLength < SECTION_MAX
    if (!sameRun && index > 0) boundaries.push(index)
    runLength = sameRun ? runLength + 1 : 1
    runConcept = law.concept
  })
  return boundaries
}
export const SECTION_BOUNDARIES = sectionBoundariesFor(STUDY_LAWS)

/**
 * The cards the short course teaches, as indices into the pass: the anchors,
 * both ranks (docs/plans/short-course.md).
 *
 * Derived from the corpus rather than listed, like the boundaries above, so an
 * anchor added or moved in Maryland moves every expectation here with it.
 */
export const ANCHORS: number[] = STUDY_LAWS.map((law, index) =>
  law.examLikely === true ? index : -1,
).filter((index) => index >= 0)

/**
 * Where the short course pauses, mirroring `passBoundaries` in src/flow.ts:
 * every SECTION_MAX-th anchor's index, six anchors to a section.
 *
 * Not the full course's boundaries, and that is the point of it: those fall
 * between almost every pair of anchors, so a short course reading them would
 * pause after every card.
 */
export const SHORT_BOUNDARIES: number[] = ANCHORS.filter(
  (_, which) => which > 0 && which % SECTION_MAX === 0,
)

/**
 * What the study bar reads on the card at `index`, and how full it is.
 *
 * The bar measures the current section rather than the whole pass, so an
 * assertion cannot be written as a constant: "1 of 185" was the same on every
 * card, "1 of 4" depends on which section the card is in. Derived here from the
 * same boundaries production uses, so a corpus edit moves every assertion at
 * once rather than leaving forty-nine of them to be found by hand.
 */
export function sectionAtIndex(index: number): {
  index: number
  total: number
  start: number
  length: number
  position: number
} {
  const starts = [0, ...SECTION_BOUNDARIES]
  let which = 0
  while (which + 1 < starts.length && starts[which + 1] <= index) which += 1
  const start = starts[which]
  const end = which + 1 < starts.length ? starts[which + 1] : STUDY_LAWS.length
  return { index: which + 1, total: starts.length, start, length: end - start, position: index - start }
}

/** The counter text on the card at `index`, e.g. "2 of 4". */
export function counterAt(index: number): string {
  const section = sectionAtIndex(index)
  return `${section.position + 1} of ${section.length}`
}

/** The same, for a state other than the fixture one. */
export function counterAtFor(stateCode: string, index: number): string {
  const laws = studyLawsFor(stateCode)
  const starts = [0, ...sectionBoundariesFor(laws)]
  let which = 0
  while (which + 1 < starts.length && starts[which + 1] <= index) which += 1
  const start = starts[which]
  const end = which + 1 < starts.length ? starts[which + 1] : laws.length
  return `${index - start + 1} of ${end - start}`
}

/** How full the bar is on the card at `index`. */
export function barValueAt(index: number): number {
  return sectionAtIndex(index).position
}

/** Length of a study pass — the number the study screens count against. */
export const TOTAL = STUDY_LAWS.length
export const CONCEPTS = new Set(STUDY_LAWS.map((law) => law.concept)).size

/** The fixture state's declared exam shape; never mirrored as test constants. */
export const EXAM_QUESTIONS = data[FIXTURE_STATE].metadata.knowledgeTest.questions
export const EXAM_PASS_MARK = data[FIXTURE_STATE].metadata.knowledgeTest.passMark
export const READY_STREAK = 3

export const PROGRESS_KEY = progressKeyFor(FIXTURE_STATE)
/** The clock preference, spelled out here as the app spells it in src/storage.ts. */
export const TIMED_TESTS_KEY = 'teach-and-test/v1/timed-tests'
export const SELECTED_KEY = `teach-and-test/v1/${PRODUCT}/selected-state`
export const ENTITLED_KEY = 'teach-and-test/v1/entitled'
export const DEVICE_KEY = 'teach-and-test/v1/device-id'

/**
 * One of the names this app is actually published under.
 *
 * Every suite here drives `localhost`, where `siteLabel` deliberately returns
 * null -- so until this existed, no test had ever seen the header the way a
 * visitor sees it. That is not a cosmetic gap: on localhost the overlays have
 * no header row at all, and the 64px one costs is what put the feedback form's
 * Send button off the bottom of a 375x700 phone with every layout assertion in
 * the suite still green.
 */
export const PUBLISHED_ORIGIN = 'http://howardslantern.com'

/**
 * Serve the local build under the published name, so a layout test measures
 * the chrome production actually renders.
 *
 * The request is fulfilled from the same server every other test uses, so this
 * changes exactly one thing -- what `window.location.hostname` says -- and
 * nothing about the bundle under test.
 */
export async function asPublishedSite(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.route(`${PUBLISHED_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: baseURL + url.pathname + url.search })
    await route.fulfill({ response })
  })
  await stubGoogleTag(context)
}

export const GOOGLE_TAG = 'https://www.googletagmanager.com/gtag/js*'

/**
 * Answer Google instead of Google.
 *
 * The published name is the one hostname `src/ads.ts` loads its tag on, so
 * every spec that serves the build under it makes a real request to Google's
 * domain unless something stands in the way -- and unlike the analytics origin
 * and the paywall origin, this one cannot be pointed at a host that does not
 * resolve: gtag.js comes from `googletagmanager.com` or from nowhere.
 *
 * An empty 200 rather than an abort, because a blocked script and a loaded one
 * are different pages: `page.on('request')` sees both, but only the first also
 * produces a console error that another spec might one day assert on.
 */
export async function stubGoogleTag(context: BrowserContext): Promise<void> {
  await context.route(GOOGLE_TAG, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  )
}

export function correctAnswer(law: RawLaw): string {
  const found = law.answers.find((a) => a.isCorrect)
  if (found === undefined) throw new Error(`no correct answer for ${law.id}`)
  return found.answer
}

export function wrongAnswer(law: RawLaw): string {
  const found = law.answers.find((a) => !a.isCorrect)
  if (found === undefined) throw new Error(`no wrong answer for ${law.id}`)
  return found.answer
}

export interface StoredTestResult {
  date: string
  mode: 'full' | 'missed' | 'diagnostic'
  score: number
  total: number
  missedIds: string[]
  exam?: { questions: number; passMark: number }
  /** Present only for a state whose paper is scored in parts. */
  sectionScores?: Record<string, { score: number; total: number }>
  /** Whether the run had a clock on it; absent on runs stored before it existed. */
  timed?: boolean
  /**
   * Laws covered when the run was sat, written on diagnostics from 2026-09-21.
   * Absent is unknown rather than nought -- see `TestResult` in src/storage.ts.
   */
  covered?: number
}

/**
 * A run still open, as the app writes it between questions.
 *
 * Declared here so a spec can arrange "somebody is twenty questions into the
 * paper" without a cast -- the case that proves the picker's new primary
 * resumes a run rather than drawing over it.
 */
export interface StoredActiveTest {
  mode: 'full' | 'missed' | 'diagnostic'
  questionIds: string[]
  current: number
  correctCount: number
  missedIds: string[]
  newlyMastered: number
  deadline: number | null
}

export interface StoredProgress {
  studyIndex: number
  coveredOnce: boolean
  tests: StoredTestResult[]
  activeTest?: StoredActiveTest | null
  /** Both shapes the app accepts: the bare count it used to write, and the
   *  count-plus-timestamp it writes now. Only the second can still be mastered,
   *  since a bare count reads as answered long ago and so as lapsed. */
  mastery?: Record<string, number | { n: number; at: string }>
  /**
   * Laws tested out of: answered right before their card, so the pass walks
   * past them (#383).
   *
   * Declared so a spec can arrange the record the section map leaves behind --
   * a section tested out of *ahead* of the frontier, which is the one shape
   * where the cards met and the boundary a pause fires on come apart.
   */
  skipped?: string[]
  /**
   * The cards the pass has actually shown, by law id.
   *
   * Declared so a spec can arrange the one record the frontier cannot describe:
   * a learner whose pass has moved past cards it never taught them. Absent is
   * a record written before the field existed, which the app seeds from the
   * frontier on load.
   */
  taught?: string[]
  /**
   * Which way through the pass this record is on. Absent is the full course,
   * which is every record written before the short one existed.
   */
  course?: 'full' | 'short'
}

interface SeedOptions {
  /** Raw JSON to store instead of a well-formed record (malformed-store cases). */
  raw?: string
  /** Whether the store already remembers that the fixture state was chosen. */
  stateChosen?: boolean
  /**
   * Whether this browser has paid. The free tier stops after one full test, so
   * any scenario that starts from a completed run and takes another test has to
   * say which side of the paywall it is on.
   */
  entitled?: boolean
  /** State whose independent progress record is being arranged. */
  stateCode?: string
  /**
   * Whether the clock is already armed.
   *
   * Needed by every scenario that plays a run and expects a *level* to move.
   * Levels count timed runs only where the paper has a clock to lend, and
   * Maryland's does -- so a run played with this off earns nothing, which is
   * the behavior rather than a broken test. Seeded results are unaffected:
   * a stored result with no `timed` field is grandfathered and still counts.
   */
  timed?: boolean
}

let seedCount = 0

/**
 * Put the app's own persistence in a known state before its scripts run.
 * This is the format the app itself writes — no test-only hook was added to
 * production code.
 *
 * Each call applies exactly once, on the next navigation. A later reload must
 * see whatever the app has written since, or a reload test would be measuring
 * the seed instead of the app.
 */
export async function seed(
  page: Page,
  progress: Partial<StoredProgress> = {},
  options: SeedOptions = {},
): Promise<void> {
  const stateCode = options.stateCode ?? FIXTURE_STATE
  const value =
    options.raw ??
    JSON.stringify({
      studyIndex: 0,
      coveredOnce: false,
      tests: [],
      mastery: {},
      ...progress,
    })
  await page.addInitScript(
    (args: {
      marker: string
      progressKey: string
      selectedKey: string
      stateCode: string
      value: string
      chosen: boolean
      entitled: boolean
      entitledKey: string
      timed: boolean
      timedKey: string
    }) => {
      if (sessionStorage.getItem(args.marker) !== null) return
      sessionStorage.setItem(args.marker, 'applied')
      localStorage.setItem(args.progressKey, args.value)
      if (args.chosen) localStorage.setItem(args.selectedKey, args.stateCode)
      if (args.entitled) localStorage.setItem(args.entitledKey, 'yes')
      if (args.timed) localStorage.setItem(args.timedKey, '1')
    },
    {
      marker: `seed-${(seedCount += 1)}`,
      progressKey: progressKeyFor(stateCode),
      selectedKey: SELECTED_KEY,
      entitledKey: ENTITLED_KEY,
      stateCode,
      value,
      chosen: options.stateChosen ?? true,
      entitled: options.entitled ?? false,
      timed: options.timed ?? false,
      timedKey: TIMED_TESTS_KEY,
    },
  )
}

export async function readProgress(
  page: Page,
  stateCode: string = FIXTURE_STATE,
): Promise<StoredProgress | null> {
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    progressKeyFor(stateCode),
  )
  return stored === null ? null : (JSON.parse(stored) as StoredProgress)
}

/** The question heading currently shown (the quiz and test screens use an h2). */
export function questionHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 2 })
}

/** The arrows that step back and forth over material already covered. */
export function stepBack(page: Page): Locator {
  return page.getByTestId('step-previous')
}

export function stepForward(page: Page): Locator {
  return page.getByTestId('step-next')
}

export function progressCounter(page: Page): Locator {
  return page.getByTestId('progress-counter')
}

/** The accessible, corpus-driven state picker shown on a first visit. */
export function stateSelector(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Choose your state' })
}

/**
 * Put a state into the picker the way a visitor does.
 *
 * Replaces `selectOption`, which the picker stopped answering when it stopped
 * being a native `<select>`. It types rather than clicking a row on purpose:
 * typing is the path the search box exists for, and the click path is exercised
 * by the specs that are about the picker itself. The option is matched by its
 * exact accessible name so that "Virginia" cannot land on West Virginia -- the
 * substring filter offers both, and a `.first()` here would silently open the
 * wrong state for every spec downstream.
 */
export async function pickState(page: Page, stateCode: string): Promise<void> {
  const name = STATE_NAMES.get(stateCode)
  expect(name, `no assembled state is called ${stateCode}`).toBeDefined()
  await stateSelector(page).click()
  await stateSelector(page).fill(name!)
  await page.getByRole('option', { name: name!, exact: true }).click()
  await expect(stateSelector(page)).toHaveValue(name!)
}

/**
 * The picker's two doors, by their accessible names.
 *
 * The primary is the ten-question test, because that is what somebody who
 * searched for a practice test asked for; studying is the secondary underneath
 * it. `Start` used to be the one control here and every helper named it, so
 * these are spelled once and the helpers below take one of them.
 */
export const START_STUDYING = 'or start studying'
export const TAKE_DIAGNOSTIC = 'Take a 10-question test'
/**
 * The same ten questions, as the study card offers them, by their accessible
 * name. Under a section's card "a 10-question test" was read as the section's
 * test-out, which it is not: it skips no card, and the second line says whose
 * test the questions come from.
 */
export const STUDY_DIAGNOSTIC = `Try 10 sample questions from the whole ${FIXTURE_NAME} test`

/**
 * Leave a section's questions for its cards.
 *
 * Every section of the pass opens on its questions now (docs/plans/ask-first.md),
 * so a spec whose subject is the study CARD has to say, once, that it is not
 * here to answer them -- the same one tap a learner has. Deliberately not
 * tolerant of the screen being absent: a helper that clicked the exit only if
 * it happened to be there would go on passing on the day the pass stopped
 * opening a section on its questions at all, which is the thing
 * tests/e2e/prescreen.spec.ts exists to hold.
 */
export async function skipToCards(page: Page): Promise<void> {
  await page.getByTestId('prescreen-leave').click()
}

/**
 * Stand on the study card at `index`, having seeded the frontier there.
 *
 * Only some indices need the tap: a section opens on its questions, so a seed
 * that lands the frontier on a section's FIRST card opens those, and one that
 * lands it partway through a section opens the card directly. Which is which
 * is a fact about the corpus rather than about the page, so it is read off the
 * same boundaries production derives -- a helper that probed the screen and
 * pressed the exit "if it was there" would go on passing on the day a section
 * stopped opening on its questions at all.
 */
export async function onStudyCard(
  page: Page,
  index: number,
  stateCode: string = FIXTURE_STATE,
): Promise<void> {
  const starts = [0, ...sectionBoundariesFor(studyLawsFor(stateCode))]
  if (starts.includes(index)) await skipToCards(page)
}

/** Choose any assembled state through the same control a visitor uses. */
export async function chooseState(
  page: Page,
  stateCode: string = FIXTURE_STATE,
): Promise<void> {
  await pickState(page, stateCode)
  await page.getByRole('button', { name: START_STUDYING, exact: true }).click()
}

/** The same, through the primary: straight into the ten-question test. */
export async function chooseStateForDiagnostic(
  page: Page,
  stateCode: string = FIXTURE_STATE,
): Promise<void> {
  await pickState(page, stateCode)
  await page.getByRole('button', { name: TAKE_DIAGNOSTIC, exact: true }).click()
}

const CONCEALED = new Set(CONCEALED_STATES.map(({ code }) => code))

/**
 * Open a state the way a learner can actually reach it.
 *
 * The picker offers what the manifest publishes; a concealed state is reached
 * only by its own link -- which still works, and is the whole difference
 * between concealing one and removing it. Specs that walk "every state this
 * app carries" go through here so they keep walking all of them: the header
 * still has to fit West Virginia's name, and every state still has to speak,
 * whether or not it is currently on offer.
 *
 * The landing page is a first-visit screen, so a browser that has already
 * chosen a state resumes straight into studying and there is nothing to press.
 * Both paths end on the same screen, which is what the callers assert against.
 *
 * It presses `landing-study`, not `landing-start`: the primary control on
 * that page is the ten-question test now, and every caller here is asking to
 * be put on a study card.
 */
export async function openState(page: Page, stateCode: string): Promise<void> {
  if (!CONCEALED.has(stateCode)) return chooseState(page, stateCode)
  await page.goto(`/${PRODUCT}/${stateCode}`)
  // Wait for the screen to resolve before deciding which one it is.
  //
  // This used to probe `landing-start` with `isVisible()` and click it if it
  // said yes. `isVisible()` does not wait, and a concealed state is precisely
  // the case with no prerendered page to answer instantly: the request falls
  // through to the SPA shell and React has to boot. So the probe ran against an
  // empty document, returned false, and the `.catch(() => false)` swallowed it
  // -- the helper returned having done nothing and every caller went on to
  // assert the study screen against a landing page.
  //
  // It never showed up because `CONCEALED_STATES` has been empty since the
  // fourth state shipped, so this branch had not run in CI for months. It broke
  // the day it was wanted, which is the failure mode the concealment machinery
  // exists to avoid and the reason published-states.spec.ts asserts the two
  // lists by name.
  const start = page.getByTestId('landing-study')
  const studying = progressCounter(page)
  await expect(start.or(studying)).toBeVisible()
  if (await start.isVisible()) await start.click()
}

/**
 * Where each menu row lives now that the menu has drawers.
 *
 * The rows kept their ids when they were grouped, so a spec still names the
 * thing it wants rather than the path to it -- and when a row moves between
 * drawers, this table moves with it and no spec changes at all.
 */
const MENU_GROUP: Record<string, string> = {
  'menu-exam': 'menu-group-exam',
  'menu-numbers': 'menu-group-exam',
  'menu-timed': 'menu-group-settings',
  'menu-course': 'menu-group-settings',
  'menu-motion': 'menu-group-settings',
  'menu-feedback': 'menu-group-contact',
  'menu-refund': 'menu-group-contact',
  'menu-contact': 'menu-group-contact',
  'menu-faq': 'menu-group-about',
  'menu-about': 'menu-group-about',
  'menu-partner': 'menu-group-about',
  'menu-privacy': 'menu-group-about',
  'menu-terms': 'menu-group-about',
}

/**
 * Walk to the drawer holding `testId`, without pressing it.
 *
 * Tolerant of wherever the menu already is -- closed, open at the root, or open
 * in the wrong drawer -- because several specs open it themselves before
 * asserting, and a helper that always pressed the trigger would press a button
 * that is hidden while an overlay is up and hang there for thirty seconds.
 */
export async function reachMenuItem(page: Page, testId: string): Promise<void> {
  const visible = (id: string) =>
    page
      .getByTestId(id)
      .isVisible()
      .catch(() => false)
  if (await visible('menu-back')) await page.getByTestId('menu-back').click()
  else if (!(await visible('menu-close'))) await page.getByTestId('menu-trigger').click()
  const group = MENU_GROUP[testId]
  if (group !== undefined) await page.getByTestId(group).click()
}

/** Leave the menu from wherever it is, drawer or root. */
export async function closeMenu(page: Page): Promise<void> {
  const back = page.getByTestId('menu-back')
  if (await back.isVisible().catch(() => false)) await back.click()
  await page.getByTestId('menu-close').click()
}

/** Open the menu and press `testId`, wherever it lives. */
export async function openMenuItem(page: Page, testId: string): Promise<void> {
  await reachMenuItem(page, testId)
  await page.getByTestId(testId).click()
}

export async function progressValue(page: Page): Promise<number> {
  const now = await page.getByRole('progressbar').getAttribute('aria-valuenow')
  return Number(now)
}

/**
 * Answer the question on screen for `law` and press through the feedback.
 * `continueName` is the label on the feedback button.
 */
export async function answerQuestion(
  page: Page,
  law: RawLaw,
  correct: boolean,
  continueName: RegExp,
): Promise<void> {
  const choice = correct ? correctAnswer(law) : wrongAnswer(law)
  // A picture answer has no text on its button -- the corpus `answer` is the
  // FAQ's and the suite's name for it, never the learner's -- so it is found by
  // the artwork it draws. Deliberately NOT by accessible name: that is "Sign 1"
  // and the same on every question, and finding it by name would prove nothing.
  const picked = law.answers.find((answer) => answer.answer === choice)
  if (picked?.sign !== undefined) {
    await page.locator(`button:has([data-sign="${picked.sign}"])`).click()
  } else {
    await page.getByRole('button', { name: choice, exact: true }).click()
  }
  await page.getByRole('button', { name: continueName }).click()
}

/** Pass the study quiz for the anchor at `index` (zero-based). */
/**
 * Answer one study card correctly and arrive at the next one.
 *
 * Dismisses the section pause when the card just answered ended a section,
 * because that is what a learner does: the checkpoint is a screen with one
 * button on it. Handled here rather than in each caller so that a test walking
 * the pass does not have to know where the corpus puts its section boundaries
 * -- which it should not, and which changes whenever a law is added.
 */
export async function passStudyQuiz(page: Page, index: number): Promise<void> {
  await page.getByRole('button', { name: 'Quiz me' }).click()
  await answerQuestion(page, STUDY_LAWS[index], true, /^next law$/i)
  const keepGoing = page.getByRole('button', { name: 'Keep going' })
  if (!(await keepGoing.isVisible().catch(() => false))) return
  await keepGoing.click()
  /**
   * And past the questions the next section opens on, for the same reason the
   * pause is dismissed here: a spec walking the pass should not have to know
   * where the corpus cuts its sections.
   *
   * Tolerant of them not being there -- the last section of a pass leads to
   * the finish line rather than to another one -- which is safe only because
   * this is not where that screen is guarded: tests/e2e/prescreen.spec.ts
   * asserts that "Keep going" lands on the next section's questions, so a
   * pass that stopped opening them would go red there rather than quietly
   * here.
   */
  const leave = page.getByTestId('prescreen-leave')
  const card = page.getByTestId('law-text')
  const done = page.getByTestId('pass-complete-heading')
  await expect(leave.or(card).or(done)).toBeVisible()
  if (await leave.isVisible()) await leave.click()
}

/**
 * The law on screen right now.
 *
 * Question text alone is no longer unique: several sign questions read "What
 * does this sign mean?" and are told apart by the picture, exactly as they are
 * on the real paper. So the sign is part of the identity here too.
 */
export async function currentLaw(page: Page, stateCode: string = FIXTURE_STATE): Promise<RawLaw> {
  const question = await questionHeading(page).innerText()
  // The sign that is the SUBJECT of the question sits above it, outside any
  // button. A picture question (#100, slice C) draws four signs too, but as
  // its answers, inside buttons -- and reading `first()` over every road-sign
  // on the page took the first answer for the subject and reported "no law
  // asks" for every Maryland picture question drawn into a test.
  const signs = page.locator('[data-testid="road-sign"]:not(button *)')
  const sign = (await signs.count()) > 0 ? await signs.first().getAttribute('data-sign') : null
  // Defaulted rather than required: `data` is built from `resource/manifest.json`
  // alone, so `TS`, `2P` and `WS` are not keys of it at all -- they exist only in
  // the module `vite.config.ts` generates, and what leaves those callers reading
  // the fixture state's laws is the DEFAULT, not the lookup. A spec driving a
  // real published state's own paper names it instead; without the parameter
  // such a spec throws `no law asks` on its first question, which reads as a
  // broken app rather than as a lookup pointed at the wrong corpus.
  //
  // Guarded the way `studyLawsFor` guards, so that naming a synthetic state
  // here -- or mistyping a real one as `Fl` -- reports which code was not found
  // instead of a bare TypeError from inside a shared helper.
  const state = data[stateCode]
  if (state === undefined) throw new Error(`unknown shipped state ${stateCode}`)
  const laws = state.laws
  const found = laws.find(
    (law) => law.question === question && (law.sign ?? null) === sign,
  )
  if (found === undefined) {
    throw new Error(`no ${stateCode} law asks: ${question}${sign === null ? '' : ` [sign: ${sign}]`}`)
  }
  return found
}

/**
 * Work through a whole test, answering the first `missCount` questions wrongly.
 * Returns the ids asked, in the order they were asked.
 */
export async function runTest(
  page: Page,
  missCount = 0,
  /**
   * Which questions to get wrong, when *which* matters rather than how many.
   * A paper scored in parts can be failed on one part while the total clears
   * the bar, and that run cannot be arranged by a count.
   */
  shouldMiss?: (law: RawLaw) => boolean,
  /** Which corpus the questions are drawn from; see `currentLaw`. */
  stateCode: string = FIXTURE_STATE,
): Promise<string[]> {
  const asked: string[] = []
  for (;;) {
    const counter = await progressCounter(page).innerText()
    const [, totalText] = counter.split(' of ')
    const total = Number(totalText)
    const law = await currentLaw(page, stateCode)
    asked.push(law.id)
    const correct = shouldMiss === undefined ? asked.length > missCount : !shouldMiss(law)
    await answerQuestion(page, law, correct, /^continue$/i)
    if (asked.length >= total) return asked
  }
}

/**
 * Assert the page rendered something and does not scroll sideways at 375px.
 *
 * The wait is not decoration. Booting used to be synchronous -- every state's
 * laws were in the bundle, so the app rendered in the same tick the script ran
 * -- and a one-shot evaluate was safe. Since #247 a state's laws are their own
 * chunk and src/main.tsx fetches the one the URL or storage names before it
 * renders, so a `goto` can arrive here with `#root` still empty for a moment.
 *
 * It waits for a render rather than asserting one immediately, and then asserts
 * exactly what it always did. A page that genuinely renders nothing still fails,
 * with the same message: the wait expires and the assertion below reports it.
 * What the wait buys is that the layout assertions afterwards measure the screen
 * this test named instead of an empty document.
 */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  await page
    // Children that are not the prerendered page: `/` now ships its footer in
    // #root before any JavaScript runs, so a bare child count passed on a page
    // React had not drawn at all.
    .waitForFunction(
      () =>
        Array.from(document.getElementById('root')?.children ?? []).some(
          (child) => !child.hasAttribute('data-prerender'),
        ),
      null,
      { timeout: 5000 },
    )
    // Swallowed on purpose: a timeout here means nothing rendered, which is the
    // assertion below, reported with its label rather than as a raw timeout.
    .catch(() => {})
  const layout = await page.evaluate(() => {
    const doc = document.documentElement
    let widest = 0
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const box = el.getBoundingClientRect()
      if (box.width > 0) widest = Math.max(widest, box.right)
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widestRight: Math.ceil(widest),
      rendered: Array.from(document.getElementById('root')?.children ?? []).some(
        (child) => !child.hasAttribute('data-prerender'),
      ),
    }
  })
  expect(layout.rendered, `${label}: nothing rendered`).toBe(true)
  expect(layout.scrollWidth, `${label}: document scrolls horizontally`).toBeLessThanOrEqual(
    layout.clientWidth,
  )
  expect(
    layout.widestRight,
    `${label}: an element spills past the viewport`,
  ).toBeLessThanOrEqual(layout.clientWidth)
}

/**
 * Every button on the screen except the shell's own chrome.
 *
 * The menu trigger is chrome: it is drawn on every screen by the shell, it
 * leads out of the flow rather than through it, and closing what it opens comes
 * back to the same question (tests/e2e/menu.spec.ts holds that). The step
 * arrows in the top bar are chrome for the same reason -- they walk back over
 * material already covered and stop dead at the furthest card reached, so they
 * are not a way forward through anything. What keeps that honest is an
 * assertion that the forward arrow is disabled at that card, in
 * study.spec.ts, rather than this exclusion.
 *
 * The read-aloud toggle and the replay button join them on the same test: they
 * repeat what is already on the screen and advance nothing. A learner who
 * presses replay on the law card is on the same card afterwards, which is the
 * whole reason to press it -- so "the only control here is Quiz me" is still
 * exactly as true as it was, and study.spec.ts still holds it.
 *
 * The assertions that say "this screen offers exactly these actions" are about
 * ways through the material, so they exclude chrome by name rather than being
 * softened to a count -- which would let a genuine extra action slip in
 * unnoticed.
 */
export function actions(page: Page): Locator {
  return page.locator(
    'button:not([data-testid="menu-trigger"]):not([data-testid^="step-"])' +
      ':not([data-testid="speech-toggle"]):not([data-testid="replay"])' +
      // The clock switch, on the same grounds as the speech toggle beside it in
      // this list: both are standing preferences drawn as switches, and neither
      // is a way through the app. AC5 counts the hub's *paths* -- footer
      // buttons -- and menu.spec.ts still holds that count at two directly.
      ':not([data-testid="hub-timed"])' +
      // The course control, in the chrome of every pass screen and on the hub
      // (docs/plans/short-course-for-everyone.md): a standing choice about the
      // whole pass, like the clock, drawn on screens whose own ways through
      // these assertions count. The course specs assert it by name. Its two
      // segments are buttons of their own, and counted they would put two
      // actions on every pass screen (docs/plans/course-toggle.md).
      ':not([data-testid="chrome-course"]):not([data-testid="hub-course"])' +
      ':not([data-testid^="course-option-"])' +
      // The ask button beside the menu button, on every screen: chrome like
      // the menu trigger, and learner-ask.spec.ts asserts it by name.
      ':not([data-testid="ask-trigger"])' +
      // Its twin on the two front pages, the field that opens the same page
      // (docs/plans/vehicle-code.md): a door to the box, not through the pass,
      // and learner-ask-law.spec.ts asserts it by name.
      ':not([data-testid="ask-entry"])' +
      // The partner invitation over both front pages: for an instructor, not a
      // way through the pass, and landing.spec.ts asserts it by name.
      ':not([data-testid="partner-invite"])',
  )
}

/** No screen may ever ask for identity — AC8. */
export async function expectNoIdentityInputs(page: Page, label: string): Promise<void> {
  const count = await page.evaluate(() => {
    // Two exemptions, and they are named one at a time on purpose. Neither is
    // being asked who you are: choosing from a fixed list of states, and typing
    // a partner's discount code, say nothing about a person -- the same
    // reasoning that lets the paywall have a recovery-code box and the feedback
    // screen a comment.
    //
    // `partner-code-input` joined the list when the box stopped hiding behind
    // an "I have a code" button. It is on the paywall at rest now, because the
    // partner program spreads by somebody saying a code out loud and a field
    // you have to go looking for made that the second-class path.
    //
    // The list is exact strings, never a pattern, so the guard keeps its teeth:
    // any *other* input appearing on any screen still fails this, which is the
    // whole point -- a screen must not start collecting things without somebody
    // noticing.
    //
    // `form` stays in the query. It was briefly dropped when the picker was
    // added, which exempted every form on every screen rather than this one.
    const exempt = new Set(['state-selector', 'state-picker', 'partner-code-input'])
    return Array.from(
      document.querySelectorAll('input, textarea, select, form, [contenteditable]'),
    ).filter((control) => !exempt.has(control.getAttribute('data-testid') ?? '')).length
  })
  expect(count, `${label}: asks the user to type something`).toBe(0)
}

/**
 * A corpus string as the test build's synthetic Spanish pack shows it
 * (docs/plans/spanish-app.md, §7): the English text with `[es] ` in front, the
 * marker vite.config.ts puts on every translatable field of the fixture state.
 * So a Spanish spec drives the course by the same corpus names the English
 * ones do, and a string on a Spanish screen without the marker is English.
 */
export function es(text: string): string {
  return SYNTHETIC_PREFIX + text
}
