/**
 * Florida: the Florida Statutes as the Legislature publishes them on Online
 * Sunshine (leg.state.fl.us). A chapter-page `enumerate`: a chapter's page
 * holds every section in it, so a section's URL is that page with the
 * section's number as its fragment, and fetch.ts reads each page once per run.
 * The few sections taken from outside Title XXIII are read from their own
 * one-section pages, so the insurance code is not a 5 MB chapter for fifteen
 * sections of it.
 *
 * Online Sunshine serves the current edition (the 2026 Florida Statutes), one
 * copy per section. What is not in effect lives only in the editors' notes
 * after a section's history -- "As amended by … effective July 1, 2026", a
 * redesignated paragraph -- and `extract` keeps the section body alone, so no
 * note's wording is ever filed as the law. A page serving a section twice is an
 * error, not a choice: that is how a future copy would arrive.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.leg.state.fl.us/statutes/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title XXIII, and why: 317
 * is off-highway vehicles, 321 the Highway Patrol itself, 323 wreckers and
 * towing companies. Out of chapter 320: motor vehicle and mobile-home dealers
 * and manufacturers (320.27 to 320.3211, 320.60 to 320.865), the
 * International Registration Plan's tax collection (320.405 to 320.417), the
 * farm, port and airport exemptions and license inspectors (320.51 to 320.58,
 * but for the penalties in 320.57 and 320.571). Out of chapter 322: the
 * commercial driver licence (322.53 to 322.64), as Maryland and Delaware leave
 * theirs out, and 322.43, a short title alone. Chapter 627 is insurance law but for the No-Fault Law, the
 * insurance every vehicle must carry; 562 is alcohol licensing but for the one
 * section a young driver is held to; 782 is homicide but for vehicular homicide.
 */
const TITLES: {
  chapter: string
  id: string
  name: string
  why: string
  /** Which of the chapter's sections are in, where not all of them are. */
  keep?: (section: number) => boolean
  /** Sections read from their own pages, in [from, to]: a chapter mostly out of scope. */
  range?: [number, number]
  /** The contents page listing those sections. */
  index?: string
}[] = [
  { chapter: '316', id: 'fl316', name: 'Chapter 316: State Uniform Traffic Control', why: 'definitions and the rules of the road: signals, right of way, speed, parking, school buses, impaired driving, phones, seat belts, child seats and equipment' },
  { chapter: '318', id: 'fl318', name: 'Chapter 318: Disposition of Traffic Infractions', why: 'the fines and court costs for breaking the rules above, and how a citation is answered' },
  { chapter: '319', id: 'fl319', name: 'Chapter 319: Title Certificates', why: 'the title every owner must hold, and what to do when a vehicle is sold' },
  {
    chapter: '320',
    id: 'fl320',
    name: 'Chapter 320: Motor Vehicle Licenses (registration and plates)',
    why: 'registration, plates, renewal and disabled parking permits every owner and driver is held to',
    keep: (n) => n < 320.27 || (n >= 320.37 && n <= 320.39) || n === 320.57 || n === 320.571,
  },
  {
    chapter: '322',
    id: 'fl322',
    name: 'Chapter 322: Driver Licenses',
    why: "licensing, the learner's licence and its limits for young drivers, points, suspension and revocation, and the under-21 alcohol limit",
    // 322.43 is one line, "Sections 322.43-322.48 shall be known as …": a short title, no rule, and a line
    // naming its own section reads to the chunker as the section's heading, so it committed as no law at all.
    keep: (n) => (n < 322.53 || n > 322.64) && n !== 322.43,
  },
  { chapter: '324', id: 'fl324', name: 'Chapter 324: Financial Responsibility', why: 'financial responsibility after a crash and the suspension for lacking it' },
  {
    chapter: '627',
    id: 'fl627',
    name: 'Chapter 627, Part XI, Sections 627.730 to 627.7405: Florida Motor Vehicle No-Fault Law',
    why: 'the personal injury protection every vehicle must carry, codified in the insurance code',
    // From 627.731: 627.730 is only the short title, a line naming its own number, which the chunker reads as
    // the heading and so commits as no law (as 322.43 below).
    range: [627.731, 627.7405],
    index: '0627/0627PartXIContentsIndex.html',
  },
  {
    chapter: '562',
    id: 'fl562',
    name: 'Chapter 562, Section 562.111: Possession of alcoholic beverages by persons under age 21',
    why: 'underage possession of alcohol, codified in the beverage law',
    range: [562.111, 562.111],
    index: '0562/0562ContentsIndex.html',
  },
  {
    chapter: '782',
    id: 'fl782',
    name: 'Chapter 782, Section 782.071: Vehicular homicide',
    why: 'the crime of killing someone by driving recklessly, codified in the criminal code',
    range: [782.071, 782.071],
    index: '0782/0782ContentsIndex.html',
  },
]

/** The state's own citation form: "Fla. Stat. § 316.1945". */
export function cite(section: string): string {
  return `Fla. Stat. § ${section}`
}

/** "0300-0399/0316": the folder Online Sunshine files a chapter under. */
function folder(chapter: string): string {
  const hundred = Math.floor(Number(chapter) / 100) * 100
  const pad = (n: number) => String(n).padStart(4, '0')
  return `${pad(hundred)}-${pad(hundred + 99)}/${pad(Number(chapter))}`
}

