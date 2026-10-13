/**
 * A schedule printed one offence to a row, read through `pdftotext -layout`
 * by a pattern the registry gives for the row: the shape most court
 * schedules share, whatever their columns. California's Uniform Bail and
 * Penalty Schedule,
 *
 *   12951      (a)      A           No Valid License in Possession            35      40  …  247     2a
 *
 * Vermont's waiver schedule ("CV  23 611  Possession of license certificate
 * 2 PL 47.00 1,197.00 59.00"), New Hampshire's uniform fines, Montana's bond
 * schedule and a dozen more differ only in which column is the section, which
 * the figure, and whether a row's figure waits for its offence to wrap onto a
 * second line (Connecticut's Chart A prints it on the last). Maryland's
 * DC-CR-090 keeps its own adapter (`pdf-table`): its bands under one heading
 * are a shape of their own, and its 1,408 rows are held to it by test.
 *
 * Every pattern is the registry's, so a schedule that changes its layout is a
 * registry edit and a fixture, not a new adapter. What the adapter promises
 * whatever the pattern: the quote is the row's own printed words from its
 * reference to its figure, so the check finds it in the page or the row is
 * named; a row whose figure is not printed where the pattern looks is
 * proposed with none and named (`unread`), never left out unsaid; and a
 * reference that is not a section of the state's code (a federal
 * regulation, a chapter) is named rather than joined to the wrong law.
 */
import { normalized, type Candidate, type Format, type PenaltySource } from '../source'

/** How a `pdf-rows` schedule's rows read. Every pattern is a regular expression's source. */
export interface RowLayout {
  /** Text the table begins after (its first occurrence), so the preface's examples are not read as rows. */
  after?: string
  /** Text the table ends before, looked for after `after`. */
  before?: string
  /**
   * Where each column of a page printed in side-by-side columns begins, in
   * characters (Alaska's Rule 43.1 prints two): each column is read as a
   * page of its own, top to bottom.
   */
  split?: number[]
  /**
   * A row's first line. Named groups: `code` (the reference as printed,
   * required unless `codes`), and any of `para` (a subsection printed in a
   * column of its own), `offence`, `fine`, `total`, `points`, `variant`.
   */
  start: string
  /** Where a row's figure is printed when its first line has none: tried on each following line. Named groups `fine`, `total`, `points`. */
  end?: string
  /** How many lines after the first a row's figure or wrapped offence may run. Default 4. */
  within?: number
  /** For a row that cites several sections ("[G.S. 20-7; G.S. 20-11]"): each match's first group is a reference, and the row is proposed once for each. */
  codes?: string
  /** The columns, [from, to), a wrapped offence's further lines are read from, so a neighbouring column's words never join it. */
  wrap?: [number, number]
  /** Which figure the row's fine is: what the schedule says is paid in all (`total`) where it prints one, else the fine. Default `fine`. */
  figure?: 'fine' | 'total'
  /** The fine's words, from the figures, any named group by its name: "{total} in all, a {fine} fine and the court's costs". Default "{fine}" (or "{total}"). */
  fineText?: string
  /** A figure cell that means the learner must go to court ("MA", "MUST APPEAR", "Court"). */
  mustAppear?: string
  /** A schedule that prints a class letter for the figure, and the page's own words that give each class its amount ("B = $100.00"). */
  classes?: Record<string, string>
  /** Words added to the offence for a `variant` cell (California's "B": the fee when the violation is corrected). */
  variants?: Record<string, string>
  /**
   * A line that heads a run of rows ("SPEED (65 mph limit)" over New
   * Hampshire's five speeding bands): its first group is put before the
   * offence of each row under it while they print the same reference as the
   * first, so three "Speeding 11-15 over limit" rows at $93, $186 and $248
   * are three offences a learner can tell apart, not one row and two named
   * as duplicates.
   */
  heading?: string
  /**
   * `until-next`: a heading names every row under it until the next, for a
   * schedule whose rows print a section and figures and no offence of their
   * own (Colorado's § 42-4-1701(4)(a)(I): "(A) Driver's license violations:"
   * over "42-2-101 $ 35.00 $ 10.00").
   */
  headings?: 'same-reference' | 'until-next'
  /**
   * Rows whose printed figure is not a fine, and why: a pattern tried on the
   * row's quote. Vermont prints its speeding rows' waiver as dollars per mile
   * an hour over ("1-10 MPH over speed limit … 5.00"); read as the fine, a
   * learner fifteen over would be told $6.
   */
  unread?: { pattern: string; reason: string }[]
  /**
   * Where a row's reference sits in its cell, for a schedule whose long
   * offences print words above the reference: `centred` (New Jersey's: words
   * above and below) or `bottom` (Vermont's and Montana's: every line between
   * two rows is the lower row's). See `aboveAndBelow`.
   */
  cell?: 'centred' | 'bottom'
  /** The state's citation for a section, "{section}" for the reference without its subsections; any other named group by its name ("{title} V.S.A. § {section}"). */
  cite: string
  /** The section within a reference: the first group of this pattern. Default: the reference with its trailing parenthesised parts removed. */
  section?: string
  /** Default `payable`. */
  appear?: Candidate['appear']
}

