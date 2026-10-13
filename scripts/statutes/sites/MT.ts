/**
 * Montana: the Montana Code Annotated as the Legislative Services Division
 * publishes it (mca.legmt.gov, the Legislature's own site; leg.mt.gov and
 * archive.legmt.gov redirect there). An index-page `enumerate`, as Maryland's:
 * each part of a chapter has a `sections_index.html` listing its sections with
 * their numbers and catchlines, and each section is a page of its own.
 *
 * The pages carry a bot-management script in their head, but the law is in
 * the HTML as served: nothing is assembled in the browser.
 *
 * Sections the index lists only as "Repealed", "Renumbered", "Terminated" or
 * "reserved" are not fetched: the index already says there is no law there,
 * and Title 61 keeps hundreds of them.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://mca.legmt.gov/bills/mca/'

/** Sections in a part, by number, kept or not. */
type Keep = (section: string) => boolean
const all: Keep = () => true
const except = (...numbers: string[]): Keep => (section) => !numbers.includes(section)
const only = (...numbers: string[]): Keep => (section) => numbers.includes(section)
const below = (last: number): Keep => (section) => Number(section.split('-')[2]) <= last

/**
 * The parts of the code a licence-holder is bound by. Out, and why: Title 61
 * chapter 2's traffic safety and EMS grant programs and the equipment safety
 * compact (parts 1, 2, 5) are the state's programs; chapter 3 part 1 is the
 * department's records and fees, part 4 special and personalized plates, part
 * 5 registration taxes and fees, and part 7 beyond § 61-3-707 proportional
 * registration of interstate fleets; chapter 4 is dealers and manufacturers;
 * chapter 6 part 4 is automated driving systems' makers; chapter 8 parts 8
 * and 9 are commercial motor vehicle safety and tow-truck businesses; chapter
 * 10 is size, weight and haul permits; chapter 11 parts 1 and 5 are court
 * reporting and records privacy; chapter 12 is local powers, abandoned
 * vehicles, identification cards, fines and dealers; chapter 14 is
 * rulemaking. Within the kept parts, commercial driver licensing (§§ 61-5-118,
 * -123, -141, -146, -147, -151) as every state so far leaves out, and the
 * department's own duties: lists for juries and the selective service (§§
 * 61-5-126 to -128), the compact's administration (§§ 61-5-403, -404), the
 * insurance verification system (§§ 61-6-157, -158, -309), accident report
 * forms and other reporters (§§ 61-7-111 to -113, -115), the traffic control
 * manual (§§ 61-8-202, -203), interlock providers (§ 61-8-1025), and school
 * bus inspection and rules (§§ 61-9-502, -504). § 61-8-385 is a short title
 * alone ("Sections 61-8-385 through 61-8-390 may be cited as…"), which names
 * its own number and so reads to the chunker as a heading over no law.
 */
