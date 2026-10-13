/**
 * Wyoming: the Wyoming Statutes as the Legislative Service Office publishes
 * them at wyoleg.gov. The Legislature's "Statutes" page links each title as one
 * PDF (`/statutes/compress/title31.pdf`, "Title 31 - Motor Vehicles") beside
 * its older Folio reader; the PDF is the LSO's own compilation, free and with
 * no click-through.
 *
 * A PDF `enumerate`, as New Mexico's is: every section's URL is the title's PDF
 * with the section as its fragment; fetch.ts reads the PDF once per run
 * through `pdftotext -layout` and records the PDF's own hash. `enumerate`
 * reads the same cached page, so it lists sections from exactly the text
 * `extract` is given.
 *
 * wyoleg.gov serves no robots.txt (404 on 2026-10-08, with and without www),
 * so nothing is disallowed and no Crawl-delay asked; the fetch's own second
 * between requests stands, and the PDF is one request.
 *
 * In that text a section opens indented on its number and catchline
 * ("31-5-233. Driving or having control of vehicle while under"), the
 * catchline wrapping to the margin; each paragraph opens on an indented line,
 * and its wraps return to the margin. A section closes at the next section,
 * chapter or article heading: the PDF carries no history notes or annotations.
 * The catchline is the listing's heading and is not committed again. A
 * section with no subsections sets its law at the margin after a blank line
 * (31-5-227), or straight after the catchline where a page breaks there
 * (31-5-611), so a catchline runs on only until its full stop.
 *
 * **What is in effect.** Where an amendment takes effect later, the PDF prints
 * the unit in force and then "Note: Effective 7/1/2027 this subsection will
 * read as:" followed by the new unit. `extract` drops the note and the unit
 * after it -- everything up to the next line indented no deeper than that
 * unit's label -- so a quote is never the law of 2027 presented as the law
 * today. A section enacted for a later date says so in its catchline ("Note:
 * this section is effective as of 7/1/2027."), and `enumerate` leaves it out.
 * A note whose date has come is a reading this cannot settle (the PDF would
 * then print a superseded unit as though it were law) and is an error, not a
 * guess; so is any note of a shape not named here.
 *
 * Wyoming labels its subsections "(a)", paragraphs in lower-case roman "(i)",
 * "(xv)", subparagraphs "(A)" and sub-subparagraphs "(I)". The PDF sets a
 * label and its text apart with a run of spaces, "(ii)   Repealed by…";
 * `extract` joins a paragraph's lines and collapses those runs to one space --
 * whitespace only, never a word -- so each label opens a line of its own. A
 * line broken after a hyphen ("W.S. 31-2-" then "113") is joined with no
 * space. Form feeds, a page break and not a word, are dropped.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://wyoleg.gov/'
/** Title 31, Motor Vehicles, as the Legislature's Statutes page links it. */
const TITLE_31 = `${ORIGIN}statutes/compress/title31.pdf`

