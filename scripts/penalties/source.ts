/**
 * What a state's penalty source is, what an adapter makes of it, and the one
 * check every row passes before it is written (docs/plans/what-happens-if.md,
 * phase 2, decisions 10 and 11). Apart from fetch.ts so the adapters and the
 * monthly refresh read the same types without importing the network.
 */
import type { PenaltyRow } from '../../worker/src/law-nationwide'
import type { RowLayout } from './formats/pdf-rows'

export type { PenaltyRow, RowLayout }

export const SOURCES_FILE = 'resource/penalties/SOURCES.json'
export const PENALTIES_DIR = 'resource/penalties'

/**
 * The adapter that reads a source, by its shape: a schedule printed as a PDF
 * table (Maryland's DC-CR-090), a list of rows written into the registry and
 * checked against the statute or page they quote, an HTML table, or `none`
 * for a state registered with no rows yet -- `local`, whose answer is the
 * code's range, already in the `laws` table. `pdf-rows` is the court
 * schedule printed one offence to a row, read by the pattern the entry gives
 * (`layout`): most states' schedules are that shape with different columns.
 */
export type FormatName = 'pdf-table' | 'pdf-rows' | 'statute-list' | 'html-table' | 'none'

/** A row written into the registry by hand and checked against the fetched text: `statute-list`, and a `local` state's ranges. */
export interface ListedRow {
  /** The section as the `laws` table keys it: "Tex. Transp. Code § 521.025". */
  section: string
  /** The source's own reference for the row, which the id is made from: "521.025(c)". */
  code: string
  offence: string
  /** The figure as the source prints it: "$50.00", "not to exceed $200". */
  fine: string
  min?: number | null
  max?: number | null
  points?: number | null
  appear: PenaltyRow['appear']
  /** The source's own words, verbatim; checked as a substring of what was fetched. */
  quote: string
  /** The page the quote is on, where it is not the entry's `url`. */
  url?: string
  /** The name the citation gives that page, where it is not the entry's `title`: a Texas range quoted from § 545.4251 is not "Chapter 542". */
  title?: string
}

/** How an HTML table's columns read, for `html-table`. */
export interface TableLayout {
  /** Text that occurs in the table wanted and in no earlier one on the page. */
  after?: string
  columns: { code: number; offence: number; fine: number; points?: number }
  /** The state's citation for a code cell's section, "{section}" for the cell with its subsection removed. */
  cite: string
}

export interface PenaltySource {
  kind: 'schedule' | 'code' | 'local'
  url: string
  title: string
  agency: string
  retrieved: string
  format: FormatName
  /** The edition or effective date, as the source states it. */
  effective?: string | null
  /** `code` and `local`: the section that holds the fines or the range, as the `laws` table keys it. */
  section?: string | null
  /** Where points come from: the schedule's own column, the code's points section, or null. */
  points?: string | null
  /** `pdf-table`: the state's citation for a schedule section, "{section}" for "16-112". */
  cite?: string
  /** `statute-list` and `local`: the rows, each checked against the page it quotes. */
  rows?: ListedRow[]
  /** `html-table`: how its columns read. */
  table?: TableLayout
  /** `pdf-rows`: the pattern a row is printed in. */
  layout?: RowLayout
  /**
   * Where a person saves the source when its site refuses scripts
   * (`resource/penalties/sources/MO/<name>.pdf`): read in place of `url`
   * when present, and `url` is still what the rows cite.
   */
  file?: string
  /** What the discovery pass looked at, so a `local` entry says why it is not `schedule`. */
  looked: string
}

/** A row as an adapter proposes it, before the quote is checked: the page it came from, no date yet. */
export interface Candidate {
  section: string
  code: string
  offence: string
  fine_text: string
  fine_min_cents: number | null
  fine_max_cents: number | null
  points: number | null
  appear: PenaltyRow['appear']
  quote: string
  url: string
  /** The citation's name for the page, where it is not the source's title. */
  title?: string
  /** Why the adapter found a row it could not read: never written, always named. */
  unread?: string
}

export interface Format {
  /** The pages this source's rows are read from and checked against. */
  urls(source: PenaltySource): string[]
  /** The rows the pages hold, as the adapter reads them. Pure: a fixture page in, rows out. */
  rows(pages: ReadonlyMap<string, string>, source: PenaltySource): Candidate[]
}

