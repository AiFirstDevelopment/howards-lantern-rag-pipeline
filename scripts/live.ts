/**
 * The deployed index and reranker, reached over Cloudflare's REST API from a
 * script: what the worker calls through its bindings, for the eval and for
 * `npm run statutes:rerank`, so a script measures the box as it runs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PENALTY_COLUMNS, nearLawsNationwideWith, sectionOf, type LawsById, type LawsBySection, type NearLawsNationwide, type PenaltiesFor, type PenaltyRow, type ProcessRowsFor } from '../worker/src/law-nationwide'
import { RERANK_MODEL, haikuRerankFor, type Rerank } from '../worker/src/law-rerank'
import { haikuRephraseFor, type Rephrase } from '../worker/src/law-rephrase'
import { haikuTopicsFor, type ChooseTopics } from '../worker/src/law-topics'
import type { StateLaw } from '../worker/src/law-topics'
import { EMBEDDING_MODEL, LAWS_INDEX, NEAR_ENOUGH, NEAR_LAWS } from '../worker/src/law-vectors'
import { processLawsOf } from './process/source'
import { lawsOf } from './statutes/laws'

const ACCOUNT = 'bc0d77b66c22a79eff22a725d8c7bb49'

/**
 * Cloudflare's REST API, with the retry the worker's bindings do for free.
 *
 * The Workers AI endpoint answers 429 under a burst -- twelve times across the
 * last twenty-five cases of the whole eval on 2026-10-10 -- and a 429 read
 * here as `result: null` became "the vector index did not answer": the state
 * cases fell back to keyword search and still passed, the two index-path cases
 * could not run without an embedding and were refused as `no-laws`, and a
 * prompt change was nearly blamed for it. So a non-2xx answer or an empty
 * result is retried with backoff, honouring Retry-After when Cloudflare sends
 * it, and what the throw says is the error Cloudflare sent.
 */
export const REST_ATTEMPTS = 6

/**
 * Wrangler's OAuth token lasts about an hour, and `wrangler auth token`
 * refreshes it when asked. Read once at the start, it expired under a long
 * eval on 2026-10-15 and every later case failed "401 Authentication error
 * after 6 attempts", so a 401 asks for the token again before the next try.
 */
function currentToken(): string {
  return (
    process.env.CLOUDFLARE_API_TOKEN ??
    execFileSync('npx', ['wrangler', 'auth', 'token'], { encoding: 'utf8' }).trim().split('\n').pop()!.trim()
  )
}

