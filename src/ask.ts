/**
 * What the two ask routes answer with, in one place because two bundles read
 * it.
 *
 * The study app's Partner screen calls `/api/partners/ask` and the portal calls
 * `/api/partner/ask`; they are separate handlers on purpose (see
 * worker/src/partner-api.ts) and they answer in the same shape, so the box that
 * draws the answer is one component rather than two that drift.
 */
export interface AskAnswer {
  /** An entry id, or `no-match`. */
  id: string
  /** Verbatim from worker/src/knowledge-base.md. Absent on a no-match. */
  answer?: string
  /** What proves it -- an agreement section, or a symbol in the worker. */
  cite?: string | null
  /** The published document that citation points at, where a visitor can open one. */
  citeUrl?: string | null
  /** Present exactly when nothing matched: an address a person reads. */
  contact?: string
  /**
   * The learner's box only (worker/src/learner-api.ts). On an answer, the
   * sections of the book it rests on, so the page can link the ones that name a
   * page; on a refusal of scope, the worker's own line saying where the answer
   * actually is, and the link it points at.
   */
  sources?: { id: string; title: string; page: string | null }[]
  pointer?: string
  pointerHref?: string | null
  /**
   * The learner's box, on a road-law answer: the manual citations of the laws
   * it was written from, verbatim from the corpus, drawn the way the cards draw
   * them (docs/plans/learner-ask-law.md, decision 5). `asOf`, where the
   * worker sent one, is the date the law was true as of, shown under it
   * (docs/plans/trusted-by-date.md, decision 7).
   */
  citations?: { id: string; location: string; kind?: 'statute' | 'penalty' | 'process'; state?: string; asOf?: string }[]
  /**
   * A nationwide answer only: the states with no rule on what it compared,
   * by name, from the worker's topic files rather than the model's sentence
   * (docs/plans/nationwide.md, decision 10). `state` above names whose law
   * each citation is.
   */
  absent?: string[]
  /** A road-law question with no state chosen: offer the picker, not an answer. */
  chooseState?: boolean
  /** True on a second consecutive miss, when offering to try again is no help. */
  handOff?: boolean
  /** A refusal -- the challenge, the turn cap, the length cap. */
  error?: string
  /**
   * The learner's box, on a question paid for with a code: what the code has
   * left after it (docs/plans/trusted-by-date.md, decision 24).
   */
  tokens?: { left: number }
  /**
   * The code could not pay (HTTP 402): nothing was asked, and the page opens
   * the purchase pop-up with the question still in the input.
   */
  buy?: boolean
  /**
   * The rest of the written answers, when a question spanned more than one
   * domain and more than one was returned.
   *
   * Only the mesh path ever sets this. "What if a refund comes after you've
   * paid me" is a refunds question *and* a money question, and answering half
   * of it is the failure the whole aggregate-don't-route design exists to
   * avoid -- so a second answer is carried to the screen rather than dropped at
   * the last hop.
   */
  also?: { id: string; answer: string; cite?: string | null; citeUrl?: string | null }[]
  /**
   * Figures a live query returned, in the words the query itself produced.
   *
   * Never composed. There is no turn on which a model sees these, which is why
   * they arrive as lines rather than as prose.
   */
  figures?: { tool: string; lines: string[] }[]
  /**
   * Domains that could not be reached, named rather than hidden.
   *
   * One dead server does not take the mesh down; it takes a domain out of the
   * answer, and somebody reading half an answer is owed the fact that it is
   * half.
   */
  unavailable?: string[]
}

/**
 * The box's own words, for the surface that has a language. The partner pages
 * pass nothing and get the English the box has always had.
 */
export interface AskLabels {
  label: string
  placeholder: string
  button: string
  asking: string
  waiting: string
  trouble: string
  noMatch: string
  handOff: string
  writeTo: string
  reads: string
  readMore: string
  /** The text of the link a road-law refusal points at. */
  statePage: string
  /** The control that opens the state picker when no state is chosen. */
  chooseState?: string
  /** How a statute citation is introduced: it is the state's law, and not in the manual. */
  inTheLaw?: (reference: string) => string
  /** How a road-law answer's citation is introduced; the card's own words. */
  inTheManual?: (page: string) => string
  /** The control under a citation that opens the card teaching that law. */
  card?: string
  /** The link under a nationwide refusal, to the page listing what the states are compared on. */
  comparePage?: string
  /** The line naming the states with no rule under a nationwide answer. */
  absent?: (names: string) => string
  /** The control that opens the citations folded after the first few. */
  moreStates?: (count: number) => string
  /** The line under a citation saying the date its law was true as of, from an ISO date. */
  asOf?: (date: string) => string
  /** The one line under a road-law answer naming its documents, before the tap that shows the law (src/sources-line.ts). */
  sourcesLine?: (documents: string) => string
  /** The manual on that line: the state's, where one is being answered for, and its pages. */
  manualSource?: (state: string | null, pages: string) => string
  /** A nationwide answer's line: the states whose laws it cites, the first two by name. */
  statesSources?: (states: readonly string[]) => string
  /** The control that unfolds the citations under that line, and folds them again. */
  showLaw?: string
  hideLaw?: string
  /** The line an earlier exchange folds to, read aloud as what a tap on it does. */
  showAnswer?: string
  hideAnswer?: string
  /** The control on each exchange that takes it out of the thread, read aloud. */
  deleteQuestion?: string
  /** The control under the newest exchange that shows the `count` earlier ones, and the one that hides them again. */
  showEarlier?: (count: number) => string
  showLess?: string
}

/**
 * One exchange of the learner's thread as this device keeps it: the question,
 * the answer exactly as it was drawn, and what it was asked for.
 */
export interface AskThreadEntry {
  question: string
  answer: AskAnswer
  /** A chip's stored answer: `state` for one state's, true for the nationwide row's. */
  chip?: true | 'state'
  /** The state code it was answered for, `US` for nationwide, null with no state chosen. */
  state: string | null
  /** ISO time it was asked, or tapped. */
  askedAt: string
  /** The conversation it was asked in, which is what the worker reads the earlier turns back by. */
  conversation?: string
}

/** Kept in step with MAX_QUESTION_CHARS in worker/src/ask.ts, which enforces it. */
export const MAX_QUESTION_CHARS = 500
