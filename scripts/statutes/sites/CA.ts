/**
 * California: the Legislature's own bulk publication of its codes,
 * `pubinfo_2025.zip` on downloads.leginfo.legislature.ca.gov -- the database
 * behind leginfo.legislature.ca.gov, rebuilt as the session goes. A bulk-file
 * `enumerate`. leginfo itself answers every page, robots.txt included, with a
 * Cloudflare JavaScript challenge, so no section page can be read by a script;
 * the archive can, and it serves byte ranges.
 *
 * The archive is 1.2 GB and none of it is downloaded whole. Its central
 * directory and `LAW_SECTION_TBL.dat` (one row per version of every section of
 * every code, 6 MB packed) are read once per run; each section is then its own
 * `.lob` entry of a few kilobytes, read by range and inflated here. A run that
 * met a rebuilt archive half-way would read one file's offsets out of another,
 * so every range is held to the ETag the run started with.
 *
 * A section amended for a later date is served as two active rows, the one in
 * effect and the one "operative January 1, 2027"; a section waiting on a
 * condition ("conditionally operative by its own provisions") likewise.
 * `extract` keeps the one version in effect today and only that one: a quote
 * found only in the other would be the law of 2027 presented as today's.
 */
import { inflateRawSync } from 'node:zlib'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://downloads.leginfo.legislature.ca.gov/'
const ARCHIVE = `${ORIGIN}pubinfo_2025.zip`
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

type Code = 'VEH' | 'BPC' | 'PEN'

const CODES: Record<Code, string> = { VEH: 'Veh. Code', BPC: 'Bus. & Prof. Code', PEN: 'Penal Code' }

/**
 * The divisions a licence-holder is bound by. Out of the Vehicle Code, and
 * why: the General Provisions are how the code is construed; 2 is the DMV and
 * the Highway Patrol themselves; 3.5 vessels; 3.6 and 5 dealers, schools and
 * other licensed businesses; 4 VIN and antitheft rules for the trade; 6.5
 * dealings with minors as buyers; 12.5 a zero-emission programme; 13 to 14.9
 * towing, hazardous loads and motor carriers; 15 size and weight of loads; 16
 * implements of husbandry; 16.5 off-highway vehicles; 16.6 autonomous-vehicle
 * permits; 16.7 local bicycle licensing.
 */
const TITLES: { code: Code; division?: string; only?: string[]; id: string; name: string; why: string }[] = [
  { code: 'VEH', division: '1.', id: 'veh-1', name: 'Vehicle Code, Division 1: Words and Phrases Defined', why: 'what the code means by a vehicle, a motorized scooter, a highway or a driver' },
  { code: 'VEH', division: '3.', id: 'veh-3', name: 'Vehicle Code, Division 3: Registration of Vehicles and Certificates of Title', why: 'registration, plates and the title every owner must hold' },
  { code: 'VEH', division: '6.', id: 'veh-6', name: "Vehicle Code, Division 6: Drivers' Licenses", why: 'licensing, the instruction permit and provisional licence, points, suspension and revocation' },
  { code: 'VEH', division: '6.7.', id: 'veh-6.7', name: 'Vehicle Code, Division 6.7: Unattended Child in Motor Vehicle Safety Act', why: 'leaving a young child alone in a vehicle' },
  { code: 'VEH', division: '7.', id: 'veh-7', name: 'Vehicle Code, Division 7: Financial Responsibility Laws', why: 'the insurance every driver must carry and the suspension for lacking it' },
  { code: 'VEH', division: '9.', id: 'veh-9', name: 'Vehicle Code, Division 9: Civil Liability', why: "who answers for a crash, including the parent who signed a minor's application" },
  { code: 'VEH', division: '10.', id: 'veh-10', name: 'Vehicle Code, Division 10: Accidents and Accident Reports', why: 'what a driver must do after a crash' },
  { code: 'VEH', division: '11.', id: 'veh-11', name: 'Vehicle Code, Division 11: Rules of the Road', why: 'the rules of the road: signals, right of way, speed, parking, school buses, phones, impaired driving and open containers' },
  { code: 'VEH', division: '11.5.', id: 'veh-11.5', name: 'Vehicle Code, Division 11.5: Sentencing for Driving While Under the Influence', why: 'the fines, jail and suspensions a DUI conviction brings' },
  { code: 'VEH', division: '12.', id: 'veh-12', name: 'Vehicle Code, Division 12: Equipment of Vehicles', why: 'lights, brakes, belts, child seats, helmets and the equipment a vehicle must have' },
  { code: 'VEH', division: '17.', id: 'veh-17', name: 'Vehicle Code, Division 17: Offenses and Prosecution', why: 'citations, arrest, infractions and what a stopped driver must do' },
  { code: 'VEH', division: '18.', id: 'veh-18', name: 'Vehicle Code, Division 18: Penalties and Disposition of Fees, Fines, and Forfeitures', why: 'the fines for breaking the rules above' },
  { code: 'BPC', only: ['25658', '25662'], id: 'bpc', name: 'Business and Professions Code §§ 25658 and 25662', why: 'underage purchase, possession and consumption of alcohol, codified outside the Vehicle Code' },
  { code: 'PEN', only: ['191.5', '192'], id: 'pen', name: 'Penal Code §§ 191.5 and 192', why: 'vehicular manslaughter, codified in the Penal Code' },
]

