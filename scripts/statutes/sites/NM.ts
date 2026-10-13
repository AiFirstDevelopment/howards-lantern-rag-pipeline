/**
 * New Mexico: the New Mexico Statutes Annotated 1978 as the New Mexico
 * Compilation Commission publishes them on NMOneSource.com. The Commission is
 * the state agency that compiles the official statutes (NMSA 1978, § 12-1-1
 * and following), and names NMOneSource as where it gives "the official laws
 * of the State of New Mexico to its citizens"; the Legislature's own site
 * links it as "New Mexico Law (Statutes)". It is the Commission's site, run on
 * Lexum's Norma platform, free and with no click-through.
 *
 * A PDF `enumerate`, as Colorado's is a chapter-page one: the Commission
 * publishes each chapter as one PDF ("chapter-66-motor-vehicles-2026.pdf"),
 * and the reader's HTML is only a frame around it. So every section's URL is
 * the chapter's PDF with the section as its fragment; fetch.ts reads the PDF
 * once per run through `pdftotext -layout` and records the PDF's own hash.
 * `enumerate` reads the same cached page, so it lists sections from exactly
 * the text `extract` is given.
 *
 * In that text a section opens at the margin on its number and catchline
 * ("66-7-301. Speed regulation."), its paragraphs are indented and wrap back to
 * the margin, and it closes on a "History:" line followed by the Commission's
 * annotations -- neither of which is law, and `extract` stops at the first.
 *
 * Where an amendment takes effect later, the PDF carries the section twice:
 * the text in effect, then a copy whose catchline ends "(Effective January 1,
 * 2027.)". `extract` keeps the version in effect on the day it runs and drops
 * the other, so a quote is never the law of 2027 presented as the law today.
 *
 * New Mexico letters its subsections "A.", "B.", and numbers paragraphs "(1)",
 * "(a)". The PDF sets a label and its text apart with a run of spaces, "(1)
 * fifteen miles per hour", and wraps each paragraph over several lines;
 * `extract` joins a paragraph's lines and collapses those runs to one space --
 * whitespace only, never a word -- so each label opens a line of its own. A
 * line that breaks after a hyphen is joined with no space, so "66-3-887"
 * is not committed as "66-3- 887".
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://nmonesource.com/nmos/nmsa/en/'
/** Chapter 66, Motor Vehicles: the Commission's item 4422, served as one PDF. */
const CHAPTER_66 = `${ORIGIN}4422/1/document.do`

/**
 * The articles of Chapter 66 a licence-holder is bound by, and the parts of
 * them left out. Out, and why: Article 2 is the Motor Vehicle Division itself;
 * Article 4 licenses dealers and wreckers; Article 6 is the registration fees
 * and how the state distributes them; Article 9 (snowmobiles) is repealed;
 * Article 10 licenses driver education schools; Article 11 is the historic
 * vehicle registry; Articles 12 and 13 are boating and boating while
 * intoxicated, not the Motor Vehicle Code. Inside Article 3, Part 3 is the
 * lender's filing of security interests and Part 11 off-highway vehicles. Inside
 * Article 5, Part 1A is the Commercial Driver's License Act, left out as every
 * state's commercial licensing has been: its permit and alcohol rules crowd out
 * the ordinary ones; Part 2 is serving civil process on non-residents, Part 5
 * identification cards and Part 7 the division's electronic credentials.
 * Inside Article 7, Part 6 is the traffic safety bureau's own programs.
 */
