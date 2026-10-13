/**
 * Arizona: the Legislative Council's own Arizona Revised Statutes
 * (azleg.gov/ars). Index-page `enumerate`, as Maryland's: the title's table of
 * contents (arsDetail) lists every section by chapter and article with its
 * catchline, and each section is a static page of its own.
 *
 * The site says it "reflects the version of law that is effective on January
 * 1st of the year following the most recent legislative session", and serves
 * one version of each section: where that is a version enacted for a later
 * date, `extract` reports the section unavailable rather than commit it.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.azleg.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out, and why: Title 28's chapter
 * 2 is the department and its board; 10 regulates dealers and recyclers; 11 is
 * what an agency does with an abandoned vehicle; 13 licenses third-party
 * agents; 14 is motor carriers; 15 to 24 are fees, fuel taxes, highway
 * financing, construction and billboards; 25 is aviation; 26, 27 and 30 are
 * transit authorities, light rail and for-hire carriers; 31 is car-sharing
 * companies; 32 is autonomous-vehicle deployment. Inside the chapters kept:
 * chapter 3's article 19 is oversize-load permits for carriers; chapter 7's
 * articles 3 and 6 to 9 are salvage dismantlers, fleets and interstate
 * apportioned registration, and 12 to 15 are the specialty plates; chapter
 * 8's article 2 is an advisory council and article 5 the commercial licence.
 */
const TITLES: { title: string; chapter: string; id: string; name: string; why: string; skipArticles?: string[]; only?: string[] }[] = [
  { title: '28', chapter: '1', id: 'az-28-1', name: 'Title 28, Chapter 1: Definitions, Penalties and General Provisions', why: "what the code means by a vehicle, a moped, a highway or a driver, and the title's general penalty" },
  { title: '28', chapter: '3', id: 'az-28-3', name: 'Title 28, Chapter 3: Traffic and Vehicle Regulation', why: 'the rules of the road: signals, right of way, speed, parking, school buses, crashes, equipment, belts and child seats', skipArticles: ['19'] },
  { title: '28', chapter: '4', id: 'az-28-4', name: 'Title 28, Chapter 4: Driving Under the Influence', why: 'impaired driving, implied consent, the under-21 rule and ignition interlocks' },
  { title: '28', chapter: '5', id: 'az-28-5', name: 'Title 28, Chapter 5: Penalties and Procedures for Vehicle Violations', why: 'civil and criminal traffic violations, the fines and how a ticket is answered' },
  { title: '28', chapter: '6', id: 'az-28-6', name: 'Title 28, Chapter 6: Agreements and Compacts', why: 'how a conviction or ticket in another state counts against an Arizona licence' },
  { title: '28', chapter: '7', id: 'az-28-7', name: 'Title 28, Chapter 7: Certificate of Title and Registration', why: 'the title, registration and plates every owner must hold and display', skipArticles: ['3', '6', '7', '8', '9', '12', '13', '14', '15'] },
  { title: '28', chapter: '8', id: 'az-28-8', name: 'Title 28, Chapter 8: Motor Vehicle Driver Licenses', why: 'licensing, the instruction permit and graduated licence, points, suspension and driving without a licence', skipArticles: ['2', '5'] },
  { title: '28', chapter: '9', id: 'az-28-9', name: 'Title 28, Chapter 9: Vehicle Insurance and Financial Responsibility', why: 'the insurance every vehicle must carry, its minimum limits and the suspension for lacking it' },
  { title: '4', chapter: '2', id: 'az-4-2', name: 'Title 4, Section 4-244: Unlawful acts', why: 'underage drinking and the under-21 driving rule, codified in the alcoholic-beverages title', only: ['4-244'] },
]

/** The state's own citation form: "A.R.S. § 28-873". */
export function cite(section: string): string {
  return `A.R.S. § ${section}`
}

