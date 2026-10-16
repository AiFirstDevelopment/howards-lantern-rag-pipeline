/**
 * Which stage of the learner's box lost a case, and the run's numbers from
 * it (docs/plans/eval-lifecycle-build.md, phase 2) -- pure, so the attribution
 * is tested over fixture traces and never by a paid run.
 *
 * Until this existed the harness said "172 of 202 right" and nothing about
 * why: a miss sent somebody to the prompt whether the model had been given the
 * law or retrieval had never found it, and the second is the commoner.
 */
import { questionKey } from '../worker/src/eval-candidates'
import { judgeCell, judgeLawText } from '../worker/src/eval-judge'

/** The stages in the order a law travels through them; `unattributed` is a case with no `gold`. */
export type Stage = 'retrieval' | 'rerank' | 'widening' | 'generation' | 'checker' | 'unattributed'

/** `outcome.trace` for a state question (worker/src/learner-ask.ts, `AskTrace`). */
export interface StateTrace {
  pool: string[]
  chosen: string[]
  given: string[]
  searches: string[]
}

export type Mode = 'full' | 'retrieval'

/** One case as run: what the stages did, and what was asked of it. */
export interface Scored {
  state?: string
  /** The law ids that answer the case; any one of them is enough. */
  gold?: string[]
  /** Absent when the turn ran no state retrieval: no state, nationwide, or the state's laws unreadable. */
  trace?: StateTrace
  /** The fact the answer must carry -- the first `contains` entry, any one of its spellings. */
  fact?: string[]
  /** The text of every law the model was given. */
  givenTexts?: string[]
  /** What the model wrote before any check, or undefined when no model was asked. */
  raw?: string
  /** What the learner was shown; empty when the checks refused it. */
  shown?: string
  /** Every check the harness makes passed. */
  right: boolean
  /** The case asks for nothing to be shown. */
  wantsRefusal?: boolean
  /** The case accepts an honest refusal. */
  mayRefuse?: boolean
}

const holds = (text: string, fact: string[]) => fact.some((each) => text.toLowerCase().includes(each.toLowerCase()))

/**
 * The gold law's best rank in the pool, from 1, or null when no gold id is in
 * it. A case with several gold ids (a manual line and the statute it
 * restates, say) is found if any of them is, and ranked by the highest: the
 * model needs one of them, not all.
 */
export function rankOf(gold: string[], pool: string[]): number | null {
  const ranks = gold.map((id) => pool.indexOf(id)).filter((at) => at >= 0)
  return ranks.length === 0 ? null : Math.min(...ranks) + 1
}

/**
 * The stage that lost the case, or null when none did. Tested in the order a
 * law travels, so a law retrieval never found is never put down to the
 * reranker or the model. In `retrieval` mode no model was asked, so only
 * retrieval and the reranker can be decided; past them the case is null.
 */
export function stageOf(kase: Scored, mode: Mode): Stage | null {
  if (mode === 'full' && kase.right) return null
  if (kase.gold === undefined || kase.gold.length === 0 || kase.trace === undefined) return 'unattributed'
  if (rankOf(kase.gold, kase.trace.pool) === null) return 'retrieval'
  if (!kase.gold.some((id) => kase.trace!.chosen.includes(id))) return 'rerank'
  if (mode === 'retrieval') return null
  if (kase.fact !== undefined && !(kase.givenTexts ?? []).some((text) => holds(text, kase.fact!))) return 'widening'
  const rawRight = kase.raw !== undefined && kase.raw !== '' && (kase.fact === undefined || holds(kase.raw, kase.fact))
  if (!rawRight) return 'generation'
  if ((kase.shown ?? '') === '') return 'checker'
  // Shown, with the fact, and still wrong: the lead word, the register or a
  // citation the model chose -- all the model's writing, not a check's refusal.
  return 'generation'
}

export interface Summary {
  /** Cases with gold and a state trace: the denominator of every rate below. */
  scored: number
  unattributed: number
  recallAtPool: number | null
  mrr: number | null
  /** Of cases with gold in the pool, the share whose gold was chosen; null when the reranker did not run. */
  rerankSurvival: number | null
  /** Of cases with gold chosen and a fact, the share where the fact was in a law the model was given. Full runs only. */
  wideningCoverage: number | null
  /** Of cases whose fact reached the model, the share whose raw reply carried it. Full runs only. */
  generationAccuracy: number | null
  /** Of refusals, the share the case allowed. Full runs only. */
  refusalPrecision: number | null
  /** Of cases that must be refused, the share that were. Full runs only. */
  refusalRecall: number | null
  stages: Partial<Record<Stage, number>>
}

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole)

