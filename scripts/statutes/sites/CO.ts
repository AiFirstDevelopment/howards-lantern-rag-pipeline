/**
 * Colorado: the Colorado Revised Statutes as the Office of Legislative Legal
 * Services publishes them for download (olls.info/crs, linked from the General
 * Assembly's "2026 CRS Titles for Download" page). The General Assembly's own
 * statutes page links only LexisNexis, whose reader is a click-through; OLLS
 * is the office that edits and revises the statutes, and these are its files.
 *
 * A chapter-page `enumerate`: one HTM file holds a whole title, every section
 * in it, so a section's URL is the title's file with the section as its
 * fragment. The file is served as Word's HTML export, in windows-1252.
 *
 * The 2026 files carry a section's future text beside the text in effect, at
 * the subsection: "(2) [Editor's note: This version of subsection (2) is
 * effective July 1, 2027.]" directly after the version effective until then.
 * `extract` keeps the version in effect today and drops the other.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://olls.info/crs/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const EDITION = 'crs2026'

/**
 * The articles and parts a licence-holder is bound by. Out, and why: Title 42's
 * article 1 parts 2 to 4 are the department's administration and grant
 * programs; article 2's part 3 is identification cards, part 4 the commercial
 * licence and part 6 commercial driving schools; article 3's sections from
 * 42-3-206.5 are the special and novelty plates, and its part 3 fees and cash
 * funds; article 4's parts 3 to 5 are emissions and diesel inspection and
 * commercial size and weight, 18 and 21 to 25 abandoned vehicles, hours of
 * service, recycling, event data recorders and education programs; article 5
 * is theft and VIN inspection; article 6's part 2 is used-car dealers; article
 * 7's part 6 is the department's insurance database; articles 8 to 21 are
 * ports of entry, repairs, warranties, service contracts, collector's items,
 * idling standards for fleets and hazardous materials.
 */