const MONEY = /^\$?\s*\d[\d,]*(?:\.\d\d)?$/

/** "1,197.00", "$ 250", "475" as cents; null where the cell is not a figure. */
export function amount(cell: string | undefined): number | null {
  if (cell === undefined || !MONEY.test(cell.trim())) return null
  const [whole, part] = cell.replace(/[$\s,]/g, '').split('.')
  return Number(whole) * 100 + (part === undefined ? 0 : Number(part))
}

/** A figure as a learner reads it: "$247", "$1,197.00". */
export function money(cell: string): string {
  const bare = cell.replace(/[$\s]/g, '')
  return `$${bare}`
}

/** "46.2-1078.1(A)(2)" as "46.2-1078.1": the section is the reference without its subsections. */
function sectionOfReference(code: string, pattern: string | undefined): string | null {
  if (pattern !== undefined) return new RegExp(pattern).exec(code)?.[1] ?? null
  const section = code.replace(/(?:\s*\([^()]*\))+\s*$/, '').trim()
  return section === '' ? null : section
}

/** A line's text in the column a wrapped offence goes on in, or null where the line does not go on there. */
function wrapped(line: string, wrap: [number, number] | undefined): string | null {
  if (line.trim() === '') return null
  if (wrap === undefined) return /^\s{4,}\S/.test(line) ? line.trim() : null
  const first = line.search(/\S/)
  // A line that begins well left or right of the offence column is a page
  // header, a footnote or the next table, never the offence going on.
  if (first < wrap[0] - 4 || first > wrap[0] + 4) return null
  const text = line.slice(wrap[0] - 4, wrap[1]).trim()
  return text === '' ? null : text
}

const words = (text: string) => text.replace(/\s*\.{2,}\s*/g, ' ').replace(/\s+/g, ' ').trim()

/** A row as the page prints it, before it is read into a candidate. */
interface Printed {
  /** The lines the row's own words run over, first and last. */
  first: number
  last: number
  groups: Record<string, string | undefined>
  quote: string
  offence: string[]
  /** The heading over it, where one applies. */
  heading: string | null
}

export function rowsOf(text: string, layout: RowLayout, source: Pick<PenaltySource, 'url'>): Candidate[] {
  const from = layout.after === undefined ? 0 : text.indexOf(layout.after)
  if (from < 0) return []
  const until = layout.before === undefined ? -1 : text.indexOf(layout.before, from)
  const pageLines = text.slice(from, until < 0 ? undefined : until).split('\n')
  const streams = layout.split === undefined
    ? [pageLines]
    : layout.split.map((at, index) => pageLines.map((line) => line.slice(at, layout.split![index + 1])))
  const page = normalized(text)
  const out: Candidate[] = []
  for (const lines of streams) for (const row of printed(lines, layout)) out.push(...candidates(row, layout, page, source.url))
  return out
}