export function summarize(cases: Scored[], mode: Mode, reranked: boolean): Summary {
  const scored = cases.filter((kase) => kase.gold !== undefined && kase.gold.length > 0 && kase.trace !== undefined)
  const ranks = scored.map((kase) => rankOf(kase.gold!, kase.trace!.pool))
  const inPool = scored.filter((_, at) => ranks[at] !== null)
  const chosen = inPool.filter((kase) => kase.gold!.some((id) => kase.trace!.chosen.includes(id)))
  const full = mode === 'full'
  const withFact = chosen.filter((kase) => kase.fact !== undefined)
  const factGiven = withFact.filter((kase) => (kase.givenTexts ?? []).some((text) => holds(text, kase.fact!)))
  const rawRight = factGiven.filter((kase) => kase.raw !== undefined && holds(kase.raw, kase.fact!))
  const refused = cases.filter((kase) => (kase.shown ?? '') === '' && kase.raw !== undefined)
  const mustRefuse = cases.filter((kase) => kase.wantsRefusal === true)
  const stages: Partial<Record<Stage, number>> = {}
  for (const kase of cases) {
    const stage = stageOf(kase, mode)
    if (stage !== null) stages[stage] = (stages[stage] ?? 0) + 1
  }
  return {
    scored: scored.length,
    unattributed: cases.length - scored.length,
    recallAtPool: share(inPool.length, scored.length),
    mrr: scored.length === 0 ? null : ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / rank), 0) / scored.length,
    rerankSurvival: reranked ? share(chosen.length, inPool.length) : null,
    wideningCoverage: full ? share(factGiven.length, withFact.length) : null,
    generationAccuracy: full ? share(rawRight.length, factGiven.length) : null,
    refusalPrecision: full ? share(refused.filter((kase) => kase.wantsRefusal === true || kase.mayRefuse === true).length, refused.length) : null,
    refusalRecall: full ? share(mustRefuse.filter((kase) => (kase.shown ?? '') === '').length, mustRefuse.length) : null,
    stages,
  }
}

/** The summary as the harness prints it after the table. */
export function summaryLines(summary: Summary, title: string): string[] {
  const rate = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
  const lines = [
    `\n${title}`,
    `  cases scored (with gold): ${summary.scored}; no gold (unattributed): ${summary.unattributed}`,
    `  recall@pool: ${rate(summary.recallAtPool)}`,
    `  MRR: ${summary.mrr === null ? '—' : summary.mrr.toFixed(3)}`,
  ]
  if (summary.rerankSurvival !== null) lines.push(`  rerank survival: ${rate(summary.rerankSurvival)}`)
  if (summary.wideningCoverage !== null || summary.generationAccuracy !== null) {
    lines.push(`  widening coverage: ${rate(summary.wideningCoverage)}`, `  generation accuracy: ${rate(summary.generationAccuracy)}`)
    lines.push(`  refusal precision: ${rate(summary.refusalPrecision)}; recall: ${rate(summary.refusalRecall)}`)
  }
  const stages = Object.entries(summary.stages)
  lines.push(`  by stage: ${stages.length === 0 ? 'none' : stages.map(([stage, count]) => `${stage} ${count}`).join(', ')}`)
  return lines
}

// ---------------------------------------------------------------------------
// The fixture: what a case is, how the file is written back, and what makes a
// set fit to run (phase 2, decisions 10, 11, 16 and 18).
// ---------------------------------------------------------------------------

/** Where a case came from (eval-lifecycle.md, section B); `commit` is the one that added it. */
export interface CaseFrom {
  kind: 'seed' | 'ingest' | 'failure' | 'labelled'
  commit?: string
  on?: string
  row?: number
}

