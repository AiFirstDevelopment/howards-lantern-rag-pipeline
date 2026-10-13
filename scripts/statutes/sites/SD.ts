/**
 * South Dakota: the South Dakota Codified Laws as the Legislative Research
 * Council publishes them for the Legislature (sdlegislature.gov). The site's
 * pages are a JavaScript reader, but the reader draws every page from the
 * same site's JSON API, which robots.txt leaves open, and that is what is
 * read here: `/api/Statutes/Statute/32-30` is a chapter with its table of
 * sections, `/api/Statutes/Statute/32-30-6` one section with its text as
 * HTML. An index-page `enumerate`, as Maryland's: a chapter's table lists
 * every section with its catchline.
 *
 * The site publishes the Codified Laws as in effect on one date (2026-09-03
 * when this was written, `/api/Statutes/LastStatuesEffectiveDate`) and keeps
 * no second, later version of any section of the chapters read here; a
 * section the table lists only as "Repealed", "Superseded", "Transferred" or
 * "Omitted" is never fetched, and one served as only such a marker is
 * reported, not committed.
 *
 * What `extract` keeps: the section's paragraphs, one line each, without its
 * heading paragraph (number and catchline: the listing carries the catchline)
 * and without the "Source:" history note and anything after it, which record
 * the session laws behind the text, not law. A word broken across spans at a
 * hyphen ("main</span><span>-</span><span>traveled") is joined as the page
 * shows it. South Dakota writes its subsections "(1)" and "(a)" with a run of
 * spaces after the label ("(2)    Within fifteen feet"); only that whitespace
 * is collapsed. No word is touched.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://sdlegislature.gov/'
const API = `${ORIGIN}api/Statutes/Statute/`
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 32, and why: 32-1
 * and 32-2 (the department's administration and the highway patrol), 32-3A
 * and 32-7B (boats), 32-4 (theft of vehicles: a crime against property, not a
 * rule of driving), 32-5A and 32-5B (county wheel tax and excise tax), 32-6B
 * to 32-8 and 32-39 (dealer and manufacturer regulation and franchising),
 * 32-9 and 32-10 (motor-carrier certificates and interstate fleet
 * registration), 32-11 (motor vehicle funds), 32-12A (commercial driver's
 * licences: they bind CDL holders, and their permit and alcohol rules crowd
 * out the ordinary ones), 32-13 (the governor's highway safety program),
 * 32-20A (snowmobiles), 32-36 (abandoned and junk vehicles and scrap metal
 * dealers), 32-40 (transportation network companies), 32-41 (automated
 * driving systems: rules for a vehicle without a human driver), and the
 * repealed chapters 32-6, 32-6A, 32-7, 32-8, 32-15A and 32-16.
 */
