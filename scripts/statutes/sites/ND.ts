/**
 * North Dakota: the North Dakota Century Code as the Legislative Council
 * publishes it for the Legislative Assembly (ndlegis.gov/cencode), one PDF per
 * chapter. An index-page `enumerate`, as Maryland's: a chapter's `Sections`
 * page lists every section with its catchline and its place in the chapter PDF
 * (`t39c10.pdf#nameddest=39-10-49`). fetch.ts reads each chapter PDF once per
 * run through `pdftotext -layout` -- the fragment is never sent -- and
 * `extract` cuts the one section out of the chapter's text.
 *
 * What `pdftotext` makes of a chapter, and what `extract` does about it:
 * - every page ends "Page No. N" and a form feed: dropped;
 * - the left margin moves from page to page (a section's "1." at column 0 on
 *   one page, column 4 on the next), so indentation is only compared within a
 *   page;
 * - a catchline wraps onto a second line, sometimes at column 0: it is the
 *   heading's, not the law's first paragraph;
 * - a cross-reference can wrap so a line opens on a section number
 *   ("39-21-38."), so a heading is only one that follows a blank line;
 * - a paragraph is wrapped over lines; it is folded back into one line, and a
 *   compound word broken after its own hyphen ("service-\nconnected") is
 *   rejoined without the space a wrap would otherwise put after the hyphen.
 *   Only whitespace changes: no word is touched.
 *
 * North Dakota numbers subsections "1.", subdivisions "a.", paragraphs "(1)"
 * and subparagraphs "(a)". The chunker reads "1." and "(1)" as labels but not
 * "a.", so a subdivision rides inside its subsection and is cited as it:
 * § 39-10-49(4) is the hydrant, but § 39-10-03(1)(b) is cited § 39-10-03(1).
 *
 * A repealed section keeps its number, its catchline and one line, "Repealed
 * by S.L. 1975, ch. 106, § 673." (or "Deleted by R.M." for one a referred measure struck); it is reported, not committed. No section of
 * the chapters read here is served in a second, later version today; if one
 * ever is, its catchline carries "(Effective through …)" / "(Effective after
 * …)" and `extract` keeps the one in effect on the day it runs, or refuses a
 * form of note it cannot read rather than guess.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://ndlegis.gov/cencode/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters a licence-holder is bound by. Out of Title 39, and why: 39-02
 * (the department's organisation), 39-03 and 39-03.1 (the highway patrol and
 * its retirement system), 39-04.2 (public transportation funding), 39-06.2
 * (commercial driver's licences: they bind CDL holders, and their permit and
 * alcohol rules crowd out the ordinary ones), 39-10.3 (experimental vehicles'
 * registration), 39-16.2 (gas transporters), 39-18, 39-22, 39-22.1 and 39-22.3
 * (dealer licensing), 39-19 (reciprocity agreements between states), 39-24 and
 * 39-24.1 (snowmobiles) and 39-29 (off-highway vehicles: recreational
 * machines off the highway), 39-25 (licensing of commercial driving schools),
 * 39-28 (the motorcycle safety education program), 39-30 (chop shops), 39-31
 * and 39-32 (household goods carriers, commercial drivers' hours of service),
 * 39-33 (the department's record privacy), 39-34 (transportation network
 * companies), and the repealed chapters 39-04.1, 39-11, 39-14, 39-15, 39-17,
 * 39-21.1, 39-22.2, 39-23 and 39-26.
 */
