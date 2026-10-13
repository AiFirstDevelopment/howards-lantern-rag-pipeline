#!/usr/bin/env tsx
/**
 * The committed copies of a state's vehicle code (docs/plans/vehicle-code.md),
 * and the check that they are still what the legislature serves.
 *
 *   npm run statutes:fetch -- MD            write resource/statutes/sources/MD/*.txt and its SOURCES.json
 *   npm run statutes:fetch -- MD --refresh  the same, re-fetching files already present
 *   npm run statutes:check                  re-fetch every source and report any that changed
 *
 * Only an official site is ever read: the state's legislature, or the publisher
 * it designates. Each state's titles and how to list them are in
 * `sites/<CODE>.ts`, so adding a source is an edit somebody reviews rather than
 * a URL typed at a prompt.
 *
 * What is committed is the section's text as extracted here, not the page's
 * HTML: the page carries share links and session tokens that change on every
 * load, and a hash over those would report a change every year whether or not
 * the law moved. The extraction is deterministic, so the hash is over the law.
 *
 * A state is hundreds of requests, so the fetch is polite and resumable: one
 * request a second, a named User-Agent, three retries with backoff, and a file
 * already present at its recorded hash is skipped -- a run that dies at section
 * 600 of 800 picks up at 601 rather than asking the legislature for 600 pages
 * again.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bodyLines } from '../../worker/src/code-chunks'
import { SOURCES_DIR, readSources, sourcesFile } from './laws'
import { Unavailable, type Listing, type Site, type SourceFile, type StateSources } from './site'

export { SOURCES_DIR, readSources, sourcesFile }

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A state's site module, or null where none has been written. */
export async function siteOf(code: string): Promise<Site | null> {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sites', `${code}.ts`)
  if (!existsSync(file)) return null
  return ((await import(file)) as { default: Site }).default
}

const AGENT = 'howardslantern.com statute check (+https://howardslantern.com/)'
const PAUSE_MS = 1000
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * What a URL serves, as text: a page as its HTML, a PDF through `pdftotext`
 * (the drivers'-manual precedent), with the PDF's own bytes hashed so a
 * reader can see which file the text was taken from.
 */
/**
 * Pages already read in this run, by URL without its fragment -- a fragment is
 * never sent to a server. Colorado publishes each title as one file of 6 to 10
 * MB and names a section by its anchor in it; read section by section, its 413
 * sections were 413 downloads of the same few files, about 3 GB from a small
 * office's server. Nothing outlives the process.
 */
const pages = new Map<string, Promise<{ body: string; pdf?: string }>>()

/** What a URL serves, read once per run however many sections name it. */
export function fetchedPage(url: string): { page: Promise<{ body: string; pdf?: string }>; cached: boolean } {
  const key = url.split('#')[0]
  const cached = pages.has(key)
  if (!cached) {
    const page = fetched(key)
    pages.set(key, page)
    page.catch(() => pages.delete(key))
  }
  return { page: pages.get(key)!, cached }
}

/**
 * A PDF's text, through `pdftotext` reading a temp file. Piped on stdin it
 * hung forever about once in 10-20 of Iowa's section PDFs -- blocked in
 * `fread` waiting for an EOF that never came -- three runs in a row at
 * different sections; read from a file it does not, and a timeout makes any
 * other stall an error the retry loop sees rather than a run that never ends.
 */
export function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'statute-pdf-'))
  const file = path.join(dir, 'section.pdf')
  try {
    writeFileSync(file, bytes)
    // A whole chapter can be one PDF: New Mexico's Chapter 66 is 1,024 pages,
    // about 2 MB of text, and overflowed the default 1 MB buffer (ENOBUFS).
    return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A section's body: the site's own reader where it has one (California's archive), else its page. */
export function sectionPage(site: Pick<Site, 'read'>, listing: Listing): { page: Promise<{ body: string; pdf?: string }>; cached: boolean } {
  if (site.read === undefined) return fetchedPage(listing.url)
  return { page: site.read(listing).then((body) => ({ body })), cached: false }
}

async function fetched(url: string): Promise<{ body: string; pdf?: string }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': AGENT } })
      if (!response.ok) throw new Error(`${url} answered ${response.status}`)
      const isPdf = /pdf/i.test(response.headers.get('content-type') ?? '') || /\.pdf($|\?)/i.test(url)
      if (!isPdf) return { body: decoded(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type')) }
      const bytes = Buffer.from(await response.arrayBuffer())
      return { body: pdfText(bytes), pdf: createHash('sha256').update(bytes).digest('hex') }
    } catch (error) {
      if (attempt >= 4) throw error
      await pause(PAUSE_MS * 4 ** attempt)
    }
  }
}

/**
 * A page's text in the charset it was sent in. `response.text()` reads every
 * page as UTF-8, and Alaska's reader sends ISO-8859-1: its curly quotes,
 * section signs and dashes came back as U+FFFD, and the only way to commit
 * a quote was to guess the character back -- a committed source that is not
 * what the legislature served. The header names the charset; failing that,
 * the page's own `<meta charset>`; failing both, UTF-8. TextDecoder maps the
 * ISO-8859-1 label to windows-1252, as browsers do, so its quotes survive.
 */
export function decoded(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes)
  } catch {
    throw new Error(`a page declared a charset this fetch cannot decode: ${declared}`)
  }
}

