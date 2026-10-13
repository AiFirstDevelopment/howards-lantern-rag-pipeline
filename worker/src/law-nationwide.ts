import type { AskLaw } from './law-retrieval'
import type { StateLaw } from './law-topics'
import { EMBEDDING_MODEL, NEAR_ENOUGH, NEAR_LAWS } from './law-vectors'
import type { PenaltyRow } from './penalty-law'
import { isProcessId, type ProcessFamily } from './process-families'
import { STATE_NAMES } from './states'

/**
 * A nationwide question no topic covers, answered from each state's own
 * nearest laws (docs/plans/nationwide.md, phase 2, decisions 4 and 5).
 *
 * One search over every state's laws together returns the global nearest
 * hundred: thirty chunks from the five states whose codes phrase it like the
 * question and nothing from the other forty-six, and a comparison missing a
 * state is wrong by construction. So every one of the 51 namespaces the index
 * already holds is asked separately, with the question and with each of the
 * rephraser's searches, and each state keeps its own best two. A state with
 * nothing above `NEAR_ENOUGH` is absent and named so, never filled from a
 * neighbour.
 *
 * The index still returns only ids. The words of every law shown come from the
 * `laws` table by id -- never from the vector, and never from the states'
 * files, of which the worker can read one per question and not fifty-one
 * (`/ask-laws/CA.json` alone is 7.6 MB). So the index can rank badly but it
 * cannot put text on screen.
 */

/** At most this many laws a state: the model reads every state's, and fifty-one states of eight would be a book. */
export const NATIONWIDE_PER_STATE = 2

/** Each state that has a law near the question, by code, with its best ids, best first. */
export type NearLawsNationwide = (question: string, searches: readonly string[]) => Promise<Record<string, string[]>>

/** The store's rows for these ids, each with the state it belongs to. Throws when the store cannot be read. */
export type LawsById = (ids: readonly string[]) => Promise<StateLaw[]>

/**
 * A state's rows for these sections, every subsection of each, in the order
 * the table holds them (docs/plans/what-happens-if.md, decision 2). Throws when
 * the store cannot be read.
 */
export type LawsBySection = (state: string, sections: readonly string[]) => Promise<StateLaw[]>

/**
 * A state's rows of its own page for one family of process questions
 * (docs/plans/what-happens-if.md, phase 3, decision 16), and only that
 * state's. Throws when the store cannot be read.
 */
export type ProcessRowsFor = (state: string, family: ProcessFamily) => Promise<StateLaw[]>

/** One namespace's answer to one vector. */
export interface NearHit {
  state: string
  id: string
  score: number
}

/**
 * Every state's best `NATIONWIDE_PER_STATE` ids from the hits of every vector,
 * an id counted once at its best score. The cutoff is applied before the cut,
 * so a state whose best is 0.3 is absent rather than represented by a law
 * that only happened to be the least far away.
 */
export function bestPerState(hits: readonly NearHit[]): Record<string, string[]> {
  const best = new Map<string, Map<string, number>>()
  for (const hit of hits) {
    if (hit.score < NEAR_ENOUGH) continue
    const state = best.get(hit.state) ?? new Map<string, number>()
    state.set(hit.id, Math.max(state.get(hit.id) ?? Number.NEGATIVE_INFINITY, hit.score))
    best.set(hit.state, state)
  }
  const out: Record<string, string[]> = {}
  for (const code of Object.keys(STATE_NAMES)) {
    const scored = best.get(code)
    if (scored === undefined) continue
    out[code] = [...scored]
      .sort(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId))
      .slice(0, NATIONWIDE_PER_STATE)
      .map(([id]) => id)
  }
  return out
}

/**
 * The loop over the namespaces, given an embedder and a query. The worker
 * hands it the bindings and scripts/live.ts the REST API, so the eval runs the
 * loop the worker runs rather than a copy of it.
 */
export function nearLawsNationwideWith(
  embed: (texts: string[]) => Promise<number[][]>,
  query: (vector: number[], state: string) => Promise<{ id: string; score: number }[]>,
): NearLawsNationwide {
  return async (question, searches) => {
    const texts = [question, ...searches]
    // One embedding call for all of them: the model pads each text to the
    // longest, and three short texts cost what one does.
    const vectors = await embed(texts)
    if (vectors.length !== texts.length) throw new Error(`asked to embed ${texts.length} texts, given ${vectors.length} vectors`)
    const found = await Promise.all(
      Object.keys(STATE_NAMES).flatMap((state) =>
        vectors.map(async (vector) => (await query(vector, state)).map((match) => ({ state, id: match.id, score: match.score }))),
      ),
    )
    // A state's own page is not its rule: "how soon can I retake" across the
    // states is not a comparison the plan builds, and a retake page near a
    // question would take one of the state's two places from its law.
    return bestPerState(found.flat().filter((hit) => !isProcessId(hit.id)))
  }
}

