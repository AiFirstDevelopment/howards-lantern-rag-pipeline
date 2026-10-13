/**
 * North Carolina: the General Statutes as the General Assembly publishes them
 * (ncleg.gov). An index-page `enumerate`, as Maryland's: a chapter's
 * `GeneralStatuteSections` page lists every section under its article with
 * its number and catchline, and each section has an HTML page of its own.
 *
 * The section page carries no annotations: the bold number and catchline open
 * it (they are the listing's `heading`) and the session-law history closes its
 * last paragraph, and `extract` drops both. What is not yet in effect is
 * served inside the section, a subsection at a time: "(c) (Effective until
 * January 1, 2027) …" followed by "(c) (Effective January 1, 2027) …", or "(3a)
 * (Effective once contingency met - see note) …". `extract` keeps the version
 * in effect on the day it runs and drops the other, so a quote found only in
 * the 2027 copy is never filed as today's law -- and `statutes:check` reports
 * the section as changed on the day the new version takes effect, which is
 * when it has.
 *
 * North Carolina inserts subsections as "(a1)", "(d1)" and paragraphs as
 * "(6a)", and writes its third level "a.", "b.". The chunker reads none of
 * these as labels, so each rides inside the label above it and is cited as
 * that one: § 20-11(a1) as § 20-11(a). Whitespace cannot make them labels, and
 * the text is not rewritten.
 */
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.ncleg.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Which of an article's sections are in, by number ("20-162"). */
type Keep = (section: string) => boolean
const all: Keep = () => true
const except = (...numbers: string[]): Keep => (section) => !numbers.includes(section)
const only = (...numbers: string[]): Keep => (section) => numbers.includes(section)

/**
 * The articles of Chapter 20, Motor Vehicles, a licence-holder is bound by,
 * and the one section of Chapter 18B a young driver is. Out, and why: Article
 * 1 is the Division itself but for its definitions (§ 20-4.01); 1A and 1B are
 * the Commissioner's reciprocity agreements; 2B is identification cards for
 * people who do not drive; 2C is commercial driver licensing, as every state
 * so far leaves out; 3B to 3D are weigh stations, the equipment compact and
 * licence-plate readers; 4 is the Highway Patrol; 6A, 10, 10A, 10B, 11, 16 and
 * 17 are carriers, taxicabs, ride-hailing, car sharing, rental companies,
 * housemovers and motor carrier safety; 7A and 7B are towing companies; 12,
 * 12A, 15 and 15A are dealers, manufacturers, finance sources, odometers and
 * warranties; 13A is insurers' filings; 14 is driving schools; 15B is repair
 * shops; 18 is the makers of fully autonomous vehicles. Articles 5, 6, 8, 8A
 * and 9 are repealed.
 *
 * Within the kept articles: the Compact's administration (§§ 20-4.28 to
 * 20-4.30); in Article 3, the Division's offices, records and powers (§§
 * 20-39 to 20-49.3), lenders' security interests (§§ 20-58 to 20-58.10),
 * dealer, transporter and special plates and the registration fees and taxes
 * (§§ 20-79 to 20-79.02, 20-79.2 to 20-81.12, 20-84 to 20-99), dealers' fee
 * disclosures (§§ 20-101.1 to 20-101.3), rental fraud and sublease brokers
 * (§§ 20-106.1, 20-106.2), size, weight and haul permits (§§ 20-115 to 20-121
 * but for the flag on a load, § 20-117), the Secretary's abandoned-vehicle
 * program (§§ 20-137.6 to 20-137.14), commercial-vehicle alcohol offences
 * (§§ 20-138.2 to 20-138.2C), explosives and nuclear fuel carriers (§§ 20-167,
 * 20-167.1), delivery robots (§§ 20-175.15 to 20-175.18) and the Department
 * of Public Safety's carrier penalties (§ 20-178.1); in Article 3A, inspection
 * stations' licences, fees and discipline (all but §§ 20-183.2 to 20-183.3,
 * 20-183.4C to 20-183.5A, 20-183.8 and 20-183.8A, which bind the owner);
 * booting businesses and dealer reports in Article 7 (§§ 20-219.3A, 20-219.5);
 * insurers' notices and the Commissioner's duties in Article 13 (§§ 20-309.2,
 * 20-314, 20-315, 20-319). A section titled only "Title of Article." or "Short
 * title." states no rule and is left out with them.
 */
