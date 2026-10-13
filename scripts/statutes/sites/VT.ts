/**
 * Vermont: the Vermont Statutes Online, which the Office of Legislative
 * Counsel publishes for the General Assembly at legislature.vermont.gov. A
 * chapter-page `enumerate`: every chapter is also served whole on one page
 * (`/statutes/fullchapter/23/013`, the chapter page's "Full Text of Chapter"
 * link), each section in it an `<li>` opening on its bold catchline, "§ 1139.
 * Riding on roadways and bicycle paths". A section's URL is its chapter's
 * full-text page with the section number as fragment. The site calls itself
 * "an unofficial copy of the Vermont Statutes Annotated"; it is the
 * legislature's own, and the annotated edition is LexisNexis's, so this is the
 * official source this pipeline can read.
 *
 * robots.txt asks every agent for `Crawl-delay: 30` and disallows only
 * `/bill/load…` paths. The fetch's own pause is a second, so `read` fetches
 * each chapter page itself, once per run and never sooner than thirty seconds
 * after the last request -- thirteen pages in all.
 *
 * **What is in effect.** The site serves a section amended for a later date
 * twice, each copy's catchline carrying its terms in brackets ("§ 361. Pleasure
 * cars [Effective upon contingency being met; see also …]"), and a subsection
 * amended for a later date twice inside one section, each copy under a
 * centred note ("[Subsection (a) effective until July 1, 2026; see also …]").
 * A copy runs from its note to the next note or the next paragraph at its own
 * depth. `extract` keeps what is in force today: a dated copy once its date
 * has come and until its end date, "as currently effective" and "until
 * contingency met", never "upon contingency being met" or "as contingently
 * amended". `enumerate` lists no section with no copy in force, and none kept
 * only as "Repealed.", "[Reserved for future use.]" or "Redesignated.".
 *
 * Vermont labels its subsections "(a)", "(1)", "(A)", "(i)", each paragraph
 * its own `<p>`, so a line per paragraph is the code's own layout; a table is
 * a line per row, its cells joined by a space. What is dropped: the centred
 * version notes and the bracketed terms on a catchline (editors' marks, not
 * words of the law), the "Notes" block of session-law effective-date
 * provisions, and the history that closes each section ("(Added 1971, No. 258
 * (Adj. Sess.), § 3, …)"). The catchline is the listing's heading and is not
 * repeated in the text, as Virginia's is not: a long one would be filed as law.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://legislature.vermont.gov/statutes/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
/** robots.txt: "User-agent: * / Crawl-delay: 30". */
const CRAWL_DELAY_MS = 30_000

/**
 * The chapters a licence-holder is bound by. Out of Title 23, and why: chapter
 * 3, the Department of Motor Vehicles; 10, transportation network companies;
 * 15, the powers of enforcement officers (crash reports, seizure, automated
 * enforcement), which bind the police rather than the driver; 19, municipal
 * parking bureaus and police courts, the powers of local authorities; 27 and
 * 28, fuel taxes; 29, 31 and 36, snowmobiles, vessels and all-terrain
 * vehicles, which are recreation off the road; 35, the International
 * Registration Plan for interstate fleets; 39, the commercial licence, which
 * every state so far has left out because its permit and alcohol rules crowd
 * out the ordinary ones; 41, automated vehicle testing; and 8, 20 and 23,
 * repealed whole. Vermont codifies impaired driving, open containers and the
 * junior operator's limits in Title 23 itself; underage purchase and
 * possession of alcohol is Title 7, chapter 21.
 */