/** One case of scripts/learner-ask-eval.json, as the harness and eval:gold read it. */
export interface FixtureCase {
  lang: 'en' | 'es'
  /** The chosen state; absent means none chosen. */
  state?: string
  question: string
  history?: { question: string; scope: 'app' | 'road-law' | 'price' | 'promise' | 'other'; answer: string; sources: string[] }[]
  /** The ids of the laws that answer it, any one enough: what stageOf follows through the stages. */
  gold?: string[]
  expect: {
    scope: 'app' | 'road-law' | 'price' | 'promise' | 'other'
    /** The first word, lower-cased: "yes", "no" or "sí". */
    lead?: string
    /**
     * What the shown answer must say. An entry that is a list is met by any
     * one of it: "District of Columbia" and "D.C." name the same place, and a
     * case that took one of them as the only right answer failed a right one.
     */
    contains?: (string | string[])[]
    notContains?: string[]
    /** Road law: the manual pages the shown citations must include. */
    cites?: string[]
    /** Road law: text a shown statute citation must contain, e.g. "§ 21-1003(m)". */
    citesLaw?: string
    /** Road law: the start of an id a shown citation must have, e.g. "MD-R-test-and-retake-" for the state's own page. */
    citesId?: string
    /** Road law: nothing the model wrote may be shown. */
    unanswered?: boolean
    /** Nationwide: which way it must be answered (docs/plans/nationwide.md, decision 6), shown or refused. */
    path?: 'topic' | 'index'
    /** Nationwide: at least this many citations, from as many different states. */
    states?: number
    /** Road law: an honest refusal counts as right, so long as nothing ungrounded is shown. */
    mayRefuse?: boolean
  }
  from?: CaseFrom
  /** Never looked at while tuning: run only by a whole run, reported in its own block, never in the tuning deltas. */
  holdout?: boolean
  /** Why the case no longer runs. The row stays, so no other case's number moves. */
  retired?: string
}

export interface Fixture {
  cases: FixtureCase[]
}