const TITLES: {
  id: string
  chapter: string
  article: string
  name: string
  why: string
  keep: Keep
  /**
   * Runs of sections left out, first and last inclusive, by their place in the
   * index: North Carolina's numbers do not sort as numbers or as decimals --
   * § 20-79.02 comes before § 20-79.1, and § 20-58.10 after § 20-58.9.
   */
  out?: [string, string][]
}[] = [
  {
    id: 'art1',
    chapter: '20',
    article: '1',
    name: 'Chapter 20, Article 1 (§ 20-4.01): Definitions',
    why: 'what the code means by a vehicle, a moped, a highway, a driver and a public vehicular area',
    keep: only('20-4.01'),
  },
  {
    id: 'art1C',
    chapter: '20',
    article: '1C',
    name: 'Chapter 20, Article 1C: Drivers License Compact',
    why: "how a conviction in another state counts against a North Carolina licence, and one licence per driver",
    keep: except('20-4.28', '20-4.29', '20-4.30'),
  },
  {
    id: 'art2',
    chapter: '20',
    article: '2',
    name: "Chapter 20, Article 2: Uniform Driver's License Act",
    why: "licences, the limited learner's permit and provisional licence for drivers under 18, points, suspension, revocation and driving while revoked",
    // § 20-18 is one line, "Conviction of offenses described in G.S. 20-181 shall not be cause for…": the
    // chunker reads a short unlabelled line holding its own number as the section's heading, and "20-181"
    // holds "20-18", so the section committed as no law at all.
    keep: except('20-18'),
  },
  {
    id: 'art2A',
    chapter: '20',
    article: '2A',
    name: 'Chapter 20, Article 2A: Afflicted, Disabled or Handicapped Persons',
    why: 'disabled parking placards and plates and who may park in the spaces',
    keep: all,
  },
  {
    id: 'art2D',
    chapter: '20',
    article: '2D',
    name: 'Chapter 20, Article 2D: Implied-Consent Offense Procedures',
    why: 'what happens to a driver charged with impaired driving: the chemical test, pretrial release and the revocation that follows',
    keep: all,
  },
  {
    id: 'art3',
    chapter: '20',
    article: '3',
    name: 'Chapter 20, Article 3: Motor Vehicle Act of 1937 (registration, equipment and the rules of the road)',
    why: 'registration, title and plates; lights, brakes, belts, child seats and phones; impaired driving, speed, passing, right of way, parking, crashes, pedestrians and bicycles; and the penalties',
    keep: except('20-106.1', '20-106.2', '20-138.2', '20-138.2A', '20-138.2B', '20-138.2C', '20-167', '20-167.1', '20-178.1'),
    out: [
      ['20-39', '20-49.3'],
      ['20-58', '20-58.10'],
      ['20-79', '20-79.02'],
      ['20-79.2', '20-81.12'],
      ['20-84', '20-99'],
      ['20-101.1', '20-101.3'],
      ['20-115', '20-116'],
      ['20-117.1', '20-121'],
      ['20-137.6', '20-137.14'],
      ['20-175.15', '20-175.18'],
    ],
  },
  {
    id: 'art3A',
    chapter: '20',
    article: '3A',
    name: 'Chapter 20, Article 3A: Safety and Emissions Inspection Program (what binds the owner)',
    why: 'which vehicles must be inspected, when, and the penalties for driving one uninspected',
    keep: only('20-183.2', '20-183.3', '20-183.4C', '20-183.4D', '20-183.5', '20-183.5A', '20-183.8', '20-183.8A'),
  },
  {
    id: 'art7',
    chapter: '20',
    article: '7',
    name: 'Chapter 20, Article 7: Miscellaneous Provisions Relating to Motor Vehicles',
    why: 'stopping for a school bus, passing horses, school bus speed limits and towing from private lots',
    keep: except('20-219.3A', '20-219.5'),
  },
  {
    id: 'art9A',
    chapter: '20',
    article: '9A',
    name: 'Chapter 20, Article 9A: Motor Vehicle Safety and Financial Responsibility Act of 1953',
    why: "the insurance policy's minimum limits, and the proof of responsibility and suspension after a crash or judgment",
    keep: all,
  },
  {
    id: 'art13',
    chapter: '20',
    article: '13',
    name: 'Chapter 20, Article 13: The Vehicle Financial Responsibility Act of 1957',
    why: 'the insurance every registered vehicle must carry throughout registration, and the penalty for driving without it',
    keep: except('20-309.2', '20-314', '20-315', '20-319'),
  },
  {
    id: '18B',
    chapter: '18B',
    article: '3',
    name: 'Chapter 18B, Article 3 (§ 18B-302): Sale to or purchase by underage persons',
    why: 'underage purchase and possession of alcohol, codified in the alcoholic beverage control law',
    keep: only('18B-302'),
  },
]

