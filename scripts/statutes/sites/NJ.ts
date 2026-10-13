/**
 * New Jersey: the statutes as the Office of Legislative Services publishes them
 * in bulk, `STATUTES-TEXT.zip` on pub.njleg.state.nj.us -- the file the
 * Legislature's downloads page (njleg.state.nj.us/downloads) links, rebuilt
 * every weekday. A bulk-file `enumerate`, as California's. The Legislature's
 * own reader (lis.njleg.state.nj.us) is a Folio NextPage frameset with no
 * stable address per section; the bulk file is the same database as plain
 * text, one file for every title.
 *
 * The archive is 41 MB and read once per run; `STATUTES.TXT` inside it is 84
 * MB of windows-1252 text in which each section opens on a line at the left
 * margin -- its number and catchline, "39:4-138  Places where parking
 * prohibited, …" -- and runs, indented, to the next. The catchline is the
 * listing's `heading`; `extract` drops it and the session-law history that
 * closes the section ("L.1948,c.342,s.1; amended 1951, c.23, s.78; …"),
 * neither of which is law.
 *
 * The file carries one version of each section and no effective-date notes:
 * what OLS compiles is the text as last amended. A section amended for a later
 * date cannot be told apart from one in effect, so `extract` has nothing to
 * drop -- said here rather than assumed.
 *
 * New Jersey letters its subsections "a.", "b." and numbers paragraphs "(1)",
 * "(a)". Many sections open on their own number ("39:4-36. a. The driver…")
 * or on the session law's section number ("1. a. The use of a wireless
 * telephone…"), and either one in front hid the "a." from the chunker; so the
 * first line drops them, as it drops the catchline (`withoutLeadingNumbers`).
 * Neither is a word of the law: the rest is committed as served, whitespace
 * collapsed.
 */
import { inflateRawSync } from 'node:zlib'
import { Unavailable, type Listing, type Site } from '../site'

const ORIGIN = 'https://pub.njleg.state.nj.us/statutes/'
const ARCHIVE = `${ORIGIN}STATUTES-TEXT.zip`
const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'

/**
 * The chapters of Title 39, Motor Vehicles and Traffic Regulation, a
 * licence-holder is bound by, and two sections of the Code of Criminal Justice.
 * Out, and why: 39:2 and 39:2A are the department and the Motor Vehicle
 * Commission themselves; 39:3C is snowmobiles and off-road vehicles; 39:5B is
 * carriers of radioactive material; 39:5G limousines; 39:5H ride-hailing
 * companies; 39:7 service of process on non-residents; 39:9 bus drivers' hours;
 * 39:10A to 39:10B abandoned-vehicle auctions and parts dealers; 39:11 junk
 * yards; 39:12 drivers' schools; 39:13 body shops; 39:14 motor-carrier
 * contracts. Inside 39:3, the Commercial Driver License Act (39:3-10.9 to
 * 39:3-10.30) is left out, as every state's commercial licensing has been: its
 * permit and alcohol rules crowd out the ordinary ones.
 */
