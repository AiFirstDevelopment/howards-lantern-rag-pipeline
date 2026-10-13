/**
 * Idaho: the Idaho Statutes as the Legislative Services Office publishes them
 * on the Legislature's site (legislature.idaho.gov), one section per page. An
 * index-page `enumerate`, as Maryland's: a chapter's page lists each section
 * with its catchline and the address of its page.
 *
 * Idaho keeps its vehicle code in Title 49, Motor Vehicles, and its impaired
 * driving in Title 18, Crimes and Punishments, chapter 80 -- so both are read.
 * A repealed section is not listed on its chapter's page at all, so there is
 * nothing to skip for it.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://legislature.idaho.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 49, and why: 10 is
 * the weight, size and oversize-permit rules for carriers; 16 dealers and
 * salesmen; 17 mechanics' liens; 18 the towing and storage trade; 19 the
 * western states' carrier agreement; 22 hazardous-materials carriers; 29 the
 * freight program; 37 ride-hailing companies; 11, 21, 23, 26, 28, 30 to 36 are
 * repealed, reserved or redesignated and list no sections. Of chapter 2, only
 * the sections that bind a driver or owner are in: the rest are the board's
 * and the department's duties, records and fees, and the local authorities'
 * powers. Of chapter 24, only the owner's liability and autocycles: the rest
 * are dealer franchising, service of process, ridesharing and identification
 * cards, none of them a rule of driving.
 */
