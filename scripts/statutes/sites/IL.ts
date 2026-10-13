/**
 * Illinois: the Illinois Compiled Statutes as the General Assembly publishes
 * them (ilga.gov). A chapter-page `enumerate`: the site serves any run of an
 * Act by its sequence numbers -- one chapter or one article of the Vehicle
 * Code per page -- so a section's URL is that page with the section's number
 * as its fragment, and fetch.ts reads each page once per run. The ranges are
 * read from the Act's own table of articles, not typed here, so a renumbering
 * moves them with it.
 *
 * Not the bulk copy at ftp.ilga.gov the site points automated readers to: its
 * own readme says it is a static copy refreshed each autumn ("updated on
 * 11/21/2025 ... through Public Act 104-433"), so a year of amendments behind
 * the site.
 *
 * ILCS serves a section amended for a later date as more than one copy on one
 * page: "(Text of Section before amendment by P.A. 104-854)" and "(Text of
 * Section after amendment by P.A. 104-854)", the date only in the second
 * copy's source note ("104-854, eff. 1-1-27"). Where two Acts amended a section
 * separately, it serves one copy per Act -- "(Text of Section from P.A.
 * 104-480)", "(Text of Section from P.A. 104-577)" -- until the next compiling
 * reconciles them. And a section added by an Act not yet in effect is served
 * with nothing to mark it but its source note. `extract` keeps the one copy in
 * effect today: a quote found only in a later copy would be next year's law
 * presented as today's.
 */
import https from 'node:https'
import { rootCertificates } from 'node:tls'
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://www.ilga.gov/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

interface Part {
  id: string
  /** The Act: "625 ILCS 5". */
  act: string
  actId: string
  chapterId: string
  /** The Act's chapter as its table of articles names it ("11", "18c"); absent for an Act with no chapters. */
  chapter?: string
  /** The articles of that chapter to read, by numeral; absent for the whole chapter. */
  articles?: string[]
  /** An Act's article to read when the Act has articles but no chapters (the Liquor Control Act). */
  article?: string
  /** Sections to keep, where only a few of the pages' sections are the vehicle code. */
  only?: string[]
  name: string
  why: string
}

/**
 * The parts of the Illinois Vehicle Code (625 ILCS 5) a licence-holder is
 * bound by, and two Acts beside it. Out of the Vehicle Code, and why: chapter
 * 2 is the Secretary of State's office itself; chapter 3's articles II
 * (lenders' security interests), III (rebuilt-vehicle titles), VI (the
 * specialty and vanity plate programs -- disability parking is chapter 11's),
 * IX (remittance agents), X and XI (use taxes collected by the Department of
 * Revenue); chapter 4, theft offences and the towing of abandoned vehicles;
 * 5, dealers, transporters and rebuilders; chapter 6's articles IV and X
 * (driving schools), V (the commercial licence), VIII (the compact between
 * agencies on unpaid citations) and IX (the medical review board); 8 and 9,
 * for-hire passenger and rental vehicles; 10, the civil liability of public
 * bodies and process on non-residents; chapter 12's articles VIII and IX,
 * the construction of school and church buses; 13 to 13C, inspection and
 * emission-testing stations; 15, size, weight and permits for loads; 17, the
 * state's highway safety programme; 18a to 18d, relocation towing, motor
 * carriers and the Commerce Commission; 20, the distribution of fees.
 */
