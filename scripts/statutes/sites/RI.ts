/**
 * Rhode Island: the General Laws as the General Assembly publishes them
 * (webserver.rilegislature.gov/Statutes), one section per page. An index-page
 * `enumerate`, as Maryland's: each chapter's INDEX.htm lists its sections by
 * file, with the catchline, and names a repealed, reserved or expired section
 * so in the list itself, so one is never asked for.
 *
 * A section whose amendment waits on a date or a contingency is served with
 * both texts on one page (31-10-19_31-10-19.htm), each under its own
 * catchline carrying a bracketed note: "[Effective until January 1, 2026.]"
 * and then "[Effective January 1, 2026.]", or "[Effective until contingency
 * in P.L. 2017, ch. 156 and 160 is met.]" and "[Effective when contingency
 * … is met.]". `extract` keeps the one copy in force on the day it runs and
 * refuses a note it cannot read rather than guess. A contingency is taken as
 * not yet met: the site still serves the text that runs until it is.
 *
 * Rhode Island labels its subsections "(a)", "(1)", "(i)", "(A)", a paragraph
 * each, which the chunker reads as they are. Nothing in the text is rewritten
 * but whitespace; the "§ 31-21-4. Places where parking or stopping
 * prohibited." line at the top is the listing's heading and is dropped, as is
 * the "History of Section." block of session laws under it. A table (the
 * schedule of fines in § 31-41.1-4) is a line per row, its cells joined by a
 * space.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://webserver.rilegislature.gov/Statutes/'

/**
 * The chapters a licence-holder is bound by. Out of Title 31, and why: 31-2
 * the division of motor vehicles' organisation; 31-2.1 its theft-prevention
 * programme; 31-3.1 and 31-4 certificates of title and transfers, a record of
 * ownership rather than a rule of driving; 31-3.2 snowmobiles and recreational
 * vehicles, kept off the highway by their own rules; 31-3.3 charging-station
 * signage; 31-5 to 31-5.5 dealers, manufacturers, rental licences and
 * warranties; 31-6 and 31-6.1 the schedule of registration fees and bus tax
 * proration; 31-9 vehicle theft; 31-10.2 the voluntary surrender of a licence,
 * a form; 31-10.3 the commercial driver's licence, which every state so far has
 * left out because its permit and alcohol rules crowd out the ordinary ones;
 * 31-19.3, 31-19.4 and 31-19.5 rules for New Shoreham, Prudence Island and
 * Newport alone; 31-21.1 and 31-21.2 police data collection on traffic stops;
 * 31-22.1 pupil transportation vehicles; 31-23.1 and 31-23.2 the equipment
 * compact and odometer tampering; 31-25 size, weight and load limits and their
 * permits, motor-carrier regulation; 31-29 reciprocity agreements; 31-30, 31-39,
 * 31-41 and 31-43, repealed; 31-34 to 31-35 rental-car and parking-lot owners'
 * liability; 31-36 to 31-37 fuel taxes and gasoline sales; 31-41.2 and 31-41.3
 * the cities' camera programmes and how their notices are processed; 31-42
 * abandoned vehicles; 31-44 to 31-44.2 mobile homes; 31-46 salvage; 31-47.1 to
 * 31-47.4 the emissions programme, diesel emissions and the insurers' database;
 * 31-48 chop shops; 31-50 the insurance-fraud office; 31-53 airbag fraud.
 */
