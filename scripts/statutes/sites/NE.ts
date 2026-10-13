/**
 * Nebraska: the Nebraska Revised Statutes as the Legislature publishes them
 * (nebraskalegislature.gov), one section per page. An index-page `enumerate`,
 * as Maryland's: a chapter's browse page lists every section with its
 * catchline and the address of its page. The page carries no article
 * headings, so a section's article is read off its number: 60-601 and
 * 60-6,166 are both article 6 (an article past its ninety-ninth section
 * writes the rest after a comma).
 *
 * The page serves the section's number, its catchline and its paragraphs in a
 * `statute` block, then the Source, Cross References and Annotations under
 * their own headings; `extract` keeps the paragraphs and stops at the first of
 * those. No section read here is served in a second version today; a page
 * that carries more than one section number is refused rather than guessed at.
 */
import type { Listing, Site } from '../site'

const ORIGIN = 'https://nebraskalegislature.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/** Chapter 60, article 4's commercial driver's licence sections (60-4,131 to 60-4,172) and their definitions. */
function isCommercial(section: string): boolean {
  if (['60-464', '60-465', '60-465.02', '60-476.03'].includes(section)) return true
  const match = /^60-4,(\d+)/.exec(section)
  return match !== null && Number(match[1]) >= 131 && Number(match[1]) <= 172
}

/** Chapter 60, article 4's licensing of commercial driver training schools and their instructors (60-4,173 to 60-4,179). */
function isDrivingSchool(section: string): boolean {
  const match = /^60-4,(\d+)/.exec(section)
  return match !== null && Number(match[1]) >= 173 && Number(match[1]) <= 179
}

/**
 * The articles a licence-holder is bound by. Out of chapter 60, and why:
 * article 2 adopts federal regulations for the department; 13 is weighing
 * stations; 14 and 15 license dealers and manufacturers; 18 is camper-unit
 * permits; 19 and 24 are the removal and towing of abandoned and trespassing
 * vehicles by authorities and towers; 25 is ride-sharing's exemptions from
 * labour law; 26 is salvage dealers; 27 is the lemon law; 29 is the
 * department's record privacy; 31 is the state fleet card; 32 is licence-plate
 * readers; 33 is companies running driverless vehicles; 34 is peer-to-peer car
 * sharing programs; 8 to 12, 16, 17, 20 to 23, 28 and 30 are wholly repealed
 * or transferred. Of article 4, the commercial driver's licence sections are
 * out (they bind CDL holders, and their permit and alcohol rules crowd out the
 * ordinary ones), and so is the licensing of driver training schools.
 */