const PARTS: Part[] = [
  { id: 'ivc-1', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '1', name: 'Vehicle Code, Chapter 1: Title and Definitions', why: 'what the code means by a vehicle, a moped, a highway or a driver' },
  { id: 'ivc-3', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '3', articles: ['I', 'IV', 'V', 'VII', 'VIII'], name: 'Vehicle Code, Chapter 3, Articles I, IV, V, VII and VIII: Certificates of Title and Registration', why: 'the title, registration, plates and fees every owner must hold and pay, and the offences against them' },
  { id: 'ivc-6', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '6', articles: ['I', 'II', 'III', 'VI', 'VII'], name: 'Vehicle Code, Chapter 6, Articles I, II, III, VI and VII: The Illinois Driver Licensing Law', why: "licensing, the instruction permit and graduated licence, suspension, revocation, driving while suspended and the Driver License Compact" },
  { id: 'ivc-7', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '7', name: 'Vehicle Code, Chapter 7: Illinois Safety and Family Financial Responsibility Law', why: 'the insurance every vehicle must carry and the suspension for lacking it' },
  { id: 'ivc-11', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '11', name: 'Vehicle Code, Chapter 11: Rules of the Road', why: 'the rules of the road: signals, crashes, impaired driving, speed, passing, right of way, school buses, parking, phones and bicycles' },
  { id: 'ivc-12', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '12', articles: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'], name: 'Vehicle Code, Chapter 12, Articles I to VII: Equipment of Vehicles', why: 'lights, brakes, tyres, glass and mirrors, seat belts, helmets and the equipment of the trucks of the second division a private owner drives' },
  { id: 'ivc-16', act: '625 ILCS 5', actId: '1815', chapterId: '49', chapter: '16', name: 'Vehicle Code, Chapter 16: Enforcement, Penalties and Disposition of Fines', why: 'the classes of offence and the penalties for breaking the rules above' },
  // Not 8, the repeal of the Act this one replaced, nor 9, its 1983 effective date: no rule in either, and
  // each is one line the chunker reads as the section's own header ("9" is in "1983"), leaving no body.
  { id: 'cppa', act: '625 ILCS 25', actId: '1819', chapterId: '49', only: ['1', '2', '3', '4', '4a', '4b', '5', '6', '6a', '7'], name: 'Child Passenger Protection Act (625 ILCS 25)', why: 'the car seat and booster rules for children, an Act of its own beside the Vehicle Code' },
  { id: 'lca', act: '235 ILCS 5', actId: '1404', chapterId: '26', article: 'VI', only: ['6-20'], name: 'Liquor Control Act of 1934, Section 6-20', why: 'underage purchase, possession and consumption of alcohol, codified in the liquor law' },
]

/** The state's own citation form: "625 ILCS 5/11-1303". */
export function cite(section: string, act = '625 ILCS 5'): string {
  return `${act}/${section}`
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * ilga.gov sends its own certificate without the intermediate that signed it,
 * Sectigo's "Public Server Authentication CA OV R40" (valid to 2040-05-13).
 * A browser or curl fetches the missing link from the certificate's own
 * address; Node does not, and refuses every page with "unable to verify the
 * first certificate". So the intermediate is pinned here, beside the system's
 * roots -- trusting one more signer under the same Sectigo root, not turning
 * verification off.
 * SHA-256 8E:B2:F1:7D:66:89:41:C3:9A:7F:CA:0C:EE:12:7A:E0:EB:AF:44:46:10:63:1C:CA:3C:D1:9E:AB:46:C5:82:4A
 */
const SECTIGO_OV_R40 = `-----BEGIN CERTIFICATE-----
MIIGOzCCBCOgAwIBAgIRAJtQo9lL5MczAhJFS8xoc3gwDQYJKoZIhvcNAQEMBQAw
XzELMAkGA1UEBhMCR0IxGDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE2MDQGA1UE
AxMtU2VjdGlnbyBQdWJsaWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIFJvb3QgUjQ2
MB4XDTI1MDUxNDAwMDAwMFoXDTQwMDUxMzIzNTk1OVowYDELMAkGA1UEBhMCR0Ix
GDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE3MDUGA1UEAxMuU2VjdGlnbyBQdWJs
aWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIENBIE9WIFI0MDCCAaIwDQYJKoZIhvcN
AQEBBQADggGPADCCAYoCggGBAIlSHqpFAFB5FVW5J1XfsOxTmd5YQvl3LTnrYYVf
eoamvgK7A71WHHX4RXMFelolbXULkHL2NwTGKHIiykTQTqnvSRaU0NAWGw/zTSbw
VK6TN2tw5Lhys2PF+nGJTXkii5fqTchwesB0Il/94vkbbvNIEN3i/4RoRDpIAqRP
SINzKOwhKrZ5yejAVM5gS0bOi8yn5j4c74PPEmr+qJ8rp04d9BEnXKGYQNk069f1
KTwlSgvc0n0ZmloYp6LUomjBYiX53jSYJAsmacshPUw5VZ6ti/tlVmTeq9yi0ICe
XJhStXMmH8zFut4hr3G77JTT1swJF+w0VnwMIhVuQKDmIpVmuJvgBsKB3ffS94C+
SilLXyWFt+zr7KMFKWg3ElsQRpJzqUYfeKZKQ04RIjBNf+eScSUebEpwV6tcf4mw
5tDisbAjgyn1ST5WlascokKYW93RMv6NinELJ5WEsO/J7OC8rw34H4YhyMJfUe68
ZmPaF6Q72NzBaoxpPROtUPn6CQIDAQABo4IBbzCCAWswHwYDVR0jBBgwFoAUVnNY
ZJX5khqwEioEYnmhQBWIIUkwHQYDVR0OBBYEFHviSaFgtLvoQubGp1QRHGFkU1XR
MA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMBMGA1UdJQQMMAoG
CCsGAQUFBwMBMBMGA1UdIAQMMAowCAYGZ4EMAQICMFQGA1UdHwRNMEswSaBHoEWG
Q2h0dHA6Ly9jcmwuc2VjdGlnby5jb20vU2VjdGlnb1B1YmxpY1NlcnZlckF1dGhl
bnRpY2F0aW9uUm9vdFI0Ni5jcmwwgYQGCCsGAQUFBwEBBHgwdjBPBggrBgEFBQcw
AoZDaHR0cDovL2NydC5zZWN0aWdvLmNvbS9TZWN0aWdvUHVibGljU2VydmVyQXV0
aGVudGljYXRpb25Sb290UjQ2LnA3YzAjBggrBgEFBQcwAYYXaHR0cDovL29jc3Au
c2VjdGlnby5jb20wDQYJKoZIhvcNAQEMBQADggIBAFAufRwhEW91VWsDvjejAhWg
drPqDVSh7gNeo40fI+V2dT557ABemJ7/NnzylJvjX5bYeToiUGI+MladTJQL4aOB
glG2hfQXOT++PM9eM8+gztEzCoNdqe1phQA64DqulrabuzMUNQfUqTZJlswiGh3L
XZXyrxodS+G2duhPhuWIQTfIZHSSYjiFMsuZHFyjm+plHQDVhK7BI3fSrtFVny0q
gpolbiha1TuaCo6P7/7l5j54HBOLO7byq8uc9D83I9mW+ZLN9ZaC82maxdmvXWln
Ubc8BUClomt9iIxNLmwE3w9bp+0hFVHc+Ud6AI5ZFeTDQ+f6HNpDY26GXFAx48Sg
z+/+jDfGIDLhZ9cI8jGy2m+AR9T+K9JVszzyXrZI6P6VZGgHh8V+tZ5NDWG5yLLW
N+9pKKmkY4tpQ8Gmb26dnbdD+x+I7Y6S4Cc9HcstpM5v+wKt/JJly9eU31GHucfg
cd+G1b2BFuN5p0mLHh6t5R9MZG3xG3GEqNYSM5049FDOl5ZaMGRqk0uN31obMJ8w
mAzRNWgEm28ebPhbVgfCmcCxn06xdoZ8G1AkeSWwVzbH05tEK5ly2pWJ5QSzIW/c
Joxchdy1k8eXj0Eu0yaqlKZDh95Tlhuq37ZbFWwzynqUIvAYKjI8PQwIIR8EoOx8
M2A5O6N9rci7TeBnWdo+
-----END CERTIFICATE-----
`

const CA = [...rootCertificates, SECTIGO_OV_R40]

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { ca: CA, headers: { 'User-Agent': AGENT } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`ilga.gov answered ${response.statusCode} for ${url}`))
        const type = response.headers['content-type'] ?? null
        resolve(decoded(new Uint8Array(Buffer.concat(chunks)), Array.isArray(type) ? type[0] : type))
      })
    })
    request.setTimeout(120_000, () => request.destroy(new Error(`ilga.gov timed out for ${url}`)))
    request.on('error', reject)
  })
}