const inline = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, each]) => each !== undefined)
    return entries.length === 0 ? '{}' : `{ ${entries.map(([key, each]) => `${JSON.stringify(key)}: ${inline(each)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

/**
 * The fixture as it is committed: one case a line, and a case with a thread
 * history spelled out a key a line. eval:gold writes the file back through
 * this, so a backfill of two hundred cases is a diff of the lines it touched --
 * `JSON.stringify(_, null, 2)` would have turned 240 lines into 2,000 and made
 * the one gold somebody needs to review unfindable.
 */
export function renderFixture(fixture: Fixture): string {
  const cases = fixture.cases.map((kase) => {
    if (kase.history === undefined) return `    ${inline(kase)}`
    const lines = Object.entries(kase)
      .filter(([, each]) => each !== undefined)
      .map(([key, each]) => {
        if (key !== 'history') return `      ${JSON.stringify(key)}: ${inline(each)}`
        const turns = (each as Record<string, unknown>[]).map(
          (turn) => `        {\n${Object.entries(turn).map(([field, text]) => `          ${JSON.stringify(field)}: ${inline(text)}`).join(',\n')}\n        }`,
        )
        return `      "history": [\n${turns.join(',\n')}\n      ]`
      })
    return `    {\n${lines.join(',\n')}\n    }`
  })
  return `{\n  "cases": [\n${cases.join(',\n')}\n  ]\n}\n`
}

/** The most gold ids a case may carry: more is a section, not an answer, and every retrieval hit near it would score as a find. */
export const MAX_GOLD = 4

/** A law as eval:gold and --explain read it: enough to match a citation check and to show a person the law. */
export interface GoldLaw {
  id: string
  citation: string | null
  kind?: string
  law: string
}

/** A section of the learner book (worker/src/learner-knowledge-base.json). */
export interface BookSection {
  id: string
  text: string
}

export type GoldResolution = { gold: string[]; candidates: string[] } | { gold: null; candidates: string[]; why: string }

/** A citation's reference, the part before the quoted text: `Md. Code, Transp. § 21-1003(m)`. */
export function referenceOf(citation: string | null): string {
  return (citation ?? '').split(' — ')[0]
}

/** The pages a manual citation names (`p.17 (printed)`); worker/src/law-retrieval.ts's `citedPages`, which the harness scores `cites` with. */
const pagesOf = (citation: string | null) => {
  const reference = /^\s*pp?\.\s*([\d–,\s-]+)/i.exec(citation ?? '')
  return reference === null ? [] : reference[1].match(/\d+/g) ?? []
}

const holdsAll = (text: string, contains: (string | string[])[]) =>
  contains.every((needle) => (Array.isArray(needle) ? needle : [needle]).some((each) => text.toLowerCase().includes(each.toLowerCase())))

/**
 * The gold a case's own citation checks name, read off the published laws
 * (decision 10). The checks already say which law a right answer cites --
 * `citesLaw` a reference, `citesId` an id prefix, `cites` a manual page -- so
 * most cases need nobody to label them. One to four laws is a gold; none, or
 * more than four, is a case a person must look at, and comes back with its
 * candidates rather than a guess. A book (`app`) case's gold is the one book
 * section holding every `contains` fact; two sections holding it is a guess.
 */
export function resolveGold(kase: FixtureCase, laws: GoldLaw[] | undefined, book: BookSection[]): GoldResolution {
  const { expect } = kase
  if (expect.scope === 'app') {
    if (expect.contains === undefined || expect.contains.length === 0) return { gold: null, candidates: [], why: 'a book case with no fact to find its section by' }
    const holding = book.filter((section) => holdsAll(section.text, expect.contains!)).map((section) => section.id)
    return holding.length === 1 ? { gold: holding, candidates: holding } : { gold: null, candidates: holding, why: `${holding.length} book sections hold the fact` }
  }
  if (expect.scope !== 'road-law') return { gold: null, candidates: [], why: `a ${expect.scope} case answers from no law` }
  if (kase.state === 'US') return { gold: null, candidates: [], why: 'nationwide: the topic is chosen by a model at run time, so the case names no law by itself' }
  if (kase.state === undefined || laws === undefined) return { gold: null, candidates: [], why: 'no state laws to resolve against' }
  if (expect.citesLaw === undefined && expect.citesId === undefined && expect.cites === undefined) return { gold: null, candidates: [], why: 'no citation check to resolve' }
  const candidates = laws
    .filter(
      (law) =>
        (expect.citesLaw !== undefined && referenceOf(law.citation).includes(expect.citesLaw)) ||
        (expect.citesId !== undefined && law.id.startsWith(expect.citesId)) ||
        (expect.cites !== undefined && law.kind === undefined && pagesOf(law.citation).some((page) => expect.cites!.includes(page))),
    )
    .map((law) => law.id)
  if (candidates.length === 0) {
    // A fine-schedule row (`XX-P-…`, or a schedule named in `citesLaw`) is
    // joined to its section by the worker at run time and is in no published
    // file, so no rule over the files can find it.
    const penalty = (expect.citesId ?? '').includes('-P-') || /schedule/i.test(expect.citesLaw ?? '')
    return { gold: null, candidates, why: penalty ? 'a fine-schedule row, joined by the worker at run time and in no published file' : 'no published law matches the citation check' }
  }
  if (candidates.length > MAX_GOLD) return { gold: null, candidates, why: `${candidates.length} published laws match the citation check` }
  return { gold: candidates, candidates }
}

/**
 * Where a case came from, by the commit that added it (decision 11): the
 * fixture's first commit is the seed list; a commit that also added the
 * state's code under resource/statutes/sources/XX/ wrote the case at
 * ingestion; anything later was written for a failure.
 */
export function fromKind(added: { root: boolean; addsSourcesOfState: boolean }): CaseFrom['kind'] {
  if (added.root) return 'seed'
  if (added.addsSourcesOfState) return 'ingest'
  return 'failure'
}

/** The seed that picks the holdout cases. Changing it reshuffles a set somebody has promised not to tune against. */
export const HOLDOUT_SEED = 'eval-lifecycle-2026-10-15'

/**
 * The road-law cases held out (decision 11), as indexes into `cases`: every
 * tenth, counting in the order a hash of the seed, the state and the question
 * puts them -- exactly one in ten, and the same ten every time it is asked of
 * the same set. A hash drawn per case would hold out "about" a tenth: on the
 * 166 road-law cases of 2026-10-15 it held out 28. eval:gold applies it once,
 * to cases it is stamping for the first time, so a case added later never
 * moves an old one into the holdout after it has been tuned against.
 */
export function holdoutsOf(cases: FixtureCase[], sha256: (text: string) => string): Set<number> {
  const road = cases.flatMap((kase, at) => (kase.expect.scope === 'road-law' && kase.retired === undefined ? [{ at, hash: sha256(`${HOLDOUT_SEED}|${caseKey(kase)}`) }] : []))
  road.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
  return new Set(road.filter((_, rank) => rank % 10 === 0).map((each) => each.at))
}

/** A case's identity across runs: its state and its question as the queue compares it (decision 6a). Case numbers move; this does not. */
export function caseKey(kase: { state?: string | null; question: string }): string {
  return `${kase.state ?? ''}|${questionKey(kase.question)}`
}

/**
 * What stops a run before it starts (decision 18), each naming the case: the
 * same question twice under one state, which scores one question twice; and a
 * gold id the state's published laws (or, for a book case, the book) do not
 * hold -- a re-chunk that renamed it would otherwise score the case a
 * retrieval miss on every run from then on, quietly.
 */
export function validateCases(
  cases: { n: number; kase: FixtureCase }[],
  lawIdsOf: (state: string) => Set<string> | undefined,
  bookIds: Set<string>,
): string[] {
  const problems: string[] = []
  const seen = new Map<string, number>()
  for (const { n, kase } of cases) {
    if (kase.retired !== undefined) continue
    const first = seen.get(caseKey(kase))
    if (first !== undefined) problems.push(`case ${n}: the same question as case ${first}, under ${kase.state ?? 'no state'}`)
    else seen.set(caseKey(kase), n)
  }
  for (const { n, kase } of cases) {
    if (kase.retired !== undefined || kase.gold === undefined) continue
    for (const id of kase.gold) {
      if (kase.expect.scope === 'app') {
        if (!bookIds.has(id)) problems.push(`case ${n}: gold ${id} is not a section of the learner book`)
        continue
      }
      const state = kase.state === undefined || kase.state === 'US' ? id.split('-')[0] : kase.state
      if (!(lawIdsOf(state)?.has(id) ?? false)) problems.push(`case ${n}: gold ${id} is not in ${state}'s published laws`)
    }
  }
  return problems
}

/**
 * Whether the laws the harness's wrap saw handed to the model are the
 * worker's own `trace.given` (decision 12). They must be, or the stage column
 * attributes a pipeline production does not run. Null when they agree, or
 * when the turn handed the model no laws.
 */
export function givenDrift(handed: string[] | undefined, trace: StateTrace | undefined): string | null {
  if (handed === undefined || trace === undefined) return null
  return handed.join() === trace.given.join() ? null : `the laws handed to the model (${handed.join(', ')}) are not the trace's given (${trace.given.join(', ')})`
}

/** One case of a run, as eval-run.json and the baseline hold it. */
export interface RunRow {
  n: number
  state?: string | null
  question: string
  stage: string
  ok: boolean
  holdout?: boolean
}

export interface Change {
  n: number
  question: string
  was: string
  now: string
}

export interface Deltas {
  newlyRight: Change[]
  newlyWrong: Change[]
  stageChanged: Change[]
}

/**
 * The run against the baseline, case by case (decision 16), matched by state
 * and question so a case added in the middle moves no other case's delta.
 * Holdout cases come back apart and never in `tuning`: counted with the rest,
 * they are the cases a tuning pass was meant to be confirmed against, and the
 * first prompt change that fixes one by luck has been tuned against it.
 */
export function deltas(baseline: RunRow[], run: RunRow[]): { tuning: Deltas; holdout: Deltas; compared: number } {
  const before = new Map(baseline.map((row) => [caseKey(row), row]))
  const empty = (): Deltas => ({ newlyRight: [], newlyWrong: [], stageChanged: [] })
  const out = { tuning: empty(), holdout: empty(), compared: 0 }
  const verdict = (row: RunRow) => (row.ok ? 'right' : `wrong (${row.stage})`)
  for (const row of run) {
    const was = before.get(caseKey(row))
    const into = row.holdout === true ? out.holdout : out.tuning
    // A case the baseline never ran -- added since, or its question reworded
    // -- that fails on arrival is a regression already in production
    // (eval-lifecycle.md, stage 4), not a case to leave out of every delta.
    if (was === undefined) {
      if (!row.ok) into.newlyWrong.push({ n: row.n, question: row.question, was: 'not in the baseline', now: verdict(row) })
      continue
    }
    out.compared++
    if (!was.ok && row.ok) into.newlyRight.push({ n: row.n, question: row.question, was: verdict(was), now: verdict(row) })
    else if (was.ok && !row.ok) into.newlyWrong.push({ n: row.n, question: row.question, was: verdict(was), now: verdict(row) })
    else if (!was.ok && !row.ok && was.stage !== row.stage) into.stageChanged.push({ n: row.n, question: row.question, was: was.stage, now: row.stage })
  }
  return out
}

/** How far recall or generation may fall against the baseline before the gate fails, as a share: two points. */
export const GATE_DROP = 0.02

/** The gate's verdict: the exit code, and each rule that failed it, in words a PR comment can carry. */
export interface Gate {
  exit: 0 | 1
  reasons: string[]
}

/**
 * The one case to re-run once, live, before it counts (decision 34), or null:
 * the run's lone newly-wrong holdout case, whatever the tuning cases did. A
 * holdout case is the only one a single flake can fail the gate on, so it is
 * the only one the allowance is spent on; counted across the whole run, an
 * unrelated tuning miss took the re-run away and one flaky holdout answer
 * failed the job. A lone tuning case passes the gate unre-run, and two
 * holdout cases at once are a regression often enough that re-running both
 * would mostly buy the same verdict twice.
 */
export function rerunOf(found: { tuning: Deltas; holdout: Deltas }): number | null {
  const wrong = found.holdout.newlyWrong
  return wrong.length === 1 ? wrong[0].n : null
}

/**
 * The exit code a run earns against its baseline (decision 34), with why.
 * It fails on a holdout case newly wrong -- one is enough, since holdout is the
 * set nobody tuned against and the only honest witness that a change
 * generalises; on two or more tuning cases newly wrong in the same stage, a
 * loss with a shape; and on recall@pool or generation accuracy more than two
 * points below the baseline's, a slide spread too thin over the stages for
 * the count to see. A lone tuning case newly wrong is reported and passes:
 * under the phase-2 rule every such case failed the run, and a model that
 * words one answer differently on one night of two hundred would have made
 * the check something people learn to re-run rather than read.
 *
 * `stageOfCase` is the stage a newly-wrong case was lost at in this run, by
 * its number. `before` is the baseline's summary, or null when it has none;
 * a rate either side lacks (a retrieval run has no generation) is not
 * compared.
 */
export function gateOf(
  found: { tuning: Deltas; holdout: Deltas },
  stageOfCase: (n: number) => string,
  before: Pick<Summary, 'recallAtPool' | 'generationAccuracy'> | null,
  now: Pick<Summary, 'recallAtPool' | 'generationAccuracy'>,
): Gate {
  const reasons: string[] = []
  for (const change of found.holdout.newlyWrong) reasons.push(`holdout case #${change.n} newly wrong: ${change.now}`)
  const byStage = new Map<string, number[]>()
  for (const change of found.tuning.newlyWrong) {
    const stage = stageOfCase(change.n)
    byStage.set(stage, [...(byStage.get(stage) ?? []), change.n])
  }
  for (const [stage, cases] of byStage) {
    if (cases.length >= 2) reasons.push(`${cases.length} cases newly wrong at ${stage}: #${cases.join(', #')}`)
  }
  const points = (value: number) => (value * 100).toFixed(1)
  const fell = (name: string, was: number | null | undefined, is: number | null) => {
    // Compared in tenths of a point, as printed, so a fall of exactly two
    // points is not failed by the float underneath it.
    if (was === null || was === undefined || is === null) return
    if (Math.round((was - is) * 1000) > Math.round(GATE_DROP * 1000)) reasons.push(`${name} ${points(is)}%, down from ${points(was)}%: more than ${GATE_DROP * 100} points`)
  }
  if (before !== null) {
    fell('recall@pool', before.recallAtPool, now.recallAtPool)
    fell('generation accuracy', before.generationAccuracy, now.generationAccuracy)
  }
  return { exit: reasons.length > 0 ? 1 : 0, reasons }
}

/** The deltas as the harness prints them. */
export function deltaLines(found: Deltas, title: string): string[] {
  const block = (name: string, changes: Change[]) =>
    changes.length === 0 ? [`  ${name}: none`] : [`  ${name}: ${changes.length}`, ...changes.map((each) => `    #${each.n} ${each.question} -- ${each.was} → ${each.now}`)]
  return [`\n${title}`, ...block('newly right', found.newlyRight), ...block('newly wrong', found.newlyWrong), ...block('stage changed', found.stageChanged)]
}

const excerpt = (text: string, length = 100) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= length ? flat : `${flat.slice(0, length)}…`
}