/**
 * A section kept only as a marker: "Repealed.", "[Reserved]". The body has to
 * *be* the marker, not merely contain the word: a page that came back as a
 * footer -- "All rights reserved." -- matched the looser test, was filed as
 * repealed, and so skipped every check a page of navigation should fail.
 */
function isRepealed(text: string, section: string): boolean {
  const body = bodyLines({ text, section }).join(' ')
  return body.length < 200 && /^[\[(]?(repealed|reserved|renumbered|transferred)\b/i.test(body)
}

async function fetchState(root: string, code: string, refresh: boolean): Promise<void> {
  const site = await siteOf(code)
  if (site === null) throw new Error(`no site module at scripts/statutes/sites/${code}.ts`)
  const listings: Listing[] = await site.enumerate()
  const previous = readSources(root, code)
  const sources: StateSources = { official: site.official, name: site.name, titles: site.titles, files: previous?.files ?? {} }
  const write = () => {
    mkdirSync(path.join(root, SOURCES_DIR, code), { recursive: true })
    writeFileSync(path.join(root, sourcesFile(code)), JSON.stringify(sources, null, 2) + '\n')
  }
  const today = new Date().toISOString().slice(0, 10)
  const unavailable: string[] = []
  let fetchedCount = 0
  let skipped = 0
  for (const [index, listing] of listings.entries()) {
    const file = path.join(root, SOURCES_DIR, code, `${listing.file}.txt`)
    const recorded = sources.files[listing.file]
    if (!refresh && recorded !== undefined && existsSync(file) && sha256(readFileSync(file, 'utf8')) === recorded.sha256) {
      // The listing may have learnt a catchline since; the text has not moved.
      sources.files[listing.file] = { ...recorded, section: listing.section, cite: listing.cite, heading: listing.heading }
      skipped += 1
      continue
    }
    const { page, cached } = sectionPage(site, listing)
    const { body, pdf } = await page
    let text: string
    try {
      text = site.extract(body, listing)
    } catch (error) {
      if (!(error instanceof Unavailable)) throw error
      unavailable.push(`${listing.file} (${error.message})`)
      delete sources.files[listing.file]
      if (existsSync(file)) unlinkSync(file)
      if (!cached) await pause(PAUSE_MS)
      continue
    }
    // The state's folder on its first section: a new state's first run
    // otherwise died with ENOENT before writing anything.
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
    const entry: SourceFile = {
      url: listing.url,
      retrieved: today,
      sha256: sha256(text),
      section: listing.section,
      cite: listing.cite,
      heading: listing.heading,
      ...(pdf === undefined ? {} : { pdfSha256: pdf }),
      ...(isRepealed(text, listing.section) ? { repealed: true } : {}),
    }
    sources.files[listing.file] = entry
    fetchedCount += 1
    // Written as it goes, so a run that dies records every file it finished.
    if (fetchedCount % 20 === 0) write()
    console.log(`${code} ${index + 1}/${listings.length} ${listing.file}: ${text.length} characters`)
    // Polite to the site, not to the cache: a section read from a page already
    // fetched asked nobody for anything.
    if (!cached) await pause(PAUSE_MS)
  }
  write()
  const gone = new Set(unavailable.map((each) => each.split(' ')[0]))
  const missing = listings.filter(
    (listing) => !gone.has(listing.file) && !existsSync(path.join(root, SOURCES_DIR, code, `${listing.file}.txt`)),
  )
  for (const each of unavailable) console.log(`UNAVAILABLE ${code} ${each}`)
  console.log(
    `${code}: ${listings.length} listed, ${fetchedCount} fetched, ${skipped} already present, ` +
      `${unavailable.length} unavailable, ${missing.length} missing` +
      (missing.length === 0 ? ' -- every listed section is present or reported' : ''),
  )
}

/** Every committed source against what its URL serves today. Non-zero when any differs. */
async function check(root: string): Promise<number> {
  let changed = 0
  for (const code of statesWithSources(root)) {
    const site = await siteOf(code)
    const sources = readSources(root, code)
    if (site === null || sources === null) continue
    for (const [file, source] of Object.entries(sources.files)) {
      const listing: Listing = { file, url: source.url, section: source.section, cite: source.cite, heading: source.heading }
      const { page, cached } = sectionPage(site, listing)
      const now = sha256(site.extract((await page).body, listing))
      if (now !== source.sha256) {
        changed += 1
        console.log(`CHANGED ${code} ${file}: ${source.url}`)
      }
      if (!cached) await pause(PAUSE_MS)
    }
  }
  console.log(changed === 0 ? 'every source is as committed' : `${changed} source(s) changed: re-read and re-verify`)
  return changed === 0 ? 0 : 1
}

export function statesWithSources(root: string): string[] {
  const dir = path.join(root, SOURCES_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => /^[A-Z]{2}$/.test(name))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  const args = process.argv.slice(2)
  const code = args.find((arg) => /^[A-Z]{2}$/.test(arg))
  const run = args[0] === 'check' ? check(root) : fetchState(root, code ?? '', args.includes('--refresh')).then(() => 0)
  run.then(
    (exit) => process.exit(exit),
    (error: unknown) => {
      console.error(error)
      process.exit(2)
    },
  )
}
