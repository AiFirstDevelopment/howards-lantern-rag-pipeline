/**
 * Maine: the Revised Statutes as the Office of the Revisor of Statutes
 * publishes them for the Legislature (legislature.maine.gov/statutes), one
 * section per page. An index-page `enumerate`: each chapter's contents page
 * lists its sections with their catchlines, and marks a repealed one
 * "(REPEALED)".
 *
 * Maine keeps the whole motor-vehicle code in one title, 29-A, so the module's
 * titles are its chapters (and the one chapter of the liquor title that binds
 * an under-21 driver). Sections are numbered across the title -- chapter 19
 * runs §2051 to §2311 -- so a 29-A section number is unique; the title is
 * still part of `section`, "29-A-2068", because Title 28-A has a §2051 too.
 *
 * Where part of a section is amended for a later date the page serves both
 * subsections in place, each headed "(TEXT EFFECTIVE UNTIL 1/01/26)" and
 * "(TEXT EFFECTIVE 1/01/26)". `extract` keeps the one in effect today and
 * drops the other.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://legislature.maine.gov/statutes/'

/**
 * The chapters a licence-holder is bound by. Out, and why: 29-A chapter 3 is
 * the Secretary of State's own administration, agents and records; 7 is
 * certificates of title (a lienholder's registry; registration is chapter 5);
 * 9 is dealers; 21's weight and dimension rules are for commercial carriers.
 * Within the chapters kept: chapter 5's International Registration Plan and
 * motor-carrier registration (§§ 531–562), commercial driver licensing
 * (§ 1253, and § 2523, implied consent for commercial operators), chapter
 * 13's transportation network companies (§§ 1671–1677), and chapter 15's
 * inspection stations, mechanics, repair shops and commercial tows -- none of
 * them a rule an ordinary driver is held to.
 */
const TITLES: { title: string; chapter: string; id: string; name: string; why: string; keep: (number: string) => boolean }[] = [
  { title: '29-A', chapter: '1', id: 'c1', name: 'Title 29-A, Chapter 1: General Provisions', why: 'the definitions every other chapter uses, what a traffic infraction is and the general penalty', keep: () => true },
  {
    title: '29-A',
    chapter: '5',
    id: 'c5',
    name: 'Title 29-A, Chapter 5 (§§ 351–526): Vehicle Registration',
    why: 'registration, carrying the certificate, plates and their display, and insurance before registering',
    keep: (number) => wholeOf(number) < 531,
  },
  {
    title: '29-A',
    chapter: '11',
    id: 'c11',
    name: "Title 29-A, Chapter 11 (except § 1253): Driver's License",
    why: "licences, the learner's permit, the intermediate licence and its limits, driver education and carrying the licence",
    keep: (number) => number !== '1253',
  },
  {
    title: '29-A',
    chapter: '13',
    id: 'c13',
    name: 'Title 29-A, Chapter 13 (§§ 1551–1653): Financial Responsibility and Insurance',
    why: 'the insurance every vehicle must carry and an owner\'s liability for a minor or an impaired operator',
    keep: (number) => wholeOf(number) < 1671,
  },
  {
    title: '29-A',
    chapter: '15',
    id: 'c15',
    name: 'Title 29-A, Chapter 15 (§§ 1751–1760, 1766, 1768, 1770, 1851–1862): Inspection and Abandoned Vehicles',
    why: 'the annual inspection every owner must have and display, and abandoning a vehicle on a public way',
    keep: (number) => {
      const whole = wholeOf(number)
      return (whole >= 1751 && whole <= 1760) || [1766, 1768, 1770].includes(whole) || (whole >= 1851 && whole <= 1862)
    },
  },
  { title: '29-A', chapter: '17', id: 'c17', name: 'Title 29-A, Chapter 17: Equipment', why: 'brakes, lights, mirrors, belts, window tint, tires and the equipment a vehicle must have', keep: () => true },
  {
    title: '29-A',
    chapter: '19',
    id: 'c19',
    name: 'Title 29-A, Chapter 19: Operation',
    why: 'the rules of the road -- right of way, speed, passing, parking, signals, belts and child seats, phones and texting, open containers, crashes and school buses',
    keep: () => true,
  },
  { title: '29-A', chapter: '20', id: 'c20', name: 'Title 29-A, Chapter 20: Bicycle and Roller Skis Safety Education Act', why: 'helmets for young bicyclists and roller skiers', keep: () => true },
  {
    title: '29-A',
    chapter: '21',
    id: 'c21',
    name: 'Title 29-A, Chapter 21 (§§ 2385, 2396, 2397): Protection of Ways',
    why: 'protruding loads, putting substances on a public way and menacing vehicles -- the sections of the weight chapter that bind any driver',
    keep: (number) => ['2385', '2396', '2397'].includes(number),
  },
  {
    title: '29-A',
    chapter: '23',
    id: 'c23',
    name: 'Title 29-A, Chapter 23 (except § 2523): Major Offenses -- Suspension and Revocation',
    why: 'OUI and its penalties, implied consent, suspension, the provisional licence, habitual offenders and enforcement',
    keep: (number) => number !== '2523',
  },
  {
    title: '28-A',
    chapter: '81',
    id: 't28a-c81',
    name: 'Title 28-A, Chapter 81: Prohibited Acts by Minors',
    why: 'underage possession and transporting of alcohol and the licence suspension for it, codified in the liquor title',
    keep: () => true,
  },
]

