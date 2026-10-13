/**
 * Wisconsin: the Wisconsin Statutes as the Legislative Reference Bureau
 * publishes them for the Legislature at docs.legis.wisconsin.gov. A
 * chapter-page `enumerate`, read in windows: the chapter page
 * (`/statutes/statutes/346`) serves the chapter's first stretch of text, and
 * every page ends on a "Down" link (`/statutes/statutes/346/x/65/4?down=1`)
 * that serves the stretch around the last element it showed, the way the
 * reader's own scrolling does. Each element of the code is its own `<div>`
 * carrying `data-path` and `data-section`, so the windows are joined at the
 * paths they share and each section is read out of the joined chapter. A
 * section's URL is its own address on the site (`/document/statutes/346.53`,
 * which redirects into the chapter); its page alone is a window too, and cut
 * § 340.01 off at (9m) and § 346.65 at (4).
 *
 * robots.txt (docs.legis.wisconsin.gov), for `User-agent: *` and no other:
 * Disallow /frame, /scroll/, /feed/, /doc/feed/, /breadcrumbs/, /preferences,
 * /search and one PDF. /statutes/ and /document/ are not among them; the
 * reader's own infinite scroll (`/scroll/down/…`) is, and is never asked for.
 * No Crawl-delay; the fetch's second between requests stands, and `read`
 * keeps it between the windows of a chapter.
 *
 * **What is in effect.** The LRB publishes the statutes as affected by every
 * act through the date of the last update, and marks text that takes effect
 * later with an "Effective date note", in one of two shapes. "Sub. (1) is
 * shown as amended eff. 1-4-27 … Prior to 1-4-27 it reads:" serves the new
 * text and puts the text in force in the note after it; "Subd. 3. is amended
 * eff. 9-1-27 … to read:" serves the text in force and puts the new text in the
 * note. "Sub. (6) is created eff. 9-1-27" serves a subsection not yet law;
 * "This section is shown as renumbered from s. 347.413 … eff. 9-1-27" serves
 * a section not yet law (343.302, reported unavailable, while 347.413 keeps
 * the text in force). `extract` keeps, unit by unit, the copy in force today
 * by the note's own date (see FUTURE), and a note it does not know is an
 * error rather than a guess. On 2026-10-08 that swapped the text in force back
 * into 341.65 (2) (g), 342.40 (3) (c), 346.505 (1) and 346.70 (1), and left
 * out 343.30 (1qm) and 343.301 (6) to (9).
 *
 * Wisconsin labels subsections "(1)", "(1m)", "(2)", paragraphs "(a)",
 * "(am)", "(b)", subdivisions "1.", "2." and subdivision paragraphs "a.",
 * "b.", each element its own `<div>`, so a line per element is the code's
 * own layout. A subsection that opens straight on its first paragraph is
 * served as an element holding only "(2)" and then "(am) Any person…"; the
 * two are written as one line, "(2) (am) Any person…", a line break made a
 * space and nothing else. What is dropped: the section number and catchline
 * that open each section (the listing's heading), the hidden reference link
 * the site prints before every element ("346.53(3)", for its own
 * cross-reference tool, not shown to a reader), and every note -- the
 * history ("History: 1971 c. 219…"), the annotations of cases and articles,
 * cross-references and the LRB's own notes -- none of which the Legislature
 * enacted (s. 990.001 (6) says the history notes are not part of the
 * statutes). No typographic mark is dropped: the fee tables' no-break and
 * figure spaces are whitespace, and are read as a space.
 *
 * Four ways Wisconsin numbers that worker/src/code-chunks.ts does not read,
 * left as the LRB prints them (labels are not whitespace): a repealed
 * subsection leaves a gap ("(1)" then "(3)" in 346.89), and every subsection
 * after a gap is filed under the one before it; "(am)", "(gm)" and the other
 * two-letter paragraphs are cited as the paragraph before them; "(15ph)" and
 * the other three-character subsections are not read as labels at all; and
 * paragraph l is printed "(L)". The ids are right; the citations are not.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://docs.legis.wisconsin.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const PAUSE_MS = 1000

/** Sections a chapter keeps, when not all of it binds a licence-holder. */
const except = (...sections: string[]) => (section: string) => !sections.includes(section)
const between = (section: string, from: number, to: number) => Number(section) >= from && Number(section) <= to

