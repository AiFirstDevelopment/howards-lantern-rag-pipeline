/**
 * District of Columbia: the Council's own D.C. Law Library
 * (code.dccouncil.gov), which publishes the Code of the District of Columbia.
 * An index-page `enumerate`, as Maryland's: each chapter's `index.json` -- the
 * table of contents the reader itself loads -- lists its sections, and each
 * section is served as one page.
 *
 * The District keeps much of its rules of the road in regulation: the fire
 * hydrant distance, right on red and the school-bus stop are 18 DCMR, adopted
 * under D.C. Code § 50-2201.03. Alaska's regulations came from the same reader
 * as its statutes; the DCMR does not. It is published by a different office
 * (the Office of Documents and Administrative Issuances, dcregs.dc.gov) through
 * ASP.NET postbacks, and a site module names one official source, so this
 * ingests the Code alone and the topics only 18 DCMR states are `none`.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://code.dccouncil.gov/us/dc/council/code/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 50, and why: 1, 1A
 * and 15C are delivery companies and delivery robots; 2 is the District's own
 * fleet; 3 taxicabs; 4 the commercial licence; 5, 5A and 6 consumer protection
 * in a sale; 7 to 8 fuels, emissions programmes and environmental plates; 9
 * and 9A the departments themselves; 12 liens; 13A salvage titles; 15A tour
 * buses; 15B vessels; 18A, 19A, 19B, 21A, 23B to 23D task forces, councils and
 * the agencies' data and street-design duties; 20 certifies course providers;
 * 23A autonomous-vehicle testing; 24 to 25C and 27 are what the District does
 * with abandoned vehicles, its parking authority and its parking-zone
 * programmes. Title 31 is insurance law but for chapter 24, the insurance a
 * vehicle must carry; Title 25 is alcohol licensing but for the two sections a
 * driver is held to.
 */
const TITLES: { title: string; chapter: string; id: string; name: string; why: string; only?: string[] }[] = [
  { title: '50', chapter: '10', id: 'dc50-c10', name: 'Title 50, Chapter 10: Driver License Compact', why: 'how a conviction in another state counts against a District licence' },
  { title: '50', chapter: '11', id: 'dc50-c11', name: 'Title 50, Chapter 11: Inspection', why: 'the inspection an owner must have a vehicle pass, and the equipment it checks' },
  { title: '50', chapter: '13', id: 'dc50-c13', name: 'Title 50, Chapter 13: Motor Vehicle Owners and Operators Responsibility', why: 'financial responsibility after a crash and the suspension for lacking it' },
  { title: '50', chapter: '14', id: 'dc50-c14', name: "Title 50, Chapter 14: Operators' Permits and Identification Cards", why: 'licensing, the learner permit and provisional licence and their limits, points, suspension and revocation' },
  { title: '50', chapter: '15', id: 'dc50-c15', name: 'Title 50, Chapter 15: Registration of Motor Vehicles', why: 'registration, title and plates every owner must hold' },
  { title: '50', chapter: '16', id: 'dc50-c16', name: 'Title 50, Chapter 16: Regulation of Bicycles', why: 'the rules for riding a bicycle, and what a driver owes a cyclist' },
  { title: '50', chapter: '16A', id: 'dc50-c16A', name: 'Title 50, Chapter 16A: General Helmet Use', why: 'helmets on motorcycles and mopeds' },
  { title: '50', chapter: '17', id: 'dc50-c17', name: 'Title 50, Chapter 17: Child Restraint', why: 'child seats and who must ride in one' },
  { title: '50', chapter: '17A', id: 'dc50-c17A', name: 'Title 50, Chapter 17A: Distracted Driving Prevention', why: 'hand-held phones and texting while driving' },
  { title: '50', chapter: '18', id: 'dc50-c18', name: 'Title 50, Chapter 18: Mandatory Use of Seat Belts', why: 'seat belts for every occupant and the fine for going without' },
  { title: '50', chapter: '19', id: 'dc50-c19', name: 'Title 50, Chapter 19: Implied Consent to Chemical Testing', why: 'the breath and blood test a driver consents to, and refusing it' },
  { title: '50', chapter: '21', id: 'dc50-c21', name: 'Title 50, Chapter 21: Vehicle Cover Requirements', why: 'securing a load so nothing falls on the road' },
  { title: '50', chapter: '22', id: 'dc50-c22', name: 'Title 50, Chapter 22: Regulation of Traffic', why: 'definitions, speeding and reckless driving, impaired driving, duties after a crash, fleeing, and the general penalties' },
  { title: '50', chapter: '23', id: 'dc50-c23', name: 'Title 50, Chapter 23: Traffic Adjudication', why: 'how a traffic infraction is charged, answered and penalised' },
  { title: '50', chapter: '26', id: 'dc50-c26', name: 'Title 50, Chapter 26: Regulation of Parking', why: 'parking rules a driver is held to, and their fines' },
  { title: '31', chapter: '24', id: 'dc31-c24', name: 'Title 31, Chapter 24: Compulsory/No-Fault Motor Vehicle Insurance', why: 'the insurance every vehicle must carry and its minimum limits' },
  { title: '25', chapter: '10', id: 'dc25-c10', name: 'Title 25, Sections 1001 and 1002: Open containers and persons under 21', why: 'open containers in a vehicle and underage drinking, codified in the alcohol title', only: ['25-1001', '25-1002'] },
]

