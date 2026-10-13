import type { AskAnswer } from './ask'
import { manualReference } from './citation'

type Citation = NonNullable<AskAnswer['citations']>[number]

/**
 * What one line under a road-law answer names, before the learner taps for
 * the law itself.
 *
 * Joel's high-beam question on 2026-10-11 was answered in two sentences and
 * then five citation paragraphs, each with the law's quoted text and its own
 * "as of" line: the manual, two subsections of one section, and two rows of
 * one fine schedule. "This is for teenagers. They're not gonna want all
 * this." So the citations fold to one line naming the documents -- the
 * manual once with its pages, a code section once however many of its
 * subsections were cited, a schedule once by its title, a state's page once
 * by its agency and title -- and the paragraphs are one tap away, unchanged.
 */
export type SourcesLine =
  | { kind: 'documents'; documents: SourceDocument[]; asOf: string | null }
  | { kind: 'states'; states: string[]; asOf: string | null }

export type SourceDocument =
  | { kind: 'manual'; pages: string[] }
  | { kind: 'law'; name: string }

export function sourcesLine(citations: readonly Citation[]): SourcesLine | null {
  if (citations.length === 0) return null
  // One date, the earliest, and only when every row has one: a line that
  // dated four rows and silently not the fifth would claim a check of the
  // fifth that nobody made (docs/plans/trusted-by-date.md, decision 7).
  const dates = citations.map((citation) => citation.asOf)
  const asOf = dates.every((date): date is string => date !== undefined) ? [...dates].sort()[0] : null
  // A nationwide answer cites eight states' laws; naming eight manuals and
  // codes on one line is the paragraph list again, so it names the states.
  if (citations.some((citation) => citation.state !== undefined)) {
    const states = [...new Set(citations.flatMap((citation) => (citation.state === undefined ? [] : [citation.state])))]
    return { kind: 'states', states, asOf }
  }
  const documents: SourceDocument[] = []
  const laws = new Set<string>()
  let manual: { kind: 'manual'; pages: string[] } | null = null
  for (const citation of citations) {
    if (citation.kind === undefined) {
      if (manual === null) {
        manual = { kind: 'manual', pages: [] }
        documents.push(manual)
      }
      const page = manualReference({ source: 'manual:', location: citation.location }).page
      for (const each of page === null ? [] : page.replace(/^pp?\./i, '').split(',')) {
        if (each !== '' && !manual.pages.includes(each)) manual.pages.push(each)
      }
      continue
    }
    const name = documentOf(citation)
    if (laws.has(name)) continue
    laws.add(name)
    documents.push({ kind: 'law', name })
  }
  manual?.pages.sort((left, right) => parseInt(left, 10) - parseInt(right, 10))
  return { kind: 'documents', documents, asOf }
}

/**
 * The document a code, schedule or page citation is from: its reference
 * before the quoted words, and for a code row that reference less its
 * parenthesised tail -- the section, as `sectionOf` in
 * worker/src/law-nationwide.ts derives it for the `laws` table, so
 * § 22-223(b) and § 22-223(c) are one entry, Md. Code, Transp. § 22-223.
 */
function documentOf(citation: Citation): string {
  const quoted = citation.location.indexOf(' — ')
  const reference = quoted < 0 ? citation.location : citation.location.slice(0, quoted)
  if (citation.kind !== 'statute') {
    // Everything before the quoted words names the document: a state's own
    // page is "<agency> — <title> — '<passage>'", and six states' schedule
    // titles hold a dash of their own ("The 2026 Florida Statutes — 318.18
    // Amount of penalties."), which a cut at the first dash shortened to
    // "The 2026 Florida Statutes" and Connecticut's to "CHART A".
    const split = /^(.+?) — ['‘][\s\S]+['’]$/.exec(citation.location)
    return split === null ? reference : split[1]
  }
  const section = reference
    .replace(/,\s*subd\..*$/, '')
    .replace(/(?:\s*[–-]?\s*\([^()]*\))+[\s–-]*$/, '')
    .trim()
  return section === '' ? reference : section
}

/** The manual's pages as a reader writes them: "p. 27", "pp. 27, 32". */
export function pagesText(pages: readonly string[]): string {
  if (pages.length === 0) return ''
  const plural = pages.length > 1 || /[–-]/.test(pages[0])
  return `${plural ? 'pp.' : 'p.'} ${pages.join(', ')}`
}