/** "20-162" -> "N.C. Gen. Stat. § 20-162", the form North Carolina's courts cite. */
export function cite(section: string): string {
  if (!/^\d+[A-Z]*-\d+[A-Z]*(\.\d+[A-Z]*)?$/.test(section)) throw new Error(`not a North Carolina section: ${section}`)
  return `N.C. Gen. Stat. § ${section}`
}

export function sectionUrl(chapter: string, section: string): string {
  return `${ORIGIN}EnactedLegislation/Statutes/HTML/BySection/Chapter_${chapter}/GS_${section}.html`
}

/** A catchline that says there is no law at the number, or none but a name. */
const EMPTY = /^(Repealed|Recodified|Re-recodified|Reserved|Expired|Transferred|Title of Article\.?$|Short title\.?$)/i

/** A chapter's index: each section's number, catchline and article, in order. */
async function sectionsOf(chapter: string): Promise<{ article: string; section: string; catchline: string }[]> {
  const index = `${ORIGIN}Laws/GeneralStatuteSections/Chapter${chapter}`
  const response = await fetch(index, { headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`${index} answered ${response.status}`)
  const html = decoded(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'))
  const out: { article: string; section: string; catchline: string }[] = []
  const token = new RegExp(
    `font-weight:bold;" href="[^"]*">Article ([0-9A-Z]+) -[^<]*</a>|<a href="/EnactedLegislation/Statutes/PDF/BySection/Chapter_${chapter}/GS_([^"]+)\\.pdf">&#xA7; ([^<]*)</a>`,
    'g',
  )
  let article = ''
  for (const match of html.matchAll(token)) {
    if (match[1] !== undefined) {
      article = match[1]
      continue
    }
    const section = match[2]
    const lead = decode(match[3]).replace(/\s+/g, ' ').trim()
    if (!lead.startsWith(section)) throw new Error(`${index} lists ${section} as "${lead}"`)
    out.push({ article, section, catchline: lead.slice(section.length).replace(/^[.:]?\s*/, '') })
  }
  if (out.length === 0) throw new Error(`${index} lists no sections: the page changed shape`)
  return out
}

const site: Site = {
  // ncleg.gov is the General Assembly's own publication of the General Statutes.
  official: ORIGIN,
  name: 'the North Carolina General Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const chapter of [...new Set(TITLES.map((title) => title.chapter))]) {
      const sections = await sectionsOf(chapter)
      for (const title of TITLES.filter((each) => each.chapter === chapter)) {
        const inArticle = sections.filter((each) => each.article === title.article)
        if (inArticle.length === 0) throw new Error(`Chapter ${chapter} lists no Article ${title.article}`)
        const place = (section: string) => {
          const found = inArticle.findIndex((each) => each.section === section)
          if (found < 0) throw new Error(`Article ${title.article} lists no § ${section}: the runs left out need re-reading`)
          return found
        }
        const runs = (title.out ?? []).map(([first, last]) => [place(first), place(last)])
        for (const [position, each] of inArticle.entries()) {
          if (runs.some(([first, last]) => position >= first && position <= last)) continue
          if (EMPTY.test(each.catchline) || !title.keep(each.section)) continue
          listings.push({
            file: `${title.id}-${each.section}`,
            url: sectionUrl(chapter, each.section),
            section: each.section,
            cite: cite(each.section),
            heading: each.catchline,
          })
        }
      }
      await pause(1000)
    }
    return listings
  },
  extract: (html, listing) => extractNcleg(html, listing.section, new Date()),
}

export default site