const TITLES: { prefix: string; id: string; name: string; why: string; keep?: (section: string) => boolean }[] = [
  { prefix: '39:1-', id: '39-1', name: 'N.J.S.A. 39:1: Definitions', why: 'what the code means by a vehicle, a motorized bicycle, a highway or a driver' },
  {
    prefix: '39:3-',
    id: '39-3',
    name: 'N.J.S.A. 39:3: Registration and Licensing',
    why: 'registration and plates, the permit, the probationary licence and its limits, and the lights and equipment a vehicle must have',
    keep: (section) => !isCommercialLicensing(section),
  },
  { prefix: '39:3A-', id: '39-3A', name: 'N.J.S.A. 39:3A: Television Sets in Vehicles', why: 'a screen the driver can see while driving' },
  { prefix: '39:3B-', id: '39-3B', name: 'N.J.S.A. 39:3B: Warning Lamps and School Bus Equipment', why: "the emergency lights a volunteer's car may carry and the school bus's signals every driver must obey" },
  { prefix: '39:4-', id: '39-4', name: 'N.J.S.A. 39:4: Traffic Regulation', why: 'the rules of the road: signals, right of way, speed, passing, school buses, phones, parking, impaired driving and crashes' },
  { prefix: '39:5-', id: '39-5', name: 'N.J.S.A. 39:5: Violations and Procedure', why: 'citations, penalties, points and what follows a conviction' },
  { prefix: '39:5A-', id: '39-5A', name: 'N.J.S.A. 39:5A: Private Roads Made Subject to Traffic Laws', why: 'where the traffic laws bind a driver on a private road' },
  { prefix: '39:5C-', id: '39-5C', name: 'N.J.S.A. 39:5C: Racing', why: 'racing on a highway and its penalty' },
  { prefix: '39:5D-', id: '39-5D', name: 'N.J.S.A. 39:5D: Driver License Compact', why: 'how a conviction in another state follows a New Jersey licence' },
  { prefix: '39:5F-', id: '39-5F', name: 'N.J.S.A. 39:5F: Nonresident Violator Compact', why: 'what an out-of-state ticket does to a licence' },
  { prefix: '39:6-', id: '39-6', name: 'N.J.S.A. 39:6: Motor Vehicle Security-Responsibility', why: 'the security a crash requires and the suspension for lacking it' },
  { prefix: '39:6A-', id: '39-6A', name: 'N.J.S.A. 39:6A: Automobile Reparation Reform (No-Fault)', why: 'the insurance every owner must carry' },
  { prefix: '39:6B-', id: '39-6B', name: 'N.J.S.A. 39:6B: Compulsory Motor Vehicle Insurance', why: 'the liability insurance every owner must maintain, and the penalty for driving without it' },
  { prefix: '39:8-', id: '39-8', name: 'N.J.S.A. 39:8: Motor Vehicle Inspection', why: 'the inspection a vehicle must pass' },
  { prefix: '39:10-', id: '39-10', name: 'N.J.S.A. 39:10: Certificates of Ownership', why: 'the title every owner must hold' },
  {
    prefix: '2C:11-',
    id: '2C-11',
    name: 'N.J.S.A. 2C:11-5: Death by Auto',
    why: 'killing a person by driving recklessly or drunk, codified in the Code of Criminal Justice',
    keep: (section) => section === '2C:11-5',
  },
  {
    prefix: '2C:33-',
    id: '2C-33',
    name: 'N.J.S.A. 2C:33-15: Underage Possession or Consumption of Alcohol',
    why: 'underage drinking, codified outside Title 39',
    keep: (section) => section === '2C:33-15',
  },
]

/** 39:3-10.9 to 39:3-10.30, the New Jersey Commercial Driver License Act, its lettered insertions with it. */
function isCommercialLicensing(section: string): boolean {
  const match = /^39:3-10\.(\d+)[a-z]?$/.exec(section)
  return match !== null && Number(match[1]) >= 9 && Number(match[1]) <= 30
}

/** "39:4-138" -> "N.J. Stat. Ann. § 39:4-138". */
export function cite(section: string): string {
  return `N.J. Stat. Ann. § ${section}`
}

// ---- the archive ------------------------------------------------------------

/** The one entry of a ZIP archive, by its central directory, inflated. */
export function unzipEntry(archive: Buffer, name: string): Buffer {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('no end-of-central-directory record in the archive')
  const count = archive.readUInt16LE(eocd + 10)
  let at = archive.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error(`central directory entry ${index} is malformed`)
    const method = archive.readUInt16LE(at + 10)
    const compressed = archive.readUInt32LE(at + 20)
    const size = archive.readUInt32LE(at + 24)
    const nameLength = archive.readUInt16LE(at + 28)
    const extraLength = archive.readUInt16LE(at + 30)
    const commentLength = archive.readUInt16LE(at + 32)
    const offset = archive.readUInt32LE(at + 42)
    const entry = archive.toString('latin1', at + 46, at + 46 + nameLength)
    if (entry === name) {
      if (archive.readUInt32LE(offset) !== 0x04034b50) throw new Error(`${name}: no local header at its offset`)
      const dataAt = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28)
      const data = archive.subarray(dataAt, dataAt + compressed)
      const bytes = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
      if (bytes === null) throw new Error(`${name}: compression method ${method} is not one this reads`)
      if (bytes.length !== size) throw new Error(`${name}: inflated to ${bytes.length} bytes, the directory says ${size}`)
      return bytes
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`the archive has no ${name}`)
}

