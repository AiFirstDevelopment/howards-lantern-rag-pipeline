/**
 * Nevada: the Nevada Revised Statutes as the Legislative Counsel Bureau
 * publishes them on the Legislature's site (leg.state.nv.us/NRS). A
 * chapter-page `enumerate`, as Florida's: one HTML page holds a whole chapter,
 * every section in it under an anchor ("NRS-484B.html#NRS484BSec450"), so a
 * section's URL is its chapter's page with that anchor, and fetch.ts reads
 * each page once per run. `enumerate` reads the same cached page, so it lists
 * sections from exactly the HTML `extract` is given.
 *
 * On the page a section opens on a paragraph carrying its number and its
 * catchline (the "Leadline"), and often the first sentence of its law after
 * them; then a paragraph per subsection, "1.", "(a)", "(1)"; then a
 * "SourceNote" of the session laws that enacted it, which is not law and where
 * `extract` stops.
 *
 * Where the law in effect will change, the page serves the section twice, each
 * catchline ending in a bracketed note: "[Effective through June 30, 2028.]"
 * then "[Effective July 1, 2028.]", or a change that waits on an event --
 * "[Effective until the date of the repeal of …]" then "[Effective on the date
 * of the repeal of …]". `extract` keeps the version in effect on the day it
 * runs, reads an event that has not been certified as not yet happened (the
 * Legislature still prints both versions), and refuses a note it cannot read
 * rather than guess.
 *
 * Nevada numbers subsections "1.", "2.", then "(a)", "(1)", "(I)", each set
 * apart from its text by en spaces; `extract` turns those into one space --
 * whitespace only, never a word -- so each label opens a line of its own.
 *
 * The words that close a list ("…, Ê to drive or be in actual physical control
 * of a vehicle") open on an "Ê" set in Wingdings 3, which a browser draws as a
 * flush-left arrow: a typographic marker, not a word. Kept, every quote of those
 * words showed a learner a stray "Ê"; `extract` drops it and the space after
 * it, and the words keep their own line, as Missouri's drops its soft-hyphen spacers.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.leg.state.nv.us/NRS/'

/**
 * The chapters of Title 43 a licence-holder is bound by, and the parts of them
 * left out, named by the chapter's own headings. Out of Title 43, and why: 480
 * and 481 are the Department of Public Safety and the DMV themselves; 481A a
 * multistate highway agreement; 482A to 482C autonomous-vehicle testing,
 * electronic transportation systems and peer-to-peer car-sharing businesses;
 * 487 garages, tow operators, salvage pools and wreckers; 488 to 498
 * watercraft, mobile homes, off-highway vehicles and aviation.
 *
 * Inside chapter 482, the DMV's administration and fees, motor carriers,
 * short-term rental, transporters, consignment, the regulation of dealers,
 * manufacturers and lessors, the optional special plates (their charities and
 * designs), event permits, firefighter placards, business leases, security
 * interests, trimobile identification, repossession and the dismantlers'
 * antitheft laws. Inside 483, the commercial driver's licence, as every state
 * so far has left out: its permit and alcohol rules crowd out the ordinary
 * ones; and the next-of-kin and visually impaired registries, driving schools
 * and their instructors, the driver-education fund, and identification cards.
 * Inside 484A, the powers of state and local authorities; inside 484B, the
 * personal delivery robots' rules and the police's traffic-stop data; inside
 * 484C, the committee that certifies breath-testing devices; inside 484D, a
 * county advisory body on truck weights; inside 485 the DMV's administration;
 * inside 486, the motorcycle rider-education program's funding.
 */
