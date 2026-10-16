#!/usr/bin/env tsx
/**
 * Every law the ask box can answer from, embedded and put into the Vectorize
 * index the worker searches beside BM25 (docs/plans/law-vectors.md).
 *
 *   npm run laws:embed                 report which states differ from the manifest; change nothing
 *   npm run laws:embed -- --push       embed and upsert those states, then rewrite the manifest
 *   npm run laws:embed -- --push MD    the same, for one state
 *   npm run laws:embed -- --push --kind process     embed only the rows of the states' own pages, in every state that has them
 *   npm run laws:embed -- --push MD --no-eval        the push without the retrieval eval it ends with
 *
 * `--kind process` is for the one case where the rest of a state is already
 * embedded and only its page rows are new (docs/plans/what-happens-if.md,
 * phase 3): the pull request that adds them commits the manifest as it will
 * be once they are in the index, as it does for `laws:store`, so a plain
 * `--push` would find nothing stale and embed nothing, and a whole-state push
 * would re-embed every subsection of a state's code to add a few page rows.
 * It embeds those rows whatever the manifest says, and records each state as
 * embedded as committed.
 *
 * The laws are exactly what Pages publishes at /ask-laws/<CODE>.json
 * (`retrievalFile`), embedded as "<rule> <the card's question>" with the same
 * model the worker embeds a question with, one Vectorize namespace per state.
 *
 * `resource/law-vectors.json` records, per state, a hash of what was embedded.
 * tests/unit/law-vectors.test.ts recomputes it, so a corpus or statute change
 * that was not re-embedded is red in the suite rather than a ranking that
 * quietly drifts. A stale index cannot put wrong text on screen -- the worker
 * reads every law's words from the published file, by id -- but it can rank a
 * law that changed as though it had not, and that is worth a red test.
 *
 * Pushing is the one thing here that changes something outside the
 * repository, so it is off unless asked for, as in scripts/kb-push.ts.
 *
 * Each state embedded ends with the retrieval eval for it, as `laws:store`
 * does (scripts/push-eval.ts, docs/plans/eval-lifecycle-build.md, decision
 * 35): `evalRecall` and `evalMrr` beside the hash, `null` with the reason
 * when there is nothing to score, and left as they were with `--no-eval`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBEDDING_MODEL, LAWS_INDEX, embeddingText } from '../worker/src/law-vectors'
import type { AskLaw } from '../worker/src/law-retrieval'
// What Pages publishes, the state's own pages included: the index ranks every
// row the box can be given.
import { publishedLawsOf as lawsOf } from './statutes/laws'
import { evalLine, harnessEval, skipsEval, withFigures, type EvalFigures } from './push-eval'

export { lawsOf }

export const MANIFEST_FILE = 'resource/law-vectors.json'
const ACCOUNT = 'bc0d77b66c22a79eff22a725d8c7bb49'

export interface VectorManifest {
  index: string
  model: string
  states: Record<string, { laws: number; sha256: string } & Partial<EvalFigures>>
}

export function statesOf(root: string): string[] {
  const manifest = JSON.parse(readFileSync(path.join(root, 'resource/manifest.json'), 'utf8')) as {
    products: { id: string; states: { code: string }[] }[]
  }
  return manifest.products.filter((product) => product.id === 'drivers').flatMap((p) => p.states.map((s) => s.code))
}

/** What was embedded for a state, as one hash: each id and the exact text embedded for it. */
export function fingerprint(laws: AskLaw[]): string {
  const hash = createHash('sha256')
  for (const law of laws) hash.update(`${law.id}\u0000${embeddingText(law)}\u0001`)
  return hash.digest('hex')
}

export function readManifest(root: string): VectorManifest {
  try {
    return JSON.parse(readFileSync(path.join(root, MANIFEST_FILE), 'utf8')) as VectorManifest
  } catch {
    return { index: LAWS_INDEX, model: EMBEDDING_MODEL, states: {} }
  }
}

function token(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  return execFileSync('npx', ['wrangler', 'auth', 'token'], { encoding: 'utf8' }).trim().split('\n').pop()!.trim()
}

async function api(auth: string, route: string, body: string, contentType: string): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': contentType },
      body,
    })
    const parsed = (await response.json()) as { success: boolean; errors: unknown; result: unknown }
    if (parsed.success) return parsed.result
    if (attempt >= 4) throw new Error(`${route}: ${response.status} ${JSON.stringify(parsed.errors)}`)
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

/** At most this many laws in one embedding request: Vectorize's upsert takes them a hundred at a time. */
const BATCH_LAWS = 100

/**
 * At most this many characters in one embedding request, **counted as every
 * law the length of the longest**. bge-m3 refuses a request over 60,000
 * tokens, and it pads each text in a request to the longest one: Alabama's
 * refusal read 68,400 tokens before and after the request was cut by its
 * summed length, because it was 100 texts padded to one of 684 tokens.
 * Prose runs about three characters a token, but statute tables and fee
 * schedules run nearer one and a half: Kansas's 120,000 padded characters
 * came to 75,012 tokens and were refused. 60,000 padded characters stays
 * under the limit at that density.
 */
const BATCH_CHARS = 60_000

/** The laws in embedding requests, each under both limits as the model counts them, in order. */
export function batches(laws: AskLaw[]): AskLaw[][] {
  const out: AskLaw[][] = []
  let current: AskLaw[] = []
  let longest = 0
  for (const law of laws) {
    const size = embeddingText(law).length
    const padded = (current.length + 1) * Math.max(longest, size)
    if (current.length > 0 && (current.length >= BATCH_LAWS || padded > BATCH_CHARS)) {
      out.push(current)
      current = []
      longest = 0
    }
    current.push(law)
    longest = Math.max(longest, size)
  }
  if (current.length > 0) out.push(current)
  return out
}

