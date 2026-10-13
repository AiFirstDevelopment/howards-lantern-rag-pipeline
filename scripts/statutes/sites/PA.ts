/**
 * Pennsylvania: the Pennsylvania Consolidated Statutes as the General
 * Assembly's Legislative Reference Bureau publishes them on the General
 * Assembly's site (palegis.us). A chapter-page `enumerate`, as Florida's and
 * Oregon's, at its widest: the site serves the whole of Title 75 (Vehicles)
 * as one page -- the text its own statute viewer loads into a frame -- with
 * the title's table of contents at its head, so a section's URL is that page
 * with the section number as its fragment and fetch.ts reads it once per run.
 * The one section taken from Title 18 is read from its own one-section page,
 * so the Crimes Code is not a second whole title for one of its sections.
 *
 * Every section on the page sits between two hidden markers,
 * `<div class="Comment">75c3353s</div>` before its text and `…75c3353v` before
 * the session laws that made it -- "(Nov. 9, 1977, P.L.226, No.69, eff. imd.;
 * … July 2, 2004, P.L.497, No.58, eff. imd.)" -- and the editors' notes; a
 * section never amended since 1976 has no second marker, and its text runs to
 * the next section's. `extract` keeps what is between them, a line per
 * paragraph, and drops the "§ 3353. Prohibitions in specified places." line
 * at the top, which is the listing's heading: the number on it would collide
 * with Title 18's (both titles have a § 6308), so the chunker is never asked
 * to recognise it.
 *
 * **The site serves an amendment as the text the day it is enacted, not the
 * day it takes effect.** § 1786 is served with the subsection (i) Act 3 of
 * 2026 added "eff. 18 months" from February 2026, and there is no copy of the
 * section without it. So `extract` reads each act on the section's history
 * line, works out the day it takes effect -- "eff. imd.", "eff. 60 days",
 * "eff. 16 months", "eff. Jan. 1, 2015" -- and refuses a section any act of
 * which is not yet in force, rather than commit the law of 2027 as the law
 * today. An act named with no effective date there takes the latest one the
 * same act has anywhere else on the page; one with none anywhere, enacted in
 * the last four years, is refused too. The one exception is § 102, below.
 *
 * Pennsylvania labels its subsections "(a)", "(a.1)", "(1)", "(1.1)", "(i)",
 * "(A)", a paragraph each, which the chunker reads as they are. Nothing in
 * the text is rewritten but whitespace; a table (the points schedule in
 * § 1535) is a line per row, its cells joined by a space.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.palegis.us/statutes/consolidated/'
const TITLE_75 = `${ORIGIN}view-statute?iFrame=true&txtType=HTM&ttl=75`

/**
 * The chapters of Title 75 a licence-holder is bound by. Out, and why: 11 is
 * the certificate of title and liens, a record of ownership rather than a
 * rule of driving; 16 the commercial driver's licence, which every state so
 * far has left out because its permit and alcohol rules crowd out the
 * ordinary ones; 18 insurance fraud, a crime against insurers; 19 the
 * department's schedule of fees; 20, 21 and 23 insurance rate review, motor
 * carriers' road-tax markers and the dealers' recovery fund; 49 size, weight
 * and load limits and the permits that lift them, motor-carrier regulation;
 * 61 the department's and local authorities' powers; 71 to 75 vehicle theft
 * and identification numbers, abandoned vehicles and messenger services; 77
 * and 77A snowmobiles, all-terrain vehicles and golf carts, kept off the
 * highway by their own rules; 78, 81 and 83 motor-carrier safety, interstate
 * compacts and hazardous materials; 79 and 80 the department's motorcycle
 * training and shared-ride programmes; 85 highly automated vehicles; 89 to
 * 98 the Turnpike, fuel taxes and highway funding.
 */
