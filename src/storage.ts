import type { AskThreadEntry } from './ask'
import type { Deleted } from './ask-thread'

/** One part's score on one run, filed under that section's id. */
export type SectionScores = Record<string, { score: number; total: number }>

export interface TestResult {
  date: string
  /**
   * Which kind of run this was.
   *
   * `'diagnostic'` is the ten-question test offered before the pass is
   * covered. It is deliberately a third mode rather than a short `'full'`:
   * everything that reads a result keys on this -- the paywall counts only
   * `'full'` runs, levels and the readiness streak skip anything else, and
   * `isPassingScore` refuses to grade it -- so a diagnostic recorded as a full
   * run would spend the free test and could earn a level off ten questions.
   */
  mode: 'full' | 'missed' | 'diagnostic'
  score: number
  total: number
  missedIds: string[]
  /** Rules used when this result was earned, so later data cannot rewrite history. */
  exam?: {
    questions: number
    passMark: number
    /** Absent on every result stored before it existed, and read as
     *  `'sections'` -- the rule those results were actually earned under. */
    passRule?: 'sections' | 'total'
    sections?: readonly {
      id: string
      name: string
      questions: number
      passMark: number
      concepts: readonly string[]
    }[]
  }
  /**
   * How this run scored part by part, on a state whose paper has parts.
   *
   * Written beside the shape rather than recomputed on read, because a corpus
   * edit that moves a concept from one section to another would otherwise
   * silently re-score a test somebody has already sat and passed. Absent on
   * every result from an unsectioned state, and on every result written before
   * sections existed — both of which are judged by the total, as they were.
   */
  sectionScores?: SectionScores
  /**
   * How many laws had been covered when this run was recorded.
   *
   * Written on diagnostics from 2026-09-21, for the question a *repeat*
   * diagnostic is actually asking: did the studying count? A ten-question
   * draw from a 372-law corpus cannot answer it. Two learners re-sat it on
   * 21 Sep after 46 and 32 cards and scored 7 then 7, and 9 then 8 -- noise,
   * reported as a verdict -- and both closed the tab on that screen. The
   * number that had moved was the one nothing showed them.
   *
   * **Absent means unknown, never nought.** A result stored before this field
   * existed holds no opinion about what had been covered, and a screen reading
   * it as zero would tell a learner who has studied for a fortnight that they
   * have covered nothing since.
   */
  covered?: number
  /**
   * Whether this run still had a clock on it when it ended.
   *
   * Written on every result from 2026-09-07, and only levels read it: a run
   * sat without the paper's time limit is practice, and practice is not
   * evidence of being ready for a paper that has one.
   *
   * **Absent means it counts.** Results stored before this field existed carry
   * no opinion, and they are read as counting rather than as untimed --
   * `levelDates` promises that a level once reached can never be taken back,
   * and a learner who earned Prepared last week must not open the app to find
   * it gone because the rules changed underneath them. Only `false`, written
   * deliberately by a run that had no clock, is disqualifying. The same
   * treatment `exam` and `sectionScores` above were given, for the same
   * reason.
   *
   * Read from the deadline at the moment the run ends, not from the
   * preference: a run whose clock was put down partway is `false`, which is
   * what stops "stop the clock" being the way around this.
   */
  timed?: boolean
}

export interface MasteryEntry {
  /** Correct answers in a row. */
  n: number
  /** ISO 8601 timestamp of the most recent correct answer. */
  at: string
}

/** A test that was started but not finished, so it survives a closed tab. */
export interface ActiveTest {
  mode: 'full' | 'missed' | 'diagnostic'
  questionIds: string[]
  current: number
  correctCount: number
  missedIds: string[]
  /** Questions tipped into mastery during this run, for the results screen. */
  newlyMastered: number
  /**
   * When this run runs out, as epoch milliseconds -- or null, which is every
   * run unless the learner asked for a clock.
   *
   * A deadline rather than a remaining count, so that closing the app does not
   * pause it. That is the faithful reading of a timed exam and it is also the
   * only one that survives a reload: a countdown stored as "eleven minutes
   * left" is one a learner can top up by force-quitting.
   */
  deadline?: number | null
}