export function chapterUrl(chapter: string): string {
  return `${ORIGIN}index.cfm?App_mode=Display_Statute&URL=${folder(chapter)}/${chapter.padStart(4, '0')}.html`
}

export function sectionUrl(chapter: string, section: string): string {
  return `${ORIGIN}index.cfm?App_mode=Display_Statute&URL=${folder(chapter)}/Sections/${'0'.repeat(Math.max(0, 4 - section.indexOf('.')))}${section}.html`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`leg.state.fl.us answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** "316.1945&#x2003;" and "<span class="CatchlineText">Stopping, standing, or parking …</span>". */
// 562.111 carries a footnote marker before its number -- "<sup><a href="#1">1</a></sup>" -- and without the
// optional group its page read as serving no section at all.
const SECTION = /<div class="Section">(?:<sup>[\s\S]*?<\/sup>)?<span class="SectionNumber">([\d.]+[A-Za-z]?)&#x2003;<\/span>/g

interface Served {
  heading: string
  /** The section's own markup, from its catchline to its history. */
  body: string
}

/** A page's sections by number, each with every copy the page serves. */
function sectionsOf(html: string): Map<string, Served[]> {
  const sections = new Map<string, Served[]>()
  const starts = [...html.matchAll(SECTION)]
  for (const [index, match] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length
    const block = html.slice(match.index, end)
    const catchline = /<span[^>]*class="CatchlineText">([\s\S]*?)<\/span>/.exec(block)
    const bodyAt = block.indexOf('<span class="SectionBody">')
    // The history and the editors' notes follow the body: session laws, and amendments not yet in effect.
    const historyAt = block.indexOf('<div class="History">')
    const body = bodyAt < 0 ? '' : block.slice(bodyAt, historyAt < 0 ? block.length : historyAt)
    const served = { heading: catchline === null ? '' : inline(catchline[1]).replace(/\.$/, ''), body }
    sections.set(match[1], [...(sections.get(match[1]) ?? []), served])
  }
  return sections
}

/** The numbers and catchlines a contents page lists: `<a href="…/Sections/0627.733.html">627.733</a><div class="Catchline">Required security.</div>`. */
function contentsOf(html: string): { section: string; heading: string }[] {
  return [...html.matchAll(/<div class="IndexItem"><a href="[^"]*">([\d.]+[A-Za-z]?)<\/a><div class="Catchline">([\s\S]*?)<\/div>/g)].map(
    ([, section, heading]) => ({ section, heading: inline(heading).replace(/\.$/, '') }),
  )
}

const site: Site = {
  // The Florida Statutes as the Legislature's Office of Legislative Services publishes them.
  official: ORIGIN,
  name: 'the Florida Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      if (spec.range !== undefined) {
        const [from, to] = spec.range
        const contents = contentsOf(await page(`${ORIGIN}index.cfm?App_mode=Display_Statute&URL=${folder(spec.chapter).split('/')[0]}/${spec.index}`))
        const before = listings.length
        for (const { section, heading } of contents) {
          if (Number(section) < from || Number(section) > to) continue
          listings.push({ file: `${spec.id}-${section}`, url: sectionUrl(spec.chapter, section), section, cite: cite(section), heading })
        }
        // A contents page read as nothing listed none of the No-Fault Law on the first run, and the fetch
        // reported every listed section present: a title fetched as nothing has to be an error here.
        if (listings.length === before) throw new Error(`the contents page for ${spec.id} lists no section from ${from} to ${to}`)
      } else {
        const url = chapterUrl(spec.chapter)
        for (const [section, served] of sectionsOf(await page(url))) {
          if (spec.keep !== undefined && !spec.keep(Number(section))) continue
          listings.push({ file: `${spec.id}-${section}`, url: `${url}#${section}`, section, cite: cite(section), heading: served[0].heading })
        }
      }
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractSunshine(body, listing.section),
}

export default site

/**
 * One section's text: "§ <number>." on its own line, then a line per
 * subsection, paragraph and sub-paragraph, each opening with its label as the
 * statute prints it -- "(1)", "(a)", "1.", "a." -- and a line per table row.
 * Only the body: the catchline is the listing's heading, and the history and
 * notes after it are not law.
 */
export function extractSunshine(html: string, section: string): string {
  const served = sectionsOf(html).get(section)
  if (served === undefined) throw new Unavailable(`the page has no section ${section}`)
  if (served.length !== 1) throw new Error(`${section} is served ${served.length} times on one page`)
  const lines = served[0].body
    // A footnote marker inside a label -- "<sup>1</sup>(b)" -- would make the label "1(b)".
    .replace(/<sup>[\s\S]*?<\/sup>/gi, '')
    .replace(/<span class="Fraction">/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<td\b[^>]*>/gi, ' ')
    .replace(/<(div|p|tr)\b[^>]*>/gi, '\n')
    .split('\n')
    .map(inline)
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return [`§ ${section}.`, ...lines].join('\n') + '\n'
}

function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[\s  ]+/g, ' ')
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
