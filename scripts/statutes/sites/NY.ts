/**
 * New York: the Consolidated Laws as the Legislature publishes them through
 * the Senate's Open Legislation service (legislation.nysenate.gov), whose text
 * is the Legislative Bill Drafting Commission's own. A PDF `enumerate`: every
 * article and every section is served as a PDF at /pdf/laws/<law><location>/
 * with no key, where the JSON API behind the same service answers every
 * request without one "A valid API key is needed" (error 701) and the
 * Senate's HTML pages answer a script with a Cloudflare challenge. The
 * Assembly's "Laws of New York" link goes to the Commission's LRS, a reader
 * driven by JavaScript form posts.
 *
 * An article's PDF is its table of sections ("Section 1210.   Unattended motor
 * vehicle."); `enumerate` reads one per article. A section's PDF opens on its
 * number and catchline ("§ 1202. Stopping, standing or parking…") and holds
 * nothing but the law: no history note, no annotations. An id the service does
 * not know is answered with the law's preamble rather than a 404, so `extract`
 * refuses any page that does not open on the section it was asked for.
 *
 * The Commission marks text that is not simply in force with asterisks: a
 * starred paragraph ("* 3.", "** 3.", "* § 1180-b.") runs to a note under it,
 * "* NB Effective May 26, 2027", "* NB Repealed July 1, 2030". A section
 * amended for a later date is served as both versions, each closed by its note.
 * `extract` keeps a starred passage only if its note says it is in effect on
 * the day it runs, drops the notes (editor's notes, not law) and the asterisks
 * (markers, not words), so a quote is never the law of 2027 presented as
 * today's.
 *
 * The PDF wraps each paragraph at a fixed width and opens a new one with a
 * two-space indent; `extract` joins a paragraph's lines with a space and puts
 * the catchline on a line of its own, so the first subsection opens a line as
 * every other does -- whitespace only, never a word. A form feed where a page
 * breaks is dropped.
 */
import { fetchedPage } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://legislation.nysenate.gov/'
const pdfUrl = (location: string) => `${ORIGIN}pdf/laws/${location}/`

type Law = 'VAT' | 'ABC' | 'PEN'
const LAWS: Record<Law, string> = { VAT: 'Veh. & Traf. Law', ABC: 'Alco. Bev. Cont. Law', PEN: 'Penal Law' }

/**
 * The parts of the Vehicle and Traffic Law a licence-holder is bound by, by
 * title and article. Out, and why: Title II is the Department of Motor
 * Vehicles and its adjudication bureaus; in Title III, Article 4 is how the
 * title applies, 5 the inspection stations, 5-A empty, 8 for-hire passenger
 * bonds, 10 sizes and weights for carriers, 12 a miscellany of inspection,
 * tolls, investigators and schools, and 12-A to 12-D repair shops and the
 * course programmes the department approves; in Title IV, 14-A and 14-B
 * carriers' fee apportionment, 15-A agricultural reciprocity, 16 and 17-A
 * dealers and the non-driver identity card, 17-B for-hire operators, 17-C a
 * regional fee; in Title V, 19-A bus drivers and 19-B commercial motor
 * carriers -- left out as every state's commercial licensing has been: their
 * permit and alcohol rules crowd out the ordinary ones -- 21-B the medical
 * advisory board and 21-C escort vehicles; Title VIII the powers of state and
 * local authorities; Title X the certificate-of-title act for owners, dealers
 * and lienholders; Title XI snowmobiles, vessels and all-terrain vehicles off
 * the highway; Title XII how the chapter takes effect.
 */