const TITLES: {
  title: string
  chapter: string
  id: string
  name: string
  why: string
  /** Which of the chapter's sections are in, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  { title: '49', chapter: '1', id: 'id49-1', name: 'Title 49, Chapter 1: Definitions', why: 'what the code means by a vehicle, a moped, a highway, a driver and the rest' },
  {
    title: '49',
    chapter: '2',
    id: 'id49-2',
    name: 'Title 49, Chapter 2: General',
    why: 'disability parking, operating a vehicle without the owner\'s consent and the other vehicle offences, and the general penalty for the title',
    keep: (section) => ['49-213', '49-226', '49-227', '49-228', '49-229', '49-232', '49-235', '49-236', '49-238', '49-240', '49-244'].includes(section),
  },
  { title: '49', chapter: '3', id: 'id49-3', name: "Title 49, Chapter 3: Motor Vehicle Driver's Licenses", why: 'licensing, the instruction permit and graduated licence, the classes, points, suspension and revocation' },
  { title: '49', chapter: '4', id: 'id49-4', name: 'Title 49, Chapter 4: Motor Vehicle Registration', why: 'registration and plates every owner must hold' },
  { title: '49', chapter: '5', id: 'id49-5', name: 'Title 49, Chapter 5: Vehicle Titles', why: 'the certificate of title every owner must hold and transfer' },
  { title: '49', chapter: '6', id: 'id49-6', name: 'Title 49, Chapter 6: Rules of the Road', why: 'the rules of the road: speed, right of way, turning, stopping and parking, seat belts and child restraints' },
  { title: '49', chapter: '7', id: 'id49-7', name: 'Title 49, Chapter 7: Pedestrians and Bicycles', why: 'a driver\'s duties to pedestrians and cyclists, and theirs' },
  { title: '49', chapter: '8', id: 'id49-8', name: 'Title 49, Chapter 8: Signs, Signals and Markings', why: 'obeying traffic-control devices and what each signal means' },
  { title: '49', chapter: '9', id: 'id49-9', name: 'Title 49, Chapter 9: Vehicle Equipment', why: 'lights, brakes, mirrors, tires and the equipment a vehicle must have' },
  { title: '49', chapter: '12', id: 'id49-12', name: 'Title 49, Chapter 12: Motor Vehicle Financial Responsibility', why: 'the insurance every vehicle must carry and what follows a crash without it' },
  { title: '49', chapter: '13', id: 'id49-13', name: 'Title 49, Chapter 13: Accidents', why: 'what a driver must do after a crash' },
  { title: '49', chapter: '14', id: 'id49-14', name: 'Title 49, Chapter 14: Traffic — Enforcement and General Provisions', why: 'reckless and distracted driving, eluding, passing a school bus, racing, citations and arrest' },
  { title: '49', chapter: '15', id: 'id49-15', name: 'Title 49, Chapter 15: Traffic Infractions', why: 'what a traffic infraction is and its penalty' },
  { title: '49', chapter: '20', id: 'id49-20', name: 'Title 49, Chapter 20: Driver License Compact', why: 'how a conviction in another state counts against an Idaho licence' },
  {
    title: '49',
    chapter: '24',
    id: 'id49-24',
    name: 'Title 49, Chapter 24: Miscellaneous',
    why: "an owner's liability for a minor's or another driver's negligence, and the autocycle rules",
    keep: (section) => ['49-2416', '49-2417', '49-2448'].includes(section),
  },
  { title: '49', chapter: '25', id: 'id49-25', name: 'Title 49, Chapter 25: Nonresident Violator Compact', why: 'what happens to a citation a driver receives in another member state' },
  { title: '49', chapter: '27', id: 'id49-27', name: 'Title 49, Chapter 27: Funeral Processions', why: 'yielding to and driving in a funeral procession' },
  { title: '18', chapter: '80', id: 'id18-80', name: 'Title 18, Chapter 80: Motor Vehicles', why: 'driving without privileges, impaired driving, the under-21 limit, implied consent and testing, leaving the scene, and the ignition interlock, codified in the criminal code' },
  {
    title: '18',
    chapter: '40',
    id: 'id18-40',
    name: 'Title 18, Chapter 40, Sections 18-4006 and 18-4007: Manslaughter',
    why: 'vehicular manslaughter and its punishment, codified in the criminal code',
    keep: (section) => section === '18-4006' || section === '18-4007',
  },
  {
    title: '23',
    chapter: '5',
    id: 'id23-5',
    name: 'Title 23, Chapter 5, Section 23-505: Transportation of alcoholic beverages',
    why: 'the open-container rule, codified in the alcoholic beverages title',
    keep: (section) => section === '23-505',
  },
  {
    title: '23',
    chapter: '6',
    id: 'id23-6',
    name: 'Title 23, Chapter 6, Section 23-604: Minors — purchase, consumption or possession prohibited',
    why: 'underage possession of alcohol and the licence suspension for it, codified in the alcoholic beverages title',
    keep: (section) => section === '23-604',
  },
]

/** The state's own citation form: "Idaho Code § 49-654". */
export function cite(section: string): string {
  return `Idaho Code § ${section}`
}

function chapterUrl(title: string, chapter: string): string {
  return `${ORIGIN}statutesrules/idstat/Title${title}/T${title}CH${chapter}/`
}

export function sectionUrl(title: string, chapter: string, section: string): string {
  return `${chapterUrl(title, chapter)}SECT${section}/`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`legislature.idaho.gov answered ${response.status} for ${url}`)
  return response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** The sections a chapter's page lists: a row of "<a …SECT49-654>49-654</a>", a spacer cell, and the catchline. */
export function sectionsListed(html: string): { section: string; heading: string }[] {
  return [...html.matchAll(/SECT(\d+-[\dA-Z]+)\/?">[^<]*<\/a><\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, section, heading]) => ({
    section,
    heading: sentenceCase(inline(heading).replace(/\.$/, '')),
  }))
}

const site: Site = {
  // The Idaho Statutes as the Legislative Services Office publishes them for the Legislature.
  official: ORIGIN,
  name: 'the Idaho Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const { section, heading } of sectionsListed(await page(chapterUrl(title.title, title.chapter)))) {
        if (!section.startsWith(`${title.title}-`)) continue
        if (title.keep !== undefined && !title.keep(section)) continue
        listings.push({ file: `${title.id}-${section}`, url: sectionUrl(title.title, title.chapter, section), section, cite: cite(section), heading })
      }
      // A chapter page read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the page for Title ${title.title} chapter ${title.chapter} lists nothing kept`)
      await pause()
    }
    return listings
  },
  extract: (html, listing) => extractIdaho(html, listing.section),
}

