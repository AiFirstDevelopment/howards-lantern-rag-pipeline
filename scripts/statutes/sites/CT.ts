/**
 * Connecticut: the General Statutes as the General Assembly publishes them
 * (cga.ct.gov/current/pub), revised to January 1, 2026. A chapter-page
 * `enumerate`: one HTML page holds a whole chapter, every section in it, so a
 * section's URL is the chapter's page with the section's anchor as its
 * fragment, and fetch.ts reads each page once per run.
 *
 * Each section on the page is its catchline, its paragraphs of law, and then
 * the source note, history, cross references and annotations -- none of them
 * law, all of them dropped. Where a section is amended for a later date the
 * page serves the text before the amendment with a star, and after the source
 * note "*Note: On and after July 1, 2025, subsection (b) of this section … is to
 * read as follows:" and the amended text in quotes. `extract` keeps whichever
 * version is in effect today, and only that one.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.cga.ct.gov/current/pub/'

/**
 * The parts of the code a licence-holder is bound by. Out, and why: chapter
 * 246's Part II is the Department of Motor Vehicles itself, sections 14-51 to
 * 14-67w of its Part III license dealers, repairers, wreckers, manufacturers
 * and junkyards, and its Part IV driving schools; chapter 249's Part II is the
 * emergency services commissioner's duties; chapters 246a and 246b are
 * emissions inspection and event data recorders, 247a a theft task force,
 * 250 to 254 fuel sales, fuel and highway-use taxes and interstate compacts,
 * and 255 off-road vehicles -- none of them a rule a driver is held to.
 */
const TITLES: {
  chapter: string
  id: string
  name: string
  why: string
  /** The span of section numbers after "14-", whole numbers inclusive: [80, 106] holds 14-80 to 14-106d. */
  span?: [number, number]
  only?: string[]
}[] = [
  { chapter: '246', span: [1, 1], id: 'ct-246-defs', name: 'Chapter 246, Part I: Definitions', why: 'what the code means by a vehicle, a motorcycle, a highway or an operator' },
  { chapter: '246', span: [12, 50], id: 'ct-246-reg', name: 'Chapter 246, Part III (§§ 14-12 to 14-50b): Registration and Licenses', why: 'registration, plates and insurance cards, the learner\'s permit, the licence and the rules for drivers under eighteen' },
  { chapter: '246', span: [80, 106], id: 'ct-246-equip', name: 'Chapter 246, Part V: Equipment', why: 'brakes, lights, tires, mirrors, window tint, seat belts and child restraints' },
  { chapter: '246', span: [107, 144], id: 'ct-246-proc', name: 'Chapter 246, Part VI: Jurisdiction and Procedure', why: 'suspension and revocation, financial responsibility, the point system and what a court reports' },
  { chapter: '246', span: [145, 164], id: 'ct-246-gen', name: 'Chapter 246, Part VII: General Provisions', why: 'misuse of plates and licences, abandoned vehicles, racing and the general penalty' },
  { chapter: '247', span: [165, 211], id: 'ct-247', name: 'Chapter 247: Uniform Motor Vehicle Certificate of Title and Antitheft Act', why: 'the title every owner must hold and transfer' },
  { chapter: '248', id: 'ct-248', name: 'Chapter 248: Vehicle Highway Use', why: 'the rules of the road: speed, right of way, passing, parking, school buses, crashes, impaired driving and phones' },
  { chapter: '249', span: [297, 314], id: 'ct-249', name: 'Chapter 249, Part I: Traffic Control', why: 'signals and right turn on red, crosswalks and pedestrians, stop and yield signs' },
  { chapter: '700', only: ['38a-335', '38a-371'], id: 'ct-38a', name: 'Sections 38a-335 and 38a-371: Minimum Coverages and Mandatory Security', why: 'the insurance every vehicle must carry, codified in the insurance title' },
  { chapter: '545', only: ['30-89'], id: 'ct-30', name: 'Section 30-89: Purchase or Possession of Liquor by a Minor', why: 'underage possession of alcohol, codified in the liquor title' },
  { chapter: '952', only: ['53a-56b', '53a-57', '53a-60d'], id: 'ct-53a', name: 'Sections 53a-56b, 53a-57 and 53a-60d: Crimes with a Motor Vehicle', why: 'manslaughter, misconduct and assault with a motor vehicle, codified in the penal code' },
]

