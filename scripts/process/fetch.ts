#!/usr/bin/env tsx
/**
 * What the state's own pages say about the questions no section answers
 * (docs/plans/what-happens-if.md, phase 3, decision 15): how soon a failed
 * test can be taken again, how long a permit is held, what a ticket means.
 *
 *   npm run process:fetch -- MD             fetch Maryland's registered pages, write resource/process/MD.json
 *   npm run process:fetch -- all            every state with a page registered
 *   npm run process:fetch -- MD --push      the same, then write its rows to the production `laws` table
 *   npm run process:fetch -- MD --push --local   to the local D1 `wrangler dev` uses
 *
 * `resource/process/SOURCES.json` names, per state and per family, the
 * licensing agency's or the state court's own page, or `none` and why. Each
 * page is fetched (HTML to text, a PDF through pdftotext) and Haiku is asked
 * for at most five passages that state the family's rule, copied from the
 * page. **A passage is stored only if it is a substring of the page as
 * fetched** (`verifiedPassages`), and one that is not is named in the output
 * with its words: a model asked to copy can paraphrase, and a paraphrase
 * stored under the agency's name is a wait or a deadline nobody published.
 *
 * A page whose committed passages are all still on it is not asked about
 * again: the passages stand, the committed date stays, and nothing is
 * written. So a second run, and the production `--push` after the merge,
 * spend no model call and store exactly what was reviewed; only a page whose
 * passages have gone is read again. A fetch that reads no passages where some
 * are committed writes nothing for the state, as `penalties:fetch` refuses
 * to empty a schedule: the page moved, and the rows that were right stay
 * until a person has looked.
 *
 * The rows are `laws` rows of kind `process`, ids `XX-R-<family>-<n>`,
 * published with the state's file (`publishedLawsOf` in
 * scripts/statutes/laws.ts reads the committed file), found by meaning once
 * `npm run laws:embed -- --push --kind process` has embedded them and by
 * their family's key, never ranked by words (law-retrieval.ts says why). `--push` writes them over the state's rows of this kind and deletes
 * the ones the file no longer holds -- through the `laws:store` store, and
 * `resource/laws-store.json` is brought up to date when the rest of the state
 * was already stored as committed; otherwise it says that
 * `npm run laws:store -- --push XX` is still owed.
 */
import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storeStatements } from '../../worker/src/law-nationwide'
import { REPHRASE_MODEL } from '../../worker/src/law-rephrase'
import { deleteStatements, fingerprint, localStore, readManifest, restStore, MANIFEST_FILE, type Store } from '../laws-store'
import { BROWSER_HEADERS, type PageReader } from '../penalties/fetch'
import { decoded, pdfText } from '../statutes/fetch'
import { publishedLawsOf as lawsOf } from '../statutes/laws'
import {
  PROCESS_FAMILIES,
  isPage,
  pageText,
  processFile,
  processLawsOf,
  readProcessSources,
  readProcessState,
  verifiedPassages,
  type DroppedPassage,
  type FamilyPassages,
  type ProcessFamily,
  type ProcessPage,
  type StateProcess,
} from './source'

export { verifiedPassages }

/**
 * The model that chooses passages: Haiku, the model the worker's topic
 * chooser and rephraser run on. Choosing which sentences of a page state a
 * waiting period is reading, not writing, and the check below is what makes
 * its choice safe to store.
 */
export const PASSAGE_MODEL = REPHRASE_MODEL

/** At most this many characters of a page go to the model: a DMV page is mostly menu, and the rule is in the first part of what is left. */
export const PAGE_CHARS = 60_000

/** The passages a page holds for a family, as the model proposes them, before the check. */
export type Picker = (family: (typeof PROCESS_FAMILIES)[number], page: ProcessPage, text: string) => Promise<string[]>

const PICK_RULES = `You are given the text of one page from a US state's driver licensing agency or court, and a topic.
Copy out at most five passages from the page that state the rule on the topic for a teenage driver: the figure, the waiting period, the number of days, the limit, what to do.
Copy each passage exactly as it is written on the page, character for character: the same words, the same figures, the same punctuation. Do not join sentences that are apart on the page, do not shorten, do not fix spelling.
Each passage is one to three sentences, or one list item with its heading words. Prefer passages with a figure.
Return no passages if the page does not state the rule on the topic.`

const PICK_SCHEMA = {
  type: 'object',
  properties: { passages: { type: 'array', items: { type: 'string' } } },
  required: ['passages'],
  additionalProperties: false,
} as const