/** The deployed loop: the AI binding embeds, the Vectorize binding answers each namespace. */
export function nearLawsNationwide(ai: Ai | undefined, index: VectorizeIndex | undefined): NearLawsNationwide | undefined {
  if (ai === undefined || index === undefined) return undefined
  return nearLawsNationwideWith(
    async (texts) => ((await ai.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] }).data,
    async (vector, state) => (await index.query(vector, { topK: NEAR_LAWS, namespace: state })).matches,
  )
}

interface LawRow {
  id: string
  state: string
  kind: string | null
  law: string
  question: string
  concept: string
  citation: string | null
  as_of: string | null
}

/**
 * A row as the law it was written from: `kind` only on a statute or a state's
 * own page, and `asOf` only where dated, as the published files carry them. A
 * page's row read back without its kind would be given to the model as the
 * manual's, and the manual is preferred for the rule of the road.
 */
function lawOf(row: LawRow): StateLaw {
  return {
    state: row.state,
    id: row.id,
    law: row.law,
    question: row.question,
    concept: row.concept,
    citation: row.citation,
    ...(row.kind === 'statute' || row.kind === 'process' ? { kind: row.kind } : {}),
    ...(typeof row.as_of === 'string' ? { asOf: row.as_of } : {}),
  }
}

/**
 * The deployed store. One SELECT per question, with the ids as one JSON array
 * rather than one bound parameter each: D1 refuses a query with more than 100
 * bound parameters, and fifty-one states of two is 102.
 */
export function lawsByIdFor(db: D1Database | undefined): LawsById | undefined {
  if (db === undefined) return undefined
  return async (ids) => {
    if (ids.length === 0) return []
    const rows = await db
      .prepare(
        `SELECT id, state, kind, law, question, concept, citation, as_of FROM laws
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(ids))
      .all<LawRow>()
    return (rows.results ?? []).map(lawOf)
  }
}

/**
 * The deployed section lookup: one SELECT for every section asked, the
 * sections as one JSON array for the reason `lawsByIdFor` gives, in the order
 * the push wrote the rows -- which is the order the code prints them, (a)
 * before (b). Uses the (state, section) index.
 */
export function lawsBySectionFor(db: D1Database | undefined): LawsBySection | undefined {
  if (db === undefined) return undefined
  return async (state, sections) => {
    if (sections.length === 0) return []
    const rows = await db
      .prepare(
        `SELECT id, state, kind, law, question, concept, citation, as_of FROM laws
          WHERE state = ? AND section IN (SELECT value FROM json_each(?))
          ORDER BY rowid`,
      )
      .bind(state, JSON.stringify(sections))
      .all<LawRow>()
    return (rows.results ?? []).map(lawOf)
  }
}

/**
 * The deployed family lookup (docs/plans/what-happens-if.md, phase 3,
 * decision 16): the rows `process:fetch` stored for one state's page on one
 * family, in the order the page gives them. By the id's own range, which is
 * the state and the family -- `VA-R-test-and-retake-1` up to the next
 * character after the dash -- so the primary key answers it rather than a
 * scan of the state's thousands of rows, and a Virginian's retake question is
 * never given Maryland's wait.
 */
export function processRowsForDb(db: D1Database | undefined): ProcessRowsFor | undefined {
  if (db === undefined) return undefined
  return async (state, family) => {
    const from = `${state}-R-${family}-`
    const rows = await db
      .prepare(
        `SELECT id, state, kind, law, question, concept, citation, as_of FROM laws
          WHERE id >= ? AND id < ? AND state = ? AND kind = 'process' AND concept = ?
          ORDER BY rowid`,
      )
      .bind(from, `${state}-R-${family}.`, state, family)
      .all<LawRow>()
    return (rows.results ?? []).map(lawOf)
  }
}

/**
 * The section a law belongs to, as its citation names it: the reference before
 * " — " with its subsection removed (docs/plans/what-happens-if.md, decision
 * 1). `Tex. Transp. Code § 521.025(c)(1)` and `§ 521.025(d)` are both
 * `Tex. Transp. Code § 521.025`, so a question that retrieves the duty can be
 * given the fine and the defence beside it. Every trailing parenthesised group
 * goes, not just the last, or (c)(1) would key apart from (d); and so does a
 * range ("§ 21-1004(g)(1)–(5)", Maryland's chunks that span paragraphs), a
 * dangling dash (Wisconsin's "§ 340.01(24)(a)–") and Minnesota's
 * ", subd. 1a", which is its word for a subsection. A compact's ", Art. II"
 * stays: each article is the size of a section. Null for a manual law, whose
 * citation is a page, and for a law with no citation.
 */
export function sectionOf(law: Pick<AskLaw, 'kind' | 'citation'>): string | null {
  if (law.kind !== 'statute' || law.citation === null) return null
  const quoted = law.citation.indexOf(' — ')
  const reference = quoted < 0 ? law.citation : law.citation.slice(0, quoted)
  const section = reference
    .replace(/,\s*subd\..*$/, '')
    .replace(/(?:\s*[–-]?\s*\([^()]*\))+[\s–-]*$/, '')
    .trim()
  return section === '' ? null : section
}

/**
 * The longest statement the push writes. D1 refuses a statement over 100,000
 * bytes; the longest single law (Massachusetts c.90 §7, a chunk of 22.7 KB)
 * fits several times over, and a batch that would pass this is cut before it.
 */
export const STORE_STATEMENT_BYTES = 90_000

function literal(text: string | null): string {
  if (text === null) return 'NULL'
  // SQLite has no backslash escapes: a doubled quote is the whole of quoting.
  // A NUL would end the string early in some drivers, and no law has one.
  if (text.includes('\u0000')) throw new Error('a law contains a NUL character')
  return `'${text.replace(/'/g, "''")}'`
}