/** A row that was not written, and why: printed by the fetch, so a dropped figure is named rather than missing. */
export interface Rejected {
  code: string
  section: string
  quote: string
  reason: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

/**
 * A page's text as a quote is checked against it: an HTML page's tags
 * dropped and its entities read, a schedule's dot leaders ("demand
 * .............. $ 50.00") taken out, and every run of white space one space.
 * Leaders and line breaks are typesetting -- pdftotext lays the same row out
 * with a different number of dots at a different width -- and a check that
 * read them would reject a row for its column width. Nothing else is
 * forgiven: not a digit, not a letter, not case.
 */
export function normalized(text: string): string {
  const html = /<(?:html|body|table|tr|td|p|div)\b/i.test(text)
  const plain = html
    ? text
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) =>
          name.startsWith('#x') || name.startsWith('#X')
            ? String.fromCodePoint(parseInt(name.slice(2), 16))
            : name.startsWith('#')
              ? String.fromCodePoint(parseInt(name.slice(1), 10))
              : (ENTITIES[name.toLowerCase()] ?? whole),
        )
    : text
  return plain.replace(/\s*\.{3,}\s*/g, ' ').replace(/[\s ]+/g, ' ').trim()
}

/** The law id a schedule row is given as: the state, `P`, and the source's own reference with every run of punctuation one dash. */
export function penaltyId(state: string, code: string): string {
  return `${state}-P-${code.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}

/**
 * The rows that may be written: each quote a substring of the page it names,
 * read as `normalized` reads both. A row whose quote is not there is not
 * written, and is named in `rejected` with the words it claimed -- a schedule
 * whose fine moved from $50 to $70 since the registry was written must not
 * keep saying $50 under the schedule's name. So is a second row with the same
 * section and offence (the table's key), and a second use of an id.
 */
export function verified(
  state: string,
  candidates: readonly Candidate[],
  pages: ReadonlyMap<string, string>,
  source: Pick<PenaltySource, 'title'>,
  asOf: string,
): { rows: PenaltyRow[]; rejected: Rejected[] } {
  const texts = new Map<string, string>()
  const rows: PenaltyRow[] = []
  const rejected: Rejected[] = []
  const keys = new Set<string>()
  const ids = new Map<string, number>()
  for (const candidate of candidates) {
    const page = pages.get(candidate.url)
    if (page !== undefined && !texts.has(candidate.url)) texts.set(candidate.url, normalized(page))
    const text = texts.get(candidate.url)
    const quote = normalized(candidate.quote)
    const where = { code: candidate.code, section: candidate.section, quote }
    if (text === undefined) {
      rejected.push({ ...where, reason: `its page was not fetched: ${candidate.url}` })
      continue
    }
    if (candidate.unread !== undefined) {
      rejected.push({ ...where, reason: candidate.unread })
      continue
    }
    if (quote === '' || !text.includes(quote)) {
      rejected.push({ ...where, reason: 'its quote is not in the fetched text' })
      continue
    }
    // Two paragraphs of a section can print the same words ("If violation
    // contributes to an accident …" under § 21-403(b), (c) and (d)): each is
    // its own row, told apart by the schedule's reference. The same words
    // under the same reference twice is one row printed twice.
    let offence = candidate.offence
    if (keys.has(`${candidate.section}\u0000${offence}`)) offence = `${offence} (${candidate.code})`
    const key = `${candidate.section}\u0000${offence}`
    if (keys.has(key)) {
      rejected.push({ ...where, reason: 'a second row with the same section and offence' })
      continue
    }
    keys.add(key)
    const base = penaltyId(state, candidate.code)
    const seen = (ids.get(base) ?? 0) + 1
    ids.set(base, seen)
    rows.push({
      id: seen === 1 ? base : `${base}-${seen}`,
      state,
      section: candidate.section,
      code: candidate.code,
      offence,
      fine_text: candidate.fine_text,
      fine_min_cents: candidate.fine_min_cents,
      fine_max_cents: candidate.fine_max_cents,
      points: candidate.points,
      appear: candidate.appear,
      source_url: candidate.url,
      source_title: candidate.title ?? source.title,
      as_of: asOf,
      quote,
    })
  }
  return { rows, rejected }
}

/** "$ 1,050.00" as cents; null where it is not a figure. */
export function cents(text: string): number | null {
  const found = /\$\s*([\d,]+)(?:\.(\d\d))?/.exec(text)
  if (found === null) return null
  return Number(found[1].replace(/,/g, '')) * 100 + (found[2] === undefined ? 0 : Number(found[2]))
}