const TITLES: {
  chapter: string
  name: string
  why: string
  /** Which of the chapter's sections are in, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  { chapter: '32-3', name: 'Chapter 32-3: Title Registration, Liens and Transfers', why: 'the certificate of title every owner must hold and transfer on a sale' },
  { chapter: '32-5', name: 'Chapter 32-5: Annual Registration and License Plates', why: 'registration, plates and their display, and the fees every owner pays' },
  { chapter: '32-12', name: 'Chapter 32-12: Driver Licenses and Permits', why: "the licence, the instruction permit and the restricted minor's permit, testing, points, and suspension and revocation" },
  { chapter: '32-14', name: 'Chapter 32-14: Traffic Regulation Generally', why: 'the definitions every rule of the road reads by, and where the rules apply' },
  { chapter: '32-15', name: 'Chapter 32-15: Vehicle and Accessory Specifications', why: 'windows and tint, mirrors, wipers, mufflers and the other equipment a driver must keep' },
  { chapter: '32-17', name: 'Chapter 32-17: Vehicle Lights and Flares', why: 'when headlights must be on, dimming, and every lamp and reflector a vehicle carries' },
  { chapter: '32-18', name: 'Chapter 32-18: Brakes and Brake Fluid', why: 'the brakes a vehicle must have and keep working' },
  { chapter: '32-19', name: 'Chapter 32-19: Wheels, Tires, and Special Vehicles', why: 'studded tyres, towing and the couplings between vehicles' },
  { chapter: '32-20', name: 'Chapter 32-20: Motorcycle Regulation', why: 'the rules for riding a motorcycle and moped: helmets, eye protection, passengers and lanes' },
  { chapter: '32-20B', name: 'Chapter 32-20B: Bicycle Regulation', why: 'the rules for bicycles on the road, which drivers share it with, and the distance to pass one' },
  { chapter: '32-21', name: 'Chapter 32-21: Motor Vehicle Inspection', why: "a driver's duty to stop for an inspection and not to drive an improperly repaired vehicle" },
  { chapter: '32-22', name: 'Chapter 32-22: Weight, Size and Load Restrictions', why: 'the size, weight and load limits a driver must keep to, and securing a load' },
  { chapter: '32-23', name: 'Chapter 32-23: Driving Under the Influence', why: 'driving under the influence, the alcohol limits, implied consent and the penalties' },
  { chapter: '32-24', name: 'Chapter 32-24: Reckless and Unsafe Driving', why: 'reckless driving and the other offences of unsafe driving' },
  { chapter: '32-25', name: 'Chapter 32-25: Speed Regulation', why: 'the speed limits and the duty to drive at a careful speed' },
  { chapter: '32-26', name: 'Chapter 32-26: Rules of the Road', why: 'the rules of the road: lanes, passing, turning, signals, right of way, following distance and texting' },
  { chapter: '32-27', name: "Chapter 32-27: Pedestrians' Rights and Duties", why: 'yielding to pedestrians and the blind, and the rules pedestrians keep' },
  { chapter: '32-28', name: 'Chapter 32-28: Traffic Control Devices', why: 'obeying signals and signs, and turning on a red light' },
  { chapter: '32-29', name: 'Chapter 32-29: Required Stops', why: 'stop signs, railroad crossings and entering from a private road' },
  { chapter: '32-30', name: 'Chapter 32-30: Stopping and Parking Restrictions', why: 'where a vehicle may not stop, stand or park, and how far from a hydrant or crosswalk' },
  { chapter: '32-31', name: 'Chapter 32-31: Emergency Vehicles', why: 'yielding to and moving over for emergency vehicles, and following a fire truck' },
  { chapter: '32-32', name: 'Chapter 32-32: School Buses', why: 'stopping for a school bus with its lights flashing' },
  { chapter: '32-33', name: 'Chapter 32-33: Apprehension and Prosecution of Violators', why: 'arrest, the summons and the duty to stop for an officer' },
  { chapter: '32-34', name: 'Chapter 32-34: Accidents and Accident Reports', why: 'what a driver must do after a crash, and reporting it' },
  { chapter: '32-35', name: 'Chapter 32-35: Financial Responsibility of Vehicle Owners and Operators', why: 'the insurance every owner must carry, proof of it, and the suspension for lacking it' },
  { chapter: '32-37', name: 'Chapter 32-37: Child Passenger Restraint System', why: 'when a child must ride in a restraint system' },
  { chapter: '32-38', name: 'Chapter 32-38: Safety Belt System Usage in Passenger Vehicles', why: 'who must wear a seat belt' },
  {
    chapter: '35-1',
    name: 'Chapter 35-1, Section 35-1-9.1: Consumption or possession of alcoholic beverage in vehicle',
    why: 'the open-container rule, codified in the alcoholic beverages title',
    keep: (section) => section === '35-1-9.1',
  },
  {
    chapter: '35-9',
    name: 'Chapter 35-9, Section 35-9-2: Purchase, possession, or consumption by person under twenty-one',
    why: "a minor's purchase, possession or consumption of alcohol, codified in the alcoholic beverages title",
    keep: (section) => section === '35-9-2',
  },
]

/** The state's own citation form: "SDCL § 32-30-6". */
export function cite(section: string): string {
  return `SDCL § ${section}`
}

const titleId = (chapter: string) => `sdcl-${chapter}`

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`sdlegislature.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** What the API serves for one chapter or section. */
interface Served {
  Statute: string
  Type: string
  CatchLine: string | null
  Repealed: boolean
  Html: string | null
}

function served(body: string, expected: string): Served {
  let parsed: Served
  try {
    parsed = JSON.parse(body) as Served
  } catch {
    throw new Error(`sdlegislature.gov served something other than JSON for ${expected}: "${body.slice(0, 60)}"`)
  }
  if (parsed.Statute !== expected) throw new Error(`asked for ${expected}, sdlegislature.gov served ${parsed.Statute}`)
  return parsed
}

/** The paragraphs of an HTML body, each as plain text with its whitespace collapsed. */
function paragraphs(html: string): string[] {
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  return [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(([, inner]) => inline(inner))
}

/** A table-of-contents entry that keeps only a marker, never a law: "32-12-9. Superseded.", "32-21-1 to 32-21-3. Repealed." */
const MARKER = /^(?:[.,]|to\b|\(?(?:Repealed|Superseded|Transferred|Omitted|Expired|Executed|Obsolete|Reserved|Rejected)\b)/i

/**
 * A chapter's table of sections, one entry a section, the entries for repealed
 * and moved sections left out. The site serves tables in more than one form:
 * most chapters as `<p><a href="…Statutes?Statute=32-30-6">32-30-6</a><span>    Places where …</span></p>`,
 * 32-28 linking `…/Codified_Laws/DisplayStatute.aspx?…&Statute=32-28-1`, and
 * 32-18, converted from WordPerfect, as `<a href="/statutes/DisplayStatute.aspx?Type=Statute&Statute=32-18-1">32-18-1</a>
 * &nbsp;… Brakes required …<br>`. Every form is a block opening on the link to
 * its section.
 */
export function sectionsListed(html: string, chapter: string): { section: string; heading: string }[] {
  const listed: { section: string; heading: string }[] = []
  // The chapter's page is its table, one HTML document, then every section's text as one
  // document each; a paragraph of those opening on a cross-reference is not an entry.
  const table = html.slice(0, html.indexOf('</html>') < 0 ? html.length : html.indexOf('</html>'))
  const body = table.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  for (const block of body.split(/<p\b[^>]*>|<\/p>|<br\s*\/?>/i)) {
    const link = /^\s*<a href="[^"]*[?&](?:amp;)?Statute=([\w.-]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*)$/.exec(block)
    if (link === null || !link[1].startsWith(`${chapter}-`)) continue
    const [, section, label, rest] = link
    if (inline(label) !== section) throw new Error(`chapter ${chapter} links ${section} under the label "${inline(label)}"`)
    const heading = inline(rest)
    // A marker entry repeats its number before the marker: "32-12-9    32-12-9. Superseded."
    if (heading === '' || MARKER.test(heading) || heading.startsWith(section)) continue
    listed.push({ section, heading })
  }
  return listed
}

const site: Site = {
  // The Legislative Research Council publishes the Codified Laws for the Legislature.
  official: ORIGIN,
  name: 'the South Dakota Codified Laws',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: titleId(chapter), name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      const chapter = served(await page(`${API}${title.chapter}`), title.chapter)
      if (chapter.Type !== 'Chapter' || chapter.Html === null) throw new Error(`${title.chapter} is served as a ${chapter.Type}, not a chapter`)
      for (const { section, heading } of sectionsListed(chapter.Html, title.chapter)) {
        if (title.keep !== undefined && !title.keep(section)) continue
        listings.push({ file: `sdcl-${section}`, url: `${API}${section}`, section, cite: cite(section), heading })
      }
      // A table read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the table of chapter ${title.chapter} lists nothing kept`)
      await pause()
    }
    const seen = new Set<string>()
    for (const listing of listings) {
      if (seen.has(listing.section)) throw new Error(`SDCL § ${listing.section} is listed twice`)
      seen.add(listing.section)
    }
    return listings
  },
  extract: (body, listing) => extractSdcl(body, listing.section),
}

