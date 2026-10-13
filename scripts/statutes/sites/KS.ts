/**
 * Kansas: the Kansas Statutes Annotated as the Office of Revisor of Statutes
 * publishes them for the Legislature (ksrevisor.gov), one section per page.
 * An index-page `enumerate`, as Maryland's: a chapter's page lists every
 * section of every article with its catchline and the address of its page.
 *
 * The Revisor serves one version of a section, as amended through the last
 * session, with the history, the source or prior law, the Attorney General's
 * opinions and the case annotations after it in their own blocks; `extract`
 * keeps the section's paragraphs and stops at the history, and refuses a page
 * that carries a second copy of the section rather than guess which is in effect.
 */
import type { Listing, Site } from '../site'

const ORIGIN = 'https://www.ksrevisor.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The articles a licence-holder is bound by. Out of chapter 8, and why:
 * article 3 is the marking of government vehicles, 4 is service of process
 * on non-residents in civil suits, 6 regulates dealers' trade practices, 11
 * is the impounding, liens and auction of abandoned vehicles, 22 is how the
 * Uniform Act is construed, 23, 24 and 26 license manufacturers, dealers and
 * title service agents, 27 and 28 regulate ride-hailing and car-sharing
 * companies, 29 the companies running driverless vehicles; 5, 7, 8 and 9 are
 * wholly repealed. Of chapter 40, article 31, the personal injury protection
 * benefits, claims, examinations and the insurers' assigned-claims plan are
 * out: they bind insurers, not drivers.
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
  { chapter: '8', article: '1', id: 'ch08-art01', name: 'Chapter 8, Article 1: General Provisions (registration and title)', why: 'registration, plates and title every owner must hold, and the disability parking placard' },
  { chapter: '8', article: '2', id: 'ch08-art02', name: "Chapter 8, Article 2: Drivers' Licenses", why: 'licensing, the instruction permit and the graduated licence and its limits, points, suspension and commercial licences' },
  { chapter: '8', article: '10', id: 'ch08-art10', name: 'Chapter 8, Article 10: Driving Under Influence of Alcohol or Drugs; Administrative Provisions', why: 'implied consent, testing, refusal and the licence suspension that follows, and the ignition interlock' },
  { chapter: '8', article: '12', id: 'ch08-art12', name: 'Chapter 8, Article 12: Compacts with Other Jurisdictions', why: 'how a conviction or an unpaid ticket in another state counts against a Kansas licence' },
  { chapter: '8', article: '13', id: 'ch08-art13', name: 'Chapter 8, Article 13: Miscellaneous Provisions', why: 'the child passenger safety act, funeral processions and the identification card' },
  { chapter: '8', article: '14', id: 'ch08-art14', name: 'Chapter 8, Article 14: Uniform Act Regulating Traffic; Definitions', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { chapter: '8', article: '15', id: 'ch08-art15', name: 'Chapter 8, Article 15: Uniform Act Regulating Traffic; Rules of the Road', why: 'the rules of the road, including speed, parking, school buses and impaired driving' },
  { chapter: '8', article: '16', id: 'ch08-art16', name: 'Chapter 8, Article 16: Uniform Act Regulating Traffic; Accidents and Accident Reports', why: 'what a driver must do after a crash' },
  { chapter: '8', article: '17', id: 'ch08-art17', name: 'Chapter 8, Article 17: Uniform Act Regulating Traffic; Equipment of Vehicles', why: 'lights, brakes, mirrors, windows and the equipment a vehicle must have' },
  { chapter: '8', article: '18', id: 'ch08-art18', name: 'Chapter 8, Article 18: Uniform Act Regulating Traffic; Equipment on Motorcycles', why: 'helmets, eye protection and the equipment a motorcycle must have' },
  { chapter: '8', article: '19', id: 'ch08-art19', name: 'Chapter 8, Article 19: Uniform Act Regulating Traffic; Size, Weight and Load', why: 'how a load must be secured and how far it may project, which binds any driver' },
  { chapter: '8', article: '20', id: 'ch08-art20', name: 'Chapter 8, Article 20: Uniform Act Regulating Traffic; Powers of State and Local Authorities', why: 'the doubled fine in a road construction zone and who may show red lights' },
  { chapter: '8', article: '21', id: 'ch08-art21', name: 'Chapter 8, Article 21: Uniform Act Regulating Traffic; Parties, Arrests, Citations, Procedures and Penalties', why: 'citations, what a stopped driver must do and the fine schedule for every traffic infraction' },
  { chapter: '8', article: '25', id: 'ch08-art25', name: 'Chapter 8, Article 25: Seat Belts', why: 'who must wear a seat belt and the fine' },
  {
    chapter: '40',
    article: '31',
    id: 'ch40-art31',
    name: 'Chapter 40, Article 31: Kansas Automobile Injury Reparations Act (in part)',
    why: 'the insurance every vehicle must carry, its minimum limits and the penalty for driving without it',
    keep: (section) => ['40-3101', '40-3103', '40-3104', '40-3105', '40-3106', '40-3107', '40-3118'].includes(section),
  },
  {
    chapter: '21',
    article: '54',
    id: 'ch21-art54',
    name: 'Chapter 21, Article 54: Crimes Against Persons (sections 21-5405 and 21-5406)',
    why: 'involuntary manslaughter while driving under the influence, and vehicular homicide, codified in the criminal code',
    keep: (section) => section === '21-5405' || section === '21-5406',
  },
  {
    chapter: '41',
    article: '7',
    id: 'ch41-art07',
    name: 'Chapter 41, Article 7: Prohibited Acts (section 41-727)',
    why: "a minor's possession or consumption of alcohol and the licence suspension for it, codified in the liquor control act",
    keep: (section) => section === '41-727',
  },
]

