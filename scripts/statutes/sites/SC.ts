/**
 * South Carolina: the Code of Laws as the General Assembly's Legislative
 * Services Agency publishes it (scstatehouse.gov/code), unannotated. A
 * chapter-page `enumerate`: one page per chapter holds every section of it, in
 * article order, so a section's URL is that page with the section's number as
 * its fragment, and fetch.ts reads each page once per run.
 *
 * Each section is a bold "SECTION 56-5-2530." and its catchline, its
 * paragraphs a line each, then "HISTORY:" with the session laws and, under it,
 * the Code Commissioner's "Editor's Note" and "Effect of Amendment" -- none of
 * it law, all of it dropped. A table (the fee schedule in § 56-3-660) is a line
 * per row, its cells joined by a space.
 *
 * A subsection amended for a later date is served twice inside its section,
 * each copy under a line "Text of (B) effective until May 12, 2026." and
 * "Text of (B) effective May 12, 2026." (§ 56-5-750). `extract` keeps the copy
 * in force on the day it runs and drops the other, and refuses a "Text of"
 * line it cannot read rather than guess which copy is the law.
 *
 * South Carolina labels its subsections "(A)", "(1)", "(a)", a paragraph each,
 * which the chunker reads as they are; nothing in the text is rewritten but
 * whitespace.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.scstatehouse.gov/code/'

/**
 * The chapters a licence-holder is bound by, and within them the articles.
 * Out of Title 56, and why: 11 the road tax on motor carriers; 14 to 16 and 37
 * dealers and manufacturers; 17 the penalty for a dealer's or licensee's
 * records; 19 certificates of title, a record of ownership rather than a rule of
 * driving; 21 traffic at state institutions; 23 driver training schools; 25 the
 * nonresident violator compact between agencies; 27 house movers; 28 lemon-law
 * warranties; 29 chop shops; 31 rental companies; 32 damage disclosure by
 * sellers; 35 idling of commercial diesel vehicles; 36 car-sharing programmes.
 * Within the chapters kept, the articles left out are named on each.
 */