/** One column's rows, each with its own lines' words, a centred cell's words above and below it, and the heading over it. */
function printed(lines: readonly string[], layout: RowLayout): Printed[] {
  const start = new RegExp(layout.start)
  const end = layout.end === undefined ? null : new RegExp(layout.end)
  const heading = layout.heading === undefined ? null : new RegExp(layout.heading)
  const within = layout.within ?? 4
  const rows: Printed[] = []
  let over: { words: string; reference: string | null } | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const head = heading?.exec(lines[index])
    if (head !== null && head !== undefined) {
      over = { words: head[1].trim(), reference: null }
      continue
    }
    const found = start.exec(lines[index])
    if (found === null) continue
    const groups = { ...found.groups } as Record<string, string | undefined>
    const line = lines[index]
    const row: Printed = { first: index, last: index, groups, quote: line.slice(found.index, found.index + found[0].length), offence: [groups.offence ?? ''], heading: null }
    if (groups.fine === undefined && groups.total === undefined && end !== null) {
      for (let at = index + 1; at <= index + within && at < lines.length; at += 1) {
        if (lines[at].trim() === '' || start.test(lines[at])) break
        const closing = end.exec(lines[at])
        if (closing === null) {
          const more = wrapped(lines[at], layout.wrap)
          if (more !== null) row.offence.push(more)
          continue
        }
        Object.assign(groups, Object.fromEntries(Object.entries(closing.groups ?? {}).filter(([, value]) => value !== undefined)))
        row.offence.push(lines[at].slice(0, closing.index).trim())
        // The row as the page prints it: the first line from the reference
        // on, every line between, the last up to its figure.
        row.quote = [line.slice(found.index), ...lines.slice(index + 1, at), lines[at].slice(0, closing.index + closing[0].length)].join(' ')
        row.last = at
        break
      }
    }
    if (layout.cell === undefined) {
      for (let at = row.last + 1; at <= row.last + within && at < lines.length; at += 1) {
        if (start.test(lines[at]) || (end !== null && end.test(lines[at])) || (heading !== null && heading.test(lines[at]))) break
        const more = wrapped(lines[at], layout.wrap)
        if (more === null) break
        row.offence.push(more)
        row.last = at
      }
    }
    if (over !== null) {
      // A row that cites its own section (Washington's "Failure to stop (RCW
      // 46.61.050)") is out from under the heading before it.
      const reference = (groups.code ?? (layout.codes === undefined ? undefined : new RegExp(layout.codes).exec(row.quote)?.[1]) ?? '').trim()
      if (over.reference === null) over.reference = reference
      if (layout.headings === 'until-next' || over.reference === reference) row.heading = over.words
      else over = null
    }
    rows.push(row)
    index = row.last
  }
  if (layout.cell !== undefined) aboveAndBelow(rows, lines, layout, start, heading)
  return rows
}

/**
 * A schedule that prints a long offence's words above its reference. Where
 * the reference is centred in its cell (New Jersey's), the lines between two
 * rows are shared: the upper half is the row above going on, the lower half
 * the row below beginning -- an odd line goes down, because a two-line cell
 * prints its reference on the second. Where it sits at the bottom of its
 * cell (Vermont's, Montana's), every line between two rows is the lower
 * row's: split in half, Montana's "Operating a Commercial MV Without Proper"
 * went to the second-offence row above it. Read as following lines only,
 * Vermont's "Use of Portable Electronic Device Outside Work or School / Zone
 * - 1st Violation" was given to the row before it. Either way the words stop
 * at a blank line, a heading, or a line outside the offence column.
 */
function aboveAndBelow(rows: Printed[], lines: readonly string[], layout: RowLayout, start: RegExp, heading: RegExp | null): void {
  const within = layout.within ?? 4
  const bottom = layout.cell === 'bottom'
  rows.forEach((row, at) => {
    const floor = at === 0 ? Math.max(-1, row.first - within - 1) : rows[at - 1].last
    const ceiling = at === rows.length - 1 ? Math.min(lines.length, row.last + within + 1) : rows[at + 1].first
    const between = (from: number, to: number) => {
      const run: number[] = []
      for (let index = from; index < to; index += 1) run.push(index)
      return run
    }
    const above = between(floor + 1, row.first)
    const upper: string[] = []
    for (const index of above.slice(bottom ? 0 : Math.floor(above.length / 2)).reverse()) {
      if (start.test(lines[index]) || (heading !== null && heading.test(lines[index]))) break
      const more = wrapped(lines[index], layout.wrap)
      if (more === null) break
      upper.unshift(more)
    }
    const below = bottom ? [] : between(row.last + 1, ceiling)
    const lower: string[] = []
    for (const index of below.slice(0, Math.floor(below.length / 2))) {
      if (start.test(lines[index]) || (heading !== null && heading.test(lines[index]))) break
      const more = wrapped(lines[index], layout.wrap)
      if (more === null) break
      lower.push(more)
    }
    row.offence = [...upper, ...row.offence, ...lower]
  })
}