/**
 * A missed case's pool, ranked (decision 15): each law's rank, id, reference
 * and the start of its text, the chosen ones starred and the gold marked, so
 * the right law is read off the terminal rather than looked up by id in a
 * corpus file. A gold law that never reached the pool is printed under it,
 * because "retrieval" alone does not say what should have been found.
 */
export function explainLines(
  n: number,
  question: string,
  stage: string,
  trace: StateTrace,
  gold: string[] | undefined,
  lawOf: (id: string) => GoldLaw | undefined,
): string[] {
  const golden = new Set(gold ?? [])
  const lineOf = (id: string) => {
    const law = lawOf(id)
    return law === undefined ? `${id}  (not in the published laws)` : `${id}  ${referenceOf(law.citation) || '(no citation)'} — '${excerpt(law.law)}'`
  }
  const lines = [`\ncase ${n}: ${question} -- ${stage}${gold === undefined ? '; no gold yet' : ''}`]
  trace.pool.forEach((id, at) => {
    lines.push(`  ${trace.chosen.includes(id) ? '*' : ' '} #${String(at + 1).padEnd(3)}${golden.has(id) ? 'GOLD ' : '     '}${lineOf(id)}`)
  })
  for (const id of [...golden].filter((each) => !trace.pool.includes(each))) lines.push(`    gold not in the pool: ${lineOf(id)}`)
  return lines
}

