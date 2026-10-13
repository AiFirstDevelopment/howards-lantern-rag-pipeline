/**
 * Oregon: the Oregon Revised Statutes as the Legislative Counsel Committee
 * publishes them on the Legislature's site (oregonlegislature.gov). A
 * chapter-page `enumerate`, as Florida's: one page per chapter holds every
 * section in it, so a section's URL is that page with the section number as
 * its fragment, and fetch.ts reads each page once per run.
 *
 * The pages are a word processor's export: a paragraph per subsection, and a
 * section opens on a bold paragraph, "811.550 Places where stopping, standing
 * and parking prohibited." Three other things open on bold and are not the law
 * in effect, so a section ends at the next bold paragraph whatever it is:
 *
 * - "Note: The amendments to 811.145 … become operative January 1, 2027 … The
 *   text that is operative on and after January 1, 2027, is set forth for the
 *   user's convenience." and then "811.145." and the 2027 text: the future copy
 *   Maryland's `// EFFECTIVE //` is, which would put the law of next year in
 *   the box as the law today.
 * - "Note: Section 5, chapter 629, Oregon Laws 2017, provides:" and the session
 *   law it quotes -- uncodified, and not the section.
 * - "811.010 [1983 c.338 §544; … repealed by 2005 c.746 §4]": a number with
 *   no catchline is a repealed or renumbered section, and is never listed.
 *
 * A whole section not yet in force is announced the same way -- "Note: 801.373
 * becomes operative January 1, 2027." -- and is not listed until that day.
 *
 * A section's paragraphs end with its history, "[1983 c.338 §669; … 2019
 * c.232 §2]", the Legislative Counsel's record of the session laws behind it
 * rather than law; `extract` drops it from the last paragraph, as Florida's
 * drops its History block. Oregon runs a section's first subsection into its
 * catchline -- "811.555 Illegal stopping …; penalty. (1) A person commits" --
 * and `extract` breaks the line after the catchline, which is whitespace, so
 * the chunker sees "(1)" at the start of a line. Nothing else is rewritten.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.oregonlegislature.gov/bills_laws/ors/'

/**
 * The chapters a licence-holder is bound by: the Oregon Vehicle Code, ORS
 * chapters 801 to 826, less what binds the department or a business rather
 * than a driver. Out, and why: 802 is the Department of Transportation's own
 * administration; 805 special registration -- specialty plates, fleets, farm
 * vehicles; 818 size and weight limits and the permits that lift them, motor
 * carrier regulation; 819 salvage, totaled and abandoned-vehicle disposal by
 * towers and wreckers; 820 the rules for school bus, worker transport,
 * emergency and farm vehicle operators; 821 off-road vehicles and snowmobiles;
 * 822 dealers, towers and wreckers; 823, 825 and 826 motor carriers and their
 * proportional registration.
 *
 * Oregon writes its commercial driver licence into chapters 807, 809 and 813
 * rather than a chapter of its own; those sections are left out, as every
 * state so far has left its commercial licence out, because its permit and
 * alcohol rules crowd out the ordinary ones.
 */
const COMMERCIAL = new Set([
  '807.018', '807.045', '807.085', '807.100', '807.164', '807.166', '807.168', '807.173', '807.285',
  '809.510', '809.515', '809.520', '809.525', '809.530', '809.535', '809.540', '809.545', '809.550',
  '813.050', '813.055',
])

