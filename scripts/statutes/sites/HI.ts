/**
 * Hawaii: the Hawaii Revised Statutes as the Legislature publishes them,
 * one section per page, under data.capitol.hawaii.gov/hrscurrent. An
 * index-page `enumerate`, as Maryland's: each chapter's folder is served as a
 * directory listing of its section files, and the chapter's contents page
 * (`HRS_0291C-.htm`) gives each section's catchline.
 *
 * The same pages are linked from www.capitol.hawaii.gov, but that host answers
 * any script -- whatever its User-Agent -- with Cloudflare's "Sorry, you have
 * been blocked"; data.capitol.hawaii.gov is the Legislature's own host for the
 * same files and serves them to a script.
 *
 * A page carries more than the law: a part heading or revision note above the
 * section, and after it the session-law history in brackets and the editors'
 * notes, case notes and cross references. `extract` keeps the section alone.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://data.capitol.hawaii.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const VOL05 = 'hrscurrent/Vol05_Ch0261-0319'

/**
 * The chapters a licence-holder is bound by. Out, and why: from chapter 286,
 * the governor's and councils' powers in part I, the department's motor
 * vehicle regulation (IA), driver training schools (V), traffic records
 * (VIII), pupil transportation operators (IX), motor carriers and hazardous
 * materials (XI, XII), the commercial licence (XIII, as Maryland and Florida
 * leave theirs out), interisland shipping (XV) and civil identification cards
 * (XVI); 286A is repealed; 286G is the driver-education fund; 288 insures
 * common carriers; 289 licenses used-parts dealers; 290 is what a county does
 * with an abandoned vehicle; 291A is the compact between states' agencies on
 * non-resident citations; 291J and 291L are the counties' red-light and speed
 * camera programs; 249 is the counties' vehicle tax. Of chapter 431 only the
 * Motor Vehicle Insurance Law's parts on what must be carried; of 281 and 707
 * only the sections a driver is held to.
 */
const TITLES: {
  dir: string
  chapter: string
  id: string
  name: string
  why: string
  /** Which sections are in, by number after the chapter, where not all of them are. */
  keep?: (section: number) => boolean
}[] = [
  {
    dir: `${VOL05}/HRS0286`,
    chapter: '0286',
    id: 'hrs-286',
    name: 'HRS Chapter 286, Parts I-IV and VI: Highway Safety (definitions, inspection, registration, safety equipment, driver licensing)',
    why: "the definitions, safety inspection, registration and plates, helmets and safety equipment, and driver licensing including the instruction permit and provisional licence",
    // 286-108.4 has the department set up a driver-education program: its organisation, not a rule a driver is held to.
    keep: (n) => n === 1 || n === 2 || n === 10 || n === 12 || (n >= 21 && n < 91) || (n >= 101 && n < 151 && n !== 108.4),
  },
  { dir: `${VOL05}/HRS0286C`, chapter: '0286C', id: 'hrs-286c', name: 'HRS Chapter 286C: Driver License Compact', why: 'how a conviction in another state counts against a Hawaii licence' },
  { dir: `${VOL05}/HRS0287`, chapter: '0287', id: 'hrs-287', name: 'HRS Chapter 287: Motor Vehicle Safety Responsibility Act', why: 'financial responsibility after a crash and the suspension for lacking it' },
  { dir: `${VOL05}/HRS0291`, chapter: '0291', id: 'hrs-291', name: 'HRS Chapter 291: Traffic Violations', why: 'reckless driving, open containers, seat belts and child restraints, inattention, lights and equipment, and disabled parking' },
  { dir: `${VOL05}/HRS0291C`, chapter: '0291C', id: 'hrs-291c', name: 'HRS Chapter 291C: Statewide Traffic Code', why: 'definitions and the rules of the road: collisions, signals, right of way, pedestrians, turning, school buses, speed, parking, phones, bicycles, motorcycles and mopeds, and the penalties' },
  { dir: `${VOL05}/HRS0291D`, chapter: '0291D', id: 'hrs-291d', name: 'HRS Chapter 291D: Adjudication of Traffic Infractions', why: 'how a traffic citation is answered, contested and paid, and what follows from not answering it' },
  { dir: `${VOL05}/HRS0291E`, chapter: '0291E', id: 'hrs-291e', name: 'HRS Chapter 291E: Use of Intoxicants While Operating a Vehicle', why: 'impaired driving, the under-21 limit, implied consent and testing, and administrative revocation' },
  {
    dir: 'hrscurrent/Vol09_Ch0431-0435H/HRS0431',
    chapter: '0431-0010C',
    id: 'hrs-431-10c',
    name: 'HRS Chapter 431, Article 10C, Parts I-III: Motor Vehicle Insurance',
    why: 'the insurance every vehicle must carry, its minimum coverage and the penalty for driving without it, codified in the insurance code',
    keep: (n) => n >= 101 && n < 400,
  },
  {
    dir: `${VOL05}/HRS0281`,
    chapter: '0281',
    id: 'hrs-281',
    name: 'HRS Chapter 281, Section 281-101.5: Prohibitions involving minors',
    why: 'underage possession and consumption of alcohol and the licence suspension for it, codified in the liquor law',
    keep: (n) => n === 101.5,
  },
  {
    dir: 'hrscurrent/Vol14_Ch0701-0853/HRS0707',
    chapter: '0707',
    id: 'hrs-707',
    name: 'HRS Chapter 707, Sections 707-702.5 to 707-706: Negligent homicide and negligent injury',
    why: 'the crimes of killing or injuring someone by driving a vehicle negligently, codified in the penal code',
    keep: (n) => n >= 702.5 && n <= 706,
  },
]