const TITLES: {
  title: '31' | '3'
  chapter: string
  name: string
  why: string
  /** Which sections are out, by number. */
  skip?: (section: string) => boolean
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  { title: '31', chapter: '31-1', name: 'R.I. Gen. Laws ch. 31-1: Definitions and General Code Provisions', why: 'what the code means by a vehicle, a motorcycle, a highway or a driver' },
  {
    title: '31',
    chapter: '31-3',
    name: 'R.I. Gen. Laws ch. 31-3: Registration of Vehicles',
    why: 'registration, the registration card and plates every owner must carry and display, and renewal',
    // Out: the delinquent-tax and court-cost lists (6 to 6.3) and the record
    // index (7), the dealers', bailees', officials' and tow-truck plates (13
    // to 31.4), and the hundred-odd special and emeritus plates (39 on) -- one
    // per office, cause or club -- but for returning the plates (41) and a
    // registration suspended on a federal finding (69).
    skip: (section) => {
      const n = Number(section.split('-')[2])
      if (['31-3-41', '31-3-69'].includes(section)) return false
      return (n >= 6 && n < 8) || (n >= 13 && n < 32) || n >= 39
    },
  },
  { title: '31', chapter: '31-7', name: 'R.I. Gen. Laws ch. 31-7: Foreign Vehicles', why: "when a visitor's or a new resident's out-of-state registration is good here, and for how long" },
  { title: '31', chapter: '31-8', name: 'R.I. Gen. Laws ch. 31-8: Offenses Against Registration and Certificate of Title Laws', why: 'driving an unregistered vehicle or one with false plates, and the penalties' },
  { title: '31', chapter: '31-10', name: "R.I. Gen. Laws ch. 31-10: Operators' and Chauffeurs' Licenses", why: "licensing, the limited instruction permit, the provisional licence and its limits, examination and driver education" },
  { title: '31', chapter: '31-10.1', name: 'R.I. Gen. Laws ch. 31-10.1: Special Licenses for Motorcycles, Motor Scooters, Low-Speed Vehicles and Other Motor Driven Cycles', why: 'the motorcycle licence and permit, and the helmet and equipment its riders must wear' },
  { title: '31', chapter: '31-10.4', name: 'R.I. Gen. Laws ch. 31-10.4: Driver Privilege Cards and Permits; State Identification Cards', why: 'the driver privilege card and permit, a licence by another name for those without lawful presence' },
  { title: '31', chapter: '31-11', name: 'R.I. Gen. Laws ch. 31-11: Suspension or Revocation of Licenses — Violations', why: 'when a licence is suspended or revoked, and driving without one or while it is' },
  { title: '31', chapter: '31-12', name: 'R.I. Gen. Laws ch. 31-12: Applicability of Traffic Regulations', why: 'where the rules of the road apply, obedience to police, and emergency vehicles' },
  { title: '31', chapter: '31-13', name: 'R.I. Gen. Laws ch. 31-13: Traffic Control Devices', why: 'traffic signals, signs and markings, and turning on a red light' },
  { title: '31', chapter: '31-14', name: 'R.I. Gen. Laws ch. 31-14: Speed Restrictions', why: 'the speed limits, school zones and the duty to drive at a reasonable speed' },
  { title: '31', chapter: '31-15', name: 'R.I. Gen. Laws ch. 31-15: Passing, Use of Lanes, and Rules of the Road', why: 'lanes, passing on the left and the right, following distance and one-way roads' },
  { title: '31', chapter: '31-16', name: 'R.I. Gen. Laws ch. 31-16: Starting, Stopping, and Turns', why: 'turning, U-turns and signalling, and how far before a turn' },
  { title: '31', chapter: '31-16.1', name: 'R.I. Gen. Laws ch. 31-16.1: Idling', why: 'how long a vehicle may idle' },
  { title: '31', chapter: '31-17', name: 'R.I. Gen. Laws ch. 31-17: Right-Of-Way', why: 'right of way at intersections, stop and yield signs, and for emergency vehicles' },
  { title: '31', chapter: '31-18', name: 'R.I. Gen. Laws ch. 31-18: Pedestrians', why: "pedestrians' rights and duties, crosswalks, blind pedestrians and what a driver owes them" },
  { title: '31', chapter: '31-19', name: 'R.I. Gen. Laws ch. 31-19: Operation of Bicycles', why: 'the bicyclists a driver shares the road with, and passing them' },
  { title: '31', chapter: '31-19.1', name: 'R.I. Gen. Laws ch. 31-19.1: Motorized Bicycles', why: 'who may ride a motorized bicycle and how' },
  { title: '31', chapter: '31-19.2', name: 'R.I. Gen. Laws ch. 31-19.2: Motorized Tricycles', why: 'who may ride a motorized tricycle and how' },
  { title: '31', chapter: '31-19.6', name: 'R.I. Gen. Laws ch. 31-19.6: Low-Speed Vehicles', why: 'where a low-speed vehicle may be driven' },
  { title: '31', chapter: '31-19.7', name: 'R.I. Gen. Laws ch. 31-19.7: Electric Bicycles', why: 'the classes of electric bicycle and where each may be ridden' },
  { title: '31', chapter: '31-20', name: 'R.I. Gen. Laws ch. 31-20: Special Stops Required', why: 'stopping for school buses, railroad crossings and stop signs' },
  { title: '31', chapter: '31-21', name: 'R.I. Gen. Laws ch. 31-21: Stopping, Standing, and Parking Restrictions', why: 'where a vehicle may not stop, stand or park, and how near the curb' },
  {
    title: '31',
    chapter: '31-22',
    name: 'R.I. Gen. Laws ch. 31-22: Miscellaneous Rules',
    why: 'seat belts and child seats, phones and texting, open containers, following fire apparatus, littering and unattended vehicles',
    // Out: the school-bus operators' insurance and inspection regime (10.1 to
    // 11.6.1), passenger carriers for hire (12), the towing and storage liens
    // and sales (13 to 19), tow-truck identification (23) and the inspection
    // of fire apparatus (29) -- duties of carriers, towers and fleets.
    skip: (section) => {
      const [, , number] = section.split('-')
      const n = Number(number.split('.')[0])
      return (n === 10 && number !== '10') || (n === 11 && !['11.7', '11.8', '11.9'].includes(number)) || (n >= 12 && n < 20) || n === 23 || n === 29
    },
  },
  { title: '31', chapter: '31-23', name: 'R.I. Gen. Laws ch. 31-23: Equipment and Accessories Generally', why: 'brakes, horns, mirrors, mufflers, tires, headsets and the equipment a vehicle must have' },
  { title: '31', chapter: '31-23.3', name: 'R.I. Gen. Laws ch. 31-23.3: Nontransparent Windshields and Windows', why: 'how dark a window may be tinted' },
  { title: '31', chapter: '31-24', name: 'R.I. Gen. Laws ch. 31-24: Lighting Equipment and Reflectors', why: 'the lights a vehicle must have, when headlights must be on, and dimming high beams' },
  { title: '31', chapter: '31-26', name: 'R.I. Gen. Laws ch. 31-26: Accidents and Accident Reports', why: 'what a driver must do after a crash, and reporting it' },
  { title: '31', chapter: '31-27', name: 'R.I. Gen. Laws ch. 31-27: Motor Vehicle Offenses', why: 'impaired driving, the alcohol limits for adults and minors, chemical tests and refusal, reckless driving and eluding police' },
  { title: '31', chapter: '31-27.1', name: 'R.I. Gen. Laws ch. 31-27.1: Aggressive Driving', why: 'what aggressive driving is, and its penalty' },
  { title: '31', chapter: '31-28', name: 'R.I. Gen. Laws ch. 31-28: Parking Facilities and Privileges', why: 'disability parking, its placards and plates, and the fine for parking in a space without one' },
  { title: '31', chapter: '31-31', name: 'R.I. Gen. Laws ch. 31-31: Safety Responsibility Administration — Security Following Accident', why: 'the security a driver must post after a crash without insurance' },
  { title: '31', chapter: '31-32', name: 'R.I. Gen. Laws ch. 31-32: Proof of Financial Responsibility for the Future', why: 'proof of insurance a driver must give after a judgment or conviction' },
  { title: '31', chapter: '31-33', name: 'R.I. Gen. Laws ch. 31-33: Safety Responsibility Violations — General Provisions', why: 'the penalties for breaking the financial responsibility rules' },
  { title: '31', chapter: '31-38', name: 'R.I. Gen. Laws ch. 31-38: Inspection of Motor Vehicles', why: 'the periodic inspection every vehicle must pass' },
  { title: '31', chapter: '31-40', name: 'R.I. Gen. Laws ch. 31-40: Habitual Offenders', why: 'who is a habitual offender and how long they lose the licence' },
  { title: '31', chapter: '31-41.1', name: 'R.I. Gen. Laws ch. 31-41.1: Adjudication of Traffic Offenses', why: 'the schedule of fines for each violation, and how a summons is answered' },
  { title: '31', chapter: '31-45', name: 'R.I. Gen. Laws ch. 31-45: Noise Limits for Motor Vehicles', why: 'how loud a vehicle may be' },
  { title: '31', chapter: '31-47', name: 'R.I. Gen. Laws ch. 31-47: Motor Vehicle Reparations Act', why: 'the insurance every vehicle must carry, its minimums and proof' },
  { title: '31', chapter: '31-49', name: 'R.I. Gen. Laws ch. 31-49: Ignition Interlock Systems', why: 'the interlock an impaired-driving conviction can require' },
  { title: '31', chapter: '31-51', name: 'R.I. Gen. Laws ch. 31-51: School Bus Safety Enforcement', why: 'the penalty for passing a stopped school bus' },
  { title: '31', chapter: '31-52', name: 'R.I. Gen. Laws ch. 31-52: Funeral Procession Act', why: 'right of way for funeral processions and how drivers must treat them' },
  {
    title: '3',
    chapter: '3-8',
    name: 'R.I. Gen. Laws §§ 3-8-6, 3-8-9 and 3-8-10: Underage Persons and Alcoholic Beverages',
    why: 'underage drinking, and transporting or possessing alcohol under 21, codified in the alcoholic beverages title',
    keep: ['3-8-6', '3-8-9', '3-8-10'],
  },
]