const TITLES: { law: Law; title?: string; articles?: string[]; only?: string[]; id: string; name: string; why: string }[] = [
  { law: 'VAT', title: 'T1', articles: ['1'], id: 'vat-t1', name: 'Vehicle and Traffic Law, Title I: Words and Phrases Defined', why: 'what the law means by a vehicle, a motorcycle, a highway or a driver' },
  {
    law: 'VAT',
    title: 'T3',
    articles: ['6', '7', '9', '11'],
    id: 'vat-t3',
    name: 'Vehicle and Traffic Law, Title III, Articles 6, 7, 9 and 11: Financial Security, Safety Responsibility, Equipment and Civil Liability',
    why: 'the insurance every vehicle must carry, lights, belts, child seats and the equipment a vehicle must have, and who answers for a crash',
  },
  {
    law: 'VAT',
    title: 'T4',
    articles: ['13', '14', '15', '17'],
    id: 'vat-t4',
    name: 'Vehicle and Traffic Law, Title IV, Articles 13 to 15 and 17: Registration of Vehicles',
    why: 'registration and plates every owner must hold',
  },
  {
    law: 'VAT',
    title: 'T5',
    articles: ['18', '19', '20', '21', '21-A'],
    id: 'vat-t5',
    name: "Vehicle and Traffic Law, Title V, Articles 18 to 21-A: Drivers' Licenses",
    why: "licensing, the learner's permit and the junior licence and their limits, suspension and revocation, and the restricted licence",
  },
  { law: 'VAT', title: 'T6', articles: ['22'], id: 'vat-t6', name: 'Vehicle and Traffic Law, Title VI: Accidents and Accident Reports', why: 'what a driver must do after a crash' },
  {
    law: 'VAT',
    title: 'T7',
    articles: ['23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '34-A', '34-B', '34-C', '34-D'],
    id: 'vat-t7',
    name: 'Vehicle and Traffic Law, Title VII: Rules of the Road',
    why: 'the rules of the road: signals, right of way, speed, school buses, impaired driving, parking, phones, seat belts, bicycles and motorcycles',
  },
  { law: 'VAT', title: 'T9', articles: ['45'], id: 'vat-t9', name: 'Vehicle and Traffic Law, Title IX: Penalties and Disposition of Fines and Forfeitures', why: 'the fines and jail terms for breaking the rules above' },
  {
    law: 'ABC',
    only: ['65-b', '65-c'],
    id: 'abc',
    name: 'Alcoholic Beverage Control Law §§ 65-b and 65-c',
    why: 'underage purchase and possession of alcohol, codified outside the Vehicle and Traffic Law',
  },
  {
    law: 'PEN',
    only: ['120.03', '120.04', '120.04-a', '125.12', '125.13', '125.14'],
    id: 'pen',
    name: 'Penal Law §§ 120.03 to 120.04-a and 125.12 to 125.14',
    why: 'vehicular assault and vehicular manslaughter, codified in the Penal Law',
  },
]

/** The state's own citation form: "N.Y. Veh. & Traf. Law § 1202". */
export function cite(section: string, law: Law = 'VAT'): string {
  return `N.Y. ${LAWS[law]} § ${section}`
}

/** "1180-b" -> "1180-B", the service's location id. */
const location = (section: string) => section.toUpperCase()

/**
 * An article's table of sections: "Section 1210.   Unattended motor vehicle."
 * and then "        1211.   Limitations on backing.", a long catchline
 * wrapping onto a deeper-indented line with no number.
 */
export function tableOf(text: string): { section: string; heading: string }[] {
  const out: { section: string; heading: string }[] = []
  let open = false
  for (const raw of text.replace(/\f/g, '').split('\n')) {
    const entry = /^\s*(?:Section\.?\s*)?(\d+(?:-[a-z]{1,2}\d*)?(?:\*)?)\.\s+(\S.*)$/.exec(raw)
    if (entry !== null) {
      out.push({ section: entry[1].replace(/\*$/, ''), heading: entry[2].trim() })
      open = !/\.\s*$/.test(entry[2])
      continue
    }
    if (open && out.length > 0 && raw.trim() !== '') {
      out[out.length - 1].heading += ` ${raw.trim()}`
      open = !/\.\s*$/.test(raw)
    } else open = false
  }
  return out
}

const site: Site = {
  // The Senate's Open Legislation service publishes the Legislature's text of the consolidated laws.
  official: ORIGIN,
  name: 'the New York Vehicle and Traffic Law',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const title of TITLES) {
      if (title.only !== undefined) {
        for (const section of title.only) {
          listings.push({ file: `${title.id}-${section}`, url: pdfUrl(`${title.law}${location(section)}`), section, cite: cite(section, title.law), heading: '' })
        }
        continue
      }
      for (const article of title.articles ?? []) {
        const { page } = fetchedPage(pdfUrl(`${title.law}${title.title}A${article}`))
        const table = tableOf((await page).body)
        // An article read as nothing would otherwise let the fetch report "every listed section present".
        if (table.length === 0) throw new Error(`Article ${article} of the ${title.law} lists no sections`)
        for (const { section, heading } of table) {
          listings.push({
            file: `${title.id}-${section}`,
            url: pdfUrl(`${title.law}${location(section)}`),
            section,
            cite: cite(section, title.law),
            heading: heading.replace(/\.$/, ''),
          })
        }
      }
    }
    return listings
  },
  extract: (text, listing) => extractNy(text, listing.section, listing.heading),
}

export default site

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DATE = new RegExp(`(${MONTHS.join('|')}) (\\d{1,2}), (\\d{4})`)

