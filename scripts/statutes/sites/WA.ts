/**
 * Washington: the Revised Code of Washington as the Statute Law Committee's
 * Code Reviser publishes it for the Legislature at app.leg.wa.gov. A
 * chapter-page `enumerate`: every chapter is also served whole on one page
 * (`/RCW/default.aspx?cite=46.61&full=true`, the chapter page's "Complete
 * Chapter" link), each section in it opening on `<a name='46.61.570'>`, then
 * "RCW 46.61.570", its catchline, its body, and its history in brackets. A
 * section's URL is its chapter's full page with the section number as
 * fragment, so fetch.ts reads each page once per run.
 *
 * robots.txt: app.leg.wa.gov, leg.wa.gov and lawfilesext.leg.wa.gov all answer
 * `/robots.txt` with a 404, so no rule names any agent or path, and no
 * Crawl-delay is asked; the fetch's own second between requests stands.
 *
 * **What is in effect.** A section amended for a later date is served twice
 * under one anchor, each copy repeating "RCW <number>" and its catchline ending
 * in an italic note: "(Effective until January 1, 2028.)" and "(Effective
 * January 1, 2028.)". `extract` keeps the copy with no note, or the one in force
 * until a date ("Effective until …", "Expires …"), and never one that takes
 * effect on a date or a contingency ("Effective <date>", "Contingent effective
 * date"). A section with no copy in force -- 46.61.734, the intelligent speed
 * assistance device, enacted "(Effective January 1, 2029.)" -- is reported as
 * unavailable and committed as nothing. So is a section amended twice in one
 * session "without reference to the other" (RCW 1.12.025): the page serves
 * each version, notes "(as amended by 2025 c 175)", and in bill form, struck
 * words in "((…))" beside the underlined words that replace them. No one copy
 * of it is the text in force, so none is committed: 46.19.010, 46.20.155 and
 * 46.20.2892 as of October 2026.
 *
 * Washington labels its subsections "(1)", "(a)", "(i)", "(A)", each paragraph
 * its own `<div>`, so a line per paragraph is the code's own layout; a table is
 * a line per row, its cells joined by a space. What is dropped: the catchline
 * (the listing's heading, and a long one would be filed as law) with its
 * effective-date and amendment notes (editors' marks, not words of the law), the
 * history in brackets that closes each section ("[ 2025 c 137 s 1; …]"), and
 * the "NOTES:" after it -- findings, intent, severability and effective-date
 * provisions of the session laws, which the Code Reviser prints and the
 * Legislature did not codify.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://app.leg.wa.gov/RCW/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 46, and why: 46.01,
 * the Department of Licensing; 46.08, the code's general provisions on state
 * property and agency powers; 46.09, 46.10, off-road vehicles and snowmobiles,
 * which are recreation off the road; 46.17 and 46.18, the fee schedules and
 * special plates; 46.21, 46.22 and 46.23, the interstate compacts and the
 * department's records; 46.25, the commercial licence, which every state so
 * far has left out because its permit and alcohol rules crowd out the
 * ordinary ones; 46.32, 46.44 and 46.48, commercial vehicle inspection, size
 * and weight, and hazardous materials, which bind carriers; 46.35, recording
 * devices; 46.53 and 46.55, abandoned vehicles and towing companies; 46.66
 * and 46.68, the theft prevention authority and revenue; 46.70 to 46.87,
 * dealers, repair shops, for-hire carriers, driving and traffic schools,
 * wreckers and fleet registration; 46.90, the model traffic ordinance, which
 * binds only the cities that adopt it; 46.92 to 46.98, autonomous vehicle
 * testing, dealer franchises and construction. Washington codifies impaired
 * driving, vehicular homicide and the intermediate licence's limits in Title
 * 46 itself; a minor's possession of liquor is RCW 66.44.270.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; keep?: (section: string) => boolean }[] = [
  { chapter: '46.04', id: 'rcw46.04', name: 'Chapter 46.04 RCW: Definitions', why: 'what the code means by a vehicle, a moped, a highway, a crosswalk or a driver' },
  { chapter: '46.12', id: 'rcw46.12', name: 'Chapter 46.12 RCW: Certificates of title', why: 'the title every owner must hold, and what to report when a vehicle is sold' },
  { chapter: '46.16A', id: 'rcw46.16A', name: 'Chapter 46.16A RCW: Registration', why: 'registration and plates every owner must hold and display' },
  { chapter: '46.19', id: 'rcw46.19', name: 'Chapter 46.19 RCW: Special parking privileges for persons with disabilities', why: 'the disabled parking placard and who may use it' },
  { chapter: '46.20', id: 'rcw46.20', name: "Chapter 46.20 RCW: Drivers' licenses—Identicards", why: "licensing, the instruction permit, the intermediate licence and its limits, implied consent, suspension and revocation" },
  { chapter: '46.29', id: 'rcw46.29', name: 'Chapter 46.29 RCW: Financial responsibility', why: 'financial responsibility after a crash and the suspension for lacking it' },
  { chapter: '46.30', id: 'rcw46.30', name: 'Chapter 46.30 RCW: Mandatory liability insurance', why: 'the insurance every driver must carry and show' },
  { chapter: '46.37', id: 'rcw46.37', name: 'Chapter 46.37 RCW: Vehicle lighting and other equipment', why: 'lights, brakes, seat belts, child restraints, helmets, tint and the equipment a vehicle must have' },
  { chapter: '46.52', id: 'rcw46.52', name: 'Chapter 46.52 RCW: Accidents—Reports—Abandoned vehicles', why: 'what a driver must do after a crash, hit-and-run, and the crash report' },
  { chapter: '46.61', id: 'rcw46.61', name: 'Chapter 46.61 RCW: Rules of the road', why: 'the rules of the road: signals, right of way, speed, parking, school buses, phones, impaired driving and vehicular homicide' },
  { chapter: '46.63', id: 'rcw46.63', name: 'Chapter 46.63 RCW: Disposition of traffic infractions', why: 'what a traffic infraction is, how a notice is answered, and its penalties' },
  { chapter: '46.64', id: 'rcw46.64', name: 'Chapter 46.64 RCW: Enforcement', why: 'the duty to stop and sign a citation, and the penalty for a misdemeanour under the title' },
  { chapter: '46.65', id: 'rcw46.65', name: 'Chapter 46.65 RCW: Washington habitual traffic offenders act', why: 'the revocation a repeat offender faces' },
  {
    chapter: '66.44',
    id: 'rcw66.44',
    name: 'Chapter 66.44 RCW, Section 66.44.270: Furnishing liquor to minors—Possession, use',
    why: 'a minor possessing or consuming liquor, codified in the liquor law',
    keep: (section) => section === '66.44.270',
  },
]

/** The state's own citation form: "RCW 46.61.570". */
export function cite(section: string): string {
  return `RCW ${section}`
}