export function caller(token: () => string = currentToken): (route: string, body: unknown) => Promise<unknown> {
  let auth = token()
  return async (route, body) => {
    let last = 'no result'
    for (let attempt = 1; attempt <= REST_ATTEMPTS; attempt += 1) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed = (await response.json().catch(() => null)) as { result?: unknown; errors?: { message: string }[] } | null
      if (response.ok && parsed?.result !== null && parsed?.result !== undefined) return parsed.result
      const said = parsed?.errors?.map((error) => error.message).join('; ')
      last = `${response.status}${said ? ` ${said}` : ''}`
      if (attempt === REST_ATTEMPTS) break
      if (response.status === 401) {
        auth = token()
        continue
      }
      const retryAfter = Number(response.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    throw new Error(`${route}: ${last} after ${REST_ATTEMPTS} attempts`)
  }
}

/**
 * The worker's meaning search, run from here over the REST API: the same model,
 * the same index and the same cutoff as `nearLawsFor` in the worker, so the
 * eval measures the retrieval learners get rather than BM25 alone.
 */
export function nearLawsOverRest(): (code: string, question: string) => Promise<string[]> {
  const call = caller()
  return async (code, question) => {
    const embedded = (await call(`ai/run/${EMBEDDING_MODEL}`, { text: [question] })) as { data: number[][] }
    const found = (await call(`vectorize/v2/indexes/${LAWS_INDEX}/query`, {
      vector: embedded.data[0],
      topK: NEAR_LAWS,
      namespace: code,
    })) as { matches: { id: string; score: number }[] }
    return found.matches.filter((match) => match.score >= NEAR_ENOUGH).map((match) => match.id)
  }
}

/**
 * The deployed reranker: a score per text, in the order given, as `rerankFor`
 * returns -- counting its failures. `chooseLaws` falls back quietly when the
 * reranker fails, as the worker must; a measurement must not, or an expired
 * token reports the old eight as "reranked" and nobody can tell.
 */
export function rerankOverRest(): Rerank & { failures: () => number } {
  const call = caller()
  let failures = 0
  const rerank = async (question: string, texts: string[]) => {
    try {
      const result = (await call(`ai/run/${RERANK_MODEL}`, {
        query: question,
        contexts: texts.map((text) => ({ text })),
        top_k: texts.length,
      })) as { response: { id: number; score: number }[] } | null
      if (result === null || !Array.isArray(result.response)) throw new Error('the reranker returned no result')
      const scores = texts.map(() => Number.NEGATIVE_INFINITY)
      for (const { id, score } of result.response) scores[id] = score
      return scores
    } catch (error) {
      failures += 1
      throw error
    }
  }
  return Object.assign(rerank, { failures: () => failures })
}

/** A measurement the reranker did not take part in, said loudly: non-zero exit. */
export function failed(count: number): number {
  console.error(`\nTHE RERANKER FAILED ${count} TIME(S): these results are not reranked and do not count.`)
  return 3
}

/**
 * The rerank the deployed worker runs: Haiku first, the cross-encoder when
 * Haiku does not answer. `--bge` on the command line runs the cross-encoder
 * alone, so a PR can put the two side by side. `failures` counts questions
 * neither answered; `fellBack` counts Haiku's misses, which the worker would
 * have covered with the cross-encoder.
 */
export function deployedRerankOverRest(): Rerank & { failures: () => number; fellBack: () => number } {
  const bge = rerankOverRest()
  const haiku = process.argv.includes('--bge') ? undefined : haikuRerankFor(process.env.ANTHROPIC_API_KEY)
  let fellBack = 0
  const rerank = async (question: string, texts: string[]) => {
    if (haiku !== undefined) {
      try {
        return await haiku(question, texts)
      } catch (error) {
        fellBack += 1
        console.error('haiku rerank failed, falling back:', error instanceof Error ? error.message : error)
      }
    }
    return bge(question, texts)
  }
  if (haiku === undefined && !process.argv.includes('--bge')) console.error('no ANTHROPIC_API_KEY: reranking with the cross-encoder alone')
  return Object.assign(rerank, { failures: () => bge.failures(), fellBack: () => fellBack })
}

/**
 * The rephraser the deployed worker runs (law-rephrase.ts), so the eval and
 * `statutes:rerank` search the pool the box searches. `--no-rephrase` searches
 * on the question alone, so a PR can put the two side by side.
 */
export function deployedRephrase(): Rephrase | undefined {
  if (process.argv.includes('--no-rephrase')) return undefined
  const rephrase = haikuRephraseFor(process.env.ANTHROPIC_API_KEY)
  if (rephrase === undefined) console.error('no ANTHROPIC_API_KEY: searching on the question alone')
  return rephrase
}

/**
 * The topic chooser the deployed worker runs for a nationwide question
 * (law-topics.ts), so the eval matches questions to topics as the box does.
 * `--no-topics` matches by the question's words alone, the worker's fallback.
 */
export function deployedTopics(): ChooseTopics | undefined {
  if (process.argv.includes('--no-topics')) return undefined
  const choose = haikuTopicsFor(process.env.ANTHROPIC_API_KEY)
  if (choose === undefined) console.error('no ANTHROPIC_API_KEY: matching nationwide questions to topics by words')
  return choose
}

/**
 * At most this many Vectorize queries in flight from a script. The worker
 * sends all 153 at once through its binding; from here they are REST calls on
 * one token, and three concurrent callers of `nearLawsOverRest` were enough to
 * make the embedding endpoint answer null and crash two eval runs.
 */
const NATIONWIDE_REST_QUERIES = 6

/** A call retried while Cloudflare answers null, which it does under load rather than an error. */
async function answered<T>(call: () => Promise<T | null | undefined>, what: string): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await call()
    if (result !== null && result !== undefined) return result
    if (attempt >= 4) throw new Error(`${what}: no result after ${attempt} attempts`)
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
  }
}

/**
 * The worker's nationwide loop (law-nationwide.ts), run from here over the REST
 * API: the same function, given a REST embedder and a REST query in place of
 * the bindings, so the eval searches the 51 namespaces the box searches.
 */
export function nearLawsNationwideOverRest(): NearLawsNationwide {
  const call = caller()
  let running = 0
  const waiting: (() => void)[] = []
  const slot = async () => {
    while (running >= NATIONWIDE_REST_QUERIES) await new Promise<void>((resolve) => waiting.push(resolve))
    running += 1
  }
  const release = () => {
    running -= 1
    waiting.shift()?.()
  }
  return nearLawsNationwideWith(
    async (texts) =>
      (await answered(() => call(`ai/run/${EMBEDDING_MODEL}`, { text: texts }) as Promise<{ data: number[][] } | null>, 'embedding')).data,
    async (vector, state) => {
      await slot()
      try {
        const found = await answered(
          () => call(`vectorize/v2/indexes/${LAWS_INDEX}/query`, { vector, topK: NEAR_LAWS, namespace: state }) as Promise<{
            matches: { id: string; score: number }[]
          } | null>,
          `the ${state} namespace`,
        )
        return found.matches
      } finally {
        release()
      }
    },
  )
}

