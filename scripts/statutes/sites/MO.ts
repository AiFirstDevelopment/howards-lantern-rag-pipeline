/**
 * Missouri: the Revised Statutes of Missouri as the Missouri Revisor of
 * Statutes publishes them (revisor.mo.gov), the Legislative Research
 * office's own site. A chapter-page `enumerate`: `ViewChapter.aspx` serves
 * every section of a chapter on one page, so a section's URL is that page with
 * the section's number as its fragment, and fetch.ts reads each page once.
 *
 * Not the one-section pages: for a section with a contingent version the
 * revisor's `OneSection.aspx` serves the version that is *not* in effect --
 * § 301.287 there reads "Effective - 01 Jan 2099 (date is placeholder, see
 * FAQ)". The chapter page serves both versions, each closed by a line naming
 * its effective date, and `extract` drops the one dated 1/1/2099, the revisor's
 * placeholder for a contingency not yet met. Any other section served twice is
 * an error, not a choice: that is how a future copy would arrive.
 *
 * The section's number and catchline ("304.351. Right-of-way at intersection —
 * … — ") are the bold lead of its first paragraph; they go into `heading`, and
 * the text starts at the law, "1. The driver of a vehicle…". The history,
 * effective-date notes and case annotations after it are the revisor's and are
 * dropped with them.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://revisor.mo.gov/main/'

/** A range of sections by the digits after the point, read as the decimal they are. */
const between = (low: string, high: string) => (number: string) =>
  Number(`0.${number}`) >= Number(`0.${low}`) && Number(`0.${number}`) <= Number(`0.${high}`)
const any = (...tests: ((number: string) => boolean)[]) => (number: string) => tests.some((test) => test(number))
const not = (test: (number: string) => boolean) => (number: string) => !test(number)
const only = (...numbers: string[]) => (number: string) => numbers.includes(number)