const TITLES: {
  chapter: string
  name: string
  why: string
  /** The chapter's headings, a part's or a subpart's, whose sections are out. */
  skip?: string[]
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  {
    chapter: '482',
    name: 'NRS Chapter 482: Motor Vehicles and Trailers: Licensing, Registration, Sales and Leases',
    why: 'what the code means by a vehicle, a moped or an owner; the registration and plates every owner must hold, disabled parking plates and placards, and the offences and penalties for unregistered vehicles',
    skip: [
      'ADMINISTRATION',
      'MOTOR CARRIERS',
      'ELECTRONIC SUBMISSION AND STORAGE OF DOCUMENTS',
      'VEHICLES LEASED FOR SHORT TERM',
      'VEHICLE TRANSPORTERS',
      'CONSIGNMENT OF VEHICLES',
      'MANUFACTURERS, REBUILDERS, DISTRIBUTORS, DEALERS, BROKERS, SALESPERSONS AND LESSORS',
      'SPECIAL LICENSE PLATES',
      'SPECIAL USE PERMITS FOR SPECIAL EVENTS',
      'PLACARDS FOR VOLUNTEER FIREFIGHTERS AND ASSOCIATED EMERGENCY MEDICAL TECHNICIANS AND PARAMEDICS',
      'LEASE OF MOTOR VEHICLE OR TRAILER FOR USE PRIMARILY IN TRADE OR BUSINESS',
      'SECURITY INTERESTS IN VEHICLES',
      'IDENTIFICATION OF TRIMOBILES',
      'FEES',
      'REPOSSESSION OF VEHICLES AND CONSTRUCTION EQUIPMENT',
      'SPECIAL ANTITHEFT LAWS',
    ],
  },
  {
    chapter: '483',
    name: "NRS Chapter 483: Drivers' Licenses; Driving Schools and Driving Instructors",
    why: 'licensing, the instruction permit and the limits on drivers under 18, testing, points, and suspension and revocation',
    skip: [
      'NEXT-OF-KIN REGISTRY',
      'DRIVING SCHOOLS AND INSTRUCTORS',
      'FINANCIAL ASSISTANCE TO PUPILS FOR AUTOMOBILE DRIVER EDUCATION',
      'REGISTRY OF PERSONS WHO ARE BLIND OR VISUALLY IMPAIRED',
      'IDENTIFICATION CARDS FOR PERSONS WITHOUT DRIVERS’ LICENSES',
      'COMMERCIAL DRIVERS’ LICENSES',
    ],
  },
  {
    chapter: '484A',
    name: 'NRS Chapter 484A: Traffic Laws Generally',
    why: 'what the traffic laws mean by a highway, a crosswalk or a driver, and citations, arrests, fines and the general penalty',
    skip: ['POWERS OF STATE AND LOCAL AUTHORITIES'],
  },
  {
    chapter: '484B',
    name: 'NRS Chapter 484B: Rules of the Road',
    why: 'the rules of the road: signals, right of way, pedestrians, speed, passing, school zones and buses, parking, phones, seat belts, child seats and bicycles',
    skip: ['OPERATION OF PERSONAL DELIVERY DEVICES AND MOBILE CARRYING DEVICES', 'INFORMATION CONCERNING TRAFFIC STOPS'],
  },
  {
    chapter: '484C',
    name: 'NRS Chapter 484C: Driving Under the Influence of Alcohol or a Prohibited Substance',
    why: 'impaired driving, implied consent and testing, and its penalties and ignition interlocks',
    skip: ['COMMITTEE ON TESTING FOR INTOXICATION'],
  },
  {
    chapter: '484D',
    name: 'NRS Chapter 484D: Equipment, Inspections and Size, Weight and Load of Vehicles',
    why: 'lights, brakes, mirrors, tires, window tint, emissions inspection, and the size and load every vehicle is held to',
    skip: ['Regional Advisement in Counties Whose Population is 700,000 or More'],
  },
  { chapter: '484E', name: 'NRS Chapter 484E: Crashes and Reports of Crashes', why: 'what a driver must do after a crash, and the report it requires' },
  {
    chapter: '485',
    name: 'NRS Chapter 485: Motor Vehicles: Insurance and Financial Responsibility',
    why: 'the insurance every vehicle must carry, its proof, and the security a crash requires',
    skip: ['ADMINISTRATION'],
  },
  {
    chapter: '486',
    name: 'NRS Chapter 486: Motorcycles and Similar Vehicles',
    why: 'the motorcycle licence and the rules for riding a motorcycle or moped',
    skip: ['PROGRAM FOR EDUCATION OF MOTORCYCLE RIDERS'],
  },
  {
    chapter: '202',
    name: 'NRS Chapter 202, Section 202.020: Purchase, consumption or possession of alcoholic beverage by minor',
    why: 'underage possession and consumption of alcohol, codified in the crimes against public health and safety',
    keep: ['202.020'],
  },
]