/**
 * Sections the code enacts twice, word for word, and so listed once. Chapter 7
 * of Division 11 holds three speed-camera pilot articles: § 22439 repeats
 * § 22429's relief for indigent recipients for the second pilot, and each
 * article ends on the same sunset clause, "This article shall remain in effect
 * only until January 1, 2032". Committed twice, a chunk of one is
 * indistinguishable from the other, and tests/unit/statutes.test.ts reads two
 * files of one text as one page served under two addresses.
 */
const SAME_AS: Record<string, string> = { 'VEH-22439': 'VEH-22429', 'VEH-22441': 'VEH-22431', 'VEH-22445.6': 'VEH-22431' }

/** The state's own citation form: "Cal. Veh. Code § 22514". */
export function cite(section: string, code: Code = 'VEH'): string {
  return `Cal. ${CODES[code]} § ${section}`
}

// ---- the archive, by range -------------------------------------------------

let etag: string | undefined

/** Bytes [start, end) of the archive, refusing anything but that range of the file the run began on. */
async function range(start: number, end: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const controller = new AbortController()
      const response = await fetch(ARCHIVE, {
        headers: { 'User-Agent': AGENT, Range: `bytes=${start}-${end - 1}` },
        signal: controller.signal,
      })
      // A 200 is the whole 1.2 GB on its way: stop it rather than read it.
      if (response.status !== 206) {
        controller.abort()
        throw new Error(`the archive answered ${response.status} to a range request`)
      }
      const tag = response.headers.get('etag') ?? ''
      if (etag === undefined) etag = tag
      if (tag !== etag) {
        controller.abort()
        throw new ArchiveChanged(`the archive changed during the run (${etag} -> ${tag}): run the fetch again`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length !== end - start) throw new Error(`asked for ${end - start} bytes of the archive, got ${bytes.length}`)
      return bytes
    } catch (error) {
      if (error instanceof ArchiveChanged || attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
    }
  }
}

class ArchiveChanged extends Error {}

interface Entry {
  method: number
  compressed: number
  size: number
  offset: number
}

async function archiveSize(): Promise<number> {
  const response = await fetch(ARCHIVE, { method: 'HEAD', headers: { 'User-Agent': AGENT } })
  if (!response.ok) throw new Error(`the archive answered ${response.status} to HEAD`)
  etag = response.headers.get('etag') ?? ''
  return Number(response.headers.get('content-length'))
}

