/**
 * Delaware: the Delaware Code Online (delcode.delaware.gov), published by the
 * Legislative Council's Division of Research. A chapter-page `enumerate`: a
 * chapter's page -- or, where the chapter is split, each subchapter's page --
 * holds every section in it, so a section's URL is that page with the
 * section's number as its fragment, and fetch.ts reads each page once per run.
 *
 * A section amended for a later date is served more than once on one page,
 * each copy's catchline tagged "[Effective until Dec. 24, 2026]", "[Effective
 * Dec. 24, 2026; Effective until Mar. 5, 2027]" or "[Effective Mar. 6, 2027]".
 * `extract` keeps the one copy in effect today and only that one: a quote
 * found only in a later copy would be next year's law presented as today's.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://delcode.delaware.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 21, and why: 3 is
 * the departments themselves, 4 reciprocal agreements between agencies, 5 the
 * marking of highways by the department; 26 is the commercial licence; 31 and
 * 32 are identification cards and powers of attorney for DMV business; 33
 * licensed transporters; 44 abandoned vehicles, an agency's procedure; 45 size
 * and weight of loads and 47 motor carriers; 46 master keys; 63 and 64 the
 * sale of vehicles and odometers; 65 and 80 are repealed; 67 theft of
 * vehicles; 68 off-highway vehicles; 69 and 69A towing by police and by
 * property owners; 75 recyclers; 83 driving schools; 84, 86 and 87 dealer
 * agreements and car-sharing companies; 85 locomotive idling. Chapter 61's
 * sections 6101 to 6103 regulate rental companies.
 */