/** "484B.450" -> "NRS 484B.450", the form Nevada's own statutes cite each other by. */
export function cite(section: string): string {
  return `NRS ${section}`
}

export function chapterUrl(chapter: string): string {
  return `${ORIGIN}NRS-${chapter}.html`
}

/** "484B.450" -> "484B-450": the file names start with the title's id and a hyphen. */
const fileOf = (section: string) => section.replace('.', '-')

interface Version {
  /** The chapter's headings the section sits under: its part, and its subpart where it has one. */
  part: string
  subpart: string
  heading: string
  /** The bracketed note at the end of the catchline, if any: "Effective July 1, 2028." */
  note: string | null
  /** The law's paragraphs, as served. */
  paragraphs: string[]
}

/** The flush-left marker opening a list's closing words: an "Ê" set in Wingdings 3, which a browser draws as an arrow. */
const WINGDINGS_MARKER = /^(<p [^>]*>)\s*<span style='font-family:"Wingdings 3"'>Ê<\/span>\s*/

const HEADER = /<span class="Section">([\dA-Z]+\.[\d]+)<\/span>/

/**
 * The catchline span and where it ends. Not a lazy match to the first
 * `</span>`: a catchline citing a session law carries a span of its own inside
 * its link -- "chapter 233, <a …><span style=…>Statutes of Nevada 2023</span></a>,
 * which relate to autocycles.]" -- and cut there, its effective-date note was
 * lost and both versions of NRS 482.070 read as the law in effect.
 */
function leadlineOf(paragraph: string): { html: string; end: number } | null {
  const open = '<span class="Leadline">'
  const start = paragraph.indexOf(open)
  if (start < 0) return null
  let depth = 1
  const tags = /<(\/?)span\b[^>]*>/g
  tags.lastIndex = start + open.length
  for (let tag = tags.exec(paragraph); tag !== null; tag = tags.exec(paragraph)) {
    depth += tag[1] === '/' ? -1 : 1
    if (depth === 0) return { html: paragraph.slice(start + open.length, tag.index), end: tag.index + tag[0].length }
  }
  return null
}

let parsed: { html: string; sections: Map<string, Version[]> } | null = null

/**
 * A chapter page's sections by number, each with every copy the page serves.
 * The table of contents at the top is `COLeadline` paragraphs; the law is
 * `SectBody`, under `DocHeading` (a part) and `DocHeading2` (a subpart).
 */