/** A label's rank, outermost first: "(a)" 0, "(1)" 1, "a." 2, "1." 3; null for a line with none. */
function rankOf(line: string): number | null {
  if (/^\([a-z]+\d*\)/.test(line)) return 0
  if (/^\(\d+[a-z]*\)/.test(line)) return 1
  if (/^[a-z]+\.\s/.test(line)) return 2
  if (/^\d+\.\s/.test(line)) return 3
  return null
}

/**
 * Whether a version a subsection is marked with is in effect on `today`:
 * "(Effective until July 1, 2026)" before that day, "(Effective July 1, 2026)"
 * from it, and a contingent one ("Effective once contingency met") not until
 * the editors remove the mark.
 */
function inEffect(mark: string, today: Date): boolean {
  const until = /^Effective until ([A-Z][a-z]+ \d{1,2}, \d{4})$/.exec(mark)
  if (until !== null) return today < new Date(`${until[1]} UTC`)
  const from = /^Effective ([A-Z][a-z]+ \d{1,2}, \d{4})$/.exec(mark)
  if (from !== null) return today >= new Date(`${from[1]} UTC`)
  if (/^Effective (once|upon|when)\b/i.test(mark)) return false
  throw new Error(`a version marked "(${mark})" this extract cannot date`)
}

/**
 * The law of one ncleg.gov section page: its paragraphs, one line each, the
 * bold number and catchline dropped, the session-law history at the end
 * dropped, and any subsection version not in effect on `today` dropped with
 * the paragraphs under it. Only whitespace is changed within a line: the page
 * separates a label from its text with a tab ("(a)\tNo person…").
 */
export function extractNcleg(html: string, section: string, today: Date): string {
  const start = html.indexOf('<body>')
  if (start < 0) {
    if (/<title>[^<]*(404|Not Found)/i.test(html)) throw new Unavailable('the page is not found')
    throw new Error(`§ ${section}: no body on the page`)
  }
  let lines = decode(
    html
      .slice(start)
      .replace(/\s+/g, ' ')
      .replace(/<\/(p|tr|li|div|h[1-6])>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) throw new Unavailable(`§ ${section} has no text`)
  const heading = `§ ${section}`
  const opens = (line: string) => line.startsWith(heading) && /^[.:\s]/.test(line.slice(heading.length))
  // The first section of an article or part is served under its banner -- "Article 2D." "Implied-Consent
  // Offense Procedures." -- which is the code's outline, not this section's law.
  const first = lines.findIndex(opens)
  if (first < 0 || (first > 0 && !/^(Chapter|Article|Part|Subpart|Subchapter)\s/i.test(lines[0]))) {
    throw new Error(`§ ${section}: the page opens with another section: ${lines[0].slice(0, 60)}`)
  }
  if (lines.slice(first + 1).some(opens)) throw new Error(`§ ${section}: two versions on one page`)
  lines = lines.slice(first + 1)

  const kept: string[] = []
  let dropping: number | null = null
  for (const line of lines) {
    const rank = rankOf(line)
    if (dropping !== null) {
      if (rank === null || rank > dropping) continue
      dropping = null
    }
    const mark = /^\(\w+\)\s*\((Effective[^)]*)\)/.exec(line)
    if (mark !== null && rank !== null && !inEffect(mark[1], today)) {
      dropping = rank
      continue
    }
    kept.push(line)
  }

  const last = kept.length - 1
  const history = historyAt(kept[last])
  if (history === null) throw new Error(`§ ${section}: no session-law history closes it; the page changed shape`)
  kept[last] = kept[last].slice(0, history).trimEnd()
  const law = kept.filter((line) => line.length > 0)
  if (law.length === 0) throw new Unavailable(`§ ${section} has no text`)
  return law.join('\n') + '\n'
}

/**
 * Where the history that closes a section begins: the last parenthesis of its
 * last line, when it names session laws -- "(1937, c. 407, s. 124; …)" or "(C.S.,
 * s. 2621(46); …)" -- and so is the editors' record, not the law.
 */
function historyAt(line: string): number | null {
  if (!line.endsWith(')')) return null
  let depth = 0
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] === ')') depth += 1
    else if (line[index] === '(') {
      depth -= 1
      if (depth === 0) {
        return /^\((\d{4}|C\.S\.|Code|Rev\.|R\.C\.|Ex\. Sess|P\.L\.|Pub\. )/.test(line.slice(index)) ? index : null
      }
    }
  }
  return null
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