export interface Progress {
  studyIndex: number
  coveredOnce: boolean
  tests: TestResult[]
  /**
   * Per law id: how many correct answers in a row, and when the last one was.
   * The timestamp is what lets mastery lapse — distributed practice beats
   * massed practice, and a question answered right a fortnight ago is not
   * known in the same sense as one answered right yesterday.
   */
  mastery: Record<string, MasteryEntry>
  /** The run in progress, or null when no test is open. */
  activeTest: ActiveTest | null
  /**
   * Laws the learner tested out of in this pass (#383): answered right in a
   * section's prescreen, so the pass does not teach their card. Ids rather
   * than indices, because the pass is a list that a corpus edit can reorder,
   * and a skipped position would then skip a different law. Cleared when a
   * completed pass is started again -- a second pass is a second chance to be
   * asked -- and NEVER consulted by a test: the pool is untouched, and a
   * tested-out law missed on a test comes back through the restudy walk.
   */
  skipped: string[]
  /**
   * Law ids whose card the pass has actually put in front of this learner and
   * whose quiz they answered right.
   *
   * Today it is derivable: `studyIndex`'s invariant is that every card before
   * it was taught or tested out of, so "taught" is the frontier minus
   * `skipped`. It is recorded per law because the short course
   * (docs/plans/short-course.md) breaks that invariant -- a course that walks
   * only the anchors moves the frontier past cards it never showed, and after
   * one switch the frontier can no longer say which cards those were. Review
   * would then step back onto a card the learner has never seen, and switching
   * back to the full course would have to re-teach ten cards it had no way to
   * know were done.
   *
   * **Absent means "never recorded", not "nothing taught"**, and the two must
   * never be confused: `normalizeProgress` seeds an absent field from the
   * frontier on load, and seeding an empty-but-present one would overwrite a
   * real record -- a learner who has just switched course has a frontier far
   * ahead of the handful of cards they have been shown.
   */
  taught?: string[]
  /**
   * Which way through the pass this learner has chosen: every pooled law, or
   * one or two per topic (docs/plans/short-course.md).
   *
   * A string rather than a boolean so the record says which course it is
   * rather than whether a flag is on, and so a third could be named without a
   * migration. **Absent is `'full'`**, which is every record written before
   * the short course existed and the only course those learners can have been
   * on -- the way `skipped` is read as `[]`. Nothing seeds it, because unlike
   * `taught` there is nothing to derive: there was one course.
   */
  course?: 'full' | 'short'
  /**
   * A prescreen in flight, so a closed tab mid-section resumes the same
   * questions without repeating answered ones or re-teaching skipped laws.
   * `start` is the section's first index in the pass, `current` the law being
   * asked. Null when no prescreen is open.
   */
  prescreen: { start: number; current: number } | null
}

const KEY_PREFIX = 'teach-and-test/v1/'
// Two-letter state codes can never collide with these suffixes.
//
// `splash-shown` was one of these until the greeting was removed. It is not
// migrated or cleaned up: nothing reads it now, so a browser carrying one is
// carrying a dead byte, and a release whose only job was to reach into every
// visitor's storage and delete something harmless would be all risk and no
// gain. The name stays spoken for here so it is never reused for something
// that would find a stale value already sitting there.
const FEEDBACK_INVITED_KEY = KEY_PREFIX + 'feedback-invited'
const SPEECH_ON_KEY = KEY_PREFIX + 'speech-on'
const FOCUS_MODE_KEY = KEY_PREFIX + 'focus-mode'
const TIMED_TESTS_KEY = KEY_PREFIX + 'timed-tests'
const ASK_FIRST_SEEN_KEY = KEY_PREFIX + 'ask-first-seen'
/**
 * The learner's choice of language: `'es'`, or absent for English. Absent
 * rather than `'en'` so a browser that never touched the switch and one that
 * switched back hold the same thing, and nothing but the one value is written.
 */
const LANG_KEY = KEY_PREFIX + 'lang'
/** The code a pack of question tokens is held under (docs/plans/trusted-by-date.md, decision 22). */
export const QUESTION_CODE_KEY = KEY_PREFIX + 'question-code'
/** The learner's questions and answers, kept so a reload does not empty the thread under the box. */
export const ASK_THREAD_KEY = KEY_PREFIX + 'ask-thread'
/** The question waiting while its asker is at Stripe Checkout (decision 25). */
export const ASK_PENDING_KEY = KEY_PREFIX + 'ask-pending'
/** In sessionStorage: "Spend a token?" has been answered yes this session. */
export const ASK_SPEND_CONFIRMED_KEY = KEY_PREFIX + 'ask-spend-confirmed'