/** A page, with fetch.ts's three retries and backoff, since its own fetch cannot reach the site. */
async function page(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await get(url)
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
    }
  }
}

/**
 * Pages already read in this run, by URL without its fragment: a chapter page
 * holds hundreds of sections, and `read` is asked once for each of them.
 */
const pages = new Map<string, Promise<string>>()

function cachedPage(url: string): Promise<string> {
  const key = url.split('#')[0]
  if (!pages.has(key)) {
    const body = page(key)
    pages.set(key, body)
    body.catch(() => pages.delete(key))
  }
  return pages.get(key)!
}

const rangeUrl = (part: Part, start: string, end: string) =>
  `${ORIGIN}legislation/ILCS/details?ActID=${part.actId}&ChapterID=${part.chapterId}&SeqStart=${start}&SeqEnd=${end}`

/** An Act's table of articles: each link's name ("Chapter 11 - Rules Of The Road") and its sequence range, in order. */
function tableOf(html: string): { name: string; start: string; end: string }[] {
  const out: { name: string; start: string; end: string }[] = []
  for (const [, href, inner] of html.matchAll(/<a[^>]*href="([^"]*SeqStart=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const range = /SeqStart=(\d+)&(?:amp;)?SeqEnd=(\d+)/.exec(href)
    if (range === null) continue
    out.push({ name: decode(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(), start: range[1], end: range[2] })
  }
  return out
}

/** The pages holding a part's sections. */
async function pagesOf(part: Part): Promise<string[]> {
  const articlesPage = `${ORIGIN}Legislation/ILCS/Articles?ActID=${part.actId}&ChapterID=${part.chapterId}`
  // The Child Passenger Protection Act has no articles: its table page is the Act.
  if (part.chapter === undefined && part.article === undefined) return [articlesPage]
  const table = tableOf(await page(articlesPage))
  if (part.article !== undefined) {
    const found = table.find((entry) => entry.name.startsWith(`Article ${part.article} - `))
    if (found === undefined) throw new Error(`${part.act} has no Article ${part.article} in its table`)
    return [rangeUrl(part, found.start, found.end)]
  }
  const index = table.findIndex((entry) => entry.name.startsWith(`Chapter ${part.chapter} - `))
  if (index < 0) throw new Error(`${part.act} has no Chapter ${part.chapter} in its table`)
  if (part.articles === undefined) return [rangeUrl(part, table[index].start, table[index].end)]
  const urls: string[] = []
  for (const numeral of part.articles) {
    // The chapter's own articles are the entries after it, up to the next chapter.
    const rest = table.slice(index + 1)
    const next = rest.findIndex((entry) => /^Chapter /.test(entry.name))
    const found = (next < 0 ? rest : rest.slice(0, next)).find((entry) => entry.name.startsWith(`Article ${numeral} - `))
    if (found === undefined) throw new Error(`${part.act} Chapter ${part.chapter} has no Article ${numeral}`)
    urls.push(rangeUrl(part, found.start, found.end))
  }
  return urls
}

/** Element boundaries, kept through flattening so a catchline can be told from the law that follows it. */
const CUT = '\u0001'

/**
 * A section block's lines: a `<br>` or a new row of the page's table is a new
 * paragraph; the hard line breaks inside a paragraph, and the indent cells a
 * hanging paragraph continues in, are not.
 */
export function linesOf(block: string): string[] {
  const flat = block
    .replace(/\s+/g, ' ')
    .replace(/<br\s*\/?>|<tr><td><div[^>]*>|<center>/gi, '\n')
    // A fee schedule is a table: each data row is a line and each cell a word apart, or 3-812's whole
    // schedule of weights and fees ran together as one paragraph that no longer ends on a sentence.
    .replace(/<tr>(?=(?:\s|<\/?code>|<font[^>]*>|<\/font>)*<td valign)/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/font>/gi, CUT)
    .replace(/<[^>]+>/g, '')
  return decode(flat)
    .split('\n')
    .map((line) => line.replace(/[ \u00a0]+/g, ' ').trim())
    .filter((line) => plain(line).length > 0)
}

/**
 * A line as text. An element boundary is no space of its own: the page breaks
 * its elements at the spaces of the law, and a boundary inside a word would
 * otherwise split it.
 */
const plain = (line: string) => line.split(CUT).join('').replace(/ +/g, ' ').trim()

interface Copy {
  /** "before" | "after" | "from", with the Act it names; none for a section served once. */
  tag?: { kind: 'before' | 'after' | 'from'; act: string }
  lines: string[]
  /** Every "P.A. n, eff. date" in the copy's source note, as ISO dates. */
  effective: Map<string, string>
}

/** A page's sections, keyed by their ILCS reference ("625 ILCS 5/11-1303"), each with every copy the page serves. */
export function sectionsOf(html: string): Map<string, Copy[]> {
  const sections = new Map<string, Copy[]>()
  const blocks = html.split(/<table align="center" border="0" cellspacing="0" cellpadding="0" width="500">/).slice(1)
  for (const raw of blocks) {
    const block = raw.split(/<\/table>\s*<br>/)[0]
    const lines = linesOf(block)
    const reference = /^\((\d+ ILCS \d+\/[0-9A-Za-z.-]+)\)/.exec(plain(lines[0] ?? ''))
    // Chapter and article headings are blocks of their own: "(625 ILCS 5/Ch. 11 Art. XIII heading)".
    if (reference === null) continue
    const copies: Copy[] = []
    let current: Copy | null = null
    // Lines keep the page's element boundaries: they are how a catchline is told from the law after it.
    for (const line of lines.slice(1)) {
      const tag = /^\(Text of Section (before amendment by|after amendment by|from) P\.A\. (\d+-\d+)\)$/.exec(plain(line))
      if (tag !== null) {
        current = { tag: { kind: tag[1].startsWith('before') ? 'before' : tag[1].startsWith('after') ? 'after' : 'from', act: tag[2] }, lines: [], effective: new Map() }
        copies.push(current)
        continue
      }
      if (current === null) {
        current = { lines: [], effective: new Map() }
        copies.push(current)
      }
      current.lines.push(line)
    }
    for (const copy of copies) {
      const source = copy.lines.map(plain).find((line) => /^\(Source: /.test(line)) ?? ''
      // "P.A. 104-854, eff. 1-1-27" and the bare "104-854, eff. 1-1-27" after a semicolon; not past a repeal.
      const before = source.split(/Repealed by|Renumbered/)[0]
      for (const [, act, date] of before.matchAll(/(\d{2,3}-\d+)(?: \([^)]*\))?, eff\. (\d{1,2}-\d{1,2}-\d{2})\b/g)) copy.effective.set(act, iso(date))
    }
    sections.set(reference[1], copies)
  }
  return sections
}

/** "1-1-27" -> "2027-01-01". ILCS writes two-digit years; the Code is 1970 onward. */
function iso(date: string): string {
  const [month, day, year] = date.split('-').map(Number)
  const full = year >= 70 ? 1900 + year : 2000 + year
  return `${full}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The one copy in effect on `today`. A "before amendment by" copy holds until
 * the amending Act's date, read from any copy's source note; an "after" or
 * "from" copy holds from its own Act's date. Two "from" copies both in effect
 * are separate amendments the compilers have not yet merged: the one that took
 * effect last is served, the later Act on a tie, as the latest law -- it is the
 * deterministic choice, not a reconciliation. An untagged copy whose every
 * dated Act is still to come is a section not yet law.
 */
export function inEffect(copies: Copy[], key: string, today: string): Copy | null {
  const dateOf = (act: string) => {
    for (const copy of copies) {
      const date = copy.effective.get(act)
      if (date !== undefined) return date
    }
    throw new Error(`${key}: no effective date for P.A. ${act} in any copy's source note`)
  }
  const live = copies.filter((copy) => {
    if (copy.tag === undefined) {
      const dates = [...copy.effective.values()]
      return dates.length === 0 || dates.some((date) => date <= today)
    }
    const date = dateOf(copy.tag.act)
    return copy.tag.kind === 'before' ? today < date : date <= today
  })
  if (live.length === 0) return null
  if (live.length === 1) return live[0]
  if (!live.every((copy) => copy.tag?.kind === 'from')) throw new Error(`${key}: ${live.length} copies in effect on ${today} of ${copies.length} served`)
  const order = (copy: Copy) => `${dateOf(copy.tag!.act)} ${copy.tag!.act.split('-').map((part) => part.padStart(5, '0')).join('-')}`
  return [...live].sort((a, b) => order(b).localeCompare(order(a)))[0]
}

