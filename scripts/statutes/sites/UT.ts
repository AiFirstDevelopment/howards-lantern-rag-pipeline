/**
 * Utah: the Utah Code as the Office of Legislative Research and General
 * Counsel publishes it at le.utah.gov. A chapter-page `enumerate`: every
 * chapter and part of the code is also served as one XML file
 * (`/xcode/Title41/Chapter6A/C41-6a_1800010118000101.xml`, the "XML" link
 * under the reader's "Download Options"), each section in it as a
 * `<section number="41-6a-1302">` with its subsections as nested
 * `<subsection number="41-6a-1302(2)(a)">`. The section page itself is a
 * JavaScript shell that loads a versioned file whose name changes with every
 * amendment; the part file's name does not. A section's URL is its part's
 * file with the section number as fragment.
 *
 * robots.txt allows /xcode/ to every agent but asks `Crawl-delay: 10`. The
 * fetch's own pause is a second, so `read` fetches each part file itself,
 * once per run and never sooner than ten seconds after the last request --
 * twenty files in all.
 *
 * le.utah.gov sends its own certificate without the intermediate that signed
 * it, and Node refuses every request with "unable to verify the first
 * certificate" where curl and a browser fetch the missing link. As for
 * Illinois, the intermediate is pinned below beside the system's roots.
 *
 * **What is in effect.** A section amended for a later date is served twice
 * in the file, the copy in force under `<enddate>1/1/2027</enddate>` and the
 * new one under `<effdate>1/1/2027</effdate>`; a section enacted for a later
 * date is served only under its `<effdate>`. `extract` keeps the copy in
 * force today, and `enumerate` lists no section with none (41-6a-1512 on
 * 2026-10-08, enacted for 5/5/2027).
 *
 * Utah labels its subsections "(1)", "(a)", "(i)", "(A)", each its own
 * `<subsection>`; the label is printed by the site from the element's number,
 * and is written here the same way, one subsection a line. A subsection that
 * opens straight on a nested one is one line, "(7) (a) "Bicycle" means…", as
 * the site prints it. The compacts (53-3-602, 53-3-702) are one block of text
 * with their own labels and line breaks; there the only change is whitespace,
 * the two spaces the code sets after a label made one. `<tab/>`, a layout
 * mark and not a word, is dropped. The catchline is the listing's heading,
 * and the history ("Amended by Chapter 292, 2026 General Session") is not law
 * and is never committed.
 */
import https from 'node:https'
import { rootCertificates } from 'node:tls'
import { decoded } from '../fetch'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://le.utah.gov/xcode/'
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
/** robots.txt: "User-agent: * / Crawl-delay: 10". */
const CRAWL_DELAY_MS = 10_000

/**
 * The parts a licence-holder is bound by. Out of Title 41, and why: 41-1a
 * parts 3 (proportional registration of interstate fleets), 6 (liens), 8
 * (identification numbers), 9 (odometers), 10 (salvage), 11 (impound yards
 * and their procedure), 14 (officials' theft reports), 15 (event data
 * recorders) and 16 (sponsored plate programmes); 41-3 and 41-4, dealers and
 * financing; 41-10 and 41-19, the department and the federal safety
 * programme; 41-22 off-highway vehicles, which are recreation off the road;
 * 41-26 to 41-28, autonomous, novel and classic vehicles. Out of 53-3: part
 * 4, the commercial licence, which every state so far has left out because
 * its permit and alcohol rules crowd out the ordinary ones; part 5,
 * commercial driving schools; part 8, identification cards. Automobile
 * homicide (76-5-207) is a part of the criminal code's homicide chapter and
 * is left out with it; Utah codifies driving under the influence, open
 * containers and the alcohol-restricted driver in the Traffic Code itself.
 */