const TITLES: {
  chapter: string
  article: string
  id: string
  name: string
  why: string
  /** Which of the article's sections are in, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  { chapter: '60', article: '1', id: 'ch60-art01', name: 'Chapter 60, Article 1: Motor Vehicle Certificate of Title Act', why: 'the certificate of title every owner must hold and transfer on a sale' },
  { chapter: '60', article: '3', id: 'ch60-art03', name: 'Chapter 60, Article 3: Motor Vehicle Registration Act', why: 'registration, plates and their display, proof of insurance and the disability parking permit' },
  {
    chapter: '60',
    article: '4',
    id: 'ch60-art04',
    name: "Chapter 60, Article 4: Motor Vehicle Operator's License Act (in part)",
    why: "the licence, the learner's, school and provisional permits and their limits, testing, points, suspension and revocation",
    keep: (section) => !isCommercial(section) && !isDrivingSchool(section),
  },
  { chapter: '60', article: '5', id: 'ch60-art05', name: 'Chapter 60, Article 5: Motor Vehicle Safety Responsibility Act', why: 'the crash report and security a crash requires, proof of financial responsibility and the minimum liability limits' },
  { chapter: '60', article: '6', id: 'ch60-art06', name: 'Chapter 60, Article 6: Nebraska Rules of the Road', why: 'definitions, the rules of the road, speed, parking, school buses, impaired driving, duties after a crash, equipment, seat belts and child restraints' },
  { chapter: '60', article: '7', id: 'ch60-art07', name: 'Chapter 60, Article 7: 24/7 Sobriety Program Act', why: 'the sobriety program and permit a court may set for a drunk-driving offender' },
  {
    chapter: '28',
    article: '3',
    id: 'ch28-art03',
    name: 'Chapter 28, Article 3: Offenses Against the Person (section 28-306)',
    why: 'motor vehicle homicide, including while driving under the influence, codified in the criminal code',
    keep: (section) => section === '28-306',
  },
  {
    chapter: '28',
    article: '5',
    id: 'ch28-art05',
    name: 'Chapter 28, Article 5: Offenses Against Property (section 28-523)',
    why: 'littering, including from a vehicle, and its penalty, codified in the criminal code',
    keep: (section) => section === '28-523',
  },
  {
    chapter: '53',
    article: '1',
    id: 'ch53-art01',
    name: 'Chapter 53, Article 1: Nebraska Liquor Control Act (section 53-180.02)',
    why: "a minor's purchase, possession or consumption of alcohol, codified in the liquor control act",
    keep: (section) => section === '53-180.02',
  },
]

/** The state's own citation form: "Neb. Rev. Stat. § 60-6,166". */
export function cite(section: string): string {
  return `Neb. Rev. Stat. § ${section}`
}

/** A section's article, from its number: 60-601 and 60-6,166 are article 6, 60-4,118.05 article 4, 53-180.02 article 1. */
export function articleOf(section: string): string {
  const number = section.split('-')[1]
  if (number.includes(',')) return number.split(',')[0]
  return number.split('.')[0].slice(0, -2)
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`nebraskalegislature.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * A chapter's browse page: `<a href="/laws/statutes.php?statute=60-6,166"><span class="sr-only">View Statute </span>60-6,166</a></span>
 * <span …>Stopping, standing, or parking prohibited; exceptions.</span>`.
 */
export function sectionsListed(html: string): { section: string; heading: string }[] {
  return [
    ...html.matchAll(/<a href="\/laws\/statutes\.php\?statute=([\d.,-]+)"><span class="sr-only">View Statute <\/span>\s*([\d.,-]+)\s*<\/a><\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/g),
  ].map(([, href, section, heading]) => {
    if (href !== section) throw new Error(`the chapter page links ${section} to ${href}`)
    return { section, heading: inline(heading) }
  })
}

const site: Site = {
  // The Legislature publishes the Revised Statutes on its own site.
  official: ORIGIN,
  name: 'the Nebraska Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const chapters = new Map<string, ReturnType<typeof sectionsListed>>()
    for (const title of TITLES) {
      if (!chapters.has(title.chapter)) {
        chapters.set(title.chapter, sectionsListed(await page(`${ORIGIN}laws/browse-chapters.php?chapter=${title.chapter}`)))
        await pause()
      }
      const before = listings.length
      for (const { section, heading } of chapters.get(title.chapter)!) {
        if (!section.startsWith(`${title.chapter}-`) || articleOf(section) !== title.article) continue
        if (title.keep !== undefined && !title.keep(section)) continue
        // The chapter page keeps a repealed or moved section's number with "Repealed. Laws …" or "Transferred to section …" for its catchline.
        if (heading === '' || /^(repealed|reserved|transferred|outright repeal)\b/i.test(heading)) continue
        listings.push({
          file: `${title.id}-${section.replace(/,/g, '_')}`,
          url: `${ORIGIN}laws/statutes.php?statute=${section}`,
          section,
          cite: cite(section),
          heading: heading.replace(/\.$/, ''),
        })
      }
      // An article read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the chapter ${title.chapter} page lists nothing kept in article ${title.article}`)
    }
    const seen = new Set<string>()
    for (const listing of listings) {
      if (seen.has(listing.section)) throw new Error(`${cite(listing.section)} is listed twice`)
      seen.add(listing.section)
    }
    return listings
  },
  extract: (html, listing) => extractNebraska(html, listing.section),
}

export default site

/**
 * One section's text: its paragraphs, one per line, without the number and
 * catchline the page sets in front of them (the listing carries the
 * catchline), and nothing from the Source, Cross References or Annotations on.
 */
export function extractNebraska(html: string, section: string): string {
  const start = html.indexOf('<div class="statute">')
  if (start < 0) throw new Error(`no statute block on the page for ${section}`)
  const rest = html.slice(start)
  const end = rest.search(/<h2>\s*(Source|Cross References|Annotations)\s*<\/h2>|<nav /)
  const block = end < 0 ? rest : rest.slice(0, end)
  const numbers = [...block.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(([, number]) => inline(number).replace(/\.$/, ''))
  // A section served twice -- the text now and a copy operative later -- is a
  // page this extract was not written for; stop rather than commit both.
  if (numbers.length !== 1) throw new Error(`the page for ${section} carries ${numbers.length} section numbers`)
  if (numbers[0] !== section) throw new Error(`the page for ${section} carries ${numbers[0]}`)
  // The page wraps a few paragraphs over several source lines (§ 60-323 is
  // three); only a tag ends a paragraph, so the source's own line breaks are
  // spaces before the tags are read.
  const body = block
    .replace(/\s+/g, ' ')
    .replace(/<h2>[\s\S]*?<\/h2>/, '')
    .replace(/<h3>[\s\S]*?<\/h3>/, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  const lines = decode(body)
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error(`${cite(section)} came back with no text`)
  return lines.join('\n') + '\n'
}

function inline(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ')
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
