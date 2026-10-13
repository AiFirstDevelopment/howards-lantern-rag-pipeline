/**
 * Indiana: the Indiana Code as the General Assembly publishes it at
 * iga.in.gov. A bulk-file `enumerate`: the Legislative Services Agency
 * publishes each title of the current edition as one HTML file
 * (`/ic/<year>/Title_9.html`, about 6 MB), every section in it under its own
 * id, which is what the site's JavaScript reader loads and renders. A
 * section's URL is that file with the section's id as its fragment, and the
 * file is read once per run however many sections name it.
 *
 * The host answers a script whose User-Agent does not open as a browser's
 * does ("Mozilla/5.0 (…") with its single-page app shell in place of the file
 * -- 691 bytes, `x-cache: Error from cloudfront`, status 200 -- whatever else
 * the agent says. So `read` asks with the standard crawler form of the same
 * named agent, "Mozilla/5.0 (compatible; howardslantern.com statute check; …)",
 * and refuses the shell rather than hashing it as a title.
 *
 * What is in effect: a section amended for a future date is served twice, as
 * `9-24-10-1` with a note "This version of section effective until 1-1-2027"
 * and `9-24-10-1-b` with "This version of section effective 1-1-2027". The
 * second is the law of 2027, so `enumerate` lists only the first, and `extract`
 * refuses a future copy should one ever be listed. A section amended by two
 * acts in one session without reconciliation is also served twice ("This
 * version of section amended by P.L.152-2026 … See also following version …
 * amended by P.L.156-2026"); both are in effect until the next technical
 * corrections act, so both are kept, the second filed under the site's own
 * `-b` id. Repealed and expired sections are kept by the file as a heading and
 * a history line only, and are not listed.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://iga.in.gov/'
const AGENT = 'Mozilla/5.0 (compatible; howardslantern.com statute check; +https://howardslantern.com/)'

/**
 * The parts a licence-holder is bound by. Out of Title 9, and why: 14 and 14.1
 * are the Bureau of Motor Vehicles and its branches, 20 is size and weight
 * permits for carriers, 22 is abandoned and salvage vehicles (what a
 * municipality and a scrapyard do), 27 is the state's safety and driver
 * education programs, 28 the compacts between states' agencies, 32 dealers and
 * 33 the bureau's hearing procedure; articles 1 to 12, 15, 16, 23, 29 and 31
 * are repealed, 18 expired. Out of article 24, chapter 6.1, the commercial
 * licence, as Maryland and Florida leave theirs out. Outside Title 9, only
 * the chapters a young driver is held to: minors and alcohol in 7.1, and
 * littering in 35.
 */
const TITLES: { title: string; prefix: string; id: string; name: string; why: string; skip?: string[] }[] = [
  { title: '9', prefix: '9-13', id: 'ic-9-13', name: 'IC 9-13: General Provisions and Definitions', why: 'what the code means by a vehicle, a moped, a highway or an operator' },
  { title: '9', prefix: '9-17', id: 'ic-9-17', name: 'IC 9-17: Certificates of Title', why: 'the title every owner must hold, and what to do when a vehicle is sold' },
  { title: '9', prefix: '9-18.1', id: 'ic-9-18.1', name: 'IC 9-18.1: Motor Vehicle Registration', why: 'registration, its fees and renewal, every owner is held to' },
  { title: '9', prefix: '9-18.5', id: 'ic-9-18.5', name: 'IC 9-18.5: Distinctive License Plates', why: 'the plates a vehicle may carry, including disability plates and placards' },
  { title: '9', prefix: '9-19', id: 'ic-9-19', name: 'IC 9-19: Motor Vehicle Equipment', why: 'lights, brakes, belts, child seats, tint and the equipment a vehicle must have' },
  { title: '9', prefix: '9-21', id: 'ic-9-21', name: 'IC 9-21: Traffic Regulation', why: 'the rules of the road: signals, speed, right of way, passing, parking, school buses, phones' },
  { title: '9', prefix: '9-24', id: 'ic-9-24', name: "IC 9-24: Drivers Licenses", why: "the learner's permit, the probationary licence and its limits, renewal and driving while suspended", skip: ['9-24-6.1'] },
  { title: '9', prefix: '9-25', id: 'ic-9-25', name: 'IC 9-25: Financial Responsibility', why: 'the insurance every vehicle must carry, and the suspension for driving without it' },
  { title: '9', prefix: '9-26', id: 'ic-9-26', name: 'IC 9-26: Accidents and Accident Reports', why: 'what a driver must do after a crash' },
  { title: '9', prefix: '9-30', id: 'ic-9-30', name: 'IC 9-30: General Penalty Provisions', why: 'impaired driving, implied consent, open containers, suspension and habitual violators' },
  { title: '7.1', prefix: '7.1-5-7', id: 'ic-7.1-5-7', name: 'IC 7.1-5-7: Minors (alcoholic beverages)', why: 'underage possession and transport of alcohol, and the licence suspension for it, codified outside Title 9' },
  { title: '35', prefix: '35-45-3', id: 'ic-35-45-3', name: 'IC 35-45-3: Littering and Pollution', why: 'littering from a vehicle and its penalty, codified in the criminal code' },
]

const inPrefix = (section: string, prefix: string) => section === prefix || section.startsWith(`${prefix}-`)

