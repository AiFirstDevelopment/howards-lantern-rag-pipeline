/**
 * Texas: the Texas Constitution and Statutes as the Texas Legislative Council
 * publishes them (statutes.capitol.texas.gov). That site is a JavaScript
 * reader, but every chapter it shows is a plain HTML file on the Council's own
 * file server, tcss.legis.texas.gov/resources/<code>/htm/<code>.<chapter>.htm
 * -- the address the reader's "HTML" link and its own environment
 * (`FileServerPath`) name. A chapter-page `enumerate`, as Florida's: a
 * section's URL is its chapter's file with the section number as fragment, and
 * fetch.ts reads each chapter once per run.
 *
 * Neither host forbids it. statutes.capitol.texas.gov has no robots.txt (it
 * answers /robots.txt with the reader's own page) and tcss.legis.texas.gov
 * answers it 404.
 *
 * **What is in effect.** The Council serves a section or subsection amended
 * for a later date twice, each copy under a centred note: "Text of section
 * effective until April 01, 2027" and "Text of section effective on April
 * 01, 2027". `extract` keeps the copy in effect today and drops the other. A
 * second kind of note, "Text of subsection as amended by Acts 2017, … Ch. 490"
 * beside "… Ch. 968", marks two amendments of one session that both took
 * effect and were never reconciled: both are the law (Code Construction Act,
 * Gov't Code § 311.025), so both are kept, the note dropped as the editors'.
 * The note and the history lines after the body ("Acts 1995, 74th Leg., …",
 * "Amended by:") are not law and are never committed.
 *
 * Texas labels its subsections "(a)", "(b-1)", "(1)", "(A)", "(i)", each a
 * paragraph of its own, which the chunker reads as they are. Nothing is
 * rewritten but whitespace: the double spaces after a label become one, and
 * the first subsection, which the site prints on the line of the section's
 * catchline ("Sec. 545.062.  FOLLOWING DISTANCE.  (a)  An operator…"), starts
 * its own line. The catchline is the listing's heading, not a line of the
 * file. A table (the registration fee schedule in § 502.253) is a line per
 * row, its cells joined by a space.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://tcss.legis.texas.gov/resources/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

const CODES = { TN: 'Tex. Transp. Code', PE: 'Tex. Penal Code', AL: 'Tex. Alco. Bev. Code' } as const
type Code = keyof typeof CODES

/**
 * The chapters a licence-holder is bound by. Out of the Transportation Code,
 * and why: Titles 1 to 6 are carriers, aviation, navigation, railroads and
 * the roadways themselves -- the department, highway funding, toll and
 * turnpike authorities, transit; in Title 7, 503 is dealers' and
 * manufacturers' plates, 520 the department's and dealers' miscellaneous
 * duties, 521A the election identification certificate, 522 the commercial
 * driver licence, which every state so far has left out because its permit
 * and alcohol rules crowd out the ordinary ones, 546 how emergency vehicles
 * themselves may be driven, 551A off-highway vehicles, 553 what certain
 * cities may enact, 600 and 720 and 750 miscellaneous provisions for
 * agencies, 621 to 648 size, weight and motor-carrier regulation, 664 the
 * manufacturers' labelling of electric bicycles, 680 miscellaneous, 682 and
 * 683 cities' parking adjudication and abandoned vehicles, 686 valet
 * services, 701 and 702 county traffic officers and warrant contracts, 707
 * what cities may not install, 721 to 723 and 726 agencies' vehicles,
 * automobile clubs, the state safety programme and cities' inspections, 728
 * vehicle and key sales, 730 the department's records, 731 assembled
 * vehicles, and 1001 to 1006 the Department of Motor Vehicles itself.
 */