/** The state's own citation form: "Haw. Rev. Stat. § 291C-62". */
export function cite(section: string): string {
  return `Haw. Rev. Stat. § ${section}`
}

/** "HRS_0291C-0012_0005" -> "291C-12.5"; "HRS_0431-0010C-0104" -> "431:10C-104". */
export function sectionOf(file: string): { section: string; number: number } | null {
  const match = /^HRS_(\d{4}[A-Z]?)-(?:(\d{4}[A-Z]?)-)?(\d{4})(?:_(\d{4}))?$/.exec(file)
  if (match === null) return null
  const [, chapter, article, whole, part] = match
  const strip = (text: string) => text.replace(/^0+(?=\d)/, '')
  const number = strip(whole) + (part === undefined ? '' : `.${strip(part)}`)
  const head = strip(chapter) + (article === undefined ? '' : `:${strip(article)}`)
  return { section: `${head}-${number}`, number: Number(number) }
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`data.capitol.hawaii.gov answered ${response.status} for ${url}`)
  return decoded(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** The text of a paragraph, its wraps folded to single spaces. */
function textOf(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ')
    .trim()
}

/**
 * Each section's catchline from the chapter's contents page, by section
 * number. An entry wraps over several paragraphs; a continuation is a
 * paragraph that opens on neither a number nor a part heading.
 */
export function catchlines(html: string): Map<string, string> {
  const out = new Map<string, string>()
  let last: string | null = null
  for (const [, inner] of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = textOf(inner)
    const entry = /^\[?(\d+[A-Z]?(?::\d+[A-Z]?)?-\d+(?:\.\d+)?)\]?\s+(.+)$/.exec(text)
    if (entry !== null) {
      last = entry[1]
      out.set(last, entry[2])
    } else if (last !== null && text !== '' && !/^(Part|Article|Section|Subpart|Note|Revision|Cross|CHAPTER)\b/i.test(text)) {
      out.set(last, `${out.get(last)} ${text}`)
    } else {
      last = null
    }
  }
  return out
}

const site: Site = {
  // The Hawaii State Legislature publishes the Hawaii Revised Statutes; this is its data host.
  official: ORIGIN,
  name: 'the Hawaii Revised Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const tocChapter = title.chapter.split('-')[0]
      const headings = catchlines(await page(`${ORIGIN}${title.dir}/HRS_${tocChapter}-.htm`))
      await pause()
      const directory = await page(`${ORIGIN}${title.dir}/`)
      await pause()
      const files = [...new Set([...directory.matchAll(/HREF="[^"]*\/(HRS_[^"/]+)\.htm"/gi)].map((match) => match[1]))]
      for (const name of files) {
        if (!name.startsWith(`HRS_${title.chapter}-`)) continue
        const parsed = sectionOf(name)
        if (parsed === null) continue
        if (title.keep !== undefined && !title.keep(parsed.number)) continue
        const heading = (headings.get(parsed.section) ?? '').replace(/\.$/, '')
        // A section the contents marks repealed or renumbered -- alone, or as "291-4 to 4.5 Repealed" -- is a pointer, not a rule.
        if (/^(to [\d.]+ )?\[?(repealed|renumbered|reserved)\b/i.test(heading)) continue
        listings.push({
          file: `${title.id}-${parsed.section.split('-').at(-1)}`,
          url: `${ORIGIN}${title.dir}/${name}.htm`,
          section: parsed.section,
          cite: cite(parsed.section),
          heading,
        })
      }
    }
    return listings
  },
  extract: (body, listing) => extractHrs(body, listing.section),
}

export default site

const plain = (text: string) => text.replace(/[‐‑–—]/g, '-')

/** Whether a paragraph opens a section -- "§291C-62", "[§291C-7]" -- and which. */
function opensSection(text: string): string | null {
  const match = /^\[?§\s*(\d+[A-Z]?(?::\d+[A-Z]?)?[-‐‑]\d+(?:\.\d+)?)\b/.exec(text)
  return match === null ? null : plain(match[1])
}

/** The session-law history closing a section: "[L 1971, c 150, pt of §1; am L 1977, c 180, §2]". */
const HISTORY = /\s*\[(?:L|PC|RL|CC|Gen|am|Am|R|en)\b[^[\]]*\]\s*$/

/**
 * A paragraph's opening catchline -- the bold "§291C-62 Vehicle turning." --
 * and what follows it, so the catchline is a line of its own: the chunker
 * drops a line naming the section as its heading, and would otherwise file
 * the catchline as the first words of subsection (a).
 */
function splitCatchline(html: string): [string, string] {
  let heading = ''
  let bold = 0
  let index = 0
  const tokens = [...html.matchAll(/<[^>]+>|[^<]+/g)].map((match) => match[0])
  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (/^<b\b/i.test(token)) bold += 1
    else if (/^<\/b>/i.test(token)) bold = Math.max(0, bold - 1)
    else if (token.startsWith('<')) continue
    // "<b>§286</b>-<b>47  Certificate…</b>": the hyphen of the number set outside the bold.
    else if (bold > 0 || /^[\s\[\]\-‐‑]*$/.test(decode(token).replace(/ /g, ' '))) heading += token
    else {
      // "…exempt from license</b>.  The following…": the catchline's own full stop set outside the bold.
      const stop = /^[.:]+(?=\s|$)/.exec(token)
      if (stop !== null) tokens[index] = token.slice(stop[0].length)
      heading += stop?.[0] ?? ''
      break
    }
  }
  return [textOf(heading), textOf(tokens.slice(index).join(''))]
}

/**
 * The text of one section in effect: its catchline on a line of its own, then
 * each paragraph of the law on its own line, with the page's part headings and
 * revision notes above it, its bracketed history, and the notes after it all
 * dropped. A page serving the section twice -- the version in effect and one
 * that takes effect later -- keeps the version marked as in effect until the
 * change, and refuses to guess where neither is.
 */
export function extractHrs(html: string, section: string): string {
  if (/<title>\s*404\b/i.test(html)) throw new Unavailable('the Legislature serves "404 - File or directory not found"')
  const start = html.search(/<div class="?WordSection1/i)
  if (start < 0) throw new Error('no WordSection1 block on the page')
  const end = html.indexOf("<div id='pageLinks'>", start)
  const paragraphs = [...html.slice(start, end < 0 ? undefined : end).matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)].map(
    ([, attributes, inner]) => ({ notes: /class="?XNotes/i.test(attributes), inner, text: textOf(inner) }),
  )
  const wanted = plain(section)
  const versions: number[] = []
  for (const [index, paragraph] of paragraphs.entries()) if (opensSection(paragraph.text) === wanted) versions.push(index)
  if (versions.length === 0) {
    // "§§291-4 to 291-4.5 REPEALED.": a range the Legislature serves under its first number.
    if (paragraphs.some((paragraph) => /^\[?§§.*\b(repealed|renumbered|reserved)\b/i.test(paragraph.text))) throw new Unavailable('the page is a repealed range')
    throw new Error(`the page does not carry § ${section}`)
  }

  const versionAt = (from: number) => {
    const lines: string[] = []
    for (let index = from; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      // The opening paragraph itself is sometimes styled as a note (291C-106); only what follows it is the notes.
      if (paragraph.notes && index > from) break
      if (index > from && opensSection(paragraph.text) !== null) break
      if (paragraph.text === '') continue
      if (index === from) {
        const [heading, rest] = splitCatchline(paragraph.inner)
        const number = /^\[?§\s*\S+?\]?(?=\s|$)/.exec(heading)?.[0] ?? heading
        const catchline = heading.slice(number.length).trim()
        // "§291C-58 REPEALED. L 2003, c 1, §2.": the marker is the body, so the fetch files it as repealed.
        if (/^\[?(repealed|reserved|renumbered)\b/i.test(catchline)) lines.push(number, `${catchline} ${rest}`.trim())
        else lines.push(heading, ...(rest === '' ? [] : [rest]))
      } else {
        lines.push(paragraph.text)
      }
      if (HISTORY.test(paragraph.text)) break
    }
    const last = lines.length - 1
    if (lines.length > 1 && HISTORY.test(lines[last])) {
      const kept = lines[last].replace(HISTORY, '').trim()
      if (kept === '') lines.pop()
      else lines[last] = kept
    }
    return lines
  }

  // "§291-2 [OLD] REPEALED. L 1971, c 150, §3." heads the page of the section
  // that now carries its number: an earlier law repealed long ago, not a version.
  const current = versions.filter((index) => !/^\[?§\s*\S+\s+\[OLD\]/.test(paragraphs[index].text))
  if (current.length === 0) throw new Unavailable(`the page carries only the [OLD] § ${section}, repealed`)
  let chosen = current[0]
  if (current.length > 1) {
    // Each copy says when it applies: "[Section effective until June 30, 2021. …]"
    // or "[Section effective July 1, 2021. …]". The one whose window holds
    // today is the law; 291-55's first copy expired in 2021, so "the copy
    // marked until" would have committed a repealed text.
    const today = new Date().toISOString().slice(0, 10)
    const inEffect = current.filter((index) => windowHolds(paragraphs[index].text, today))
    if (inEffect.length !== 1) throw new Error(`§ ${section} is served ${current.length} times and ${inEffect.length} are in effect today`)
    chosen = inEffect[0]
  }
  const lines = versionAt(chosen)
  if (lines.length < 2 && !/repealed|reserved|renumbered/i.test(lines.join(' '))) throw new Error(`§ ${section} came back with no text`)
  return lines.join('\n') + '\n'
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "June 30, 2021" as "2021-06-30". */
function isoDate(text: string): string {
  const [, month, day, year] = /([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(text)!
  return `${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** Whether a copy's "[Section effective …]" note puts `today` (ISO) inside its window. */
function windowHolds(text: string, today: string): boolean {
  const until = /\[Section effective until ([A-Za-z]+ \d{1,2}, \d{4})/i.exec(text)
  if (until !== null) return today <= isoDate(until[1])
  const from = /\[Section effective ([A-Za-z]+ \d{1,2}, \d{4})/i.exec(text)
  if (from !== null) return today >= isoDate(from[1])
  return false
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
