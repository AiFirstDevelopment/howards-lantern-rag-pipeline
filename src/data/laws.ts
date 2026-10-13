import { loadCorpus } from 'virtual:corpus'
import { productRegistry } from '../products'

export interface Answer {
  answer: string
  isCorrect: boolean
  /**
   * Key into RoadSign, for a question whose four answers are pictures rather
   * than words -- "which of these signs means you may not enter?", the format
   * Maryland's real paper uses (#100, slice C).
   *
   * All four answers carry one or none does; `tests/unit/signs.test.ts` holds
   * that, because a question with three pictures and a sentence is a question
   * with the sentence as the answer. `answer` stays: it is the FAQ's text on
   * the prerendered page and the name the suite clicks, and it is what a
   * screen reader would otherwise be handed -- so on screen the button's
   * accessible name is a neutral "Sign 1", never this text and never the
   * artwork's own description. Four equally uninformative labels, which is
   * the same problem the sighted learner is being set.
   */
  sign?: string
}

/**
 * Where in the state's own manual a rule is written down.
 *
 * Authored for a fact-checker first -- `supports` says what the quote is
 * evidence *for*, which is what makes a review of the corpus possible at all --
 * and it sat in the corpus unread by anything for as long as that was its only
 * job. It is on the screen now because the claim the whole app rests on is that
 * these rules came out of the manual, and a page number is the only form of
 * that claim a learner can check.
 */
export interface Citation {
  /** `manual:MD` and so on. Anything else is not the manual and is not shown as
   *  though it were -- see `manualCitation` in src/citation.ts. */
  source: string
  /** `p.21 (printed) — '<the manual's own sentence>'`, uniform across all four
   *  states today and parsed defensively rather than trusted. */
  location: string
  /** What the quote is evidence for: "the rule itself" on all but three of the
   *  1,028 laws shipped today. */
  supports?: string
}
export interface Law {
  id: string
  category: string
  /** One of the 37 testable concepts the corpus collapses to. */
  concept: string
  law: string
  /**
   * Why the rule exists, in one sentence. Shown when a learner gets the
   * question wrong, where the law text alone often just restates the answer
   * back at them. Reasoning survives being asked in unfamiliar words; a
   * memorised answer does not.
   */
  why?: string
  question: string
  /** Key into RoadSign for questions that show a sign rather than describe it. */
  sign?: string
  /**
   * Key into Diagram for a rule that a drawing carries better than words --
   * who goes first at a four-way stop. Shown where the rule is being taught,
   * never beside its unanswered question: the drawing marks the answer.
   */
  diagram?: string
  answers: Answer[]
  /** Whether this law may be drawn as a test question. */
  inPool: boolean
  /**
   * Set when a correction changed a sentence that already had a recorded clip.
   *
   * Clips are named by the hash of what is spoken, so editing a law does not
   * repoint its audio -- it orphans it, and `tests/unit/audio-clip.test.ts`
   * turns that into a red build. This flag is for the human running
   * `npm run voice`: it names which entries changed, which the hash alone
   * cannot, because a missing clip looks the same whether the sentence was
   * corrected or merely never recorded. Cleared once the clip is re-cut.
   */
  audioDirty?: boolean
  /** A study anchor: the law that teaches its concept. */
  examLikely?: boolean
  /** 1 for a concept's sole anchor, 2 for the extra anchor on high-yield concepts. */
  anchorRank?: number
  /** Present on every law of every state shipped so far, and still optional:
   *  the `offManual` exception in docs/plans/how-to-build-laws.md is a law the
   *  manual does not contain, and it has nothing to cite. */
  citations?: readonly Citation[]
  /**
   * Where the state's Spanish handbook says it, in the same `p.N — 'quote'`
   * shape as an English location. Only ever set by a Spanish pack
   * (src/data/pack.ts); a Spanish card without one cites the English manual.
   */
  esCitation?: string
}

/**
 * One separately scored part of a knowledge test.
 *
 * Some states do not set one bar over one paper. Virginia asks ten road sign
 * questions and requires all ten before it will show the other thirty, of
 * which twenty-four must be right. Flattening that to forty questions and
 * thirty-four right lets a learner trade sign misses against general-knowledge
 * marks, pass here, and be stopped at part one of the real exam -- which is
 * this app certifying somebody who is about to fail.
 *
 * A section draws from its own named concepts, so a run reproduces the paper's
 * parts rather than sampling one undifferentiated bank.
 */
export interface ExamSection {
  /** Stable key. Scores are filed under it on every stored result. */
  id: string
  /** What the agency calls this part, shown to the learner. */
  name: string
  /** Questions drawn from this section on one full run. */
  questions: number
  /**
   * Correct answers this part requires.
   *
   * What that requirement *is* depends on `ExamShape.passRule`: a bar the part
   * is passed by under `'sections'`, a floor the paper is refused below under
   * `'total'`. Zero only under `'total'`, for a part the manual sets no minimum
   * on -- New York names a minimum for road signs and none for the other
   * sixteen questions, and a part with an invented minimum is a part the
   * learner is told a bar for that the state does not set.
   */
  passMark: number
  /** The concepts this section draws from. Sections partition the pool. */
  concepts: readonly string[]
}