export function sectionsOf(html: string): Map<string, Version[]> {
  if (parsed?.html === html) return parsed.sections
  const sections = new Map<string, Version[]>()
  let part = ''
  let subpart = ''
  let current: Version | null = null
  // The page is Word's HTML, wrapped at 80 columns inside tags as well as text:
  // `<span\r\nclass="Section">`. Every run of whitespace is one space before it is read.
  for (const paragraph of html.replace(/\s+/g, ' ').split(/(?=<p class=)/)) {
    const kind = /^<p class="?([A-Za-z0-9]+)/.exec(paragraph)?.[1]
    if (kind === 'DocHeading' || kind === 'DocHeading2') {
      if (kind === 'DocHeading') [part, subpart] = [inline(paragraph), '']
      else subpart = inline(paragraph)
      current = null
      continue
    }
    if (kind !== 'SectBody') {
      // The source note closes a section's law; a subpart heading, the next table-of-contents line, anything else.
      current = null
      continue
    }
    const header = HEADER.exec(paragraph)
    if (header !== null) {
      const leadline = leadlineOf(paragraph)
      if (leadline === null) throw new Error(`NRS ${header[1]} has no catchline on the page`)
      const catchline = inline(leadline.html)
      const note = /\s*\[([^\]]*)\]\s*$/.exec(catchline)
      const rest = inline(paragraph.slice(leadline.end))
      current = {
        part,
        subpart,
        heading: (note === null ? catchline : catchline.slice(0, note.index)).replace(/\.$/, ''),
        note: note?.[1] ?? null,
        paragraphs: rest === '' ? [] : [rest],
      }
      sections.set(header[1], [...(sections.get(header[1]) ?? []), current])
      continue
    }
    if (current === null) continue
    const text = inline(paragraph.replace(WINGDINGS_MARKER, '$1'))
    if (text !== '') current.paragraphs.push(text)
  }
  parsed = { html, sections }
  return sections
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function dateOf(month: string, day: string, year: string): string {
  const index = MONTHS.indexOf(month)
  if (index < 0) throw new Error(`a catchline names a month this cannot read: ${month}`)
  return `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Whether a version's note says it is the law today. A note of any other
 * shape is an error: a reading this cannot settle would commit the wrong law.
 */
export function inEffect(note: string | null, today: string): boolean {
  if (note === null) return true
  const dated = /^Effective (through |until )?(\w+) (\d{1,2}), (\d{4})\.?$/.exec(note)
  if (dated !== null) {
    const [, through, month, day, year] = dated
    const date = dateOf(month, day, year)
    return through !== undefined ? today <= date : date <= today
  }
  // An event the Legislature has not recorded as happened: the old text stands and the new waits.
  // "until the date of the repeal of 42 U.S.C. § 666", "until the Director … notifies the Governor", "on the later of …".
  if (/^Effective until (the|a)\b/.test(note)) return true
  if (/^Effective on (the|a)\b/.test(note)) return false
  throw new Error(`a catchline carries a note this cannot read: [${note}]`)
}

/** The one version of a section in effect today, or why there is none. */
function versionOf(sections: Map<string, Version[]>, section: string, today: string): Version {
  const versions = sections.get(section)
  if (versions === undefined) throw new Unavailable(`the chapter's page has no section ${section}`)
  const current = versions.filter((version) => inEffect(version.note, today))
  if (current.length === 0) throw new Unavailable(`the page serves ${section} only in a version not in effect today`)
  if (current.length > 1) throw new Error(`${section} has ${current.length} versions in effect on the page`)
  return current[0]
}

const site: Site = {
  // The Legislative Counsel Bureau's Nevada Revised Statutes, on the Legislature's own site.
  official: ORIGIN,
  name: 'the Nevada Revised Statutes',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: chapter, name, why })),
  async enumerate() {
    const today = new Date().toISOString().slice(0, 10)
    const listings: Listing[] = []
    for (const title of TITLES) {
      const url = chapterUrl(title.chapter)
      const sections = sectionsOf((await fetchedPage(url).page).body)
      const before = listings.length
      for (const [section, versions] of sections) {
        if (!section.startsWith(`${title.chapter}.`)) continue
        if (title.keep !== undefined && !title.keep.includes(section)) continue
        if (title.skip?.some((heading) => heading === versions[0].part || heading === versions[0].subpart)) continue
        const current = versions.filter((version) => inEffect(version.note, today))
        // A section not yet in force (NRS 483.3475 until 2027) is not a rule a driver is held to today.
        if (current.length === 0) continue
        listings.push({
          file: fileOf(section),
          url: `${url}#NRS${section.replace('.', 'Sec')}`,
          section,
          cite: cite(section),
          heading: current[0].heading,
        })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    return listings
  },
  extract: (body, listing) => extractNrs(body, listing.section),
}

export default site

/**
 * One section's law in effect: "NRS <number>" on its own line, then a line per
 * paragraph as the page sets them. Only the law: the catchline is the
 * listing's heading, and the source note after it is not law.
 */
export function extractNrs(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const version = versionOf(sectionsOf(html), section, today)
  if (version.paragraphs.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return [cite(section), ...version.paragraphs].join('\n') + '\n'
}

function inline(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s   ]+/g, ' ')
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
