/**
 * Massachusetts: the General Laws as the General Court publishes them
 * (malegislature.gov), one section per page. An index-page `enumerate`: each
 * chapter's page lists its sections with their catchlines, and a section's
 * page holds its text under the catchline.
 *
 * Where a part of a section is amended for a later date the page serves both
 * versions in place, each under an italic editor's note --
 * "[ First paragraph effective until February 24, 2026. For text effective
 * February 24, 2026, see below.]" and then "[ First paragraph as amended by
 * 2025, 78, Sec. 2 effective February 24, 2026. …]". `extract` keeps the
 * version in effect today and drops the other with its note.
 *
 * Massachusetts numbers sections within a chapter -- chapter 89 and chapter 90
 * both have a section 1 -- so a listing's `section` carries its chapter,
 * "90-17", and its citation reads "Mass. Gen. Laws ch. 90, § 17".
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://malegislature.gov/'

/**
 * The chapters a licence-holder is bound by. Out, and why: chapter 90A is the
 * governor's highway-safety agency, 90B motorboats and off-road vehicles, 90D
 * certificates of title (a lienholder's registry; registration itself is in
 * chapter 90), 90E the state highway system, 90F commercial driver licensing,
 * 90H to 90J municipal road programmes and airbag sellers. Within chapter 90,
 * sections 35 to 61 are aircraft and airports, 32 to 32J license dealers,
 * lessors, rental companies and driving schools, and 7W to 7Z license
 * inspection stations -- none of them a rule a driver is held to. Chapter 85
 * is mostly municipal powers over ways and bridges; only its sections that
 * bind a rider or driver are in.
 */
const TITLES: { part: string; title: string; chapter: string; id: string; name: string; why: string; keep: (number: string) => boolean }[] = [
  {
    part: 'PartI',
    title: 'TitleXIV',
    chapter: '89',
    id: 'c89',
    name: 'Chapter 89: Law of the Road',
    why: 'passing, lanes, right of way at intersections, emergency vehicles, move-over and crosswalks',
    keep: () => true,
  },
  {
    part: 'PartI',
    title: 'TitleXIV',
    chapter: '90',
    id: 'c90',
    name: 'Chapter 90 (§§ 1–34R, 62–63): Motor Vehicles',
    why: 'definitions, registration and insurance, equipment, licences and learner\'s permits, speed, parking, phones, belts and child seats, impaired driving, suspension and penalties',
    keep: (number) => {
      // "221/2" is 22½: the fraction is not part of the whole number.
      const whole = Number(/^\d+/.exec(number.replace(/\d\/\d$/, ''))?.[0] ?? NaN)
      if (whole >= 35 && whole <= 61) return false
      if (whole === 32) return false
      return !/^7[WXYZ]$/.test(number)
    },
  },
  {
    part: 'PartI',
    title: 'TitleXIV',
    chapter: '90C',
    id: 'c90C',
    name: 'Chapter 90C: Procedure for Motor Vehicle Offenses',
    why: 'citations, civil infractions and what a cited driver must do',
    keep: () => true,
  },
  {
    part: 'PartI',
    title: 'TitleXIV',
    chapter: '85',
    id: 'c85',
    name: 'Chapter 85 (§§ 2E, 10A–11E, 14A–17B, 36): Ways and Bridges',
    why: 'bicycles and helmets, e-bikes, lights on vehicles, funeral processions and securing a load, codified among the rules for ways',
    keep: (number) => ['2E', '10A', '11', '11B', '11B1/2', '11B3/4', '11D', '11E', '14A', '15', '16', '17', '17A', '17B', '36'].includes(number),
  },
  {
    part: 'PartI',
    title: 'TitleXX',
    chapter: '138',
    id: 'c138',
    name: 'Chapter 138 (§§ 34–34C): Alcoholic Liquors and Persons under 21',
    why: 'underage purchase and possession of alcohol and false identification, codified in the liquor chapter',
    keep: (number) => ['34', '34A', '34B', '34C'].includes(number),
  },
]

/** "90-17" -> "Mass. Gen. Laws ch. 90, § 17"; "90-22-1/2" -> "… § 22½". */
export function cite(section: string): string {
  const [, chapter, number] = /^(\d+[A-Z]?)-(.+)$/.exec(section) ?? []
  if (chapter === undefined) throw new Error(`not a Massachusetts section: ${section}`)
  return `Mass. Gen. Laws ch. ${chapter}, § ${number.replace(/-?1\/2$/, '½').replace(/-?1\/4$/, '¼').replace(/-?3\/4$/, '¾').replace(/-?7\/8$/, '⅞')}`
}

const chapterUrl = (spec: (typeof TITLES)[number]) => `${ORIGIN}Laws/GeneralLaws/${spec.part}/${spec.title}/Chapter${spec.chapter}`

/**
 * The sections a chapter page lists: the number as the page writes it
 * ("22", "11B1/2", "12 to 14"), its URL path segment ("Section11B1~2") and its
 * catchline.
 */
