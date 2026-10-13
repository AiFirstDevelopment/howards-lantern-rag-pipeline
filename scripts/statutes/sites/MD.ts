/**
 * Maryland: the General Assembly's statute text (mgaleg.maryland.gov), one
 * section per page, listed by the same endpoint the site's own section dropdown
 * calls. The worked example for every other state: an index-page `enumerate`.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://mgaleg.maryland.gov/'
const ARTICLES = { gtr: 'Transp.', gcr: 'Crim. Law' } as const
type Article = keyof typeof ARTICLES

/**
 * The titles a licence-holder is bound by. Out, and why: 12 is the MVA's
 * hearing procedure, 14 and 15 are title fraud and dealers, 18 to 19 are
 * rental and for-hire vehicles, 23 to 25 are inspection stations and the
 * powers of local authorities, and 1 to 10 are the department and its
 * authorities -- none of them a rule a driver is held to.
 */
const TITLES: { article: Article; prefix: string; id: string; name: string; why: string }[] = [
  { article: 'gtr', prefix: '11-', id: 'gtr-11', name: 'Transportation, Title 11: Definitions', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { article: 'gtr', prefix: '13-', id: 'gtr-13', name: 'Transportation, Title 13: Titling and Registration', why: 'registration and plates every owner must hold' },
  { article: 'gtr', prefix: '16-', id: 'gtr-16', name: "Transportation, Title 16: Drivers' Licenses", why: 'licensing, the provisional licence and its limits, points and suspension' },
  { article: 'gtr', prefix: '17-', id: 'gtr-17', name: 'Transportation, Title 17: Required Security', why: 'the insurance every vehicle must carry' },
  { article: 'gtr', prefix: '20-', id: 'gtr-20', name: 'Transportation, Title 20: Accidents', why: 'what a driver must do after a crash' },
  { article: 'gtr', prefix: '21-', id: 'gtr-21', name: 'Transportation, Title 21: Rules of the Road', why: 'the rules of the road, including impaired driving' },
  { article: 'gtr', prefix: '22-', id: 'gtr-22', name: 'Transportation, Title 22: Equipment', why: 'lights, belts, child seats and the equipment a vehicle must have' },
  { article: 'gtr', prefix: '26-', id: 'gtr-26', name: 'Transportation, Title 26: Enforcement', why: 'citations, arrest and what a stopped driver must do' },
  { article: 'gtr', prefix: '27-', id: 'gtr-27', name: 'Transportation, Title 27: Penalties', why: 'the fines and jail terms for breaking the rules above' },
  { article: 'gcr', prefix: '10-1', id: 'gcr-10', name: 'Criminal Law, Title 10, Subtitle 1: Alcoholic Beverages', why: 'underage drinking and open containers, codified outside the Transportation Article' },
]

export function sectionUrl(article: Article, section: string): string {
  return `${ORIGIN}mgawebsite/Laws/StatuteText?article=${article}&section=${section}&enactments=false`
}

async function sectionsOf(article: Article): Promise<string[]> {
  const response = await fetch(`${ORIGIN}mgawebsite/api/Laws/GetSections?articleCode=${article}&enactments=false`, {
    headers: { 'User-Agent': 'howardslantern.com statute check' },
  })
  if (!response.ok) throw new Error(`mgaleg's section list for ${article} answered ${response.status}`)
  return ((await response.json()) as { DisplayText: string }[]).map((each) => each.DisplayText)
}

const site: Site = {
  // The General Assembly publishes the Annotated Code; this is that site.
  official: ORIGIN,
  name: 'the Maryland Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const article of Object.keys(ARTICLES) as Article[]) {
      const prefixes = TITLES.filter((title) => title.article === article).map((title) => title.prefix)
      for (const section of await sectionsOf(article)) {
        if (!prefixes.some((prefix) => section.startsWith(prefix))) continue
        listings.push({
          file: `${article}-${section}`,
          url: sectionUrl(article, section),
          section,
          cite: `Md. Code, ${ARTICLES[article]} § ${section}`,
          // mgaleg publishes no catchlines: the section's own text is all there is.
          heading: '',
        })
      }
    }
    return listings
  },
  extract: (html) => extractMgaleg(html),
}

export default site

/**
 * The text of a Maryland statute page: the `StatuteText` block, line breaks
 * kept, tags and navigation dropped -- and **only the version in effect**.
 * A section amended for a future date is served twice on one page, the current
 * text and then a `// EFFECTIVE <date> //` copy; a quote found only in the
 * second would be the law of 2030 presented as the law today.
 */
export function extractMgaleg(html: string): string {
  const start = html.indexOf('<div id="StatuteText">')
  if (start < 0) throw new Error('no StatuteText block on the page')
  const block = html.slice(start).split('\n')[1] ?? ''
  const text = decode(
    block
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0 && !/^(Previous|Next|PreviousNext)$/.test(line))
  // mgaleg lists a few sections its reader cannot serve (21-1135, 16-404.2):
  // the page says so in place of the law, and that is not a section to commit.
  if (lines.some((line) => line === 'File Not Found')) throw new Unavailable('mgaleg serves "File Not Found"')
  const future = lines.findIndex((line, index) => index > 0 && /^§.*\/\/ EFFECTIVE /.test(line))
  return (future < 0 ? lines : lines.slice(0, future)).join('\n') + '\n'
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
