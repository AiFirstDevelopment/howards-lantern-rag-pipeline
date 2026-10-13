/**
 * Alaska: the Legislature's own Alaska Statutes and Alaska Administrative Code
 * reader (akleg.gov/basis). Index-page `enumerate`, as Maryland's: each
 * chapter's table of contents lists its sections, and the reader's print view
 * serves one section at a time.
 *
 * Alaska puts its rules of the road in regulation, not statute: AS 28.05.011
 * has the Department of Public Safety adopt them, and they are 13 AAC 02 --
 * where the fire-hydrant distance, the school-bus stop and the speed limits
 * live. Without the Administrative Code the box would have Alaska's licensing
 * and DUI law and none of its driving rules, so both are ingested, from the
 * same official reader.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.akleg.gov/basis/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

type Code = 'statutes' | 'aac'

/**
 * The chapters a licence-holder is bound by. Out, and why: AS 28.05 is the
 * department's administration, all but its belt, child-seat and citation
 * sections; 28.11, 28.30 and 28.31 are what a municipality
 * does with an abandoned vehicle; 28.17 regulates driving schools as
 * businesses; 28.23 is transportation network companies; 28.32 and 28.33 and
 * 13 AAC 03 and 05 are commercial motor carriers and commercial licences;
 * 28.39 is snowmobile registration; 28.25 and 28.40 hold no section in force
 * (every one repealed or renumbered); 13 AAC 06 licenses inspection stations.
 */
const TITLES: { code: Code; chapter: string; id: string; name: string; why: string; only?: string[] }[] = [
  { code: 'statutes', chapter: '28.01', id: 'as-28-01', name: 'AS 28.01: Alaska Uniform Traffic Laws Act', why: 'that the traffic law is uniform statewide, and the one rule it leaves to towns: cell phone use' },
  { code: 'statutes', chapter: '28.05', id: 'as-28-05', name: 'AS 28.05.095-.099, .151: Seat belts, child safety devices, and scheduled offenses', why: "seat belts and child seats, which Alaska codifies in the department's chapter, and the citation a scheduled traffic offense brings", only: ['28.05.095', '28.05.096', '28.05.099', '28.05.151'] },
  { code: 'statutes', chapter: '28.10', id: 'as-28-10', name: 'AS 28.10: Vehicle Registration, Liens, and Title', why: 'registration and plates every owner must hold' },
  { code: 'statutes', chapter: '28.15', id: 'as-28-15', name: "AS 28.15: Drivers' Licenses", why: 'licensing, the instruction permit and provisional licence, points and suspension' },
  { code: 'statutes', chapter: '28.20', id: 'as-28-20', name: 'AS 28.20: Motor Vehicle Safety Responsibility Act', why: 'financial responsibility after a crash and the suspension for lacking it' },
  { code: 'statutes', chapter: '28.22', id: 'as-28-22', name: 'AS 28.22: Mandatory Motor Vehicle Insurance', why: 'the insurance every vehicle must carry and its minimum limits' },
  { code: 'statutes', chapter: '28.35', id: 'as-28-35', name: 'AS 28.35: Offenses and Accidents', why: 'impaired driving, refusal, open containers, reckless driving, duties after a crash, texting' },
  { code: 'statutes', chapter: '28.37', id: 'as-28-37', name: 'AS 28.37: Driver License Compact', why: 'how a conviction in another state counts against an Alaska licence' },
  { code: 'statutes', chapter: '28.90', id: 'as-28-90', name: 'AS 28.90: General and Miscellaneous Provisions', why: "the title's definitions, its penalties, and doubled fines in work zones and safety corridors" },
  { code: 'statutes', chapter: '04.16', id: 'as-04-16', name: 'AS 04.16.050: Possession, control, or consumption by persons under 21', why: 'underage drinking and the licence revocation for it, codified in the alcohol title', only: ['04.16.050'] },
  { code: 'aac', chapter: '13.02', id: 'aac-13-02', name: '13 AAC 02: Rules of the Road', why: "Alaska's rules of the road: signals, right of way, speed, turning, parking, school buses, belts" },
  { code: 'aac', chapter: '13.04', id: 'aac-13-04', name: '13 AAC 04: Vehicle Equipment and Inspection', why: 'lights, brakes, tires, windows and the equipment a vehicle must have' },
  { code: 'aac', chapter: '13.08', id: 'aac-13-08', name: '13 AAC 08: Driver Licensing and Safety Responsibility', why: 'the licence tests, the points schedule and the suspensions that follow' },
  { code: 'aac', chapter: '13.70', id: 'aac-13-70', name: '13 AAC 70: Vehicle Registration, Title, and Transfer', why: 'registration, plates and transfer rules an owner must follow' },
]