/**
 * The chapters a licence-holder is bound by: Wisconsin's vehicle code is
 * chapters 340 to 351. Out, and why: 348, vehicle size, weight and load,
 * which binds carriers; 349, the powers of the state and of local
 * authorities; 350, snowmobiles, which are recreation off the road. Out of
 * the chapters taken: the commercial licence -- which every state so far has
 * left out because its permit and alcohol rules crowd out the ordinary ones
 * -- is not a chapter of its own here but six sections of ch. 343 (343.055,
 * 343.065, 343.12 school bus operators, 343.125 hazardous materials, 343.245,
 * 343.247, 343.315), left out by number; so are the department's own records
 * (343.025, 343.234 to 343.237), identification cards (343.50 to 343.52) and
 * the licensing of driver schools (343.60 to 343.75). Out of ch. 341: the
 * department's lists and pilot projects (341.17, 341.20, 341.21), the
 * interstate fleet plan, tribal and reciprocity agreements, audits and fuel
 * imports (341.405 to 341.45), and dealers', manufacturers' and finance
 * companies' plates (341.47 to 341.57). Out of ch. 342: salvage pools, dealer
 * transfers and the lender's security interest (342.157, 342.16, 342.19 to
 * 342.245). Out of ch. 344: rental companies' and human service vehicles'
 * insurance (344.51 to 344.579). A minor's possession of alcohol is s. 125.07,
 * in the alcohol beverages chapter; homicide and injury by intoxicated use
 * (940.09, 940.25) are in the criminal code's homicide chapter and are left
 * out with it.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; only?: string; keep?: (section: string) => boolean }[] = [
  { chapter: '340', id: 'ch340', name: 'Chapter 340: Vehicles -- General Provisions', why: 'what the vehicle code means by a vehicle, a moped, a highway, a crosswalk or an operator' },
  {
    chapter: '341',
    id: 'ch341',
    name: 'Chapter 341: Motor Vehicle Registration',
    why: 'registration and plates every owner must hold and display, the fees, and the penalties for misusing them',
    keep: (section) => !['341.17', '341.20', '341.21'].includes(section) && !between(section, 341.405, 341.57),
  },
  {
    chapter: '342',
    id: 'ch342',
    name: 'Chapter 342: Vehicle Title and Anti-Theft Law',
    why: 'the title every owner must hold, what buyer and seller must do at a sale, and abandoning a vehicle',
    keep: (section) => !['342.157', '342.16'].includes(section) && !between(section, 342.19, 342.245),
  },
  {
    chapter: '343',
    id: 'ch343',
    name: "Chapter 343: Operators' Licenses",
    why: 'the instruction permit, the probationary licence and its limits, the licence and its tests, implied consent, demerit points, suspension and revocation',
    keep: (section) =>
      !['343.025', '343.055', '343.065', '343.12', '343.125', '343.234', '343.235', '343.237', '343.245', '343.247', '343.315'].includes(section) &&
      !between(section, 343.5, 343.75),
  },
  {
    chapter: '344',
    id: 'ch344',
    name: 'Chapter 344: Vehicle Financial Responsibility',
    why: 'the insurance every vehicle must carry, the security after a crash, and the suspension for lacking either',
    keep: (section) => !between(section, 344.51, 344.579),
  },
  { chapter: '345', id: 'ch345', name: 'Chapter 345: Vehicles -- Civil and Criminal Liability; Procedure', why: "the traffic citation, arrest, deposits and forfeitures, and an owner's liability for a driver" },
  { chapter: '346', id: 'ch346', name: 'Chapter 346: Rules of the Road', why: 'the rules of the road: signals, right of way, speed, passing, parking, school buses, phones, crashes, and operating while intoxicated, with their penalties' },
  { chapter: '347', id: 'ch347', name: 'Chapter 347: Equipment of Vehicles', why: 'lights, brakes, mirrors, tyres, seat belts, child restraints, helmets and the equipment a vehicle must have' },
  { chapter: '351', id: 'ch351', name: 'Chapter 351: Habitual Traffic Offenders', why: 'the revocation a repeat offender faces and the penalty for driving under it' },
  {
    chapter: '125',
    id: 'ch125',
    name: 'Chapter 125, Section 125.07: Underage and intoxicated persons; presence on licensed premises; possession; penalties',
    why: 'underage purchase, possession and consumption of alcohol, codified in the alcohol beverages chapter',
    only: '125.07',
  },
]

/** The state's own citation form: "Wis. Stat. § 346.53". */
export function cite(section: string): string {
  return `Wis. Stat. § ${section}`
}