/**
 * The chapters of Title 31 a licence-holder is bound by, and the articles of
 * each left out (an article is a section's hundreds: 31-5-801 is Article 8).
 * Out, and why: Chapter 1 Article 2 is the department's administration and
 * records. Chapter 2 Article 3 is dealers (repealed), 4 snowmobiles and 7
 * off-road recreational vehicles (recreation off the road), 5 mobile homes, 6
 * mobile machinery (renumbered into Chapter 18) and 8 lenders' security
 * interests. Chapter 5 Article 8 is snowmobiles, 10 size and weight (renumbered
 * into Chapter 18), 15 the motorcycle safety education program's
 * administration, 16 off-road recreational vehicles, 17 towing businesses.
 * Chapter 7 Article 3 is the commercial licence, which every state so far has
 * left out because its permit and alcohol rules crowd out the ordinary ones.
 * Chapter 8 Article 1 is identification cards. Whole chapters out: 11, vehicle
 * identification numbers and anti-theft; 12, damage to highways; 13, abandoned
 * vehicles and their disposal; 14, motor clubs; 15, the multistate highway
 * agreement; 16, franchises; 17, the commercial licence; 18, commercial
 * vehicles and motor carriers; 19, rental agencies; 20, transportation network
 * companies. Wyoming codifies driving under the influence, the under-21 limit
 * and the open container in Chapter 5 itself, so no other title is needed.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; omit: number[] }[] = [
  { chapter: '1', id: '31-1', name: 'Title 31, Chapter 1, Article 1: Definitions', why: 'what the code means by a vehicle, a moped, a highway, an owner or a resident', omit: [2] },
  {
    chapter: '2',
    id: '31-2',
    name: 'Title 31, Chapter 2, Articles 1 and 2: Certificates of Title and Registration',
    why: 'the title and registration every owner must hold, the plates and their display, and disability plates and placards',
    omit: [3, 4, 5, 6, 7, 8],
  },
  { chapter: '3', id: '31-3', name: 'Title 31, Chapter 3: General Fees', why: 'the registration and title fees an owner pays', omit: [] },
  { chapter: '4', id: '31-4', name: 'Title 31, Chapter 4: General Offenses and Penalties', why: 'driving unregistered or uninsured, and the penalties for the registration rules', omit: [] },
  {
    chapter: '5',
    id: '31-5',
    name: 'Title 31, Chapter 5: Regulation of Traffic on Highways',
    why: 'the rules of the road: signals, speed, right of way, passing, parking, pedestrians, bicycles, equipment, crashes, driving under the influence, child seats, seat belts and the penalties',
    omit: [8, 10, 15, 16, 17],
  },
  { chapter: '6', id: '31-6', name: 'Title 31, Chapter 6: Implied Consent to Chemical Testing', why: 'the breath or blood test every driver consents to, and the suspension for refusing it', omit: [] },
  {
    chapter: '7',
    id: '31-7',
    name: "Title 31, Chapter 7: Driver's Licenses (without Article 3, the commercial licence)",
    why: 'the instruction permit, the intermediate licence and its limits, the licence and its tests, points, suspension and revocation, the driver licence compact, ignition interlock and 24/7 licences',
    omit: [3],
  },
  { chapter: '8', id: '31-8', name: 'Title 31, Chapter 8, Article 2: Insurance Identification Cards', why: 'the proof of insurance a driver must carry and show', omit: [1] },
  { chapter: '9', id: '31-9', name: 'Title 31, Chapter 9: Motor Vehicle Safety Responsibility', why: 'the security after a crash, the crash report, and the suspension for an unpaid judgment or no proof of financial responsibility', omit: [] },
  { chapter: '10', id: '31-10', name: 'Title 31, Chapter 10: Uninsured Motor Vehicle Coverage', why: 'the uninsured motorist coverage every policy must offer', omit: [] },
]

/** Wyoming's citation form: "Wyo. Stat. Ann. § 31-5-233". */
export function cite(section: string): string {
  return `Wyo. Stat. Ann. § ${section}`
}

/** A section's number and catchline, indented: "    31-5-233. Driving or having control…". */
const HEADER = /^\s+(31-(\d+)-(\d+(?:\.\d+)?))\.\s+(\S.*)$/
/** What closes a section: the next chapter or article heading. */
const AFTER_LAW = /^\s*(CHAPTER \d+ - |ARTICLE ([IVX]+|\d+)\b)/
/** A catchline kept only as a marker. */
const GONE = /^(Repealed|Renumbered|Amended and renumbered|Reserved|Transferred)\b/i
/** A section enacted for a later date, as its catchline says. */
const SECTION_NOTE = /\s*Note: this section is effective as of (\d{1,2})\/(\d{1,2})\/(\d{4})\.\s*$/
/** A unit amended for a later date, printed after the unit in force. */
const UNIT_NOTE = /^\s*Note: Effective (\d{1,2})\/(\d{1,2})\/(\d{4}) this (subsection|paragraph|subparagraph|subdivision) will read as:\s*$/
const LABEL = /^\((?:[a-z]{1,6}|[A-Z]{1,6}|\d{1,3})\)/

interface Parsed {
  chapter: string
  article: number
  heading: string
  /** The lines after the catchline, up to the next section. */
  lines: string[]
}

let parsed: { text: string; sections: Map<string, Parsed> } | null = null

const isoOf = (month: string, day: string, year: string) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`

/** Every section in the title's text, once each. Form feeds go: `pdftotext` sets one where a page breaks. */
export function sectionsOf(text: string): Map<string, Parsed> {
  if (parsed?.text === text) return parsed.sections
  const sections = new Map<string, Parsed>()
  let current: Parsed | null = null
  let inHeading = false
  for (const raw of text.replace(/\f/g, '').split('\n')) {
    if (AFTER_LAW.test(raw)) {
      current = null
      continue
    }
    const header = HEADER.exec(raw)
    if (header !== null) {
      const [, section, chapter, number] = header
      // The PDF prints 31-7-115's heading twice, the first with nothing under
      // it: that is a typesetting slip, and the heading with the law is the
      // section. Two headings both with text would be two versions, and an error.
      const earlier = sections.get(section)
      if (earlier !== undefined && earlier.lines.some((line) => line.trim() !== '')) throw new Error(`the title's PDF prints ${section} twice`)
      current = { chapter, article: Math.floor(Number(number) / 100), heading: header[4].trim(), lines: [] }
      sections.set(section, current)
      inHeading = true
      continue
    }
    if (current === null) continue
    // A long catchline wraps to the margin on the very next line; a section
    // with no subsections opens its law at the margin too, after a blank line
    // -- or none where a page breaks there (31-5-611) -- so a catchline goes
    // on only while it has not ended on its full stop.
    if (inHeading && /^\S/.test(raw) && !/\.\s*$/.test(current.heading)) {
      current.heading += ` ${raw.trim()}`
      continue
    }
    inHeading = false
    current.lines.push(raw)
  }
  parsed = { text, sections }
  return sections
}