const TITLES: { code: Code; chapter: string; name: string; why: string }[] = [
  { code: 'TN', chapter: '501', name: 'Transportation Code, Chapter 501: Certificate of Title Act', why: 'the title every owner must hold, and what buyer and seller must do when a vehicle is sold' },
  { code: 'TN', chapter: '502', name: 'Transportation Code, Chapter 502: Registration of Vehicles', why: 'registration, its renewal and the insignia every vehicle on the road must carry' },
  { code: 'TN', chapter: '504', name: 'Transportation Code, Chapter 504: License Plates', why: 'the plates every vehicle must display, and how' },
  { code: 'TN', chapter: '521', name: "Transportation Code, Chapter 521: Driver's Licenses and Certificates", why: "licensing, the learner licence and provisional licence and their limits, driver education, points-style suspension and revocation" },
  { code: 'TN', chapter: '523', name: "Transportation Code, Chapter 523: Driver's License Compact of 1993", why: 'how an offence in another state counts against a Texas licence' },
  { code: 'TN', chapter: '524', name: "Transportation Code, Chapter 524: Administrative Suspension of Driver's License for Failure to Pass Test for Intoxication", why: 'the licence suspension for failing a breath or blood test' },
  { code: 'TN', chapter: '525', name: 'Transportation Code, Chapter 525: Motorcycle and Bicycle Awareness', why: "what the licence examination and driver education must teach about sharing the road" },
  { code: 'TN', chapter: '541', name: 'Transportation Code, Chapter 541: Definitions', why: 'what the rules of the road mean by a vehicle, a moped, a highway or an operator' },
  { code: 'TN', chapter: '542', name: 'Transportation Code, Chapter 542: General Provisions', why: 'where the rules apply and the general penalty for breaking them' },
  { code: 'TN', chapter: '543', name: 'Transportation Code, Chapter 543: Arrest and Prosecution of Violators', why: 'citations, arrest and what a stopped driver must do, and the driving safety course' },
  { code: 'TN', chapter: '544', name: 'Transportation Code, Chapter 544: Traffic Signs, Signals, and Markings', why: 'what signals, signs and markings require of a driver' },
  { code: 'TN', chapter: '545', name: 'Transportation Code, Chapter 545: Operation and Movement of Vehicles', why: 'the rules of the road: lanes, passing, right of way, turning, stopping, speed, school buses, parking, phones, seat belts and child seats' },
  { code: 'TN', chapter: '547', name: 'Transportation Code, Chapter 547: Vehicle Equipment', why: 'lights, brakes, mirrors, tint and the equipment a vehicle must have' },
  { code: 'TN', chapter: '548', name: 'Transportation Code, Chapter 548: Inspection of Vehicles', why: 'the inspection every registered vehicle must pass' },
  { code: 'TN', chapter: '550', name: 'Transportation Code, Chapter 550: Collisions and Collision Reports', why: 'what a driver must do after a crash' },
  { code: 'TN', chapter: '551', name: 'Transportation Code, Chapter 551: Operation of Bicycles and Mopeds, Golf Carts, and Other Low-Powered Vehicles', why: 'the rules for cyclists and moped riders, and drivers around them' },
  { code: 'TN', chapter: '552', name: 'Transportation Code, Chapter 552: Pedestrians and Other Sidewalk Users', why: "pedestrians' rights and duties, and drivers' duties to them" },
  { code: 'TN', chapter: '552A', name: 'Transportation Code, Chapter 552A: Devices Subject to Pedestrian Laws', why: 'motorised mobility devices and where they may be used' },
  { code: 'TN', chapter: '601', name: 'Transportation Code, Chapter 601: Motor Vehicle Safety Responsibility Act', why: 'the insurance every vehicle must carry and the penalty for driving without it' },
  { code: 'TN', chapter: '661', name: 'Transportation Code, Chapter 661: Protective Headgear for Motorcycle Operators and Passengers', why: "who must wear a helmet on a motorcycle" },
  { code: 'TN', chapter: '662', name: 'Transportation Code, Chapter 662: Motorcycle Operator Training and Safety', why: 'the course a motorcycle licence requires' },
  { code: 'TN', chapter: '681', name: 'Transportation Code, Chapter 681: Privileged Parking', why: 'disabled parking placards and plates, and the fines for misusing the spaces' },
  { code: 'TN', chapter: '703', name: 'Transportation Code, Chapter 703: Nonresident Violator Compact of 1977', why: "what happens to a licence when a citation in another member state goes unanswered" },
  { code: 'TN', chapter: '705', name: 'Transportation Code, Chapter 705: Allowing Dangerous Driver to Borrow Motor Vehicle', why: "an owner's offence in lending a vehicle to an unlicensed or intoxicated driver" },
  { code: 'TN', chapter: '706', name: 'Transportation Code, Chapter 706: Denial of Renewal of License for Failure to Appear', why: 'the licence a driver cannot renew while a citation is unanswered' },
  { code: 'TN', chapter: '709', name: 'Transportation Code, Chapter 709: Miscellaneous Traffic Fines', why: 'fines added to traffic convictions' },
  { code: 'TN', chapter: '724', name: 'Transportation Code, Chapter 724: Implied Consent', why: 'the breath or blood test every driver consents to, and the suspension for refusing it' },
  { code: 'TN', chapter: '725', name: 'Transportation Code, Chapter 725: Transportation of Loose Materials', why: 'covering a load so it does not fall on the road' },
  { code: 'TN', chapter: '727', name: 'Transportation Code, Chapter 727: Modification of, Tampering With, and Equipment of Motor Vehicles', why: 'mufflers and emission equipment a driver may not remove' },
  { code: 'TN', chapter: '729', name: 'Transportation Code, Chapter 729: Operation of Motor Vehicle by Minor', why: 'how a minor\'s traffic offences are tried and punished' },
  { code: 'PE', chapter: '49', name: 'Penal Code, Chapter 49: Intoxication and Alcoholic Beverage Offenses', why: 'driving while intoxicated, the 0.08 limit, open containers and intoxication manslaughter, codified in the Penal Code' },
  { code: 'AL', chapter: '106', name: 'Alcoholic Beverage Code, Chapter 106: Provisions Relating to Age', why: 'underage possession and driving under the influence by a minor, codified in the beverage law' },
]