const TITLES: {
  title: string
  article: string
  id: string
  name: string
  why: string
  parts?: number[]
  upTo?: number
  only?: string[]
}[] = [
  { title: '42', article: '1', parts: [1], id: 'co-42-1', name: 'Title 42, Article 1, Part 1: Definitions and Citation', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { title: '42', article: '2', parts: [1, 2, 5], id: 'co-42-2', name: "Title 42, Article 2, Parts 1, 2 and 5: Driver's Licenses, Habitual Offenders, Road and Community Safety Act", why: 'licensing, the instruction permit and the under-18 restrictions, points, suspension and revocation' },
  { title: '42', article: '3', parts: [1, 2], upTo: 206, id: 'co-42-3', name: 'Title 42, Article 3, Parts 1 and 2: Registration and License Plates', why: 'the registration and plates every owner must hold and display, and parking for persons with disabilities' },
  { title: '42', article: '4', parts: [1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19], id: 'co-42-4', name: 'Title 42, Article 4: Regulation of Vehicles and Traffic', why: 'the rules of the road: equipment, signals, right of way, speed, parking, DUI, crashes, school buses, and the penalties' },
  { title: '42', article: '6', parts: [1], id: 'co-42-6', name: 'Title 42, Article 6, Part 1: Certificates of Title', why: 'the title every owner must hold and transfer' },
  { title: '42', article: '7', parts: [1, 3, 4, 5], id: 'co-42-7', name: 'Title 42, Article 7: Motor Vehicle Financial Responsibility Law', why: 'the security a crash requires, the minimum liability limits and the suspension for lacking proof' },
  { title: '10', article: '4', only: ['10-4-619', '10-4-620'], id: 'co-10-4', name: 'Title 10, Sections 10-4-619 and 10-4-620: Compulsory Coverage', why: 'the insurance every vehicle must carry, codified in the insurance title' },
  { title: '18', article: '3', only: ['18-3-106', '18-3-205'], id: 'co-18-3', name: 'Title 18, Sections 18-3-106 and 18-3-205: Vehicular Homicide and Vehicular Assault', why: 'the crimes of killing or injuring someone while driving recklessly or impaired, codified in the criminal title' },
]

/** The state's own citation form: "C.R.S. § 42-4-1204". */
export function cite(section: string): string {
  return `C.R.S. § ${section}`
}

const titleUrl = (title: string) => `${ORIGIN}${EDITION}-title-${title.padStart(2, '0')}.htm`

/** The title's file, with the section as its fragment: one address per committed section, one file behind them. */
export function sectionUrl(section: string): string {
  return `${titleUrl(section.split('-')[0])}#${section}`
}

// Every section of a title is in one file of 6 to 10 MB; fetch.ts reads each
// page once per run, by its URL without the section's fragment (#693).

interface Paragraph {
  /** The section this paragraph opens, where it is a section's bold heading. */
  heading: string | null
  text: string
}

const HEADING = /^\s*<b><span[^>]*>(\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?)\.<\/span><\/b>/

let parsed: { html: string; paragraphs: Paragraph[] } | null = null

/**
 * A title file as its paragraphs, in order. A section's heading is the one
 * whose number is bold: the same number in the article's table of contents is
 * not, and taking that one would commit a list of catchlines as the law.
 */
function paragraphsOf(html: string): Paragraph[] {
  if (parsed?.html === html) return parsed.paragraphs
  const body = html.slice(Math.max(0, html.search(/<body/i)))
  const paragraphs: Paragraph[] = []
  for (const [, raw] of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decode(raw.replace(/<br[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
      .replace(/[\s ]+/g, ' ')
      .trim()
    if (text.length === 0) continue
    paragraphs.push({ heading: HEADING.exec(raw)?.[1] ?? null, text })
  }
  parsed = { html, paragraphs }
  return paragraphs
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`olls.info answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

/** "42-4-1204" -> 1204; "42-3-206.5" -> 206.5. */
const numberOf = (section: string) => Number(section.split('-')[2])

const site: Site = {
  // The Office of Legislative Legal Services, which edits and revises the statutes, publishes its files here.
  official: ORIGIN,
  name: 'the Colorado Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of [...new Set(TITLES.map((each) => each.title))]) {
      const paragraphs = paragraphsOf(await page(titleUrl(title)))
      for (const spec of TITLES.filter((each) => each.title === title)) {
        for (const paragraph of paragraphs) {
          const section = paragraph.heading
          if (section === null || section.split('-')[1] !== spec.article) continue
          if (spec.only !== undefined && !spec.only.includes(section)) continue
          if (spec.parts !== undefined && !spec.parts.includes(Math.floor(numberOf(section) / 100))) continue
          if (spec.upTo !== undefined && numberOf(section) > spec.upTo) continue
          const heading = paragraph.text.slice(section.length + 1).trim()
          // A catchline marked repealed is a pointer to the session law that repealed it, not a rule.
          if (/\((Repealed|Transferred|Relocated)\)\s*$/i.test(heading)) continue
          listings.push({ file: `co-${section}`, url: sectionUrl(section), section, cite: cite(section), heading })
        }
      }
    }
    return listings
  },
  extract: (body, listing) => extractOlls(body, listing.section),
}

export default site

/**
 * What ends a section's statute text: the history note that follows every
 * section ("Source: L. 94: …"), and the editor's notes, cross references and
 * case annotations after it -- none of them law.
 */
const AFTER_LAW = /^(Source:|Editor's note:|Cross references?:|ANNOTATION$|Law reviews?\.|PART \d|ARTICLE \d)/

/**
 * One section's text in effect: its heading line, then a line per paragraph,
 * up to its history note. Where a subsection is served in two versions, the
 * one not in effect today is dropped with every paragraph under it; a section
 * whose whole text is not yet (or no longer) in effect is `Unavailable`.
 */
export function extractOlls(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const paragraphs = paragraphsOf(html)
  const starts = paragraphs.flatMap((paragraph, index) => (paragraph.heading === section ? [index] : []))
  if (starts.length === 0) throw new Unavailable(`the title file has no heading for ${section}`)
  // Two headings would be two versions of the whole section; none is served today, and guessing would commit the wrong one.
  if (starts.length > 1) throw new Error(`${section} has ${starts.length} headings in the title file`)
  const lines: string[] = []
  for (const paragraph of paragraphs.slice(starts[0])) {
    if (lines.length > 0 && (paragraph.heading !== null || AFTER_LAW.test(paragraph.text))) break
    lines.push(paragraph.text)
  }
  const kept = inEffect(lines, today, section)
  if (kept.length < 2) throw new Unavailable('the title file serves the catchline with no text')
  return kept.join('\n') + '\n'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const NOTE =
  /\[Editor's note: (?:This version of )?(the introductory portion to )?(?:subsection ((?:\([^)]+\))+)|(this section)) is effective (until |only if |unless )?(?:(\w+) (\d{1,2}), (\d{4}))?/i

/**
 * Whether a paragraph's own editor's note says it is not the law today: a
 * version effective from a later date, one effective until a date now past,
 * or one that takes effect only if a ballot initiative passes.
 */
function notInEffect(text: string, today: string): { depth: number | 'section' | 'intro' } | null {
  const note = NOTE.exec(text)
  if (note === null) return null
  const [, intro, path, wholeSection, condition, month, day, year] = note
  let gone: boolean
  if (condition === 'only if ') gone = true
  else if (condition === 'unless ') gone = false
  else {
    if (year === undefined) return null
    const index = MONTHS.indexOf(month)
    if (index < 0) throw new Error(`an editor's note names a month this cannot read: ${month}`)
    const date = `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
    gone = condition === 'until ' ? date <= today : date > today
  }
  if (!gone) return null
  if (wholeSection !== undefined) return { depth: 'section' }
  if (intro !== undefined) return { depth: 'intro' }
  return { depth: path.match(/\(/g)!.length }
}

/**
 * The paragraphs in effect. A dropped version takes every paragraph under it
 * with it: everything up to the next paragraph whose first label is at its
 * own level or above, so "(2) [Editor's note: … effective July 1, 2027.]"
 * leaves with its (a) and (b) and stops at (3).
 */
function inEffect(lines: string[], today: string, section: string): string[] {
  const levels = levelsOf(lines)
  const kept: string[] = []
  let dropping: number | null = null
  for (const [index, line] of lines.entries()) {
    const level = levels[index]
    if (dropping !== null) {
      if (level === null || level > dropping) continue
      dropping = null
    }
    const gone = index === 0 ? null : notInEffect(line, today)
    if (gone === null) {
      kept.push(line)
      continue
    }
    if (gone.depth === 'section') throw new Unavailable(`the file serves ${section} only in a version not in effect today`)
    if (gone.depth === 'intro') continue
    dropping = gone.depth
  }
  return kept
}

const LEADING = /^\(([0-9]+|[a-z]+|[A-Z]+)((?:\.\d+)?)\)\s*/
const UPPER_ROMAN = /^[IVX]+$/
const LOWER_ROMAN = /^[ivx]+$/
const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']
const romanAfter = (roman: string | undefined) => (roman === undefined ? 'i' : ROMANS[ROMANS.indexOf(roman) + 1])
const letterAfter = (letter: string | undefined) => (letter === undefined ? 'a' : String.fromCharCode(letter.charCodeAt(0) + 1))

/**
 * Each paragraph's level by its first label, as C.R.S. nests them: (1), (a),
 * (I), (A), (i). "(i)" after "(h)" is a letter and "(I)" after "(H)" is one
 * too; otherwise they are numerals. Null for a paragraph with no label.
 */
function levelsOf(lines: string[]): (number | null)[] {
  const path: string[] = []
  return lines.map((line) => {
    let rest = line
    let first: number | null = null
    let level = 0
    // "(4) (a) (I) Text": the labels after the first each open the level under the one before.
    for (let label = LEADING.exec(rest); label !== null; label = LEADING.exec(rest)) {
      const [whole, core, suffix] = label
      level = first === null ? levelOf(core, suffix, path) : level + 1
      if (first === null) first = level
      path.length = level - 1
      path.push(core.toLowerCase())
      rest = rest.slice(whole.length)
    }
    return first
  })
}

function levelOf(core: string, suffix: string, path: string[]): number {
  const same = (level: number) => suffix !== '' && path[level - 1] === core.toLowerCase()
  if (/^\d+$/.test(core)) return 1
  if (core === core.toLowerCase()) {
    if (same(2)) return 2
    if (same(5)) return 5
    const roman = LOWER_ROMAN.test(core) && path.length >= 4 && romanAfter(path[4]) === core
    const letter = core.length === 1 && path.length >= 1 && letterAfter(path[1]) === core
    if (roman) return 5
    if (letter) return 2
    return LOWER_ROMAN.test(core) && core.length > 1 ? 5 : 2
  }
  if (same(3)) return 3
  if (same(4)) return 4
  const lower = core.toLowerCase()
  const roman = UPPER_ROMAN.test(core) && path.length >= 2 && romanAfter(path[2]) === lower
  const letter = core.length === 1 && path.length >= 3 && letterAfter(path[3]) === lower
  if (letter && (path.length >= 4 || !roman)) return 4
  if (roman) return 3
  return UPPER_ROMAN.test(core) ? 3 : 4
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
