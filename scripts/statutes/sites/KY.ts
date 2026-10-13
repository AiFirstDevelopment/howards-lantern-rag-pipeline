/**
 * Kentucky: the Kentucky Revised Statutes as the Legislative Research
 * Commission publishes them for the General Assembly (apps.legislature.ky.gov),
 * one PDF per section. An index-page `enumerate`, as Maryland's: a chapter's
 * page lists every section with its catchline and the address of its PDF, and
 * fetch.ts reads the PDF through `pdftotext -layout` from a temp file.
 *
 * Where an amendment takes effect later, the Commission publishes the section
 * twice under two addresses, its catchline ending "(Effective until January 1,
 * 2027)" on the one and "(Effective January 1, 2027)" on the other, and a new
 * section not yet in force carries only the second. `enumerate` keeps the
 * version in effect on the day it runs and drops the other, so a quote is never
 * the law of 2027 presented as the law today. Each PDF carries one version; what
 * follows the law on it -- "Effective:", the history, the Commission's notes --
 * is not law, and `extract` stops at the first of them.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://apps.legislature.ky.gov/law/statutes/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title XVI, Motor
 * Vehicles, and why: chapter 188 is service of process on non-resident
 * motorists in civil suits, 190 and 190A license and regulate dealers,
 * manufacturers and recyclers; out of other titles, 281 regulates motor
 * carriers and 174 to 184 the Transportation Cabinet, highways, bridges and
 * aviation, and 281A is commercial driver licensing: it binds CDL holders, and
 * its permit and alcohol rules crowd out the ordinary ones. Of the Motor Vehicle Reparations Act (KRS Chapter 304, Subtitle
 * 39), the benefits, claims, assigned-claims plan, arbitration and insurers'
 * reporting are out: they bind insurers, not drivers.
 */
