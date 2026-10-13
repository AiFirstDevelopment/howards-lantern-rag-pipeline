/**
 * West Virginia: the West Virginia Code as the Legislature publishes it at
 * code.wvlegislature.gov. An index-page `enumerate`: each chapter's page
 * (`/17C/`) lists its articles, each article's page (`/17C-13/`) lists its
 * sections with their catchlines, and each section is a page of its own
 * (`/17C-13-3/`) holding the text in one `<div class='sectiontext'>`.
 *
 * robots.txt (code.wvlegislature.gov, 2026-10-08) disallows only
 * `/wp-admin/` to `*`, names no other agent and asks no Crawl-delay; the
 * fetch's own second between requests stands.
 *
 * West Virginia labels its subsections "(a)", "(1)", "(A)", "(i)", each
 * paragraph its own `<p>` opening on its label, so a line per paragraph is
 * the code's own layout and nothing about the labels is rewritten. A
 * paragraph that opens straight on a nested label is printed "(b)(1) Any
 * person…" with no space, which the chunker reads as "(b)" as written. The
 * catchline is the listing's heading and the `<h4>` repeating it is not
 * committed. `<em>`, which sets "Provided" in italics, is a typeface and
 * not a word: the tag is dropped and the word kept.
 *
 * **What is in effect.** The site serves the code as amended through the
 * last session and lists no repealed section on an article's page; a page
 * carrying more than one `sectiontext` -- the shape a second, later version
 * would take -- is an error here, not a guess.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://code.wvlegislature.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by, and the articles of each left
 * out. Out of 17A, and why: 2, the Division of Motor Vehicles; 2A, the
 * division's records; 2B, the motor carrier industry; 3A, federal clean-air
 * compliance of imported vehicles; 4A, liens; 6 to 6F, dealers, wreckers,
 * licence services, auctions, rental and car-sharing businesses; 7, special
 * stickers for dealers and wreckers; 8, anti-theft identification numbers.
 * Out of 17C: 5C, the Office of Administrative Hearings; 13A, idling of
 * heavy diesel vehicles; 17 to 17B, size, weight and load, coal haulage and
 * the Public Service Commission; 20, the Turnpike Commission; 22,
 * ridesharing; 24, autonomous vehicles; 25, aviation. Whole chapters out:
 * 17, roads and highways (the highway authority); 17E, the commercial
 * licence, which every state so far has left out because its permit and
 * alcohol rules crowd out the ordinary ones; 17F, all-terrain vehicles,
 * recreation off the road; 17G, racial-profiling data collection; 17H,
 * fully autonomous vehicles. West Virginia codifies driving under the
 * influence, the under-21 limit and the open container in 17C itself.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; omit: string[] }[] = [
  {
    chapter: '17A',
    id: '17A',
    name: 'Chapter 17A: Motor Vehicle Administration, Registration, Certificate of Title, and Antitheft Provisions',
    why: 'what the code means by a vehicle or an owner, registration, plates, title, transfer on sale, registration fees and the penalties for driving unregistered',
    omit: ['2', '2A', '2B', '3A', '4A', '6', '6A', '6B', '6C', '6D', '6E', '6F', '7', '8'],
  },
  {
    chapter: '17B',
    id: '17B',
    name: "Chapter 17B: Motor Vehicle Driver's Licenses",
    why: 'the instruction permit, the graduated licence and its limits, the licence and its renewal, points, suspension and revocation, and driving without a licence',
    omit: [],
  },
  {
    chapter: '17C',
    id: '17C',
    name: 'Chapter 17C: Traffic Regulations and Laws of the Road',
    why: 'the rules of the road: signals, speed, right of way, passing, parking, school buses, crashes, driving under the influence, equipment, inspection and penalties',
    omit: ['5C', '13A', '17', '17A', '17B', '20', '22', '24', '25'],
  },
  {
    chapter: '17D',
    id: '17D',
    name: 'Chapter 17D: Motor Vehicle Safety Responsibility Law',
    why: 'the insurance every vehicle must carry, the security after a crash, and the penalties for driving uninsured',
    omit: [],
  },
]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function page(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`code.wvlegislature.gov answered ${response.status} for ${url}`)
      return await response.text()
    } catch (error) {
      if (attempt >= 4) throw error
      await pause(1000 * 4 ** attempt)
    }
  }
}

/** A chapter page's articles, in order: "13A" for `/17C-13A/`. */
export function articlesOf(html: string, chapter: string): string[] {
  const own = new RegExp(`<div class='art-head' id='ah-([0-9A-Z]+)'><a href='/${chapter}-\\1/'>`, 'g')
  return [...html.matchAll(own)].map((match) => match[1])
}