/**
 * The deployed `laws` table, read over the D1 REST API with the worker's own
 * query. `--store` on the eval reads it; until `npm run laws:store -- --push`
 * has filled the production table it answers "no such table", and the eval
 * reads the same rows from the corpus instead (`lawsByIdFromCorpus`).
 */
export function lawsByIdOverRest(root = process.cwd()): LawsById {
  const call = caller()
  const toml = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8')
  const database = /database_name = "learners-permit"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(toml)?.[1]
  if (database === undefined) throw new Error('worker/wrangler.toml names no database_id for learners-permit')
  return async (ids) => {
    if (ids.length === 0) return []
    const result = (await call(`d1/database/${database}/query`, {
      sql: 'SELECT id, state, kind, law, question, concept, citation FROM laws WHERE id IN (SELECT value FROM json_each(?))',
      params: [JSON.stringify(ids)],
    })) as { results: (Omit<StateLaw, 'kind'> & { kind: string | null })[] }[] | null
    if (result === null) throw new Error('the laws table did not answer: has `npm run laws:store -- --push` filled it?')
    return result[0].results.map(({ kind, ...law }) => ({ ...law, ...(kind === 'statute' ? { kind: 'statute' as const } : {}) }))
  }
}

/**
 * The rows `laws:store` writes, read from the corpus they are written from:
 * every id begins with its state's code, and `lawsOf` is what the push writes.
 * What the eval reads while the production table is empty.
 */
export function lawsByIdFromCorpus(root = process.cwd()): LawsById {
  const states = new Map<string, Map<string, StateLaw>>()
  return async (ids) =>
    ids.flatMap((id) => {
      const code = id.slice(0, 2)
      if (!states.has(code)) states.set(code, new Map(lawsOf(root, code).map((law) => [law.id, { state: code, ...law }])))
      const law = states.get(code)!.get(id)
      return law === undefined ? [] : [law]
    })
}

/**
 * The deployed `laws` table's section lookup, over the D1 REST API with the
 * worker's own query (docs/plans/what-happens-if.md, decision 2). Throws until
 * `ALTER TABLE laws ADD COLUMN section` has been applied to production.
 */
export function lawsBySectionOverRest(root = process.cwd()): LawsBySection {
  const call = caller()
  const toml = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8')
  const database = /database_name = "learners-permit"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(toml)?.[1]
  if (database === undefined) throw new Error('worker/wrangler.toml names no database_id for learners-permit')
  return async (state, sections) => {
    if (sections.length === 0) return []
    const result = (await call(`d1/database/${database}/query`, {
      sql: 'SELECT id, state, kind, law, question, concept, citation FROM laws WHERE state = ? AND section IN (SELECT value FROM json_each(?)) ORDER BY rowid',
      params: [state, JSON.stringify(sections)],
    })) as { results: (Omit<StateLaw, 'kind'> & { kind: string | null })[] }[] | null
    if (result === null) throw new Error('the laws table did not answer by section: has the section column been added and pushed?')
    return result[0].results.map(({ kind, ...law }) => ({ ...law, ...(kind === 'statute' ? { kind: 'statute' as const } : {}) }))
  }
}

/**
 * The same lookup from the corpus the table is written from, in the order the
 * push writes it: what the eval reads while the production table has no
 * `section` column, so a run before the push still measures the whole
 * sections a deployed worker will give once it has run.
 */
export function lawsBySectionFromCorpus(root = process.cwd()): LawsBySection {
  const states = new Map<string, Map<string, StateLaw[]>>()
  return async (state, sections) => {
    if (!states.has(state)) {
      const bySection = new Map<string, StateLaw[]>()
      for (const law of lawsOf(root, state)) {
        const section = sectionOf(law)
        if (section !== null) bySection.set(section, [...(bySection.get(section) ?? []), { state, ...law }])
      }
      states.set(state, bySection)
    }
    return sections.flatMap((section) => states.get(state)!.get(section) ?? [])
  }
}

/**
 * The production table when it can answer by section, else the corpus, said
 * once on stderr so a run's table can be read for which one it measured.
 */
export function lawsBySectionWithFallback(root = process.cwd()): LawsBySection {
  const rest = lawsBySectionOverRest(root)
  const corpus = lawsBySectionFromCorpus(root)
  let use: LawsBySection | null = null
  return async (state, sections) => {
    if (use !== null) return use(state, sections)
    try {
      const rows = await rest(state, sections)
      use = rest
      console.error('whole sections: read from the production laws table')
      return rows
    } catch (error) {
      use = corpus
      console.error(`whole sections: the production laws table cannot answer by section yet (${(error as Error).message}); reading the corpus it is pushed from`)
      return corpus(state, sections)
    }
  }
}