export default site

/**
 * One section's law out of what the API serves for it: the paragraphs after
 * the heading and before the "Source:" note, one line each.
 */
export function extractSdcl(body: string, section: string): string {
  const statute = served(body, section)
  if (statute.Type !== 'Section') throw new Error(`SDCL § ${section} is served as a ${statute.Type}`)
  if (statute.Repealed) throw new Unavailable('the Codified Laws mark it repealed')
  if (statute.Html === null || statute.Html.trim() === '') throw new Unavailable('the Codified Laws serve no text for it')
  const all = paragraphs(tableRows(statute.Html)).filter((text) => text !== '')
  const heading = all.shift()
  if (heading === undefined || !heading.startsWith(section)) throw new Error(`SDCL § ${section} does not open on its heading: "${heading?.slice(0, 60)}"`)
  const source = all.findIndex((text) => /^Source:/.test(text))
  if (source < 0) throw new Error(`SDCL § ${section} has no Source note to end its text`)
  const law = all.slice(0, source)
  const plain = law.join(' ')
  if (plain.length < 200 && (law.length === 0 || /^(Repealed|Superseded|Transferred|Omitted|Expired|Executed|Obsolete|Reserved)\b/i.test(plain))) {
    throw new Unavailable('the Codified Laws keep only a marker for it')
  }
  // Text in force on a later day than today would be marked in the section; none is today, and a guess would not be the law.
  if (/\[?Effective (?:on |from |July|January|upon)/i.test(plain)) throw new Error(`SDCL § ${section} carries an effective-date note this module cannot read`)
  return law.join('\n') + '\n'
}

/**
 * A table's rows as paragraphs, each row's cells on one line separated by a
 * space: § 32-5-2.2's registration months, "January A, B". Each cell holds its
 * own paragraphs, which read as paragraphs of the law would put "January" and
 * "A, B" on lines of their own.
 */
function tableRows(html: string): string {
  return html
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => inline(cell)).filter((cell) => cell !== '')
      return `<p>${cells.join(' ')}</p>`
    })
    .replace(/<\/?(?:table|tbody|thead)\b[^>]*>/gi, '')
}

function inline(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ')
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