/**
 * The chapters of Title XIX a licence-holder is bound by, by the digits after
 * the point ("351" of 304.351). Out, and why: chapter 300 is the Model Traffic
 * Ordinance, which binds only inside a city that adopts it; 305 and 306 are
 * aviation and watercraft; 390 is motor carriers. Within 301: special and
 * personalized plates (301.071–301.075, 301.134, 301.135, 301.144–301.146,
 * 301.441–301.481, 301.2998 on), dealers and auctions (301.200, 301.213,
 * 301.280, 301.550–301.580), service agents (301.112–301.119), salvage
 * businesses (301.217–301.229), liens and joint ownership (301.600–301.684),
 * commercial-vehicle registration, fees, fleets and reciprocity (301.031,
 * 301.032, 301.035, 301.041, 301.057–301.069, 301.175, 301.265–301.279,
 * 301.330, 301.442), municipal licence taxes (301.340, 301.344) and the
 * department's own rules and records (301.002, 301.003, 301.090, 301.110,
 * 301.125, 301.216, 301.240, 301.290, 301.350–301.360). Within 302:
 * commercial driver licensing (302.700–302.780) and school bus driver permits
 * (302.272–302.276), as every state so far leaves out; the motorcycle safety
 * program's commission and fund (302.133–302.137); and the department's
 * records, rules and boards (302.110, 302.169, 302.170, 302.180, 302.184,
 * 302.187, 302.228, 302.292, 302.312, 302.347, 302.426, 302.458, 302.460,
 * 302.584, 302.592). Within 303: the insurance database and verification
 * system's administration (303.400–303.440 but 303.409) and records and dates
 * (303.039, 303.045, 303.360). Within 304: size, weight and haul permits
 * (304.170–304.260), hazardous-material carriers (304.373), funds (304.027,
 * 304.028), towing companies and abandoned-vehicle removal (304.153–304.159),
 * signal timing and enforcement statistics (304.289, 304.670), the citation
 * quota and ordinance procedure (304.125, 304.130) and delivery robots
 * (304.900). Within 307: lighting approval and glass lists (307.030, 307.035,
 * 307.150, 307.160), hazardous-material carriers (307.177), the vehicle
 * equipment safety compact's administration (307.250–307.295), inspection
 * stations and school-bus and commercial inspection (307.360, 307.365,
 * 307.375, 307.390, 307.400, 307.402). Within 577, § 577.019 is a short title
 * alone ("Sections 577.019 to 577.021 shall be known as the Alan Woods Law."),
 * which names its own number and so reads to the chunker as a heading over
 * no law.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; keep: (number: string) => boolean }[] = [
  {
    chapter: '304',
    id: '304',
    name: 'Chapter 304: Traffic Regulations (except size, weight and haul permits, towing companies and funds)',
    why: 'the definitions and rules of the road -- speed, lanes, passing, right of way, signals, school buses, emergency vehicles, phones, work zones and the fines for them',
    keep: not(
      any(between('170', '260'), only('027', '028', '125', '130', '289', '373', '670', '900'), between('153', '159')),
    ),
  },
  {
    chapter: '307',
    id: '307',
    name: 'Chapter 307: Vehicle Equipment Regulations (except approvals, the compact and inspection stations)',
    why: 'lights and when to use them, brakes, belts, child restraints, window tint, bicycles and mopeds, and the safety inspection every owner must pass',
    keep: not(any(only('030', '035', '150', '160', '177', '360', '365', '375', '390', '400', '402'), between('250', '295'))),
  },
  {
    chapter: '302',
    id: '302',
    name: "Chapter 302: Drivers' Licenses (except commercial licensing, school bus permits and the department's records)",
    why: 'licences, the instruction permit, the intermediate licence and its limits, points, suspension, revocation, the alcohol-related revocations and ignition interlocks',
    keep: not(
      any(
        between('700', '780'),
        between('272', '276'),
        between('133', '137'),
        only('110', '169', '170', '180', '184', '187', '228', '292', '312', '347', '426', '458', '460', '584', '592'),
      ),
    ),
  },
  {
    chapter: '577',
    id: '577',
    name: 'Chapter 577 (§§ 577.001–577.060, 577.080, 577.300, 577.599–577.612): Public Safety Offenses -- driving',
    why: 'driving while intoxicated, the blood alcohol limits, implied consent and chemical tests, leaving the scene of an accident, a child left in a vehicle and ignition interlocks, codified in the criminal code',
    keep: any(
      only('001', '010', '012', '017', '020', '021', '023', '029', '031', '033', '037', '041', '060', '080', '300'),
      between('599', '612'),
    ),
  },
  {
    chapter: '303',
    id: '303',
    name: 'Chapter 303: Motor Vehicle Financial Responsibility (except the verification database)',
    why: 'the insurance every owner must carry, the proof of it, crash reports and the suspensions for driving uninsured',
    keep: not(any(only('039', '045', '360', '400', '403', '406', '412', '415'), between('420', '440'))),
  },
  {
    chapter: '301',
    id: '301',
    name: 'Chapter 301: Registration and Licensing of Motor Vehicles (except special plates, dealers, liens and commercial registration)',
    why: 'definitions, registration, plates and their display, disabled placards, titles on a sale, and all-terrain vehicles',
    keep: not(
      any(
        between('071', '075'),
        only('134', '135', '144', '145', '146'),
        between('441', '481'),
        // 301.2998 to 301.4000, four digits after the point: read as decimals they fall among 301.290 to 301.400.
        (number) => number.length === 4,
        only('200', '213', '280'),
        between('550', '580'),
        between('112', '119'),
        between('217', '229'),
        between('600', '684'),
        only('031', '032', '035', '041', '175', '330', '442'),
        between('057', '069'),
        between('265', '279'),
        only('340', '344'),
        only('002', '003', '090', '110', '125', '216', '240', '290'),
        between('350', '360'),
      ),
    ),
  },
  {
    chapter: '311',
    id: '311',
    name: 'Chapter 311 (§ 311.325): Liquor Control -- purchase or possession by a minor',
    why: 'underage possession of alcohol, including in a vehicle, codified in the liquor chapter',
    keep: only('325'),
  },
]

/** "304.351" -> "Mo. Rev. Stat. § 304.351", the form Missouri's courts cite. */
export function cite(section: string): string {
  if (!/^\d+[A-Z]?\.\d+$/.test(section)) throw new Error(`not a Missouri section: ${section}`)
  return `Mo. Rev. Stat. § ${section}`
}

const chapterUrl = (chapter: string) => `${ORIGIN}ViewChapter.aspx?chapter=${chapter}`

/** The revisor's placeholder date for a version whose contingent effective date has not come. */
const PLACEHOLDER = '1/1/2099'

interface Version {
  number: string
  effective: string
  catchline: string
  lines: string[]
}

/**
 * Every section version on a chapter page. Each is a block closed by a line
 * "----- 304.351 1/1/2007 -----"; inside it, the law is the paragraphs from
 * the bold number-and-catchline to the footnotes.
 */