const TITLES: { path: string; id: string; title: number; name: string; why: string }[] = [
  { path: '23/001', id: '23-001', title: 23, name: 'Title 23, Chapter 1: General Provisions', why: 'what the code means by a motor vehicle, an operator, a highway or a junior operator' },
  { path: '23/005', id: '23-005', title: 23, name: "Title 23, Chapter 5: Provisions Common to Registration and Operator's Licenses", why: 'false applications, surrender of a licence, change of address, and recognition of out-of-state licences' },
  { path: '23/007', id: '23-007', title: 23, name: 'Title 23, Chapter 7: Registration', why: 'registration and plates every owner must hold, and driving an unregistered vehicle' },
  { path: '23/009', id: '23-009', title: 23, name: "Title 23, Chapter 9: Operator's Licenses", why: "the learner's permit, the junior operator's licence and its limits, the tests, and suspension" },
  { path: '23/011', id: '23-011', title: 23, name: 'Title 23, Chapter 11: Financial Responsibility and Insurance', why: 'the insurance every vehicle must carry and the proof a driver must show' },
  { path: '23/013', id: '23-013', title: 23, name: 'Title 23, Chapter 13: Operation of Vehicles', why: 'the rules of the road: signals, speed, right of way, passing, parking, school buses, phones, belts, child seats, equipment, crashes and driving under the influence' },
  { path: '23/017', id: '23-017', title: 23, name: 'Title 23, Chapter 17: General Offenses and Jurisdiction', why: 'identification-number and odometer offences, and whether a motor vehicle offence is a felony or a misdemeanour' },
  { path: '23/021', id: '23-021', title: 23, name: 'Title 23, Chapter 21: Title to Motor Vehicles', why: 'the title every owner must hold and what buyer and seller must do' },
  { path: '23/024', id: '23-024', title: 23, name: 'Title 23, Chapter 24: Traffic Violations', why: 'what a traffic violation is, how it is answered, and the points it carries' },
  { path: '23/025', id: '23-025', title: 23, name: 'Title 23, Chapter 25: Motor Vehicle Violations; Point System', why: 'the points schedule and the suspensions it leads to' },
  { path: '23/033', id: '23-033', title: 23, name: 'Title 23, Chapter 33: Nonresident Violator Compact', why: 'what happens to a licence when a citation in another member state goes unanswered' },
  { path: '23/037', id: '23-037', title: 23, name: 'Title 23, Chapter 37: Driver License Compact', why: 'how an offence in another state counts against a Vermont licence' },
  { path: '07/021', id: '07-021', title: 7, name: 'Title 7, Chapter 21: Penalties', why: 'underage purchase, possession and consumption of alcohol, codified outside the vehicle title' },
]

export function chapterUrl(path: string): string {
  return `${ORIGIN}fullchapter/${path}`
}

let last = 0
const pages = new Map<string, Promise<string>>()

/** A chapter page, once per run, never sooner than the crawl delay after the last request. */
function chapterPage(url: string): Promise<string> {
  const key = url.split('#')[0]
  if (!pages.has(key)) {
    const body = request(key)
    pages.set(key, body)
    body.catch(() => pages.delete(key))
  }
  return pages.get(key)!
}

async function request(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const wait = last + CRAWL_DELAY_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    last = Date.now()
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`legislature.vermont.gov answered ${response.status} for ${url}`)
      const body = decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
      // A page without the chapter's sections would list nothing and be reported present.
      if (!/<li><p><\/p><div>\s*<p[^>]*><b>\s*§/.test(body)) throw new Error(`${url} is not a full chapter of the statutes`)
      return body
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY_MS * attempt))
    }
  }
}

interface Copy {
  section: string
  catchline: string
  /** Everything after the number: "Repealed. 1981, No. 82, § 7(7).", "[Reserved for future use.]". */
  rest: string
  /** The bracketed terms after the catchline, without the brackets; '' where there are none. */
  terms: string
  body: string
}