/**
 * A title file, once per run. The fetch would read a page once per run too,
 * but only through its own request, and that request's agent is refused here;
 * a section's `read` otherwise downloaded the same 6 MB file for each of its
 * sections.
 */
const titles = new Map<string, Promise<string>>()

function titleFile(url: string): Promise<string> {
  const key = url.split('#')[0]
  if (!titles.has(key)) {
    const body = request(key)
    titles.set(key, body)
    body.catch(() => titles.delete(key))
  }
  return titles.get(key)!
}

async function request(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`iga.in.gov answered ${response.status} for ${url}`)
      const body = decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
      // The app shell, served with a 200 for a file the host will not give
      // this agent or does not have: hashed, it would be every section's law.
      if (!body.includes('T_ICTITLE_S_NUMBER') && !url.includes('/api/')) throw new Error(`iga.in.gov served its app shell, not the code, for ${url}`)
      return body
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
    }
  }
}

/** The edition the site serves as current: the year the General Assembly marks active. */
async function codeYear(): Promise<string> {
  const years = JSON.parse(await request(`${ORIGIN}api/getSessionYears`)) as { years: { active: boolean; in_code_year: string }[] }
  const year = years.years.find((each) => each.active)?.in_code_year
  if (year === undefined || !/^\d{4}$/.test(year)) throw new Error('iga.in.gov names no active code year')
  return year
}

/** Each section's block of a title file: from its own heading to the next section, chapter or article. */
function blocks(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const heads = [...html.matchAll(/<div class="(section|chapter|article)" id="([^"]+)"/g)]
  for (const [index, head] of heads.entries()) {
    if (head[1] !== 'section') continue
    out.set(head[2], html.slice(head.index, heads[index + 1]?.index ?? html.length))
  }
  return out
}

function heading(block: string): string {
  const match = /id="shortdescription"[^>]*>([\s\S]*?)<\/span>/.exec(block)
  return match === null ? '' : decode(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/** The note a section served twice opens on: "Note: This version of section effective until 1-1-2027. …". */
function note(block: string): string {
  return /Note: This version of section[^<]*/.exec(block.replace(/\s+/g, ' '))?.[0] ?? ''
}

/** A future copy: "effective 1-1-2027" without "until". */
const isFuture = (block: string) => /^Note: This version of section effective (?!until)/.test(note(block))

const site: Site = {
  official: ORIGIN,
  name: 'the Indiana Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const year = await codeYear()
    const listings: Listing[] = []
    for (const title of [...new Set(TITLES.map((each) => each.title))]) {
      const url = `${ORIGIN}ic/${year}/Title_${title}.html`
      for (const [id, block] of blocks(await titleFile(url))) {
        const part = TITLES.find((each) => each.title === title && inPrefix(id, each.prefix))
        if (part === undefined || (part.skip ?? []).some((prefix) => inPrefix(id, prefix))) continue
        const catchline = heading(block)
        if (/^(repealed|expired)\b/i.test(catchline) || isFuture(block)) continue
        listings.push({
          file: `ic-${id}`,
          url: `${url}#${id}`,
          section: id,
          cite: `Ind. Code § ${id.replace(/-b$/, '')}`,
          heading: catchline,
        })
      }
    }
    return listings
  },
  read: (listing) => titleFile(listing.url),
  extract: (html, listing) => extractIga(html, listing.url.split('#')[1] ?? listing.section),
}

export default site

/**
 * One section of a title file, in effect, as lines: each paragraph one line,
 * its wraps folded; a table row one line of its cells. Dropped: the heading
 * (the section number and catchline, which the listing carries), the "Sec. 5."
 * that opens the law (its number again, and it would hide the "(a)" after it
 * from the chunker), the version note, the pre-recodification citations and
 * the session-law history -- italic and bracketed paragraphs that are notes,
 * not law.
 */
export function extractIga(html: string, id: string): string {
  if (parsed?.html !== html) parsed = { html, blocks: blocks(html) }
  const block = parsed.blocks.get(id)
  if (block === undefined) throw new Unavailable(`no section ${id} in the title file`)
  return extractBlock(block, id)
}

/** The last title file split into sections: the fetch extracts each of its sections from the same 6 MB string in turn. */
let parsed: { html: string; blocks: Map<string, string> } | undefined

function extractBlock(block: string, id: string): string {
  if (isFuture(block)) throw new Error(`${id} is a future version: ${note(block)}`)
  const body = block
    .replace(/^[\s\S]*?<div style="clear: both;"><\/div><\/div>/, '')
    .replace(/<div class="derivation"[\s\S]*?<div style="clear: both;"><\/div><\/div>/g, '')
    .replace(/<p class="derivation"[\s\S]*?<\/p>/g, '')
  const lines: string[] = []
  for (const [, tag, inner] of body.matchAll(/<(p|tr)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (tag === 'p' && /^\s*<span[^>]*>\s*<i>[\s\S]*<\/i>\s*<\/span>\s*$/.test(inner)) continue
    const cells = tag === 'tr' ? [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => textOf(cell[1])) : [textOf(inner)]
    const line = cells.filter((cell) => cell.length > 0).join(' ')
    if (line.length > 0) lines.push(line)
  }
  const text = lines
  if (text.length === 0) throw new Unavailable(`${id} has no text in the title file`)
  text[0] = text[0].replace(/^Sec\. [0-9.]+\.\s*/, '')
  if (text[0].length === 0) text.shift()
  return text.join('\n') + '\n'
}

function textOf(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ')
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