/** Haiku as a `Picker`. Throws on anything it cannot read. */
export function haikuPicker(apiKey: string | undefined): Picker {
  const anthropic = new Anthropic({ apiKey, maxRetries: 3 })
  return async (family, page, text) => {
    const response = await anthropic.messages.create({
      model: PASSAGE_MODEL,
      max_tokens: 2048,
      system: PICK_RULES,
      output_config: { format: { type: 'json_schema', schema: PICK_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Topic: ${family.covers}.\nPage: ${page.title} (${page.agency})\n\nThe page's text:\n\n${text.slice(0, PAGE_CHARS)}`,
        },
      ],
    })
    const said = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('')
    const passages = (JSON.parse(said) as { passages?: unknown }).passages
    if (!Array.isArray(passages) || passages.some((passage) => typeof passage !== 'string')) throw new Error(`the picker answered with no passages: ${said}`)
    return passages as string[]
  }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

// Says whose it is, as the penalty fetch does. A licensing agency behind a
// bot filter that refuses it (403) is asked again as the clients the
// discovery pass verified the pages with -- curl's bare "Mozilla/5.0", then a
// browser's full string, which New Hampshire's and Montana's DMVs answer
// where they refuse curl, then a browser's whole header set, which
// ilsos.gov, mass.gov and dmv.colorado.gov answer where they refuse a user
// agent alone -- so a page found to state the rule is not lost to the header
// alone.
const AGENTS = [
  'Mozilla/5.0 (compatible; howardslantern.com process check; +https://howardslantern.com/)',
  'Mozilla/5.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
]

/** The deployed reader: an HTML page as its markup, a PDF through `pdftotext -layout`, three retries with backoff. */
export function pageReader(): PageReader {
  return async (url) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        let response = await fetch(url, { headers: { 'User-Agent': AGENTS[0] } })
        for (const agent of AGENTS.slice(1)) if (response.status === 403) response = await fetch(url, { headers: { 'User-Agent': agent } })
        if (response.status === 403) response = await fetch(url, { headers: BROWSER_HEADERS })
        if (!response.ok) throw new Error(`${url} answered ${response.status}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        const isPdf = /pdf/i.test(response.headers.get('content-type') ?? '') || bytes.subarray(0, 5).toString('latin1') === '%PDF-'
        return isPdf ? leafletText(bytes) : decoded(bytes, response.headers.get('content-type'))
      } catch (error) {
        if (attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * 3 ** attempt))
      }
    }
  }
}

/**
 * A PDF's text in reading order, then as it is laid out. A leaflet printed
 * in three columns reads through `pdftotext -layout` one line across all
 * three -- South Dakota's GDL tri-fold gave "Permit, or Operator's License
 * will be suspended distracted. The most frequent distractions GRADUATED
 * LICENSING", and Texas's DL-60 its 90-day retest rule in three pieces --
 * so no sentence could be copied whole and those pages stored nothing.
 * Plain `pdftotext` keeps each column's sentences together; the laid-out
 * text follows it so a passage committed from it is still on the page.
 */
export function leafletText(bytes: Uint8Array): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'process-pdf-'))
  const file = path.join(dir, 'page.pdf')
  try {
    writeFileSync(file, bytes)
    const plain = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
    return `${plain}\n\n${pdfText(bytes)}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * One state: each registered page fetched once (a page can serve several
 * families), each family's committed passages kept if they still stand, else
 * the model asked and its passages checked. Writes `resource/process/<XX>.json`
 * unless nothing changed. A page that cannot be had keeps its committed
 * passages and is named; it is never read as a page that says nothing.
 */
export async function fetchState(
  root: string,
  code: string,
  options: { read?: PageReader; pick?: Picker; today?: string; log?: (line: string) => void } = {},
): Promise<{ state: StateProcess; dropped: DroppedPassage[]; unreachable: ProcessFamily[]; written: boolean }> {
  const log = options.log ?? console.log
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const entry = readProcessSources(root)[code]
  if (entry === undefined) throw new Error(`${code} has no entry in resource/process/SOURCES.json`)
  const read = options.read ?? pageReader()
  const committed = readProcessState(root, code)
  const families: StateProcess['families'] = {}
  const dropped: DroppedPassage[] = []
  const unreachable: ProcessFamily[] = []
  const texts = new Map<string, Promise<string>>()
  for (const family of PROCESS_FAMILIES) {
    const page = entry[family.id]
    if (!isPage(page)) continue
    const before = committed?.families[family.id]
    let text: string
    try {
      if (!texts.has(page.url)) texts.set(page.url, read(page.url).then(pageText))
      text = await texts.get(page.url)!
    } catch (error) {
      unreachable.push(family.id)
      log(`UNREACHABLE ${code} ${family.id}: ${error instanceof Error ? error.message : String(error)}`)
      if (before !== undefined) families[family.id] = before
      continue
    }
    if (before !== undefined && before.url === page.url && before.passages.every((passage) => verifiedPassages(family.id, [passage], text).passages.length === 1)) {
      families[family.id] = before
      continue
    }
    const proposed = await (options.pick ?? haikuPicker(process.env.ANTHROPIC_API_KEY))(family, page, text)
    const checked = verifiedPassages(family.id, proposed, text)
    for (const each of checked.dropped) log(`NOT STORED ${code} ${each.family}: ${each.reason}: "${each.passage}"`)
    dropped.push(...checked.dropped)
    // A page that moved and now reads as saying nothing is a page a person
    // should look at, not a rule that was repealed: written, the family's
    // rows would vanish and --push would delete them from the table.
    if (checked.passages.length === 0 && (before?.passages.length ?? 0) > 0) {
      throw new Error(`${code} ${family.id}: the page gave no passages where ${before!.passages.length} are committed; nothing written`)
    }
    if (checked.passages.length === 0) {
      log(`${code} ${family.id}: no passage of ${page.url} states the rule`)
      continue
    }
    const kept: FamilyPassages = { url: page.url, title: page.title, agency: page.agency, as_of: today, page: sha(text), passages: checked.passages }
    families[family.id] = kept
  }
  const state: StateProcess = { state: code, families }
  if (committed !== null && JSON.stringify(committed.families) === JSON.stringify(families)) {
    log(`${code}: ${count(state)} passages, unchanged; nothing written`)
    return { state: committed, dropped, unreachable, written: false }
  }
  // A state whose pages stated nothing gets no file: an empty one would read
  // as a state whose pages were read and kept, in the registry test and in
  // the PR's counts.
  if (committed === null && Object.keys(families).length === 0) {
    log(`${code}: no passage of its pages states a rule; nothing written`)
    return { state, dropped, unreachable, written: false }
  }
  mkdirSync(path.dirname(processFile(root, code)), { recursive: true })
  writeFileSync(processFile(root, code), `${JSON.stringify(state, null, 2)}\n`)
  log(`${code}: ${count(state)} passages over ${Object.keys(families).length} families written to ${path.relative(root, processFile(root, code))}${dropped.length === 0 ? '' : `, ${dropped.length} not stored`}`)
  return { state, dropped, unreachable, written: true }
}

function count(state: StateProcess): number {
  return Object.values(state.families).reduce((sum, family) => sum + (family?.passages.length ?? 0), 0)
}

/** A state's process rows into the table: written over, then the state's page rows the file no longer holds deleted. Its other rows are not touched. */
export async function pushState(store: Store, root: string, code: string): Promise<number> {
  const laws = processLawsOf(root, code)
  await store.run(storeStatements(code, laws))
  const now = new Set(laws.map((law) => law.id))
  const gone = (await store.ids(code)).filter((id) => id.startsWith(`${code}-R-`) && !now.has(id))
  await store.run(deleteStatements(code, gone))
  return laws.length
}

export async function run(
  root: string,
  args: readonly string[],
  options: { read?: PageReader; pick?: Picker; store?: () => Store; manifestFile?: string; log?: (line: string) => void } = {},
): Promise<number> {
  const log = options.log ?? console.log
  const registry = readProcessSources(root)
  const named = args.filter((arg) => /^[A-Z]{2}$/.test(arg))
  const codes = args.includes('all') ? Object.keys(registry).filter((code) => Object.values(registry[code]).some(isPage)) : named
  if (codes.length === 0) {
    log('name a state (process:fetch -- MD) or all')
    return 2
  }
  const pushing = args.includes('--push')
  const manifestFile = options.manifestFile ?? path.join(root, MANIFEST_FILE)
  const store = pushing ? (options.store?.() ?? (args.includes('--local') ? localStore(root) : restStore(root))) : null
  let failed = 0
  for (const code of codes) {
    // What the store's manifest would say for the state before this run's
    // passages, so a push can tell "only the pages moved" from "the code is
    // behind too" and record the first without vouching for the second.
    const stored = pushing ? fingerprint(code, lawsOf(root, code)) : null
    try {
      const { unreachable } = await fetchState(root, code, { read: options.read, pick: options.pick, log })
      if (unreachable.length > 0) failed += 1
    } catch (error) {
      failed += 1
      log(`NOT WRITTEN ${code}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (store === null) continue
    const rows = await pushState(store, root, code)
    log(`${code}: ${rows} page rows pushed to the laws table`)
    const manifest = readManifest(manifestFile)
    const laws = lawsOf(root, code)
    const now = fingerprint(code, laws)
    if (manifest.states[code]?.sha256 === stored || manifest.states[code]?.sha256 === now) {
      manifest.states[code] = { laws: laws.length, sha256: now }
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
    } else {
      log(`${code}: the rest of the state is not stored as committed either; run npm run laws:store -- --push ${code}`)
    }
  }
  if (!pushing) log('run with --push to write them to the laws table')
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