/**
 * The shape of the state's real knowledge test. Data, not a constant, because
 * it is the one thing that genuinely differs between states: Maryland asks 25
 * and wants 22, and a state that asks 20 and wants 16 is not a code change.
 */
export interface ExamShape {
  /** Questions on one full run. */
  questions: number
  /** Correct answers needed to pass. */
  passMark: number
  /**
   * How long the agency gives for the real paper, in minutes -- absent where a
   * corpus records none, which is most of them.
   *
   * On the shape rather than read from `about` at the call site because it is a
   * rule of the exam, like the question count and the pass mark, and because
   * what offers the timed run has to know whether there is a limit to offer.
   */
  timeLimitMinutes?: number
  /**
   * The separately scored parts, when the state has them. Absent means one
   * part, which is what every state was before Virginia — and an absent
   * `sections` takes every code path it always took, rather than a
   * one-section list that merely computes the same answer.
   */
  sections?: readonly ExamSection[]
  /**
   * How the parts add up to a verdict. Absent means `'sections'`, which is
   * what Virginia -- the only sectioned state when sections were built -- is.
   *
   * Having parts does not say how the parts are scored, and the two states
   * that have them are scored differently. Virginia sets a bar on each part
   * and states no total: ten of ten signs, twenty-four of thirty general, and
   * the 34 in its corpus is the sum. New York sets a bar on the whole paper
   * and a minimum under one part: "at least 14 of the 20 questions asked, but
   * you must correctly answer two of the four questions about road signs".
   *
   * Flattening New York to 20 and 14 drops the sign minimum, and a learner who
   * misses all four signs and 14 of the other 16 is told they passed a paper
   * that has already failed them. Splitting it into two bars that sum to 14
   * invents a bar for part two -- 4 of 4 signs with 10 of 16 general is a New
   * York pass and would be refused here. Both teach the learner the wrong
   * exam, which is the one thing this app cannot do.
   *
   * Declared rather than inferred from whether the pass marks happen to sum to
   * the total. Virginia's do sum, so an inference would read a mistyped New
   * York corpus as Virginia's rule and be wrong in exactly the direction that
   * matters.
   */
  passRule?: PassRule
}

/**
 * Whether a sectioned paper is passed part by part or as a whole.
 *
 * - `'sections'` -- every part clears its own bar. The bar is the paper.
 * - `'total'` -- the whole paper clears `passMark` *and* every part clears its
 *   own floor. Both, not either.
 */
export type PassRule = 'sections' | 'total'

/**
 * What a state's corpus says about the test and where it came from, for the
 * page that tells a learner what to expect at the counter (#105).
 *
 * Every field is optional, because no two corpora agree beyond the question
 * count and the pass mark: Maryland records a time limit in minutes and a
 * count of languages, Virginia a sentence about each, Pennsylvania neither.
 * A page that printed an empty line for whichever state lacked a field
 * would be worse than one that said nothing, so each is null when absent and
 * the screen draws only what is there. The two number-shaped variants are
 * folded into their sentence form here, once, rather than on the screen.
 */
/**
 * Where one of the exam's two numbers came from.
 *
 * `'stated'` is the only one that quotes the state: the manual, the agency's
 * own site or its administrative code says the figure in words. `'derived'` is
 * arithmetic on something the state did state -- New Hampshire prints "if more
 * than 8 questions are answered incorrectly, the test will automatically end"
 * and never the pass mark, so 32 of 40 is a subtraction, not a quotation.
 * `'chosen'` is this app picking a number the state does not publish at all.
 */
export type FigureBasis = 'stated' | 'derived' | 'chosen'

/**
 * Which of the exam's two numbers this app is quoting and which it picked.
 *
 * Thirty-three of the fifty-one jurisdictions do not publish their knowledge
 * test's shape, and the two numbers fail differently. The pass mark is the
 * load-bearing one -- it decides whether a learner passes -- and most of those
 * states do publish it, in administrative code if not in the manual: Colorado's
 * 80% is 1 CCR 204-30-8 (402)(B)(4). The question count usually is not
 * published anywhere, and it decides only how long a practice run is.
 *
 * Holding both to the same standard is what kept those states unpublishable.
 * Recording the difference is what makes them publishable *honestly*: a state
 * whose count this app chose says so on its own page, in place of the claim
 * that its practice tests are shaped exactly like the real exam.
 *
 * Absent means both figures are quoted, which is what the thirteen states
 * published before this existed are -- so their pages are unchanged and no
 * corpus has to declare a field to keep saying what it already said.
 */
export interface ExamShapeBasis extends PartShapeBasis {
  /**
   * Where a paper scored in parts rests each part on a different footing, the
   * basis of each part that differs from the paper's, by section id. A part
   * not named here is on the paper's own footing.
   *
   * North Carolina is why. Its rule states the road-sign paper outright -- 9
   * of 12 -- and states only a rate for the knowledge paper, whose length this
   * app chose. Described as one paper that is `questions: 'chosen'`, every
   * screen would disown the 12 North Carolina does state and print a pass rate
   * over the total that North Carolina never set; described as
   * `questions: 'stated'`, the chosen length would be put in the state's
   * mouth. The fields above still describe the paper as a whole, because the
   * title, the paywall and the landing promise read only those and a total
   * with one chosen part is a chosen total; this is what lets the disclosure
   * say which part.
   */
  parts?: Readonly<Record<string, PartShapeBasis>>
}