/**
 * The statements that write a state's laws into the store, beside the query
 * that reads them, so the workerd suite can round-trip one through the other
 * (worker/tests/learner-ask.test.ts). Literal values rather than bound ones,
 * because a bound statement takes at most 100 parameters -- fourteen laws --
 * and 172,000 laws at fourteen a request is twelve thousand requests.
 */
export function storeStatements(state: string, laws: readonly AskLaw[], maxBytes = STORE_STATEMENT_BYTES): string[] {
  const head = 'INSERT OR REPLACE INTO laws (id, state, kind, law, question, concept, citation, as_of, section) VALUES '
  const out: string[] = []
  let rows: string[] = []
  let size = head.length
  for (const law of laws) {
    const row = `(${[law.id, state, law.kind ?? null, law.law, law.question, law.concept, law.citation, law.asOf ?? null, sectionOf(law)].map(literal).join(', ')})`
    const bytes = new TextEncoder().encode(row).length + 2
    if (rows.length > 0 && size + bytes > maxBytes) {
      out.push(head + rows.join(', '))
      rows = []
      size = head.length
    }
    if (head.length + bytes > maxBytes) throw new Error(`${law.id} alone is longer than a statement may be`)
    rows.push(row)
    size += bytes
  }
  if (rows.length > 0) out.push(head + rows.join(', '))
  return out
}


/** A state's schedule rows for these sections, exactly these and no other. Throws when the store cannot be read. */
export type PenaltiesFor = (state: string, sections: readonly string[]) => Promise<PenaltyRow[]>

export const PENALTY_COLUMNS =
  'id, state, section, code, offence, fine_text, fine_min_cents, fine_max_cents, points, appear, source_url, source_title, as_of, quote'

/**
 * The deployed schedule lookup: one SELECT for every section a question's
 * laws are in, by the whole key and never a prefix -- a fine joined to
 * § 16-1130 when § 16-113 was asked about is a figure stated under a citation
 * that does not say it. In the order the fetch wrote them, which is the
 * schedule's. Uses the primary key, which begins (state, section).
 */
export function penaltiesForDb(db: D1Database | undefined): PenaltiesFor | undefined {
  if (db === undefined) return undefined
  return async (state, sections) => {
    if (sections.length === 0) return []
    const rows = await db
      .prepare(
        `SELECT ${PENALTY_COLUMNS} FROM penalties
          WHERE state = ? AND section IN (SELECT value FROM json_each(?))
          ORDER BY rowid`,
      )
      .bind(state, JSON.stringify(sections))
      .all<PenaltyRow>()
    return rows.results ?? []
  }
}

// The row-to-law mapping lives in ./penalty-law.ts, a module with no
// Workers types: the build config and the prerender read stored state chips
// through it, and the root tsconfig, which checks them, does not load
// D1Database -- importing it from here failed `npm run build` at its first step.
export { dollars, penaltyLaw, penaltySentence, type PenaltyRow } from './penalty-law'

/**
 * The statements that write schedule rows, beside the query that reads them,
 * so the workerd suite seeds the table the way the push fills it.
 */
export function penaltyStatements(rows: readonly PenaltyRow[], maxBytes = STORE_STATEMENT_BYTES): string[] {
  const head = `INSERT OR REPLACE INTO penalties (${PENALTY_COLUMNS}) VALUES `
  const value = (each: string | number | null) => (typeof each === 'number' ? String(each) : literal(each))
  const out: string[] = []
  let batch: string[] = []
  let size = head.length
  for (const row of rows) {
    const sql = `(${[
      row.id, row.state, row.section, row.code, row.offence, row.fine_text, row.fine_min_cents, row.fine_max_cents,
      row.points, row.appear, row.source_url, row.source_title, row.as_of, row.quote,
    ].map(value).join(', ')})`
    const bytes = new TextEncoder().encode(sql).length + 2
    if (batch.length > 0 && size + bytes > maxBytes) {
      out.push(head + batch.join(', '))
      batch = []
      size = head.length
    }
    batch.push(sql)
    size += bytes
  }
  if (batch.length > 0) out.push(head + batch.join(', '))
  return out
}