const TITLES: {
  chapter: string
  name: string
  why: string
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  { chapter: '801', name: 'ORS Chapter 801: General Provisions and Definitions for Oregon Vehicle Code', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { chapter: '803', name: 'ORS Chapter 803: Vehicle Title and Registration', why: 'the title and registration every owner must hold, and plates and their display' },
  { chapter: '806', name: 'ORS Chapter 806: Financial Responsibility Law', why: 'the insurance every vehicle must carry, its proof, and the report a crash requires' },
  { chapter: '807', name: 'ORS Chapter 807: Driving Privileges and Identification Cards', why: 'licensing, the instruction permit, the provisional licence and its limits on drivers under 18, and examination' },
  { chapter: '809', name: 'ORS Chapter 809: Refusal, Suspension, Cancellation and Revocation; Impoundment', why: 'suspension and revocation of driving privileges, habitual offenders, and impoundment after an offence' },
  { chapter: '810', name: 'ORS Chapter 810: Road Authority; Courts; Police; Other Enforcement Officials', why: 'speed zones and traffic control devices, citations, arrest and what a stopped driver must do' },
  { chapter: '811', name: 'ORS Chapter 811: Rules of the Road for Drivers', why: 'the rules of the road: speed, right of way, passing, school buses, parking, phones, belts and child seats, crashes' },
  { chapter: '813', name: 'ORS Chapter 813: Driving Under the Influence of Intoxicants', why: 'impaired driving, implied consent, chemical tests, diversion and ignition interlocks' },
  { chapter: '814', name: 'ORS Chapter 814: Pedestrians; Passengers; Livestock; Motorcycles; Bicycles; Motor Assisted Scooters', why: 'the rules for pedestrians, passengers, mopeds, motorcycles and bicycles a driver shares the road with' },
  { chapter: '815', name: 'ORS Chapter 815: Vehicle Equipment Generally', why: 'brakes, mirrors, horns, windows, tires, belts and the equipment a vehicle must have' },
  { chapter: '816', name: 'ORS Chapter 816: Vehicle Equipment: Lights', why: 'the lights a vehicle must have and when they must be dimmed' },
  {
    chapter: '153',
    name: 'ORS Chapter 153, Sections 153.012 to 153.021: Violations and Fines',
    why: 'the classes of traffic violation and the fines for each, which the vehicle code names but does not state',
    keep: ['153.012', '153.018', '153.019', '153.020', '153.021'],
  },
  {
    chapter: '163',
    name: 'ORS Chapter 163, Sections 163.149 and 163.196: Offenses Against Persons',
    why: 'aggravated vehicular homicide and aggravated driving while suspended, codified in the criminal code',
    keep: ['163.149', '163.196'],
  },
  {
    chapter: '471',
    name: 'ORS Chapter 471, Section 471.430: Purchase or possession of alcoholic beverages by person under 21',
    why: 'underage purchase and possession of alcohol, codified in the liquor law',
    keep: ['471.430'],
  },
]

/** "811.550" -> "ORS 811.550", Oregon's own citation form. */
export function cite(section: string): string {
  return `ORS ${section}`
}

export const chapterUrl = (chapter: string) => `${ORIGIN}ors${chapter}.html`

interface Paragraph {
  /** The paragraph's leading bold run: a section's number and catchline, "Note:", or a bare number. */
  bold: string
  text: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A chapter page as its paragraphs, in order, empty ones dropped. */
export function paragraphsOf(html: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const [, inner] of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    let bold = ''
    let depth = 0
    let leading = true
    for (const [token] of inner.matchAll(/<[^>]+>|[^<]+/g)) {
      if (/^<b\b/i.test(token)) depth += 1
      else if (/^<\/b>/i.test(token)) depth = Math.max(0, depth - 1)
      else if (!token.startsWith('<')) {
        const text = decode(token)
        if (depth === 0 && text.trim().length > 0) leading = false
        if (depth > 0 && leading) bold += text
      }
      if (!leading) break
    }
    const text = inline(inner)
    if (text.length > 0) out.push({ bold: bold.replace(/\s+/g, ' ').trim(), text })
  }
  return out
}

/** "811.550 Places where stopping, standing and parking prohibited." -> its number and catchline. */
function opening(paragraph: Paragraph): { section: string; catchline: string } | null {
  const match = /^(\d{3}\.\d{3,4}) (\S.*)$/.exec(paragraph.bold)
  return match === null ? null : { section: match[1], catchline: match[2] }
}

/** Sections a note says are not yet in force, "Note: 801.373 becomes operative January 1, 2027.", as of `today`. */
function notYetOperative(paragraphs: Paragraph[], today: string): Set<string> {
  const out = new Set<string>()
  for (const { text } of paragraphs) {
    const note = /^Note: (\d{3}\.\d{3,4}) becomes operative (\w+) (\d{1,2}), (\d{4})/.exec(text)
    if (note === null) continue
    const month = MONTHS.indexOf(note[2])
    if (month < 0) throw new Error(`an operative date this cannot read: ${text.slice(0, 80)}`)
    const iso = `${note[4]}-${String(month + 1).padStart(2, '0')}-${note[3].padStart(2, '0')}`
    if (iso > today) out.add(note[1])
  }
  return out
}

/** A chapter page's sections in effect and their catchlines, in the page's order. */
export function sectionsOf(html: string, today = new Date().toISOString().slice(0, 10)): { section: string; heading: string }[] {
  const paragraphs = paragraphsOf(html)
  const future = notYetOperative(paragraphs, today)
  const out: { section: string; heading: string }[] = []
  const seen = new Set<string>()
  for (const paragraph of paragraphs) {
    const opened = opening(paragraph)
    if (opened === null || future.has(opened.section)) continue
    if (seen.has(opened.section)) throw new Error(`${opened.section} opens twice on its chapter's page`)
    seen.add(opened.section)
    out.push({ section: opened.section, heading: opened.catchline.replace(/\.$/, '') })
  }
  return out
}

const site: Site = {
  // The Legislative Counsel Committee's Oregon Revised Statutes, on the Legislative Assembly's own site.
  official: ORIGIN,
  name: 'the Oregon Revised Statutes',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: chapter, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      const url = chapterUrl(title.chapter)
      for (const { section, heading } of sectionsOf((await fetchedPage(url).page).body)) {
        if (!section.startsWith(`${title.chapter}.`)) continue
        if (COMMERCIAL.has(section)) continue
        if (title.keep !== undefined && !title.keep.includes(section)) continue
        listings.push({ file: section.replace('.', '-'), url: `${url}#${section}`, section, cite: cite(section), heading })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
      if (title.keep !== undefined && listings.length - before !== title.keep.length) {
        throw new Error(`${title.name}: ${listings.length - before} of ${title.keep.length} kept sections found`)
      }
    }
    return listings
  },
  extract: (html, listing) => extractOrs(html, listing.section),
}

