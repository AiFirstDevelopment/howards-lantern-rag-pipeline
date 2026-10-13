/**
 * Alabama: the Legislature's own Code of Alabama reader (ALISON,
 * alison.legislature.state.al.us). The reader is a JavaScript page, but every
 * section it shows comes from the Legislature's GraphQL endpoint on the same
 * origin, which answers a plain GET -- so this is an index-page `enumerate`,
 * as Maryland's is: one request lists the whole code's sections and
 * catchlines, and one request a section serves its text.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://alison.legislature.state.al.us/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by, by section number. Out, and why:
 * 32-2 to 32-4 are the Department of Public Safety and its committees; 32-6's
 * Article 1A is the commercial licence, its Division 3 the medical advisory
 * board, and its Divisions 2 to 54 of Article 2 the specialty plates; 32-7B is
 * the department's insurance-verification database; 32-7C is ride-hailing
 * companies; 32-8's Articles 3 and 4 are lenders' liens and parts dealers'
 * antitheft records; 32-9 to 32-9C are trucks, motor carriers and automated
 * vehicles; 32-11, 32-13 to 32-18 and 32-20 are rescue squads, abandoned
 * vehicles, driving schools, rentals, dealers, warranties, testing stations
 * and manufactured homes; 32-12A is off-highway vehicles.
 */
const TITLES: { id: string; chapter: string; from?: number; to?: number; only?: string[]; name: string; why: string }[] = [
  { id: 'al-32-1', chapter: '32-1', name: 'Title 32, Chapter 1: General Provisions', why: "the title's definitions, the traffic citation and the general penalty" },
  { id: 'al-32-5', chapter: '32-5', name: 'Title 32, Chapter 5: Regulation of Operation of Motor Vehicles, Generally', why: 'implied consent and chemical tests, equipment, child restraints, lights, and the penalties for violations' },
  { id: 'al-32-5A', chapter: '32-5A', name: 'Title 32, Chapter 5A: Rules of the Road', why: 'the rules of the road: signals, right of way, speed, parking, school buses, DUI, open containers, texting, work zones' },
  { id: 'al-32-5B', chapter: '32-5B', name: 'Title 32, Chapter 5B: Alabama Safety Belt Act of 1991', why: 'who must wear a seat belt and the fine for not' },
  { id: 'al-32-5C', chapter: '32-5C', name: 'Title 32, Chapter 5C: Window Tinting', why: 'how dark a vehicle\'s windows may be tinted' },
  { id: 'al-32-6-lic', chapter: '32-6', from: 1, to: 36, name: "Title 32, Chapter 6, Article 1, Divisions 1-2: Drivers' Licenses and the Driver License Compact", why: 'licensing, the learner permit and graduated licence, and how an out-of-state conviction counts' },
  { id: 'al-32-6-reg', chapter: '32-6', from: 51, to: 69, name: 'Title 32, Chapter 6, Article 2, Division 1: License Tags and Plates Generally', why: 'the plates and registration every owner must display and renew' },
  { id: 'al-32-6A', chapter: '32-6A', name: 'Title 32, Chapter 6A: Autocycles', why: 'what an autocycle is and the licence it needs' },
  { id: 'al-32-7', chapter: '32-7', name: 'Title 32, Chapter 7: Motor Vehicle Safety-Responsibility Act', why: 'the report and security a crash requires, and the suspension for lacking it' },
  { id: 'al-32-7A', chapter: '32-7A', name: 'Title 32, Chapter 7A: Mandatory Automobile Liability Insurance', why: 'the insurance every vehicle must carry and the penalty for driving without it' },
  { id: 'al-32-8', chapter: '32-8', from: 1, to: 49, name: 'Title 32, Chapter 8, Articles 1-2: Uniform Certificate of Title Act', why: 'the title every owner must hold and transfer' },
  { id: 'al-32-10', chapter: '32-10', name: 'Title 32, Chapter 10: Motor Vehicle Accidents', why: 'what a driver must do after a crash' },
  { id: 'al-32-12', chapter: '32-12', name: 'Title 32, Chapter 12: Motorcycles and Motor-Driven Cycles', why: 'motor-driven cycles and mopeds, and the helmet law' },
  { id: 'al-32-19', chapter: '32-19', name: 'Title 32, Chapter 19: Electric Personal Assistive Mobility Devices', why: 'where a self-balancing scooter may be ridden' },
  { id: 'al-40-12', chapter: '40-12', from: 240, to: 275, name: 'Title 40, Chapter 12, Article 5, Division 1: Motor Vehicles', why: 'registration, its renewal and the grace period, which Alabama codifies with the licence taxes' },
  { id: 'al-28-1', chapter: '28-1', only: ['28-1-5'], name: 'Title 28, Section 28-1-5: Minimum age for purchase of alcoholic beverages', why: 'the drinking age the under-21 driving rules rest on, codified in the alcohol title' },
]