/**
 * The deployed `penalties` table's lookup, over the D1 REST API with the
 * worker's own query (docs/plans/what-happens-if.md, phase 2). Throws until
 * the table has been created on production.
 */
export function penaltiesOverRest(root = process.cwd()): PenaltiesFor {
  const call = caller()
  const toml = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8')
  const database = /database_name = "learners-permit"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(toml)?.[1]
  if (database === undefined) throw new Error('worker/wrangler.toml names no database_id for learners-permit')
  return async (state, sections) => {
    if (sections.length === 0) return []
    const result = (await call(`d1/database/${database}/query`, {
      sql: `SELECT ${PENALTY_COLUMNS} FROM penalties WHERE state = ? AND section IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
      params: [state, JSON.stringify(sections)],
    })) as { results: PenaltyRow[] }[] | null
    if (result === null) throw new Error('the penalties table did not answer: has it been created and pushed?')
    return result[0].results
  }
}

/**
 * The same lookup from the committed `resource/penalties/<XX>.json` the
 * table is pushed from, in the order the push writes it: what the eval and
 * the e2e stub read while production has no table.
 */
export function penaltiesFromFiles(root = process.cwd()): PenaltiesFor {
  return async (state, sections) => {
    const file = path.join(root, 'resource/penalties', `${state}.json`)
    if (!existsSync(file)) return []
    const rows = (JSON.parse(readFileSync(file, 'utf8')) as { rows: PenaltyRow[] }).rows
    return rows.filter((row) => sections.includes(row.section))
  }
}

/** The production table when it can answer, else the committed files, said once on stderr. */
export function penaltiesWithFallback(root = process.cwd()): PenaltiesFor {
  const rest = penaltiesOverRest(root)
  const files = penaltiesFromFiles(root)
  // One probe, shared: the batched eval asks several cases at once, and each
  // asking the missing table on its own was six retries apiece.
  let use: Promise<PenaltiesFor> | null = null
  return async (state, sections) => {
    use ??= rest(state, ['a section no state has']).then(
      () => {
        console.error('fine schedules: read from the production penalties table')
        return rest
      },
      (error: unknown) => {
        console.error(`fine schedules: the production penalties table cannot answer yet (${(error as Error).message}); reading resource/penalties/`)
        return files
      },
    )
    return (await use)(state, sections)
  }
}

/**
 * A state's rows of its own page for one family, read from the committed
 * `resource/process/<XX>.json` the table is pushed from, in the order the push
 * writes them (docs/plans/what-happens-if.md, phase 3): what the eval and the
 * e2e stub read while production has none.
 */
export function processRowsFromFiles(root = process.cwd()): ProcessRowsFor {
  return async (state, family) => processLawsOf(root, state).filter((law) => law.concept === family).map((law) => ({ state, ...law }))
}

/** The deployed `laws` table's family lookup, over the D1 REST API with the worker's own query. */
export function processRowsOverRest(root = process.cwd()): ProcessRowsFor {
  const call = caller()
  const toml = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8')
  const database = /database_name = "learners-permit"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(toml)?.[1]
  if (database === undefined) throw new Error('worker/wrangler.toml names no database_id for learners-permit')
  return async (state, family) => {
    const result = (await call(`d1/database/${database}/query`, {
      sql: "SELECT id, state, kind, law, question, concept, citation, as_of FROM laws WHERE id >= ? AND id < ? AND state = ? AND kind = 'process' AND concept = ? ORDER BY rowid",
      params: [`${state}-R-${family}-`, `${state}-R-${family}.`, state, family],
    })) as { results: (Omit<StateLaw, 'kind' | 'asOf'> & { kind: string | null; as_of: string | null })[] }[] | null
    if (result === null) throw new Error('the laws table did not answer the family lookup')
    return result[0].results.map(({ kind: _kind, as_of, ...law }) => ({ ...law, kind: 'process' as const, ...(as_of === null ? {} : { asOf: as_of }) }))
  }
}

/**
 * The production table when it holds the state's page rows, else the
 * committed files, said once a state on stderr: until `process:fetch -- all
 * --push` has run, the table answers every family with nothing, and a run
 * reading it would measure a box without its pages.
 */
export function processRowsWithFallback(root = process.cwd()): ProcessRowsFor {
  const rest = processRowsOverRest(root)
  const files = processRowsFromFiles(root)
  const said = new Set<string>()
  return async (state, family) => {
    const [stored, committed] = await Promise.all([rest(state, family).catch(() => []), files(state, family)])
    if (stored.length > 0 || committed.length === 0) return stored
    if (!said.has(state)) console.error(`state's own pages: the production laws table holds none of ${state}'s; reading resource/process/`)
    said.add(state)
    return committed
  }
}
