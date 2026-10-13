/**
 * Minnesota: Minnesota Statutes as the Office of the Revisor of Statutes
 * publishes them (revisor.mn.gov), the official publication of the State. A
 * chapter-page `enumerate`: each chapter's `/full` page holds every section of
 * it, so a chapter is one request however many sections it has.
 *
 * The committed unit is a **subdivision**, not a section. Minnesota divides a
 * section into "Subdivision 1.", "Subd. 2." and lettered paragraphs inside
 * each, and the paragraphs start again at "(a)" in every subdivision. Read as
 * one file, § 169.34's "Subd. 2." is no label the chunker knows, and its "(a)"
 * does not follow subdivision 1's "(d)" -- so the owner's-liability rule of
 * subdivision 2 rode inside 1(d) and was cited as it. One file per
 * subdivision, cited "Minn. Stat. § 169.34, subd. 1", makes every chunk's
 * citation the State's own form: "§ 169.34, subd. 1(a)(4)". Its address is
 * the revisor's own permalink anchor for the subdivision, on the chapter page.
 *
 * The subdivision's number and headnote ("Subd. 2. Violation; penalty for
 * owner or lessee.") go into `heading`, not the text: headnotes are not part
 * of the law (Minn. Stat. § 645.49), and the number is the citation's.
 *
 * The revisor publishes the text in force and no second, future version of a
 * subdivision beside it; dated amendments are explained in a NOTE after the
 * section's history, which is the publisher's and is dropped with it. A
 * subdivision kept only as "[Repealed, …]", "[Renumbered …]" or "[Expired]"
 * is no law and is not listed.
 */
import { bodyLines } from '../../../worker/src/code-chunks'
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.revisor.mn.gov/statutes/'

/**
 * A range of sections by the digits after the point, read as the decimal they
 * are: 169.881 falls after 169.88 and before 169.89, not after 169.8296.
 */
const between = (low: string, high: string) => (number: string) =>
  Number(`0.${number}`) >= Number(`0.${low}`) && Number(`0.${number}`) <= Number(`0.${high}`)
const not = (test: (number: string) => boolean) => (number: string) => !test(number)
const any = (...tests: ((number: string) => boolean)[]) => (number: string) => tests.some((test) => test(number))
const only = (...numbers: string[]) => (number: string) => numbers.includes(number)

/**
 * The chapters a licence-holder is bound by, by the number after the chapter's
 * point ("34" of 169.34). Out, and why: chapter 168A is certificates of title,
 * a lienholder's registry; within chapter 169, school bus body and chassis
 * construction standards (169.4501–169.4504), commercial vehicle inspection
 * (169.781–169.783) and the axle-weight schedules and oversize and haul
 * permits for carriers (169.801, 169.812, 169.822–169.8296, 169.85–169.872); within 168, the
 * special and commemorative plate programs (168.121–168.1299), dealers
 * (168.27, 168.274–168.277), the registrar's own office and fees (168.0135,
 * 168.016, 168.057, 168.325–168.327, 168.33, 168.381), interstate carrier
 * registration (168.185–168.221), manufacturers (168.25, 168.26), intercity
 * buses and rental fleets (168.61–168.65, 168.841–168.846); within 171,
 * commercial driver licensing (171.161–171.169, 171.324), the department and
 * its agents (171.015, 171.017, 171.061, 171.26), blindness-benefit records
 * (171.31, 171.32), and the licensing of driver training schools
 * (171.33–171.41); of chapter 65B, everything but the no-fault act's rules on
 * the security every owner must carry; of chapter 340A, everything but the
 * under-21 offences.
 */
