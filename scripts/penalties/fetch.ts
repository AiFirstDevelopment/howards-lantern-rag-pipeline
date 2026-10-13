#!/usr/bin/env tsx
/**
 * What a ticket costs, from the body that sets it (docs/plans/what-happens-if.md,
 * phase 2, decision 11).
 *
 *   npm run penalties:fetch -- MD             fetch Maryland's registered source, write resource/penalties/MD.json
 *   npm run penalties:fetch -- all            every registered state
 *   npm run penalties:fetch -- MD --push      the same, then write the rows to the production `penalties` table
 *   npm run penalties:fetch -- MD --push --local   to the local D1 `wrangler dev` uses
 *
 * `resource/penalties/SOURCES.json` names one source a state and the adapter
 * that reads it (`formats/`). Each row an adapter proposes is written only if
 * its quote is a substring of the text fetched today (`verified`), and a row
 * that fails is named in the output with the words it claimed: a fine that
 * moved since the registry was written is a row missing and said so, never a
 * stale figure printed under the schedule's name.
 *
 * Deterministic and model-free: the same page gives the same rows. A run
 * whose rows are the ones committed changes nothing, keeps the committed
 * date, and says so -- so `penalties:fetch -- all` on a quiet month is a run
 * that proves nothing moved rather than a diff of dates.
 *
 * Pushing is the one thing here that changes something outside the
 * repository, so it is off unless asked for, as `laws:store` is. Rows are
 * written over (INSERT OR REPLACE) and then the state's rows the file no
 * longer holds are deleted, so a state is never without its schedule for the
 * length of the push.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { penaltyStatements } from '../../worker/src/law-nationwide'
import { deleteStatements, localStore, restStore, type Store } from '../laws-store'
import { decoded, pdfText } from '../statutes/fetch'
import { htmlTable } from './formats/html-table'
import { pdfRows } from './formats/pdf-rows'
import { pdfTable } from './formats/pdf-table'
import { statuteList } from './formats/statute-list'
import {
  PENALTIES_DIR,
  SOURCES_FILE,
  normalized,
  verified,
  type Format,
  type FormatName,
  type PenaltyRow,
  type PenaltySource,
  type Rejected,
} from './source'

export { normalized, verified }

export const TABLE = 'penalties'

export const FORMATS: Record<Exclude<FormatName, 'none'>, Format> = {
  'pdf-table': pdfTable,
  'pdf-rows': pdfRows,
  'statute-list': statuteList,
  'html-table': htmlTable,
}

/** What a URL serves, as the text a quote is checked against. Throws when it cannot be had. */
export type PageReader = (url: string) => Promise<string>

/** A state's committed rows, as `resource/penalties/<XX>.json` holds them. */
export interface StatePenalties {
  state: string
  source: { url: string; title: string }
  /** The day these rows were fetched and checked. */
  as_of: string
  /** The sha256 of each page's normalized text, so a reader can tell which edition the rows came from. */
  pages: Record<string, string>
  rows: PenaltyRow[]
}

export function readRegistry(root: string): Record<string, PenaltySource> {
  return JSON.parse(readFileSync(path.join(root, SOURCES_FILE), 'utf8')) as Record<string, PenaltySource>
}

export function stateFile(root: string, code: string): string {
  return path.join(root, PENALTIES_DIR, `${code}.json`)
}

export function readState(root: string, code: string): StatePenalties | null {
  const file = stateFile(root, code)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StatePenalties) : null
}

// Court sites refuse a client that names no browser (the District Court of
// Maryland's PDF answers 403 to a bare fetch), so the agent says it is one and
// says whose it is.
const AGENT = 'Mozilla/5.0 (compatible; howardslantern.com penalty check; +https://howardslantern.com/)'

/**
 * What a browser sends with a page request. New Hampshire's DMV, the New
 * Jersey and North Carolina courts and mass.gov answer 403 to any client that
 * sends a user agent alone and 200 to this set, so a refused request is made
 * once more with it before the source counts as unreachable.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="129", "Not=A?Brand";v="8"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

/** A page's bytes as the text a quote is checked against: a PDF through `pdftotext -layout`, anything else in its charset. */
export function textOf(bytes: Buffer, contentType: string | null): string {
  const isPdf = /pdf/i.test(contentType ?? '') || bytes.subarray(0, 5).toString('latin1') === '%PDF-'
  return isPdf ? pdfText(bytes) : decoded(bytes, contentType)
}

/** The deployed reader: an HTML page as its markup, a PDF through `pdftotext -layout`, three retries with backoff. */
export function liveReader(): PageReader {
  return async (url) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        let response = await fetch(url, { headers: { 'User-Agent': AGENT } })
        if (response.status === 403) response = await fetch(url, { headers: BROWSER_HEADERS })
        if (!response.ok) throw new Error(`${url} answered ${response.status}`)
        return textOf(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'))
      } catch (error) {
        if (attempt >= 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * 4 ** attempt))
      }
    }
  }
}

/**
 * A source a person saved (`file`), read in place of its URL. Missouri's
 * court site answers every scripted client with a bot challenge, so the
 * schedule is downloaded once in a browser to the path the entry names and
 * the fetch reads it there; the rows are still cited to the court's URL, and
 * the quotes are still checked, against the saved copy. With no file saved
 * the URL is fetched as for any source, and a refusal says where the file
 * goes.
 */