const idOf = (code: Code, chapter: string) => `${code.toLowerCase()}${chapter.toLowerCase()}`

export function chapterUrl(code: Code, chapter: string): string {
  return `${ORIGIN}${code}/htm/${code}.${chapter}.htm`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`tcss.legis.texas.gov answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

interface Element {
  /**
   * `note`: which version of a section or subsection follows. `repealed`: the
   * editors' word that the section is repealed though a later act amended it.
   * `editorial`: an editors' note that changes nothing ("For expiration of this
   * section, see Subsection (c)."). `end`: the history, or the next subchapter.
   */
  kind: 'body' | 'note' | 'repealed' | 'editorial' | 'end'
  /** The paragraph's text-indent in ex; a table row is deeper than any paragraph. */
  indent: number
  text: string
}

/** A chapter file's sections by number, each with every copy the file serves. */
function sectionsOf(html: string, chapter: string): Map<string, string[]> {
  const own = new RegExp(`<a name="(${chapter.replace('.', '\\.')}\\.[0-9A-Za-z.-]+)">`, 'g')
  const starts = [...html.matchAll(own)]
  const sections = new Map<string, string[]>()
  for (const [index, match] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length
    const block = html.slice(match.index, end)
    sections.set(match[1], [...(sections.get(match[1]) ?? []), block])
  }
  return sections
}

function elementsOf(block: string): Element[] {
  const out: Element[] = []
  for (const match of block.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>|<table\b[\s\S]*?<\/table>/g)) {
    if (match[0].startsWith('<table')) {
      for (const row of match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
        const text = inline(row[1].replace(/<t[dh]\b[^>]*>/gi, ' '))
        if (text.length > 0) out.push({ kind: 'body', indent: 99, text })
      }
      continue
    }
    const [, attributes, inner] = match
    // The catchline is the bold link to the section's own address, where the site prints one: its end is the link's.
    const text = inline(inner.replace(/(font-weight:bold;">Sec\. [^<]*)<\/a>/, `$1${CATCHLINE_END}`))
    if (text.length === 0) continue
    const indent = /text-indent:(\d+)ex/.exec(attributes)
    if (/class="center"/.test(attributes)) out.push({ kind: centred(text), indent: 0, text })
    else if (indent !== null) out.push({ kind: 'body', indent: Number(indent[1]), text })
    // Unindented and not history: the statement § 601.233 requires a citation to print, quoted in the law.
    else out.push({ kind: HISTORY.test(text) ? 'end' : 'body', indent: 99, text })
  }
  return out
}

/** The session laws after a section's text: "Acts 1995, 74th Leg., …", "Added by …", "Amended by:", "Transferred, redesignated …". */
const HISTORY = /^(Acts \d{4}|Added by|Amended by|Transferred|Redesignated|Renumbered|Reenacted|Repealed by)\b/

/**
 * A centred paragraph. The articles of the Nonresident Violator Compact
 * (§ 703.002) are centred headings inside the law -- "Art. I. FINDINGS,
 * DECLARATION OF POLICY, AND PURPOSE" -- and read as the end of the section,
 * they cut the compact to its first line.
 */
function centred(text: string): Element['kind'] {
  if (/^Text of (section|subsection)\b/.test(text)) return 'note'
  if (/^Without reference to the amendment of this (section|subsection), this section was repealed\b/.test(text)) return 'repealed'
  if (/^For expiration of\b/.test(text)) return 'editorial'
  if (/^(SUBCHAPTER|CHAPTER|SUBTITLE|TITLE) [0-9A-Z]+\./.test(text)) return 'end'
  return 'body'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Whether a version note's copy is the law today: null where the note names no date (an unreconciled amendment, in effect). */
function inForce(note: string, today: string): boolean {
  const dated = /effective (until|on) (\w+) (\d{1,2}), (\d{4})/.exec(note)
  if (dated === null) {
    if (/as (amended|added|redesignated|transferred|reenacted)\b/.test(note)) return true
    throw new Error(`a version note this extract does not know: "${note}"`)
  }
  const [, condition, month, day, year] = dated
  const index = MONTHS.indexOf(month)
  if (index < 0) throw new Error(`a version note with an unknown month: "${note}"`)
  const date = `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
  return condition === 'until' ? date > today : date <= today
}