const TITLES: { chapter: string; id: string; name: string; why: string; keep: (number: string) => boolean }[] = [
  {
    chapter: '169',
    id: '169',
    name: 'Chapter 169: Traffic Regulations (except bus construction, commercial inspection, axle weights and haul permits)',
    why: 'the definitions and rules of the road -- speed, right of way, parking, school buses, signals, equipment, belts and child seats, phones, collisions, proof of insurance and penalties',
    keep: not(any(between('4501', '4504'), between('781', '783'), only('801', '812'), between('822', '8296'), between('85', '872'))),
  },
  {
    chapter: '169A',
    id: '169A',
    name: 'Chapter 169A: Driving While Impaired',
    why: 'impaired driving, the alcohol concentrations, underage drinking and driving, open bottles, implied consent and its revocations',
    keep: () => true,
  },
  {
    chapter: '171',
    id: '171',
    name: "Chapter 171: Drivers' Licenses and Training Schools (except commercial licensing, the department's agents and the licensing of schools)",
    why: "licences, the instruction permit, the provisional licence and its limits, driver education content, suspension, revocation and driving without a licence",
    keep: not(any(between('161', '169'), only('324', '015', '017', '061', '26', '31', '32'), between('33', '41'))),
  },
  {
    chapter: '168',
    id: '168',
    name: 'Chapter 168: Vehicle Registration, Taxation, Sale (except special plates, dealers, the registrar and carrier registration)',
    why: 'registration, the certificate, plates and tabs and their display, temporary permits and the offences against them',
    keep: not(
      any(
        between('121', '1299'),
        only('27', '0135', '016', '057', '33', '381', '25', '26'),
        between('274', '277'),
        between('325', '327'),
        between('185', '221'),
        between('61', '65'),
        between('841', '846'),
      ),
    ),
  },
  {
    chapter: '65B',
    id: '65B',
    name: 'Chapter 65B (§§ 65B.43, 65B.44, 65B.48, 65B.482, 65B.49): No-Fault Automobile Insurance',
    why: 'the insurance every owner must carry, its minimum coverages and the insurance card',
    keep: only('43', '44', '48', '482', '49'),
  },
  {
    chapter: '340A',
    id: '340A',
    name: 'Chapter 340A (§ 340A.503): Persons Under 21; Illegal Acts',
    why: "underage possession and consumption of alcohol, codified in the liquor chapter",
    keep: only('503'),
  },
]

/** "169.34, subd. 1" -> "Minn. Stat. § 169.34, subd. 1", the form Minnesota's courts cite. */
export function cite(section: string): string {
  if (!/^\d+[A-Z]?\.\d+(, subd\. \w+)?$/.test(section)) throw new Error(`not a Minnesota section: ${section}`)
  return `Minn. Stat. § ${section}`
}

const chapterUrl = (chapter: string) => `${ORIGIN}cite/${chapter}/full`

/**
 * A paragraph kept only as a pointer or a marker: "[Repealed, 2014 c 255 s 21]",
 * "MS 2023 Supp [Repealed, 2024 c 104 art 1 s 110]", "(c) [Renumbered subd 38]",
 * "[Expired]" -- or "Never effective. See Laws 1991 c 291 art 19 s 11".
 */
const GONE = /^((MS \d{4}( Supp)? )?\[(Repealed|Renumbered|Expired|Obsolete|Reserved)\b[^\]]*\]\.?|Never effective\b.*)$/i

/** Whether every paragraph is such a marker, its labels set aside: 171.01, subd. 18 is "(a) (b) [Renumbered subd 49]" and "(c) [Renumbered subd 38]". */
const allGone = (lines: string[]) => lines.every((line) => GONE.test(line.replace(/^(\([a-z0-9]+\)\s*)+/, '')))

interface Subdivision {
  /** As the anchor writes it: "1", "5a". */
  number: string
  /** "Subdivision 1. Prohibitions." */
  head: string
  lines: string[]
}

interface Section {
  number: string
  /** "PROHIBITIONS; STOPPING, PARKING." */
  catchline: string
  /** The section's own text where it has no subdivisions; empty where it has. */
  lines: string[]
  subdivisions: Subdivision[]
}

/**
 * Every section in force on a chapter page: the `<div class="section">` blocks.
 * Repealed sections are `<div class="sr">` and sections whose subdivisions are
 * all gone are `<div class="sr_by_subd">`, so neither is read.
 */
