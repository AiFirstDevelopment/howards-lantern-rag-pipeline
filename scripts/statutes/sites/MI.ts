/**
 * Michigan: the Michigan Compiled Laws as the Legislature publishes them
 * (legislature.mi.gov), one section per page. An index-page `enumerate`: each
 * chapter of the Michigan Vehicle Code (1949 PA 300, MCL 257.1 to 257.923)
 * has a contents page listing its sections and its divisions, and each
 * division's page lists its own -- so the listing walks the chapter pages
 * down to every section, with its catchline.
 *
 * Michigan codifies almost everything a driver is held to in the one act; the
 * two exceptions taken here are the no-fault security every owner must carry
 * (the Insurance Code, MCL 500.3101 and 500.3102) and a minor's possession of
 * alcohol or bodily alcohol content (the Liquor Control Code, MCL 436.1703).
 *
 * MCL compiles two sections that share a number under a bracketed suffix:
 * 257.40c is "Platoon" defined, 257.40c[1] "Personal vehicle" defined. The
 * suffix is kept in `section`, as the Legislature's own compilation writes it.
 */
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.legislature.mi.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * Commercial driver licensing, interleaved in chapter III and VI rather than
 * a chapter of its own: the commercial learner's permit, vehicle-group
 * designations and endorsements, hazardous-material endorsements, CDL
 * disqualification and out-of-service orders, and the 0.04 alcohol rule for
 * a commercial vehicle (625m). Left out as every other state's CDL chapter
 * is: their permit and alcohol rules crowd out the ordinary ones.
 */
const CDL = new Set(['306a', '307a', '312e', '312f', '312g', '312h', '312i', '312j', '312k', '319b', '319c', '319d', '319f', '319g', '625m'])

/**
 * The titles a licence-holder is bound by. Out, and why: the rest of chapter
 * II is the Secretary of State's administration and records (§§ 201–214),
 * transfers of title and liens (§§ 233–242a), manufacturer and dealer plates
 * and dealer licensing (§§ 244–251e) and stolen- and abandoned-vehicle
 * procedure for police and towing agencies (§§ 252–254); chapter IV is an
 * owner's civil liability and service of process on nonresidents, not a rule
 * of conduct; chapter VI's size-and-weight sections other than §§ 717–721
 * are axle loads, oversize permits and truck routes for carriers; chapter VII
 * is registration taxes and fees and the special and fund-raising plate
 * programs; chapter IX is the repeal and saving clauses.
 */
const TITLES: { id: string; page: string; name: string; why: string; keep: (number: string) => boolean }[] = [
  { id: 'mvc-1', page: 'mcl-300-1949-I', name: 'Michigan Vehicle Code, Chapter I: Words and Phrases Defined', why: 'what the code means by a vehicle, a moped, a highway or an operator', keep: () => true },
  {
    id: 'mvc-2',
    page: 'mcl-300-1949-II',
    name: 'Michigan Vehicle Code, Chapter II (§§ 215–232a, 243, 255–259): Registration',
    why: 'registration, carrying the certificate, plates and their display, and the offences against them',
    keep: (number) => {
      const whole = wholeOf(number)
      return (whole >= 215 && whole <= 232) || whole === 243 || (whole >= 255 && whole <= 259)
    },
  },
  {
    id: 'mvc-3',
    page: 'mcl-300-1949-III',
    name: "Michigan Vehicle Code, Chapter III (except commercial licensing): Operators' and Chauffeurs' Licenses",
    why: 'licences, the instruction permit, graduated licensing and its limits, points, suspension and carrying proof of insurance',
    keep: (number) => !CDL.has(number),
  },
  { id: 'mvc-5', page: 'mcl-300-1949-V', name: 'Michigan Vehicle Code, Chapter V: Financial Responsibility', why: 'proof of financial responsibility and the suspension for an unpaid crash judgment', keep: () => true },
  {
    id: 'mvc-6',
    page: 'mcl-300-1949-VI',
    name: 'Michigan Vehicle Code, Chapter VI (except §§ 716, 719a–719c, 722–726c and commercial licensing): Obedience to and Effect of Traffic Laws',
    why: 'the rules of the road -- speed, right of way, parking, phones, drunk driving and implied consent, crashes, equipment, belts and child seats -- and citations',
    keep: (number) => {
      const whole = wholeOf(number)
      return !CDL.has(number) && whole !== 716 && !/^719[abc]$/.test(number) && !(whole >= 722 && whole <= 726)
    },
  },
  { id: 'mvc-6a', page: 'mcl-300-1949-VIA', name: 'Michigan Vehicle Code, Chapter VIA: Streetcars', why: 'what a driver may and may not do on and around a streetcar track', keep: () => true },
  { id: 'mvc-8', page: 'mcl-300-1949-VIII', name: 'Michigan Vehicle Code, Chapter VIII: Penalties', why: 'the misdemeanour and civil-infraction penalties, and driving unlicensed or uninsured', keep: () => true },
  {
    id: 'ins-31',
    page: 'mcl-500-3101 mcl-500-3102',
    name: 'Insurance Code, Chapter 31 (§§ 500.3101–500.3102): Motor Vehicle Personal and Property Protection',
    why: 'the no-fault security every owner must keep, and the penalty for driving without it -- codified outside the Vehicle Code',
    keep: () => true,
  },
  {
    id: 'lcc-7',
    page: 'mcl-436-1703',
    name: 'Liquor Control Code, Chapter 7 (§ 436.1703): Minors',
    why: 'a minor purchasing, possessing or having any bodily alcohol content -- codified outside the Vehicle Code',
    keep: () => true,
  },
]