/** One footing: where each of a paper's, or of one part's, two figures came from. */
export interface PartShapeBasis {
  /** The state either prints a count or it does not; there is nothing to derive it from. */
  questions: 'stated' | 'chosen'
  passMark: FigureBasis
  /**
   * The citation behind whichever figure is quoted or derived from -- the
   * manual page, the regulation, the agency page. Null only when both figures
   * were chosen, because then there is nothing to cite.
   */
  source: string | null
}

export interface StateAbout {
  agency: string | null
  manual: string | null
  /** When the corpus was last checked against the manual, as written in it. */
  updated: string | null
  passingScore: string | null
  timeLimit: string | null
  formats: readonly string[] | null
  languages: string | null
  /**
   * Provenance, deliberately here and not on `ExamShape`.
   *
   * `TestResult.exam` stores the whole shape on every run so that later data
   * cannot rewrite a result somebody already earned, and it is written by
   * spreading `state.exam`. A field on the shape would therefore be copied into
   * every stored result in every learner's browser for ever, to say something
   * about where a number came from that scoring never reads.
   */
  shapeBasis: ExamShapeBasis | null
}

export interface StateConfig {
  code: string
  name: string
  laws: readonly Law[]
  studyLaws: readonly Law[]
  poolLaws: readonly Law[]
  exam: ExamShape
  pictorialConcepts: readonly string[]
  licensingCategories: readonly string[]
  about: StateAbout
}

export interface StateCatalog {
  states: readonly StateConfig[]
  get(code: string): StateConfig | undefined
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

/** Zero is a value here, not a missing one: a part the manual sets no floor on. */
function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value
}

/** A string if the field is there, null if not, and a loud failure if it is something else. */
function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim() === '' ? null : value
}

function optionalStrings(value: unknown, label: string): string[] | null {
  if (value === undefined || value === null) return null
  return strings(value, label)
}

/**
 * The exam's provenance, refused rather than defaulted on anything unexpected.
 *
 * Every rule below is against a corpus that claims to quote the state and does
 * not. A misspelled `"stated"` silently reading as chosen would put a
 * disclaimer on a state that has no need of one; reading as stated would hide
 * one from a state that does. A `'chosen'` figure with a citation attached, or
 * a quoted one with none, is the same confusion written the other way round --
 * and the whole point of this block is that a reader can tell which numbers the
 * state stands behind.
 */
function partShapeBasis(value: unknown, label: string): PartShapeBasis {
  const entry = record(value, label)
  const questions = entry.questions
  if (questions !== 'stated' && questions !== 'chosen') {
    throw new Error(`${label}.questions must be "stated" or "chosen"`)
  }
  const passMark = entry.passMark
  if (passMark !== 'stated' && passMark !== 'derived' && passMark !== 'chosen') {
    throw new Error(`${label}.passMark must be "stated", "derived" or "chosen"`)
  }
  const source = optionalString(entry.source, `${label}.source`)
  const quoted = questions === 'stated' || passMark !== 'chosen'
  if (quoted && source === null) {
    throw new Error(`${label} quotes a figure and must cite where it is stated`)
  }
  if (!quoted && source !== null) {
    throw new Error(`${label} chose both figures, so there is nothing for source to cite`)
  }
  return { questions, passMark, source }
}

/**
 * How far a figure is from being the state's: a quoted figure, then
 * arithmetic on one, then this app's own pick.
 */
const OURS: Record<FigureBasis, number> = { stated: 0, derived: 1, chosen: 2 }

