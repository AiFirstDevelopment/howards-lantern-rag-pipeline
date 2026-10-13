/**
 * Ohio: the Ohio Revised Code as the Legislative Service Commission publishes
 * it (codes.ohio.gov). An index-page `enumerate`, as Maryland's: each chapter's
 * page lists its sections with their catchlines, and each section has a page
 * of its own, "codes.ohio.gov/ohio-revised-code/section-4511.68".
 *
 * A section's page serves the version in effect under its "Effective:" date,
 * the earlier versions only as links ("View October 3, 2023 Version") and not
 * as text. `extract` reads the one `laws-body` block, and refuses a page whose
 * effective date is after the day it runs or that names more than one, rather
 * than commit a law not yet in force as the law today.
 *
 * Ohio labels its divisions "(A)", "(1)", "(a)", "(i)", each a paragraph of
 * its own, and runs a division's first nested labels together with it --
 * "(C)(1)(a) Except as provided…" -- which the chunker already reads, as it
 * does Maryland's "(b) (1)". Nothing in the text is rewritten but whitespace.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://codes.ohio.gov/ohio-revised-code/'

/**
 * The chapters a licence-holder is bound by. Out of Title 45, and why: 4504 is
 * the counties' and cities' permissive licence tax; 4505 the certificate of
 * title, a record of ownership and its transfer rather than a rule of driving;
 * 4506 the commercial driver's licence, which every state so far has left out
 * because its permit and alcohol rules crowd out the ordinary ones; 4508 the
 * licensing of driver-training schools; 4516 peer-to-peer car-sharing
 * businesses; 4517 dealers, auctions and salespersons; 4519 snowmobiles,
 * off-highway motorcycles and all-purpose vehicles, kept off the highway by
 * their own rules; 4521 how a local authority runs its own parking tickets;
 * 4551 Christmas-tree haulage; 4561 to 4585 aviation, airports, ports, ferries
 * and watercraft.
 *
 * Inside 4503, the deputy registrars' offices, the manufactured-home tax and
 * its homestead reduction, and the specialty plates -- some two hundred
 * sections, one per charity, school or club, each its fee and design -- with
 * the international registration plan for interstate carriers that sits among
 * them; the disability placards (4503.44) and the collector's vehicle licence
 * (4503.45) in that run are kept.
 */
const TITLES: {
  chapter: string
  name: string
  why: string
  /** Which sections are out, by number. */
  skip?: (section: string, heading: string) => boolean
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  { chapter: '4501', name: 'R.C. Chapter 4501: Motor Vehicles - Definitions; General Provisions', why: 'what the code means by a vehicle, a motorcycle, a highway or an operator' },
  {
    chapter: '4503',
    name: 'R.C. Chapter 4503: Licensing of Motor Vehicles',
    why: 'registration, plates and their display, disability placards, and the immobilisation of a vehicle after an offence',
    skip: (section, heading) => {
      const minor = Number(section.split('.')[1].padEnd(4, '0').slice(0, 4))
      if (section === '4503.44' || section === '4503.45') return false
      return (
        (section >= '4503.03' && section < '4503.04') ||
        (section >= '4503.06' && section < '4503.07') ||
        (minor >= 4000 && minor < 9900) ||
        /\bplates?\.$/i.test(heading)
      )
    },
  },
  { chapter: '4507', name: "R.C. Chapter 4507: Driver's License Law", why: 'licensing, the temporary instruction permit, the probationary licence and its limits on drivers under 18, and examination' },
  { chapter: '4509', name: 'R.C. Chapter 4509: Financial Responsibility', why: 'the insurance every vehicle must carry, its proof, and the security a crash requires' },
  { chapter: '4510', name: "R.C. Chapter 4510: Driver's License Suspension, Cancellation, Revocation", why: 'points, suspension classes, driving under suspension, and limited driving privileges' },
  { chapter: '4511', name: 'R.C. Chapter 4511: Traffic Laws - Operation of Motor Vehicles', why: 'the rules of the road, including impaired driving, school buses, speed, parking and phones' },
  { chapter: '4513', name: 'R.C. Chapter 4513: Traffic Laws - Equipment; Loads', why: 'lights, brakes, mirrors, belts and the equipment and loads a vehicle is held to' },
  { chapter: '4515', name: 'R.C. Chapter 4515: Venue; Guest Statute', why: "an owner's and operator's liability to a guest passenger" },
  { chapter: '4549', name: 'R.C. Chapter 4549: Motor Vehicle Crimes', why: 'stopping after a crash (hit-skip), fictitious plates, and odometer and identification-number offences' },
  {
    chapter: '4301',
    name: 'R.C. Chapter 4301, Sections 4301.62 to 4301.69: Liquor Control Law',
    why: 'open containers in a vehicle and underage purchase, possession and consumption of alcohol, codified in the liquor control law',
    keep: ['4301.62', '4301.63', '4301.631', '4301.64', '4301.69'],
  },
]