/** The archive's central directory: every entry's name, method, sizes and offset, ZIP64 included. */
async function readDirectory(): Promise<Map<string, Entry>> {
  const size = await archiveSize()
  const tailLength = Math.min(size, 66_000)
  const tail = await range(size - tailLength, size)
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('no end-of-central-directory record in the archive')
  let count = tail.readUInt16LE(eocd + 10)
  let length = tail.readUInt32LE(eocd + 12)
  let start = tail.readUInt32LE(eocd + 16)
  const locator = eocd - 20
  if (locator >= 0 && tail.readUInt32LE(locator) === 0x07064b50) {
    const at = Number(tail.readBigUInt64LE(locator + 8))
    const record = at >= size - tailLength ? tail.subarray(at - (size - tailLength)) : await range(at, at + 56)
    if (record.readUInt32LE(0) !== 0x06064b50) throw new Error('the ZIP64 locator points at no ZIP64 record')
    count = Number(record.readBigUInt64LE(32))
    length = Number(record.readBigUInt64LE(40))
    start = Number(record.readBigUInt64LE(48))
  }
  const directory = await range(start, start + length)
  const entries = new Map<string, Entry>()
  let at = 0
  for (let index = 0; index < count; index += 1) {
    if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error(`central directory entry ${index} is malformed`)
    const method = directory.readUInt16LE(at + 10)
    let compressed = directory.readUInt32LE(at + 20)
    let uncompressed = directory.readUInt32LE(at + 24)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    let offset = directory.readUInt32LE(at + 42)
    const name = directory.toString('utf8', at + 46, at + 46 + nameLength)
    const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength)
    for (let e = 0; e + 4 <= extra.length; ) {
      const id = extra.readUInt16LE(e)
      const len = extra.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let field = e + 4
        if (uncompressed === 0xffffffff) {
          uncompressed = Number(extra.readBigUInt64LE(field))
          field += 8
        }
        if (compressed === 0xffffffff) {
          compressed = Number(extra.readBigUInt64LE(field))
          field += 8
        }
        if (offset === 0xffffffff) offset = Number(extra.readBigUInt64LE(field))
      }
      e += 4 + len
    }
    entries.set(name, { method, compressed, size: uncompressed, offset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** One entry's bytes: its local header and data in one range, inflated. */
async function readEntry(entries: Map<string, Entry>, name: string): Promise<Buffer> {
  const entry = entries.get(name)
  if (entry === undefined) throw new Error(`the archive has no ${name}`)
  const head = await range(entry.offset, entry.offset + 30 + name.length + 512 + entry.compressed)
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${name}: no local header at its offset`)
  const dataAt = 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const data = head.subarray(dataAt, dataAt + entry.compressed)
  const bytes = entry.method === 0 ? data : entry.method === 8 ? inflateRawSync(data) : null
  if (bytes === null) throw new Error(`${name}: compression method ${entry.method} is not one this reads`)
  if (bytes.length !== entry.size) throw new Error(`${name}: inflated to ${bytes.length} bytes, the directory says ${entry.size}`)
  return bytes
}

// ---- the section table -----------------------------------------------------

/** One active row of LAW_SECTION_TBL: a version of a section, its place in the code and its `.lob`. */
interface Row {
  code: string
  section: string
  division: string | null
  history: string
  lob: string
}

/** "`VEH`" -> "VEH"; NULL -> null. The table's own quoting. */
const field = (value: string): string | null => (value === 'NULL' ? null : value.replace(/^`|`$/g, ''))

function rowsOf(table: string): Row[] {
  const rows: Row[] = []
  for (const line of table.split('\n')) {
    if (line.trim() === '') continue
    const cells = line.replace(/\r$/, '').split('\t')
    if (cells.length !== 18) throw new Error(`a LAW_SECTION_TBL row of ${cells.length} fields, not 18: ${line.slice(0, 80)}`)
    // 15 is active_flg: an inactive row is a version the Legislature no longer serves.
    if (field(cells[15]) !== 'Y') continue
    rows.push({ code: field(cells[1])!, section: field(cells[2])!, division: field(cells[8]), history: field(cells[13]) ?? '', lob: cells[14] })
  }
  return rows
}

/** "22514." -> "22514": the table writes every section number with its closing full stop. */
const bare = (section: string) => section.replace(/\.$/, '')

let loaded: Promise<{ entries: Map<string, Entry>; rows: Map<string, Row[]> }> | undefined

/** The directory and the table, once per run. */
function archive(): Promise<{ entries: Map<string, Entry>; rows: Map<string, Row[]> }> {
  loaded ??= (async () => {
    const entries = await readDirectory()
    const table = (await readEntry(entries, 'LAW_SECTION_TBL.dat')).toString('utf8')
    const rows = new Map<string, Row[]>()
    for (const row of rowsOf(table)) {
      const key = `${row.code}-${bare(row.section)}`
      rows.set(key, [...(rows.get(key) ?? []), row])
    }
    return { entries, rows }
  })()
  loaded.catch(() => (loaded = undefined))
  return loaded
}

/** The table's key for a listing: its URL's fragment, "VEH-22514". */
const keyOf = (listing: Listing) => decodeURIComponent(listing.url.split('#')[1] ?? '')

// ---- which version is law today ------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/** "January 1, 2027" -> "2027-01-01". */
function dateOf(written: string): string {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(written.trim())
  const month = match === null ? undefined : MONTHS[match[1].toLowerCase()]
  // A date this cannot read could put either version in effect; guessing would commit the wrong law.
  if (match === null || month === undefined) throw new Error(`an operative date this cannot read: ${written}`)
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

const DATE = '([A-Z][a-z]+ \\d{1,2}, \\d{4})'

/**
 * Whether a version's history line puts it in effect on `today`. Out: a
 * version "operative <date>" for a date to come; one "repealed as of" or
 * "inoperative" a date passed; and one operative only on a condition --
 * "conditionally operative", "becomes operative on the effective date of a
 * judicial determination", "becomes operative if a judicial determination
 * ... has taken effect" -- which is not law until somebody shows the
 * condition met, as Delaware's contingent copies are not. A repeal the history
 * tells of an earlier version -- § 21450's "the prior version ... had been
 * repealed on January 1, 2005" -- is not this version's: read as one, it kept
 * the definition of a traffic signal out of the first run.
 */
function inEffect(history: string, today: string): boolean {
  if (/conditionally operative|becomes operative (?:on the effective date|if)|operative[^.]*only if/i.test(history)) return false
  for (const [, date] of history.matchAll(new RegExp(`(?<!in)operative (?:on |as of )?${DATE}`, 'gi'))) {
    if (dateOf(date) > today) return false
  }
  for (const [, date] of history.matchAll(new RegExp(`(?<!had been )(?:repealed|inoperative) (?:on |as of )?${DATE}`, 'gi'))) {
    if (dateOf(date) <= today) return false
  }
  return true
}

// ---- the text --------------------------------------------------------------

/** A version as `read` hands it to `extract`: its history line, then its CAML. */
const VERSION = '\u0000version '

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const FRACTIONS: Record<string, string> = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/3': '⅓', '2/3': '⅔', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' }

/**
 * A figure the CAML writes as markup: `7<caml:Fraction><caml:Numerator>1…2…`.
 * Stripped as tags, § 22521's "within 7½ feet of the nearest rail" became
 * "within 712 feet" -- a distance a hundred times the law's, quoted as law.
 */
function fraction(whole: string, numerator: string, denominator: string): string {
  const glyph = FRACTIONS[`${numerator}/${denominator}`]
  if (glyph !== undefined) return `${whole}${glyph}`
  return `${whole}${whole === '' ? '' : ' '}${numerator}/${denominator}`
}

/** The markup a section is known to be written in; anything else is read before it is trusted. */
const KNOWN = /^<\/?(?:p|h\d|span|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|ul|ol|li|br|b|i|u|em|strong|sup|sub|caml:Content|caml:TipIn)\b[^>]*>$/i

/**
 * A section's CAML as lines: a line per paragraph or table row, the en-space
 * after a label a space. The CAML wraps long paragraphs with newlines of its
 * own -- "offstreet public\n parking facility" in § 4000 -- which are not
 * paragraphs, so its whitespace is folded before any tag becomes a line. A tag
 * or entity this has not been taught stops the fetch rather than being
 * stripped: stripping is how a fraction became a number.
 */
function linesOf(caml: string): string[] {
  const folded = caml
    .replace(/\s+/g, ' ')
    .replace(
      /(\d*)<caml:Fraction>\s*<caml:Numerator>([^<]*)<\/caml:Numerator>\s*<caml:Denominator>([^<]*)<\/caml:Denominator>\s*<\/caml:Fraction>/g,
      (_, whole: string, numerator: string, denominator: string) => fraction(whole, numerator.trim(), denominator.trim()),
    )
    .replace(/<span class="(?:En|Em|Thin)Space"\/>/g, ' ')
  for (const [tag] of folded.matchAll(/<[^>]+>/g)) {
    if (!KNOWN.test(tag)) throw new Error(`markup this extract has not been taught: ${tag}`)
  }
  for (const [entity] of folded.matchAll(/&[a-z]+;/gi)) {
    if (!/^&(?:nbsp|quot|apos|lt|gt|amp);$/.test(entity)) throw new Error(`an entity this extract has not been taught: ${entity}`)
  }
  return decode(
    folded
      .replace(/<\/(p|h\d|tr|li|caption)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    // § 25800 ends "(commencing with Section 25500) ." -- a space the CAML keeps
    // before the full stop, which reads as a paragraph that never ends a sentence.
    .map((line) => line.replace(/[\s ]+/g, ' ').trim().replace(/ ([.;:])$/, '$1'))
    .filter((line) => line.length > 0)
}

const site: Site = {
  // The Legislative Counsel's bulk publication of the California codes, the database leginfo serves.
  official: ORIGIN,
  name: 'the California codes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const { rows } = await archive()
    const listings: Listing[] = []
    for (const spec of TITLES) {
      const sections = [...rows.entries()]
        .filter(([, versions]) => versions[0].code === spec.code)
        .filter(([, versions]) => (spec.only === undefined ? versions[0].division === spec.division : spec.only.includes(bare(versions[0].section))))
        .map(([key, versions]) => ({ key, section: bare(versions[0].section) }))
        .sort((a, b) => a.section.localeCompare(b.section, 'en', { numeric: true }))
      for (const { key, section } of sections) {
        if (SAME_AS[key] !== undefined) continue
        listings.push({
          file: `${spec.id}-${section}`,
          url: `${ARCHIVE}#${key}`,
          section,
          cite: cite(section, spec.code),
          // The codes publish no catchlines: the section's own text is all there is.
          heading: '',
        })
      }
    }
    return listings
  },
  async read(listing) {
    const { entries, rows } = await archive()
    const versions = rows.get(keyOf(listing))
    if (versions === undefined) return ''
    const parts: string[] = []
    for (const version of versions) {
      parts.push(`${VERSION}${version.history}\n${(await readEntry(entries, version.lob)).toString('utf8')}\n`)
    }
    return parts.join('')
  },
  extract: (body, listing) => extractPubinfo(body, listing.section),
}

export default site

/**
 * One section's text in effect today, from what `read` returned: "§ <number>."
 * on its own line, then a line per paragraph. Where the table holds several
 * active versions, the one whose history puts it in effect today; none or
 * more than one is reported, not chosen between.
 */
export function extractPubinfo(body: string, section: string, today = new Date().toISOString().slice(0, 10)): string {
  const versions = body
    .split(VERSION)
    .slice(1)
    .map((part) => {
      const newline = part.indexOf('\n')
      return { history: part.slice(0, newline), caml: part.slice(newline + 1) }
    })
  if (versions.length === 0) throw new Unavailable('the table has no active row for the section')
  const current = versions.filter((version) => inEffect(version.history, today))
  if (current.length !== 1) throw new Unavailable(`${current.length} of ${versions.length} active versions are in effect on ${today}`)
  const lines = linesOf(current[0].caml)
  if (lines.length === 0) throw new Unavailable('the version in effect has no text')
  // The number alone heads the text, so the chunker reads it as a header and not as law.
  return [`§ ${section}.`, ...lines].join('\n') + '\n'
}