/** The state's own citation form: "AS 28.35.030", "13 AAC 02.340". */
export function cite(section: string): string {
  return /AAC/.test(section) ? section : `AS ${section}`
}

export function sectionUrl(code: Code, number: string): string {
  return `${ORIGIN}${code === 'aac' ? 'aac' : 'statutes'}.asp?media=print&secStart=${number}&secEnd=${number}`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`akleg answered ${response.status} for ${url}`)
  // The reader sends Windows-1252 and says so; the fetch's own decoder reads it as declared.
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * A chapter's sections and catchlines, from the reader's table of contents.
 * A section the contents marks "[Repealed" or "[Renumbered" is skipped: it is
 * a pointer, not a rule. A number listed twice is a section with a version
 * not yet in effect; it is listed once, and `extract` reports it if the
 * reader serves it empty, as it does every such section.
 */
async function sectionsOf(code: Code, chapter: string): Promise<{ number: string; heading: string }[]> {
  const html = await page(`${ORIGIN}${code === 'aac' ? 'aac' : 'statutes'}.asp?media=js&type=TOC&title=${chapter}`)
  const pattern =
    code === 'aac'
      ? /href="aac\.asp#(\d+\.\d+\.\d+)">Sec\.\s+13 AAC \d+\.\d+\.\s+([^<]*)/g
      : /#(\d+\.\d+\.\d+) >Sec\. [\d.]+\.\s+([^<]*)/g
  const out = new Map<string, string>()
  for (const [, number, rawHeading] of html.matchAll(pattern)) {
    const heading = rawHeading.replace(/\s+/g, ' ').trim()
    if (!number.startsWith(`${chapter}.`)) continue
    if (heading === '' || /^\[|\[(Repealed|Renumbered)|^\((Repealed|Renumbered|Deleted)/i.test(heading)) continue
    if (!out.has(number)) out.set(number, heading)
  }
  return [...out].map(([number, heading]) => ({ number, heading }))
}

/** "13.02.340" as the Administrative Code writes it: "13 AAC 02.340". */
const aacSection = (number: string) => {
  const [title, chapter, section] = number.split('.')
  return `${title} AAC ${chapter}.${section}`
}

const site: Site = {
  // The Legislature publishes both the Statutes and the Administrative Code here.
  official: ORIGIN,
  name: 'the Alaska Statutes and Administrative Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      for (const { number, heading } of await sectionsOf(title.code, title.chapter)) {
        if (title.only !== undefined && !title.only.includes(number)) continue
        const section = title.code === 'aac' ? aacSection(number) : number
        listings.push({
          file: `${title.id}-${number.split('.')[2]}`,
          url: sectionUrl(title.code, number),
          section,
          cite: cite(section),
          heading: heading.replace(/\.$/, ''),
        })
      }
      await pause()
    }
    return listings
  },
  extract: (body, listing) => extractAkleg(body, listing.section),
}

export default site

/**
 * The text of one section from the reader's print view: its heading line,
 * then the law, line breaks kept, tags and cross-reference links dropped.
 *
 * Only the version in effect: the reader serves a section that has a future
 * version as its heading and nothing else (AS 04.16.100), so a page with no
 * body is `Unavailable`, never a heading committed as though it were law. A
 * page carrying a second section (a range the reader widened) keeps only the
 * one asked for.
 */
export function extractAkleg(html: string, section: string): string {
  const start = html.indexOf('<div class="statute">')
  if (start < 0) throw new Error('no statute block on the page')
  const number = section.replace(/^(\d+) AAC (\d+)\.(\d+)$/, '$1.$2.$3')
  let block = html.slice(start)
  const anchors = [...block.matchAll(/<a name="([^"]+)"/g)]
  const own = anchors.findIndex((anchor) => anchor[1] === number)
  if (own < 0) throw new Error(`the page does not carry ${section}`)
  const next = anchors[own + 1]
  block = block.slice(anchors[own].index, next === undefined ? undefined : next.index)
  const text = decode(
    block
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(b|div|p)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2) throw new Unavailable('akleg serves the heading with no text (a section with a version not yet in effect)')
  // A last subsection kept only as "(e) [Repealed, § 22 ch 32 SLA 2016.]" is
  // no law in effect, and left on it hides whether the section above it ends
  // as a law does. Only trailing ones go: dropping one mid-section would make
  // (f) follow (d) and the chunker would fold it into (d).
  while (lines.length > 2 && /^\([a-z0-9]+\) \[(Repealed|Renumbered)[^\]]*\]$/i.test(lines[lines.length - 1])) lines.pop()
  return lines.join('\n') + '\n'
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