const TITLES: {
  title: string
  chapter: string
  id: string
  name: string
  why: string
  only?: string[]
  /** The one subchapter page holding `only`, so a few sections of the criminal code are not forty pages of it. */
  subchapter?: string
}[] = [
  { title: '21', chapter: '001', id: 'de21-c001', name: 'Title 21, Chapter 1: Definitions', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { title: '21', chapter: '007', id: 'de21-c007', name: 'Title 21, Chapter 7: Enforcement; Arrest, Bail and Appeal', why: 'arrest, summonses and what a stopped driver must do' },
  { title: '21', chapter: '008', id: 'de21-c008', name: 'Title 21, Chapter 8: Civil Traffic Offenses', why: 'how a civil traffic penalty is assessed and paid' },
  { title: '21', chapter: '021', id: 'de21-c021', name: 'Title 21, Chapter 21: Registration of Vehicles', why: 'registration, plates and the insurance every vehicle must carry' },
  { title: '21', chapter: '023', id: 'de21-c023', name: 'Title 21, Chapter 23: Title and Liens', why: 'the title every owner must hold' },
  { title: '21', chapter: '025', id: 'de21-c025', name: 'Title 21, Chapter 25: Transfer of Title, Registration and Liens', why: 'what an owner must do when a vehicle is sold' },
  { title: '21', chapter: '027', id: 'de21-c027', name: "Title 21, Chapter 27: Driver's License", why: 'licensing, the learner\'s permit and graduated licence, points, suspension and revocation' },
  { title: '21', chapter: '028', id: 'de21-c028', name: 'Title 21, Chapter 28: Habitual Offenders', why: 'the revocation a run of convictions brings' },
  { title: '21', chapter: '029', id: 'de21-c029', name: 'Title 21, Chapter 29: Motor Vehicle Safety-Responsibility', why: 'financial responsibility after a crash and the suspension for lacking it' },
  { title: '21', chapter: '041', id: 'de21-c041', name: 'Title 21, Chapter 41: Rules of the Road', why: 'the rules of the road: signals, right of way, speed, parking, school buses, impaired driving and phones' },
  { title: '21', chapter: '042', id: 'de21-c042', name: 'Title 21, Chapter 42: Reports of Accidents; Penalties', why: 'what a driver must do after a crash, and the general penalties for the rules above' },
  { title: '21', chapter: '043', id: 'de21-c043', name: 'Title 21, Chapter 43: Equipment and Construction of Vehicles', why: 'lights, brakes, mirrors, tint, helmets and the equipment a vehicle must have' },
  { title: '21', chapter: '048', id: 'de21-c048', name: 'Title 21, Chapter 48: Occupant Protection System Safety Act', why: 'seat belts and child restraints' },
  { title: '21', chapter: '061', id: 'de21-c061', name: "Title 21, Chapter 61: Civil Liability for Driver's Negligence (§§ 6104-6106)", why: "who answers for a minor driver's negligence: whoever signed the licence application", only: ['6104', '6105', '6106'] },
  { title: '21', chapter: '062', id: 'de21-c062', name: 'Title 21, Chapter 62: Traffic Stop Safety', why: 'the Blue Envelope a driver may hand an officer at a stop' },
  { title: '21', chapter: '070', id: 'de21-c070', name: 'Title 21, Chapter 70: Fire Lanes', why: 'parking in a fire lane and its penalty' },
  { title: '21', chapter: '071', id: 'de21-c071', name: 'Title 21, Chapter 71: Funeral Processions', why: 'how a driver must treat a funeral procession' },
  { title: '21', chapter: '081', id: 'de21-c081', name: "Title 21, Chapter 81: Driver's License Compact", why: 'how a conviction in another state counts against a Delaware licence' },
  { title: '4', chapter: '009', id: 'de4-c009', name: 'Title 4, Section 904: Offenses concerning certain persons', why: 'underage purchase, possession and consumption of alcohol, codified in the alcoholic-beverages title', only: ['904'] },
  { title: '11', chapter: '005', id: 'de11-c005', name: 'Title 11, Sections 628A to 630A: Vehicular Assault and Vehicular Homicide', why: 'the crimes of injuring or killing someone by driving, codified in the criminal code', only: ['628A', '629', '630', '630A'], subchapter: 'sc02' },
]

/** The state's own citation form: "21 Del. C. § 4179". */
export function cite(section: string, title = '21'): string {
  return `${title} Del. C. § ${section}`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`delcode answered ${response.status} for ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A chapter split into subchapters is served as UTF-8 bytes under a `<meta charset=utf-16>`: read by
  // its declaration, the page is CJK noise with no subchapter links in it, and the first run listed none
  // of chapters 21, 27, 41 or 43 -- the rules of the road gone without an error. No BOM, no UTF-16.
  if (bytes[0] === 0x3c) return new TextDecoder('utf-8').decode(bytes)
  return decoded(bytes, response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** The pages holding a chapter's sections: its subchapters' pages where it has them, and the chapter's own page too. */
async function pagesOf(title: string, chapter: string, subchapter?: string): Promise<{ url: string; html: string }[]> {
  if (subchapter !== undefined) {
    const url = `${ORIGIN}title${title}/c${chapter}/${subchapter}/index.html`
    return [{ url, html: await page(url) }]
  }
  const url = `${ORIGIN}title${title}/c${chapter}/index.html`
  const html = await page(url)
  const pages = [{ url, html }]
  for (const [, href] of html.matchAll(/<div class="title-links"><a href="([^"]+)">/g)) {
    await pause()
    const sub = new URL(href, url).toString()
    pages.push({ url: sub, html: await page(sub) })
  }
  return pages
}

interface Version {
  /** The catchline without its section number or its effective-date tag. */
  heading: string
  from?: string
  until?: string
  /** One line per paragraph of law. */
  lines: string[]
}

/** "§ 4179. Stopping, standing or parking [Effective until Dec. 24, 2026]." -> its number and the rest. */
const HEAD = /^(?:§\s*)+([\w.,\s-]+?)\.\s*([\s\S]*)$/

/**
 * A page's sections by number, each with every copy the page serves. A copy is
 * its `SectionHead` and the paragraphs after it up to the next `Section`; the
 * session-law history between them is bare text and links, never a paragraph,
 * so it falls away with the tags.
 */
function sectionsOf(html: string): Map<string, Version[]> {
  const body = html.indexOf('<div id="CodeBody">')
  const sections = new Map<string, Version[]>()
  if (body < 0) return sections
  const blocks = html.slice(body).split('<div class="Section">').slice(1)
  for (const block of blocks) {
    const head = /<div class="SectionHead" id="[^"]*">([\s\S]*?)<\/div>/.exec(block)
    if (head === null) continue
    const match = HEAD.exec(text(head[1]))
    if (match === null) throw new Error(`a SectionHead this cannot read: ${text(head[1])}`)
    const [, section, rest] = match
    const tag = /\s*\[(Effective[^\]]*)\]\.?\s*$/.exec(rest)
    const heading = (tag === null ? rest : rest.slice(0, tag.index)).trim().replace(/\.$/, '')
    const version: Version = { heading, lines: [] }
    if (tag !== null) {
      for (const part of tag[1].split(';').map((each) => each.trim())) {
        const until = /^Effective until (.+)$/.exec(part)
        const from = /^Effective (?!until)(.+)$/.exec(part)
        // "[Effective until fulfillment of the contingency in 81 Del. Laws, c. 155, § 2]": the page serves the
        // contingent copy beside it until the contingency is met, so the copy waiting on one is not yet law.
        if (until !== null) version.until = CONTINGENT.test(until[1]) ? undefined : dateOf(until[1])
        else if (from !== null) version.from = CONTINGENT.test(from[1]) ? NEVER : dateOf(from[1])
        else throw new Error(`${section} carries an effective-date tag this cannot read: [${tag[1]}]`)
      }
    }
    const after = block.slice(head.index + head[0].length)
    for (const [, inner] of after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const line = text(inner)
      if (line.length > 0) version.lines.push(line)
    }
    sections.set(section, [...(sections.get(section) ?? []), version])
  }
  return sections
}

/** An effective date that is an event, not a day: "upon fulfillment of the contingency in …". */
const CONTINGENT = /contingency|fulfillment|upon /i
const NEVER = '9999-12-31'

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "Dec. 24, 2026", "July 1, 2027", "Sept. 1, 2026" -> "2026-12-24". */
function dateOf(written: string): string {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})$/.exec(written.trim())
  const month = match === null ? undefined : MONTHS[match[1].slice(0, 3).toLowerCase()]
  // A date this cannot read could put either copy in effect; guessing would commit the wrong law.
  if (match === null || month === undefined) throw new Error(`an effective date this cannot read: ${written}`)
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/** A catchline that is all that is left of a section: "[Repealed].", "[Reserved.]", "[Omitted].", "[Transferred]". */
const GONE = /\[(repealed|reserved|omitted|transferred)\.?\]/i

const text = (html: string) =>
  decode(html.replace(/<br[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

const site: Site = {
  // The Delaware Code as the General Assembly's Legislative Council publishes it.
  official: ORIGIN,
  name: 'the Delaware Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      for (const { url, html } of await pagesOf(spec.title, spec.chapter, spec.subchapter)) {
        for (const [section, versions] of sectionsOf(html)) {
          if (spec.only !== undefined && !spec.only.includes(section)) continue
          const heading = versions[0].heading
          if (versions.every((version) => GONE.test(version.heading) || version.lines.length === 0)) continue
          listings.push({
            file: `${spec.id}-${section}`,
            url: `${url}#${section}`,
            section,
            cite: cite(section, spec.title),
            heading: heading.replace(GONE, '').trim(),
          })
        }
      }
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractDelcode(body, listing.section),
}

export default site

/**
 * One section's text in effect today: "§ <number>." on its own line, then a
 * line per paragraph of law. Where the page serves several copies, the one
 * whose effective dates hold today; none or more than one is an error, not a
 * choice.
 */
export function extractDelcode(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const versions = sectionsOf(html).get(section)
  if (versions === undefined) throw new Unavailable(`the page has no SectionHead for ${section}`)
  const current = versions.filter((version) => (version.from === undefined || version.from <= today) && (version.until === undefined || today < version.until))
  if (current.length !== 1) throw new Error(`${section} has ${current.length} copies in effect on ${today} of ${versions.length} served`)
  const [version] = current
  if (version.lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  // The number alone heads the text and the catchline is the listing's heading: a long catchline kept here
  // stops being read as a header and becomes a chunk naming a rule it does not state.
  return [`§ ${section}.`, ...version.lines].join('\n') + '\n'
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