export function savedReader(root: string, source: PenaltySource, read: PageReader): PageReader {
  if (source.file === undefined) return read
  const file = path.join(root, source.file)
  return async (url) => {
    if (url === source.url && existsSync(file)) return textOf(readFileSync(file), file.endsWith('.pdf') ? 'application/pdf' : null)
    try {
      return await read(url)
    } catch (error) {
      if (url !== source.url) throw error
      throw new Error(`${error instanceof Error ? error.message : String(error)}; save the schedule from a browser to ${source.file} and run again`)
    }
  }
}

/** What a state's source holds today: its pages read, its rows proposed and checked. Writes nothing. Throws when a page cannot be had. */
export async function extract(
  code: string,
  source: PenaltySource,
  read: PageReader,
  asOf: string,
): Promise<{ rows: PenaltyRow[]; rejected: Rejected[]; pages: Record<string, string> }> {
  if (source.format === 'none') return { rows: [], rejected: [], pages: {} }
  const format = FORMATS[source.format]
  if (format === undefined) throw new Error(`${code}: no adapter for format "${source.format}"`)
  const pages = new Map<string, string>()
  for (const url of format.urls(source)) pages.set(url, await read(url))
  const { rows, rejected } = verified(code, format.rows(pages, source), pages, source, asOf)
  const hashes = Object.fromEntries([...pages].map(([url, text]) => [url, createHash('sha256').update(normalized(text)).digest('hex')]))
  return { rows, rejected, pages: hashes }
}

/** Two sets of rows alike in everything but the day they were checked. */
export function sameRows(left: readonly PenaltyRow[], right: readonly PenaltyRow[]): boolean {
  const undated = (rows: readonly PenaltyRow[]) => JSON.stringify(rows.map(({ as_of: _asOf, ...row }) => row))
  return undated(left) === undated(right)
}

/**
 * One state: fetched, checked, and written to `resource/penalties/<XX>.json`
 * unless its rows are the ones committed. Every rejected row is logged with
 * its code, its section and the words it claimed.
 */
export async function fetchState(
  root: string,
  code: string,
  options: { read?: PageReader; today?: string; log?: (line: string) => void } = {},
): Promise<{ rows: PenaltyRow[]; rejected: Rejected[]; written: boolean }> {
  const log = options.log ?? console.log
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const source = readRegistry(root)[code]
  if (source === undefined) throw new Error(`${code} has no entry in ${SOURCES_FILE}`)
  if (source.format === 'none') {
    log(`${code}: ${source.kind}, no rows registered (${source.url})`)
    return { rows: [], rejected: [], written: false }
  }
  const { rows, rejected, pages } = await extract(code, source, savedReader(root, source, options.read ?? liveReader()), today)
  for (const each of rejected) log(`NOT WRITTEN ${code} ${each.code} (${each.section}): ${each.reason}: "${each.quote}"`)
  const committed = readState(root, code)
  // A layout change that reads as no rows at all is a broken adapter, not a
  // schedule that was repealed: written, the file would empty and `--push`
  // would delete every row the state had.
  if (rows.length === 0 && (committed?.rows.length ?? 0) > 0) {
    throw new Error(`${code}: the source gave no rows where ${committed!.rows.length} are committed; nothing written`)
  }
  if (committed !== null && sameRows(committed.rows, rows)) {
    log(`${code}: ${rows.length} rows, unchanged since ${committed.as_of}; nothing written`)
    return { rows: committed.rows, rejected, written: false }
  }
  const out: StatePenalties = { state: code, source: { url: source.url, title: source.title }, as_of: today, pages, rows }
  mkdirSync(path.dirname(stateFile(root, code)), { recursive: true })
  writeFileSync(stateFile(root, code), `${JSON.stringify(out, null, 2)}\n`)
  log(`${code}: ${rows.length} rows written to ${path.relative(root, stateFile(root, code))}${rejected.length === 0 ? '' : `, ${rejected.length} not written`}`)
  return { rows, rejected, written: true }
}

/** A state's committed rows into the table: written over, then the ids the file no longer holds deleted. */
export async function pushState(store: Store, code: string, rows: readonly PenaltyRow[]): Promise<void> {
  await store.run(penaltyStatements(rows))
  const now = new Set(rows.map((row) => row.id))
  const gone = (await store.ids(code)).filter((id) => !now.has(id))
  await store.run(deleteStatements(code, gone, TABLE))
}

export async function run(root: string, args: readonly string[], options: { read?: PageReader; store?: () => Store; log?: (line: string) => void } = {}): Promise<number> {
  const log = options.log ?? console.log
  const registry = readRegistry(root)
  const named = args.filter((arg) => /^[A-Z]{2}$/.test(arg))
  const codes = args.includes('all') ? Object.keys(registry) : named
  if (codes.length === 0) {
    log('name a state (penalties:fetch -- MD) or all')
    return 2
  }
  let failed = 0
  const fetched = new Map<string, PenaltyRow[]>()
  for (const code of codes) {
    try {
      fetched.set(code, (await fetchState(root, code, { read: options.read, log })).rows)
    } catch (error) {
      failed += 1
      log(`UNREACHABLE ${code}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (args.includes('--push')) {
    const store = options.store?.() ?? (args.includes('--local') ? localStore(root, TABLE) : restStore(root, TABLE))
    for (const [code, rows] of fetched) {
      if (registry[code].format === 'none') continue
      await pushState(store, code, rows)
      log(`${code}: ${rows.length} rows pushed to the ${TABLE} table`)
    }
  } else {
    log('run with --push to write them to the penalties table')
  }
  return failed === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.cwd(), process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(2)
    },
  )
}