/** "4511.68" -> "Ohio Rev. Code § 4511.68". */
export function cite(section: string): string {
  return `Ohio Rev. Code § ${section}`
}

export const chapterUrl = (chapter: string) => `${ORIGIN}chapter-${chapter}`
export const sectionUrl = (section: string) => `${ORIGIN}section-${section}`

/** A chapter page's sections and their catchlines, in the page's order. */
export function sectionsOf(html: string, chapter: string): { section: string; heading: string }[] {
  const out: { section: string; heading: string }[] = []
  const seen = new Set<string>()
  const link = new RegExp(`href="section-(${chapter}\\.\\d+)">([\\s\\S]*?)</a>`, 'g')
  for (const [, section, inner] of html.matchAll(link)) {
    if (seen.has(section)) continue
    seen.add(section)
    const text = inline(inner)
    out.push({ section, heading: text.replace(/^Section [\d.]+\s*\|\s*/, '').replace(/\.$/, '') })
  }
  return out
}

const site: Site = {
  // The Legislative Service Commission's Ohio Revised Code, the General Assembly's own publication.
  official: ORIGIN,
  name: 'the Ohio Revised Code',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: chapter, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const { section, heading } of sectionsOf((await fetchedPage(chapterUrl(title.chapter)).page).body, title.chapter)) {
        if (title.keep !== undefined && !title.keep.includes(section)) continue
        if (title.skip?.(section, heading + '.')) continue
        listings.push({ file: section.replace('.', '-'), url: sectionUrl(section), section, cite: cite(section), heading })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    return listings
  },
  extract: (html) => extractOrc(html),
}

export default site

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * One section's law in effect: the `laws-body` block, a line per paragraph.
 * The catchline is the listing's heading; the "Last updated" notice at the
 * block's foot is the site's, not law.
 */
export function extractOrc(html: string, today = new Date().toISOString().slice(0, 10)): string {
  const dates = [...html.matchAll(/<div class="label">Effective:<\/div>\s*<div class="value">([^<]*)<\/div>/g)].map((each) => each[1].trim())
  if (dates.length > 1) throw new Error(`the page names ${dates.length} effective dates`)
  if (dates.length === 1) {
    const date = /^(\w+) (\d{1,2}), (\d{4})$/.exec(dates[0])
    if (date === null || !MONTHS.includes(date[1])) throw new Error(`an effective date this cannot read: ${dates[0]}`)
    const iso = `${date[3]}-${String(MONTHS.indexOf(date[1]) + 1).padStart(2, '0')}-${date[2].padStart(2, '0')}`
    if (iso > today) throw new Error(`the page serves a version effective ${iso}, after today`)
  }
  const start = html.indexOf('<section class="laws-body">')
  if (start < 0) throw new Unavailable('no laws-body block on the page')
  const end = html.indexOf('<div class="laws-notice">', start)
  const block = html.slice(start, end < 0 ? html.indexOf('</section>', start) : end)
  const text = decode(
    block
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[\s  ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return lines.join('\n') + '\n'
}

function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
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