/** A line at the margin that opens a section: its number, then its catchline. */
const HEADER = /^(\d+[A-Z]?:\d+[A-Z]?-[0-9A-Za-z.]+?)\.?[ \t]+(\S.*)$/
/**
 * Also at the margin, and not a section: "39:4-50a and 39:4-50b have been
 * reallocated as 39:4-50.22 and 39:4-50.23, respectively." Read as a header,
 * it was a section 39:4-50a whose text was the next section's.
 */
const REALLOCATED = /^\d+[A-Z]?:\S+\s+(?:and|to)\s.*\breallocated\b/

interface Section {
  heading: string
  block: string
  /** The file holds the number twice -- 2C:4-10 is -- and so which text is the law cannot be read off it. */
  twice: boolean
}

/** Every section in the file: its number, catchline and lines, header first. */
export function sectionsOf(text: string): Map<string, Section> {
  const sections = new Map<string, { heading: string; lines: string[]; twice: boolean }>()
  let current: { heading: string; lines: string[]; twice: boolean } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const header = /^\S/.test(raw) && !REALLOCATED.test(raw) ? HEADER.exec(raw) : null
    if (header !== null) {
      const twice = sections.has(header[1])
      current = { heading: header[2].trim().replace(/\s+/g, ' ').replace(/\.$/, ''), lines: [raw], twice }
      if (twice) sections.get(header[1])!.twice = true
      else sections.set(header[1], current)
      continue
    }
    // "TITLE 39  MOTOR VEHICLES AND TRAFFIC REGULATION": closes the last section of the title before.
    if (/^TITLE\s/.test(raw)) {
      current = null
      continue
    }
    current?.lines.push(raw)
  }
  return new Map([...sections].map(([section, { heading, lines, twice }]) => [section, { heading, block: lines.join('\n'), twice }]))
}

let file: Promise<Map<string, Section>> | undefined

/** The archive, read once per run however many sections ask for it. */
function statutes(): Promise<Map<string, Section>> {
  file ??= (async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(ARCHIVE, { headers: { 'User-Agent': AGENT } })
        if (!response.ok) throw new Error(`${ARCHIVE} answered ${response.status}`)
        const bytes = unzipEntry(Buffer.from(await response.arrayBuffer()), 'STATUTES.TXT')
        return sectionsOf(new TextDecoder('windows-1252').decode(bytes))
      } catch (error) {
        if (attempt >= 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
      }
    }
  })()
  return file
}

const site: Site = {
  // OLS is the Legislature's own office; pub.njleg.state.nj.us is where the Legislature's downloads page points.
  official: ORIGIN,
  name: 'the New Jersey Statutes',
  titles: TITLES.map(({ id, name, why }) => ({ id, name, why })),
  async enumerate() {
    const sections = await statutes()
    const listings: Listing[] = []
    for (const title of TITLES) {
      const before = listings.length
      for (const [section, { heading, twice }] of sections) {
        if (!section.startsWith(title.prefix)) continue
        if (title.keep !== undefined && !title.keep(section)) continue
        if (twice) throw new Error(`the file holds ${section} twice`)
        listings.push({
          file: section.replace(':', '-'),
          // The fragment names the section in the file; it is never sent to the server.
          url: `${ARCHIVE}#${section}`,
          section,
          cite: cite(section),
          heading,
        })
      }
      if (listings.length === before) throw new Error(`no sections found for ${title.name}`)
    }
    return listings
  },
  async read(listing) {
    const section = (await statutes()).get(listing.section)
    if (section === undefined) throw new Error(`the archive no longer holds ${listing.section}`)
    return section.block
  },
  extract: (body, listing) => extractNj(body, listing.section),
}