export function versionsOf(html: string): Version[] {
  const out: Version[] = []
  const closer = /<p [^>]*darkgreen[^>]*>\s*-+\s+(\d+[A-Z]?\.\d+)\s+(\d+\/\d+\/\d+)\s+-+\s*<\/p>/g
  let from = 0
  for (const match of html.matchAll(closer)) {
    const block = html.slice(from, match.index)
    from = match.index! + match[0].length
    const lead = /<span class="bold">([\s\S]*?<span>[\s\S]*?<\/span>[\s\S]*?)<\/span>/.exec(block)
    if (lead === null) throw new Error(`§ ${match[1]}: no bold number and catchline, the page changed shape`)
    const head = linesOf(lead[1]).join(' ')
    const own = new RegExp(`^\\*?${match[1].replace(/\./g, '\\.')}\\.\\s*`)
    if (!own.test(head)) throw new Error(`§ ${match[1]}: its lead names another section: ${head.slice(0, 60)}`)
    const catchline = head.replace(own, '').replace(/\s*—\s*$/, '')
    const foot = block.indexOf('<div class="foot"', lead.index)
    const body = block.slice(lead.index + lead[0].length, foot < 0 ? undefined : foot)
    out.push({ number: match[1], effective: match[2], catchline, lines: linesOf(body) })
  }
  return out
}

/** The one version of each section in effect: a placeholder-dated version dropped, any other second copy an error. */
export function sectionsOf(html: string): Version[] {
  const byNumber = new Map<string, Version[]>()
  for (const version of versionsOf(html)) byNumber.set(version.number, [...(byNumber.get(version.number) ?? []), version])
  return [...byNumber.values()].map((versions) => {
    const live = versions.filter((version) => version.effective !== PLACEHOLDER)
    if (live.length !== 1) {
      throw new Error(`§ ${versions[0].number}: ${live.length} versions not dated ${PLACEHOLDER} (${versions.map((each) => each.effective).join(', ')})`)
    }
    return live[0]
  })
}

const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A chapter page, read whole and checked before anything is taken from it.
 * The revisor's chapter view is built in a server-side step shared between
 * visitors, and two of the first dozen requests came back with another chapter's
 * sections spliced in: § 302.721's closing line under § 191.2600's text, §
 * 301.465's under § 566.120's. A page is accepted only when every section on
 * it is the chapter's own and every lead names the section its closing line
 * does (`versionsOf` throws otherwise), else it is asked for again.
 */
const chapters = new Map<string, Promise<string>>()

function chapterPage(chapter: string): Promise<string> {
  const known = chapters.get(chapter)
  if (known !== undefined) return known
  const page = (async () => {
    let last: unknown
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const response = await fetch(chapterUrl(chapter), { headers: { 'User-Agent': AGENT } })
        if (!response.ok) throw new Error(`chapter ${chapter} answered ${response.status}`)
        const body = decoded(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'))
        const sections = sectionsOf(body)
        if (sections.length === 0) throw new Error(`chapter ${chapter}'s page holds no sections`)
        const foreign = sections.find((each) => !each.number.startsWith(`${chapter}.`))
        if (foreign !== undefined) throw new Error(`chapter ${chapter}'s page holds § ${foreign.number}`)
        return body
      } catch (error) {
        last = error
        console.log(`MO chapter ${chapter}, attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
        await pause(5000 * attempt)
      }
    }
    throw last
  })()
  chapters.set(chapter, page)
  page.catch(() => chapters.delete(chapter))
  return page
}

const site: Site = {
  // revisor.mo.gov is the Revisor of Statutes, the office that publishes RSMo.
  official: ORIGIN,
  name: 'the Revised Statutes of Missouri',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const sections = sectionsOf(await chapterPage(spec.chapter))
      for (const each of sections) {
        if (!spec.keep(each.number.slice(spec.chapter.length + 1))) continue
        listings.push({
          file: `${spec.id}-${each.number}`,
          url: `${chapterUrl(spec.chapter)}#${each.number}`,
          section: each.number,
          cite: cite(each.number),
          heading: each.catchline,
        })
      }
    }
    return listings
  },
  // Every section of a chapter from the one checked page, read once per run.
  read: (listing) => chapterPage(listing.section.split('.')[0]),
  extract: (body, listing) => {
    const section = sectionsOf(body).find((each) => each.number === listing.section)
    if (section === undefined) throw new Unavailable(`§ ${listing.section} is not on the chapter page`)
    if (section.lines.length === 0) throw new Unavailable(`§ ${listing.section} has no text`)
    return section.lines.join('\n') + '\n'
  },
}

export default site

/**
 * A fragment's paragraphs, one line each: a new line at every paragraph and
 * table row, tags dropped, spaces folded, and a paragraph of nothing but
 * soft hyphens dropped. Only whitespace is changed within a line: the
 * revisor pads every label with two spaces ("  1.  The driver"), and the
 * chunker reads "1. The driver" at the start of a line either way.
 */
function linesOf(fragment: string): string[] {
  return decode(
    fragment
      .replace(/\s+/g, ' ')
      .replace(/<\/(p|tr|li|div)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    // The revisor spaces a table or a closing paragraph with a paragraph of soft hyphens alone: nothing a reader sees.
    .filter((line) => line.length > 0 && !/^\u00ad+$/.test(line))
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