const site: Site = {
  // The Texas Legislative Council's file server, which statutes.capitol.texas.gov reads its chapters from.
  official: ORIGIN,
  name: 'the Texas Statutes',
  titles: TITLES.map(({ code, chapter, name, why }) => ({ id: idOf(code, chapter), name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const { code, chapter } of TITLES) {
      const url = chapterUrl(code, chapter)
      const html = await page(url)
      const before = listings.length
      for (const [section, blocks] of sectionsOf(html, chapter)) {
        const heading = blocks
          .flatMap((block) => elementsOf(block))
          .map((element) => (element.kind === 'body' ? catchlineOf(element.text, section) : null))
          .find((each) => each !== null)
        listings.push({
          file: `${idOf(code, chapter)}-${section}`,
          url: `${url}#${section}`,
          section,
          cite: `${CODES[code]} § ${section}`,
          heading: heading === undefined || heading === null ? '' : capitalised(heading),
        })
      }
      // A chapter read as nothing would be a title fetched as nothing, reported present.
      if (listings.length === before) throw new Error(`${url} lists no section of chapter ${chapter}`)
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractTexas(body, listing.section),
}

export default site

/**
 * One section's text: a line per subsection, paragraph and sub-paragraph, each
 * opening with its label as the statute prints it, and a line per table row.
 * Only the copy in effect today, without the catchline, the editors' version
 * notes or the history.
 */
export function extractTexas(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const chapter = section.slice(0, section.lastIndexOf('.'))
  const blocks = sectionsOf(html, chapter).get(section)
  if (blocks === undefined) throw new Unavailable(`the chapter file has no section ${section}`)
  const copies: string[][] = []
  let repealed = false
  for (const block of blocks) {
    const elements = elementsOf(block)
    const opening = elements.findIndex((element) => element.kind === 'body' && element.text.startsWith(`Sec. ${section}.`))
    if (opening < 0) throw new Error(`${section}: no "Sec. ${section}." line in its block`)
    // A note above the "Sec." line is the whole section's.
    const sectionNote = elements.slice(0, opening).find((element) => element.kind === 'note')
    if (sectionNote !== undefined && !inForce(sectionNote.text, today)) continue
    // §§ 502.092, 504.404, 504.406: repealed, and served with the text a later act amended.
    const history = elements.findIndex((element, index) => index > opening && element.kind === 'end')
    if (elements.slice(0, history < 0 ? elements.length : history).some((element) => element.kind === 'repealed')) {
      repealed = true
      continue
    }
    const lines: string[] = []
    let dropping: number | null = null
    let versioned: number | null = null
    let note: boolean | null = null
    for (const element of elements.slice(opening)) {
      // The history: "Acts 1995, 74th Leg., …", "Added by …", "Amended by:". Not law.
      if (element.kind === 'end') break
      if (element.kind === 'editorial' || element.kind === 'repealed') continue
      if (element.kind === 'note') {
        note = inForce(element.text, today)
        versioned = null
        dropping = null
        continue
      }
      if (note !== null && versioned === null) {
        versioned = element.indent
        if (!note) dropping = element.indent
        note = null
      } else if (versioned !== null && element.indent <= versioned) {
        versioned = null
        dropping = null
      }
      if (dropping !== null) continue
      lines.push(...linesOf(element.text, section))
    }
    if (lines.length > 0) copies.push(lines)
  }
  if (copies.length === 0) throw new Unavailable(repealed ? `the editors note ${section} as repealed` : `${section} is served only in a version not in effect today`)
  if (copies.length > 1) throw new Error(`${section} is served in ${copies.length} versions in effect today`)
  return copies[0].join('\n') + '\n'
}

/** Where the bold link around a catchline closed: a character no statute prints. */
const CATCHLINE_END = '\u0000'

/**
 * "Sec. 545.062.  FOLLOWING DISTANCE.  (a)  An operator…": the catchline ends
 * where its bold link does, or, where the site prints it without one, at the
 * first full stop of the capitals -- one space after it in § 502.479, not two.
 */
const CATCHLINE = /^Sec\. (\S+?)\.\s+(?:([^\u0000]*?)\.?\s*\u0000|([^a-z\u0000]*?)\.(?:\s+|$))([\s\S]*)$/

function catchlineOf(text: string, section: string): string | null {
  const match = CATCHLINE.exec(text)
  return match === null || match[1] !== section ? null : (match[2] ?? match[3]).trim()
}

/** A paragraph as lines: the catchline line loses its catchline, and its first subsection, if any, is a line of its own. */
function linesOf(text: string, section: string): string[] {
  const plain = (line: string) => line.replace(/\s+/g, ' ').trim()
  if (!text.startsWith(`Sec. ${section}.`)) return [plain(text)]
  const rest = CATCHLINE.exec(text)
  if (rest === null) throw new Error(`${section}: cannot tell the catchline from the law in "${text.slice(0, 120)}"`)
  const body = plain(rest[4])
  return body.length === 0 ? [] : [body]
}

/** "FOLLOWING DISTANCE" as "Following distance". */
function capitalised(heading: string): string {
  const lower = heading.replace(/\s+/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** A paragraph's markup as its text, its spacing kept so the catchline's two-space end can be found. */
function inline(html: string): string {
  const text = decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[ \t\r\n]/g, ' ')
  return text.trim()
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