/** "31-21-4" -> "R.I. Gen. Laws § 31-21-4". */
export function cite(section: string): string {
  return `R.I. Gen. Laws § ${section}`
}

function chapterUrl(title: string, chapter: string): string {
  return `${ORIGIN}TITLE${title}/${chapter}/INDEX.htm`
}

/** A chapter index's entries: "31-10-19_31-10-19.htm" and "§ 31-10-19. Driver education … [Effective until …]". */
export function indexOf(html: string): { href: string; section: string; heading: string }[] {
  const out: { href: string; section: string; heading: string }[] = []
  for (const [, href, inner] of html.matchAll(/<a href="([^"]+\.htm)">([\s\S]*?)<\/a>/g)) {
    if (/INDEX\.htm$/i.test(href)) continue
    const text = decode(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    // "§§ 3-8-7 — 3-8-8.1. Repealed." is a range of sections gone: never listed.
    const entry = /^§ ([\d.]+-[\d.]+-[\d.]+)\.\s*(.*)$/.exec(text)
    if (entry === null) continue
    // A two-version entry repeats the catchline after the first note; the first suffices.
    const heading = entry[2].replace(/\s*\[Effective[^\]]*\]\s*[\s\S]*$/, '').replace(/\.$/, '').trim()
    out.push({ href, section: entry[1], heading })
  }
  return out
}