export default site

/**
 * One section's text from its page: the paragraphs the Legislature's
 * typesetter emits as one `<div>` each, from the line that opens with the
 * section's number to the "History:" that follows the law. The title and
 * chapter banners above it and the history below it are not law. The opening
 * line carries the catchline and the first subsection together --
 * "49-213. Parking spaces … — Enforcement. (1) Local governments …" -- and is
 * cut after the catchline, so the chunker sees "(1)" where it opens a line.
 *
 * Only the version in effect is kept: a section amended for a later date is
 * served as two copies, each headed by its number, and the text a learner is
 * bound by today is the one without "EFFECTIVE" in its heading or marked
 * "until"; anything else is refused rather than guessed.
 */
export function extractIdaho(html: string, section: string): string {
  const start = html.indexOf('<div class="pgbrk"')
  if (start < 0) throw new Error(`§ ${section}: no statute block on the page`)
  const end = html.indexOf('How current is this law?', start)
  const block = html.slice(start, end < 0 ? undefined : end)
  const lines = [...block.matchAll(/<div style="[^"]*">([\s\S]*?)<\/div>/g)].map(([, inner]) => ({ inner, text: inline(inner) })).filter((line) => line.text !== '')
  const escaped = section.replace(/[.]/g, '\\.')
  const opens = new RegExp(`^${escaped}\\.(\\s|$)`)
  const starts = lines.flatMap((line, index) => (opens.test(line.text) ? [index] : []))
  if (starts.length === 0) {
    if (/\[?(REPEALED|RESERVED|REDESIGNATED)\]?/i.test(lines.map((line) => line.text).join(' '))) throw new Unavailable('the page keeps only a repealed marker')
    throw new Error(`§ ${section}: the page does not carry the section`)
  }
  let begin = starts[0]
  if (starts.length > 1) {
    const current = starts.filter((index) => !/\bEFFECTIVE\b/i.test(lines[index].text.slice(0, 400)) || /\bEFFECTIVE UNTIL\b/i.test(lines[index].text.slice(0, 400)))
    if (current.length !== 1) throw new Error(`§ ${section} is served ${starts.length} times and none is plainly the version in effect`)
    begin = current[0]
  }
  const out: string[] = []
  for (let index = begin; index < lines.length; index += 1) {
    if (index > begin && (/^History:?$/.test(lines[index].text) || starts.includes(index))) break
    if (index === begin) {
      // The catchline is the uppercase-styled span after the number.
      const catchline = /<span style="text-transform: uppercase">([\s\S]*?)<\/span>/.exec(lines[index].inner)
      const headingEnd = catchline === null ? -1 : lines[index].text.indexOf(inline(catchline[1])) + inline(catchline[1]).length
      const head = headingEnd > 0 ? lines[index].text.slice(0, headingEnd).trim() : lines[index].text
      const rest = headingEnd > 0 ? lines[index].text.slice(headingEnd).trim() : ''
      out.push(head)
      if (rest !== '') out.push(rest)
      continue
    }
    out.push(lines[index].text)
  }
  if (out.length < 2) {
    if (/\b(repealed|reserved|redesignated)\b/i.test(out[0] ?? '')) throw new Unavailable('the page keeps only a repealed marker')
    throw new Error(`§ ${section} came back with no text`)
  }
  return out.join('\n') + '\n'
}

/** "PARKING SPACES — MARKING" → "Parking spaces — marking": the listing is set in capitals, the page in sentence case. */
function sentenceCase(text: string): string {
  const lower = text.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ')
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