const TITLES: { id: string; name: string; why: string; parts: { path: string; keep: Keep }[] }[] = [
  {
    id: '61-1',
    name: 'Title 61, Chapter 1: Definitions',
    why: 'what the code means by a vehicle, a moped, a highway or a driver',
    parts: [{ path: 'title_0610/chapter_0010/part_0010', keep: all }],
  },
  {
    id: '61-3',
    name: 'Title 61, Chapter 3, Parts 2, 3, 6 and 7: Certificates of Title and Registration',
    why: 'the title on a sale, registration, plates and their display, and the penalties for them',
    parts: [
      { path: 'title_0610/chapter_0030/part_0020', keep: except('61-3-225') },
      { path: 'title_0610/chapter_0030/part_0030', keep: except('61-3-318', '61-3-323', '61-3-324', '61-3-325', '61-3-336', '61-3-338', '61-3-345', '61-3-346', '61-3-347') },
      { path: 'title_0610/chapter_0030/part_0060', keep: all },
      { path: 'title_0610/chapter_0030/part_0070', keep: below(707) },
    ],
  },
  {
    id: '61-5',
    name: "Title 61, Chapter 5: Driver's Licenses (except commercial licensing)",
    why: "licences, the learner licence, the first-year restrictions on a minor's licence, suspension, revocation and driving while suspended",
    parts: [
      { path: 'title_0610/chapter_0050/part_0010', keep: except('61-5-118', '61-5-123', '61-5-126', '61-5-127', '61-5-128', '61-5-141', '61-5-146', '61-5-147', '61-5-151') },
      { path: 'title_0610/chapter_0050/part_0020', keep: all },
      { path: 'title_0610/chapter_0050/part_0030', keep: all },
      { path: 'title_0610/chapter_0050/part_0040', keep: except('61-5-403', '61-5-404') },
    ],
  },
  {
    id: '61-6',
    name: 'Title 61, Chapter 6, Parts 1 to 3: Responsibility of Vehicle Users and Owners',
    why: 'the insurance every vehicle must carry, its minimum limits, the proof of it and the penalties for driving uninsured',
    parts: [
      { path: 'title_0610/chapter_0060/part_0010', keep: except('61-6-157', '61-6-158') },
      { path: 'title_0610/chapter_0060/part_0020', keep: all },
      { path: 'title_0610/chapter_0060/part_0030', keep: except('61-6-309') },
    ],
  },
  {
    id: '61-7',
    name: 'Title 61, Chapter 7: Accidents and Accident Reports',
    why: 'what a driver must do after a crash: stop, give information, render aid and report it',
    parts: [{ path: 'title_0610/chapter_0070/part_0010', keep: except('61-7-111', '61-7-112', '61-7-113', '61-7-115') }],
  },
  {
    id: '61-8',
    name: 'Title 61, Chapter 8 (except Parts 8 and 9): Traffic Regulation',
    why: 'the rules of the road -- signals, speed, passing, right of way, school buses, parking, pedestrians, bicycles -- driving under the influence, implied consent, open containers, and the penalties',
    parts: [
      { path: 'title_0610/chapter_0080/part_0010', keep: all },
      { path: 'title_0610/chapter_0080/part_0020', keep: except('61-8-202', '61-8-203') },
      { path: 'title_0610/chapter_0080/part_0030', keep: except('61-8-385') },
      { path: 'title_0610/chapter_0080/part_0040', keep: all },
      { path: 'title_0610/chapter_0080/part_0050', keep: all },
      { path: 'title_0610/chapter_0080/part_0060', keep: all },
      { path: 'title_0610/chapter_0080/part_0070', keep: all },
      { path: 'title_0610/chapter_0080/part_0100', keep: except('61-8-1025') },
    ],
  },
  {
    id: '61-9',
    name: 'Title 61, Chapter 9: Vehicle Equipment',
    why: 'lights and when to use them, brakes, mirrors, window tint, child restraints, motorcycle helmets for minors and the penalties',
    parts: [
      { path: 'title_0610/chapter_0090/part_0010', keep: all },
      { path: 'title_0610/chapter_0090/part_0020', keep: all },
      { path: 'title_0610/chapter_0090/part_0030', keep: all },
      { path: 'title_0610/chapter_0090/part_0040', keep: all },
      { path: 'title_0610/chapter_0090/part_0050', keep: except('61-9-502', '61-9-504') },
    ],
  },
  {
    id: '61-11',
    name: 'Title 61, Chapter 11, Part 2: Habitual Traffic Offenders',
    why: 'the point schedule for convictions and the revocation that follows too many points',
    parts: [{ path: 'title_0610/chapter_0110/part_0020', keep: all }],
  },
  {
    id: '61-2',
    name: 'Title 61, Chapter 2, Part 3: Driver Improvement Program',
    why: 'the driver improvement and rehabilitation program an offending driver may be required to complete',
    parts: [{ path: 'title_0610/chapter_0020/part_0030', keep: all }],
  },
  {
    id: '61-13',
    name: 'Title 61, Chapter 13: Seatbelts',
    why: 'who must wear a seatbelt and the fine for not doing so',
    parts: [{ path: 'title_0610/chapter_0130/part_0010', keep: all }],
  },
  {
    id: '45-5',
    name: 'Title 45, Chapter 5, Part 6 (§ 45-5-638): Offenses Against the Family -- possession of alcohol by a minor',
    why: 'underage possession of alcohol and the licence suspension that follows, codified in the criminal code',
    parts: [{ path: 'title_0450/chapter_0050/part_0060', keep: only('45-5-638') }],
  },
]

