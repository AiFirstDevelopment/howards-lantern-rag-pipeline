/**
 * The laws a road-law question may be answered from, and how they are found
 * (docs/plans/learner-ask-law.md).
 *
 * The corpus is ~8 MB across the states, too much to bundle into the worker and
 * parse on every cold start, so Pages publishes one small file per state at
 * `/ask-laws/<CODE>.json` (the `corpus` plugin in vite.config.ts calls `askLaws`
 * below) and the worker fetches the one state it was asked about. Both halves
 * call the same compaction, so the law and the citation the box quotes are the
 * ones the cards render from the same build -- a box citing a page the cards no
 * longer cite is the drift this is shaped to make impossible.
 *
 * Retrieval is lexical and deterministic on purpose: the model sees the laws
 * this returns and nothing else from the corpus, and a test can say exactly
 * which laws a question reaches.
 */

/** One law as the box sees it: the card's rule and the manual citation the card shows. */
export interface AskLaw {
  id: string
  law: string
  question: string
  concept: string
  /** The first `manual:` location, verbatim -- the one `manualCitation` picks for the card. */
  citation: string | null
  /**
   * `statute` for a law from the state's code rather than its manual
   * (docs/plans/statute-corpus.md): the model is told so, and the box labels
   * it "Not in your manual". Absent on a manual law, so the files Pages
   * published before statutes existed read as they always did. `penalty`
   * for a row of the court's fine schedule joined to a statute's section by
   * the worker (docs/plans/what-happens-if.md, phase 2); never in a file.
   * `process` for a passage of the state's own page -- its licensing
   * agency's or court's -- on a question no section answers (phase 3:
   * retakes, permits, tickets), stored by `npm run process:fetch` and
   * published with the state's file like any law.
   */
  kind?: 'statute' | 'penalty' | 'process'
  /**
   * The date the law was true as of, ISO (docs/plans/trusted-by-date.md,
   * decision 6): the day its source was fetched -- a statute's section, a
   * manual law's manual (src/assets/drivers-manuals/SOURCES.json). Set by
   * scripts/statutes/laws.ts on every law Pages publishes, and written to the
   * laws table's `as_of` for the index path (phase 3). Optional because a row
   * pushed before that column existed has none, and a citation with no date
   * shows none rather than an invented one.
   */
  asOf?: string
}

interface CorpusLaw {
  id: string
  law: string
  question?: string
  concept?: string
  citations?: { source: string; location: string }[]
}

/** The retrieval file for one state, from its corpus. */
export function askLaws(corpus: { laws: CorpusLaw[] }): AskLaw[] {
  return corpus.laws.map((law) => ({
    id: law.id,
    law: law.law,
    question: law.question ?? '',
    concept: law.concept ?? '',
    citation: law.citations?.find((citation) => /^manual:/.test(citation.source))?.location ?? null,
  }))
}

/** One law from resource/statutes/<CODE>.json, whose quote tests/unit/statutes.test.ts has found in its source. */
interface StatuteLaw {
  id: string
  topic: string
  law: string
  question: string
  citation: string
  /** A code chunk's section catchline (code-chunks.ts); a hand-written law files under its topic. */
  concept?: string
}

/** The statute laws in the shape the box retrieves, marked as statutes. */
export function askStatutes(statutes: StatuteLaw[]): AskLaw[] {
  return statutes.map((law) => ({
    id: law.id,
    law: law.law,
    question: law.question,
    concept: law.concept ?? law.topic,
    citation: law.citation,
    kind: 'statute' as const,
  }))
}

/**
 * A state's whole retrieval file: the manual's laws, then the code's where it
 * has been sourced -- Maryland's hand-written laws and every state's chunked
 * sections alike (scripts/statutes/laws.ts reads both). One function, so what Pages publishes and what the e2e
 * stub retrieves from are the same list.
 */
export function retrievalFile(corpus: { laws: CorpusLaw[] }, statutes: StatuteLaw[] | null): AskLaw[] {
  return [...askLaws(corpus), ...(statutes === null ? [] : askStatutes(statutes))]
}