/**
 * Why a run cannot become the baseline (`npm run eval:accept`), or null when
 * it can. A `--state` or `--cases` run is refused because the baseline is
 * matched case by case: accepted, every case it did not run would drop out of
 * every later run's deltas, and a regression there would go unreported.
 */
export function acceptRefusal(run: { mode?: string; partial?: boolean; rows?: unknown[] } | null): string | null {
  if (run === null) return 'no eval-run.json: run the eval with --json first'
  if (!Array.isArray(run.rows) || run.rows.length === 0) return 'eval-run.json holds no rows'
  if (run.partial !== false) return 'eval-run.json is a --state or --cases run: only a whole run can be the baseline'
  // A retrieval run over a full baseline would leave every later full run
  // with "no deltas" and the old exit-1-on-any-miss, the baseline gone.
  if (run.mode !== 'full') return 'eval-run.json is a --retrieval run: only a full run can be the baseline'
  return null
}

/**
 * What the judge reads beside a harness answer: the laws the model was given,
 * each as `judgeLawText` writes it -- reference, then words, the form the
 * nightly scoring and the calibration seed use -- or, for a book answer, the
 * sections it cites. Bare law text here and referenced text there would be a
 * calibration measured on one prompt and trusted on another.
 */
export function judgeLawsOf(
  given: readonly { law: string; citation: string | null }[],
  cited: readonly string[],
  section: (id: string) => { title: string; text: string } | null,
): string[] {
  if (given.length > 0) return given.map(judgeLawText)
  return cited.flatMap((id) => {
    const found = section(id)
    return found === null ? [] : [`${found.title}: ${found.text}`]
  })
}