/** The date a section-level note puts the section in force, or null where it has none. */
function enactedFor(heading: string): string | null {
  const note = SECTION_NOTE.exec(heading)
  return note === null ? null : isoOf(note[1], note[2], note[3])
}

const withoutNote = (heading: string) => heading.replace(SECTION_NOTE, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '')

const indentOf = (line: string) => /^ */.exec(line)![0].length

/** A section's lines with every later unit, and the note announcing it, dropped. */
function inForce(lines: string[], section: string, today: string): string[] {
  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const note = UNIT_NOTE.exec(lines[index])
    if (note === null) {
      if (/\bNote:/.test(lines[index])) throw new Error(`${section} carries a note this extract does not know: "${lines[index].trim()}"`)
      kept.push(lines[index])
      continue
    }
    const date = isoOf(note[1], note[2], note[3])
    if (date <= today) throw new Error(`${section}: a unit amended for ${date} is in force now, and the PDF still prints the old one first`)
    // The new unit opens on the next labelled line; it runs to the next line
    // indented no deeper than that label, or the next note.
    let start = index + 1
    while (start < lines.length && lines[start].trim() === '') start += 1
    if (start >= lines.length || !LABEL.test(lines[start].trim())) throw new Error(`${section}: a note for ${date} is not followed by a labelled unit`)
    const depth = indentOf(lines[start])
    let end = start + 1
    while (end < lines.length) {
      const line = lines[end]
      if (UNIT_NOTE.test(line)) break
      if (line.trim() !== '' && indentOf(line) > 0 && indentOf(line) <= depth) break
      end += 1
    }
    index = end - 1
  }
  return kept
}

const site: Site = {
  // The Wyoming Legislature's Legislative Service Office publishes the statutes; this is its site.
  official: ORIGIN,
  name: 'the Wyoming Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const sections = sectionsOf((await fetchedPage(TITLE_31).page).body)
    const today = new Date().toISOString().slice(0, 10)
    const listings: Listing[] = []
    const later: string[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const [section, { chapter, article, heading }] of sections) {
        if (chapter !== title.chapter || title.omit.includes(article)) continue
        if (GONE.test(heading)) continue
        const enacted = enactedFor(heading)
        if (enacted !== null && enacted > today) {
          later.push(`${section} (in force ${enacted})`)
          continue
        }
        listings.push({
          file: section,
          // The fragment names the section in the PDF; it is never sent to the server.
          url: `${TITLE_31}#${section}`,
          section,
          cite: cite(section),
          heading: withoutNote(heading),
        })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    if (later.length > 0) console.log(`WY: left out as not yet in force: ${later.join(', ')}`)
    return listings
  },
  extract: (body, listing) => extractWyoming(body, listing.section),
}

export default site

/**
 * One section's law in effect, a line per paragraph. A paragraph opens on an
 * indented line; a line at the margin is a wrap of the one before. Lines are
 * joined with a space and runs of spaces collapsed.
 */
export function extractWyoming(text: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const found = sectionsOf(text).get(section)
  if (found === undefined) throw new Unavailable(`the title's PDF has no heading for ${section}`)
  const enacted = enactedFor(found.heading)
  if (enacted !== null && enacted > today) throw new Unavailable(`${section} is enacted for ${enacted}, not in force today`)
  const paragraphs: string[] = []
  let blank = false
  for (const raw of inForce(found.lines, section, today)) {
    if (raw.trim() === '') {
      blank = true
      continue
    }
    const line = raw.replace(/[\s ]+/g, ' ').trim()
    const previous = paragraphs.at(-1)
    // A section with no labels sets its paragraphs at the margin, a blank line
    // between them: one after a finished sentence opens a paragraph of its own.
    const opens = previous === undefined || /^\s/.test(raw) || (blank && /[.:;]["”]?$/.test(previous))
    blank = false
    if (opens) {
      paragraphs.push(line)
      continue
    }
    // A line broken after a hyphen -- "W.S. 31-2-" then "113" -- is one word: the break goes, the hyphen stays.
    paragraphs[paragraphs.length - 1] = /\w-$/.test(previous) && /^\w/.test(line) ? `${previous}${line}` : `${previous} ${line}`
  }
  if (paragraphs.length === 0) throw new Unavailable('the PDF serves the catchline with no text')
  // The catchline is the listing's heading and is not committed again: a
  // catchline over 160 characters (31-6-105) is not read as a heading by the
  // chunker, and was retrieved as though it were a rule.
  return paragraphs.join('\n') + '\n'
}