const TITLES: { path: string; id: string; name: string; why: string }[] = [
  { path: 'Title41/Chapter1A/C41-1a-P1', id: '41-1a-p1', name: 'Title 41, Chapter 1a, Part 1: Motor Vehicle Act -- Administration', why: 'what the Motor Vehicle Act means by a vehicle, an owner or a registration' },
  { path: 'Title41/Chapter1A/C41-1a-P2', id: '41-1a-p2', name: 'Title 41, Chapter 1a, Part 2: Registration', why: 'registration, its renewal and the inspection and emissions rules tied to it, every owner is held to' },
  { path: 'Title41/Chapter1A/C41-1a-P4', id: '41-1a-p4', name: 'Title 41, Chapter 1a, Part 4: License Plates and Registration Indicia', why: 'the plates every vehicle must display, and how, including disability plates and placards' },
  { path: 'Title41/Chapter1A/C41-1a-P5', id: '41-1a-p5', name: 'Title 41, Chapter 1a, Part 5: Titling Requirement', why: 'the title every owner must hold' },
  { path: 'Title41/Chapter1A/C41-1a-P7', id: '41-1a-p7', name: 'Title 41, Chapter 1a, Part 7: Transfer of Ownership', why: 'what buyer and seller must do when a vehicle is sold' },
  { path: 'Title41/Chapter1A/C41-1a-P12', id: '41-1a-p12', name: 'Title 41, Chapter 1a, Part 12: Fee and Tax Requirements', why: 'the registration and title fees an owner pays' },
  { path: 'Title41/Chapter1A/C41-1a-P13', id: '41-1a-p13', name: 'Title 41, Chapter 1a, Part 13: Offenses and Penalties', why: 'driving an unregistered vehicle, misusing plates, and the penalties' },
  { path: 'Title41/Chapter6A/C41-6a', id: '41-6a', name: 'Title 41, Chapter 6a: Traffic Code', why: 'the rules of the road: signals, speed, right of way, passing, parking, school buses, phones, seat belts, child seats, equipment, crashes, and driving under the influence' },
  { path: 'Title41/Chapter8/C41-8', id: '41-8', name: 'Title 41, Chapter 8: Driving by Minors', why: "the young driver's night-time, passenger and phone limits" },
  { path: 'Title41/Chapter12A/C41-12a', id: '41-12a', name: 'Title 41, Chapter 12a: Financial Responsibility of Motor Vehicle Owners and Operators Act', why: 'the insurance every vehicle must carry, the proof a driver must show, and the penalty for driving without it' },
  { path: 'Title53/Chapter3/C53-3-P1', id: '53-3-p1', name: 'Title 53, Chapter 3, Part 1: Driver License Division Administration', why: "what the Uniform Driver License Act means by a licence, a learner permit or a novice driver, and the licence fees" },
  { path: 'Title53/Chapter3/C53-3-P2', id: '53-3-p2', name: 'Title 53, Chapter 3, Part 2: Driver Licensing Act', why: 'the learner permit, the licence and its tests, the provisional licence, points, suspension and revocation' },
  { path: 'Title53/Chapter3/C53-3-P3', id: '53-3-p3', name: 'Title 53, Chapter 3, Part 3: Impaired Persons Licensing Act', why: 'the medical standards a driver is licensed under' },
  { path: 'Title53/Chapter3/C53-3-P6', id: '53-3-p6', name: "Title 53, Chapter 3, Part 6: Drivers' License Compact", why: 'how an offence in another state counts against a Utah licence' },
  { path: 'Title53/Chapter3/C53-3-P7', id: '53-3-p7', name: 'Title 53, Chapter 3, Part 7: Nonresident Violator Compact', why: 'what happens to a licence when a citation in another member state goes unanswered' },
  { path: 'Title53/Chapter3/C53-3-P9', id: '53-3-p9', name: 'Title 53, Chapter 3, Part 9: Motorcycle Rider Education Act', why: 'the rider course a motorcycle endorsement may require' },
  { path: 'Title53/Chapter3/C53-3-P10', id: '53-3-p10', name: 'Title 53, Chapter 3, Part 10: Ignition Interlock System Program Act', why: 'the interlock a driver convicted of impaired driving must use' },
  { path: 'Title32B/Chapter4/C32B-4-P4', id: '32b-4-p4', name: 'Title 32B, Chapter 4, Part 4: Sale, Purchase, Possession, and Consumption', why: 'underage purchase, possession and consumption of alcohol, codified outside the vehicle titles' },
]