const TITLES: {
  chapter: string
  /** The chapter's file stem: t39c10 for chapter 39-10. */
  stem: string
  name: string
  why: string
  /** Which of the chapter's sections are in, where not all of them are. */
  keep?: (section: string) => boolean
}[] = [
  { chapter: '39-01', stem: 't39c01', name: 'Chapter 39-01: Definitions and General Provisions', why: 'the definitions every other chapter of the title reads by, and the general penalties' },
  { chapter: '39-04', stem: 't39c04', name: 'Chapter 39-04: Motor Vehicle Registration', why: 'registration, plates and their display, and the fees every owner pays' },
  { chapter: '39-05', stem: 't39c05', name: 'Chapter 39-05: Title Registration', why: 'the certificate of title every owner must hold and transfer on a sale' },
  { chapter: '39-06', stem: 't39c06', name: "Chapter 39-06: Operators' Licenses", why: 'the licence, the instruction permit and the restricted licence for young drivers, testing, and suspension and revocation' },
  { chapter: '39-06.1', stem: 't39c06-1', name: 'Chapter 39-06.1: Disposition of Traffic Offenses', why: 'the fees for each offence, the points they carry and the suspension points bring' },
  { chapter: '39-07', stem: 't39c07', name: 'Chapter 39-07: General Regulations Governing Traffic', why: 'arrest, citation and the duties of a driver stopped by an officer' },
  { chapter: '39-08', stem: 't39c08', name: 'Chapter 39-08: Regulations Governing Operators', why: 'driving under the influence, reckless driving, duties after a crash, open containers, insurance and the wireless-device ban' },
  { chapter: '39-09', stem: 't39c09', name: 'Chapter 39-09: Speed Restrictions', why: 'the speed limits and the duty to drive at a careful speed' },
  { chapter: '39-10', stem: 't39c10', name: 'Chapter 39-10: General Rules of the Road', why: 'the rules of the road: signals, right of way, passing, turning, school buses, pedestrians, stopping and parking' },
  { chapter: '39-10.1', stem: 't39c10-1', name: 'Chapter 39-10.1: Bicycles', why: 'the rules for riding a bicycle on the road, which drivers share it with' },
  { chapter: '39-10.2', stem: 't39c10-2', name: 'Chapter 39-10.2: Motorcycles', why: 'the rules of the road for motorcycles: lanes, riding abreast, passengers' },
  { chapter: '39-12', stem: 't39c12', name: 'Chapter 39-12: Size, Width, and Height Restrictions', why: 'the size, weight and load limits a driver must keep to, and towing' },
  { chapter: '39-13', stem: 't39c13', name: 'Chapter 39-13: Traffic Signs', why: 'when a posted sign binds a driver, and the ban on tampering with signs' },
  { chapter: '39-16', stem: 't39c16', name: 'Chapter 39-16: Financial Responsibility of Owners and Operators', why: 'the crash report and security a crash requires, and the suspension for lacking it' },
  { chapter: '39-16.1', stem: 't39c16-1', name: 'Chapter 39-16.1: Proof of Financial Responsibility for the Future', why: 'proof of financial responsibility after a conviction, and the minimum liability limits' },
  { chapter: '39-20', stem: 't39c20', name: 'Chapter 39-20: Chemical Test for Intoxication, Implied Consent', why: 'implied consent, the tests for alcohol and drugs, and the licence suspension a test or refusal brings' },
  { chapter: '39-21', stem: 't39c21', name: 'Chapter 39-21: Equipment of Vehicles', why: 'lights, brakes, mirrors, windows and tint, seat belts and child restraints, and helmets' },
  { chapter: '39-27', stem: 't39c27', name: 'Chapter 39-27: Motorcycle Equipment', why: 'the equipment a motorcycle must carry' },
  { chapter: '39-29.1', stem: 't39c29-1', name: 'Chapter 39-29.1: Low-Speed Vehicles', why: 'where a low-speed vehicle may be driven, and the licence and insurance it requires' },
  { chapter: '39-29.2', stem: 't39c29-2', name: 'Chapter 39-29.2: Unconventional Vehicles', why: 'the title, registration and equipment of an unconventional vehicle driven on the road' },
  {
    chapter: '5-01',
    stem: 't05c01',
    name: 'Chapter 5-01, Section 5-01-08: Individuals under twenty-one prohibited from using alcoholic beverages',
    why: "a minor's purchase, possession or consumption of alcohol, codified in the alcoholic beverages title",
    keep: (section) => section === '5-01-08',
  },
]

/** The state's own citation form: "N.D.C.C. § 39-10-49". */
export function cite(section: string): string {
  return `N.D.C.C. § ${section}`
}