/** The state's own citation form: "Conn. Gen. Stat. § 14-251". */
export function cite(section: string): string {
  return `Conn. Gen. Stat. § ${section}`
}

const chapterUrl = (chapter: string) => `${ORIGIN}chap_${chapter}.htm`

interface Paragraph {
  /** The paragraph's class: '' for the law's own paragraphs. */
  kind: string
  html: string
}

interface Section {
  section: string
  /** The catchline with its section number, as the page prints it. */
  catchline: string
  /** The text after the catchline in the section's first paragraph. */
  opening: string
  paragraphs: Paragraph[]
}

let parsed: { html: string; sections: Map<string, Section> } | null = null

const CATCHLINE = /^<span class="catchln" id="(secs?_[^"]+)">([\s\S]*?)<\/span>/

/**
 * A chapter page as its sections, in order: each from the paragraph carrying
 * its catchline up to the "Return to Chapter Table of Contents" bar after it.
 * The table of contents at the top links each section too, but by a
 * `toc_catchln` paragraph, not a `catchln` span -- taking that one would
 * commit a list of headings as the law.
 */
function sectionsOf(html: string): Map<string, Section> {
  if (parsed?.html === html) return parsed.sections
  const sections = new Map<string, Section>()
  let current: Section | null = null
  for (const [whole, attributes, inner] of html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>|<table class="nav_tbl">/gi)) {
    if (whole.startsWith('<table')) {
      current = null
      continue
    }
    const catchline = CATCHLINE.exec(inner.trim())
    if (catchline !== null) {
      // "secs_14-83_to_14-96": a run of sections repealed together, kept as one pointer.
      const [, id, heading] = catchline
      current = id.startsWith('sec_')
        ? { section: id.slice(4), catchline: text(heading), opening: text(inner.trim().slice(catchline[0].length)), paragraphs: [] }
        : null
      if (current !== null) {
        if (sections.has(current.section)) throw new Error(`${current.section} has two catchlines on ${chapterOf(html)}`)
        sections.set(current.section, current)
      }
      continue
    }
    if (current === null) continue
    current.paragraphs.push({ kind: /class="([^"]*)"/.exec(attributes)?.[1] ?? '', html: inner })
  }
  parsed = { html, sections }
  return sections
}

const chapterOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'the chapter page'

const text = (html: string) =>
  decode(html.replace(/<br[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

/** A paragraph of the law itself: unclassed, or a form or a table cell. Notes, history and annotations are classed otherwise. */
const isLaw = (paragraph: Paragraph) => paragraph.kind === '' || /^(Text|Form|tb)\b/.test(paragraph.kind)

/** What is left where a section no longer holds law: "Section 14-218 is repealed.", "Reserved for future use.", "Transferred to Sec. 14-65f.", "Obsolete." */
const GONE = /^(Section \S+ is repealed|Reserved for future use|Transferred to |Obsolete\.$)/

/** The catchline as a heading: no section number, no pointer to an amended version, no former number. */
function headingOf(catchline: string, section: string): string {
  return catchline
    .slice(`Sec. ${section}.`.length)
    .replace(SEE_AMENDED, '')
    .replace(/^\s*\(Formerly Secs?\. [^)]*\)\.\s*/, '')
    .trim()
}

/** "*(See end of section for amended version of subsection (b) and effective date.)": a pointer in the catchline, not part of it. */
const SEE_AMENDED = /\s*\*\(See end of section .*?effective dates?\.\)\s*/

/** "14-251" -> 251; "14-12l" -> 12. */
const numberOf = (section: string) => Number(/^\d+[a-z]?-(\d+)/.exec(section)?.[1] ?? NaN)

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'howardslantern.com statute check (+https://howardslantern.com/)' } })
  if (!response.ok) throw new Error(`cga.ct.gov answered ${response.status} for ${url}`)
  return response.text()
}