/**
 * What is filed per product, and what is not.
 *
 * Progress and the chosen state are content: a hunting run is not a driving
 * run, and somebody may reasonably be studying driving in Maryland and hunting
 * in Pennsylvania at the same time. So both gain the product.
 *
 * The feedback invitation, the device id, the entitlement, the recovery code
 * and the analytics id stay global. They are identity or courtesy rather than
 * content, and asking somebody twice because they opened a second product is a
 * worse experience, not a more correct one.
 */
const progressKey = (product: string, stateCode: string) =>
  `${KEY_PREFIX}${product}/${stateCode}`
const selectedStateKey = (product: string) => `${KEY_PREFIX}${product}/selected-state`

/**
 * The product every key written before there were products belongs to.
 *
 * Progress used to live at `teach-and-test/v1/MD`, with nothing above the
 * state, because the app was one product that never said so -- and that one
 * product was driving. Spelled out here rather than imported from the registry
 * because it is a fact about what is already on people's disks, not a choice
 * about what `/` means today: if the default product ever changes, these keys
 * still belong to driving.
 */
const LEGACY_PRODUCT = 'drivers'

/**
 * Read the new key, falling back to the key this browser was already using and
 * adopting what it finds.
 *
 * **Copy, never move.** Re-keying without this silently wipes every learner
 * mid-study: they come back to a fresh app, with no explanation and no way to
 * ask for their history back. Leaving the old key in place costs a few
 * kilobytes and means a rollback strands nobody -- a build from before the
 * split still finds everything where it left it. It can be deleted a release
 * later, or never.
 *
 * The copy is best-effort. A store that refuses the write still returns the
 * legacy value to the caller, so the worst case is that the adoption happens
 * again on the next load rather than that the visit starts empty.
 */
function readAdopting(key: string, legacyKey: string | null): string | null {
  const raw = localStorage.getItem(key)
  if (raw !== null || legacyKey === null) return raw
  const legacy = localStorage.getItem(legacyKey)
  if (legacy === null) return null
  try {
    localStorage.setItem(key, legacy)
  } catch {
    // Quota or private mode. The read below is what the visit needs.
  }
  return legacy
}

export function defaultProgress(): Progress {
  return {
    studyIndex: 0,
    coveredOnce: false,
    tests: [],
    mastery: {},
    activeTest: null,
    skipped: [],
    // `taught` is deliberately absent rather than `[]`. Absent is what
    // `normalizeProgress` seeds from the frontier, and a fresh record's
    // frontier is nought, so it seeds to empty anyway -- while writing `[]`
    // here would make "clean record" and "record from before the field
    // existed" two different shapes for no gain.
    prescreen: null
  }
}

function isTestResult(value: unknown): value is TestResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return (
    typeof result.date === 'string' &&
    (result.mode === 'full' || result.mode === 'missed' || result.mode === 'diagnostic') &&
    typeof result.score === 'number' &&
    typeof result.total === 'number' &&
    Array.isArray(result.missedIds) &&
    result.missedIds.every((id) => typeof id === 'string') &&
    (result.exam === undefined || isExamShape(result.exam)) &&
    (result.sectionScores === undefined || isSectionScores(result.sectionScores))
  )
}

function isExamShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const exam = value as Record<string, unknown>
  return (
    typeof exam.questions === 'number' &&
    Number.isInteger(exam.questions) &&
    exam.questions > 0 &&
    typeof exam.passMark === 'number' &&
    Number.isInteger(exam.passMark) &&
    exam.passMark > 0 &&
    exam.passMark <= exam.questions &&
    (exam.passRule === undefined ||
      exam.passRule === 'sections' ||
      exam.passRule === 'total') &&
    // Rule-aware rather than loosened to accept both: a floor of zero is legal
    // on a paper scored by its total and meaningless on one scored part by
    // part, and a check that accepted zero everywhere would read a Virginia
    // result whose bar had been zeroed as a result to keep scoring.
    (exam.sections === undefined || isExamSections(exam.sections, exam.passRule))
  )
}

function isExamSections(value: unknown, passRule: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((raw) => {
    if (typeof raw !== 'object' || raw === null) return false
    const section = raw as Record<string, unknown>
    return (
      typeof section.id === 'string' &&
      section.id !== '' &&
      typeof section.name === 'string' &&
      typeof section.questions === 'number' &&
      Number.isInteger(section.questions) &&
      section.questions > 0 &&
      typeof section.passMark === 'number' &&
      Number.isInteger(section.passMark) &&
      (passRule === 'total' ? section.passMark >= 0 : section.passMark > 0) &&
      section.passMark <= section.questions &&
      Array.isArray(section.concepts) &&
      section.concepts.every((concept) => typeof concept === 'string')
    )
  })
}