function examShapeBasis(
  value: unknown,
  code: string,
  sectionIds: readonly string[] | undefined,
  passRule: PassRule,
): ExamShapeBasis | null {
  if (value === undefined || value === null) return null
  const label = `${code}.metadata.knowledgeTest.shapeBasis`
  const entry = record(value, label)
  const paper = partShapeBasis(entry, label)
  const raw = entry.parts
  if (raw === undefined || raw === null) {
    // An all-quoted block describes exactly the state every corpus was before
    // this field existed, and would be the one spelling of "nothing to
    // disclose" that reads as a deliberate claim. Absent is how a state says
    // that. Asked only of a paper with no parts: one that declares parts is
    // held below to a part no weaker than itself, which no part can be.
    if (paper.questions === 'stated' && paper.passMark === 'stated') {
      throw new Error(`${label} says both figures are stated, which is what omitting it means`)
    }
    return paper
  }
  if (sectionIds === undefined) {
    throw new Error(`${label}.parts is set on a paper with no sections`)
  }
  // Under `'total'` a part's mark is a floor, not a bar, and the paper's bar
  // is the whole paper's own: the per-part disclosure would print a floor of
  // zero as "passes it at the 0%" and never mention the bar the state does
  // set. No state has that shape yet; the sentence can be written when one
  // does, and until then the parser refuses what the screens cannot say.
  if (passRule === 'total') {
    throw new Error(
      `${label}.parts is set on a paper scored on its total, whose parts carry floors rather than bars`,
    )
  }
  const parts = record(raw, `${label}.parts`)
  const ids = Object.keys(parts)
  if (ids.length === 0) throw new Error(`${label}.parts names no part`)
  const declared: Record<string, PartShapeBasis> = {}
  for (const id of ids) {
    if (!sectionIds.includes(id)) {
      throw new Error(`${label}.parts names ${id}, which is not a section of the paper`)
    }
    const part = partShapeBasis(parts[id], `${label}.parts.${id}`)
    // A part restated on the paper's own footing is the one spelling of "on
    // the paper's footing" that reads as a deliberate difference. Absent is
    // how a part says that.
    if (
      part.questions === paper.questions &&
      part.passMark === paper.passMark &&
      part.source === paper.source
    ) {
      throw new Error(`${label}.parts.${id} repeats the paper's own basis, which is what omitting it means`)
    }
    declared[id] = part
  }
  // The paper's basis is read alone by the title, the paywall and the landing
  // promise, so it has to be the weakest footing any part is on: a part
  // weaker than the paper is a chosen figure those surfaces would present as
  // the state's, and a paper weaker than every part is a disclosure about a
  // number nobody chose.
  for (const figure of ['questions', 'passMark'] as const) {
    for (const id of ids) {
      if (OURS[declared[id][figure]] > OURS[paper[figure]]) {
        throw new Error(
          `${label}.parts.${id}.${figure} is "${declared[id][figure]}" on a paper whose ${figure} is "${paper[figure]}"`,
        )
      }
    }
    const everyPart = sectionIds.every((id) => id in declared)
    if (everyPart && !ids.some((id) => declared[id][figure] === paper[figure])) {
      throw new Error(
        `${label}.${figure} is "${paper[figure]}" and no part of the paper is`,
      )
    }
  }
  return { ...paper, parts: declared }
}

/**
 * The about block, from whichever of the field spellings this corpus uses.
 *
 * `timeLimitMinutes` (a number) and `timeLimit` (a sentence) are the same fact
 * in two states' files, as are `languagesAvailable` and `languages`. Folded
 * here so that the screen has one field for each and a new corpus may use
 * either spelling.
 */
function stateAbout(
  metadata: Record<string, unknown>,
  knowledgeTest: Record<string, unknown>,
  code: string,
  sections: readonly ExamSection[] | undefined,
  passRule: PassRule,
): StateAbout {
  const label = `${code}.metadata`
  const minutes = knowledgeTest.timeLimitMinutes
  if (minutes !== undefined && (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0)) {
    throw new Error(`${label}.knowledgeTest.timeLimitMinutes must be a positive integer`)
  }
  const languageCount = knowledgeTest.languagesAvailable
  if (
    languageCount !== undefined &&
    (typeof languageCount !== 'number' || !Number.isInteger(languageCount) || languageCount <= 0)
  ) {
    throw new Error(`${label}.knowledgeTest.languagesAvailable must be a positive integer`)
  }
  return {
    agency: optionalString(metadata.licensingAgency, `${label}.licensingAgency`),
    manual: optionalString(metadata.sourceManual, `${label}.sourceManual`),
    updated: optionalString(metadata.updated, `${label}.updated`),
    passingScore: optionalString(knowledgeTest.passingScore, `${label}.knowledgeTest.passingScore`),
    timeLimit:
      typeof minutes === 'number'
        ? `${minutes} minutes`
        : optionalString(knowledgeTest.timeLimit, `${label}.knowledgeTest.timeLimit`),
    formats: optionalStrings(knowledgeTest.formats, `${label}.knowledgeTest.formats`),
    languages:
      typeof languageCount === 'number'
        ? `${languageCount} languages`
        : optionalString(knowledgeTest.languages, `${label}.knowledgeTest.languages`),
    shapeBasis: examShapeBasis(
      knowledgeTest.shapeBasis,
      code,
      sections?.map((section) => section.id),
      passRule,
    ),
  }
}