async function apiGet(auth: string, route: string): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/${route}`, { headers: { Authorization: `Bearer ${auth}` } })
    const parsed = (await response.json()) as { success: boolean; errors: unknown; result: unknown }
    if (parsed.success) return parsed.result
    if (attempt >= 4) throw new Error(`${route}: ${response.status} ${JSON.stringify(parsed.errors)}`)
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

/** A push's last upsert: the mutation Vectorize answered it with, or null when its answer named none. */
export interface LastMutation {
  id: string | null
}

/** What `vectorize/v2/indexes/<name>/info` says about how far the index has applied its mutations. */
export interface IndexProgress {
  processedUpToMutation?: string | null
}

/** How long a push waits for the index to apply its last upsert before its eval is recorded as null. */
export const INDEX_WAIT_MS = 10 * 60_000

/**
 * Wait until the index has applied the push's last upsert, so the eval after
 * it ranks against the vectors just written. Vectorize accepts an upsert and
 * applies it later: an eval run on acceptance would score the previous
 * vectors and record that figure beside the new hash. Applied means the info
 * names this mutation as the last processed. `processedUpToDatetime` is not
 * used: it is the server's clock against this machine's, and a skew of
 * seconds would call an unapplied push applied -- a wrong figure, where a
 * wait that runs out is only a null one. Null when applied; otherwise why
 * not, after `timeoutMs`.
 */
export async function awaitIndexed(
  last: LastMutation | null,
  progress: () => Promise<IndexProgress>,
  options: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<string | null> {
  if (last === null) return null
  const timeoutMs = options.timeoutMs ?? INDEX_WAIT_MS
  const intervalMs = options.intervalMs ?? 10_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  // An upsert answered without a mutation id cannot be waited for; going on
  // anyway would be the eval-on-acceptance this exists to prevent.
  if (last.id === null) return 'Vectorize answered the push’s last upsert with no mutationId, so whether the index applied it cannot be known'
  const started = now()
  for (;;) {
    const info = await progress()
    if (info.processedUpToMutation === last.id) return null
    if (now() - started >= timeoutMs) {
      return `the index had not applied the push's last upsert (${last.id}) after ${Math.round(timeoutMs / 60_000)} minutes, so an eval would measure the previous vectors`
    }
    await sleep(intervalMs)
  }
}

async function push(root: string, code: string, auth: string, kind?: string): Promise<{ count: number; last: LastMutation | null }> {
  const laws = lawsOf(root, code).filter((law) => kind === undefined || law.kind === kind)
  let last: LastMutation | null = null
  for (const batch of batches(laws)) {
    const embedded = (await api(
      auth,
      `ai/run/${EMBEDDING_MODEL}`,
      JSON.stringify({ text: batch.map(embeddingText) }),
      'application/json',
    )) as { data: number[][] }
    const ndjson = batch
      .map((law, index) => JSON.stringify({ id: law.id, namespace: code, values: embedded.data[index] }))
      .join('\n')
    const upserted = (await api(auth, `vectorize/v2/indexes/${LAWS_INDEX}/upsert`, ndjson, 'application/x-ndjson')) as { mutationId?: string } | null
    last = { id: typeof upserted?.mutationId === 'string' ? upserted.mutationId : null }
  }
  return { count: laws.length, last }
}

async function main(): Promise<number> {
  const root = process.cwd()
  const args = process.argv.slice(2)
  const pushing = args.includes('--push')
  const only = args.filter((arg) => /^[A-Z]{2}$/.test(arg))
  const kind = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : undefined
  if (kind !== undefined && kind !== 'process') throw new Error(`--kind takes process, not ${kind}`)
  const manifest = readManifest(root)
  const stale = statesOf(root).filter(
    (code) =>
      (only.length === 0 || only.includes(code)) &&
      (kind === undefined
        ? manifest.states[code]?.sha256 !== fingerprint(lawsOf(root, code))
        : lawsOf(root, code).some((law) => law.kind === kind)),
  )
  if (stale.length === 0) {
    console.log('every state is embedded as committed')
    return 0
  }
  console.log(`${stale.length} state(s) to embed: ${stale.join(' ')}`)
  if (!pushing) {
    console.log('run with --push to embed them into the index')
    return 1
  }
  const auth = token()
  const skipping = skipsEval(args)
  const evaluate = harnessEval(root)
  const write = () => writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
  for (const code of stale) {
    const { count, last } = await push(root, code, auth, kind)
    const laws = lawsOf(root, code)
    const previous = manifest.states[code]
    const entry = { laws: laws.length, sha256: fingerprint(laws) }
    // Null until this push's eval says otherwise, as in laws-store.ts: a run
    // that dies in the eval must not leave old figures beside a new hash.
    manifest.states[code] = withFigures(entry, previous, skipping ? 'skipped' : { evalRecall: null, evalMrr: null })
    // Written after every state, so a run that dies half way records what it did.
    write()
    console.log(`${code}: ${count} ${kind === undefined ? 'laws' : `${kind} rows`}`)
    if (skipping) continue
    const unapplied = await awaitIndexed(last, async () => (await apiGet(auth, `vectorize/v2/indexes/${LAWS_INDEX}/info`)) as IndexProgress)
    const result = unapplied === null ? evaluate(code) : { evalRecall: null, evalMrr: null, why: unapplied }
    manifest.states[code] = withFigures(entry, previous, result)
    write()
    console.log(evalLine(code, result))
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(2)
    },
  )
}