export function chapterUrl(chapter: string): string {
  return `${ORIGIN}default.aspx?cite=${chapter}&full=true`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`app.leg.wa.gov answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

interface Copy {
  heading: string
  /** The notes closing the catchline, "(Effective until January 1, 2028.)", "(as amended by 2025 c 175)"; [] where there are none. */
  notes: string[]
  /** The body's markup, from after the catchline to the history. */
  body: string
}

/** "RCW  <a …>46.61.570</a></h3>": where each copy of a section opens, the anchor's own and any repeat under it. */
const COPY = /<div><h3><a class="btn btn-outline hidden-print"[^>]*>PDF<\/a>RCW\s+<a [^>]*>([\dA-Z.]+)<\/a><\/h3><\/div>/g

/** The Code Reviser's notes on a catchline: which amendment a copy is, and when it is in force. */
const NOTE = /\((?:as amended by|Effective|Expires|Contingent)\b[^)]*\)\.?/gi

/** A page's sections by number, each with every copy the page serves. */
export function sectionsOf(html: string): Map<string, Copy[]> {
  const sections = new Map<string, Copy[]>()
  const starts = [...html.matchAll(COPY)]
  for (const [index, match] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length
    let block = html.slice(match.index + match[0].length, end)
    // The next section's anchor sits just before its own "RCW" line; it belongs to that section.
    const anchor = block.indexOf('<a name=')
    if (anchor >= 0) block = block.slice(0, anchor)
    const catchline = /^\s*<div><h3>([\s\S]*?)<\/h3><\/div>/.exec(block)
    if (catchline === null) throw new Error(`${match[1]} has no catchline where the page always prints one`)
    // The notes are italic, or plain inside the catchline ("… Notice (as amended by 2025 c 175)."); either way
    // an italic phrase that is not one of them is something this module has never seen, and is not guessed at.
    for (const [, italic] of catchline[1].matchAll(/<span style="font-style:italic;">([\s\S]*?)<\/span>/g)) {
      if (inline(italic).replace(NOTE, '').trim() !== '') throw new Error(`a catchline note this module does not know: ${inline(italic)}`)
    }
    const text = inline(catchline[1])
    const notes = [...text.matchAll(NOTE)].map((note) => note[0])
    const heading = text.replace(NOTE, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
    const rest = block.slice(catchline[0].length)
    const historyAt = rest.indexOf('<div style="margin-top:15pt;')
    const body = historyAt < 0 ? rest : rest.slice(0, historyAt)
    sections.set(match[1], [...(sections.get(match[1]) ?? []), { heading, notes, body }])
  }
  return sections
}

/**
 * Whether a copy is the law today: no date on it, or one in force until a
 * date ("Effective until …", "Expires …"). "(Effective January 1, 2028.)" and
 * "(Contingent effective date.)" are enacted and not yet law.
 */
function inForce(copy: Copy): boolean {
  return !copy.notes.some((note) => /^\(Effective (?!until\b)/i.test(note) || /^\(Contingent\b/i.test(note))
}

const site: Site = {
  // The Revised Code of Washington as the Code Reviser publishes it for the Legislature.
  official: ORIGIN,
  name: 'the Revised Code of Washington',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const url = chapterUrl(spec.chapter)
      const before = listings.length
      for (const [section, copies] of sectionsOf(await page(url))) {
        if (spec.keep !== undefined && !spec.keep(section)) continue
        const current = copies.find(inForce) ?? copies[0]
        listings.push({ file: `${spec.id}-${section}`, url: `${url}#${section}`, section, cite: cite(section), heading: current.heading })
      }
      // A chapter page read as nothing would otherwise fetch as nothing and report every listed section present.
      if (listings.length === before) throw new Error(`the full page of chapter ${spec.chapter} lists no section`)
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractRcw(body, listing.section),
}