function isSectionScores(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((raw) => {
    if (typeof raw !== 'object' || raw === null) return false
    const entry = raw as Record<string, unknown>
    return (
      typeof entry.score === 'number' &&
      Number.isInteger(entry.score) &&
      entry.score >= 0 &&
      typeof entry.total === 'number' &&
      Number.isInteger(entry.total) &&
      entry.total >= 0 &&
      entry.score <= entry.total
    )
  })
}

function isActiveTest(value: unknown): value is ActiveTest {
  if (typeof value !== 'object' || value === null) return false
  const test = value as Record<string, unknown>
  return (
    (test.mode === 'full' || test.mode === 'missed' || test.mode === 'diagnostic') &&
    Array.isArray(test.questionIds) &&
    test.questionIds.every((id) => typeof id === 'string') &&
    typeof test.current === 'number' &&
    Number.isInteger(test.current) &&
    test.current >= 0 &&
    typeof test.correctCount === 'number' &&
    Number.isInteger(test.correctCount) &&
    test.correctCount >= 0 &&
    Array.isArray(test.missedIds) &&
    test.missedIds.every((id) => typeof id === 'string') &&
    (test.newlyMastered === undefined ||
      (typeof test.newlyMastered === 'number' && Number.isInteger(test.newlyMastered))) &&
    (test.deadline === undefined ||
      test.deadline === null ||
      (typeof test.deadline === 'number' && Number.isFinite(test.deadline)))
  )
}

function isMasteryEntry(value: unknown): value is MasteryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.n === 'number' &&
    Number.isInteger(entry.n) &&
    entry.n >= 0 &&
    typeof entry.at === 'string'
  )
}

/**
 * Accepts both shapes: the bare count written before mastery could lapse, and
 * the count-plus-timestamp written since. A record in the old shape is still
 * real progress and is carried over rather than thrown away.
 */
function isMastery(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(
    (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0) || isMasteryEntry(v),
  )
}

/**
 * `mastery` and `activeTest` are allowed to be absent: records written before
 * they existed are still valid progress, and load fills them in rather than
 * discarding the pass.
 */
function isPrescreen(value: unknown): value is { start: number; current: number } {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.start === 'number' &&
    Number.isInteger(p.start) &&
    p.start >= 0 &&
    typeof p.current === 'number' &&
    Number.isInteger(p.current) &&
    p.current >= p.start
  )
}

function isProgress(
  value: unknown,
): value is Omit<Progress, 'mastery' | 'activeTest' | 'skipped' | 'prescreen'> {
  if (typeof value !== 'object' || value === null) return false
  const progress = value as Record<string, unknown>
  return (
    typeof progress.studyIndex === 'number' &&
    Number.isInteger(progress.studyIndex) &&
    progress.studyIndex >= 0 &&
    typeof progress.coveredOnce === 'boolean' &&
    Array.isArray(progress.tests) &&
    progress.tests.every(isTestResult) &&
    (progress.mastery === undefined || isMastery(progress.mastery)) &&
    (progress.activeTest === undefined ||
      progress.activeTest === null ||
      isActiveTest(progress.activeTest)) &&
    // Both absent on every record written before #383, and load fills them in
    // rather than discarding the pass; present and malformed is a record
    // nothing wrote, and is refused like any other.
    (progress.skipped === undefined ||
      (Array.isArray(progress.skipped) && progress.skipped.every((id) => typeof id === 'string'))) &&
    // Absent on every record written before the short course, and load leaves
    // it absent so `normalizeProgress` can tell that apart from a learner who
    // has been taught nothing. Present and malformed is refused like the rest.
    (progress.taught === undefined ||
      (Array.isArray(progress.taught) && progress.taught.every((id) => typeof id === 'string'))) &&
    // Absent is the full course, and anything else is a record nothing wrote.
    // A stored `course: 'shrt'` is neither, and it does not fall back to the
    // full course: `courseShows` admits every card only when the course is
    // exactly `'full'`, so the pass would quietly teach 52 of Maryland's 203
    // laws under a Settings row reading `Course: shrt · 203 cards`. A pass
    // silently shortened, labelled with the number it is no longer teaching --
    // refused here instead. tests/unit/storage.test.ts holds this clause.
    (progress.course === undefined ||
      progress.course === 'full' ||
      progress.course === 'short') &&
    (progress.prescreen === undefined ||
      progress.prescreen === null ||
      isPrescreen(progress.prescreen))
  )
}