function dateIn(note: string): string | null {
  const match = DATE.exec(note)
  if (match === null) return null
  const month = String(MONTHS.indexOf(match[1]) + 1).padStart(2, '0')
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`
}

/**
 * Whether the passage a "* NB …" note closes is law on `today`. "Effective
 * until <date>", "Repealed <date>", "Expires <date>": until that date.
 * "Effective <date>": from it. "Effective upon …" with no date waits on an
 * event the text cannot show has happened, so it is not kept. Anything else
 * ("There are 2 sub. 21-h's", "Repealed upon conditions …") leaves the
 * passage as it is: in force.
 */
export function inEffect(note: string, today: string): boolean {
  const date = dateIn(note)
  if (/^(Effective until|Repealed|Expires|Expired|Deemed repealed)\b/i.test(note)) return date === null || date > today
  if (/^Effective\b/i.test(note)) return date !== null && date <= today
  return true
}

/**
 * The text of a New York section as the service's PDF reads through
 * `pdftotext -layout`: paragraphs joined, catchline on its own line, and only
 * the text in effect today.
 */
export function extractNy(text: string, section: string, heading = '', today = new Date().toISOString().slice(0, 10)): string {
  const lines = text.replace(/\f/g, '').split('\n')
  // Paragraphs: a line indented by two spaces opens one, a line at the margin
  // continues it -- across blank lines too, which is how a page break reads.
  const paragraphs: string[] = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    if (paragraphs.length === 0 || /^\s/.test(raw)) paragraphs.push(raw.trim())
    else {
      const last = paragraphs.length - 1
      // A line broken after a hyphen ("seventy-" / "five") is one word.
      paragraphs[last] = /-$/.test(paragraphs[last]) ? paragraphs[last] + raw.trim() : `${paragraphs[last]} ${raw.trim()}`
    }
  }
  const plain = escaped(section)
  const opening = new RegExp(`^\\*{0,3} ?§ ${plain}\\.?\\s`, 'i')
  if (paragraphs.length === 0 || !opening.test(paragraphs[0])) {
    // The service answers an id it does not hold with the law's preamble.
    throw new Unavailable(`the service does not open on § ${section}: "${(paragraphs[0] ?? '').slice(0, 60)}"`)
  }

  // A star can open a passage mid-line, after a catchline or a label: "§ 502.
  // Requirements for licensing. * 1. Application…", "2. Age. * (a) An
  // applicant…". The passage starts a line of its own there.
  const parts = paragraphs.flatMap((paragraph) => paragraph.split(/\s(?=\*+ (?:\(\w{1,4}\)|\d{1,3}(?:-[a-z]{1,2})?\.|[a-z]\.)\s)/))

  // Starred passages, each closed by the notes under it -- one or several,
  // "* NB Effective May 26, 2027" then "* NB Repealed July 1, 2032" -- which
  // close the passage opened last. It is law only if every note says so.
  const keep = parts.map(() => true)
  const note = parts.map((paragraph) => /^\*+ ?NB\b/.test(paragraph))
  const starts: number[] = []
  for (let index = 0; index < parts.length; index += 1) {
    if (!note[index]) {
      if (/^\*+ /.test(parts[index])) starts.push(index)
      continue
    }
    let end = index
    while (end + 1 < parts.length && note[end + 1]) end += 1
    const notes = parts.slice(index, end + 1).map((paragraph) => paragraph.replace(/^\*+ ?NB\s*/, ''))
    const start = starts.pop()
    if (start !== undefined && !notes.every((each) => inEffect(each, today))) for (let at = start; at < index; at += 1) keep[at] = false
    index = end
  }
  const law = parts.filter((_, index) => keep[index] && !note[index]).map((paragraph) => paragraph.replace(/^\*+ ?/, ''))
  if (law.length === 0) throw new Unavailable(`§ ${section} has no text in effect on ${today}`)

  // The catchline on its own line, "§ 1202. Stopping, standing or parking
  // prohibited in specified places.", found by the table's catchline where it
  // matches and otherwise by the first label after it. Where a definition in
  // prose comes first and the first label follows it on the same line, as in
  // § 1197, that label opens a line too.
  const first = '(?:\\((?:a|1)\\)|1\\.|a\\.)\\s'
  const catchline = escaped(heading).replace(/\s+/g, '\\s+')
  const named = heading === '' ? null : new RegExp(`^(§ ${plain}\\.?\\s+${catchline}\\.)\\s+(\\S.*)$`).exec(law[0])
  const split = named ?? new RegExp(`^(§ ${plain}\\.?\\s+.*?\\.)\\s+(${first}.*)$`).exec(law[0])
  if (split !== null) {
    const prose = new RegExp(`^(?!${first})(.*?\\.)\\s+(${first}.*)$`).exec(split[2])
    law.splice(0, 1, split[1], ...(prose === null ? [split[2]] : [prose[1], prose[2]]))
  }
  return law.join('\n') + '\n'
}