const GONE = /^(\[)?(Repealed|Reserved|Expired|Transferred|Renumbered|Obsolete|Omitted)\b/i

const site: Site = {
  // The General Assembly's own publication of the General Laws.
  official: ORIGIN,
  name: 'the General Laws of Rhode Island',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: chapter, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      const index = indexOf((await fetchedPage(chapterUrl(title.title, title.chapter)).page).body)
      for (const { href, section, heading } of index) {
        if (!section.startsWith(`${title.chapter}-`) || /^[\d.]+$/.test(section.slice(title.chapter.length + 1)) === false) continue
        if (GONE.test(heading) || heading === '') continue
        if (title.keep !== undefined && !title.keep.includes(section)) continue
        if (title.skip?.(section)) continue
        listings.push({ file: section, url: `${ORIGIN}TITLE${title.title}/${title.chapter}/${href}`, section, cite: cite(section), heading })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return listings
  },
  extract: (html, listing) => extractRi(html, listing),
}

export default site

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function isoOf(text: string): string | null {
  const match = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(text.trim())
  if (match === null) return null
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1
  if (month === 0) return null
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/**
 * Whether a copy under "[Effective …]" is the law on `today`. "until <date>"
 * is in force before that day, "<date>" from it; "until contingency … is met"
 * is in force and "when contingency … is met" is not, since the site serving
 * both says the contingency has not happened. Anything else is refused.
 */
export function inForce(note: string, today: string): boolean {
  const body = note.replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  const until = /^until (.+)$/i.exec(body)
  if (until !== null) {
    if (/^contingency\b/i.test(until[1])) return true
    const date = isoOf(until[1])
    if (date !== null) return today < date
  } else {
    if (/^(when|upon) contingency\b/i.test(body)) return false
    const date = isoOf(body.replace(/^on /i, ''))
    if (date !== null) return date <= today
  }
  throw new Error(`an effective note this cannot read: "[Effective ${note}]"`)
}

/**
 * One section's law in effect: its paragraphs, a line each, without the
 * catchline or the session-law history -- and, where the page serves two
 * copies, only the one in force (see the header).
 */
export function extractRi(html: string, listing: Pick<Listing, 'section'>, today = new Date().toISOString().slice(0, 10)): string {
  const start = html.search(/<h3>R\.I\. Gen\. Laws §/)
  if (start < 0) throw new Error(`no "R.I. Gen. Laws §" heading on the page for ${listing.section}`)
  const body = html.slice(start).replace(/<h3>[\s\S]*?<\/h3>/, '')
  const lines = paragraphs(body.replace(/<div>\s*<p>History of Section\.[\s\S]*?<\/div>/g, '\n'))
  const own = new RegExp(`^§ ${listing.section.replace(/\./g, '\\.')}\\.(\\s|$)`)
  const catchlines = lines.flatMap((line, index) => (own.test(line) ? [index] : []))
  if (catchlines.length === 0) throw new Error(`no § ${listing.section} catchline on the page`)
  const copies = catchlines.map((at, index) => {
    const note = /\[Effective ([^\]]*)\]/i.exec(lines[at])?.[1]
    return { note, lines: lines.slice(at + 1, catchlines[index + 1] ?? lines.length) }
  })
  const kept = copies.length === 1 && copies[0].note === undefined ? copies : copies.filter((copy) => copy.note !== undefined && inForce(copy.note, today))
  if (copies.length > 1 && copies.some((copy) => copy.note === undefined)) throw new Error(`§ ${listing.section} has two copies and one carries no effective note`)
  if (kept.length === 0) throw new Unavailable(`no copy of § ${listing.section} is in force on ${today}: ${copies.map((copy) => `[Effective ${copy.note}]`).join(', ')}`)
  if (kept.length > 1) throw new Error(`more than one copy of § ${listing.section} is in force on ${today}`)
  const text = kept[0].lines
  if (text.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return text.join('\n') + '\n'
}

/**
 * A block's paragraphs, each one line; a table a line per row. The page wraps
 * a paragraph's source at about ninety characters, so its own line breaks are
 * whitespace: only the tags end a line.
 */
function paragraphs(block: string): string[] {
  const flat = block
    .replace(/\s+/g, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => table.replace(/<\/p>|<\/td>|<\/th>|<br\s*\/?>/gi, ' ').replace(/<\/tr>/gi, '\n'))
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