const site: Site = {
  // The General Assembly's own publication of the General Statutes.
  official: ORIGIN,
  name: 'the Connecticut General Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const chapter of [...new Set(TITLES.map((each) => each.chapter))]) {
      const sections = sectionsOf(await page(chapterUrl(chapter)))
      for (const spec of TITLES.filter((each) => each.chapter === chapter)) {
        for (const each of sections.values()) {
          const { section } = each
          if (spec.only !== undefined && !spec.only.includes(section)) continue
          if (spec.span !== undefined && !(section.startsWith('14-') && numberOf(section) >= spec.span[0] && numberOf(section) <= spec.span[1])) continue
          if (headingOf(each.catchline, section) === '' || GONE.test(each.opening)) continue
          listings.push({
            file: `${spec.id}-${section}`,
            url: `${chapterUrl(chapter)}#sec_${section}`,
            section,
            cite: cite(section),
            heading: headingOf(each.catchline, section),
          })
        }
      }
    }
    return listings
  },
  extract: (body, listing) => extractCga(body, listing.section),
}

export default site

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The amendment note after a section's source note, naming what it replaces and when. */
const NOTE = /^\*Note: On and after (\w+) (\d{1,2}), (\d{4}), (?:subsection \(([a-z]+)\) of this section|(this section)|section [\w-]+),.*is to read as follows:$/

/**
 * One section's text in effect: its number on its own line, then a line per
 * paragraph of law. A starred version superseded by an amendment now in
 * force gives way to the amended text; an amendment not yet in force is
 * dropped with its note, and the version in force keeps its words without the
 * star.
 */
export function extractCga(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const found = sectionsOf(html).get(section)
  if (found === undefined) throw new Unavailable(`the chapter page has no catchline for ${section}`)
  const first = found.paragraphs.findIndex((paragraph) => !isLaw(paragraph))
  const law = (first < 0 ? found.paragraphs : found.paragraphs.slice(0, first)).map((paragraph) => text(paragraph.html))
  let lines = [found.opening, ...law].filter((line) => line.length > 0)
  const after = first < 0 ? [] : found.paragraphs.slice(first)
  // Only a note that serves another version is one; "*Note: Section 22a-27n was repealed…" explains a reference and replaces nothing.
  const noteAt = after.findIndex((paragraph) => /^\*Note:.*(to read as follows|on and after)/i.test(text(paragraph.html)))
  if (noteAt >= 0) {
    const note = NOTE.exec(text(after[noteAt].html))
    // A note in a form this cannot read could be either version; guessing would commit the wrong law.
    if (note === null) throw new Error(`${section} carries an amendment note this cannot read: ${text(after[noteAt].html)}`)
    const [, month, day, year, subsection, wholeSection] = note
    if (MONTHS.indexOf(month) < 0) throw new Error(`${section}'s amendment note names a month this cannot read: ${month}`)
    const date = `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
    const rest = after.slice(noteAt + 1)
    const end = rest.findIndex((paragraph) => !isLaw(paragraph))
    const amended = (end < 0 ? rest : rest.slice(0, end)).map((paragraph) => text(paragraph.html)).filter((line) => line.length > 0)
    amended[0] = amended[0].replace(/^“/, '')
    amended[amended.length - 1] = amended[amended.length - 1].replace(/”$/, '')
    if (date > today) {
      lines = lines.map((line) => line.replace(/^\*/, ''))
    } else if (wholeSection !== undefined || subsection === undefined) {
      lines = amended
    } else {
      const start = lines.findIndex((line) => line.startsWith(`*(${subsection})`))
      if (start < 0) throw new Error(`${section} has no starred subsection (${subsection}) for its amendment note to replace`)
      const next = `(${String.fromCharCode(subsection.charCodeAt(0) + 1)})`
      const stop = lines.findIndex((line, index) => index > start && line.startsWith(next))
      lines = [...lines.slice(0, start), ...amended, ...(stop < 0 ? [] : lines.slice(stop))]
    }
  }
  if (lines.length === 0) throw new Unavailable('the chapter page serves the catchline with no text')
  // The section number alone heads the text; the catchline is the listing's heading. Kept whole, a catchline
  // over 160 characters is no longer read as a header, and became a chunk of its own naming a rule it does
  // not state ("Sec. 14-242. Turns restricted. Signals to be given…") that outranked the rule itself.
  return [`Sec. ${section}.`, ...lines].join('\n') + '\n'
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