/** "257.40c[1]" -> 40; "625m" -> 625. */
function wholeOf(number: string): number {
  return Number(/\d+/.exec(number)?.[0] ?? NaN)
}

/** "257.674" -> "Mich. Comp. Laws § 257.674". */
export function cite(section: string): string {
  if (!/^\d+\.\d+[a-z]*(\[\d\])?$/.test(section)) throw new Error(`not a Michigan section: ${section}`)
  return `Mich. Comp. Laws § ${section}`
}

export const pageUrl = (objectName: string) => `${ORIGIN}Laws/MCL?objectName=${encodeURIComponent(objectName)}`

async function page(objectName: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(pageUrl(objectName), { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`legislature.mi.gov answered ${response.status} for ${objectName}`)
      return await response.text()
    } catch (error) {
      if (attempt >= 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

/**
 * A contents page's rows: each a section or a division, with its catchline.
 * A row's second cell says which.
 */
export function rowsOf(html: string): { objectName: string; kind: string; heading: string }[] {
  const row = /<tr>\s*<td><a href="\/Laws\/MCL\?objectName=([^"]+)">[^<]*<\/a><\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g
  return [...html.matchAll(row)].map(([, objectName, kind, heading]) => ({
    objectName: decode(objectName),
    kind: kind.trim(),
    heading: decode(heading).replace(/\s+/g, ' ').trim(),
  }))
}

/** Every section under a chapter, walking its divisions, in the page's order. */
async function sectionsUnder(objectName: string, seen = new Set<string>()): Promise<{ objectName: string; heading: string }[]> {
  if (seen.has(objectName)) return []
  seen.add(objectName)
  const rows = rowsOf(await page(objectName))
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (rows.length === 0) throw new Error(`${objectName}'s page lists nothing: the page changed shape`)
  const out: { objectName: string; heading: string }[] = []
  for (const row of rows) {
    if (row.kind === 'Section') out.push({ objectName: row.objectName, heading: row.heading })
    else out.push(...(await sectionsUnder(row.objectName, seen)))
  }
  return out
}

/** A catchline that says the section is not law: "Repealed. 2011, Act 92, …", "Expired. 1979, …". */
const GONE = /^(Repealed|Expired)\b/i

const site: Site = {
  // The Legislature's own publication of the Michigan Compiled Laws.
  official: ORIGIN,
  name: 'the Michigan Compiled Laws',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const pages = spec.page.split(' ')
      // A single section named outright is listed by its own page; a chapter by its contents.
      const sections = pages[0].startsWith('mcl-300-') ? await sectionsUnder(pages[0]) : pages.map((objectName) => ({ objectName, heading: '' }))
      for (const each of sections) {
        const [, chapter, number] = /^mcl-(\d+)-(.+)$/.exec(each.objectName) ?? []
        if (chapter === undefined) throw new Error(`not a section's page: ${each.objectName}`)
        if (GONE.test(each.heading) || !spec.keep(number)) continue
        const section = `${chapter}.${number}`
        listings.push({
          file: `${spec.id}-${section.replace(/\[(\d)\]$/, '-$1')}`,
          url: pageUrl(each.objectName),
          section,
          cite: cite(section),
          heading: each.heading,
        })
      }
    }
    return listings
  },
  extract: (body, listing) => extractMcl(body, listing),
}

export default site

/**
 * One section's text, a line per paragraph: "(1) A vehicle must not be
 * parked…", "(d) Within 15 feet of a fire hydrant." The page's catchline and
 * its "Sec. 674." line are headings, not law, and the history and compiler's
 * notes below the text are the publisher's; all are dropped. The catchline is
 * the listing's `heading`.
 *
 * MCL serves only the text in force: an amendment not yet effective is not
 * shown in the section, only named in the history beneath it. A page that
 * names a section other than the one listed, or carries an "*****" notice of
 * another version, is a shape this has not seen and throws rather than guess.
 */
export function extractMcl(html: string, listing: Pick<Listing, 'section'>): string {
  const headingAt = html.indexOf('<h1 class="h4"')
  if (headingAt < 0) throw new Error(`${listing.section}: no section heading on the page, not a section of the MCL`)
  const end = html.indexOf('<div class="editorials', headingAt)
  if (end < 0) throw new Error(`${listing.section}: the section page has no history after its text`)
  const region = html.slice(headingAt, end)
  const heading = decode(/<h1 class="h4"[^>]*>([\s\S]*?)<\/h1>/.exec(region)?.[1] ?? '').trim()
  if (!heading.startsWith(`${listing.section} `)) throw new Error(`${listing.section}: the page is headed "${heading.slice(0, 60)}"`)
  if (/\*{5}/.test(region)) throw new Error(`${listing.section}: the page carries a "*****" version notice`)
  // A line per paragraph and per table row: a form or a schedule printed in
  // the section (§ 217c's scrap-vehicle inventory) is the section's text too.
  const lines = decode(
    region
      .replace(/<h1 class="h4"[^>]*>[\s\S]*?<\/h1>/, '')
      .replace(/\s+/g, ' ')
      .replace(/<\/?(p|tr|table|div|br)\b[^>]*>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\r\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0 && !/^Sec\. [0-9a-z]+(\[\d\])?\.$/i.test(line))
  if (lines.length === 0) throw new Unavailable('the page serves the heading with no text')
  return lines.join('\n') + '\n'
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
