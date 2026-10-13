/**
 * Louisiana: the Louisiana Revised Statutes as the Legislature publishes them
 * (legis.la.gov), one section per page. An index-page `enumerate`, as
 * Maryland's: a title's table of contents lists every section with its
 * catchline and the address of its page. The table is an ASP.NET page that
 * opens a title only on a form post-back, so `enumerate` reads the list of
 * titles, then posts the form back once per title it needs.
 *
 * The Legislature serves one version of a section, as amended through the last
 * session, with the chapter and part headings above the law and the history of
 * acts after it; `extract` keeps the section's paragraphs and drops both, and
 * refuses a page that carries the section twice rather than guess which copy
 * is in effect.
 */
import type { Listing, Site } from '../site'

const ORIGIN = 'https://legis.la.gov/Legis/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
/** The Revised Statutes' table of contents: folder 75. */
const CONTENTS = `${ORIGIN}Laws_Toc.aspx?folder=75&level=Parent`

/** "32:385.1" as [385, 1], so a range compares numbers rather than strings. */
function ordinal(section: string): number[] {
  return section
    .split(':')[1]
    .split('.')
    .map((part) => Number(part))
}

function compare(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1)
    if (difference !== 0) return difference
  }
  return 0
}

/** Whether a section lies from `low` to `high`, inclusive, decimals after their whole number: 32:385.1 is inside 32:379 to 32:385.1. */
function within(section: string, low: string, high: string): boolean {
  const at = ordinal(section)
  return compare(at, ordinal(`x:${low}`)) >= 0 && compare(at, ordinal(`x:${high}`)) <= 0
}

/**
 * The sections a licence-holder is bound by. Louisiana keeps its vehicle code
 * in Title 32, Motor Vehicles and Traffic Regulation, its impaired-driving
 * crimes in the Criminal Code (Title 14) and its registration in the vehicle
 * registration chapter of Title 47, Revenue and Taxation.
 *
 * Out of Title 32, and why: §§ 2 to 8 are the departments' own authority;
 * §§ 168 to 170 and 176 bind railroads, not drivers; §§ 251 to 253 regulate
 * carriers of explosives; §§ 386 to 390.23 are axle weights, oversize permits
 * and weigh stations, and §§ 400.1 to 400.8 autonomous commercial vehicles --
 * motor-carrier regulation; in Chapter 2, §§ 403.4, 404.1 and 414.2 to 414.4
 * are commercial driver licensing, whose permit and alcohol rules crowd out
 * the ordinary ones, and §§ 412.3, 422.2, 426 and 429 to 429.3 are the office
 * of motor vehicles' own funds, council and field offices; Chapter 3, apart
 * from its Part XIV on testing suspected impaired drivers, is historic
 * vehicles, street rods, impounding in cities, garages, brake fluid
 * manufacturers and the trucking council; §§ 661.1 and 661.2 are watercraft
 * and locomotives; §§ 735 to 808 license title companies, used car dealers
 * and dismantlers; Chapter 6 (§§ 1251 to 1282) regulates dealers and
 * warranties; the inspection stations' appointment and operation (§§ 1305 to
 * 1308, 1312 to 1314) bind the stations; and Chapters 8 and 12 onward are
 * the equipment compact, hazardous materials and motor carriers, forfeiture,
 * gas-powered vehicle placards and towing companies.
 */