const TITLES: {
  chapter: string
  /** The chapter's page: chapter.aspx?id=<page>. */
  page: string
  id: string
  name: string
  why: string
  /** Which of the chapter's sections are in, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  { chapter: '186', page: '38025', id: 'krs186', name: 'Chapter 186: Licensing of Motor Vehicles, Operators, and Trailers', why: 'registration and plates, the operator\'s licence, the instruction permit and the graduated licence and its limits, points and suspension' },
  { chapter: '186A', page: '38033', id: 'krs186a', name: 'Chapter 186A: Automated Motor Vehicle Registration System', why: 'the title and registration every owner must hold, and the proof of insurance registration requires' },
  { chapter: '187', page: '38036', id: 'krs187', name: 'Chapter 187: Financial Responsibility Law', why: 'the security a crash requires, proof of financial responsibility and the suspension for lacking it' },
  { chapter: '189', page: '38038', id: 'krs189', name: 'Chapter 189: Traffic Regulations -- Vehicle Equipment and Storage', why: 'the rules of the road, speed, parking, school buses, seat belts and child restraints, equipment, duties after a crash and the penalties' },
  { chapter: '189A', page: '38043', id: 'krs189a', name: 'Chapter 189A: Driving Under the Influence', why: 'impaired driving, the under-21 limit, implied consent and testing, licence suspension and the ignition interlock' },
  {
    chapter: '304',
    page: '38757',
    id: 'krs304-39',
    name: 'Chapter 304, Subtitle 39: Motor Vehicle Reparations Act (in part)',
    why: 'the insurance every vehicle must carry, its minimum limits, the insurance card and the choice to keep the right to sue',
    keep: (section) => ['304.39-010', '304.39-020', '304.39-060', '304.39-080', '304.39-090', '304.39-100', '304.39-110', '304.39-117'].includes(section),
  },
  {
    chapter: '244',
    page: '38405',
    id: 'krs244',
    name: 'Chapter 244, Section 244.085: Minors not to possess or purchase liquor',
    why: "a minor's possession or purchase of alcohol and use of false identification, codified in the alcoholic beverage control law",
    keep: (section) => section === '244.085',
  },
]

/** The state's own citation form: "KRS 189.450". Kentucky writes no section sign. */
export function cite(section: string): string {
  return `KRS ${section}`
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`apps.legislature.ky.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** A chapter page's sections: `<a class="statute" href="statute.aspx?id=46536">.450  Stopping, standing, … highway. </a>`. */
export function sectionsListed(html: string): { suffix: string; id: string; heading: string }[] {
  return [...html.matchAll(/<a class="statute" href="statute\.aspx\?id=(\d+)">\s*(\.[\dA-Za-z-]+)\s+([\s\S]*?)\s*<\/a>/g)].map(([, id, suffix, heading]) => ({
    id,
    suffix,
    heading: inline(heading),
  }))
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function isoDate(text: string): string {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim())
  const month = match === null ? -1 : MONTHS.indexOf(match[1].toLowerCase())
  if (match === null || month < 0) throw new Error(`an effective date this module cannot read: "${text}"`)
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/**
 * Whether a catchline's version is in effect on `today`: "(Effective until D)"
 * while D is still ahead, "(Effective D)" once D has come, any other always.
 */
export function inEffect(heading: string, today: string): boolean {
  const until = /\(Effective until ([^)]+)\)\s*$/.exec(heading)
  if (until !== null) return today < isoDate(until[1])
  const from = /\(Effective ([^)]+)\)\s*$/.exec(heading)
  if (from !== null) return isoDate(from[1]) <= today
  return true
}

const site: Site = {
  // The Legislative Research Commission publishes the Kentucky Revised Statutes for the General Assembly.
  official: ORIGIN,
  name: 'the Kentucky Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const today = new Date().toISOString().slice(0, 10)
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const { suffix, id, heading } of sectionsListed(await page(`${ORIGIN}chapter.aspx?id=${title.page}`))) {
        const section = `${title.chapter}${suffix}`
        if (title.keep !== undefined && !title.keep(section)) continue
        // A repealed or renumbered section keeps its number and a catchline saying so, and nothing else.
        if (heading === '' || /^(repealed|renumbered|recodified|reserved|transferred|expired)\b/i.test(heading)) continue
        if (!inEffect(heading, today)) continue
        listings.push({
          file: `${title.id}-${section}`,
          url: `${ORIGIN}statute.aspx?id=${id}`,
          section,
          cite: cite(section),
          heading: heading.replace(/\s*\(Effective [^)]+\)\s*$/, '').replace(/\.$/, ''),
        })
      }
      // A chapter page read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the page for chapter ${title.chapter} lists nothing kept`)
      await pause()
    }
    const seen = new Set<string>()
    for (const listing of listings) {
      // Two versions of one section both kept would be two laws under one citation.
      if (seen.has(listing.section)) throw new Error(`KRS ${listing.section} is listed twice in effect`)
      seen.add(listing.section)
    }
    return listings
  },
  extract: (text, listing) => extractKrsPdf(text, listing.section),
}

export default site

/** Where the law ends: the PDF's "Effective:" line, the history, the catchline a repealed section had, and the Commission's notes. */
const APPARATUS = /^\s*(Effective:|History:|Catchline at repeal:|Legislative Research Commission Note)/

/**
 * A label opening a paragraph: "(1)", "(a)", "1.", "a.", "ii." -- followed by
 * the paragraph's first word. One letter or a roman numeral, not any short
 * word: § 186.010 wraps "…a truck\ncab. Only for purposes of registration",
 * and "cab." read as a label cut the definition in two.
 */
const LABEL = /^(\(\w{1,4}\)|(?:\d{1,3}|[a-z]|[ivx]{2,4}|[A-Z])\.)\s+(\S)/

/**
 * The end of a line a parenthesised figure continues: Kentucky writes "two (2)
 * or more" and "twenty-four (24) hours", and a line wrapped before "(2)" is not
 * a second paragraph -- § 189.010(10) wraps exactly so.
 */