/** A body verb in what would be a catchline: then it is the law's first sentence, and stays law. */
const SENTENCE_VERB = /\b(shall|may|must|is|are|means|includes|has|have)\b/

/**
 * A copy's catchline and its law, one line per paragraph. The catchline is
 * the first element after "Sec. n." when it is one whole short element; where
 * the page runs the catchline and the law together in one element, the
 * catchline is the first sentence only when it has no verb of its own -- a
 * sentence that "shall" is law, and kept as law.
 */
export function bodyOf(copy: Copy, section: string): { heading: string; lines: string[] } {
  const lines = copy.lines
  const start = lines.findIndex((line) => plain(line).startsWith(`Sec. ${section}.`))
  if (start < 0) throw new Error(`no "Sec. ${section}." line`)
  const end = lines.findIndex((line, index) => index > start && /^\(Source: /.test(plain(line)))
  const after = lines.slice(start + 1, end < 0 ? undefined : end).map(plain).filter((line) => !/^\((This Section may contain text|Section scheduled to be repealed)/.test(line))
  const first = lines[start].slice(lines[start].indexOf(`Sec. ${section}.`) + `Sec. ${section}.`.length).replace(new RegExp(`^[\\s${CUT}]+`), '')
  const elements = first.split(CUT).map((part) => part.trim()).filter((part) => part.length > 0)
  let heading = ''
  let rest = plain(first)
  const whole = elements[0] ?? ''
  // A whole element that "shall", or that is all the section has, is the law and not its catchline:
  // "Whoever violates any of the provisions of this Article shall be guilty of a petty offense…".
  const alone = elements.length === 1 && after.length === 0
  if (whole.length > 0 && whole.length <= 250 && /\.$/.test(whole) && !/^(\(|\d+\.\s)/.test(whole) && !/\bshall\b/.test(whole) && !alone) {
    heading = whole.replace(/\.$/, '')
    // The rest from the untrimmed elements: a paragraph wraps across elements at its spaces, and trimmed
    // each one, "cited as the" and "Illinois Vehicle Code" were committed as "theIllinois".
    const parts = first.split(CUT)
    rest = plain(parts.slice(parts.findIndex((part) => part.trim().length > 0) + 1).join(CUT))
  } else {
    const sentence = /^([^().]{3,160}?)\.\s+(?=[A-Z(])/.exec(whole)
    if (sentence !== null && !SENTENCE_VERB.test(sentence[1])) {
      heading = sentence[1]
      rest = plain(first).slice(sentence[0].length)
    }
  }
  return { heading, lines: [...(rest.length > 0 ? [rest] : []), ...after] }
}

/** A catchline that is all that is left of a section: "(Repealed).", "(Blank).", "(Renumbered).". */
const GONE = /^\((repealed|blank|reserved|renumbered)\b/i

const today = () => new Date().toISOString().slice(0, 10)

const site: Site = {
  // The Illinois Compiled Statutes as the General Assembly's Legislative Information System publishes them.
  official: ORIGIN,
  name: 'the Illinois Compiled Statutes',
  titles: PARTS.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const day = today()
    for (const part of PARTS) {
      const urls = await pagesOf(part)
      await pause()
      for (const url of urls) {
        const sections = sectionsOf(await cachedPage(url))
        await pause()
        for (const [key, copies] of sections) {
          if (!key.startsWith(`${part.act}/`)) continue
          const section = key.slice(part.act.length + 1)
          if (part.only !== undefined && !part.only.includes(section)) continue
          const copy = inEffect(copies, key, day)
          // A section an Act adds on a date still to come is not yet law, and not listed.
          if (copy === null) continue
          const { heading, lines } = bodyOf(copy, section)
          if (GONE.test(heading) || lines.length === 0 || GONE.test(lines[0])) continue
          listings.push({ file: `${part.id}-${section}`, url: `${url}#${section}`, section, cite: cite(section, part.act), heading })
        }
      }
    }
    return listings
  },
  // Through the pinned intermediate above; fetch.ts's own `fetch` is refused by the site's certificate chain.
  read: (listing) => cachedPage(listing.url),
  extract: (body, listing) => extractIlga(body, listing.cite, listing.section, listing.file.startsWith('ivc-1-')),
}

export default site

/**
 * One section's text in effect today: "Sec. <number>." on its own line, then a
 * line per paragraph of law. The catchline is the listing's heading, the
 * source note and the editors' notes are not law, and a copy not in effect is
 * never read.
 */
export function extractIlga(html: string, reference: string, section: string, defines = false, day = today()): string {
  const copies = sectionsOf(html).get(reference)
  if (copies === undefined) throw new Unavailable(`the page has no section ${reference}`)
  const copy = inEffect(copies, reference, day)
  if (copy === null) throw new Unavailable(`${reference} is not yet in effect on ${day}`)
  const { heading, lines } = bodyOf(copy, section)
  if (lines.length === 0) throw new Unavailable('the page serves the catchline with no text')
  // A definition's catchline is the term it defines, and the law without it is half a sentence: Chapter 1
  // defines "Garbage" and "Refuse" in the same words, and without the term the two were one text twice.
  // Kept as the page runs it, "Garbage. Any material…", on the definition's own line.
  if (defines && heading !== '') lines[0] = `${heading}. ${lines[0]}`
  return [`Sec. ${section}.`, ...lines].join('\n') + '\n'
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/&times;/g, '×')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
