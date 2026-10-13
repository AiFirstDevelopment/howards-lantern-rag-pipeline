/**
 * New Hampshire: the Revised Statutes Annotated as the General Court publishes
 * them (gc.nh.gov/rsa, formerly gencourt.state.nh.us, which now redirects
 * there), one section per page. An index-page `enumerate`, as Maryland's: each
 * chapter's table of contents lists its sections, under the subdivision
 * headings the chapter is cut into, and names a repealed section "Repealed by
 * …" in the list itself, so a repealed section is never asked for.
 *
 * A section amended for a later date is served with both texts on one page,
 * each under a bracketed editor's note: the whole section ("[RSA 262:35-a
 * effective until January 1, 2027; see also RSA 262:35-a set out below.]",
 * then "[RSA 262:35-a effective January 1, 2027; …]"), or one paragraph of it
 * ("[Paragraph I-b effective until January 1, 2027; …]"). `extract` keeps the
 * text in effect on the day it runs, drops the notes -- an editor's, not the
 * law's -- and refuses a note it cannot read rather than guess.
 *
 * New Hampshire numbers paragraphs with roman numerals ("I.", "II.", "I-a."),
 * subparagraphs "(a)" and then "(1)". The text is committed as served, one
 * line per paragraph; see the report of the chunker's reading in the PR.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://gc.nh.gov/rsa/html/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title XXI, and why: 260
 * (the division of motor vehicles' organisation, road tolls and fuel taxes),
 * 261-A, 261-B and 261-C (optional special and decal plate programmes, none of
 * them a duty), 263-A (the mobile licence app), 266-A (motor carriers of
 * passengers), 267 (the New England truckers compact), 268 (emissions
 * inspection stations) and 269 (personal mobility devices, which bind their
 * riders on sidewalks, not drivers). Inside chapter 263, the subdivisions on
 * commercial licensing (they bind CDL holders, and their permit and alcohol
 * rules crowd out the ordinary ones) and on drivers' schools and the driver
 * training fund (the licensing of schools, not of drivers) are left out.
 */
const TITLES: {
  path: string
  /** The chapter as its file names begin: "265-A" for 265-A-2.htm. */
  chapter: string
  name: string
  why: string
  /** Subdivision headings whose sections are out. */
  skip?: string[]
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  { path: 'XXI', chapter: '259', name: 'RSA 259: Words and Phrases Defined', why: 'what the code means by a vehicle, a moped, a way or a driver' },
  { path: 'XXI', chapter: '261', name: 'RSA 261: Certificates of Title and Registration of Vehicles', why: 'the title and registration every owner must hold, plates and their display' },
  { path: 'XXI', chapter: '262', name: 'RSA 262: Antitheft Laws, Offenses, Penalties, Habitual Offenders', why: 'offences against the motor vehicle laws, the general penalties, habitual offenders and towing' },
  {
    path: 'XXI',
    chapter: '263',
    name: "RSA 263: Drivers' Licenses",
    why: 'the licence, the youth operator licence and its limits, testing, and suspension and revocation',
    skip: ['Commercial Licensing', "Motor Vehicle Drivers' School", 'Driver Training Fund'],
  },
  { path: 'XXI', chapter: '264', name: 'RSA 264: Accidents and Financial Responsibility', why: 'what a driver must do after a crash, and the security a crash requires' },
  { path: 'XXI', chapter: '265', name: 'RSA 265: Rules of the Road', why: 'the rules of the road: signals, right of way, speed, passing, school buses, pedestrians, stopping and parking' },
  { path: 'XXI', chapter: '265-A', name: 'RSA 265-A: Alcohol or Drug Impairment', why: 'driving under the influence, implied consent and open containers' },
  { path: 'XXI', chapter: '266', name: 'RSA 266: Equipment of Vehicles', why: 'lights, brakes, belts, child restraints, inspection and the equipment a vehicle must have' },
  {
    path: 'XIII',
    chapter: '179',
    name: 'RSA 179: Enforcement Provisions (Alcoholic Beverages)',
    why: 'underage possession and attempted purchase of alcohol, codified outside the motor vehicle title',
    keep: ['179:10', '179:10-a'],
  },
]

/** "265:69" -> "N.H. Rev. Stat. Ann. § 265:69". */
export function cite(section: string): string {
  return `N.H. Rev. Stat. Ann. § ${section}`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.text()
}

/** A chapter's table of contents: every section in force, with its catchline and the subdivision it sits under. */
export function sectionsOf(toc: string): { href: string; section: string; heading: string; subdivision: string }[] {
  const out: { href: string; section: string; heading: string; subdivision: string }[] = []
  let subdivision = ''
  const item = /<li style="[^"]*list-style-type: none[^"]*">([^<]*)<\/li>|<a href="(\.\.\/[^"]+\.htm)">\s*Section:\s*([^<]+?)\s*<\/a>/g
  for (const match of toc.matchAll(item)) {
    if (match[1] !== undefined) {
      subdivision = match[1].trim()
      continue
    }
    const href = match[2]
    const text = decode(match[3]).replace(/\s+/g, ' ')
    // "260:2, 260:3 Repealed by …" and "261:166 to 261:175 Repealed …": kept only as markers.
    if (/^Repealed\b/.test(text.replace(/^(?:[\dA-Z-]+:[\w-]+,?\s+|to\s+)+/, ''))) continue
    const [section, ...rest] = text.split(' ')
    out.push({ href, section, heading: rest.join(' '), subdivision })
  }
  return out
}