export function sectionUrl(section: string): string {
  return `${ORIGIN}document/statutes/${section}`
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS))

async function page(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`docs.legis.wisconsin.gov answered ${response.status} for ${url}`)
      return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS * 4 ** attempt))
    }
  }
}

/** One `<div>` of the code: a section's opening, a subsection, a paragraph, a note. */
export interface Element {
  /** "qsatxt_2subsect", "qsnote_history". */
  kind: string
  path: string
  /** "346.53"; '' for the chapter's own headings and table of contents. */
  section: string
  html: string
}

const ELEMENT = /<div class="(qs\w+)[^"]*"[^>]*?\sdata-path="([^"]*)"([^>]*)>/g

/** The elements of one served window, in order. */
export function elementsOf(html: string): Element[] {
  const start = html.indexOf('<div id="document"')
  if (start < 0) throw new Error('no document block on the page')
  const down = html.slice(start).search(DOWN)
  const end = down >= 0 ? start + down : html.indexOf('<div class="hidden">', start)
  if (end < 0) throw new Error('no end to the document block on the page')
  const region = html.slice(start, end)
  const opens = [...region.matchAll(ELEMENT)]
  return opens.map((match, index) => ({
    kind: match[1],
    path: match[2],
    section: /data-section="([^"]*)"/.exec(match[3])?.[1] ?? '',
    html: region.slice(match.index + match[0].length, index + 1 < opens.length ? opens[index + 1].index : region.length),
  }))
}

const DOWN = /<div class='navigation'><a href='([^']+\?down=1)'>Down<\/a><\/div>/

/**
 * A chapter's elements, in order, from its first window to its last -- or,
 * given one section, from the window around it to the first that shows the
 * section after it, so one section of a long chapter is a few requests and not
 * the chapter. Each window overlaps the one before it; it is joined at the last
 * path already read, and a window that does not contain that path is an error
 * rather than a gap in the law.
 */
async function walk(chapter: string, only?: string): Promise<Element[]> {
  const within = `/statutes/statutes/${chapter}/`
  const elements: Element[] = []
  const seen = new Set<string>()
  let url = only === undefined ? `${ORIGIN}statutes/statutes/${chapter}` : sectionUrl(only)
  for (;;) {
    const html = await page(url)
    const window = elementsOf(html).filter((element) => element.path.startsWith(within))
    const from = elements.length === 0 ? 0 : window.findIndex((element) => element.path === elements.at(-1)!.path) + 1
    if (from === 0 && elements.length > 0) throw new Error(`${url} does not overlap the window before it`)
    let added = 0
    for (const element of window.slice(from)) {
      if (seen.has(element.path)) throw new Error(`${element.path} is served twice in chapter ${chapter}`)
      seen.add(element.path)
      elements.push(element)
      added += 1
    }
    const down = DOWN.exec(html)?.[1]
    if (down === undefined || added === 0) break
    if (only !== undefined) {
      const last = elements.map((element) => element.section).lastIndexOf(only)
      if (last >= 0 && elements.slice(last + 1).some((element) => element.kind === 'qsatxt_1sect')) break
    }
    url = new URL(down.replace(/&amp;/g, '&'), ORIGIN).href
    await pause()
  }
  return elements
}

const chapters = new Map<string, Promise<Element[]>>()

/** A chapter (or the one section taken from it) read once per run, however many sections are taken from it. */
export function chapterOf(chapter: string, only?: string): Promise<Element[]> {
  const key = only ?? chapter
  if (!chapters.has(key)) {
    const read = walk(chapter, only)
    chapters.set(key, read)
    read.catch(() => chapters.delete(key))
  }
  return chapters.get(key)!
}