export default site

/**
 * The session-law history that closes a section: "L.1997,c.188,s.1.",
 * "Amended by L.1951, c. 23, p. 99, s. 75.", "amended 1938, c.66, s.1; …",
 * "R.S.39:4-52;", and a history wrapped onto a line of its own, "2021, c.139,
 * s.2.". A record of enactments, not the law they enacted.
 */
const HISTORY = /^(?:L\.\s?\d{4}\s?,|R\.S\.\s?\d|(?:Amended|amended)\s+(?:by\s+)?(?:L\.\s?)?\d{4}\s?,|\d{4},\s?c\.\s?\d)/
/**
 * The compact's article headings, which the file sets at the end of the
 * section before the one they head: "Article II" closing 39:5F-3.
 */
const ARTICLE = /^Article [IVXLC]+$/
/**
 * A printer's instruction left in the text, a line of its own in 39:4-123:
 * "PLEASE PHOTOCOPY INSERTION AT PAGE 113 OF N.J.S.A. 39:4-73 to 39:6
 * COPYRIGHT 2012 BY WEST". Kept, it was quoted as subsection (c)'s last words.
 */
const PRINTER = /^PLEASE PHOTOCOPY INSERTION\b.*\bCOPYRIGHT \d{4}\b/

/** A section's law: its lines after the catchline, whitespace collapsed, the history, stray headings and printer's notes dropped. */
export function extractNj(block: string, section: string): string {
  const [header, ...rest] = block.split('\n')
  if (!header.startsWith(section)) throw new Error(`the block for ${section} opens on "${header.slice(0, 60)}"`)
  // The file sets a space between a closing quote and its stop -- 'cited as
  // the "Nonresident Violator Compact" .' -- which reads as a sentence that
  // never ends; the space goes, the words do not.
  const lines = rest
    .map((line) => line.replace(/[ \t ]+/g, ' ').replace(/(["”]) (?=[.,;:](?:\s|$))/g, '$1').trim())
    .filter((line) => line.length > 0 && !REALLOCATED.test(line) && !PRINTER.test(line))
  while (lines.length > 0 && (HISTORY.test(lines.at(-1)!) || ARTICLE.test(lines.at(-1)!))) lines.pop()
  if (lines.length === 0) throw new Unavailable('the file holds the catchline and history, and no text')
  lines[0] = withoutLeadingNumbers(lines[0], lines.slice(1), section)
  if (lines[0] === '') lines.shift()
  if (lines.length === 0) throw new Unavailable('the file holds the catchline and history, and no text')
  return lines.join('\n') + '\n'
}

/**
 * The first line without the two numbers the file sets before its first label,
 * neither of them a word of the law. The section's own number -- "39:4-36. a.
 * The driver…" -- is its heading, as the catchline is. And the session law's
 * section number -- "1. a. The use of a wireless telephone…" in 39:4-97.3 --
 * where a label follows it and no later line opens "2.": then it numbers the
 * act, not a paragraph of this section. Left in, either hid the "a." from the
 * chunker, and § 39:4-36(b), the $200 pedestrian fine, was cited as (5).
 * Where a later "2." line exists, the numbers are paragraphs and stay.
 */
export function withoutLeadingNumbers(first: string, rest: string[], section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let line = first.replace(new RegExp(`^${escaped}\\.\\s*`), '')
  const act = /^(\d+)\. (?=[a-z]\. |\([a-z0-9]+\) )/.exec(line)
  if (act !== null && !rest.some((each) => each.startsWith(`${Number(act[1]) + 1}. `))) line = line.slice(act[0].length)
  return line
}