/** Every section copy on a full-chapter page, in order; "§§ 1181, 1182. Repealed." entries have no `section` of their own and are skipped. */
function copiesOf(html: string): Copy[] {
  const copies: Copy[] = []
  for (const match of html.matchAll(/<li><p><\/p><div>([\s\S]*?)<\/div>\s*<\/li>/g)) {
    const item = match[1]
    const bold = /<b>([\s\S]*?)<\/b>/.exec(item)
    if (bold === null) throw new Error(`a section with no catchline: "${text(item).slice(0, 80)}"`)
    const heading = text(bold[1]).replace(/\s+/g, ' ').trim()
    if (heading.startsWith('§§')) continue
    const own = /^§ (\d+[a-z]*)\.\s*(.*?)\s*(?:\[([^\]]*)\])?$/.exec(heading)
    if (own === null) throw new Error(`a catchline this module does not know: "${heading}"`)
    const [, section, catchline, terms = ''] = own
    copies.push({ section, catchline: catchline.replace(/\.$/, ''), rest: heading.replace(/^§ \S+\s*/, ''), terms: /^effective\b|^repealed\b/i.test(terms) ? terms : '', body: item.slice(bold.index! + bold[0].length) })
  }
  return copies
}

/** A section kept only as a marker: "Repealed. 1981, No. 82, § 7(7)", "[Reserved for future use.]". */
const STUB = /^\[?(Repealed|Reserved|Redesignated|Recodified|Renumbered|Transferred|Expired)\b/i
const isStub = (copy: Copy) => STUB.test(copy.rest)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "July 1, 2026" as "2026-07-01". */
function isoDate(date: string): string {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(date)
  const month = match === null ? -1 : MONTHS.indexOf(match[1])
  if (match === null || month < 0) throw new Error(`a date this module does not know: "${date}"`)
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/**
 * Whether a copy's terms put it in force today. Each clause before "see also"
 * must: "Effective January 1, 2025; Effective until contingency met" is both.
 */
export function inForce(terms: string, on = today()): boolean {
  const clauses = terms
    .split(';')
    .map((clause) => clause.replace(/\s+/g, ' ').replace(/\.$/, '').trim())
    .map((clause) => clause.replace(/^(Subsection|Subdivision|Section) \([^)]*\) /i, ''))
    .filter((clause) => clause.length > 0 && !/^see also\b/i.test(clause))
  return clauses.every((clause) => {
    if (/^as currently effective$/i.test(clause)) return true
    if (/^effective until contingency (is )?met$/i.test(clause)) return true
    if (/^(as contingently amended\b|effective upon contingency\b)/i.test(clause)) return false
    const until = /^effective until ([A-Z][a-z]+ \d{1,2}, \d{4})$/i.exec(clause)
    if (until !== null) return on < isoDate(until[1])
    const dated = /^effective ([A-Z][a-z]+ \d{1,2}, \d{4})(?: until ([A-Z][a-z]+ \d{1,2}, \d{4}))?$/i.exec(clause)
    if (dated !== null) return isoDate(dated[1]) <= on && (dated[2] === undefined || on < isoDate(dated[2]))
    throw new Error(`terms this module does not know: "${clause}"`)
  })
}

const today = () => new Date().toISOString().slice(0, 10)

const site: Site = {
  // The General Assembly's own publication of the Vermont Statutes.
  official: ORIGIN,
  name: 'the Vermont Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const future: string[] = []
    const stubs: string[] = []
    for (const { path, id, title } of TITLES) {
      const url = chapterUrl(path)
      const copies = copiesOf(await chapterPage(url))
      const before = listings.length
      for (const section of [...new Set(copies.map((copy) => copy.section))]) {
        const versions = copies.filter((copy) => copy.section === section)
        if (versions.every(isStub)) {
          stubs.push(`${title}-${section}`)
          continue
        }
        const current = versions.filter((copy) => !isStub(copy) && inForce(copy.terms))
        if (current.length === 0) {
          future.push(`${title} V.S.A. § ${section}`)
          continue
        }
        if (current.length > 1) throw new Error(`${title} V.S.A. § ${section} is served in ${current.length} versions in force today`)
        listings.push({
          file: `${id}-${section}`,
          url: `${url}#${section}`,
          section,
          cite: `${title} V.S.A. § ${section}`,
          heading: current[0].catchline,
        })
      }
      // A chapter read as nothing would be a title fetched as nothing, reported present.
      if (listings.length === before) throw new Error(`${url} lists no section in force`)
    }
    if (future.length > 0) console.log(`VT: not in force today, left out: ${future.join(', ')}`)
    if (stubs.length > 0) console.log(`VT: kept only as repealed, reserved or redesignated, left out: ${stubs.length}`)
    return listings
  },
  // Through the crawl delay above: fetch.ts's own pause is a second.
  read: (listing) => chapterPage(listing.url),
  extract: (body, listing) => extractVermont(body, listing.section),
}

