/**
 * Virginia: the Code of Virginia as the Division of Legislative Automated
 * Systems publishes it for the General Assembly at law.lis.virginia.gov. An
 * index-page `enumerate`: each chapter's page lists its sections, article by
 * article, each linking to a page of its own
 * (`/vacode/title46.2/chapter12/section46.2-1239/`).
 *
 * robots.txt: there is none. `/robots.txt` answers a 301 to `/robots.txt/`,
 * which answers 404 (2026-10-08), so no path is disallowed to any agent and no
 * Crawl-delay is asked; the fetch's own second between requests stands.
 *
 * **What is in effect.** A section amended or repealed for a later date is
 * served as two versions on one page, each its own `<h2>` and body, the
 * catchline opening on its terms: "(Effective until July 1, 2027)" and
 * "(Effective July 1, 2027)", "(Contingent expiration date)" and "(Contingent
 * effective date)", "(Expires July 1, 2028)", "(Repeal effective July 1,
 * 2027)". `extract` keeps the one version in force today -- a contingent
 * effective date is one whose event has not happened, so never -- and
 * `enumerate` lists no section with none, reading the same terms from the
 * chapter page.
 *
 * Virginia labels its subsections "A.", "1.", "a.", each paragraph its own
 * `<p>` opening on its label ("B. 1. For purposes of…" where a subsection opens
 * straight on a nested one), so a line per paragraph is the code's own
 * layout and nothing about the labels is rewritten. The catchline is the
 * listing's heading and is not repeated in the text: ninety of them run past
 * the length the chunker reads as a heading line and would be filed as law.
 * The history paragraph that closes each version ("1982, c. 634, § 46.1-314.2;
 * 1984, c. 280; …") is not law and is never committed.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://law.lis.virginia.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 46.2, and why:
 * chapter 2, the Department of Motor Vehicles; 13, the powers of local
 * governments; 14 and 14.1, ridesharing and peer-to-peer vehicle sharing; 15
 * to 19.2, dealers, salvage and driver training schools; 20 to 29, motor
 * carriers and escort vehicles. Out of chapter 3: articles 6 and 6.1, the
 * commercial licence, which every state so far has left out because its
 * permit and alcohol rules crowd out the ordinary ones. Virginia codifies
 * driving while intoxicated in the criminal code (Title 18.2, chapter 7,
 * article 2) and the open container beside it (§ 18.2-323.1), and underage
 * possession of alcohol in the alcoholic beverage title (§ 4.1-305); those
 * sections are taken and the rest of their chapters -- drugs, weapons, the
 * sale of alcohol -- left out. Involuntary manslaughter and maiming while
 * intoxicated are left with the homicide and assault chapters they sit in.
 */