export function loadProgress(product: string, stateCode: string): Progress {
  try {
    const raw = readAdopting(
      progressKey(product, stateCode),
      product === LEGACY_PRODUCT ? KEY_PREFIX + stateCode : null,
    )
    if (raw === null) return defaultProgress()
    const parsed: unknown = JSON.parse(raw)
    if (!isProgress(parsed)) return defaultProgress()
    const stored = parsed as {
      mastery?: Record<string, number | MasteryEntry>
      activeTest?: ActiveTest | null
      skipped?: string[]
      prescreen?: { start: number; current: number } | null
    }
    // Old records stored a bare count with no date. Treat those as having been
    // answered long ago, so they come back round rather than counting as fresh.
    const mastery: Record<string, MasteryEntry> = {}
    for (const [id, v] of Object.entries(stored.mastery ?? {})) {
      mastery[id] = typeof v === 'number' ? { n: v, at: new Date(0).toISOString() } : v
    }
    return {
      ...parsed,
      mastery,
      skipped: stored.skipped ?? [],
      prescreen: stored.prescreen ?? null,
      activeTest:
        stored.activeTest == null
          ? null
          : {
              ...stored.activeTest,
              newlyMastered: stored.activeTest.newlyMastered ?? 0,
              // Absent means untimed, which is every run written before the
              // clock existed and every run somebody did not ask to time.
              deadline: stored.activeTest.deadline ?? null,
            },
    }
  } catch {
    // Absent, corrupt, or inaccessible storage all restart cleanly.
    return defaultProgress()
  }
}

export function saveProgress(product: string, stateCode: string, progress: Progress): void {
  try {
    localStorage.setItem(progressKey(product, stateCode), JSON.stringify(progress))
  } catch {
    // Storage may be unavailable (private mode, quota). The session still
    // works; progress just will not survive a reload.
  }
}

/**
 * The state the user last chose in this product, so a reload resumes instead
 * of re-asking.
 *
 * Per product, and adopted from the pre-split key for the same reason progress
 * is: without it, every returning learner is shown the state picker again on
 * the release that introduces products. That is not data loss, but it is very
 * visibly not nothing, and this release is meant to be invisible.
 */
export function loadSelectedState(product: string): string | null {
  try {
    const code = readAdopting(
      selectedStateKey(product),
      product === LEGACY_PRODUCT ? KEY_PREFIX + 'selected-state' : null,
    )
    return code !== null && code.length > 0 ? code : null
  } catch {
    return null
  }
}

export function saveSelectedState(product: string, stateCode: string): void {
  try {
    localStorage.setItem(selectedStateKey(product), stateCode)
  } catch {
    // Same as saveProgress: an unavailable store only costs the resume.
  }
}

/**
 * Whether this browser has already been invited to send feedback.
 *
 * Asked once, ever, on the results screen after a passed test -- the moment
 * with the most goodwill in the app -- and never again, whether or not they
 * took it up. The menu entry stays put regardless, so somebody who ignored the
 * invitation can still find their way there; what this flag prevents is the
 * app asking a second time, which is an app talking about itself rather than
 * listening.
 *
 * An unreadable store counts as already invited: the cheap mistake is missing
 * one invitation, the expensive one is asking on every single visit forever.
 */
export function feedbackInvited(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_INVITED_KEY) !== null
  } catch {
    return true
  }
}

/**
 * Whether the app reads itself out loud.
 *
 * Global rather than per product or per state, on the line this file already
 * draws: progress is content and gains the product, while identity and courtesy
 * stay global. Somebody who needs the questions read aloud needs them read
 * aloud in every state and every product, and asking again because they opened
 * a second exam would be asking twice for one answer.
 *
 * A key of its own rather than a field on `Progress`, which is per state and is
 * rewritten by every answer. A preference does not belong in something a corpus
 * migration might rewrite.
 *
 * An unreadable store counts as **off**. The expensive mistake here is a phone
 * that starts talking in a quiet room to somebody who never asked it to, so the
 * fallback is silence rather than speech.
 */
export function speechEnabled(): boolean {
  try {
    return localStorage.getItem(SPEECH_ON_KEY) !== null
  } catch {
    return false
  }
}