const TITLES: { article: string; id: string; name: string; why: string; without?: string[] }[] = [
  { article: '1', id: '66-1', name: 'NMSA 1978, Chapter 66, Article 1: General Provisions', why: 'what the Motor Vehicle Code means by a vehicle, a moped, a highway or a driver' },
  {
    article: '3',
    id: '66-3',
    name: 'NMSA 1978, Chapter 66, Article 3: Registration, Title, Bicycles, Equipment and Unsafe Vehicles',
    why: 'registration and plates every owner must hold, the rules for bicycles and mopeds, and the lights, brakes and equipment a vehicle must have',
    without: ['3', '11'],
  },
  {
    article: '5',
    id: '66-5',
    name: "NMSA 1978, Chapter 66, Article 5: Drivers' Licenses, Financial Responsibility and Uninsured Motorists",
    why: 'licensing, the instruction permit and the provisional licence and its limits, suspension and revocation, ignition interlock licences, and the insurance every vehicle must carry',
    without: ['1A', '2', '5', '7'],
  },
  {
    article: '7',
    id: '66-7',
    name: 'NMSA 1978, Chapter 66, Article 7: Traffic Laws, Signs and Signals, Accidents, Weight and Size',
    why: 'the rules of the road: signals, right of way, speed, passing, school buses, parking, seat belts, child seats, phones, duties after a crash, and the size and load every vehicle is held to',
    without: ['6'],
  },
  { article: '8', id: '66-8', name: 'NMSA 1978, Chapter 66, Article 8: Crimes, Penalties and Procedure', why: 'impaired driving, implied consent, open containers, homicide by vehicle, citations and the penalty assessments' },
]

/** "66-7-301" -> "NMSA 1978, § 66-7-301". */
export function cite(section: string): string {
  return `NMSA 1978, § ${section}`
}

/** A section's number and catchline at the margin: "66-7-301. Speed regulation." */
const HEADER = /^(66-\d+[A-Z]?-\d+(?:\.\d+)*)\.\s+(\S.*)$/
const ARTICLE = /^\s*ARTICLE (\d+)\s*$/
const PART = /^\s*PART (\d+[A-Z]?)\s*$/
/** What closes a section's law: its history note, the annotations, or the next part or article. */
const AFTER_LAW = /^(History:|\s*ANNOTATIONS\s*$|\s*PART \d+[A-Z]?\s*$|\s*ARTICLE \d+\s*$)/
/** A catchline kept only as a marker. */
const GONE = /^(Repealed|Recompiled|Transferred|Reserved)\b/i
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface Version {
  article: string
  part: string
  heading: string
  /** The lines after the catchline, up to the history note. */
  lines: string[]
}

let parsed: { text: string; sections: Map<string, Version[]> } | null = null

/**
 * Every section in the chapter's text, each with the versions the PDF serves
 * of it, in order. Form feeds go: `pdftotext` sets one where a page breaks,
 * at the start of a line that may be a section's header.
 */
export function sectionsOf(text: string): Map<string, Version[]> {
  if (parsed?.text === text) return parsed.sections
  const sections = new Map<string, Version[]>()
  let article = ''
  let part = ''
  let current: Version | null = null
  let inLaw = false
  let inHeading = false
  for (const raw of text.replace(/\f/g, '').split('\n')) {
    const articleMatch = ARTICLE.exec(raw)
    if (articleMatch !== null) {
      article = articleMatch[1]
      part = ''
    }
    const partMatch = PART.exec(raw)
    if (partMatch !== null) part = partMatch[1]
    const header = HEADER.exec(raw)
    if (header !== null && header[1].startsWith(`66-${article}-`)) {
      current = { article, part, heading: header[2].trim(), lines: [] }
      sections.set(header[1], [...(sections.get(header[1]) ?? []), current])
      inLaw = true
      inHeading = true
      continue
    }
    if (!inLaw || current === null) continue
    if (AFTER_LAW.test(raw)) {
      inLaw = false
      continue
    }
    // A long catchline wraps to the margin before the law's first, indented, line.
    if (inHeading && /^\S/.test(raw) && !/\.\)?\s*$/.test(current.heading)) {
      current.heading += ` ${raw.trim()}`
      continue
    }
    inHeading = false
    current.lines.push(raw)
  }
  parsed = { text, sections }
  return sections
}