const TITLES: {
  title: string
  chapter: string
  name: string
  why: string
  /** The articles kept, where not the whole chapter. */
  articles?: string[]
  /** The sections kept, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  {
    title: '56',
    chapter: '1',
    name: "S.C. Code Ann. Title 56, Chapter 1: Driver's License (Articles 1, 2, 3, 5, 7 and 9)",
    why: "licensing, the beginner's permit and the conditional and special restricted licences, points, habitual offenders, the provisional licence after a DUI, and mopeds",
    // Out: Articles 13 and 14, the commercial driver's licence and its drug
    // testing, which every state so far has left out because its permit and
    // alcohol rules crowd out the ordinary ones; Article 15, identification
    // cards, which license nobody to drive.
    articles: ['1', '2', '3', '5', '7', '9'],
  },
  {
    title: '56',
    chapter: '2',
    name: 'S.C. Code Ann. Title 56, Chapter 2: Specialized Vehicles (Articles 1, 3 and 4)',
    why: 'golf carts and low-speed vehicles on the highway, the moped licence and its rules, and their penalties',
    // Out: Article 2, the county property tax on a registration.
    articles: ['1', '3', '4'],
  },
  {
    title: '56',
    chapter: '3',
    name: 'S.C. Code Ann. Title 56, Chapter 3: Motor Vehicle Registration and Licensing (Articles 1, 3, 5, 9, 17, 18 and 27)',
    why: 'registration every owner must hold, its fees, plates and the registration card, disability plates and placards and the parking they allow, and the enforcement of it all',
    // Out: Article 4 the release of DMV records; 6 corporate fleets; 10 to 16,
    // 19 to 24, 28 and on, the hundred-odd special plates, one per office,
    // cause or club; 25 and 26 dealers' plates and special registrations for
    // businesses; 29, 30 and 32 temporary plates for out-of-state, research and
    // trailer registrations.
    articles: ['1', '3', '5', '9', '17', '18', '27'],
  },
  {
    title: '56',
    chapter: '5',
    name: 'S.C. Code Ann. Title 56, Chapter 5: Uniform Act Regulating Traffic on Highways',
    why: 'the rules of the road: signals, speed, passing, right of way, parking, school buses, impaired driving, pedestrians, bicycles, motorcycles, equipment, seat belts and child seats',
    // Out: Article 33, size, weight and load, motor-carrier regulation; 39 to
    // 41, how police and property owners dispose of abandoned and salvaged
    // vehicles.
    articles: ['1', '3', '5', '7', '9', '11', '13', '15', '17', '19', '21', '23', '25', '26', '27', '29', '31', '35', '37', '43', '45', '47', '48'],
  },
  { title: '56', chapter: '7', name: 'S.C. Code Ann. Title 56, Chapter 7: Traffic Tickets', why: 'the uniform traffic ticket, proof of insurance at a stop and what an officer must tell a stopped driver' },
  { title: '56', chapter: '9', name: 'S.C. Code Ann. Title 56, Chapter 9: Motor Vehicle Financial Responsibility Act', why: 'reporting a crash, the security a driver must post after one, and proof of financial responsibility' },
  { title: '56', chapter: '10', name: 'S.C. Code Ann. Title 56, Chapter 10: Motor Vehicle Registration and Financial Security', why: 'the insurance every registered vehicle must carry, and driving an uninsured one' },
  {
    title: '61',
    chapter: '4',
    name: 'S.C. Code Ann. §§ 61-4-60, 61-4-90 and 61-4-110: Beer and Wine',
    why: 'false age to buy beer or wine, giving it to anyone under 21, and an open container of it in a vehicle, codified in the alcoholic beverages title',
    keep: ['61-4-60', '61-4-90', '61-4-110'],
  },
  {
    title: '61',
    chapter: '6',
    name: 'S.C. Code Ann. §§ 61-6-4020 and 61-6-4070: Alcoholic Liquors',
    why: 'an open container of liquor in a vehicle, and giving liquor to anyone under 21, codified in the alcoholic beverages title',
    keep: ['61-6-4020', '61-6-4070'],
  },
  {
    title: '63',
    chapter: '19',
    name: 'S.C. Code Ann. §§ 63-19-2440 and 63-19-2450: Underage Purchase, Consumption or Possession of Alcohol',
    why: 'underage drinking and possession, and the licence suspension it brings, codified in the Children\'s Code',
    keep: ['63-19-2440', '63-19-2450'],
  },
]

/** "56-5-2530" -> "S.C. Code Ann. § 56-5-2530". */
export function cite(section: string): string {
  return `S.C. Code Ann. § ${section}`
}

function chapterUrl(title: string, chapter: string): string {
  return `${ORIGIN}t${title}c${chapter.padStart(3, '0')}.php`
}

interface Piece {
  section: string
  heading: string
  article: string | undefined
  /** The section's HTML after its catchline, up to the next section or article. */
  html: string
  /** Printed more than once on its page: two versions this module has not been taught to choose between. */
  twice?: boolean
}

const SECTION = /<span style="font-weight: bold;">\s*SECTION ([^<]+?)\.<\/span>([^<]*)/g
const ARTICLE = /<div style="text-align: center;">ARTICLE ([0-9A-Z.]+)<\/div>/g

let parsed: { html: string; pieces: Map<string, Piece> } | null = null

/**
 * A chapter page's sections by number. Parsed once per page: `extract` is
 * called once per section, four hundred times on the same 700 KB of chapter 5.
 */
export function piecesOf(html: string): Map<string, Piece> {
  if (parsed?.html === html) return parsed.pieces
  const start = html.indexOf('<div id="contentsection">')
  if (start < 0) throw new Error('no contentsection on the page')
  const end = html.indexOf('<!-- mainwidepanel -->', start)
  const content = html.slice(start, end < 0 ? undefined : end)
  const articles = [...content.matchAll(ARTICLE)].map((match) => ({ at: match.index!, article: match[1] }))
  const heads = [...content.matchAll(SECTION)]
  const pieces = new Map<string, Piece>()
  for (const [index, head] of heads.entries()) {
    const at = head.index!
    const after = at + head[0].length
    const nextSection = heads[index + 1]?.index ?? content.length
    const nextArticle = articles.find((each) => each.at > at)?.at ?? content.length
    const section = head[1].trim()
    // A section printed twice is refused only where it is asked for: § 61-6-2220,
    // sales to intoxicated persons, is printed twice on the liquor chapter's
    // page, and is not one of the two sections read from it.
    if (pieces.has(section)) {
      pieces.get(section)!.twice = true
      continue
    }
    pieces.set(section, {
      section,
      heading: decode(head[2]).replace(/\s+/g, ' ').trim().replace(/\.$/, ''),
      article: articles.filter((each) => each.at < at).at(-1)?.article,
      html: content.slice(after, Math.min(nextSection, nextArticle)),
    })
  }
  parsed = { html, pieces }
  return pieces
}

/** A catchline that is all that is left of a section. */
const GONE = /^(Repealed|Reserved|Expired|Transferred|Renumbered|Omitted)\b/i

const site: Site = {
  // The General Assembly's own publication of the Code of Laws.
  official: ORIGIN,
  name: 'the South Carolina Code of Laws',
  titles: TITLES.map(({ title, chapter, name, why }) => ({ id: `${title}-${chapter}`, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const before = listings.length
      const url = chapterUrl(spec.title, spec.chapter)
      const { page, cached } = fetchedPage(url)
      for (const piece of piecesOf((await page).body).values()) {
        if (!piece.section.startsWith(`${spec.title}-${spec.chapter}-`)) continue
        if (GONE.test(piece.heading)) continue
        if (spec.articles !== undefined && (piece.article === undefined || !spec.articles.includes(piece.article))) continue
        if (spec.keep !== undefined && !spec.keep.includes(piece.section)) continue
        listings.push({ file: piece.section, url: `${url}#${piece.section}`, section: piece.section, cite: cite(piece.section), heading: piece.heading })
      }
      if (listings.length === before) throw new Error(`no sections found for ${spec.name}`)
      if (spec.keep !== undefined && listings.length - before !== spec.keep.length) throw new Error(`${spec.name}: found ${listings.length - before} of ${spec.keep.length} sections`)
      if (!cached) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return listings
  },
  extract: (html, listing) => extractSc(html, listing),
}

export default site

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function isoOf(text: string): string {
  const match = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(text.trim())
  const month = match === null ? 0 : MONTHS.indexOf(match[1].toLowerCase()) + 1
  // A date this cannot read could put either copy in effect; guessing would commit the wrong law.
  if (match === null || month === 0) throw new Error(`an effective date this cannot read: "${text}"`)
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/** "Text of (B) effective until May 12, 2026." / "Text of (B) effective May 12, 2026." */
const VARIANT = /^Text of ((?:\([A-Za-z0-9.]+\))+) effective (until )?(.+?)\.?$/

/** Where a notes block under a section begins: nothing from here on is law. */
const NOTES = /^(HISTORY:|Editor's Note$|Code Commissioner's Note$|Effect of Amendment$)/

/** Lines starting with a label of the same kind as `label`'s first: "(B)" -> any "(X)" in capitals. */
function sameKind(label: string): RegExp {
  const first = /^\(([^)]+)\)/.exec(label)![1]
  if (/^\d+$/.test(first)) return /^\(\d+\)/
  if (/^[A-Z]+$/.test(first)) return /^\([A-Z]+\)/
  if (/^[a-z]+$/.test(first)) return /^\([a-z]+\)/
  throw new Error(`a "Text of ${label}" label this cannot read`)
}

/**
 * One section's law in effect: its paragraphs, a line each, without the
 * catchline, the history or the notes -- and, where a subsection is served in
 * two copies, only the one in force on `today` (see the header).
 */
export function extractSc(html: string, listing: Pick<Listing, 'section'>, today = new Date().toISOString().slice(0, 10)): string {
  const piece = piecesOf(html).get(listing.section)
  if (piece === undefined) throw new Error(`no § ${listing.section} on the page`)
  if (piece.twice === true) throw new Error(`§ ${listing.section} appears twice on one page`)
  const all = paragraphs(piece.html)
  const notes = all.findIndex((line) => NOTES.test(line))
  const lines = notes < 0 ? all : all.slice(0, notes)
  const kept: string[] = []
  for (let index = 0; index < lines.length; ) {
    const line = lines[index]
    if (!/^Text of /.test(line)) {
      kept.push(line)
      index += 1
      continue
    }
    const variant = VARIANT.exec(line)
    if (variant === null) throw new Error(`§ ${listing.section}: a "Text of" line this cannot read: "${line}"`)
    const [, label, until, date] = variant
    const inForce = until !== undefined ? today < isoOf(date) : isoOf(date) <= today
    const kind = sameKind(label)
    let end = index + 1
    while (end < lines.length && !/^Text of /.test(lines[end]) && !(end > index + 1 && kind.test(lines[end]) && !lines[end].startsWith(label))) end += 1
    if (!lines[index + 1]?.startsWith(label)) throw new Error(`§ ${listing.section}: "${line}" is not followed by ${label}`)
    if (inForce) kept.push(...lines.slice(index + 1, end))
    index = end
  }
  if (kept.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return kept.join('\n') + '\n'
}

/**
 * A block's paragraphs, each one line; a table a line per row. Only the
 * page's `<br />` ends a line: its own newlines and tabs are whitespace.
 */
function paragraphs(block: string): string[] {
  const flat = block
    .replace(/\s+/g, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => '<br />' + table.replace(/<\/td>|<\/th>|<br\s*\/?>/gi, ' ').replace(/<\/tr>/gi, '\n') + '<br />')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|center)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decode(flat)
    .split('\n')
    .map((line) => line.replace(/[\s  ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
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