export function setSpeechEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(SPEECH_ON_KEY, '1')
    else localStorage.removeItem(SPEECH_ON_KEY)
  } catch {
    // Same as saveProgress: an unavailable store costs only the bookkeeping.
    // The mode still works for this session; it just will not be remembered.
  }
}

/**
 * Whether this device has asked the app to hold still.
 *
 * Global, and a key of its own, for the same two reasons `speechEnabled` is:
 * somebody who wants the screen to stop moving wants it in every state and
 * every product, and a preference does not belong on `Progress`, which is per
 * state and rewritten by every answer.
 *
 * An unreadable store counts as focus mode **off** -- motion on -- which is the
 * opposite default from speech and deliberately so. The expensive mistake with
 * speech is a phone that starts talking in a quiet room; the expensive mistake
 * here is a learner in a private window whose app looks broken because nothing
 * ever animates. The operating system's own `prefers-reduced-motion` still
 * applies either way, and it needs no storage at all -- see src/index.css.
 */
export function focusMode(): boolean {
  try {
    return localStorage.getItem(FOCUS_MODE_KEY) !== null
  } catch {
    return false
  }
}

export function setFocusMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(FOCUS_MODE_KEY, '1')
    else localStorage.removeItem(FOCUS_MODE_KEY)
  } catch {
    // Same as saveProgress: an unavailable store costs only the bookkeeping.
    // The choice still holds for this session; it just will not be remembered.
  }
}

export function markFeedbackInvited(): void {
  try {
    localStorage.setItem(FEEDBACK_INVITED_KEY, '1')
  } catch {
    // Same as saveProgress: an unavailable store costs only the bookkeeping.
  }
}

/**
 * Whether this browser has already been told why a section opens on its
 * questions.
 *
 * A key of its own rather than a field on `Progress`, for the reason
 * `speechEnabled` gives and one more: `Progress` is per state, and the
 * explanation is about how the app works rather than about Maryland. Filed
 * there, somebody who studies a second state would be told the same thing a
 * second time.
 *
 * An unreadable store counts as **already seen**, the same way
 * `feedbackInvited` does: the cheap mistake is one learner never meeting a
 * paragraph they could have done without, and the expensive one is the app
 * explaining itself at the top of every section forever.
 */
export function askFirstSeen(): boolean {
  try {
    return localStorage.getItem(ASK_FIRST_SEEN_KEY) !== null
  } catch {
    return true
  }
}

export function markAskFirstSeen(): void {
  try {
    localStorage.setItem(ASK_FIRST_SEEN_KEY, '1')
  } catch {
    // Same as saveProgress: an unavailable store costs only the bookkeeping.
  }
}

/**
 * Everything under the prefix that a restart must NOT take.
 *
 * A keep-list rather than a remove-list, and the direction matters. Written the
 * other way round -- naming what to delete -- a key added later and forgotten
 * simply survives a restart, which is a wart. Written this way, a key added
 * later and forgotten is deleted, which is a wart too, but a *smaller* one:
 * the things that must survive are the purchase, and they are named here by
 * hand and held by tests/e2e/menu.spec.ts, which presses the restart a learner
 * presses and then reads the store.
 *
 * The purchase is three keys and losing any of them locks a buyer out of what
 * they paid for. The rest are preferences: a restart is about the studying,
 * not about turning the voice back on.
 *
 * **No count of them is written anywhere.** The line below this list said
 * "six" while the list held seven, and went on saying it when the eighth was
 * added: a number beside a list is a second place to update and the only one
 * nothing fails on.
 */
const KEPT_ACROSS_RESTART: readonly string[] = [
  // The purchase. `device-id` is what a purchase is attached to, `entitled` is
  // the cached answer, and `recovery-code` is the only way back on a second
  // device. Deleting these does not refund anybody; it strands them.
  KEY_PREFIX + 'device-id',
  KEY_PREFIX + 'entitled',
  KEY_PREFIX + 'recovery-code',
  // Question tokens are a purchase too: the code is the only thing that holds
  // them, and a restart that took it would leave a paid balance unreachable
  // from the browser that bought it.
  QUESTION_CODE_KEY,
  // Preferences, and the one-shot marker that stops the feedback invitation
  // being offered twice. Nothing here is progress.
  FEEDBACK_INVITED_KEY,
  SPEECH_ON_KEY,
  FOCUS_MODE_KEY,
  TIMED_TESTS_KEY,
  ASK_FIRST_SEEN_KEY,
  // A learner who restarts in Spanish means to start again, not to be put back
  // into English on the first card.
  LANG_KEY,
]