/** "61-8-354" -> "Mont. Code Ann. § 61-8-354", the form Montana's courts cite. */
export function cite(section: string): string {
  if (!/^\d+-\d+-\d+$/.test(section)) throw new Error(`not a Montana section: ${section}`)
  return `Mont. Code Ann. § ${section}`
}

const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A part's index: each section's page, number and catchline, as the index lists them. */
async function sectionsOf(path: string): Promise<{ url: string; section: string; catchline: string }[]> {
  const index = `${ORIGIN}${path}/sections_index.html`
  const response = await fetch(index, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`${index} answered ${response.status}`)
  const html = await response.text()
  const out: { url: string; section: string; catchline: string }[] = []
  const entry = /<a href="([^"]+)"><span class="citation">([^<]+)<\/span>&nbsp;([^<]*)<\/a>/g
  for (const match of html.matchAll(entry)) {
    // The index writes one href with a space before ".html" (61-5-107); the server answers it only encoded.
    out.push({ url: new URL(match[1], index).href, section: match[2].trim(), catchline: decode(match[3]).trim() })
  }
  if (out.length === 0) throw new Error(`${index} lists no sections: the page changed shape`)
  return out
}

/** A catchline that says there is no law at the number: nothing to fetch. */
const EMPTY = /^(Repealed|Renumbered|Terminated|reserved)\b|\breserved$/i

const site: Site = {
  // mca.legmt.gov is the Legislative Services Division's publication of the MCA.
  official: ORIGIN,
  name: 'the Montana Code Annotated',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      for (const part of title.parts) {
        for (const each of await sectionsOf(part.path)) {
          if (EMPTY.test(each.catchline) || !/^\d+-\d+-\d+$/.test(each.section) || !part.keep(each.section)) continue
          if (!each.section.startsWith(`${title.id}-`)) throw new Error(`${part.path} lists § ${each.section}, outside ${title.id}`)
          listings.push({ file: each.section, url: each.url, section: each.section, cite: cite(each.section), heading: each.catchline })
        }
        await pause(1000)
      }
    }
    return listings
  },
  extract: (html, listing) => extractMca(html, listing.section),
}

export default site

/**
 * The law of one MCA section page: the paragraphs of its `section-content`
 * block, the bold number and catchline that open the first paragraph dropped
 * (they are the listing's `heading`), the history and annotations after it
 * dropped. Only whitespace is changed within a line: the MCA separates a label
 * from its text with a tab ("(a)\ton a sidewalk;"), folded here to one space.
 *
 * A page holding more than one version of a section -- a temporary version
 * and the one that follows it, or a version with a future effective date --
 * is an error until the rule for choosing between them is written, rather
 * than a second copy committed as though it were in effect.
 */
export function extractMca(html: string, section: string): string {
  // A block runs to the next version, the history or the footer: a table inside it has divs of its own.
  const blocks = [...html.matchAll(/<div class="section-content">([\s\S]*?)(?=<div class="section-content">|<div class="history-doc"|<footer)/g)]
  if (blocks.length === 0) {
    if (/<title>[^<]*(404|Not Found)/i.test(html)) throw new Unavailable('the page is not found')
    throw new Error(`§ ${section}: no section-content block on the page`)
  }
  if (blocks.length > 1) throw new Error(`§ ${section}: ${blocks.length} versions on one page`)
  const block = blocks[0][1]
  const catchline = /<span class="catchline">([\s\S]*?<\/span>[\s\S]*?)<\/span>/.exec(block)
  if (catchline === null) throw new Error(`§ ${section}: no catchline, the page changed shape`)
  const lead = linesOf(catchline[1]).join(' ')
  if (!lead.startsWith(`${section}.`)) throw new Error(`§ ${section}: its catchline names another section: ${lead.slice(0, 60)}`)
  const lines = linesOf(block.slice(0, catchline.index) + block.slice(catchline.index + catchline[0].length))
  if (lines.length === 0) throw new Unavailable(`§ ${section} has no text`)
  return lines.join('\n') + '\n'
}

/** A fragment's paragraphs, one line each: tags dropped, whitespace folded. */
function linesOf(fragment: string): string[] {
  return decode(
    fragment
      .replace(/\s+/g, ' ')
      .replace(/<\/(p|tr|li|div)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
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
    .replace(/&frac12;/g, '½')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