export default site

/**
 * A heading between sections: "PARKING, STOPPING AND STANDING", "(Generally)",
 * "CHAPTER 812" after a chapter's last section, "ENROLLED HOUSE BILL 3991 (2025
 * SPECIAL SESSION)" before a bill the Legislative Counsel prints after one,
 * pending a referendum and not in effect. Capitals with no full stop, so
 * a paragraph that is all capitals because it is only a citation -- 815.320's
 * "(B) ORS 803.591." -- is still the section's.
 */
function isHeading(text: string): boolean {
  return /^[A-Z][A-Z0-9 ,;&’'()-]*[A-Z0-9)]$/.test(text) && /[A-Z]{2}/.test(text) || /^\([A-Z][a-z][A-Za-z ,;’'-]*\)$/.test(text)
}

/** A rule drawn across the page, "_______________": above and below a table, and after a chapter's last section. Not words. */
const RULE = /^_+$/

/** The Legislative Counsel's history at a section's foot: "[1983 c.338 §669; 2019 c.232 §2]", "[Formerly 483.130]". */
const HISTORY = /\s*\[[^[\]]*(?:\b(?:19|20)\d\d c\.\d|[Ff]ormerly|[Rr]enumbered|[Aa]mended by)[^[\]]*\]$/

/**
 * One section's law in effect: its catchline on a line, then a line per
 * paragraph, up to the next bold paragraph (another section, a note, a future
 * copy) or a heading, without its history.
 */
export function extractOrs(html: string, section: string): string {
  const paragraphs = paragraphsOf(html)
  const starts = paragraphs.flatMap((paragraph, index) => (opening(paragraph)?.section === section ? [index] : []))
  if (starts.length === 0) throw new Unavailable(`the page has no section ${section}`)
  if (starts.length > 1) throw new Error(`${section} opens ${starts.length} times on one page`)
  const first = paragraphs[starts[0]]
  const lines = [first.bold]
  const rest = first.text.slice(first.text.indexOf(first.bold) + first.bold.length).trim()
  if (first.text.indexOf(first.bold) !== 0) throw new Error(`${section}'s catchline is not where its paragraph opens`)
  if (rest.length > 0) lines.push(rest)
  for (const paragraph of paragraphs.slice(starts[0] + 1)) {
    if (paragraph.bold.length > 0 || isHeading(paragraph.text)) break
    if (RULE.test(paragraph.text)) continue
    lines.push(paragraph.text)
  }
  const last = lines.length - 1
  lines[last] = lines[last].replace(HISTORY, '')
  const kept = lines.filter((line) => line.length > 0)
  if (kept.length < 2) throw new Unavailable('the page serves the catchline with no text')
  return kept.join('\n') + '\n'
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