/** How many laws a question is answered from. Enough that a paraphrased question still reaches its law; few enough that the model is not reading a chapter. */
export const RETRIEVED_LAWS = 8

/** Where Pages serves the retrieval files; the worker reads them from here. */
export const LAWS_ORIGIN = 'https://howardslantern.com'

export function lawsPath(code: string): string {
  return `/ask-laws/${code}.json`
}

// Words that say nothing about which law is meant. "park" and "far" stay: in a
// question about road law they are the whole question.
const STOP = new Set(
  'a an and are as at be by can could do does for from how i if in is it its me my of on or should so that the their them there this to was what when where which who why will with would you your'.split(
    ' ',
  ),
)

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !STOP.has(word))
    // "hydrants" must find "hydrant"; "bus" must not become "bu".
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

/**
 * The laws most likely to answer `question`, best first.
 *
 * Two rankings, merged: BM25 over each law's words (below), and `near` -- the
 * ids the vector index found closest in meaning (law-vectors.ts), best first.
 * Merged by reciprocal rank, so a law near the top of either list makes the
 * shortlist and a law high on both leads it; neither ranking's raw scores are
 * compared with the other's, because they are not on the same scale. With no
 * `near` -- the index unbound or unreachable -- this is BM25 alone, exactly.
 *
 * A law that shares no word with the question and is not near it in meaning
 * is never returned, so a question nothing covers retrieves nothing rather
 * than eight laws the model must then decline.
 */
/** The question again in the law's words (law-rephrase.ts), and what the vector index found for it. */
export interface Search {
  search: string
  near: string[]
}

export function retrieve(laws: AskLaw[], question: string, limit = RETRIEVED_LAWS, near: string[] = [], searches: Search[] = []): AskLaw[] {
  const byId = new Map(laws.map((law) => [law.id, law]))
  // Only ids the published file holds: a vector left behind for a law since
  // removed is dropped here, never shown.
  const meant = near.filter((id) => byId.has(id))
  if (meant.length === 0 && searches.length === 0) return bm25(laws, question, limit)
  const fused = new Map<string, number>()
  const add = (ids: string[]) =>
    ids.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
  add(bm25(laws, question, limit * 2).map((law) => law.id))
  add(meant)
  // Each search is two rankings of its own, by its words and by its meaning:
  // "maximum speed limit" finds what "highest posted speed limit" does not,
  // and Texas's 70 mph law went from 124th by the question's words to the pool.
  for (const { search, near: nearer } of searches) {
    add(bm25(laws, search, limit * 2).map((law) => law.id))
    add(nearer.filter((id) => byId.has(id)))
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id) as AskLaw)
}

/** The usual constant for reciprocal-rank fusion: it keeps one list's first place from swamping the other's. */
const RRF_K = 60

/**
 * What BM25 needs of a laws array that does not depend on the question: each
 * law's word counts and length, the average length, and how many laws each
 * word is in. Kept per array, because the box retrieves over the same array
 * several times a question -- the pool, the fallback, and each of the
 * rephraser's searches -- and the unit suite retrieves over a state's laws
 * thirty-five times for its topic questions. Rebuilt on every call, Texas's
 * 6,000 laws were tokenised up to six times a question, and
 * tests/unit/statute-coverage.test.ts ran 69 seconds in one Vitest worker,
 * past the runner's 60-second RPC timeout, which failed every gate with every
 * test passed (2026-10-10). Keyed by the array itself, and dropped if the
 * array has grown or shrunk, so another state's array, or a fresh fetch of the
 * same state, never reads this one's counts.
 */
interface Index {
  length: number
  /** How many laws are ranked by words: every one but the state's own pages. */
  size: number
  docs: { length: number; counts: Map<string, number> }[]
  average: number
  frequency: Map<string, number>
}

const INDEXES = new WeakMap<AskLaw[], Index>()