export function partUrl(path: string): string {
  return `${ORIGIN}${path}_1800010118000101.xml`
}

/**
 * Sectigo's "Public Server Authentication CA OV R36" (valid to 2036-03-21),
 * from the address the site's certificate names (crt.sectigo.com), signed by
 * Sectigo Public Server Authentication Root R46 -- one more signer under a root
 * Node already trusts, not verification turned off.
 * SHA-256 65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30
 */
const SECTIGO_OV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----
`

const CA = [...rootCertificates, SECTIGO_OV_R36]

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { ca: CA, headers: { 'User-Agent': AGENT } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`le.utah.gov answered ${response.statusCode} for ${url}`))
        const type = response.headers['content-type'] ?? null
        resolve(decoded(new Uint8Array(Buffer.concat(chunks)), Array.isArray(type) ? type[0] : type))
      })
    })
    request.setTimeout(120_000, () => request.destroy(new Error(`le.utah.gov timed out for ${url}`)))
    request.on('error', reject)
  })
}

let last = 0
const files = new Map<string, Promise<string>>()

/** A part file, once per run, never sooner than the crawl delay after the last request. */
function partFile(url: string): Promise<string> {
  const key = url.split('#')[0]
  if (!files.has(key)) {
    const body = request(key)
    files.set(key, body)
    body.catch(() => files.delete(key))
  }
  return files.get(key)!
}

async function request(url: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const wait = last + CRAWL_DELAY_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    last = Date.now()
    try {
      const body = await get(url)
      // The reader's HTML shell in place of the file would parse as no section at all.
      if (!/^\s*(<\?xml[^>]*>\s*)?<(chapter|part) number=/.test(body)) throw new Error(`${url} is not a part file of the code`)
      return body
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY_MS * attempt))
    }
  }
}

interface Node {
  tag: string
  attributes: Record<string, string>
  children: (Node | string)[]
}

/** The file's elements. The vocabulary is small and regular: no CDATA, no comments, attributes in double quotes. */
function parse(xml: string): Node {
  const root: Node = { tag: '#root', attributes: {}, children: [] }
  const stack = [root]
  for (const match of xml.matchAll(/<(\/?)([A-Za-z_][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>|([^<]+)|(<\?[^>]*\?>)/g)) {
    const [, closing, tag, attributes, empty, text] = match
    if (text !== undefined) {
      stack[stack.length - 1].children.push(decode(text))
      continue
    }
    if (tag === undefined) continue
    if (closing === '/') {
      const open = stack.pop()
      if (open?.tag !== tag) throw new Error(`</${tag}> closes <${open?.tag}>`)
      continue
    }
    const node: Node = { tag, attributes: Object.fromEntries([...(attributes ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)])), children: [] }
    stack[stack.length - 1].children.push(node)
    if (empty !== '/') stack.push(node)
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].tag}> is never closed`)
  return root
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function sectionsOf(root: Node): Node[] {
  const out: Node[] = []
  const walk = (node: Node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.tag === 'section') out.push(child)
      else if (child.tag === 'chapter' || child.tag === 'part') walk(child)
    }
  }
  walk(root)
  return out
}

const child = (node: Node, tag: string) => node.children.find((each): each is Node => typeof each !== 'string' && each.tag === tag)
const textOf = (node: Node): string => node.children.map((each) => (typeof each === 'string' ? each : textOf(each))).join('')