/** A printed row as the candidates it proposes: one, or one for each section a row cites. */
function candidates(row: Printed, layout: RowLayout, page: string, url: string): Candidate[] {
  const { groups, quote } = row
  const within = layout.within ?? 4
  const variant = groups.variant?.trim()
  const named = words([row.heading ?? '', ...row.offence].join(' ') + (variant !== undefined && layout.variants?.[variant] !== undefined ? layout.variants[variant] : ''))
  const cited = (words: string) => (layout.codes === undefined ? [] : [...words.matchAll(new RegExp(layout.codes, 'g'))].map((each) => each[1]))
  // A row that cites no section of its own is of the section its heading
  // cites: Washington's "Over 40 m.p.h. over limit $188" under "Speed (RCW
  // 46.61.400)".
  const own = cited(`${quote} ${row.offence.join(' ')}`)
  const references = layout.codes === undefined ? [groups.code ?? ''] : own.length > 0 ? own : cited(row.heading ?? '')
  const out: Candidate[] = []
  // A row that cites no section (Washington's "No Valid Driver's License
  // (With Identification) $250", under a chapter heading) is still a row the
  // schedule prints: named, not dropped unsaid.
  if (references.length === 0) references.push('')
  for (const reference of [...new Set(references.map((each) => each.trim()))]) {
    const code = [reference, groups.para?.trim(), variant].filter((part) => part !== undefined && part !== '').join(' ')
    const section = sectionOfReference(reference, layout.section)
    const figure = (layout.figure === 'total' ? groups.total : undefined) ?? groups.fine ?? groups.total
    const base: Candidate = {
      section: section === null ? '' : layout.cite.replace(/\{(\w+)\}/g, (whole, name: string) => (name === 'section' ? section : (groups[name]?.trim() ?? whole))),
      code,
      offence: named,
      fine_text: '',
      fine_min_cents: null,
      fine_max_cents: null,
      points: groups.points !== undefined && /^\d+$/.test(groups.points.trim()) ? Number(groups.points.trim()) : null,
      appear: layout.appear ?? 'payable',
      quote,
      url,
    }
    if (section === null) {
      out.push({ ...base, unread: `"${reference}" is not a section of the state's code` })
      continue
    }
    // A cell centred on its reference can leave a row with none of its own words (New
    // Jersey's): a fine under no offence is a figure for nobody knows what.
    if (named === '') {
      out.push({ ...base, unread: 'no offence is printed with it' })
      continue
    }
    const excluded = layout.unread?.find((each) => new RegExp(each.pattern).test(quote))
    if (excluded !== undefined) {
      out.push({ ...base, unread: excluded.reason })
      continue
    }
    if (figure === undefined) {
      out.push({ ...base, unread: `no figure is printed within ${within} lines of its start` })
      continue
    }
    const cell = figure.trim()
    if (layout.mustAppear !== undefined && new RegExp(`^(?:${layout.mustAppear})$`).test(cell)) {
      out.push({ ...base, fine_text: 'must appear', appear: 'must-appear' })
      continue
    }
    if (layout.classes !== undefined && amount(cell) === null) {
      const said = layout.classes[cell]
      const printedAmount = said === undefined ? null : /\$\s*[\d,]+(?:\.\d\d)?/.exec(said)
      // The class's amount is the page's word too: a letter whose amount the
      // page no longer prints is a figure nobody published.
      if (said === undefined || printedAmount === null || !page.includes(normalized(said))) {
        out.push({ ...base, unread: `class "${cell}" has no amount the page prints` })
        continue
      }
      const cents = amount(printedAmount[0])
      out.push({ ...base, fine_text: `${money(printedAmount[0])} (class ${cell})`, fine_min_cents: cents, fine_max_cents: cents })
      continue
    }
    const cents = amount(cell)
    if (cents === null || cents === 0) {
      // Montana prints "$0" for a first violation that is a warning: a $0
      // fine told to a learner is a fine that does not exist.
      out.push({ ...base, unread: cents === 0 ? 'the figure printed is $0' : `"${cell}" is not a figure` })
      continue
    }
    const fineText = (layout.fineText ?? (layout.figure === 'total' ? '{total}' : '{fine}')).replace(/\{(\w+)\}/g, (whole, name: string) =>
      groups[name] === undefined ? whole : money(groups[name]!.trim()),
    )
    out.push({ ...base, fine_text: fineText, fine_min_cents: cents, fine_max_cents: cents })
  }
  return out
}

export const pdfRows: Format = {
  urls: (source) => [source.url],
  rows(pages, source: PenaltySource) {
    const text = pages.get(source.url)
    if (text === undefined) return []
    if (source.layout === undefined) throw new Error(`a pdf-rows source needs "layout": ${source.title}`)
    return rowsOf(text, source.layout, source)
  },
}