const site: Site = {
  // The General Court (the legislature) publishes the RSA; this is that site.
  official: ORIGIN,
  name: 'the New Hampshire Revised Statutes',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: chapter, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const toc = await page(`${ORIGIN}NHTOC/NHTOC-${title.path}-${title.chapter}.htm`)
      const sections = sectionsOf(toc)
      if (sections.length === 0) throw new Error(`no sections listed for RSA ${title.chapter}`)
      for (const each of sections) {
        if (title.skip?.includes(each.subdivision)) continue
        if (title.keep !== undefined && !title.keep.includes(each.section)) continue
        const stem = /\/([^/]+)\.htm$/.exec(each.href)![1]
        if (!stem.startsWith(`${title.chapter}-`)) throw new Error(`RSA ${title.chapter} lists ${each.href}`)
        listings.push({
          file: stem,
          url: new URL(each.href, `${ORIGIN}NHTOC/`).href,
          section: each.section,
          cite: cite(each.section),
          heading: each.heading.replace(/\.$/, ''),
        })
      }
    }
    return listings
  },
  extract: (html) => extractRsa(html, new Date()),
}

export default site

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function dateOf(text: string): Date {
  const match = /^([A-Z][a-z]+)\.? (\d{1,2}), (\d{4})/.exec(text)
  const month = match === null ? undefined : MONTHS[match[1].slice(0, 3).toLowerCase()]
  if (match === null || month === undefined) throw new Error(`an RSA note gives a date this extract cannot read: "${text}"`)
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2])))
}

/**
 * Whether the text under an editor's note is in effect on `today`. "effective
 * until D" is the current text until D; "effective D" the text from D; "repealed
 * by …, effective D" stands until D, and "effective contingent upon …" until a
 * condition nobody here can check has been met, so it stands.
 */
export function inEffect(note: string, today: Date): boolean {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  if (/\brepealed by\b/i.test(note)) {
    if (/effective contingent upon/i.test(note)) return true
    const when = /effective ([A-Z][^;\]]+)/.exec(note)
    if (when === null) throw new Error(`an RSA repeal note this extract cannot read: ${note}`)
    return day < dateOf(when[1])
  }
  const until = /effective until ([A-Z][^;\]]+)/.exec(note)
  if (until !== null) return day < dateOf(until[1])
  const from = /effective ([A-Z][^;\]]+)/.exec(note)
  if (from !== null) return day >= dateOf(from[1])
  throw new Error(`an RSA note this extract cannot read: ${note}`)
}

/** The depth of a line's label: "II." 1, "(a)" 2, "(1)" 3, "(A)" 4; 0 for a line with none. */
function depthOf(line: string): number {
  if (/^[IVXLC]+(-[a-z]+)?\.\s/.test(line)) return 1
  if (/^\([a-z]{1,4}(-\d+)?\)/.test(line)) return 2
  if (/^\(\d+(-[a-z]+)?\)/.test(line)) return 3
  if (/^\([A-Z]{1,3}\)/.test(line)) return 4
  return 0
}

const NOTE = /^\[(?:RSA|Paragraphs?|Subparagraphs?) [^\]]*\beffective\b[^\]]*\]$/

/**
 * The text of an RSA section page in effect on `today`: the `<codesect>` block
 * whose note (if any) is in effect, its lines as the page breaks them, tags
 * dropped, and within it any paragraph whose note says it is not in effect
 * dropped with its subparagraphs.
 */
export function extractRsa(html: string, today: Date): string {
  const blocks: { note: string | null; body: string }[] = []
  let from = 0
  for (const match of html.matchAll(/<codesect>([\s\S]*?)<\/codesect>/g)) {
    const before = html.slice(from, match.index)
    const note = /\[RSA [^\]]*\]/.exec(before.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    blocks.push({ note: note === null ? null : note[0], body: match[1] })
    from = match.index + match[0].length
  }
  if (blocks.length === 0) throw new Error('no <codesect> block on the page')
  const current = blocks.filter((block) => block.note === null || inEffect(block.note, today))
  if (current.length === 0) throw new Unavailable(`not yet in effect: ${blocks.map((block) => block.note).join(' ')}`)
  if (current.length > 1) throw new Error(`${current.length} versions of the section are in effect at once`)

  const lines = decode(
    current[0].body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|tr|center|h\d)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)

  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('[') || !/\beffective\b/.test(line)) {
      kept.push(line)
      continue
    }
    if (!NOTE.test(line)) throw new Error(`an RSA note this extract cannot read: ${line}`)
    // The paragraph a note names, and so how far its text runs: "Paragraph II"
    // to the next roman paragraph, "Paragraph I(a)" to the next subparagraph or
    // paragraph, "(intro. par.)" to the next labelled line of any depth.
    const target = /^\[\S+ ([^ ]+)/.exec(line)![1]
    const intro = /intro\. par\./.test(line)
    const depth = intro ? Infinity : 1 + (target.match(/\(/g)?.length ?? 0)
    let end = index + 2
    while (end < lines.length && !lines[end].startsWith('[')) {
      const own = depthOf(lines[end])
      if (own > 0 && own <= depth) break
      end += 1
    }
    if (inEffect(line, today)) kept.push(...lines.slice(index + 1, end))
    index = end - 1
  }
  if (kept.length === 0) throw new Error('the section in effect has no text')
  return kept.join('\n') + '\n'
}

/** Named and numeric references, with 128-159 read as windows-1252 as a browser does: the site's dash is "&#150;". */
function decode(text: string): string {
  const cp1252: Record<number, string> = { 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—', 133: '…', 167: '§' }
  return text
    .replace(/&#(\d+);/g, (_, code: string) => cp1252[Number(code)] ?? String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&minus;/g, '−')
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