export default site

/** One section's text in force today: a line per paragraph or table row, version notes, notes and history dropped. */
export function extractVermont(html: string, section: string, on = today()): string {
  const copies = copiesOf(html).filter((copy) => copy.section === section)
  if (copies.length === 0) throw new Unavailable(`the chapter page has no § ${section}`)
  const current = copies.filter((copy) => !isStub(copy) && inForce(copy.terms, on))
  if (current.length === 0) throw new Unavailable(`§ ${section} is served only in a version not in effect today`)
  if (current.length > 1) throw new Error(`§ ${section} is served in ${current.length} versions in effect today`)
  // The "Notes" block: session-law provisions about when an act took effect, not the section.
  const body = current[0].body.split(/<div>\s*<h5>/)[0]
  const lines: string[] = []
  let keep = true
  /** The depth of the first paragraph under the last version note: the copy ends at the next paragraph as shallow. */
  let depth: number | null = null
  let noted = false
  for (const element of body.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>|<center>([\s\S]*?)<\/center>|<table[\s\S]*?<\/table>/g)) {
    if (element[3] !== undefined) {
      const note = text(element[3]).replace(/\s+/g, ' ').trim()
      const terms = /^\[(.*?)\]?$/.exec(note)?.[1]
      if (terms === undefined || !/^(Subsection|Subdivision) /.test(terms)) throw new Error(`§ ${section}: a note this module does not know: "${note}"`)
      keep = inForce(terms, on)
      depth = null
      noted = true
      continue
    }
    if (element[1] === undefined) {
      if (!keep) continue
      for (const row of element[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => line(cell[1])).filter((cell) => cell.length > 0)
        if (cells.length > 0) lines.push(cells.join(' '))
      }
      continue
    }
    const paragraph = line(element[2])
    if (paragraph.length === 0) continue
    if (/^\[(Subsection|Subdivision)/.test(paragraph)) throw new Error(`§ ${section}: a version note outside <center>: "${paragraph}"`)
    const indent = Number(/(?:text-indent|margin-left):\s*([\d.]+)px/.exec(element[1])?.[1] ?? 0)
    if (noted) {
      if (depth === null) depth = indent
      else if (indent <= depth) {
        keep = true
        noted = false
        depth = null
      }
    }
    if (keep) lines.push(paragraph)
  }
  if (lines.length > 0) lines[lines.length - 1] = withoutHistory(lines[lines.length - 1])
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) throw new Unavailable(`§ ${section} has no text`)
  return lines.join('\n') + '\n'
}

/**
 * A line without the history that closes it: "…chapter 25. (Added 1971, No.
 * 258 (Adj. Sess.), § 3, …)" as "…chapter 25.". The parenthesis is found by
 * balance, because the history itself holds "(Adj. Sess.)".
 */
export function withoutHistory(line: string): string {
  if (!line.endsWith(')')) return line
  let balance = 0
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] === ')') balance += 1
    else if (line[index] === '(') balance -= 1
    if (balance === 0) {
      const inside = line.slice(index + 1, -1)
      return /^(Added|Amended|Repealed|Recodified|Redesignated|Renumbered|\d{4}, No\.|\d{4} \(|P\.L\.|R\.S\.|G\.L\.|V\.S\.)/.test(inside) ? line.slice(0, index).trim() : line
    }
  }
  return line
}

const line = (html: string) => text(html.replace(/<br\s*\/?>/gi, ' ')).replace(/[\s\u00a0]+/g, ' ').trim()
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ''))

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