const TITLES: {
  chapter: string
  id: string
  name: string
  why: string
  /** Where only part of a chapter is the vehicle code: whether a section, in its article, is taken. */
  takes?: (section: string, article: string) => boolean
}[] = [
  { chapter: 'title46.2/chapter1', id: '46.2-1', name: 'Title 46.2, Chapter 1: General Provisions', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  {
    chapter: 'title46.2/chapter3',
    id: '46.2-3',
    name: 'Title 46.2, Chapter 3: Licensure of Drivers',
    why: 'the learner permit, the licence and the limits on a minor, crash duties and reports, points, suspension, financial responsibility and insurance',
    takes: (_, article) => article !== 'article6' && article !== 'article6.1',
  },
  { chapter: 'title46.2/chapter6', id: '46.2-6', name: 'Title 46.2, Chapter 6: Titling and Registration of Motor Vehicles', why: 'the title, registration, plates and the uninsured-vehicle fee every owner is held to' },
  { chapter: 'title46.2/chapter7', id: '46.2-7', name: 'Title 46.2, Chapter 7: Highway Use Fee and Mileage-Based User Fee Program', why: 'the fee an owner pays at registration for a fuel-efficient or electric vehicle' },
  { chapter: 'title46.2/chapter8', id: '46.2-8', name: 'Title 46.2, Chapter 8: Regulation of Traffic', why: 'the rules of the road: signals, speed, right of way, passing, school buses, reckless driving, phones, helmets and penalties' },
  { chapter: 'title46.2/chapter10', id: '46.2-10', name: 'Title 46.2, Chapter 10: Motor Vehicle and Equipment Safety', why: 'lights, brakes, inspection, seat belts, child seats and the equipment a vehicle must have' },
  { chapter: 'title46.2/chapter12', id: '46.2-12', name: 'Title 46.2, Chapter 12: Abandoned, Immobilized, Unattended and Trespassing Vehicles; Parking', why: 'where a driver may not park, and leaving a vehicle unattended' },
  { chapter: 'title46.2/chapter12.1', id: '46.2-12.1', name: 'Title 46.2, Chapter 12.1: Parking for Persons with Disabilities', why: 'disability parking, its placards and plates, and the penalty for misuse' },
  {
    chapter: 'title18.2/chapter7',
    id: '18.2-7',
    name: 'Title 18.2, Chapter 7, Article 2 and § 18.2-323.1: Driving While Intoxicated; Open Container',
    why: 'driving under the influence, implied consent and the open container, codified in the criminal code',
    takes: (section, article) => article === 'article2' || section === '18.2-323.1',
  },
  {
    chapter: 'title4.1/chapter3',
    id: '4.1-3',
    name: 'Title 4.1, Chapter 3, § 4.1-305: Underage Purchase or Possession of Alcohol',
    why: 'underage purchase and possession of alcohol, and the licence suspension that follows, codified outside the vehicle title',
    takes: (section) => section === '4.1-305',
  },
]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`law.lis.virginia.gov answered ${response.status} for ${url}`)
  return response.text()
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "July 1, 2027" as "2027-07-01". */
function isoDate(text: string): string {
  const match = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text.trim())
  const month = match === null ? -1 : MONTHS.indexOf(match[1].toLowerCase())
  if (match === null || month < 0) throw new Error(`a date this extract does not know: "${text}"`)
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Whether a version, by the terms its catchline opens on, is the law today.
 * Terms this module has not met are an error, not a guess: a version read as
 * in force when it was not is the law of 2028 presented as the law today.
 */
export function inForce(catchline: string, on = today()): boolean {
  const terms = /^\(([^)]*)\)/.exec(catchline.trim())?.[1]
  if (terms === undefined) return true
  if (/^Contingent effective date\b/.test(terms)) return false
  if (/^(Contingent expiration date|For contingent expiration)\b/.test(terms)) return true
  const dated = /^(Effective until|Effective|Expires|Repeal effective) ([A-Za-z]+ \d{1,2}, \d{4})$/.exec(terms)
  if (dated === null) throw new Error(`terms this module does not know: "(${terms})"`)
  const date = isoDate(dated[2])
  return dated[1] === 'Effective' ? date <= on : date > on
}

/** A catchline without its terms: "(Effective until July 1, 2027) Passing stopped school buses" as "Passing stopped school buses". */
const withoutTerms = (catchline: string) => catchline.replace(/^\([^)]*\)\s*/, '').replace(/\.$/, '').trim()

/** A chapter page's sections, in order: one entry per version listed, each with its article and catchline. */
export function chapterEntries(html: string): { section: string; href: string; article: string; catchline: string }[] {
  const entries = []
  for (const match of html.matchAll(
    // A chapter without articles names none: its sections' inputs carry no `name`.
    /<dt><input type='checkbox' id='([^']+)'(?: name='([^']*)')?[^>]*\/>\s*<a href='(\/vacode\/[^']+\/)'>[^<]*<\/a><\/dt><dd[^>]*><div[^>]*class='section'>([^<]*)<\/div>/g,
  )) {
    entries.push({ section: match[1], article: match[2] ?? '', href: match[3], catchline: decode(match[4]).trim() })
  }
  return entries
}

