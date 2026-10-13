#!/usr/bin/env tsx
/**
 * Every law the ask box can quote, written into the D1 `laws` table the worker
 * reads a nationwide question's laws from (docs/plans/nationwide.md, phase 2).
 *
 *   npm run laws:store                        report which states differ from the manifest; change nothing
 *   npm run laws:store -- --push              write those states' rows to the production D1, then rewrite the manifest
 *   npm run laws:store -- --push MD           the same, for one state
 *   npm run laws:store -- --push --all        every state, whatever the manifest says: a database that has never been filled
 *   npm run laws:store -- --push --local      to the local D1 `wrangler dev` uses, rather than production
 *
 * The rows are exactly what Pages publishes at /ask-laws/<CODE>.json and what
 * `laws:embed` embeds: `lawsOf`, plus the state. The index returns an id, and
 * the worker shows the words this table holds for it, so the two are filled
 * from the one function or the box quotes a law the index never ranked.
 *
 * `resource/laws-store.json` records, per state, a hash of what was written.
 * tests/unit/laws-store.test.ts recomputes it, so a corpus change deployed
 * without a push is red in the suite rather than a nationwide answer quoting a
 * law as it used to read. Any push rewrites it, a `--local` one included --
 * so after testing locally, the production push is `--push --all`.
 *
 * A state's rows are written over (INSERT OR REPLACE) and then its rows the
 * corpus no longer holds are deleted: deleting first would leave the state
 * with no laws for the length of the push, and every nationwide question in
 * that window would name it as having no rule.
 *
 * Pushing is the one thing here that changes something outside the
 * repository, so it is off unless asked for, as in scripts/law-vectors.ts.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORE_STATEMENT_BYTES, sectionOf, storeStatements } from '../worker/src/law-nationwide'
import type { AskLaw } from '../worker/src/law-retrieval'
import { statesOf } from './law-vectors'
// What Pages publishes, the state's own pages included: the family lookup reads
// them from the table.
import { publishedLawsOf as lawsOf } from './statutes/laws'

export { lawsOf, sectionOf, statesOf }

export const MANIFEST_FILE = 'resource/laws-store.json'
export const TABLE = 'laws'
const ACCOUNT = 'bc0d77b66c22a79eff22a725d8c7bb49'
const DATABASE = 'learners-permit'

export interface StoreManifest {
  table: string
  states: Record<string, { laws: number; sha256: string }>
}

/**
 * What was written for a state, as one hash: each id and every column written
 * for it. The section is a column of its own (docs/plans/what-happens-if.md,
 * decision 1) though it is derived from the citation: a change to how it is
 * derived changes no citation, and without it here the table would keep the
 * old sections and the manifest would call it current.
 */
export function fingerprint(state: string, laws: AskLaw[]): string {
  const hash = createHash('sha256')
  for (const law of laws) {
    hash.update(`${law.id}\u0000${JSON.stringify([state, law.kind ?? null, law.law, law.question, law.concept, law.citation, law.asOf ?? null, sectionOf(law)])}\u0001`)
  }
  return hash.digest('hex')
}

export function readManifest(file: string): StoreManifest {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoreManifest
  } catch {
    return { table: TABLE, states: {} }
  }
}

/** Where the rows go: production over the REST API, or the local D1 through wrangler. */
export interface Store {
  /** Statements, in order, each run to completion before the next. */
  run(statements: string[]): Promise<void>
  /** The ids the table holds for a state. */
  ids(state: string): Promise<string[]>
}

/** The statements that delete a state's rows the corpus no longer holds, each under the statement limit. */
export function deleteStatements(state: string, gone: readonly string[], table = TABLE): string[] {
  const out: string[] = []
  let batch: string[] = []
  const flush = () => {
    if (batch.length > 0) out.push(`DELETE FROM ${table} WHERE state = '${state}' AND id IN (${batch.join(', ')})`)
    batch = []
  }
  let size = 0
  for (const id of gone) {
    const quoted = `'${id.replace(/'/g, "''")}'`
    if (size + quoted.length + 2 > STORE_STATEMENT_BYTES - 200) {
      flush()
      size = 0
    }
    batch.push(quoted)
    size += quoted.length + 2
  }
  flush()
  return out
}