const titleId = (chapter: string) => `ndcc-${chapter}`

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`ndlegis.gov answered ${response.status} for ${url}`)
  return await response.text()
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/** A chapter's Sections page: `<a href="t39c10.pdf#nameddest=39-10-49">39-10-49</a></td> <td>Stopping, standing, or parking prohibited ‑ …</td>`. */
export function sectionsListed(html: string): { href: string; section: string; heading: string }[] {
  return [...html.matchAll(/<a href="(t\w+(?:-\d+)?\.pdf#nameddest=[^"]+)">\s*([\d.-]+)\s*<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g)].map(([, href, section, heading]) => ({
    href,
    section,
    heading: inline(heading).replace(/[‐‑]/g, '-'),
  }))
}

const site: Site = {
  // The Legislative Council publishes the Century Code for the Legislative Assembly.
  official: ORIGIN,
  name: 'the North Dakota Century Code',
  titles: TITLES.map(({ chapter, name, why }) => ({ id: titleId(chapter), name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const { href, section, heading } of sectionsListed(await page(`${ORIGIN}${title.stem}.html`))) {
        if (!href.startsWith(`${title.stem}.pdf#`)) throw new Error(`chapter ${title.chapter} lists ${section} in another file: ${href}`)
        if (!section.startsWith(`${title.chapter}-`)) throw new Error(`chapter ${title.chapter} lists a section of another chapter: ${section}`)
        if (title.keep !== undefined && !title.keep(section)) continue
        listings.push({ file: `ndcc-${section}`, url: `${ORIGIN}${href}`, section, cite: cite(section), heading })
      }
      // A Sections page read as nothing would otherwise let the fetch report "every listed section present".
      if (listings.length === before) throw new Error(`the Sections page for chapter ${title.chapter} lists nothing kept`)
      await pause()
    }
    const seen = new Set<string>()
    for (const listing of listings) {
      if (seen.has(listing.section)) throw new Error(`N.D.C.C. § ${listing.section} is listed twice`)
      seen.add(listing.section)
    }
    return listings
  },
  extract: (text, listing) => extractNdccChapter(text, listing.section),
}

export default site

/** A section's heading line: its number, a period, then its catchline. */
const HEADING = /^(\s{0,8})(\d+-\d+(?:\.\d+)?-\d+(?:\.\d+)?)\.\s+(\S.*)$/
const FOOTER = /^\s*Page No\. \d+\s*$/