/** "28-873" -> .../ars/28/00873.htm; "28-622.01" -> 00622-01.htm, as the index links it. */
export function sectionUrl(section: string): string {
  const [title, number] = section.split('-')
  const [whole, decimal] = number.split('.')
  return `${ORIGIN}ars/${title}/${whole.padStart(5, '0')}${decimal === undefined ? '' : `-${decimal}`}.htm`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`azleg answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * A title's sections, catchlines and the chapter and article each sits in,
 * from arsDetail's accordion: one `<div id="chapterN">` per chapter, one
 * `<div class="article">` per article, one row per section.
 */
async function sectionsOf(title: string): Promise<{ chapter: string; article: string; section: string; heading: string }[]> {
  const html = await page(`${ORIGIN}arsDetail/?title=${title}`)
  const out: { chapter: string; article: string; section: string; heading: string }[] = []
  const chapters = [...html.matchAll(/<div id="chapter([\d.]+)" class="accordion">/g)]
  for (const [index, match] of chapters.entries()) {
    const block = html.slice(match.index, chapters[index + 1]?.index)
    for (const article of block.split('<div class="article">').slice(1)) {
      const label = /^<a[^>]*>Article ([\d.]+)<\/a>/.exec(article)?.[1] ?? ''
      for (const [, section, heading] of article.matchAll(/>(\d+-[\d.]+)<\/a><\/li><li class="colright">([^<]*)<\/li>/g)) {
        out.push({ chapter: match[1], article: label, section, heading: decode(heading).replace(/\s+/g, ' ').trim() })
      }
    }
  }
  if (out.length === 0) throw new Error(`azleg's table of contents for Title ${title} listed no sections`)
  return out
}

const site: Site = {
  // The Legislative Council publishes the Revised Statutes here for the Legislature.
  official: ORIGIN,
  name: 'the Arizona Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of [...new Set(TITLES.map((each) => each.title))]) {
      const rows = await sectionsOf(title)
      for (const spec of TITLES.filter((each) => each.title === title)) {
        for (const row of rows) {
          if (row.chapter !== spec.chapter) continue
          if (spec.skipArticles?.includes(row.article)) continue
          if (spec.only !== undefined && !spec.only.includes(row.section)) continue
          // A catchline the index marks repealed or transferred is a pointer, not a rule.
          if (/^\[|\b(repealed|transferred|renumbered)\b/i.test(row.heading)) continue
          listings.push({
            file: `${spec.id}-${row.section.split('-')[1]}`,
            url: sectionUrl(row.section),
            section: row.section,
            cite: cite(row.section),
            heading: row.heading,
          })
        }
      }
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractAzleg(body, listing.section),
}

export default site

/**
 * The text of one section page: its number-and-catchline line, then a line
 * per paragraph, tags dropped. Only the first section on the page is kept --
 * the page is one section, and a second `<font color=GREEN>` number would be
 * another version of it, not the one in effect. A page that does not open on
 * the section asked for is an error page or a different section, and is
 * `Unavailable` rather than committed under this one's name.
 */
export function extractAzleg(html: string, section: string): string {
  const body = /<BODY[^>]*>([\s\S]*?)(<\/BODY>|$)/i.exec(html)?.[1]
  if (body === undefined) throw new Error('no body on the page')
  const headers = [...body.matchAll(/<font color=GREEN>/gi)]
  if (headers.length === 0) throw new Unavailable('azleg serves no section number on the page')
  const block = body.slice(headers[0].index, headers[1]?.index)
  const text = decode(
    block
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (!lines[0]?.startsWith(section)) throw new Unavailable(`the page opens on "${lines[0]?.slice(0, 40)}", not ${section}`)
  if (lines.length < 2) throw new Unavailable('azleg serves the catchline with no text')
  // The site publishes a version enacted for a later date in place of the one
  // in effect, marked under the catchline -- "(L26, Ch. 200, sec. 2. Eff.
  // 7/1/27)" on 28-3318, "(Eff. 7/1/27)" on 28-711 -- with no copy of the
  // current text beside it. Committed, it would be the law of 2027 presented
  // as today's. "Eff. until 7/1/27" is the version in effect, and is kept.
  const future = /\bEff\. (\d{1,2})\/(\d{1,2})\/(\d{2})\)$/.exec(lines[1])
  if (future !== null && !/Eff\. until/.test(lines[1])) {
    const [, month, day, year] = future
    const from = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    if (from > new Date().toISOString().slice(0, 10)) throw new Unavailable(`azleg serves only the version effective ${from}`)
  }
  return lines.join('\n') + '\n'
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;?/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