/** The District's own citation form: "D.C. Code § 50-2201.04". */
export function cite(section: string): string {
  return `D.C. Code § ${section}`
}

export function sectionUrl(section: string): string {
  return `${ORIGIN}sections/${section}`
}

async function json(url: string): Promise<Toc> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`code.dccouncil.gov answered ${response.status} for ${url}`)
  return JSON.parse(decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))) as Toc
}

interface Toc {
  t?: string
  p?: string
  et?: string
  c?: Toc[]
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** "§ 50–2201.04. Speeding and reckless driving." -> its number, as the URL writes it, and the catchline. */
const TOC_HEAD = /^§\s*([\w.–-]+?)\.\s+([\s\S]*)$/

/** What is left where a section no longer holds law: "[Repealed].", "[Reserved].", "[Expired].", "[Transferred]". */
const GONE = /\[(repealed|reserved|expired|omitted|transferred|vacant)\.?\]\.?\s*$/i

function sectionsIn(node: Toc, out: Toc[]): Toc[] {
  if (node.et === 'section') out.push(node)
  else for (const child of node.c ?? []) sectionsIn(child, out)
  return out
}

const site: Site = {
  // The Council of the District of Columbia publishes the D.C. Code; this is its library.
  official: ORIGIN,
  name: 'the Code of the District of Columbia',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const toc = await json(`${ORIGIN}titles/${spec.title}/chapters/${spec.chapter}/index.json`)
      for (const node of sectionsIn(toc, [])) {
        const section = node.p?.split('/').pop() ?? ''
        if (spec.only !== undefined && !spec.only.includes(section)) continue
        const head = TOC_HEAD.exec(node.t ?? '')
        if (head === null) throw new Error(`a section title this cannot read: ${node.t}`)
        if (GONE.test(head[2])) continue
        listings.push({
          file: `${spec.id}-${section}`,
          url: sectionUrl(section),
          section,
          cite: cite(section),
          heading: head[2].replace(/\.$/, '').trim(),
        })
      }
      await pause()
    }
    return listings
  },
  extract: (html, listing) => extractDccode(html, listing.section),
}

export default site

/**
 * One section's text: "§ <number>." on its own line, then a line per paragraph
 * of law -- the article's paragraphs up to its annotations, which are the
 * session-law history, prior codifications and notes of amendments, not law.
 *
 * The Library codifies an amendment only once it is in effect: one whose
 * applicability waits on a budget is left out of the text and named in the
 * annotations instead ("that amendment has not been implemented"), and
 * emergency acts are cited there, never merged. So the text above the
 * annotations is the law in effect, and a page that served two headed copies
 * of a section would be one this cannot choose between -- an error, not a
 * guess.
 */
export function extractDccode(html: string, section: string): string {
  const start = html.indexOf('<article class="content"')
  if (start < 0) throw new Error(`${section}: no article on the page`)
  const end = html.indexOf('</article>', start)
  let article = html.slice(start, end < 0 ? undefined : end)
  const notes = article.indexOf('<aside class="annotations"')
  if (notes >= 0) article = article.slice(0, notes)
  const heads = [...article.matchAll(/<h1 class="h__[^"]*"[^>]*>([\s\S]*?)<\/h1>/g)]
  if (heads.length !== 1) throw new Error(`${section}: ${heads.length} section headings on one page`)
  const body = article.slice(heads[0].index! + heads[0][0].length)
  const lines = body
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/(p|tr|div|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decode(line).replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  // A section enacted subject to a budget that never funded it is served as
  // "Not Funded." in place of its text: on the books, not in effect, and no
  // rule a driver is held to. A subsection served so is left as the Library
  // prints it -- the line states nothing a quote could misattribute.
  if (lines.length === 1 && /^Not Funded\.$/i.test(lines[0])) throw new Unavailable('enacted but not funded, so not in effect')
  return [`§ ${section}.`, ...lines].join('\n') + '\n'
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