/**
 * Forget the studying and keep the purchase.
 *
 * Everything filed under this app's prefix goes except the keys listed above,
 * so a restart reaches the progress of every state and every product this
 * browser has ever opened -- including the pre-product `v1/<STATE>` keys,
 * which is not incidental: `loadProgress` adopts the legacy key when the new
 * one is absent, so a restart that cleared only the new one would be undone by
 * the next read and would look like it silently did nothing.
 *
 * It deliberately does not touch anything outside the prefix. This app shares
 * an origin with the partner portal, and a learner resetting their own progress
 * has no business signing a partner out.
 */
/**
 * Whether a full run should be given the paper's own time limit.
 *
 * Off unless the learner has turned it on, and remembered once they have --
 * the same shape as focus mode, and deliberately not the same shape as speech,
 * which cannot be restored from storage because a browser will not play audio
 * that was not started by a gesture. Nothing here needs a gesture.
 *
 * Off by default because the clock is the exam's constraint, not the studying's:
 * somebody meeting this material for the first time is trying to learn it, and
 * a timer on that first run measures nothing except how fast they read.
 */
export function timedTests(): boolean {
  try {
    return localStorage.getItem(TIMED_TESTS_KEY) !== null
  } catch {
    return false
  }
}

export function setTimedTests(on: boolean): void {
  try {
    if (on) localStorage.setItem(TIMED_TESTS_KEY, '1')
    else localStorage.removeItem(TIMED_TESTS_KEY)
  } catch {
    // A browser refusing storage keeps the default, which is off.
  }
}

/** The stored choice of language; English when nothing is stored or storage refuses. */
export function storedLanguage(): 'en' | 'es' {
  try {
    return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

export function setStoredLanguage(lang: 'en' | 'es'): void {
  try {
    if (lang === 'es') localStorage.setItem(LANG_KEY, 'es')
    else localStorage.removeItem(LANG_KEY)
  } catch {
    // A browser refusing storage keeps the choice for this page only.
  }
}

export function resetProgress(): void {
  try {
    const doomed: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key === null) continue
      if (!key.startsWith(KEY_PREFIX)) continue
      if (KEPT_ACROSS_RESTART.includes(key)) continue
      doomed.push(key)
    }
    // Collected first, removed after: removing inside the loop reindexes the
    // store underneath it and skips every other key.
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // A browser refusing storage has nothing to reset, and a restart that threw
    // here would leave the learner on a screen saying it had failed when there
    // was nothing to fail at.
  }
}

/** The question code this browser holds, as a person reads it, or null. */
export function storedQuestionCode(): string | null {
  try {
    return localStorage.getItem(QUESTION_CODE_KEY)
  } catch {
    return null
  }
}

export function saveQuestionCode(code: string): void {
  try {
    localStorage.setItem(QUESTION_CODE_KEY, code)
  } catch {
    // Unstorable: the code is still on the screen and in the receipt mail.
  }
}

/**
 * What the ask page was holding when its asker left for Stripe: the question
 * in the input, the Nationwide tick and the conversation. Written just before
 * leaving, read once on the way back -- from the success page or the cancel --
 * and dropped after a day, so a checkout abandoned last week does not put an
 * old question back into a new visit's input.
 */
export interface AskPending {
  question: string
  nationwide: boolean
  conversation: string
  at: number
}

const PENDING_LIFETIME_MS = 86_400_000

export function saveAskPending(pending: AskPending): void {
  try {
    localStorage.setItem(ASK_PENDING_KEY, JSON.stringify(pending))
  } catch {
    // The checkout still works; the question is what is lost, and it is typed again.
  }
}

export function readAskPending(now = Date.now()): AskPending | null {
  try {
    const raw = localStorage.getItem(ASK_PENDING_KEY)
    if (raw === null) return null
    const kept = JSON.parse(raw) as Partial<AskPending>
    if (typeof kept.question !== 'string' || typeof kept.conversation !== 'string' || typeof kept.at !== 'number') return null
    if (now - kept.at > PENDING_LIFETIME_MS) return null
    return { question: kept.question, nationwide: kept.nationwide === true, conversation: kept.conversation, at: kept.at }
  } catch {
    return null
  }
}