/** The state's own citation form: "Ala. Code § 32-5A-137". */
export function cite(section: string): string {
  return `Ala. Code § ${section}`
}

const SECTION_QUERY =
  'query codeOfAlabamaSection($displayId: String!) { codesOfAlabama(where: { type: { eq: Section }, displayId: { eq: $displayId } }, versions: true) { data { displayId title content effectiveDate supersessionDate } } }'

/** One section, every version of it, as the reader itself asks for it. */
export function sectionUrl(section: string): string {
  return `${ORIGIN}graphql?query=${encodeURIComponent(SECTION_QUERY)}&variables=${encodeURIComponent(JSON.stringify({ displayId: section }))}`
}

/** "32-6-49.1" -> 49: where a section falls in a chapter, for the ranges above. */
const ordinal = (section: string) => Number(section.split('-')[2]?.split('.')[0])

/**
 * Every section of the code with its catchline, from the one listing the
 * reader's own table of contents is built from: rows split by "∫", fields by
 * "†" -- codeId, title, section range, effective date. A section listed as
 * "Repealed" (or renumbered, or reserved) is a pointer, not a rule, and is
 * skipped; one listed twice is a section with a version not yet in effect,
 * listed once, and `extract` keeps the version in effect.
 */
async function codeSections(): Promise<{ section: string; heading: string }[]> {
  const url = `${ORIGIN}graphql?query=${encodeURIComponent('query codeOfAlabamaTitles { titles: codeOfAlabamaTitles }')}`
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`ALISON's code listing answered ${response.status}`)
  const body = JSON.parse(decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))) as {
    data: { titles: string }
  }
  const out = new Map<string, string>()
  for (const row of body.data.titles.split('∫')) {
    const title = row.split('†')[1] ?? ''
    const match = /^Section (\d+[A-Z]*-\d+[A-Z]*-[\d.]+[A-Z]?)\s+(.*)$/.exec(title)
    if (match === null) continue
    const [, section, rest] = match
    if (/\b(Repealed|Renumbered|Reserved|Transferred)\.?\]?$/i.test(rest)) continue
    const heading = rest.replace(/^[[(]Effective[^\])]*[\])]\s*/i, '').replace(/\.$/, '').trim()
    if (!out.has(section)) out.set(section, heading)
  }
  return [...out].map(([section, heading]) => ({ section, heading }))
}

const site: Site = {
  // The Legislature publishes the Code of Alabama here; the reader and this fetch ask the same endpoint.
  official: ORIGIN,
  name: 'the Code of Alabama',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const all = await codeSections()
    const listings: Listing[] = []
    for (const title of TITLES) {
      for (const { section, heading } of all) {
        if (!section.startsWith(`${title.chapter}-`)) continue
        if (title.only !== undefined && !title.only.includes(section)) continue
        const n = ordinal(section)
        if (title.from !== undefined && n < title.from) continue
        if (title.to !== undefined && n > title.to) continue
        listings.push({
          file: `${title.id}-${section.slice(title.chapter.length + 1)}`,
          url: sectionUrl(section),
          section,
          cite: cite(section),
          heading,
        })
      }
    }
    return listings
  },
  extract: (body, listing) => extractAlison(body, listing.section),
}

export default site

interface Version {
  displayId: string
  title: string
  content: string | null
  effectiveDate: string | null
  supersessionDate: string | null
}

/**
 * The text of one section from the reader's GraphQL answer: its title line,
 * then the law a paragraph a line, tags dropped and entities decoded.
 *
 * Only the version in effect. The reader serves a section amended for a future
 * date as two versions -- "[Effective until October 1, 2028]" and
 * "[Effective October 1, 2028]" (§ 32-6-65) -- and a quote found only in the
 * second would be the law of 2028 presented as the law today. The version in
 * effect is the one with no effective date or one already passed, and no
 * supersession date or one still to come; a section whose only version starts
 * in the future is `Unavailable`, not committed early.
 */
export function extractAlison(json: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const versions = (JSON.parse(json) as { data?: { codesOfAlabama?: { data?: Version[] } } }).data?.codesOfAlabama?.data
  if (versions === undefined) throw new Error(`ALISON answered no section data for ${section}`)
  const own = versions.filter((version) => version.displayId === section)
  if (own.length === 0) throw new Unavailable(`ALISON serves no section ${section}`)
  const inEffect = own.filter(
    (version) =>
      (version.effectiveDate === null || version.effectiveDate <= today) &&
      (version.supersessionDate === null || version.supersessionDate > today),
  )
  if (inEffect.length === 0) throw new Unavailable('ALISON serves only a version not yet in effect')
  if (inEffect.length > 1) throw new Error(`ALISON serves ${inEffect.length} versions of ${section} in effect at once`)
  const { title, content } = inEffect[0]
  const text = decode(
    (content ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
  const lines = [title, ...text.split('\n')]
    .map((line) => line.replace(/[ \t  ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2) throw new Unavailable('ALISON serves the title with no text')
  return lines.join('\n') + '\n'
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