const TITLES: {
  title: string
  id: string
  name: string
  why: string
  keep: (section: string) => boolean
}[] = [
  {
    title: '32',
    id: 'rs32-ch01',
    name: 'Title 32, Chapter 1: Louisiana Highway Regulatory Act (in part)',
    why: 'the definitions, the rules of the road, speed, parking, school buses, seat belts and child restraints, equipment, loads, citations and crash reports',
    keep: (section) =>
      (section === '32:1' || within(section, '21', '385.1') || within(section, '391', '399')) &&
      !within(section, '168', '170') &&
      section !== '32:176' &&
      !within(section, '251', '253.99'),
  },
  {
    title: '32',
    id: 'rs32-ch02',
    name: "Title 32, Chapter 2: Driver's License Law (in part)",
    why: "the driver's licence, driver education, the learner's licence and the graduated limits on drivers under eighteen, points, suspension and the penalties",
    keep: (section) =>
      within(section, '401', '432.99') &&
      !['32:403.4', '32:404.1', '32:414.2', '32:414.3', '32:414.4', '32:412.3', '32:422.2', '32:426'].includes(section) &&
      !within(section, '429', '429.3'),
  },
  {
    title: '32',
    id: 'rs32-ch03',
    name: 'Title 32, Chapter 3, Part XIV: Tests for Suspected Drunken Drivers',
    why: 'implied consent, chemical testing, refusal and the licence suspension that follows, and the under-21 limit',
    keep: (section) => within(section, '661', '681.99') && section !== '32:661.1' && section !== '32:661.2',
  },
  {
    title: '32',
    id: 'rs32-ch04',
    name: 'Title 32, Chapter 4: Vehicle Certificate of Title Law (in part)',
    why: 'the certificate of title every owner must hold and its transfer on a sale',
    keep: (section) => within(section, '701', '732.99'),
  },
  {
    title: '32',
    id: 'rs32-ch05',
    name: 'Title 32, Chapter 5: Motor Vehicle Safety Responsibility Law',
    why: 'the liability insurance every vehicle must carry, proof of it in the vehicle, its minimum limits and the penalties for driving without it',
    keep: (section) => within(section, '851', '1043'),
  },
  {
    title: '32',
    id: 'rs32-ch07',
    name: 'Title 32, Chapter 7: Motor Vehicle Inspection (in part)',
    why: 'the inspection sticker every vehicle must carry, its fee and the penalty',
    keep: (section) => within(section, '1301', '1311.99') && !within(section, '1305', '1308.99'),
  },
  {
    title: '32',
    id: 'rs32-ch09',
    name: 'Title 32, Chapter 9: Driver License Compact',
    why: 'how a conviction in another state counts against a Louisiana licence',
    keep: (section) => within(section, '1420', '1425.99'),
  },
  {
    title: '32',
    id: 'rs32-ch10',
    name: 'Title 32, Chapter 10: Nonresident Violator Compact',
    why: "how an unanswered ticket in another state suspends a Louisiana licence",
    keep: (section) => within(section, '1441', '1443.99'),
  },
  {
    title: '32',
    id: 'rs32-ch11',
    name: 'Title 32, Chapter 11: Motor Vehicle Habitual Offender Law',
    why: 'the revocation that follows repeated serious driving convictions',
    keep: (section) => within(section, '1471', '1479.99'),
  },
  {
    title: '14',
    id: 'rs14',
    name: 'Title 14, Criminal Code (in part): driving offences and underage alcohol',
    why: "operating while impaired and its penalties, refusal, vehicular homicide and negligent injuring, reckless operation, hit-and-run and flight from an officer, and a minor's purchase or possession of alcohol, codified in the Criminal Code",
    keep: (section) =>
      [
        '14:32.1',
        '14:39.1',
        '14:39.2',
        '14:93.10',
        '14:93.12',
        '14:93.13',
        '14:99',
        '14:100',
        '14:108.1',
      ].includes(section) || within(section, '98', '98.9'),
  },
  {
    title: '47',
    id: 'rs47-ch04',
    name: 'Title 47, Chapter 4, Part III: Registration of Vehicles (in part)',
    why: 'the registration and plate every vehicle must carry, temporary plates, new residents and the penalties for driving unregistered',
    keep: (section) =>
      (within(section, '501', '522') || within(section, '536', '540')) &&
      !['47:519.1', '47:519.2', '47:520', '47:522'].includes(section),
  },
]

/** The state's own citation form: "La. R.S. 32:143". Louisiana writes no section sign. */
export function cite(section: string): string {
  return `La. R.S. ${section}`
}

async function page(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, { ...init, headers: { 'User-Agent': AGENT, ...(init?.headers ?? {}) } })
  if (!response.ok) throw new Error(`legis.la.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** A hidden field of the ASP.NET form, which the post-back has to return. */
function field(html: string, name: string): string {
  const match = new RegExp(`id="${name}" value="([^"]*)"`).exec(html)
  return match === null ? '' : decode(match[1])
}