function laws(value: unknown, code: string): Law[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${code}.laws must be a non-empty array`)
  }
  return value as Law[]
}

/** Validated rather than defaulted on a typo: `passRule: 'sectons'` reading as
 *  `'sections'` would judge New York by Virginia's rule and pass the build. */
function examPassRule(value: unknown, code: string): PassRule {
  if (value === undefined) return 'sections'
  if (value !== 'sections' && value !== 'total') {
    throw new Error(
      `${code}.metadata.knowledgeTest.passRule must be 'sections' or 'total'`,
    )
  }
  return value
}

/**
 * The parts a state's paper is scored in, checked against the pool they draw
 * from.
 *
 * Every rule here is against a section list that looks right and silently
 * shrinks the exam. A pooled concept belonging to no section can never be
 * asked, so a fifth of the corpus could go dark with nothing to show for it. A
 * section naming a concept the corpus does not carry draws fewer questions
 * than it claims. And counts that do not sum to the declared totals leave the
 * two numbers stamped onto every stored result describing a different paper
 * from the one the learner sat.
 */
function examSections(
  value: unknown,
  code: string,
  exam: { questions: number; passMark: number },
  poolLaws: readonly Law[],
  passRule: PassRule,
): ExamSection[] | undefined {
  if (value === undefined) return undefined
  const label = `${code}.metadata.knowledgeTest.sections`
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`)
  }
  const pooled = new Set(poolLaws.map((law) => law.concept))
  const claimedBy = new Map<string, string>()
  const seen = new Set<string>()
  const sections = value.map((raw, index): ExamSection => {
    const entry = record(raw, `${label}[${index}]`)
    const id = nonEmptyString(entry.id, `${label}[${index}].id`)
    if (seen.has(id)) throw new Error(`${label} lists ${id} twice`)
    seen.add(id)
    const name = nonEmptyString(entry.name, `${label}.${id}.name`)
    const questions = positiveInteger(entry.questions, `${label}.${id}.questions`)
    // A zero is a part with no minimum, which only a paper scored on its total
    // can have: under `'sections'` a part with no bar is a part that cannot be
    // passed or failed, and the paper would be judged on the others alone.
    const passMark =
      passRule === 'total'
        ? nonNegativeInteger(entry.passMark, `${label}.${id}.passMark`)
        : positiveInteger(entry.passMark, `${label}.${id}.passMark`)
    if (passMark > questions) {
      throw new Error(`${label}.${id} pass mark cannot exceed its question count`)
    }
    const concepts = strings(entry.concepts, `${label}.${id}.concepts`)
    if (concepts.length === 0) throw new Error(`${label}.${id} must name a concept`)
    for (const concept of concepts) {
      if (!pooled.has(concept)) {
        throw new Error(`${label}.${id} names ${concept}, which no pooled law has`)
      }
      const owner = claimedBy.get(concept)
      if (owner !== undefined) {
        throw new Error(`${label} puts ${concept} in both ${owner} and ${id}`)
      }
      claimedBy.set(concept, id)
    }
    const own = new Set(concepts)
    const available = poolLaws.filter((law) => own.has(law.concept)).length
    if (available < questions) {
      throw new Error(`${label}.${id} has ${available} pooled laws for ${questions} questions`)
    }
    return { id, name, questions, passMark, concepts }
  })
  const orphans = [...pooled].filter((concept) => !claimedBy.has(concept))
  if (orphans.length > 0) {
    throw new Error(`${label} leaves ${orphans.join(', ')} in no section`)
  }
  const sum = (pick: (section: ExamSection) => number) =>
    sections.reduce((total, section) => total + pick(section), 0)
  // True under both rules: the parts are the whole paper either way, so a run
  // drawn per section has to come to the length the state asks.
  if (sum((section) => section.questions) !== exam.questions) {
    throw new Error(`${label} question counts do not sum to ${exam.questions}`)
  }
  const marks = sum((section) => section.passMark)
  if (passRule === 'total') {
    // Floors that already sum past the paper's own bar mean the bar is not the
    // binding constraint and can never be the thing a run fails on -- which is
    // a manual transcribed into the wrong rule, not an exotic exam.
    if (marks > exam.passMark) {
      throw new Error(
        `${label} floors sum to ${marks}, above the ${exam.passMark} the whole paper needs`,
      )
    }
  } else if (marks !== exam.passMark) {
    throw new Error(`${label} pass marks do not sum to ${exam.passMark}`)
  }
  return sections
}

/** Convert external JSON into the only state shape production code can use. */
/**
 * One state's corpus, validated into the shape the screens read.
 *
 * Split out of `createStateCatalog` when states stopped arriving together
 * (#247): the catalog is now filled one state at a time, as each is picked, so
 * the per-state work had to become callable on its own. Every check it makes is
 * the check it made when it ran over all of them at once.
 */