async function pushState(store: Store, state: string, laws: AskLaw[]): Promise<void> {
  await store.run(storeStatements(state, laws))
  const now = new Set(laws.map((law) => law.id))
  const gone = (await store.ids(state)).filter((id) => !now.has(id))
  await store.run(deleteStatements(state, gone))
}

function databaseId(root: string): string {
  const toml = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8')
  const id = /database_name = "learners-permit"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(toml)?.[1]
  if (id === undefined) throw new Error('worker/wrangler.toml names no database_id for learners-permit')
  return id
}

function token(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  return execFileSync('npx', ['wrangler', 'auth', 'token'], { encoding: 'utf8' }).trim().split('\n').pop()!.trim()
}

/**
 * The production D1, statement by statement over the REST API, retried as
 * law-vectors.ts retries. `table` is whose ids `ids` reads: the penalties
 * push (scripts/penalties/fetch.ts) uses the same store for its own table.
 */
export function restStore(root: string, table = TABLE): Store {
  const auth = token()
  const database = databaseId(root)
  const query = async (sql: string): Promise<{ results: Record<string, unknown>[] }[]> => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${database}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      })
      const parsed = (await response.json()) as { success: boolean; errors: unknown; result: { results: Record<string, unknown>[] }[] }
      if (parsed.success) return parsed.result
      if (attempt >= 4) throw new Error(`d1 query: ${response.status} ${JSON.stringify(parsed.errors)}`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
  return {
    run: async (statements) => {
      for (const sql of statements) await query(sql)
    },
    ids: async (state) =>
      (await query(`SELECT id FROM ${table} WHERE state = '${state}'`))[0].results.map((row) => row.id as string),
  }
}

/** The local D1 (`.wrangler/state`), through `wrangler d1 execute --local`: what the push's SQL does, without production. */
export function localStore(root: string, table = TABLE): Store {
  const dir = mkdtempSync(path.join(tmpdir(), 'laws-store-'))
  const wrangler = (args: string[]) =>
    execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--local', '--config', 'worker/wrangler.toml', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
  return {
    // One file a state: wrangler takes seconds to start, and a state is up
    // to fifty statements.
    run: async (statements) => {
      if (statements.length === 0) return
      const file = path.join(dir, 'statements.sql')
      writeFileSync(file, statements.map((sql) => `${sql};\n`).join(''))
      wrangler(['--file', file])
    },
    ids: async (state) => {
      const out = JSON.parse(wrangler(['--json', '--command', `SELECT id FROM ${table} WHERE state = '${state}'`])) as {
        results: { id: string }[]
      }[]
      return out[0].results.map((row) => row.id)
    },
  }
}

/** The states whose laws differ from what the manifest says was written, in the manifest's state order. */
export function staleStates(root: string, manifest: StoreManifest, only: readonly string[] = []): string[] {
  return statesOf(root).filter(
    (code) => (only.length === 0 || only.includes(code)) && manifest.states[code]?.sha256 !== fingerprint(code, lawsOf(root, code)),
  )
}

/**
 * One run, from the command line's arguments. Returns the exit code: 0 when
 * nothing is stale or the push finished, 1 when a report found stale states.
 * `store` and `manifestFile` are for tests/unit/laws-store.test.ts.
 */
export async function run(
  root: string,
  args: readonly string[],
  options: { store?: () => Store; manifestFile?: string; log?: (line: string) => void } = {},
): Promise<number> {
  const log = options.log ?? console.log
  const file = options.manifestFile ?? path.join(root, MANIFEST_FILE)
  const pushing = args.includes('--push')
  const only = args.filter((arg) => /^[A-Z]{2}$/.test(arg))
  const manifest = readManifest(file)
  const stale = args.includes('--all')
    ? statesOf(root).filter((code) => only.length === 0 || only.includes(code))
    : staleStates(root, manifest, only)
  if (stale.length === 0) {
    log('every state is stored as committed')
    return 0
  }
  log(`${stale.length} state(s) to store: ${stale.join(' ')}`)
  if (!pushing) {
    log('run with --push to write them to the laws table')
    return 1
  }
  const store = options.store?.() ?? (args.includes('--local') ? localStore(root) : restStore(root))
  for (const code of stale) {
    const laws = lawsOf(root, code)
    await pushState(store, code, laws)
    manifest.states[code] = { laws: laws.length, sha256: fingerprint(code, laws) }
    // Written after every state, so a run that dies half way records what it did.
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
    log(`${code}: ${laws.length} laws`)
  }
  return 0
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