/** A harness row as the judge column needs it: its table line, whether it failed, and its eval-run.json row. */
export interface JudgedRow {
  line: string
  failed: boolean
  json: { ok: boolean; stage: string; verdict: string[]; judge?: { faithful: boolean; relevant: boolean; why: string } | null }
}

/**
 * A row with the judge's column added (decision 25): the verdict in the cell
 * and in eval-run.json always, and as a failure only when `gates` -- the
 * calibration says the judge agrees with a person (`judgeGates`). An
 * uncalibrated judge calling a right answer unfaithful leaves it right: its
 * word alone would fail pull requests on a verdict nobody has checked it
 * against. A failure the judge alone found is put down to `judge`, so the
 * baseline's deltas say which check moved.
 */
export function withJudge<R extends JudgedRow>(row: R, verdict: { faithful: boolean; relevant: boolean; why: string } | null, gates: boolean): R {
  const next = { ...row, line: `${row.line} ${judgeCell(verdict)} |`, json: { ...row.json, judge: verdict } }
  if (verdict === null || !gates || (verdict.faithful && verdict.relevant)) return next
  const said = [verdict.faithful ? null : 'unfaithful', verdict.relevant ? null : 'off-point'].filter((each) => each !== null).join(', ')
  return { ...next, failed: true, json: { ...next.json, ok: false, stage: row.json.ok ? 'judge' : row.json.stage, verdict: [...row.json.verdict, `judge: ${said} (${verdict.why})`] } }
}