const NUMBER_WORD = /\b(?:[a-z]+-)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)$/i

/**
 * One section's text as `pdftotext -layout` reads its PDF: the heading (the
 * section number, its catchline and any "(Effective …)" note, wrapped over
 * indented lines) is dropped -- the listing carries the catchline -- and the
 * law is one line per paragraph. A paragraph opens on a label, or, in a
 * section without labels, on an indented line after a sentence; every other
 * line is a wrap and is folded back into the paragraph it continues.
 */
export function extractKrsPdf(text: string, section: string): string {
  const raw = text.replace(/\f/g, '\n').split('\n').filter((line) => line.trim() !== '')
  const head = raw.findIndex((line) => line.trim() !== '')
  const escaped = section.replace(/[.-]/g, (char) => `\\${char}`)
  if (head < 0 || !new RegExp(`^\\s*${escaped}\\s`).test(raw[head])) throw new Error(`the PDF does not open on KRS ${section}`)
  // A second heading -- the number then a capitalised catchline -- is a second
  // version; the number at the margin of a Commission note ("186.450 on or
  // after October 1, 2006.") is a wrap in prose, and is not.
  const starts = raw.filter((line) => new RegExp(`^${escaped}\\s+[A-Z]`).test(line)).length
  if (starts > 1) throw new Error(`KRS ${section} is served ${starts} times in one PDF`)
  // The heading runs until its catchline ends on a period, the "(Effective …)" note aside.
  let index = head
  const ends = (line: string) => /\.\s*$/.test(line.replace(/\s*\(Effective [^)]*\)\s*$/, ''))
  while (!ends(raw[index]) && index + 1 < raw.length && /^\s+\S/.test(raw[index + 1]) && !APPARATUS.test(raw[index + 1]) && index - head < 6) index += 1
  if (/^\s*\S+\s+(Repealed|Renumbered)\b/.test(raw[head])) throw new Unavailable('the Statutes keep only a repealed marker')
  // A long catchline pushes its "(Effective until January 1, 2027)" note onto a
  // line of its own after the period (§§ 186.040, 186.077, 186.162); it is the
  // heading's, not the law's first paragraph.
  if (index + 1 < raw.length && /^\s*\(Effective [^)]*\)\s*$/.test(raw[index + 1])) index += 1

  const paragraphs: { text: string; labelled: boolean }[] = []
  for (const line of raw.slice(index + 1)) {
    if (APPARATUS.test(line)) break
    const trimmed = line.trim()
    const previous = paragraphs.at(-1)
    const label = LABEL.exec(trimmed)
    const opens =
      previous === undefined ||
      (label !== null && /^[A-Z"“'‘(\d$]/.test(label[2]) && !NUMBER_WORD.test(previous.text)) ||
      (label === null && !previous.labelled && /^\s{3,}\S/.test(line) && /[.:;]["”]?$/.test(previous.text))
    if (opens) paragraphs.push({ text: trimmed, labelled: label !== null })
    else previous!.text += ` ${trimmed}`
  }
  const lines = paragraphs.map((paragraph) => paragraph.text.replace(/[\s ]+/g, ' ').trim())
  if (lines.length === 0) throw new Error(`KRS ${section} came back with no text`)
  // KRS 186.260 is one sentence, "… a violation of any of the provisions of
  // KRS 186.020 to 186.260.": the chunker reads a short first line naming the
  // section as its heading and keeps nothing, so it would be committed as a
  // law with no body. Such a section is a cross-reference or a short title,
  // never a rule; it is reported rather than committed.
  if (lines.length === 1 && lines[0].length <= 160 && lines[0].replace(/[–—‑]/g, '-').includes(section)) {
    throw new Unavailable('its one sentence names its own number: a cross-reference or short title the chunker reads as a heading')
  }
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