/** Whether a version's catchline says it is not the law today: "(Effective January 1, 2027.)", or "(Effective until …)" a date now past. */
function inEffect(heading: string, today: string): boolean {
  const note = /\(Effective (until )?(\w+) (\d{1,2}), (\d{4})\.?\)/.exec(heading)
  if (note === null) return true
  const [, until, month, day, year] = note
  const index = MONTHS.indexOf(month)
  if (index < 0) throw new Error(`a catchline names a month this cannot read: ${month}`)
  const date = `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
  return until !== undefined ? date > today : date <= today
}

/** The one version of a section in effect today, or why there is none. */
function versionOf(sections: Map<string, Version[]>, section: string, today: string): Version {
  const versions = sections.get(section)
  if (versions === undefined) throw new Unavailable(`the chapter's PDF has no heading for ${section}`)
  const current = versions.filter((version) => inEffect(version.heading, today))
  if (current.length === 0) throw new Unavailable(`the PDF serves ${section} only in a version not in effect today`)
  // Two versions both in effect would be a reading this cannot settle; guessing would commit the wrong one.
  if (current.length > 1) throw new Error(`${section} has ${current.length} versions in effect in the PDF`)
  return current[0]
}

const withoutNote = (heading: string) => heading.replace(/\s*\(Effective [^)]*\)\s*$/, '').replace(/\.$/, '')

const site: Site = {
  // The New Mexico Compilation Commission's NMOneSource, which it names as the official laws of the state.
  official: ORIGIN,
  name: 'the New Mexico Statutes Annotated 1978',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const sections = sectionsOf((await fetchedPage(CHAPTER_66).page).body)
    const today = new Date().toISOString().slice(0, 10)
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const [section, versions] of sections) {
        const { article, part } = versions[0]
        if (article !== title.article || title.without?.includes(part)) continue
        const current = versions.filter((version) => inEffect(version.heading, today))
        // A catchline marked repealed or recompiled points to a session law, not a rule.
        if (current.length > 0 && current.every((version) => GONE.test(version.heading))) continue
        listings.push({
          file: section,
          // The fragment names the section in the PDF; it is never sent to the server.
          url: `${CHAPTER_66}#${section}`,
          section,
          cite: cite(section),
          heading: withoutNote(current[0]?.heading ?? versions[0].heading),
        })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    return listings
  },
  extract: (body, listing) => extractNmsa(body, listing.section),
}

export default site

/** A paragraph's label at the start of a line: "A.", "(1)", "(a)", "(A)". */
const LABEL = /^(?:[A-Z]{1,2}\.|\(\w{1,4}\))\s/

/**
 * One section's law in effect: its number and catchline, then a line per
 * paragraph. A paragraph opens on an indented line that carries a label, or
 * follows one ending a sentence; a line at the margin is a wrap of the one
 * before. Lines are joined with a space and runs of spaces collapsed.
 */
export function extractNmsa(text: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const version = versionOf(sectionsOf(text), section, today)
  const paragraphs: string[] = []
  let inTable = false
  for (const raw of version.lines) {
    if (raw.trim() === '') continue
    const line = raw.replace(/[\s ]+/g, ' ').trim()
    const previous = paragraphs.at(-1)
    // A row of a table -- § 66-8-116's schedule, "Littering   66-7-364   300.00" --
    // is set in columns; joined to the row above, the whole schedule was one
    // 2,200-character line no chunk could cut.
    const row = /^[A-Z0-9$]/.test(line) && !LABEL.test(line) && /\S {3,}\S/.test(raw.trim()) && previous !== undefined && !/\w-$/.test(previous)
    // Inside a table, "(1)" to "(7)" are the tiers of the row above ("Speeding
    // 66-7-301"), not paragraphs of the section: opening a line on each, every
    // row after them -- "Littering 66-7-364 300.00" -- was cited as § 66-8-116(A)(7).
    const tier = inTable && /^\(\w{1,4}\)\s/.test(line)
    const opens =
      previous === undefined || row || (!tier && /^\s/.test(raw) && (LABEL.test(line) || /[.:;]["”]?$/.test(previous)))
    if (opens) inTable = row
    if (opens) paragraphs.push(line)
    // A line broken after a hyphen -- "Sections 66-3-801 through 66-3-" then
    // "887", "fifty-" then "five" -- is one word: the break goes, the hyphen stays.
    else paragraphs[paragraphs.length - 1] = /\w-$/.test(previous!) && /^\w/.test(line) ? `${previous}${line}` : `${previous} ${line}`
  }
  if (paragraphs.length === 0) throw new Unavailable('the PDF serves the catchline with no text')
  return [`${section}. ${withoutNote(version.heading)}.`, ...paragraphs].join('\n') + '\n'
}