const site: Site = {
  // The Division of Legislative Automated Systems publishes the Code of Virginia for the General Assembly; this is that site.
  official: ORIGIN,
  name: 'the Code of Virginia',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const future: string[] = []
    const expired: string[] = []
    for (const [index, title] of TITLES.entries()) {
      if (index > 0) await pause(1000)
      const entries = chapterEntries(await page(`${ORIGIN}vacode/${title.chapter}/`))
      if (entries.length === 0) throw new Error(`no sections on the page for ${title.chapter}`)
      const sections = [...new Set(entries.map((entry) => entry.section))]
      for (const section of sections) {
        const versions = entries.filter((entry) => entry.section === section)
        if (title.takes !== undefined && !title.takes(section, versions[0].article)) continue
        // "Expired." is the whole of an expired section's page: no law, and not
        // the "Repealed" marker the fetch knows to file as such.
        if (versions.every((entry) => /^Expired\.?$/.test(entry.catchline))) {
          expired.push(section)
          continue
        }
        const current = versions.filter((entry) => inForce(entry.catchline))
        if (current.length === 0) {
          future.push(section)
          continue
        }
        if (current.length > 1) throw new Error(`${section} is listed in ${current.length} versions in force today`)
        listings.push({
          file: `${title.id}-${section.replace(/:/g, '_')}`,
          url: `${ORIGIN}${current[0].href.slice(1)}`,
          section,
          cite: `Va. Code Ann. § ${section}`,
          heading: withoutTerms(current[0].catchline),
        })
      }
    }
    if (future.length > 0) console.log(`VA: not in force today, left out: ${future.join(', ')}`)
    if (expired.length > 0) console.log(`VA: expired, left out: ${expired.join(', ')}`)
    return listings
  },
  extract: (html, listing) => extractVirginia(html, listing.section),
}

export default site

/** One section's text in force today: a line per paragraph, the history paragraph dropped. */
export function extractVirginia(html: string, section: string, on = today()): string {
  const start = html.indexOf("<span id='va_code'")
  const end = html.indexOf('<!--googleoff: index-->', start)
  if (start < 0 || end < 0) throw new Error(`no Code of Virginia text on the page for ${section}`)
  const block = html.slice(start, end)
  const versions = [...block.matchAll(/<h2>([\s\S]*?)<\/h2>\s*<section class='body[^']*'[^>]*>([\s\S]*?)<\/section>/g)].map((match) => {
    const heading = text(match[1]).replace(/\s+/g, ' ').trim()
    // Sections repealed together are one page under the first: "§§ 46.2-351 through 46.2-355. Repealed.", "§§ 46.2-496, 46.2-497. Repealed."
    const own = /^§§?\s*([\w.:-]*\w)(?:(?:,|\s+through|,?\s+and)\s+[\w.:-]*\w)*\.\s*([\s\S]*)$/.exec(heading)
    if (own === null) throw new Error(`a heading this extract does not know: "${heading}"`)
    return { section: own[1], catchline: own[2], body: match[2] }
  })
  if (versions.length === 0) throw new Error(`no section body on the page for ${section}`)
  if (versions.some((version) => version.section !== section)) throw new Error(`the page for ${section} serves ${versions.map((each) => each.section).join(', ')}`)
  const current = versions.filter((version) => inForce(version.catchline, on))
  if (current.length === 0) throw new Unavailable(`${section} is served only in a version not in effect today`)
  if (current.length > 1) throw new Error(`${section} is served in ${current.length} versions in effect today`)
  const paragraphs = text(current[0].body.replace(/<\/(p|tr|li|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, ' '))
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  // "Code 1950, § 46-263; 1958, c. 541; …" or "1982, c. 634, § 46.1-314.2; …": the acts that made the section, not the section.
  if (paragraphs.length > 1 && /^(Code \d{4}\b|\d{4}, ((cc?|p)\b|Sp\. Sess\.|Ex\. Sess\.))/.test(paragraphs[paragraphs.length - 1])) paragraphs.pop()
  return paragraphs.join('\n') + '\n'
}

const text = (html: string) => decode(html.replace(/<[^>]+>/g, ''))

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
