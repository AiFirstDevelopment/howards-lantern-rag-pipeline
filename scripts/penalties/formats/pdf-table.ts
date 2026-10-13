/**
 * A schedule printed as a table, read through `pdftotext -layout`: one row an
 * offence, its title, section and paragraph in their own columns, a dotted
 * leader, the preset fine (or "MA", must appear) and the points. Maryland's
 * DC-CR-090 is this shape:
 *
 *   16   112 c      Failure of individual driving on hwy. to display lic. to uniformed police on
 *                   demand ..............................................    $ 50.00 00     00
 *
 * An offence can wrap over several lines; a row's first fine ends its
 * offence. A section can also print several fines under one heading, each on
 * its own indented line -- § 21-801.1's speed bands, "1 to 9 mph … $ 80.00 01"
 * then "10 to 19 mph … $ 90.00 02" and on to "40 mph and over … $ 530.00 06",
 * or a right-of-way section's "If violation contributes to an accident that
 * results in (Death …)" -- and each of those is a row of its own, its offence
 * the heading's words and its own. Read as one row, Maryland lost ninety: a
 * learner asking about fifteen over was given the $80 for one to nine.
 *
 * The columns after the first fine and points are the figures when the
 * violation contributed to an accident, and are read only where the first
 * pair is empty (the "contributes to death" lines print their fine there).
 *
 * Only rows that begin with a one- or two-digit title are read, which is the
 * Transportation Article's layout; the federal regulations printed at the end
 * ("393.95 a1i …") have no title column and are not a section of the state's
 * code, so no statute row could join them anyway. A row that begins and never
 * prints a fine is proposed with no figure, so the fetch names it rather than
 * leaving it out unsaid.
 */
import { cents, type Candidate, type Format, type PenaltySource } from '../source'

// The paragraph column is letters and digits ("c", "a2iii", "e15") or, in a
// few sections (§ 21-1125), a bare number of one or two digits.
const ROW_START = /^\s*(\d{1,2})\s+(\d+[A-Z]?(?:\.\d+)?)(?:\s+([a-z][a-z0-9]*|\d{1,2}[a-z]*))?\s+(\S.*)$/
const CONTINUED = /^\s{6,}\S/
const ROW_END = /(\$\s*[\d,]+\.\d\d|\bMA\b)\s+(\d\d)\b/
/** A heading longer than this many lines is not a heading: Maryland's longest, § 21-901.2's list of aggressive-driving offences, is fourteen. */
const MAX_LINES = 30

/** "a2iii" as "(a)(2)(iii)": the schedule runs a paragraph's parts together, the code prints each in parentheses. */
export function paragraphOf(para: string | undefined): string {
  if (para === undefined) return ''
  return (para.match(/[a-z]+|\d+/g) ?? []).map((part) => `(${part})`).join('')
}

/** An offence's words: dot leaders and white space out. */
const words = (text: string) => text.replace(/\s*\.{2,}\s*/g, ' ').replace(/\s+/g, ' ').trim()

export const pdfTable: Format = {
  urls: (source) => [source.url],
  rows(pages, source: PenaltySource) {
    const text = pages.get(source.url)
    if (text === undefined) return []
    if (source.cite === undefined) throw new Error(`a pdf-table source needs "cite": ${source.title}`)
    const cite = source.cite
    const lines = text.split('\n')
    const out: Candidate[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const start = ROW_START.exec(lines[index])
      if (start === null) continue
      const [, title, section, para, rest] = start
      const head = rest.trimEnd()
      const code = `${title}-${section}${paragraphOf(para)}`
      const row = (offence: string, quote: string, end: RegExpExecArray): Candidate => {
        const fine = end[1]
        const mustAppear = fine === 'MA'
        const amount = mustAppear ? null : cents(fine)
        return {
          section: cite.replace('{section}', `${title}-${section}`),
          code,
          offence,
          fine_text: mustAppear ? 'must appear' : fine.replace(/\s+/g, ''),
          fine_min_cents: amount,
          fine_max_cents: amount,
          points: Number(end[2]),
          appear: mustAppear ? 'must-appear' : 'payable',
          quote,
          url: source.url,
        }
      }
      // `base`: the offence's own words, up to its first fine or the first
      // line that introduces a group of fines. `group`: the latest such line
      // ("Exceeding posted speed limit by:", "If (operating, towing) a
      // commercial veh.:"). `band`: the words since the last fine. `quoted`:
      // the raw lines since the last fine, which is what each row quotes.
      const base: string[] = []
      let group: string | null = null
      let band: string[] = []
      let quoted: string[] = [lines[index].trim()]
      let fined = false
      let last = index
      for (let at = index; at < lines.length && at < index + MAX_LINES; at += 1) {
        // A wrapped offence goes on in the offence column, indented; a line
        // at the margin is a page header or the next table, and an offence
        // that reached one has ended -- never merged with a regulation's
        // "$ 70.00" from the page after.
        if (at > index && (ROW_START.test(lines[at]) || !CONTINUED.test(lines[at]))) break
        const line = at === index ? head : lines[at].trim()
        if (at > index) quoted.push(line)
        last = at
        const end = ROW_END.exec(line)
        if (end === null) {
          if (/:\s*$/.test(line)) {
            group = line
            band = []
          } else if (!fined && group === null) base.push(line)
          else band.push(line)
          continue
        }
        const before = line.slice(0, end.index)
        let offence: string
        if (!fined && group === null) {
          base.push(before)
          offence = words(base.join(' '))
        } else offence = words([...base, group ?? '', ...band, before].join(' '))
        quoted[quoted.length - 1] = quoted[quoted.length - 1].slice(0, quoted[quoted.length - 1].length - line.length) + line.slice(0, end.index + end[0].length)
        out.push(row(offence, quoted.join(' '), end))
        fined = true
        band = []
        quoted = []
      }
      if (!fined) {
        const pending = [...base, group ?? '', ...band]
        out.push({
          section: cite.replace('{section}', `${title}-${section}`),
          code,
          offence: words(pending.join(' ')),
          fine_text: '',
          fine_min_cents: null,
          fine_max_cents: null,
          points: null,
          appear: 'payable',
          quote: lines[index].trim(),
          url: source.url,
          unread: `no fine is printed within ${MAX_LINES} lines of its start`,
        })
      }
      index = last
    }
    return out
  },
}