/**
 * An article page's sections, in order, each with its catchline. A repealed
 * section stays listed as "§17C-14-1 Repealed Acts, 2018 Reg. Sess., Ch. 43."
 * and is marked `repealed`: no law, and left out by `enumerate`.
 */
export function sectionsOf(html: string, chapter: string, article: string): { section: string; href: string; heading: string; repealed: boolean }[] {
  const own = new RegExp(`<div class='sec-head' data-id='ah-${article}'><a href='/(${chapter}-${article}-[0-9A-Za-z]+)/'>([^<]*)</a>`, 'g')
  return [...html.matchAll(own)].map((match) => {
    const catchline = decode(match[2]).replace(/\s+/g, ' ').trim()
    const named = /^§\s*([0-9A-Za-z-]+?)\.?\s+([\s\S]*)$/.exec(catchline)
    // The link and the catchline differ in case ("/17A-3-1A/", "§17A-3-1a."): the catchline is how the code writes it.
    if (named === null || named[1].toUpperCase() !== match[1].toUpperCase()) throw new Error(`a catchline this enumerate does not know: "${catchline}"`)
    const heading = named[2].replace(/\.$/, '').trim()
    return { section: named[1], href: match[1], heading, repealed: /^Repealed\b/i.test(heading) }
  })
}

const site: Site = {
  // The West Virginia Legislature publishes its code; this is that site.
  official: ORIGIN,
  name: 'the West Virginia Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const repealed: string[] = []
    for (const title of TITLES) {
      const articles = articlesOf(await page(`${ORIGIN}${title.chapter}/`), title.chapter)
      if (articles.length === 0) throw new Error(`no articles on the page for chapter ${title.chapter}`)
      const unknown = title.omit.filter((article) => !articles.includes(article))
      if (unknown.length > 0) throw new Error(`chapter ${title.chapter} has no article ${unknown.join(', ')} to leave out`)
      for (const article of articles) {
        if (title.omit.includes(article)) continue
        await pause(1000)
        const sections = sectionsOf(await page(`${ORIGIN}${title.chapter}-${article}/`), title.chapter, article)
        if (sections.length === 0) throw new Error(`no sections on the page for article ${title.chapter}-${article}`)
        for (const { section, href, heading, repealed: gone } of sections) {
          if (gone) {
            repealed.push(section)
            continue
          }
          listings.push({ file: section, url: `${ORIGIN}${href}/`, section, cite: `W. Va. Code § ${section}`, heading })
        }
      }
      await pause(1000)
    }
    if (repealed.length > 0) console.log(`WV: ${repealed.length} sections listed as repealed, left out`)
    return listings
  },
  extract: (html, listing) => extractWestVirginia(html, listing.section),
}

export default site

/** One section's text: a line per paragraph, the catchline and the page around it dropped. */
export function extractWestVirginia(html: string, section: string): string {
  const blocks = html.split("<div class='sectiontext").slice(1)
  if (blocks.length === 0) throw new Error(`no section text on the page for ${section}`)
  if (blocks.length > 1) throw new Error(`the page for ${section} serves ${blocks.length} versions`)
  const body = blocks[0].slice(blocks[0].indexOf('>') + 1, blocks[0].indexOf("<div class='secdiv"))
  const lines = decode(
    body
      .replace(/<\/(p|tr|li|h\d|div)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  // The catchline opens the block, as an <h4> on most pages, an <h2> (17B-7-1)
  // or a <p> (17B-7-2) on others: the listing's heading, not committed again.
  const named = /^§\s*([0-9A-Za-z-]+?)\.?(\s|$)/.exec(lines.shift() ?? '')
  if (named === null || named[1].toUpperCase() !== section.toUpperCase()) throw new Error(`the page for ${section} serves ${named?.[1] ?? 'no section'}`)
  if (lines.length === 0) throw new Unavailable(`the page for ${section} serves no text`)
  return lines.join('\n') + '\n'
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