export function sectionsListed(html: string, chapter: string): { number: string; path: string; heading: string }[] {
  const out: { number: string; path: string; heading: string }[] = []
  const link = new RegExp(`<a href="(/Laws/GeneralLaws/[^"]*/Chapter${chapter}/Section([^"]+))">\\s*<span class="section">Section ([^<]*)</span>\\s*<span class="sectionTitle">([^<]*)</span>`, 'g')
  for (const [, path, , number, heading] of html.matchAll(link)) {
    out.push({ number: number.trim(), path, heading: decode(decode(heading)).replace(/\s+/g, ' ').trim() })
  }
  return out
}

/** A catchline that says the section is gone: "Repealed, 1931, 142, Sec. 3", "Inoperative …", "Nullified by referendum …". */
const GONE = /^(Repealed|Inoperative|Nullified|Reserved|Transferred)\b/i

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'howardslantern.com statute check (+https://howardslantern.com/)' } })
  if (!response.ok) throw new Error(`malegislature.gov answered ${response.status} for ${url}`)
  return response.text()
}

const site: Site = {
  // The General Court's own publication of the General Laws.
  official: ORIGIN,
  name: 'the Massachusetts General Laws',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const listed = sectionsListed(await page(chapterUrl(spec)), spec.chapter)
      if (listed.length === 0) throw new Error(`chapter ${spec.chapter}'s page lists no sections: the page changed shape`)
      for (const each of listed) {
        // "12 to 14": a run of sections repealed together, a pointer and not law.
        if (/\sto\s/.test(each.number) || GONE.test(each.heading) || !spec.keep(each.number)) continue
        const section = `${spec.chapter}-${each.number.replace(/(\d\/\d)$/, '-$1')}`
        listings.push({
          file: `${spec.id}-${section.slice(spec.chapter.length + 1).replace(/\//g, '-')}`,
          url: `${ORIGIN}${each.path.slice(1)}`,
          section,
          cite: cite(section),
          heading: each.heading,
        })
      }
    }
    return listings
  },
  extract: (body, listing) => extractMalegislature(body, listing.section),
}

export default site

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** An editor's note naming a version: "[ Text of section effective until …]", "[ Subsection (b) as amended by … effective …]". */
const VERSION = /^\[\s*(.*?)\s+(?:effective until|as (?:amended|added|inserted|appearing|rewritten|struck)\b.*?effective|(?:added|inserted|struck|rewritten)\b.*?effective|effective)\s+(\w+) (\d{1,2}), (\d{4})/

interface Version {
  scope: string
  until: boolean
  date: string
}

function versionOf(paragraph: string, section: string): Version | null {
  if (!/^\[.*\]$/.test(paragraph) || !/\beffective\b/i.test(paragraph)) return null
  const match = VERSION.exec(paragraph)
  // A note in a form this cannot read could be either version; guessing would commit the wrong law.
  if (match === null) throw new Error(`${section} carries a version note this cannot read: ${paragraph}`)
  const [, scope, month, day, year] = match
  if (MONTHS.indexOf(month) < 0) throw new Error(`${section}'s version note names a month this cannot read: ${month}`)
  return {
    scope: scope.toLowerCase(),
    until: /effective until/i.test(match[0]),
    date: `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`,
  }
}

/**
 * One section's text in effect, a line per paragraph. A version's note governs
 * the paragraphs after it: an "effective until" copy runs to the note of the
 * copy that replaces it; the replacing copy covers as many paragraphs as the
 * copy it replaces did (or, for the whole section, everything after it), since
 * the page does not mark where it ends and the paragraphs after it are in
 * force under either version.
 */
export function extractMalegislature(html: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const heading = html.indexOf('genLawHeading')
  if (heading < 0) throw new Error('no genLawHeading on the page: not a section of the General Laws')
  const start = html.indexOf('</h2>', heading)
  const end = html.indexOf('</div>', start)
  if (start < 0 || end < 0) throw new Error('the section page has no body after its heading')
  const paragraphs = html
    .slice(start + 5, end)
    .split(/<p\b[^>]*>/i)
    .map((chunk) =>
      decode(chunk.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
        .split('\n')
        .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0)

  const kept: string[][] = []
  let dropping = 0
  let open: { version: Version; count: number; kept: boolean } | null = null
  for (const lines of paragraphs) {
    const version = lines.length === 1 ? versionOf(lines[0], section) : null
    if (version !== null) {
      const partner = open !== null && open.version.until && !version.until && open.version.scope === version.scope ? open : null
      const inForce = version.until ? version.date > today : version.date <= today
      if (!version.until && partner === null && !/^text of section/.test(version.scope) && !inForce) {
        // A part added for a later date with no earlier copy: how far it runs is not marked.
        throw new Error(`${section} adds "${version.scope}" from ${version.date} with no earlier copy to measure it by`)
      }
      open = { version, count: 0, kept: inForce }
      dropping = version.until || /^text of section/.test(version.scope) ? Infinity : (partner?.count ?? 0)
      if (inForce) dropping = 0
      continue
    }
    if (open !== null) {
      open.count += 1
      if (!open.kept) {
        if (dropping > 0) {
          dropping -= 1
          continue
        }
      }
    }
    // Any other bracketed note is the editor's, not the law's: "[ There is no clause (3).]"
    if (lines.length === 1 && /^\[.*\]$/.test(lines[0])) continue
    kept.push(lines)
  }
  const text = kept.flat()
  if (text.length === 0) throw new Unavailable('the page serves the catchline with no text in effect')
  return text.join('\n') + '\n'
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