const TITLES: {
  title: '75' | '18'
  chapter: string
  name: string
  why: string
  /** Which sections are out, by number and catchline. */
  skip?: (section: string, heading: string) => boolean
  /** Which sections are in, where only a few of the chapter's are. */
  keep?: string[]
}[] = [
  { title: '75', chapter: '1', name: '75 Pa.C.S. Chapter 1: General Provisions', why: "the title's name and how it is read; its definitions (§ 102) are what the code means by a vehicle, a motorcycle, a highway or a driver" },
  {
    title: '75',
    chapter: '13',
    name: '75 Pa.C.S. Chapter 13: Registration of Vehicles',
    why: 'registration, plates and their display, disability plates and placards, and suspension of a registration',
    // Out: fleet and apportioned registration for carriers (1307.1, 1309.1),
    // the agents' and motor carriers' own duties (1318, 1319), the charity
    // check-offs on the form (1320 to 1324), dealers' and businesses' plates
    // (1335 to 1337.1, 1344.1, 1374), and the seventy specialty plates
    // (1339 to 1370) -- one per medal, cause or club, each its fee and design --
    // but for antique and classic plates (1340) and the veterans' placard (1342).
    skip: (section) => {
      const n = Number(section)
      if (section === '1340' || section === '1342') return false
      return (
        ['1307.1', '1309.1', '1318', '1319', '1344.1', '1374', '1375', '1378'].includes(section) ||
        (n >= 1320 && n < 1325) ||
        (n >= 1335 && n < 1338) ||
        (n >= 1339 && n < 1371)
      )
    },
  },
  { title: '75', chapter: '15', name: '75 Pa.C.S. Chapter 15: Licensing of Drivers', why: "licensing, the learner's permit, the junior licence and its limits, examination, points, suspension and chemical testing" },
  {
    title: '75',
    chapter: '17',
    name: '75 Pa.C.S. Chapter 17: Financial Responsibility',
    why: 'the insurance every vehicle must carry, the benefits it must pay, its proof, and what an uninsured judgment costs a driver',
    // Out: Subchapters D, E and F, the assigned risk plan, the assigned claims
    // plan and the repealed catastrophic loss fund -- how insurers share risk
    // among themselves, not a rule a driver is held to.
    skip: (section) => Number(section) >= 1741 && Number(section) < 1770,
  },
  { title: '75', chapter: '31', name: '75 Pa.C.S. Chapter 31: General Provisions (Operation of Vehicles)', why: 'obedience to police, traffic signals and signs, and how emergency vehicles and funerals are treated' },
  { title: '75', chapter: '33', name: '75 Pa.C.S. Chapter 33: Rules of the Road in General', why: 'the rules of the road: lanes, passing, right of way, turning and signalling, speed, school zones, stopping and parking' },
  { title: '75', chapter: '35', name: '75 Pa.C.S. Chapter 35: Special Vehicles and Pedestrians', why: 'pedestrians, bicycles, motorcycles and the riders a driver shares the road with' },
  { title: '75', chapter: '37', name: '75 Pa.C.S. Chapter 37: Miscellaneous Provisions', why: 'careless and reckless driving, phones and texting, littering, homicide by vehicle, and what a driver must do after a crash' },
  { title: '75', chapter: '38', name: '75 Pa.C.S. Chapter 38: Driving After Imbibing Alcohol or Utilizing Drugs', why: 'impaired driving, the alcohol limits for adults and minors, open containers, and their penalties' },
  { title: '75', chapter: '41', name: '75 Pa.C.S. Chapter 41: Equipment Standards', why: 'the standards a vehicle and its equipment must meet, and what may not be sold or fitted' },
  { title: '75', chapter: '43', name: '75 Pa.C.S. Chapter 43: Lighting Equipment', why: 'the lights a vehicle must have, when they must be on, and when high beams must be dimmed' },
  { title: '75', chapter: '45', name: '75 Pa.C.S. Chapter 45: Other Required Equipment', why: 'brakes, mirrors, horns, windows, tires, seat belts, child seats and headphones' },
  {
    title: '75',
    chapter: '47',
    name: '75 Pa.C.S. Chapter 47, Subchapter A: Inspection Requirements',
    why: 'the periodic inspection every vehicle must pass, and driving without a current certificate',
    // Out: the emissions programme's funding, commissions and committees
    // (4706 to 4710 but for motorcycles, 4708) and Subchapter B, the
    // appointment and running of inspection stations.
    skip: (section) => Number(section) >= 4721 || (Number(section) >= 4706 && section !== '4708'),
  },
  { title: '75', chapter: '63', name: '75 Pa.C.S. Chapter 63: Enforcement', why: 'citations, arrest, what a stopped driver must show, and fleeing a police officer' },
  { title: '75', chapter: '65', name: '75 Pa.C.S. Chapter 65: Penalties and Disposition of Fines', why: 'the fines and jail terms for breaking the rules above' },
  {
    title: '18',
    chapter: '63',
    name: '18 Pa.C.S. § 6308: Purchase, consumption, possession or transportation of liquor by minors',
    why: 'the purchase, consumption, possession or transport of alcohol by anyone under 21, codified in the Crimes Code',
    keep: ['6308'],
  },
]

/** "3353" -> "75 Pa.C.S. § 3353"; "18-6308" -> "18 Pa.C.S. § 6308". */
export function cite(section: string): string {
  const [title, number] = section.startsWith('18-') ? ['18', section.slice(3)] : ['75', section]
  return `${title} Pa.C.S. § ${number}`
}

/** A Title 18 section's own page, the frame its viewer loads. */
export function sectionUrl(title: string, chapter: string, section: string): string {
  const [whole, sub = '0'] = section.slice(chapter.length).split('.')
  return `${ORIGIN}view-statute?iFrame=true&txtType=HTM&ttl=${title}&div=0&chpt=${chapter}&sctn=${Number(whole)}&subsctn=${sub}`
}