/**
 * A row of the state's own page (docs/plans/what-happens-if.md, phase 3) is
 * not ranked by words. Every page row carries its family's question -- "How
 * long do I have to hold my permit before I can take the road test?" -- and
 * five of them a family, so by words they filled the pool for the topic
 * questions they share words with: Pennsylvania's and West Virginia's
 * permit-holding verdicts, South Carolina's curfew and Vermont's passenger
 * limit all fell out of the 24 the reranker reads. A page row reaches the
 * pool by its family's key, which the rephraser names, and by meaning
 * through the index; and a file with no page rows ranks exactly as before,
 * its counts and its average length untouched.
 */
function ranked(law: AskLaw): boolean {
  return law.kind !== 'process'
}

function indexOf(laws: AskLaw[]): Index {
  const kept = INDEXES.get(laws)
  if (kept !== undefined && kept.length === laws.length) return kept
  const frequency = new Map<string, number>()
  const docs = laws.map((law) => {
    const tokens = ranked(law) ? words(`${law.law} ${law.question} ${law.concept.replace(/-/g, ' ')}`) : []
    const counts = new Map<string, number>()
    for (const word of tokens) counts.set(word, (counts.get(word) ?? 0) + 1)
    for (const word of counts.keys()) frequency.set(word, (frequency.get(word) ?? 0) + 1)
    return { length: tokens.length, counts }
  })
  const counted = docs.filter((_, index) => ranked(laws[index]))
  const built = { length: laws.length, docs, average: counted.reduce((sum, doc) => sum + doc.length, 0) / counted.length, frequency, size: counted.length }
  INDEXES.set(laws, built)
  return built
}

function bm25(laws: AskLaw[], question: string, limit: number): AskLaw[] {
  if (laws.length === 0) return []
  const { docs, average, frequency, size } = indexOf(laws)
  const asked = [...new Set(words(question).flatMap((word) => spelledAs(word, frequency)))]
  if (asked.length === 0) return []
  const k1 = 1.2
  const b = 0.75
  return docs
    .map((doc, index) => {
      let score = 0
      for (const word of asked) {
        const n = frequency.get(word)
        if (n === undefined) continue
        const tf = doc.counts.get(word) ?? 0
        if (tf === 0) continue
        const idf = Math.log(1 + (size - n + 0.5) / (n + 0.5))
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / average))
      }
      return { law: laws[index], score }
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.law)
}

/** The pages a citation names: "p.66 (printed) — '…'" → ["66"]; "pp.12-13" → ["12", "13"]. */
export function citedPages(location: string | null): string[] {
  const reference = /^\s*pp?\.\s*([\d–,\s-]+)/i.exec(location ?? '')
  return reference === null ? [] : reference[1].match(/\d+/g) ?? []
}

/** The pages an answer names in prose: "p.66", "p. 66", "page 66", "pages 12 and 13", "pág. 66". */
export function pagesNamedIn(answer: string): string[] {
  const found: string[] = []
  for (const match of answer.matchAll(/\b(?:pp?|pages?|p[áa]g(?:ina)?s?)\.?\s*(\d+(?:\s*(?:[-–,]|and|y)\s*\d+)*)/gi)) {
    found.push(...(match[1].match(/\d+/g) ?? []))
  }
  return found
}

/**
 * The manual's words a learner's word stands for. A word the laws use is
 * itself. One they do not is matched to the laws' words it contains
 * ("firehydrant" → fire, hydrant) or is one letter away from ("behing" →
 * behind), because a learner types on a phone and the first live miss of this
 * box, on 2026-10-05, was exactly that: Alabama's hydrant law, unreached by
 * "how far must i be behing a firehydrant".
 */
function spelledAs(word: string, vocabulary: Map<string, number>): string[] {
  if (vocabulary.has(word)) return [word]
  if (word.length < 4) return []
  const found: string[] = []
  for (const known of vocabulary.keys()) {
    if (known.length >= 4 && word.includes(known)) found.push(known)
    else if (word.length >= 5 && Math.abs(known.length - word.length) <= 1 && oneEditApart(word, known)) found.push(known)
  }
  return found
}

/** True when one insertion, deletion or substitution turns `a` into `b`. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}