export function clearAskPending(): void {
  try {
    localStorage.removeItem(ASK_PENDING_KEY)
  } catch {
    // Nothing to clear in a store that cannot be read.
  }
}

/** Whether "Spend a token?" was answered yes in this tab's session. Unreadable reads as not yet. */
export function spendConfirmed(): boolean {
  try {
    return sessionStorage.getItem(ASK_SPEND_CONFIRMED_KEY) !== null
  } catch {
    return false
  }
}

export function markSpendConfirmed(): void {
  try {
    sessionStorage.setItem(ASK_SPEND_CONFIRMED_KEY, '1')
  } catch {
    // Asked again next time, which costs a tap and never a token.
  }
}

/**
 * How many exchanges the thread keeps. Every answer is stored as it was drawn,
 * citations and all, and a nationwide one cites up to 51 states: an unbounded
 * thread would grow until the write failed, and a failed write is a thread that
 * silently stops being kept.
 */
export const ASK_THREAD_LIMIT = 50

/**
 * The thread this device kept, oldest first; empty when nothing was kept or
 * what was kept cannot be read. An unreadable value is an empty thread rather
 * than an error, because the box under it is how a learner asks anything at
 * all, and one bad byte must not cost them that.
 */
export function loadAskThread(): AskThreadEntry[] {
  try {
    const raw = localStorage.getItem(ASK_THREAD_KEY)
    if (raw === null) return []
    const kept: unknown = JSON.parse(raw)
    if (!Array.isArray(kept)) return []
    // An entry written without its state is read as having none, which the
    // box takes to be the state it is answering for (keptFor, src/ask-thread.ts),
    // rather than dropped whole for a field it can do without.
    return kept
      .filter(isThreadEntry)
      .map((entry) => (entry.state === undefined ? { ...entry, state: null } : entry))
      .slice(-ASK_THREAD_LIMIT)
  } catch {
    return []
  }
}

/** Keeps the newest ASK_THREAD_LIMIT exchanges, dropping the oldest. */
export function saveAskThread(thread: readonly AskThreadEntry[]): void {
  try {
    localStorage.setItem(ASK_THREAD_KEY, JSON.stringify(thread.slice(-ASK_THREAD_LIMIT)))
  } catch {
    // Full or refused: the thread is still on the screen for this visit.
  }
}

export const ASK_DELETED_KEY = KEY_PREFIX + 'ask-deleted'

/**
 * The exchanges deleted from the thread on this device, so the code's history
 * does not merge them back in (withoutDeleted, src/ask-thread.ts). Capped like
 * the thread: the history route answers with no more than that many.
 */
export function loadAskDeleted(): Deleted[] {
  try {
    const raw = localStorage.getItem(ASK_DELETED_KEY)
    if (raw === null) return []
    const kept: unknown = JSON.parse(raw)
    if (!Array.isArray(kept)) return []
    return kept.filter(
      (entry): entry is Deleted => typeof entry === 'object' && entry !== null && typeof (entry as Deleted).question === 'string',
    )
  } catch {
    return []
  }
}

export function saveAskDeleted(deleted: readonly Deleted[]): void {
  try {
    localStorage.setItem(ASK_DELETED_KEY, JSON.stringify(deleted.slice(-ASK_THREAD_LIMIT)))
  } catch {
    // Refused: the exchange is gone from this visit, and may come back from the code's history on the next.
  }
}

export const ASK_EARLIER_KEY = KEY_PREFIX + 'ask-earlier'

/** Whether the earlier questions under the newest are shown: true unless this device chose "Show less". */
export function loadAskEarlierShown(): boolean {
  try {
    return localStorage.getItem(ASK_EARLIER_KEY) !== 'hidden'
  } catch {
    return true
  }
}

export function saveAskEarlierShown(shown: boolean): void {
  try {
    if (shown) localStorage.removeItem(ASK_EARLIER_KEY)
    else localStorage.setItem(ASK_EARLIER_KEY, 'hidden')
  } catch {
    // The choice holds for this visit.
  }
}

function isThreadEntry(value: unknown): value is AskThreadEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<AskThreadEntry>
  return (
    typeof entry.question === 'string' &&
    typeof entry.answer === 'object' &&
    entry.answer !== null &&
    typeof entry.answer.id === 'string' &&
    typeof entry.askedAt === 'string' &&
    (entry.state === undefined || entry.state === null || typeof entry.state === 'string') &&
    (entry.chip === undefined || entry.chip === true || entry.chip === 'state')
  )
}