export function createStateConfig(code: string, unknownEntry: unknown): StateConfig {
  const entry = record(unknownEntry, code)
  const metadata = record(entry.metadata, `${code}.metadata`)
  const name = metadata.stateName
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${code}.metadata.stateName must be a non-empty string`)
  }
  const knowledgeTest = record(
    metadata.knowledgeTest,
    `${code}.metadata.knowledgeTest`,
  )
  const minutes = knowledgeTest.timeLimitMinutes
  const exam = {
    questions: positiveInteger(
      knowledgeTest.questions,
      `${code}.metadata.knowledgeTest.questions`,
    ),
    passMark: positiveInteger(
      knowledgeTest.passMark,
      `${code}.metadata.knowledgeTest.passMark`,
    ),
    // Optional, and validated when present rather than coerced: a corpus
    // recording `"twenty"` should stop the build rather than quietly offer a
    // run that expires immediately.
    ...(minutes === undefined
      ? {}
      : {
          timeLimitMinutes: positiveInteger(
            minutes,
            `${code}.metadata.knowledgeTest.timeLimitMinutes`,
          ),
        }),
  }
  if (exam.passMark > exam.questions) {
    throw new Error(`${code} pass mark cannot exceed its question count`)
  }
  const allLaws = laws(entry.laws, code)
  const poolLaws = allLaws.filter((law) => law.inPool)
  if (poolLaws.length < exam.questions) {
    throw new Error(`${code} question pool cannot fill its exam`)
  }
  const passRule = examPassRule(knowledgeTest.passRule, code)
  if (knowledgeTest.passRule !== undefined && knowledgeTest.sections === undefined) {
    // A rule for combining parts, on a paper with no parts, is a corpus that
    // believes it declared sections and did not -- and it would be judged by
    // the plain total either way, so nothing would ever surface the mistake.
    throw new Error(
      `${code}.metadata.knowledgeTest.passRule is set on a paper with no sections`,
    )
  }
  const sections = examSections(knowledgeTest.sections, code, exam, poolLaws, passRule)
  const signImagery = record(metadata.signImagery, `${code}.metadata.signImagery`)
  const pictorialConcepts = strings(
    signImagery.pictorialConcepts,
    `${code}.metadata.signImagery.pictorialConcepts`,
  )
  /**
   * Which of this corpus's categories hold its licensing facts, said by the
   * corpus rather than guessed by the app.
   *
   * This was five words in a const here, and they were load-bearing without
   * anything saying so. On 2026-09-07 `ec30e74` rebuilt West Virginia from its
   * handbook and renamed `learners-permit` and `licensing` to `permit` and
   * `testing` -- a correct rewrite of the citations, and it emptied "Getting
   * your West Virginia permit" for eight days. Every corpus contract stayed
   * green, because `category` is free text and nothing looked at a real
   * state's landing page. Virginia and Pennsylvania drifted the same way
   * without an empty section to show for it: theirs rendered, filled by other
   * laws, while the permit material sat under a word the list never knew.
   *
   * Declared, that rename cannot be silent. A category named here that no law
   * uses throws below, at load, naming the state -- so the next rebuild that
   * renames a word either updates this line or does not start.
   */
  const licensingCategories = strings(
    metadata.licensingCategories,
    `${code}.metadata.licensingCategories`,
  )
  const present = new Set(allLaws.map((law) => law.category))
  for (const category of licensingCategories) {
    if (!present.has(category)) {
      throw new Error(
        `${code}.metadata.licensingCategories names "${category}", which no ${code} law uses`,
      )
    }
  }
  const conceptOrder = new Map<string, number>()
  for (const law of allLaws) {
    if (!conceptOrder.has(law.concept)) conceptOrder.set(law.concept, conceptOrder.size)
  }
  /**
   * The pass teaches every law a test can ask, grouped by concept.
   *
   * It used to teach one anchor per concept -- 38 of Maryland's 185 -- on the
   * reasoning that the on-ramp should be short and the test loop would drill
   * the rest. The test loop does not: a cap reserves part of every run for
   * revision, so only 15 new laws appear per run after the first, and a
   * learner reaches Prepared having met 55 of 185. The other 130 were first
   * encountered as questions in a paper, which is both worse teaching than
   * showing them and reads to a learner as the app being broken.
   *
   * A stable sort by first appearance of the concept, because Maryland's
   * corpus leaves and rejoins four of its concepts and a walk that returned
   * to parking eighty cards later would undo the grouping this exists for.
   * Everything else is corpus order, which is authored: related laws sit
   * together already, which is what makes `studySections` below able to
   * chunk on a count without reading the laws.
   */
  const studyLaws = poolLaws
    .map((law, index) => ({ law, index }))
    .sort(
      (a, b) =>
        (conceptOrder.get(a.law.concept) ?? 0) - (conceptOrder.get(b.law.concept) ?? 0) ||
        a.index - b.index,
    )
    .map(({ law }) => law)
  return {
    code,
    name,
    laws: allLaws,
    studyLaws,
    poolLaws,
    // Spread only where there are sections, so an unsectioned state's shape
    // is the object it has always been rather than one carrying `undefined`.
    // `passRule` is spread only where the corpus declared one, for the same
    // reason one level down: Virginia's shape is byte-identical to what it was
    // before this field existed, so no stored result grows a field describing
    // the rule it was already being judged by.
    exam:
      sections === undefined
        ? exam
        : knowledgeTest.passRule === undefined
          ? { ...exam, sections }
          : { ...exam, sections, passRule },
    pictorialConcepts,
    licensingCategories,
    about: stateAbout(metadata, knowledgeTest, code, sections, passRule),
  }
}

/**
 * A whole product's corpus at once, keyed by state code.
 *
 * The application no longer builds one of these -- it fills the catalog a state
 * at a time. This remains because a corpus record is still the natural thing to
 * hand a test, and `sections.test.ts` and `state-catalog.test.ts` both assert
 * against one.
 */
export function createStateCatalog(input: unknown): StateCatalog {
  const root = record(input, 'state corpus')
  const states = Object.entries(root).map(([code, entry]) => createStateConfig(code, entry))
  if (states.length === 0) throw new Error('state corpus must contain a state')
  const byCode = new Map(states.map((state) => [state.code, state]))
  return { states, get: (code) => byCode.get(code) }
}

/**
 * The states this app can teach, and the ones whose laws have actually arrived.
 *
 * Two collections because they answer two questions, and only one of them is
 * expensive. `open` is the product the app is showing: its state list is the
 * manifest's, which is kilobytes and present from the first byte, so the picker
 * and every screen that needs a state's *name* works without fetching anything.
 * `loaded` is the states whose corpus has been fetched -- hundreds of kilobytes
 * each -- and it fills one state at a time as they are picked.
 *
 * Before #247 there was one collection and it held everything, because every
 * corpus was in the bundle. Seven states made that 1.95 MB decoded on a first
 * visit, most of it for states the learner will never open.
 *
 * The accessors below stay synchronous, which is the property worth protecting:
 * nothing that renders a law has to survive not having the laws yet. What pays
 * for that is `openState` being awaited before a screen for that state renders
 * -- at boot in src/main.tsx for the state the URL names, and on selection in
 * App.tsx. Reading a law for a state nobody loaded throws, and says which state
 * and what to await, because a screen with nothing on it and no explanation is
 * the failure this app keeps being bitten by.
 */
let open: { id: string; states: readonly StateOption[] } | null = null
const loaded = new Map<string, StateConfig>()
/**
 * The same states with their Spanish pack laid over them, for the ones that
 * have been opened in Spanish. Kept beside the English rather than in place of
 * it: the flow holds English laws and every decision is made on them, and a
 * screen asks for the Spanish text of one law by id (`spanishLaw`) only when
 * it is about to show it.
 */
const loadedSpanish = new Map<string, Map<string, Law>>()
/** Each opened pack's concept labels, by state (docs/plans/spanish-md.md, §9). */
const loadedConcepts = new Map<string, Record<string, string>>()

/**
 * Open a product: make its state list readable, and fetch no laws.
 *
 * Awaited before the first render -- see src/main.tsx, and tests/unit/setup.ts,
 * which boots the suite the same way. It no longer fetches a corpus, but it
 * stays async because callers await it and because whether the manifest itself
 * is bundled is not a promise this function should be making.
 */
export async function openProduct(productId: string): Promise<void> {
  const product = productRegistry.get(productId)
  if (product === undefined) throw new Error(`Unknown product: ${productId}`)
  open = {
    id: productId,
    states: product.states.map(({ code, name }) => ({ code, name })),
  }
  loaded.clear()
  loadedSpanish.clear()
  loadedConcepts.clear()
}

/**
 * Fetch one state's laws and make them readable, if they are not already.
 *
 * Idempotent and safe to call on every selection: a second call for a state
 * already here does nothing, so the screens can await it without tracking what
 * they have asked for. It deliberately does not race -- two overlapping calls
 * for the same state fetch twice and the second wins with identical data, which
 * costs a duplicate request in a case a learner cannot produce by tapping.
 */
export async function openState(productId: string, stateCode: string): Promise<void> {
  if (open === null || open.id !== productId) await openProduct(productId)
  if (loaded.has(stateCode)) return
  loaded.set(stateCode, createStateConfig(stateCode, await loadCorpus(productId, stateCode)))
}

/**
 * Fetch a state's Spanish pack and lay it over the English, if not already here.
 *
 * Validated by the same `createStateConfig` the English goes through, so the
 * Spanish version of a state is refused on exactly the terms the English one
 * would be, and `overlayPack` has already refused a pack that moves an answer.
 */
export async function openSpanish(productId: string, stateCode: string): Promise<void> {
  if (open === null || open.id !== productId) await openProduct(productId)
  if (loadedSpanish.has(stateCode)) return
  const overlaid = await loadCorpus(productId, stateCode, 'es')
  const config = createStateConfig(stateCode, overlaid)
  loadedConcepts.set(stateCode, (overlaid as { concepts?: Record<string, string> }).concepts ?? {})
  loadedSpanish.set(stateCode, new Map(config.laws.map((law) => [law.id, law])))
}

/** Whether a state's laws are here, for a screen deciding between content and a wait. */
export function isStateLoaded(stateCode: string): boolean {
  return loaded.has(stateCode)
}

/** Whether a state's Spanish pack has been laid over its laws. */
export function isSpanishLoaded(stateCode: string): boolean {
  return loadedSpanish.has(stateCode)
}

/**
 * One law as the Spanish pack has it, or undefined when that state's pack is
 * not loaded. Looked up by id, which is the one thing a pack cannot change.
 */
export function spanishLaw(stateCode: string, id: string): Law | undefined {
  return loadedSpanish.get(stateCode)?.get(id)
}

/**
 * A concept's Spanish label from the state's pack, or undefined when that
 * pack is not loaded. The id is still what every decision reads.
 */
export function spanishConcept(stateCode: string, id: string): string | undefined {
  return loadedConcepts.get(stateCode)?.[id]
}

function openProductOrThrow(): { id: string; states: readonly StateOption[] } {
  if (open === null) throw new Error('No product is open: openProduct was never awaited')
  return open
}

/**
 * One loaded state, or a throw naming what was never awaited.
 *
 * The message matters more than it looks. The old failure was one message for
 * every cause -- no product open -- and with states arriving separately the
 * common mistake became rendering a state whose laws are still in flight. Those
 * want different fixes, so they say different things.
 */
function loadedState(stateCode: string): StateConfig | undefined {
  openProductOrThrow()
  return loaded.get(stateCode)
}

/**
 * Why a state is not readable, said precisely.
 *
 * A state the manifest never named and a state whose laws have not been
 * fetched are different mistakes -- the first is a bad code, the second is a
 * missing `await openState`. One message for both sent the reader hunting for a
 * typo that was not there.
 */
function unloaded(stateCode: string): string {
  const known = openProductOrThrow().states.some((state) => state.code === stateCode)
  return known
    ? `State ${stateCode} is not loaded: await openState() before reading its laws`
    : `Unknown state: ${stateCode}`
}

export interface StateOption {
  code: string
  name: string
}

export function getStates(): StateOption[] {
  return openProductOrThrow().states.map(({ code, name }) => ({ code, name }))
}

export function getLaws(stateCode: string): Law[] {
  return [...(loadedState(stateCode)?.laws ?? [])]
}

/**
 * The laws the study pass teaches: the primary anchor of each concept, in the
 * order the concepts appear in the data.
 *
 * This is deliberately the shortest pass that still covers every concept. The
 * study pass is only the on-ramp — the mastery-weighted test loop is what
 * actually drills a learner, so reaching it sooner is worth more than extra
 * up-front reading. The rank-2 anchors are not lost: they stay in the question
 * pool, and a learner who misses one is shown its law and re-asked it.
 */
export function getStudyLaws(stateCode: string): Law[] {
  return [...(loadedState(stateCode)?.studyLaws ?? [])]
}

/** The laws a test may draw from: everything except licensing paperwork and trivia. */
export function getPoolLaws(stateCode: string): Law[] {
  return [...(loadedState(stateCode)?.poolLaws ?? [])]
}

/**
 * The state's exam shape, from its own metadata.
 *
 * There is intentionally no fallback. The catalog rejects a state lacking its
 * own exam shape before the application can display or score it.
 */
export function getExamShape(stateCode: string): ExamShape {
  const state = loadedState(stateCode)
  if (state === undefined) throw new Error(unloaded(stateCode))
  return state.exam
}

/** What the corpus says about the test and its source. Throws for an unknown state, like `getExamShape`. */
export function getAbout(stateCode: string): StateAbout {
  const state = loadedState(stateCode)
  if (state === undefined) throw new Error(unloaded(stateCode))
  return state.about
}

/**
 * The laws about getting and holding a permit, in corpus order. Pool or not.
 *
 * The categories come from the state's own metadata, never from a list here;
 * see `licensingCategories` in the loader for the eight days that rule cost.
 * A state that declares none renders no permit section, which is the right
 * answer for New York and Ohio -- neither corpus carries permit material, and
 * an empty declaration says so where an empty section could not.
 */
export function getLicensingLaws(stateCode: string): Law[] {
  const declared = new Set(loadedState(stateCode)?.licensingCategories ?? [])
  return getLaws(stateCode).filter((law) => declared.has(law.category))
}

/**
 * The concepts whose whole point is recognizing a sign on sight, and which
 * therefore must carry artwork rather than describe it in words. Per state,
 * because a state is free to name and cut its concepts differently.
 */
export function getPictorialConcepts(stateCode: string): string[] {
  return [...(loadedState(stateCode)?.pictorialConcepts ?? [])]
}

export function countConcepts(laws: readonly Law[]): number {
  return new Set(laws.map((law) => law.concept)).size
}

/**
 * The most laws one section of the pass may hold.
 *
 * A section is the unit a learner actually finishes, so it has to be a sitting
 * rather than an achievement: six laws is about three minutes, which survives a
 * bus ride. Maryland's median concept is four laws and 32 of its 38 fit under
 * this untouched; only warning signs (17) and signs by description (16) get
 * cut. Raising it to twelve would halve the number of pauses and double the
 * length of the thing nobody can put down halfway.
 */
export const SECTION_MAX = 6

/**
 * Which section a card belongs to, and where in it -- the shape
 * `passSectionAt` in src/flow.ts answers with.
 *
 * The pass counts 185 laws in Maryland and 329 in Virginia, and a bar against
 * either is a wall on the first card: the number arrives before the learner
 * has answered anything. A section is four laws on average, so a bar against
 * one fills every couple of minutes and is never far from done, while the
 * section number carries the position the bar no longer shows. Both halves are
 * needed -- a bar that counted sections alone would sit still for four cards
 * at a time, which punishes exactly the answering it should reward.
 */
export interface SectionPosition {
  /** Which section this is, 1-based, for "section 3 of 46". */
  index: number
  /** How many sections the pass holds. */
  total: number
  /** Index into the pass of this section's first law. */
  start: number
  /** How many laws this section holds. */
  length: number
  /** How far into this section the given law sits, 0-based. */
  position: number
}

/**
 * Where the pass pauses, as indices into `studyLaws`.
 *
 * Derived from the corpus rather than authored, so a fifth state gets sections
 * by having laws and nobody maintains a list that can drift out of step with
 * one. A section ends where the concept changes, or after SECTION_MAX laws of
 * the same concept -- and the mechanical cut lands well because corpus order is
 * authored: Maryland's seventeen warning signs fall into what is ahead at an
 * intersection, then the shape of the road, then surface hazards, with nobody
 * having decided that.
 *
 * Returns the index of the first law of each section *after* the first, which
 * is exactly "the boundaries a walk crosses". `passBoundaries` in src/flow.ts
 * is what the reducer asks, and it returns this list whenever the course in
 * use is the full one.
 *
 * **There is no `sectionAt` beside this any more, deliberately.** It answered
 * "which section is this card in, and where in it" off these boundaries alone,
 * which is the right answer only for the course that walks every card.
 * `passSectionAt` asks the same question of the course the learner is actually
 * on, and it is the only thing that should: a new screen reaching for a
 * corpus-level answer would silently draw full-course sections over a pass
 * walking six anchors to a section (docs/plans/short-course.md, section 5).
 */
export function sectionBoundaries(laws: readonly Law[]): number[] {
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