export default site

/** One section's text in force: a line per paragraph, each opening with its label as the code prints it. */
export function extractRcw(html: string, section: string): string {
  const copies = sectionsOf(html).get(section)
  if (copies === undefined) throw new Unavailable(`the page has no section ${section}`)
  const current = copies.filter(inForce)
  if (current.length === 0) throw new Unavailable(`not yet in effect: ${copies.flatMap((copy) => copy.notes).join(' ')}`)
  if (current.length > 1) {
    // Amended twice in one session "without reference to the other": the Code Reviser prints each version, the
    // later in bill form with "((struck))" words, and RCW 1.12.025 reads them together. No one copy is the law.
    if (current.some((copy) => copy.notes.some((note) => /^\(as amended by/i.test(note)) || /\(\(/.test(copy.body)))
      throw new Unavailable(`served as ${current.length} versions in force at once, each amended without reference to the other`)
    throw new Error(`${section} is served ${current.length} times in force on one page`)
  }
  // 46.19.010's one copy in force is printed the same way, struck words and all: which words are the law is
  // the reader's to reconstruct, and a struck "two hundred" beside an underlined "200" is not a text to quote.
  if (/text-decoration:line-through/.test(current[0].body)) throw new Unavailable('served only in bill form, with struck and underlined words')
  const lines = current[0].body
    // A footnote marker inside a label -- "<sup>1</sup>(b)" -- would make the label "1(b)".
    .replace(/<sup>[\s\S]*?<\/sup>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<td\b[^>]*>/gi, ' ')
    .replace(/<(div|p|tr|h\d)\b[^>]*>/gi, '\n')
    .split('\n')
    .map(inline)
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return lines.join('\n') + '\n'
}

function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[\s  ]+/g, ' ')
    .trim()
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