/** The state's own citation form: "K.S.A. 8-1575". Kansas writes no section sign. */
export function cite(section: string): string {
  return `K.S.A. ${section}`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`ksrevisor.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * A chapter page's sections, by article: "Article 15.—UNIFORM ACT …", then
 * "<li> 8-1575 <a href="/statutes/chapters/ch08/008_015_0075.html"> Driving upon sidewalk. </a>".
 */
export function sectionsListed(html: string): { article: string; section: string; href: string; heading: string }[] {
  const out: { article: string; section: string; href: string; heading: string }[] = []
  const parts = html.split(/Article (\d+[a-z]?)\.—/)
  for (let index = 1; index < parts.length; index += 2) {
    for (const [, section, href, heading] of parts[index + 1].matchAll(/<li>\s*([\d]+[a-z]?-[\d,]+[a-z]?)\s*<a href="([^"]+)">\s*([\s\S]*?)\s*<\/a>/g)) {
      out.push({ article: parts[index], section, href, heading: inline(heading).replace(/\.$/, '') })
    }
  }
  return out
}

const site: Site = {
  // The Revisor of Statutes publishes the Kansas Statutes Annotated for the Legislature.
  official: ORIGIN,
  name: 'the Kansas Statutes Annotated',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const chapters = new Map<string, ReturnType<typeof sectionsListed>>()
    for (const title of TITLES) {
      if (!chapters.has(title.chapter)) {
        chapters.set(title.chapter, sectionsListed(await page(`${ORIGIN}statutes/ksa_ch${title.chapter}.html`)))
        await pause()
      }
      const before = listings.length
      for (const { article, section, href, heading } of chapters.get(title.chapter)!) {
        if (article !== title.article) continue
        if (title.keep !== undefined && !title.keep(section)) continue
        // The chapter page keeps a repealed section's number with "Repealed." for its catchline and nothing else.
        if (heading === '' || /^(repealed|reserved|transferred)\b/i.test(heading)) continue
        listings.push({
          file: `${title.id}-${section.replace(/,/g, '_')}`,
          url: new URL(href, ORIGIN).toString(),
          section,
          cite: cite(section),
          heading,
        })
      }
      // An article read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the chapter ${title.chapter} page lists nothing kept in article ${title.article}`)
    }
    return listings
  },
  extract: (html, listing) => extractRevisor(html, listing.section),
}

export default site

/**
 * One section's text: its paragraphs, one per line, without the number and
 * catchline the page sets in front of the first (the listing carries the
 * catchline), and nothing from the history on.
 */
export function extractRevisor(html: string, section: string): string {
  const start = html.indexOf('<div id="print">')
  if (start < 0) throw new Error(`no print block on the page for ${section}`)
  const rest = html.slice(start)
  const end = rest.search(/<p class="ksa_stat_hist"|<div class="footer"|<div id="rightnav/)
  const block = end < 0 ? rest : rest.slice(0, end)
  const numbers = [...block.matchAll(/<span class="stat_number">\s*([\s\S]*?)\s*<\/span>/g)].map(([, number]) => inline(number).replace(/\.$/, ''))
  // A section served twice -- the text now and a copy for a later date -- is a
  // page this extract was not written for; stop rather than commit both.
  if (numbers.length !== 1) throw new Error(`the page for ${section} carries ${numbers.length} section numbers`)
  if (numbers[0] !== section) throw new Error(`the page for ${section} carries ${numbers[0]}`)
  const body = block
    .replace(/<span class="stat_number">[\s\S]*?<\/span>/, '')
    .replace(/<span class="stat_caption">[\s\S]*?<\/span>/, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  const lines = decode(body)
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error(`§ ${section} came back with no text`)
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