/** "2057-A" -> 2057. */
function wholeOf(number: string): number {
  return Number(/^\d+/.exec(number)?.[0] ?? NaN)
}

/** "29-A-2068" -> "29-A M.R.S. § 2068", the form Maine's own courts cite. */
export function cite(section: string): string {
  const [, title, number] = /^(\d+-[A-Z])-(.+)$/.exec(section) ?? []
  if (title === undefined) throw new Error(`not a Maine section: ${section}`)
  return `${title} M.R.S. § ${number}`
}

const chapterUrl = (title: string, chapter: string) => `${ORIGIN}${title}/title${title}ch${chapter}sec0.html`

/**
 * The sections a chapter's contents page lists: the number as the page writes
 * it ("2057-A"), the page's file name ("title29-Asec1403-2.html" for § 1403,
 * whose plain address is a 404), its catchline, and whether the page marks it
 * repealed.
 */
export function sectionsListed(html: string, title: string): { number: string; page: string; heading: string; repealed: boolean }[] {
  const out: { number: string; page: string; heading: string; repealed: boolean }[] = []
  const escaped = title.replace(/-/g, '\\-')
  const link = new RegExp(`<div class="MRSSection_toclist([^"]*)">\\s*<a href="\\./(title${escaped}sec[^"]+\\.html)">${escaped} §([^.]+)\\.\\s*([^<]*)</a>`, 'g')
  for (const [, classes, page, number, heading] of html.matchAll(link)) {
    out.push({ number: number.trim(), page, heading: decode(heading).replace(/\s+/g, ' ').trim(), repealed: /repealed/.test(classes) })
  }
  return out
}

/**
 * A catchline that says the section is not law here: "(REPEALED)", or
 * "(REALLOCATED TO TITLE 29-A, SECTION 954-A)" -- a pointer to where the text
 * now lives. "(REALLOCATED FROM …)" is the text itself, under its new number.
 */
const GONE = /\((REPEALED|REALLOCATED TO\b[^)]*)\)\s*$/i

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'howardslantern.com statute check (+https://howardslantern.com/)' } })
  if (!response.ok) throw new Error(`legislature.maine.gov answered ${response.status} for ${url}`)
  return response.text()
}

const site: Site = {
  // The Revisor of Statutes' publication of the Maine Revised Statutes, on the Legislature's own site.
  official: ORIGIN,
  name: 'the Maine Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const listed = sectionsListed(await page(chapterUrl(spec.title, spec.chapter)), spec.title)
      if (listed.length === 0) throw new Error(`${spec.title} chapter ${spec.chapter}'s page lists no sections: the page changed shape`)
      for (const each of listed) {
        if (each.repealed || GONE.test(each.heading) || !spec.keep(each.number)) continue
        const section = `${spec.title}-${each.number}`
        listings.push({
          file: `${spec.id}-${each.page.replace(/^title[^s]+sec/, '').replace(/\.html$/, '')}`,
          url: `${ORIGIN}${spec.title}/${each.page}`,
          section,
          cite: cite(section),
          heading: each.heading.replace(/\s*\(REALLOCATED FROM [^)]*\)\s*$/i, ''),
        })
      }
    }
    return listings
  },
  extract: (body, listing) => extractMaine(body, listing.section),
}

export default site