/** "§ 3353. Prohibitions in specified places." and the chapter each entry sits under, from the page's table of contents. */
export function contentsOf(html: string): { chapter: string; section: string; heading: string }[] {
  const toc = blockOf(html, '75cc')
  if (toc === null) throw new Error('no table of contents on the Title 75 page')
  const lines: string[] = []
  for (const line of paragraphs(toc)) {
    // A long catchline wraps onto a second paragraph; it never starts a new entry.
    if (lines.length > 0 && !/^(§|Chapter |Subchapter |PART |TITLE |VEHICLES$)/.test(line)) lines[lines.length - 1] += ' ' + line
    else lines.push(line)
  }
  const out: { chapter: string; section: string; heading: string }[] = []
  let chapter = ''
  for (const line of lines) {
    const opens = /^Chapter (\w+)\.\s/.exec(line)
    if (opens !== null) chapter = opens[1]
    const entry = /^§ (\d+(?:\.\d+)?)\.\s+(.*?)\.?$/.exec(line)
    if (entry !== null) out.push({ chapter, section: entry[1], heading: entry[2] })
  }
  return out
}

const site: Site = {
  // The General Assembly's own publication of the Consolidated Statutes.
  official: ORIGIN,
  name: 'the Pennsylvania Consolidated Statutes',
  titles: TITLES.map(({ title, chapter, name, why }) => ({ id: `${title}c${chapter}`, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const page = (await fetchedPage(TITLE_75).page).body
    const contents = contentsOf(page)
    for (const title of TITLES) {
      const before = listings.length
      if (title.title === '75') {
        for (const { chapter, section, heading } of contents) {
          if (chapter !== title.chapter) continue
          // A repealed or expired section is its catchline alone: never listed.
          if (/\((Repealed|Expired|Reserved|Transferred|Renumbered|Deleted by amendment)\)$/i.test(heading)) continue
          if (title.skip?.(section, heading)) continue
          if (blockOf(page, `75c${section}s`) === null) throw new Error(`§ ${section} is in the contents but not on the page`)
          listings.push({ file: `75c${chapter}-${section.replace('.', '-')}`, url: `${TITLE_75}#${section}`, section, cite: cite(section), heading })
        }
      } else {
        for (const section of title.keep ?? []) {
          const url = sectionUrl(title.title, title.chapter, section)
          const block = blockOf((await fetchedPage(url).page).body, `${title.title}c${section}s`)
          if (block === null) throw new Error(`${url} serves no § ${section}`)
          const heading = /^§ [\d.]+\.\s+(.*?)\.?$/.exec(paragraphs(block)[0] ?? '')?.[1] ?? ''
          listings.push({ file: `${title.title}c${title.chapter}-${section.replace('.', '-')}`, url, section: `${title.title}-${section}`, cite: cite(`${title.title}-${section}`), heading })
        }
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    return listings
  },
  extract: (html, listing) => extractPaCS(html, listing),
}

export default site

/**
 * Sections whose pending amendment only deletes words, so every word the site
 * serves is in force today and the section is kept: Act 36 of 2026 strikes the
 * definition of "ignition interlock limited license" from § 102 ("2026
 * Amendment. Act 36 deleted the def. of …", effective 16 months from July
 * 2026), and the definitions a learner asks after -- a vehicle, a highway, a
 * motorcycle -- would otherwise be lost until November 2027. Keyed by the
 * pending acts, so any further amendment to § 102 is refused as any other is.
 */
const PENDING_DELETIONS: Record<string, string[]> = { '102': ['2026-36'] }

/**
 * One section's law in effect: the text between its two markers, a line per
 * paragraph, its catchline dropped -- or `Unavailable` where an act on its
 * history line is not yet in force (see the header).
 */
export function extractPaCS(html: string, listing: Pick<Listing, 'cite'>, today = new Date().toISOString().slice(0, 10)): string {
  const [, title, section] = /^(\d+) Pa\.C\.S\. § (\S+)$/.exec(listing.cite) ?? []
  if (section === undefined) throw new Error(`a citation this cannot read: ${listing.cite}`)
  const block = blockOf(html, `${title}c${section}s`)
  if (block === null) throw new Unavailable(`no § ${section} on the page`)
  const history = blockOf(html, `${title}c${section}v`)
  if (history !== null) {
    const pending = pendingActs(paragraphs(history)[0] ?? '', actDates(html), today)
    const allowed = PENDING_DELETIONS[section] ?? []
    const refused = pending.filter((act) => !allowed.includes(act.act))
    if (refused.length > 0) {
      const [first] = refused
      throw new Unavailable(`Act ${first.act.split('-')[1]} of ${first.act.split('-')[0]} is served as the text but takes effect ${first.effective}`)
    }
  }
  const lines = paragraphs(block)
  if (lines.length > 0 && lines[0].startsWith(`§ ${section}.`)) lines.shift()
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  return lines.join('\n') + '\n'
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12,
}
const DATE = /^(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}), ?(\d{4})/i
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

function isoOf(match: RegExpExecArray): string {
  const month = MONTHS[match[1].toLowerCase()]
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

function plus(iso: string, count: number, unit: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (/^day/.test(unit)) date.setUTCDate(date.getUTCDate() + count)
  else if (/^month/.test(unit)) date.setUTCMonth(date.getUTCMonth() + count)
  else date.setUTCFullYear(date.getUTCFullYear() + count)
  return date.toISOString().slice(0, 10)
}

interface Act {
  /** "2026-36": the year enacted and the act's number. */
  act: string
  enacted: string
  /** The day it takes effect, or null where the entry does not say. */
  effective: string | null
}

/** "(Nov. 9, 1977, P.L.226, No.69, eff. imd.; …; Feb. 11, 2026, P.L.4, No.3, eff. 18 months)" as its acts. */
export function actsOf(historyLine: string): Act[] {
  const text = historyLine.trim()
  if (!text.startsWith('(')) return []
  const acts: Act[] = []
  for (const raw of text.replace(/^\(|\)$/g, '').split(';')) {
    const entry = raw.trim()
    const date = DATE.exec(entry)
    const number = /No\.\s?(\d+)/.exec(entry)
    if (date === null || number === null) throw new Error(`a history entry this cannot read: "${entry}"`)
    const enacted = isoOf(date)
    const clause = entry
      .slice(number.index + number[0].length)
      .replace(/^\s*,\s*/, '')
      .replace(/^eff\.?\s*/, '')
      .trim()
    let effective: string | null
    const span = /^(\d+|one|two|three|four|five|six) (days?|months?|years?)\b/i.exec(clause)
    const on = DATE.exec(clause)
    if (clause === '') effective = null
    else if (/^imd\b/.test(clause)) effective = enacted
    else if (span !== null) effective = plus(enacted, NUMBERS[span[1].toLowerCase()] ?? Number(span[1]), span[2].toLowerCase())
    else if (on !== null) effective = isoOf(on)
    else throw new Error(`an effective date this cannot read: "${entry}"`)
    acts.push({ act: `${date[3]}-${number[1]}`, enacted, effective })
  }
  return acts
}

let datesFor: { html: string; dates: Map<string, string> } | null = null

/** Every act's latest effective date anywhere on the page: what an entry that names none falls back on. */
function actDates(html: string): Map<string, string> {
  if (datesFor?.html === html) return datesFor.dates
  const dates = new Map<string, string>()
  for (const [, tag] of html.matchAll(/<div class="Comment">(\d+c[\d.]+v)<\/div>/g)) {
    for (const act of actsOf(paragraphs(blockOf(html, tag) ?? '')[0] ?? '')) {
      if (act.effective !== null && act.effective > (dates.get(act.act) ?? '')) dates.set(act.act, act.effective)
    }
  }
  datesFor = { html, dates }
  return dates
}

/** The acts on a history line not in force on `today`, with the day each is. */
function pendingActs(historyLine: string, dates: Map<string, string>, today: string): { act: string; effective: string }[] {
  const recent = plus(today, -4, 'years')
  const pending: { act: string; effective: string }[] = []
  for (const act of actsOf(historyLine)) {
    const effective = act.effective ?? dates.get(act.act) ?? (act.enacted < recent ? act.enacted : 'on a date the page does not give')
    if (effective === 'on a date the page does not give' || effective > today) pending.push({ act: act.act, effective })
  }
  return pending
}

/** The HTML after a `<div class="Comment">` marker, up to the next one; null where the page has no such marker. */
function blockOf(html: string, marker: string): string | null {
  const open = `<div class="Comment">${marker}</div>`
  const start = html.indexOf(open)
  if (start < 0) return null
  const end = html.indexOf('<div class="Comment">', start + open.length)
  return html.slice(start + open.length, end < 0 ? html.length : end)
}

/**
 * A block's paragraphs, each one line; a table a line per row. The page wraps
 * a paragraph's source at about ninety characters, so its own line breaks are
 * whitespace: only the tags end a line.
 */
function paragraphs(block: string): string[] {
  const flat = block
    .replace(/\s+/g, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => table.replace(/<\/p>|<\/td>|<br\s*\/?>/gi, ' ').replace(/<\/tr>/gi, '\n'))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decode(flat)
    .split('\n')
    .map((line) => line.replace(/[\s  ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
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
