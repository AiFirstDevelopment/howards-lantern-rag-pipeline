import type { Citation } from './data/laws'

/**
 * The manual reference a learner is shown when they get a question wrong.
 *
 * Every law in every state carries exactly one citation, and all 1,028 of them
 * are written the same way: `p.21 (printed) — 'the manual's own sentence'`.
 * That format is the corpus's convention rather than a schema anything
 * enforces, so this parses it defensively and hands back the whole string when
 * it does not recognize the shape. A citation rendered verbatim looks slightly
 * scruffy; a citation silently dropped because the next state wrote `page 21`
 * takes the app's central claim off the screen and nothing goes red.
 *
 * "(printed)" is dropped on the way through. It distinguishes the number
 * printed on the page from the PDF's own page index -- a distinction that
 * exists for whoever checks the corpus against the file, and that a learner
 * holding the booklet does not have.
 */
export interface ManualReference {
  /** `p.21`, or null when the location does not name one. */
  page: string | null
  /** The manual's own words, unquoted. Null when the location carries none. */
  quote: string | null
  /** The location exactly as the corpus wrote it, for the fallback render. */
  raw: string
}

const MANUAL = /^manual:/
const PAGE = /^\s*(pp?\.\s*[\d–-]+(?:\s*,\s*[\d–-]+)*)/i
// Straight quotes are what the corpus uses; the curly pair is accepted because
// one edit through a word processor is all it takes to introduce them.
const QUOTE = /['‘“]([\s\S]+)['’”]\s*$/

/**
 * The first citation that points at the state's own manual, or null.
 *
 * Filtered by source rather than taken as `citations[0]`, because
 * how-to-build-laws.md admits sources that are not the manual -- the agency's
 * test page, the statute -- and a screen that says "in the manual" over a
 * statute citation is telling the learner something untrue about where to look.
 */
export function manualCitation(citations: readonly Citation[] | undefined): Citation | null {
  return citations?.find((citation) => MANUAL.test(citation.source)) ?? null
}

export function manualReference(citation: Citation): ManualReference {
  const raw = citation.location.trim()
  const page = PAGE.exec(raw)?.[1].replace(/\s+/g, '') ?? null
  // Only the part after the page reference is searched for the quote, so a
  // location that is *all* quotation cannot have its opening mark matched
  // against a stray apostrophe earlier in the same string.
  //
  // Nothing strips the `(printed)` that sits between the two, and nothing needs
  // to: QUOTE anchors on the quotation marks themselves, so whatever separates
  // them from the page reference is never inside the match. A strip was written
  // here first and deleted when breaking it changed no test and no output --
  // code that guards nothing is worse than no code, because the next reader
  // believes it.
  const rest = page === null ? raw : raw.slice(PAGE.exec(raw)![0].length)
  const quote = QUOTE.exec(rest)
  return { page, quote: quote?.[1].trim() ?? null, raw }
}