/** "1/1/2027" as "2027-01-01". */
function isoDate(text: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (match === null) throw new Error(`a date this extract does not know: "${text}"`)
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

/** Whether a copy of a section is the law today: in effect on or before today, and not ended. */
function inForce(section: Node, today: string): boolean {
  const effective = child(section, 'effdate')
  const ends = child(section, 'enddate')
  if (effective !== undefined && isoDate(textOf(effective)) > today) return false
  if (ends !== undefined && isoDate(textOf(ends)) <= today) return false
  return true
}

const today = () => new Date().toISOString().slice(0, 10)

const site: Site = {
  // The Legislature's own publication of the Utah Code.
  official: ORIGIN,
  name: 'the Utah Code',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const listings: Listing[] = []
    const future: string[] = []
    for (const { path, id } of TITLES) {
      const url = partUrl(path)
      const copies = sectionsOf(parse(await partFile(url)))
      const before = listings.length
      const seen = new Set<string>()
      for (const copy of copies) {
        const section = copy.attributes.number
        if (seen.has(section)) continue
        seen.add(section)
        const current = copies.filter((each) => each.attributes.number === section && inForce(each, today()))
        if (current.length === 0) {
          future.push(section)
          continue
        }
        const catchline = child(current[0], 'catchline')
        listings.push({
          file: `${id}-${section.toLowerCase()}`,
          url: `${url}#${section}`,
          section,
          cite: `Utah Code § ${section}`,
          heading: catchline === undefined ? '' : textOf(catchline).replace(/\s+/g, ' ').trim().replace(/\.$/, ''),
        })
      }
      // A part read as nothing would be a title fetched as nothing, reported present.
      if (listings.length === before) throw new Error(`${url} lists no section in force`)
    }
    if (future.length > 0) console.log(`UT: not in force today, left out: ${future.join(', ')}`)
    return listings
  },
  // Through the pinned intermediate and the crawl delay above; fetch.ts's own `fetch` is refused by the certificate chain.
  read: (listing) => partFile(listing.url),
  extract: (body, listing) => extractUtah(body, listing.section),
}

export default site

/** One section's text in force today: a line per subsection, each opening on its label, a line per table row. */
export function extractUtah(xml: string, section: string, on = today()): string {
  const copies = sectionsOf(parse(xml)).filter((each) => each.attributes.number === section)
  if (copies.length === 0) throw new Unavailable(`the part file has no section ${section}`)
  const current = copies.filter((each) => inForce(each, on))
  if (current.length === 0) throw new Unavailable(`${section} is served only in a version not in effect today`)
  if (current.length > 1) throw new Error(`${section} is served in ${current.length} versions in effect today`)
  const lines: string[] = []
  let line = ''
  /** Whether the line so far is labels only, so a nested subsection continues it: "(7) (a) …". */
  let labelsOnly = false
  const flush = () => {
    const text = line.replace(/\s+/g, ' ').trim()
    if (text.length > 0) lines.push(text)
    line = ''
    labelsOnly = false
  }
  const render = (node: Node) => {
    for (const each of node.children) {
      if (typeof each === 'string') {
        line += each
        if (each.trim().length > 0) labelsOnly = false
        continue
      }
      switch (each.tag) {
        case 'histories':
        case 'catchline':
        case 'effdate':
        case 'enddate':
          break
        case 'tab':
          line += ' '
          break
        case 'eol':
          flush()
          break
        case 'center':
          flush()
          render(each)
          flush()
          break
        case 'subsection': {
          const label = /\(([^()]+)\)$/.exec(each.attributes.number ?? '')
          if (label === null) throw new Error(`${section}: a subsection numbered "${each.attributes.number}"`)
          if (!labelsOnly) flush()
          line += ` (${label[1]}) `
          labelsOnly = true
          render(each)
          flush()
          break
        }
        case 'tbl':
          flush()
          for (const row of each.children) {
            if (typeof row === 'string' || row.tag !== 'row') continue
            line = row.children.map((cell) => (typeof cell === 'string' ? cell : textOf(cell))).join(' ')
            flush()
          }
          break
        case 'xref':
        case 'ext_ref':
        case 'oldref':
        case 'format':
          render(each)
          break
        default:
          throw new Error(`${section}: an element this extract does not know, <${each.tag}>`)
      }
    }
  }
  render(current[0])
  flush()
  if (lines.length === 0) throw new Unavailable(`${section} has no text`)
  return lines.join('\n') + '\n'
}