const titleOf = (section: string) => TITLES.find((title) => title.only === section) ?? TITLES.find((title) => title.chapter === section.split('.')[0] && title.only === undefined)

const site: Site = {
  // The Wisconsin Statutes as the Legislative Reference Bureau publishes them for the Legislature.
  official: ORIGIN,
  name: 'the Wisconsin Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const element of await chapterOf(title.chapter, title.only)) {
        if (element.kind !== 'qsatxt_1sect') continue
        const section = element.section
        if (title.only !== undefined && section !== title.only) continue
        if (title.keep !== undefined && !title.keep(section)) continue
        if (listings.some((listing) => listing.section === section)) throw new Error(`${section} opens twice in chapter ${title.chapter}`)
        listings.push({
          file: `${title.id}-${section}`,
          url: sectionUrl(section),
          section,
          cite: cite(section),
          heading: inline(spanOf(element.html, 'qstitle_sect') ?? '').replace(/\.$/, ''),
        })
      }
      // A chapter read as nothing would otherwise fetch as nothing and report every listed section present.
      if (listings.length === before) throw new Error(`chapter ${title.chapter} lists no section`)
      await pause()
    }
    return listings
  },
  async read(listing: Listing) {
    const title = titleOf(listing.section)
    if (title === undefined) throw new Error(`${listing.section} is in no chapter this module reads`)
    const elements = (await chapterOf(title.chapter, title.only)).filter((element) => element.section === listing.section)
    if (elements.length === 0) throw new Error(`chapter ${title.chapter} as served has no section ${listing.section}`)
    return elements.map((element) => `<div class="${element.kind}" data-path="${element.path}">${element.html}`).join('\n')
  },
  extract: (body, listing) => extractWi(body, listing.section),
}

export default site

/** The inner markup of the first `<span class="<name>">`, its nested spans balanced; null where there is none. */
function spanOf(html: string, name: string): string | null {
  const open = html.indexOf(`<span class="${name}">`)
  if (open < 0) return null
  const start = open + `<span class="${name}">`.length
  let depth = 1
  for (const match of html.slice(start).matchAll(/<(\/?)span\b[^>]*>/g)) {
    depth += match[1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(start, start + match.index)
  }
  throw new Error(`<span class="${name}"> is never closed`)
}

/** A line of text: tags dropped, entities decoded, every run of whitespace -- the no-break and figure spaces of the fee tables among it -- one space. */
function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[\s\u00a0\u2007\u2009\u202f]+/g, ' ')
    .trim()
}

/** The site's hidden reference marks: the cite before every element ("346.53(3)") and a note's own label ("Effective date text"). */
const unreferenced = (html: string) => html.replace(/<a class="reference"[^>]*>[\s\S]*?<\/a>/g, '').replace(/<span class="reference">[\s\S]*?<\/span>/g, '')

interface Part {
  kind: string
  path: string
  html: string
}

/** The text of an element as it reads, the section's number and catchline taken off its opening. */
function textOf(part: Part): string {
  let html = unreferenced(part.html)
  for (const name of ['qsnum_sect', 'qstitle_sect']) {
    const inner = spanOf(html, name)
    if (inner !== null) html = html.replace(`<span class="${name}">${inner}</span>`, '')
  }
  return inline(html)
}

/**
 * The LRB's note on text enacted for a later date: "Sub. (1) is shown as
 * amended eff. 1-4-27 by 2025 Wis. Act 196.  Prior to 1-4-27 it reads:", then
 * the text in force. Every such note this module has met is one of these, and
 * one it does not know is an error rather than a guess at which words are law.
 */
const FUTURE = /^NOTE:\s*(Sub\.|Par\.|Subd\.|This section)\s*(?:\(([^)]+)\)|(\d+[a-z]*)\.)?\s*is\s+(shown as amended|amended|created|repealed|shown as renumbered from|renumbered to)\b[\s\S]*?\beff\.\s*(\d{1,2})-(\d{1,2})-(\d{2})\b([\s\S]*)$/

const today = () => new Date().toISOString().slice(0, 10)