/** "1.", "a.", "(1)", "(a)", "(10)" opening a line, then the paragraph's first word. */
const LABEL = /^(\(\w{1,4}\)|(?:\d{1,3}|[a-z])\.)\s+(\S)/
/** Where a clause ends, so a label after it opens a paragraph rather than continuing a wrapped sentence. */
const CLAUSE_END = /(?:[.;:]["”’')\]]*|\b(?:and|or))$/
const SENTENCE_END = /[.:]["”’')\]]*$/

interface Line {
  text: string
  indent: number
  page: number
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function isoDate(text: string): string {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim())
  const month = match === null ? -1 : MONTHS.indexOf(match[1].toLowerCase())
  if (match === null || month < 0) throw new Error(`an effective date this module cannot read: "${text}"`)
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/**
 * Whether a catchline's version is in effect on `today`. The Code marks a
 * section with two versions "(Effective through D)" and "(Effective after D)";
 * any other "Effective" note is refused rather than read as in force.
 */
export function inEffect(heading: string, today: string): boolean {
  const note = /\(Effective ([^)]*)\)/i.exec(heading)
  if (note === null) return true
  const through = /^through (.+)$/i.exec(note[1])
  if (through !== null) return today <= isoDate(through[1])
  const after = /^after (.+)$/i.exec(note[1])
  if (after !== null) return today > isoDate(after[1])
  throw new Error(`an effective-date note this module cannot read: "${note[0]}"`)
}

/**
 * One section's text out of its chapter's `pdftotext -layout` text: the heading
 * (number and catchline, however many lines it wraps over) is dropped -- the
 * listing carries the catchline -- and the law is one line per paragraph.
 */
export function extractNdccChapter(text: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  // Lines with their page, the footers gone, a form feed marking each new page.
  const lines: Line[] = []
  let pageNo = 0
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    let line = raw
    if (line.includes('\f')) {
      pageNo += 1
      line = line.replace(/\f/g, '')
    }
    if (FOOTER.test(line)) continue
    lines.push({ text: line.trimEnd(), indent: line.length - line.trimStart().length, page: pageNo })
  }
  const blank = (index: number) => index < 0 || lines[index].text.trim() === ''
  const headingAt = (index: number) => (blank(index - 1) ? HEADING.exec(lines[index].text) : null)

  const starts = lines.flatMap((line, index) => (headingAt(index)?.[2] === section ? [index] : []))
  if (starts.length === 0) throw new Error(`N.D.C.C. § ${section} has no heading in its chapter's PDF`)

  const versions = starts.map((start) => {
    // The heading runs until its catchline ends on a period.
    let end = start
    let heading = headingAt(start)![3]
    while (!/\.\s*$/.test(heading.replace(/\s*\(Effective [^)]*\)\s*$/i, '')) && end + 1 < lines.length && !blank(end + 1) && end - start < 4) {
      end += 1
      heading += ` ${lines[end].text.trim()}`
    }
    if (!/\.\s*$/.test(heading.replace(/\s*\(Effective [^)]*\)\s*$/i, ''))) throw new Error(`N.D.C.C. § ${section}'s catchline does not end`)
    let stop = end + 1
    while (stop < lines.length && headingAt(stop) === null) stop += 1
    return { heading, body: lines.slice(end + 1, stop).filter((line) => line.text.trim() !== '') }
  })
  const current = versions.filter((version) => inEffect(version.heading, today))
  if (current.length === 0) throw new Unavailable('no version of it is in effect yet')
  if (current.length > 1) throw new Error(`N.D.C.C. § ${section} is served ${current.length} times in effect in one chapter`)
  const body = current[0].body
  if (body.length === 0) throw new Error(`N.D.C.C. § ${section} came back with no text`)
  const plain = body.map((line) => line.text.trim()).join(' ')
  if (plain.length < 200 && /^(Repealed|Superseded|Expired|Reserved|Deleted)\b/i.test(plain)) throw new Unavailable('the Code keeps only a repealed marker')

  const paragraphs: { text: string; labelled: boolean; labelIndent: number; contIndent: number | null; last: Line }[] = []
  for (const [index, line] of body.entries()) {
    const trimmed = line.text.trim()
    const previous = paragraphs.at(-1)
    const next = body[index + 1]
    const label = LABEL.exec(trimmed)
    let opens = previous === undefined
    if (previous !== undefined && label !== null) {
      // A label at or left of the previous label is a sibling or a parent's
      // next, never a wrap -- a wrap sits deeper; otherwise only after a clause ends.
      const samePage = previous.last.page === line.page
      opens =
        /^[A-Z"“'‘(\d$\[]/.test(label[2]) &&
        (CLAUSE_END.test(previous.text) || (samePage && previous.labelled && line.indent <= previous.labelIndent + 1))
    } else if (previous !== undefined && SENTENCE_END.test(previous.text)) {
      const samePage = previous.last.page === line.page
      if (previous.labelled) {
        // A closing paragraph after a list sits at the list's own margin, left of its wrapped lines.
        opens = samePage && line.indent <= previous.labelIndent + 1 && line.indent < (previous.contIndent ?? Infinity)
      } else {
        // An unlabelled paragraph is indented on its first line and wraps to the margin.
        opens =
          (samePage && line.indent > previous.last.indent + 2) ||
          (next !== undefined && next.page === line.page && next.indent + 2 < line.indent && LABEL.exec(next.text.trim()) === null)
      }
    }
    if (opens) {
      paragraphs.push({ text: trimmed, labelled: label !== null, labelIndent: line.indent, contIndent: null, last: line })
    } else {
      const open = previous!
      open.text += /[A-Za-z]-$/.test(open.text) ? trimmed : ` ${trimmed}`
      if (open.contIndent === null && open.last.page === line.page) open.contIndent = line.indent
      open.last = line
    }
  }
  return paragraphs.map((paragraph) => paragraph.text.replace(/[\s ]+/g, ' ').trim()).join('\n') + '\n'
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