export function sectionsOf(html: string): Section[] {
  const out: Section[] = []
  for (const match of html.matchAll(/<div class="section" id="stat\.([^"]+)">/g)) {
    const start = match.index! + match[0].length
    const end = html.indexOf('<div class="history"', start)
    if (end < 0) throw new Error(`§ ${match[1]}: no history after the section, the page changed shape`)
    const block = html.slice(start, end)
    const shn = /<h1 class="shn">([\s\S]*?)<\/h1>/.exec(block)
    if (shn === null) throw new Error(`§ ${match[1]}: no catchline`)
    const catchline = linesOf(shn[1]).join(' ').replace(new RegExp(`^${match[1].replace(/\./g, '\\.')}\\s+`), '')
    const parts = block.slice(shn.index + shn[0].length).split(/(?=<div class="subd" id=")/)
    const lead = linesOf(parts[0])
    const subdivisions: Subdivision[] = []
    for (const part of parts.slice(1)) {
      const id = /^<div class="subd" id="stat\.[^"]*?\.([^."]+)">/.exec(part)
      const head = /<h2 class="subd_no">([\s\S]*?)<\/h2>/.exec(part)
      if (id === null || head === null) throw new Error(`§ ${match[1]}: a subdivision without its anchor or number`)
      const lines = linesOf(part.slice(head.index + head[0].length))
      if (lines.length === 0 || allGone(lines)) continue
      subdivisions.push({ number: id[1], head: linesOf(head[1].replace(/<span class="headnote">/, ' ')).join(' '), lines })
    }
    // Text above the first subdivision would ride with no subdivision's citation; none is published that way today.
    if (parts.length > 1 && lead.length > 0) throw new Error(`§ ${match[1]}: text before its first subdivision: ${lead[0]}`)
    out.push({ number: match[1], catchline, lines: parts.length > 1 || allGone(lead) ? [] : lead, subdivisions })
  }
  return out
}

const site: Site = {
  // The revisor's site carries "Official Publication of the State of Minnesota" under every section.
  official: ORIGIN,
  name: 'Minnesota Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      // Through the fetch's own cache, so the fetch that follows reads each chapter page from memory, not the revisor.
      const { page } = fetchedPage(chapterUrl(spec.chapter))
      const sections = sectionsOf((await page).body)
      if (sections.length === 0) throw new Error(`chapter ${spec.chapter}'s page holds no sections: the page changed shape`)
      for (const each of sections) {
        if (!spec.keep(each.number.slice(spec.chapter.length + 1))) continue
        if (each.subdivisions.length === 0) {
          if (each.lines.length === 0) continue
          // A one-line section that names its own number -- § 169.727, "Any person who violates the
          // provisions of sections 169.721 to 169.727 … is guilty of a petty misdemeanor." -- reads to the
          // chunker as a heading over no law, so it would be committed and never chunked.
          if (bodyLines({ text: each.lines.join('\n'), section: each.number }).length === 0) {
            console.log(`MN § ${each.number} left out: its one line names its own number, and the chunker reads it as a heading`)
            continue
          }
          listings.push({
            file: `${spec.id}-${each.number}`,
            url: `${chapterUrl(spec.chapter)}#stat.${each.number}`,
            section: each.number,
            cite: cite(each.number),
            heading: each.catchline,
          })
          continue
        }
        for (const subdivision of each.subdivisions) {
          const section = `${each.number}, subd. ${subdivision.number}`
          listings.push({
            file: `${spec.id}-${each.number}-${subdivision.number}`,
            url: `${chapterUrl(spec.chapter)}#stat.${each.number}.${subdivision.number}`,
            section,
            cite: cite(section),
            heading: `${each.catchline} ${subdivision.head}`,
          })
        }
      }
    }
    return listings
  },
  extract: (body, listing) => extractMinnesota(body, listing.url),
}

export default site

/** The text of the section or subdivision a listing's anchor names, a line per paragraph. */
export function extractMinnesota(html: string, url: string): string {
  const anchor = /#stat\.(\d+[A-Z]?\.\d+)(?:\.(\w+))?$/.exec(url)
  if (anchor === null) throw new Error(`${url}: no section anchor`)
  const [, number, subdivision] = anchor
  const section = sectionsOf(html).find((each) => each.number === number)
  if (section === undefined) throw new Unavailable(`§ ${number} is not in force on the chapter page`)
  const lines = subdivision === undefined ? section.lines : section.subdivisions.find((each) => each.number === subdivision)?.lines
  if (lines === undefined || lines.length === 0) throw new Unavailable(`§ ${number}${subdivision === undefined ? '' : `, subd. ${subdivision}`} has no text in force`)
  return lines.join('\n') + '\n'
}

/**
 * A fragment's paragraphs, one line each: a new line at every paragraph and
 * table row, the permalink "§" and the revisor's "[See Note.]" dropped, tags
 * dropped, spaces folded.
 */
function linesOf(fragment: string): string[] {
  return decode(
    fragment
      .replace(/\s+/g, ' ')
      .replace(/<a [^>]*class="permalink"[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<p class="see_note">[\s\S]*?<\/p>/g, '')
      .replace(/<\/(p|tr|h1|h2|li)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\r ]+/g, ' ').trim())
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
    .replace(/&frac12;/g, '½')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
