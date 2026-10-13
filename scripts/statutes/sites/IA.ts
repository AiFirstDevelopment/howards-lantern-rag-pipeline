/**
 * Iowa: the Iowa Code as the Legislative Services Agency publishes it on the
 * General Assembly's site (legis.iowa.gov), one PDF per section. An index-page
 * `enumerate`, as Maryland's: a chapter's "sections" page lists each section
 * with its catchline and the address of its PDF, which `read` turns into text
 * with `pdftotext -layout` (see `readPdf` for why not fetch.ts's own path).
 *
 * The edition is the Iowa Code 2026, the current one the Legislature serves:
 * an Iowa section is published once, as amended through the session before
 * the edition, so there is no future copy on the page to drop. What follows
 * the law on the page -- the bracketed history, the session-law list, "Referred
 * to in", cross references and the editor's notes on what was amended -- is
 * not law, and `extract` stops at the first of them.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.legis.iowa.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const YEAR = '2026'

/**
 * The chapters a licence-holder is bound by. Out of chapter 321, and why:
 * 321.2 to 321.16 but for 321.5 are the department's administration, forms,
 * seal and records; 321.57 to 321.70 are dealers' and transporters' special
 * plates and records; 321.145 to 321.172 are the county treasurers' and the
 * department's accounting, price schedules and the manufacture of plates;
 * 321.449, 321.449A and 321.450 are the federal motor-carrier and hazardous
 * materials rules; 321.476 to 321.481 organise the department's own
 * enforcement officers; 321.498 to 321.512 are service of process on
 * non-resident owners in civil suits; 321.514 to 321.519 regulate driverless
 * vehicle networks. Out of the other chapters of Title VIII, Subtitle 2: 321B
 * glass repair insurance, 321D the equipment compact between agencies, 321E
 * oversize permits for carriers, 321F rental companies, 321G and 321I
 * snowmobiles and all-terrain vehicles off the highway (321.234A already says
 * when an ATV may use one), 321H recyclers, 321K roadblocks, 321M the counties'
 * issuing of licences, 321N ride-hailing companies, 321O delivery robots and
 * 321P the cities' camera programs; and 322 onward, dealers, fuel and carriers.
 */
const TITLES: {
  chapter: string
  id: string
  name: string
  why: string
  /** Which of the chapter's sections are in, by number after the chapter, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  {
    chapter: '321',
    id: 'ia321',
    name: 'Chapter 321: Motor Vehicles and Law of the Road',
    why: 'the definitions, registration and title, driver licensing including the instruction permit and graduated licence, crashes, the rules of the road, equipment, seat belts and child restraints, phones, school buses and the penalties',
    keep: (section) => {
      const n = Number(section.replace(/[A-Z]+$/, ''))
      const letter = /[A-Z]+$/.exec(section)?.[0] ?? ''
      if (n >= 2 && n <= 16 && !(n === 5 && letter === '')) return false
      if (n >= 57 && n <= 70) return false
      if (n >= 145 && n <= 172) return false
      if (n === 449 && letter !== 'B') return false
      if (n === 450) return false
      if (n >= 476 && n <= 481) return false
      if (n >= 498 && n <= 512) return false
      if (n >= 514 && n <= 519) return false
      return true
    },
  },
  { chapter: '321A', id: 'ia321a', name: 'Chapter 321A: Motor Vehicle Financial Responsibility', why: 'the security a crash requires, the minimum liability limits and the suspension for lacking proof' },
  { chapter: '321C', id: 'ia321c', name: 'Chapter 321C: Interstate Drivers License Compacts', why: 'how a conviction in another state counts against an Iowa licence' },
  { chapter: '321J', id: 'ia321j', name: 'Chapter 321J: Operating While Intoxicated', why: 'impaired driving, the under-21 limit, implied consent and testing, revocation and the ignition interlock' },
  { chapter: '321L', id: 'ia321l', name: 'Chapter 321L: Parking for Persons with Disabilities', why: 'who may park in a disabled space, the permit and the penalty for misuse' },
  {
    chapter: '805',
    id: 'ia805',
    name: 'Chapter 805, Section 805.8A: Scheduled violations — motor vehicles',
    why: 'the scheduled fine for each traffic violation in chapter 321, codified in the criminal procedure title',
    keep: (section) => section === '8A',
  },
  {
    chapter: '707',
    id: 'ia707',
    name: 'Chapter 707, Section 707.6A: Homicide or serious injury by vehicle',
    why: 'the crimes of killing or seriously injuring someone while driving impaired or recklessly, codified in the criminal code',
    keep: (section) => section === '6A',
  },
  {
    chapter: '123',
    id: 'ia123',
    name: 'Chapter 123, Section 123.47: Persons under legal age',
    why: 'underage possession of alcohol and the licence suspension for it, codified in the alcoholic beverage control act',
    keep: (section) => section === '47',
  },
]

/** The state's own citation form: "Iowa Code § 321.285". */
export function cite(section: string): string {
  return `Iowa Code § ${section}`
}

export function sectionUrl(section: string): string {
  return `${ORIGIN}docs/code/${YEAR}/${section}.pdf`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`legis.iowa.gov answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * The sections a chapter's page lists: "<td>&#167;321.285 - Speed restrictions.</td>"
 * beside its PDF. A repealed section is listed by number alone, with no catchline.
 */
export function sectionsListed(html: string): { section: string; heading: string }[] {
  return [...html.matchAll(/<td>\s*&#167;\s*([\dA-Z]+\.[\dA-Z]+)\s*(?:-\s*([\s\S]*?))?\s*<\/td>/g)].map(([, section, heading]) => ({
    section,
    heading: inline(heading ?? '').replace(/\.$/, ''),
  }))
}

const site: Site = {
  // The Iowa Code as the Legislative Services Agency publishes it for the General Assembly.
  official: ORIGIN,
  name: 'the Iowa Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const { section, heading } of sectionsListed(await page(`${ORIGIN}law/iowaCode/sections?codeChapter=${title.chapter}&year=${YEAR}`))) {
        const [chapter, number] = section.split('.')
        if (chapter !== title.chapter) continue
        if (title.keep !== undefined && !title.keep(number)) continue
        // Listed with no catchline: the Code keeps the number of a repealed section and nothing else.
        if (heading === '' || /^(repealed|reserved|transferred)\b/i.test(heading)) continue
        listings.push({ file: `${title.id}-${section}`, url: sectionUrl(section), section, cite: cite(section), heading })
      }
      // A chapter page read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the sections page for chapter ${title.chapter} lists nothing kept`)
      await pause()
    }
    return listings
  },
  read: (listing) => readPdf(listing.url),
  extract: (body, listing) => extractIowaPdf(body, listing.section),
}