/** "(TEXT EFFECTIVE 1/01/26)", "(TEXT EFFECTIVE UNTIL 1/01/26)", "(TEXT REPEALED 7/1/27)". */
const MARKER = /\(TEXT (EFFECTIVE UNTIL|EFFECTIVE|REPEALED) (\d{1,2})\/(\d{1,2})\/(\d{2,4})\)\s*/

function dateOf(month: string, day: string, year: string): string {
  const full = year.length === 2 ? `20${year}` : year
  return `${full}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * One section's text in effect, a line per paragraph: "1. On ways. The
 * following…", "A. A person may not…", "(1) A clear and unobstructed…". The
 * session-law history after each paragraph, the section history and the
 * revisor's notes are the publisher's, not the law's, and are dropped.
 *
 * A subsection headed with a date marker is kept only while that date says it
 * is in force: "EFFECTIVE UNTIL" a date not yet reached, "EFFECTIVE" a date
 * reached, "REPEALED" a date not yet reached; the marker itself is dropped. A
 * marker anywhere but a subsection's head -- or on the section's own heading
 * -- is a shape this has not seen, and committing either version would be a
 * guess, so it throws.
 */
export function extractMaine(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const start = html.indexOf('MRSSection status_')
  if (start < 0) throw new Error(`${section}: no MRSSection on the page, not a section of the Revised Statutes`)
  const historyAt = html.indexOf('<div class="qhistory"', start)
  const footerAt = html.indexOf('<div class="footer"', start)
  const end = historyAt >= 0 ? historyAt : footerAt
  if (end < 0) throw new Error(`${section}: the section page has no end after its text`)
  let body = html.slice(html.indexOf('>', start) + 1, end)
  const heading = /<h3 class="heading_section">([\s\S]*?)<\/h3>/.exec(body)
  if (heading === null) throw new Error(`${section}: no section heading on the page`)
  if (/EFFECTIVE|\(TEXT /.test(heading[1])) throw new Error(`${section}: the section heading carries a version marker this cannot read: ${heading[1].trim()}`)
  body = body
    .replace(heading[0], '')
    .replace(/<span class="bhistory">[\s\S]*?<\/span>/g, '')
    .replace(/<div class="(note|headnote_blip)">[\s\S]*?<\/div>/g, '')

  const parts = body.split(/(?=<div class="MRSSubSection)/)
  const kept: string[] = []
  for (const part of parts) {
    const lines = linesOf(part)
    if (lines.length === 0) continue
    // A repealed subsection keeps its number and catchline and no text --
    // "2. Children under 40 pounds." -- and a catchline alone states no rule.
    const headnote = /<span class="headnote">([\s\S]*?)<\/span>/.exec(part)
    if (lines.length === 1 && headnote !== null && linesOf(headnote[1]).join(' ') === lines[0]) continue
    const marked = lines.findIndex((line) => MARKER.test(line))
    if (marked < 0) {
      kept.push(...lines)
      continue
    }
    const head = /^\d+(-[A-Z])?\.\s+/.exec(lines[0])
    if (marked !== 0 || head === null || lines[0].slice(head[0].length).search(MARKER) !== 0 || lines.slice(1).some((line) => MARKER.test(line))) {
      throw new Error(`${section} carries a version marker outside a subsection's head: ${lines[marked]}`)
    }
    const [, kind, month, day, year] = MARKER.exec(lines[0])!
    const date = dateOf(month, day, year)
    const inForce = kind === 'EFFECTIVE' ? date <= today : date > today
    if (!inForce) continue
    kept.push(lines[0].replace(MARKER, ''), ...lines.slice(1))
  }
  if (kept.length === 0) throw new Unavailable('the page serves the heading with no text in effect')
  return kept.join('\n') + '\n'
}

/**
 * A fragment's paragraphs, one line each: a new line at every `<div>`, tags
 * dropped, spaces folded. The page's own line breaks are layout -- "A." sits
 * on one source line and its sentence on the next -- so they fold first.
 */
function linesOf(fragment: string): string[] {
  return decode(fragment.replace(/\s+/g, ' ').replace(/<div\b[^>]*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\r ]+/g, ' ').trim())
    // A repealed paragraph keeps its label and nothing else -- "A." with only
    // "[PL 2019, c. 299, §2 (RP).]" after it -- and a bare label is no law.
    .filter((line) => line.length > 0 && !/^(\d+(-[A-Z])?\.|[A-Z](-\d+)?\.|\([a-z0-9]+(-[A-Z0-9]+)?\))$/.test(line))
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