/** One section's text in force: a line per element, each opening with its label as the code prints it. */
export function extractWi(body: string, section: string): string {
  let parts: Part[] = [...body.matchAll(/<div class="(\w+)" data-path="([^"]*)">/g)].map((match, index, all) => ({
    kind: match[1],
    path: match[2],
    html: body.slice(match.index + match[0].length, index + 1 < all.length ? all[index + 1].index : body.length),
  }))
  const opening = parts.find((part) => part.kind === 'qsatxt_1sect')
  if (opening === undefined) throw new Error(`${section} has no opening element`)
  for (const [index, note] of [...parts.entries()].filter(([, part]) => part.kind === 'qsnote_note')) {
    const text = inline(unreferenced(note.html))
    if (!/\beff\./.test(text)) continue
    const future = FUTURE.exec(text)
    if (future === null) throw new Error(`${section}: an effective-date note this module does not know: ${text}`)
    const [, unit, bracketed, dotted, treatment, month, day, year, rest] = future
    const effective = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const pending = effective > today()
    // The note's own text in force or to come: the elements after it the site labels "Effective date text".
    const replacement: Part[] = []
    for (const part of parts.slice(index + 1)) {
      if (!part.html.includes('<span class="reference">Effective date text</span>')) break
      replacement.push(part)
    }
    if (unit === 'This section') {
      // Renumbered here from another section, or away to one, on a later date: the copy served is not the law today.
      if ((treatment === 'shown as renumbered from' && pending) || (treatment === 'renumbered to' && !pending)) {
        throw new Unavailable(`not in effect: ${text}`)
      }
      if (treatment === 'shown as renumbered from' || treatment === 'renumbered to') continue
      throw new Error(`${section}: an effective-date note on the whole section this module does not know: ${text}`)
    }
    const label = bracketed ?? dotted
    const trail = note.path.split('/').filter((piece) => piece !== '' && !/^_\d+$/.test(piece))
    const at = trail.lastIndexOf(label)
    if (at < 0) throw new Error(`${section}: the note names ${unit} ${label}, which is not on its path ${note.path}`)
    const unitPath = '/' + trail.slice(0, at + 1).join('/')
    const inUnit = (part: Part) => !part.kind.startsWith('qsnote') && (part.path === unitPath || part.path.startsWith(unitPath + '/'))
    // Which copy is in force: "shown as amended … Prior to <date> it reads:" serves the new text and notes the old;
    // "amended … to read:" serves the old and notes the new; "created" serves text not yet law; "repealed" serves text still law.
    const noted =
      treatment === 'shown as amended' ? (/Prior to/.test(rest) ? pending : null) : treatment === 'amended' ? (/to read/.test(rest) ? !pending : null) : false
    if (noted === null) throw new Error(`${section}: an effective-date note this module does not know: ${text}`)
    const dropped = (treatment === 'created' && pending) || (treatment === 'repealed' && !pending) || noted
    if (noted && replacement.length === 0) throw new Error(`${section}: the note says the text in force follows it, and none does`)
    if (!dropped) continue
    const first = parts.findIndex(inUnit)
    if (first < 0) throw new Error(`${section}: the note names ${unitPath}, which the section does not serve`)
    const kept = parts.filter((part) => !inUnit(part))
    const inForce = noted ? replacement.map((part) => ({ ...part, kind: 'qsatxt_noted' })) : []
    parts = [...kept.slice(0, first), ...inForce, ...kept.slice(first)]
  }
  const lines = parts
    .filter((part) => part.kind.startsWith('qsatxt') || part.kind === 'qsanomaly')
    .map(textOf)
    .filter((line) => line.length > 0)
  // A subsection that opens on its first paragraph is served as "(2)" alone and then "(am) Any person…": one line, as printed.
  const joinedLines: string[] = []
  for (const line of lines) {
    const previous = joinedLines.at(-1)
    if (previous !== undefined && /^(\([0-9a-z]+\)\s*|\d+[a-z]*\.\s*)+$/.test(previous)) joinedLines[joinedLines.length - 1] = `${previous} ${line}`
    else joinedLines.push(line)
  }
  if (joinedLines.length === 0) throw new Unavailable('the site serves the catchline with no text')
  return joinedLines.join('\n') + '\n'
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