/** The table of contents for one title, by posting back the link the page sets on "TITLE <n>". */
async function titleContents(title: string): Promise<string> {
  const contents = await page(CONTENTS)
  const link = [...contents.matchAll(/__doPostBack\(&#39;([^&]+)&#39;,&#39;&#39;\)">TITLE (\d+)</g)].find(([, , number]) => number === title)
  if (link === undefined) throw new Error(`the table of contents lists no TITLE ${title}`)
  const form = new URLSearchParams()
  for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__PREVIOUSPAGE', '__EVENTVALIDATION']) form.set(name, field(contents, name))
  form.set('__EVENTTARGET', link[1])
  form.set('__EVENTARGUMENT', '')
  await pause()
  return await page(CONTENTS, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
}

/** A title's sections: `<a href="Law.aspx?d=88604">RS 32:861</a>` then the same address around the catchline. */
export function sectionsListed(html: string): { id: string; section: string; heading: string }[] {
  const links = [...html.matchAll(/href="Law\.aspx\?d=(\d+)"[^>]*>([^<]*)<\/a>/g)]
  const out: { id: string; section: string; heading: string }[] = []
  for (let index = 0; index + 1 < links.length; index += 1) {
    const [, id, label] = links[index]
    const number = /^RS (\d+:[\d.]+)$/.exec(label.trim())
    if (number === null || links[index + 1][1] !== id) continue
    out.push({ id, section: number[1], heading: inline(links[index + 1][2]) })
    index += 1
  }
  return out
}

const site: Site = {
  // The Legislature publishes the Revised Statutes itself; this is that site.
  official: ORIGIN,
  name: 'the Louisiana Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const titles = new Map<string, ReturnType<typeof sectionsListed>>()
    for (const title of TITLES) {
      if (!titles.has(title.title)) {
        titles.set(title.title, sectionsListed(await titleContents(title.title)))
        await pause()
      }
      const before = listings.length
      for (const { id, section, heading } of titles.get(title.title)!) {
        if (!section.startsWith(`${title.title}:`) || !title.keep(section)) continue
        // The table keeps a repealed section's number with its repeal for a catchline and nothing else:
        // "Repealed by Acts 2014…", or "§§719 to 720.1 Repealed by…" for a run of them.
        if (heading === '' || /^(§§|repealed|redesignated|reserved|transferred|acts \d)/i.test(heading)) continue
        listings.push({
          file: `${title.id}-${section.replace(/[:.]/g, '_')}`,
          url: `${ORIGIN}Law.aspx?d=${id}`,
          section,
          cite: cite(section),
          heading,
        })
      }
      // A title read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the Title ${title.title} contents list nothing kept for ${title.id}`)
    }
    return listings
  },
  extract: (html, listing) => extractLegis(html, listing.section),
}

export default site

/** The acts that made and amended a section, printed after it: not law. */
const HISTORY = /^(Acts \d{4}|Added by Acts|Amended by Acts|Redesignated|Acts No\.)/
const NOTE = /^(\{\{)?NOTE\b/i

/**
 * One section's text: its paragraphs, one per line, without the title,
 * chapter and part headings above it, the number and catchline that open it
 * (the listing carries the catchline), or the history after it.
 *
 * The Legislature writes a subsection that opens on its first paragraph as
 * "A.(1) Any person…", with no space; the chunker reads "A. " as a label and
 * "A.(" as none, and so would have filed subsection A's text under the
 * subsection before it. A space is put after the letter -- whitespace only,
 * so a quote is the same words in the same order.
 */
export function extractLegis(html: string, section: string): string {
  const start = html.indexOf('<span id="ctl00_PageBody_LabelDocument">')
  if (start < 0) throw new Error(`no document block on the page for ${section}`)
  const end = html.indexOf('</main>', start)
  const block = html.slice(start, end < 0 ? undefined : end)
  const lines = block
    .split(/<\/p>|<br\s*\/?>/i)
    .map((paragraph) => decode(paragraph.replace(/<[^>]+>/g, ' ')).replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  const number = section.split(':')[1].replace(/\./g, '\\.')
  const catchline = new RegExp(`^§\\s*${number}\\.(\\s|$)`)
  const opening = lines.findIndex((line) => catchline.test(line))
  if (opening < 0) throw new Error(`the page for ${section} has no "§${section.split(':')[1]}." line`)
  // A section served twice -- the text now and a copy for a later date -- is a
  // page this extract was not written for; stop rather than commit both.
  if (lines.slice(opening + 1).some((line) => catchline.test(line))) throw new Error(`the page for ${section} carries the section twice`)
  // The Legislature's editorial notes -- "NOTE: See Acts 2004, No. 600, §2,
  // relative to application.", "{{NOTE: SEE ACTS 1986, NO. 1060, §2.}}" -- sit
  // after the history or between subsections; they are not law.
  const after = lines.slice(opening + 1).filter((line) => !NOTE.test(line))
  // Cut at the history, not merely trailing history lines: a footnote can
  // follow it -- "*As appears in enrolled bill.", "1 January 1, 1990." -- and is
  // no more law than the acts above it.
  const history = after.findIndex((line) => HISTORY.test(line))
  const body = history < 0 ? after : after.slice(0, history)
  if (body.length === 0) throw new Error(`${section} came back with no text`)
  return body.map((line) => line.replace(/^([A-Z])\.\(/, '$1. (')).join('\n') + '\n'
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