/**
 * A section's PDF as `pdftotext -layout` reads it, from a file rather than a
 * pipe. fetch.ts hands a PDF to `pdftotext -` on stdin, and here that pipe was
 * never closed one time in ten or twenty: pdftotext sat in fread on stdin and
 * the run hung for good at a different section each time (321.38, 321.39,
 * 321.50), three runs in a row. Read from a file it cannot wait on anything.
 */
async function readPdf(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const dir = mkdtempSync(path.join(tmpdir(), 'ia-code-'))
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`legis.iowa.gov answered ${response.status} for ${url}`)
      const file = path.join(dir, 'section.pdf')
      writeFileSync(file, Buffer.from(await response.arrayBuffer()))
      return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', timeout: 60_000 })
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export default site

/** The page furniture `pdftotext -layout` keeps: "1   MOTOR VEHICLES …, §321.285", "§321.285, MOTOR … 2", the dated footer. */
const FURNITURE = [/^\s*\d+\s{2,}.*,\s*§\s*[\dA-Z.]+\s*$/, /^\s*§\s*[\dA-Z.]+,\s.*\s{2,}\d+\s*$/, /Iowa Code \d{4}, (Section|Chapter) [\dA-Z.]+ \(\d+, \d+\)\s*$/]

/**
 * Where the law ends and the page's apparatus begins: the history in brackets
 * ("[C24, 27, …, §321.285]", "[S13, §1571-m19]"), the session laws of a section
 * newer than the 1981 Code ("98 Acts, ch 1112, §5"), and the notes after them.
 */
const APPARATUS = /^(\[(?:S\d|C\d|R\d|SS|CS|Rev|82 Acts|8\d Acts)|\d{2,4} Acts, (?:ch|\d)|Referred to in\b|Repealed by\b)/

/**
 * One section's text: its "321.285 Speed restrictions." line, then a line per
 * paragraph as the Code sets it -- a paragraph opens indented, and its
 * wrapped lines start at the margin, so they are folded back into it.
 */
export function extractIowaPdf(text: string, section: string): string {
  const raw = text.replace(/\f/g, '\n').split('\n')
  const paragraphs: string[] = []
  for (const line of raw) {
    if (line.trim() === '' || FURNITURE.some((pattern) => pattern.test(line))) continue
    if (/^\s/.test(line) || paragraphs.length === 0) paragraphs.push(line.trim())
    else paragraphs[paragraphs.length - 1] += ` ${line.trim()}`
  }
  const lines = paragraphs.map((paragraph) => paragraph.replace(/[\s ]+/g, ' ').trim())
  const escaped = section.replace(/\./g, '\\.')
  const starts = lines.flatMap((line, index) => (new RegExp(`^${escaped}\\s`).test(line) ? [index] : []))
  if (starts.length === 0) throw new Error(`the PDF does not carry § ${section}`)
  if (starts.length > 1) throw new Error(`§ ${section} is served ${starts.length} times in one PDF`)
  const out: string[] = []
  for (let index = starts[0]; index < lines.length; index += 1) {
    if (index > starts[0] && APPARATUS.test(lines[index])) break
    out.push(lines[index])
  }
  if (out.length < 2) {
    if (/\b(repealed|reserved|transferred)\b/i.test(out[0] ?? '')) throw new Unavailable('the Code keeps only a repealed marker')
    throw new Error(`§ ${section} came back with no text`)
  }
  return out.join('\n') + '\n'
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
