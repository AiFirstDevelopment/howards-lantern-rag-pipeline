/**
 * A schedule published as an HTML table: one `<tr>` an offence, with the
 * section, the offence, the fine and (where printed) the points in cells the
 * registry names by position. The quote is the row's cells in order, which is
 * what the page reads as once its tags are dropped -- so the check finds it
 * there, and a row the adapter misread (a fine taken from the wrong cell) is
 * still a row whose words are the page's.
 */
import { cents, normalized, type Candidate, type Format, type PenaltySource } from '../source'
import { amount } from './pdf-rows'

/** "46.2-1078.1(A)(2)" as "46.2-1078.1": the section is the reference without its subsections. */
export function sectionOfCode(code: string): string {
  return code.replace(/(?:\s*\([^()]*\))+\s*$/, '').trim()
}

export const htmlTable: Format = {
  urls: (source) => [source.url],
  rows(pages, source: PenaltySource): Candidate[] {
    const page = pages.get(source.url)
    const layout = source.table
    if (page === undefined) return []
    if (layout === undefined) throw new Error(`an html-table source needs "table": ${source.title}`)
    const from = layout.after === undefined ? 0 : page.indexOf(layout.after)
    if (from < 0) return []
    const out: Candidate[] = []
    for (const [, row] of page.slice(from).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => normalized(`<p>${cell}</p>`))
      const { code: codeAt, offence: offenceAt, fine: fineAt, points: pointsAt } = layout.columns
      const code = cells[codeAt]
      const fine = cells[fineAt]
      // Rhode Island's § 31-41.1-4 prints "100.00" with no dollar sign.
      const figure = fine === undefined ? null : (cents(fine) ?? amount(fine))
      if (code === undefined || cells[offenceAt] === undefined || figure === null || !/\d/.test(code)) continue
      // Rhode Island prints some cells as "Not less than $100.00 or more than
      // $500.00": one figure read from it is a fine nobody set. Named, not
      // written.
      const several = (fine!.match(/\$?\(?\d[\d,]*(?:\.\d\d)?\)?/g) ?? []).filter((each) => /\d\.\d\d|\$/.test(each)).length > 1
      const points = pointsAt === undefined ? null : /^\d+$/.test(cells[pointsAt] ?? '') ? Number(cells[pointsAt]) : null
      out.push({
        section: layout.cite.replace('{section}', sectionOfCode(code)),
        code,
        offence: cells[offenceAt],
        fine_text: /^[\d,]+(?:\.\d\d)?$/.test(fine!) ? `$${fine}` : fine!,
        fine_min_cents: figure,
        fine_max_cents: figure,
        points,
        appear: 'payable',
        quote: cells.filter((cell) => cell !== '').join(' '),
        ...(several ? { unread: `the fine cell prints more than one figure: "${fine}"` } : {}),
        url: source.url,
      })
    }
    return out
  },
}
