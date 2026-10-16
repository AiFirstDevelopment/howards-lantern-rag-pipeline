#!/usr/bin/env tsx
/**
 * How well the learner's box answers, measured against the live model.
 *
 * **Not part of `npm test`, deliberately**, for the reason ask-eval.ts gives:
 * it costs money and is not deterministic. The worker suite injects a scripted
 * model and drives everything around it; this is the one thing that measures
 * the model itself, and it is run by hand before a prompt or model change and
 * its table goes in the pull request (docs/plans/learner-ask.md, decision 12).
 *
 * Each case says what the answer must be: its scope, the word it must lead
 * with where the question is yes-or-no, what it must contain and what it must
 * not, and for road law the manual pages it must be shown citing. Every shown
 * road-law answer is also held to its register (scripts/answer-register.ts,
 * docs/plans/what-happens-if.md): at most two sentences, three for a question
 * of the consequence shape ("what happens if…"), one for an out-of-scope
 * consequence question, and no law's name or number in them. `notContains` is
 * how a case says what must not be said -- Maryland's no-license case holds the
 * answer to never writing that the laws "do not state" the penalty. Every answer
 * goes through `answerLearner`, the worker's own retrieval and checks, with the
 * state's laws read from the committed corpus -- so an answer that would have
 * been refused on the wire counts as a miss here even if its words were right.
 *
 * Needs a model key: `ANTHROPIC_API_KEY`, or whatever the SDK resolves from the
 * environment. Without a baseline it exits non-zero on any miss, so a prompt
 * change that broke a case cannot be called "about the same". The whole
 * fixture runs only with `--all`; `--state XX` is for iterating, because
 * every case is a paid model call.
 *
 * The model calls go up as one Message Batch (scripts/eval-batch.ts), at half
 * the price; `--live` sends them one at a time as the worker does, for a run
 * that must finish in minutes rather than wait on a batch.
 *
 * `--retrieval` asks no answering model at all: the same `answerLearner` runs
 * with an asker that records the laws it is handed and answers nothing, so
 * the rephraser, retrieval and (without `--no-rerank`) the reranker run as
 * they do for a learner, and the run reports where each case's gold law got
 * to. Every run ends with a summary block from scripts/eval-stage.ts, and
 * `--json` writes the rows, the summary, the commit, the prompt's and the
 * corpus's hashes and the run's cost to eval-run.json (`--json-file <path>`
 * writes it elsewhere, as a corpus push's eval does).
 *
 * Before a case runs, the set is validated (decision 18): one question twice
 * under a state, or a gold id the state's laws no longer hold, stops the run
 * naming the case. A missed case prints its ranked pool with the gold marked
 * (`--explain`, on under `--state`, off under `--all`). Holdout cases run only
 * in a whole run and are reported in their own block. Every run is compared
 * with scripts/learner-ask-eval-baseline.json, case by case; with a baseline,
 * the gate decides the exit code (decision 34, `gateOf` in eval-stage.ts): 1
 * on a holdout case newly wrong, on two newly wrong in one stage, or on
 * recall or generation more than two points down, after re-running a lone
 * newly-wrong holdout case once, live. A run with the baseline's own misses
 * is green.
 * `npm run eval:accept` makes the last whole run the baseline.
 *
 * Under `--all` every shown answer is also put to the judge
 * (worker/src/eval-judge.ts, decision 25), one Haiku call each, and its
 * verdict is a column. It fails a case only while
 * scripts/eval-judge-calibration.json records at least 0.9 agreement with a
 * person (`npm run eval:calibrate`); until then it is read, not obeyed.
 */
import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import learnerBank from '../worker/src/learner-knowledge-base.json' with { type: 'json' }
import { citedPages, type AskLaw } from '../worker/src/law-retrieval'
import { registerMisses } from './answer-register'
import { BatchedAsks } from './eval-batch'
import { costUsd, turnModels, type Spent } from './eval-cost'
import {
  deltaLines,
  deltas,
  explainLines,
  gateOf,
  givenDrift,
  rankOf,
  rerunOf,
  stageOf,
  summarize,
  summaryLines,
  validateCases,
  judgeLawsOf,
  withJudge,
  type FixtureCase,
  type Mode,
  type RunRow,
  type Scored,
  type StateTrace,
  type Summary,
} from './eval-stage'
import type { StateLaw } from '../worker/src/law-topics'
import { JUDGE_MODEL, judgeGates, recordedAgreement } from '../worker/src/eval-judge'
import { nodeJudge, readCalibration } from './eval-judge'
import { publishedLawsOf, topicLaws, topicsOf } from './statutes/laws'
import {
  failed as reranked,
  nearLawsOverRest,
  deployedRerankOverRest,
  deployedRephrase,
  deployedTopics,
  lawsByIdFromCorpus,
  lawsByIdOverRest,
  lawsBySectionFromCorpus,
  lawsBySectionWithFallback,
  penaltiesFromFiles,
  penaltiesWithFallback,
  processRowsFromFiles,
  processRowsWithFallback,
  nearLawsNationwideOverRest,
} from './live'
import {
  answerLearner,
  learnerAskerFor,
  learnerPrompt,
  sourceFor,
  type Lang,
  type LearnerAsker,
  type LearnerReply,
  type NationwidePath,
  type Scope,
} from '../worker/src/learner-ask'

/** A case of the fixture; the shape lives in scripts/eval-stage.ts, which eval:gold writes it through. */
type Case = FixtureCase

interface Fixture {
  cases: Case[]
}

export const FIXTURE = 'scripts/learner-ask-eval.json'
export const BASELINE = 'scripts/learner-ask-eval-baseline.json'
export const RUN_FILE = 'eval-run.json'

interface Row {
  line: string
  failed: boolean
  scored: Scored
  holdout: boolean
  /** The ranked pool of a miss, when there was a state retrieval to show. */
  explain?: string[]
  /** The answering model's tokens, and the whole turn's. */
  spent: { answering: { input: number; output: number }; turn: { input: number; output: number } }
  /** What the judge reads beside the answer: the laws the model was given, or the book sections a book answer cites. */
  judgeLaws: string[]
  json: RunRow & {
    lang: Lang
    gold?: string[]
    trace?: StateTrace
    shown: string
    verdict: string[]
    usage: { input: number; output: number }
    judge?: { faithful: boolean; relevant: boolean; why: string } | null
  }
}

/** What eval-run.json holds, and so what the baseline holds. */
export interface RunFile {
  mode: Mode
  reranked: boolean
  state: string | null
  /** A `--state` or `--cases` run: never a baseline, since every case it did not run would leave the deltas. */
  partial: boolean
  commit_sha: string
  prompt_sha: string
  corpus_hash: string
  cost_usd: number
  /** The judge's recorded calibration when it ran (`eval_runs.judge_agreement`), null when uncalibrated or not run. */
  judge_agreement: number | null
  /** Whether the judge's verdict could fail a case in this run. */
  judge_gate: boolean
  rows: Row['json'][]
  summary: Summary
  holdout_summary: Summary | null
  /** The lone newly-wrong holdout case the gate re-ran once, live, and whether the second answer was right; null when none was (decision 34). */
  rerun?: { n: number; ok: boolean } | null
}

/** The commit the run measured, read from git so a figure in eval_runs names the code that produced it. */
function commitSha(): string {
  // On a pull request CI checks out GitHub's temporary merge commit, a sha no
  // branch ever holds; the workflow passes the PR's head so the Runs panel
  // names a commit somebody can find.
  const given = process.env.EVAL_COMMIT_SHA
  if (given !== undefined && /^[0-9a-f]{40}$/.test(given)) return given
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * The prompt's hash: every block of `learnerPrompt` in both languages, with
 * and without the nationwide rule -- the rules and the book they cite, since
 * a book edit changes an answer as surely as a rule does.
 */
function promptSha(): string {
  const hash = createHash('sha256')
  for (const lang of ['en', 'es'] as const) {
    for (const nationwide of [false, true]) {
      const prompt = learnerPrompt(lang, nationwide)
      hash.update(prompt.rules).update('\u0000').update(prompt.sources).update('\u0000')
    }
  }
  return hash.digest('hex')
}

/** The corpus's hash: over each state's pushed hash in resource/laws-store.json, in state order. */
function corpusHash(): string {
  const store = JSON.parse(readFileSync(path.join(process.cwd(), 'resource/laws-store.json'), 'utf8')) as { states: Record<string, { sha256: string }> }
  const hash = createHash('sha256')
  for (const state of Object.keys(store.states).sort()) hash.update(`${state}:${store.states[state].sha256}\n`)
  return hash.digest('hex')
}

function misses(
  found: { scope: Scope; shown: string; pages: string[]; locations: string[]; ids: string[]; path?: NationwidePath; states: string[] },
  expected: Case['expect'],
): string[] {
  const out: string[] = []
  if (expected.path !== undefined && found.path !== expected.path) out.push(`answered by ${found.path ?? 'no'} path, wanted ${expected.path}`)
  if (expected.states !== undefined && found.shown !== '' && new Set(found.states).size < expected.states) {
    out.push(`cites ${new Set(found.states).size} state(s), wanted ${expected.states}`)
  }
  if (expected.citesLaw !== undefined && !found.locations.some((location) => location.includes(expected.citesLaw!))) {
    out.push(`does not cite ${expected.citesLaw}`)
  }
  if (expected.citesId !== undefined && !found.ids.some((id) => id.startsWith(expected.citesId!))) out.push(`does not cite ${expected.citesId}`)
  for (const page of expected.cites ?? []) {
    if (!found.pages.includes(page)) out.push(`does not cite p.${page}`)
  }
  if (expected.unanswered === true && found.shown !== '') out.push('answered')
  if (found.scope !== expected.scope) out.push(`scope ${found.scope}, wanted ${expected.scope}`)
  if (expected.lead !== undefined) {
    const first = found.shown.trim().split(/[\s.,!:]+/)[0]?.toLowerCase() ?? ''
    if (first !== expected.lead) out.push(`leads with "${first}", wanted "${expected.lead}"`)
  }
  for (const needle of expected.contains ?? []) {
    const any = Array.isArray(needle) ? needle : [needle]
    if (!any.some((each) => found.shown.toLowerCase().includes(each.toLowerCase()))) out.push(`missing ${any.map((each) => `"${each}"`).join(' or ')}`)
  }
  for (const needle of expected.notContains ?? []) {
    if (found.shown.toLowerCase().includes(needle.toLowerCase())) out.push(`contains "${needle}"`)
  }
  return out
}

async function main(): Promise<number> {
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), FIXTURE), 'utf8')) as Fixture
  // A retrieval run builds no answering model, so it cannot call one by accident.
  const mode: Mode = process.argv.includes('--retrieval') ? 'retrieval' : 'full'
  const model: LearnerAsker = mode === 'retrieval' ? async () => ({ kind: 'failed', model: 'unavailable' }) : learnerAskerFor(process.env.ANTHROPIC_API_KEY)
  // Built the way the corpus plugin builds /ask-laws/<CODE>.json, once per
  // state: a state's code is thousands of chunks read from hundreds of files.
  const nearLaws = nearLawsOverRest()
  // `--no-rerank` measures the box as it was before the reranker
  // (docs/plans/rerank.md), so a PR can show both scores.
  const rerank = process.argv.includes('--no-rerank') ? undefined : deployedRerankOverRest()
  const rephrase = deployedRephrase()
  const topicsFor = deployedTopics()
  // Phase 2 of Nationwide: the 51-namespace loop over REST, and the hits' words
  // from the production `laws` table with `--store`, or else from the corpus
  // that table is written from.
  const nearLawsNationwide = nearLawsNationwideOverRest()
  const lawsById = process.argv.includes('--store') ? lawsByIdOverRest() : lawsByIdFromCorpus()
  // A state question's whole sections (docs/plans/what-happens-if.md): from
  // the production table with `--store` once it has a `section` column, and
  // from the corpus it is pushed from until then, or without `--store`.
  const lawsBySection = process.argv.includes('--store') ? lawsBySectionWithFallback() : lawsBySectionFromCorpus()
  // The court's fine schedules (phase 2): from the production table with
  // `--store` once it exists, and from resource/penalties/ until then.
  const penaltiesFor = process.argv.includes('--store') ? penaltiesWithFallback() : penaltiesFromFiles()
  // The states' own pages (phase 3): the production table's rows with
  // `--store` once `process:fetch -- all --push` has run, and the committed
  // resource/process/ until then.
  const processRowsFor = process.argv.includes('--store') ? processRowsWithFallback() : processRowsFromFiles()
  const built = new Map<string, AskLaw[]>()
  const lawsOf = (code: string) => {
    if (!built.has(code)) built.set(code, publishedLawsOf(process.cwd(), code))
    return built.get(code)!
  }
  const lawsFor = async (code: string) => lawsOf(code)
  // The topic files as the corpus plugin writes them (docs/plans/nationwide.md),
  // built on the first nationwide case: every state's laws are read to build
  // them, which a run of one state's cases should not pay for.
  let topicFiles: Map<string, StateLaw[]> | null = null
  const topicLawsOf = () => (topicFiles ??= topicLaws(process.cwd()))
  const topics = async () => topicsOf(process.cwd()).filter((topic) => topicLawsOf().has(topic.id))
  const topicLawsFor = async (topic: string) => {
    const laws = topicLawsOf().get(topic)
    if (laws === undefined) throw new Error(`no topic file for ${topic}`)
    return laws
  }
  // `--state XX` runs that state's cases only, so a state's PR does not pay
  // for fifty states' model calls (docs/plans/vehicle-code.md); `--state US` runs the
  // nationwide cases (docs/plans/nationwide.md).
  const argv = process.argv.slice(2)
  const only = argv.includes('--state') ? argv[argv.indexOf('--state') + 1] : undefined
  if (only !== undefined && !/^[A-Z]{2}$/.test(only)) throw new Error(`--state takes a state code, not ${only}`)
  // `--cases 56,72` runs those cases only, numbered as the whole run numbers
  // them: re-measuring nine register misses spread over eight states with
  // `--state` paid for the other thirty cases of those states every time.
  const numbered = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',').map(Number) : undefined
  if (numbered !== undefined && numbered.some((n) => !Number.isInteger(n) || n < 1 || n > fixture.cases.length)) throw new Error(`--cases takes case numbers from 1 to ${fixture.cases.length}`)
  const numberOf = new Map(fixture.cases.map((kase, index) => [kase, index + 1]))
  // The set is checked whole before anything is asked (decision 18): a
  // duplicate anywhere is a case scored twice in the next whole run, and a
  // gold id a re-chunk renamed would score its case a retrieval miss forever.
  const book = new Set(learnerBank.book.map((section) => section.id))
  const idsOf = new Map<string, Set<string> | undefined>()
  const lawIdsOf = (state: string) => {
    if (!idsOf.has(state)) {
      let ids: Set<string> | undefined
      try {
        ids = new Set(lawsOf(state).map((law) => law.id))
      } catch {
        // A state with no published corpus: every gold there is reported absent.
        ids = undefined
      }
      idsOf.set(state, ids)
    }
    return idsOf.get(state)
  }
  const problems = validateCases(fixture.cases.map((kase, index) => ({ n: index + 1, kase })), lawIdsOf, book)
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`${problems.length} problem(s) in ${FIXTURE}; nothing was run.`)
    return 2
  }
  // A retrieval run takes the state road-law cases only: nothing else retrieves
  // from a state's laws, and there is no model to answer the rest.
  const retrieves = (kase: Case) => mode === 'full' || (kase.expect.scope === 'road-law' && kase.state !== undefined && kase.state !== 'US')
  // Holdout cases run only in a whole run, or when named with --cases: a
  // --state pass is how a prompt is tuned, and a case looked at while tuning
  // is no longer held out (decision 11).
  const whole = only === undefined && numbered === undefined
  const runs = (kase: Case, index: number) =>
    kase.retired === undefined &&
    (only === undefined || kase.state === only) &&
    (numbered === undefined || numbered.includes(index + 1)) &&
    (kase.holdout !== true || whole || numbered !== undefined) &&
    retrieves(kase)
  const heldBack = fixture.cases.filter((kase, index) => kase.holdout === true && !runs(kase, index) && runs({ ...kase, holdout: undefined }, index)).length
  fixture.cases = fixture.cases.filter(runs)
  if (fixture.cases.length === 0) throw new Error(`no cases for ${only ?? argv[argv.indexOf('--cases') + 1]}`)
  // The pool of a miss, ranked, under --state by default: the run a person
  // reads case by case. A whole run's misses would be thousands of lines.
  const explain = argv.includes('--explain') || (only !== undefined && !argv.includes('--no-explain'))
  // The whole run is asked for by name. It is live Opus and Haiku for every
  // case -- about ten dollars at 130 cases -- and on 2026-10-10 it was run
  // five times in a day between a session and two builders, which emptied the
  // account twice. Iterating is `--state XX`; the whole run is once per PR.
  if (only === undefined && numbered === undefined && !argv.includes('--all') && mode === 'full') {
    console.error(`${fixture.cases.length} cases, every one a live model call. Iterate with --state XX; run the whole fixture once per PR with --all.`)
    return 2
  }
  const live = process.argv.includes('--live') || process.env.ANTHROPIC_API_KEY === undefined || mode === 'retrieval'
  // One case, end to end, with the asker it is given: the live model, or the
  // batch's parking asker.
  async function runCase(kase: Case, ask: LearnerAsker): Promise<Row> {
    // A holder rather than a `let`: the model is called inside the closure.
    const seen: { reply: LearnerReply } = { reply: { kind: 'failed', model: 'unreachable' } }
    // What the stage attribution needs and the trace does not hold: the text
    // of the laws the model was handed, and its first reply before a shorter
    // ask replaced it -- recorded by wrapping the asker, never by asking again.
    const handed: { laws?: AskLaw[]; raw?: string } = {}
    // The answering model's tokens, apart from the turn's, so each is priced
    // at its own model's rate (scripts/eval-cost.ts).
    const answering = { input: 0, output: 0 }
    const started = Date.now()
    const { body, outcome, path: answeredBy } = await answerLearner(
      { lang: kase.lang, state: kase.state ?? null, question: kase.question },
      kase.history ?? [],
      {
        askLearner: async (request) => {
          handed.laws ??= request.laws ?? undefined
          seen.reply = await ask(request)
          answering.input += seen.reply.usage?.input ?? 0
          answering.output += seen.reply.usage?.output ?? 0
          if (handed.raw === undefined && seen.reply.kind === 'reply') handed.raw = seen.reply.answer
          return seen.reply
        },
        lawsFor,
        nearLaws,
        rerank,
        rephrase,
        topics,
        topicLawsFor,
        topicsFor,
        nearLawsNationwide,
        lawsById,
        lawsBySection,
        penaltiesFor,
        processRowsFor,
        contact: 'support@example.test',
      },
    )
    // What the learner would see: the answer when the checks pass, nothing
    // otherwise -- a refused answer is a miss even when its words were right.
    const scope: Scope = seen.reply.kind === 'reply' ? seen.reply.scope : 'other'
    const shown = body.answer ?? ''
    const pages = (body.citations ?? []).flatMap((citation) => citedPages(citation.location))
    const locations = (body.citations ?? []).map((citation) => citation.location)
    const ids = (body.citations ?? []).map((citation) => citation.id)
    const states = (body.citations ?? []).flatMap((citation) => (citation.state === undefined ? [] : [citation.state]))
    const wrong = [...misses({ scope, shown, pages, locations, ids, path: answeredBy, states }, kase.expect), ...registerMisses({ question: kase.question, scope, shown, nationwide: kase.state === 'US' })]
    const wanted =
      kase.expect.mayRefuse !== true &&
      (kase.expect.scope === 'app' ||
        (kase.expect.scope === 'road-law' && (kase.expect.cites !== undefined || kase.expect.citesLaw !== undefined || kase.expect.citesId !== undefined || kase.state === 'US')))
    // What was refused, in the model's words: "ungrounded" alone does not say
    // which figure, and the next prompt change needs to know.
    const wrote = seen.reply.kind === 'reply' && seen.reply.answer !== '' ? ` (wrote: ${seen.reply.answer})` : ''
    if (shown === '' && wanted) wrong.push(`refused: ${outcome.model}${wrote}`)
    const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
    const citedAs =
      pages.length > 0 ? ` [p.${pages.join(', p.')}]` : locations.length > 0 ? ` [${locations[0].split(' — ')[0]}]` : ''
    // Which way a nationwide answer came, and how long it took: the row's
    // `model`, and phase 2's latency is the 51-namespace loop's.
    const how = answeredBy === undefined ? '' : ` [${outcome.model}, ${live ? `${((Date.now() - started) / 1000).toFixed(1)}s` : 'batch'}]`
    const trace = 'pool' in outcome.trace ? outcome.trace : undefined
    // The wrap and the worker's own trace must name the same given laws, or
    // the stage column is attributing a pipeline production does not run.
    const drift = givenDrift(handed.laws?.map((law) => law.id), trace)
    if (drift !== null) throw new Error(`case ${numberOf.get(kase)}: ${drift}`)
    const first = kase.expect.contains?.[0]
    const scored: Scored = {
      state: kase.state,
      gold: kase.gold,
      trace,
      fact: first === undefined ? undefined : Array.isArray(first) ? first : [first],
      givenTexts: (handed.laws ?? []).map((law) => law.law),
      raw: mode === 'full' ? (handed.raw ?? '') : undefined,
      shown,
      right: wrong.length === 0,
      wantsRefusal: kase.expect.unanswered === true,
      mayRefuse: kase.expect.mayRefuse === true,
    }
    const stage = stageOf(scored, mode) ?? '—'
    // The case's number in the fixture, in every run: what --cases takes, what
    // validation names, and what a holdout or a retired row never shifts.
    const n = numberOf.get(kase)!
    const asked = `${kase.lang}${kase.state === undefined ? '' : ` ${kase.state}`}`
    const rank = kase.gold === undefined || trace === undefined ? '—' : `${rankOf(kase.gold, trace.pool) ?? 'absent'} of ${trace.pool.length}`
    const line =
      mode === 'retrieval'
        ? `| ${n} | ${asked} | ${cell(kase.question)} | ${rank} | ${stage} |`
        : `| ${n} | ${asked} | ${cell(kase.question)} | ${scope}${how} | ${cell(shown + citedAs)} | ${wrong.length === 0 ? 'ok' : cell(wrong.join('; '))} | ${stage} |`
    // A retrieval run fails a case only where it can see the loss.
    const failed = mode === 'retrieval' ? stage === 'retrieval' || stage === 'rerank' : wrong.length > 0
    const holdout = kase.holdout === true
    const explained =
      failed && trace !== undefined && kase.state !== undefined
        ? explainLines(n, kase.question, stage, trace, kase.gold, (id) => lawsOf(kase.state!).find((law) => law.id === id))
        : undefined
    const turn = outcome.usage ?? { input: 0, output: 0 }
    const judgeLaws = judgeLawsOf(handed.laws ?? [], ids, (id) => sourceFor(kase.lang, id))
    return {
      line,
      failed,
      scored,
      holdout,
      explain: explained,
      spent: { answering, turn },
      judgeLaws,
      json: { n, lang: kase.lang, state: kase.state, question: kase.question, gold: kase.gold, trace, stage, ok: !failed, holdout, shown, verdict: wrong, usage: turn },
    }
  }
  // The judge (decision 25) reads every shown answer of a whole run, and is a
  // gate only while the calibration file says it agrees with a person.
  const judging = mode === 'full' && argv.includes('--all')
  const calibration = judging ? readCalibration() : null
  const gates = calibration !== null && judgeGates(calibration, Math.floor(Date.now() / 1000))
  const judge = calibration === null ? undefined : nodeJudge(calibration)
  if (judging && judge === undefined) console.error('ANTHROPIC_API_KEY is not set: no judge column')
  const judgeHeader = judge === undefined ? '' : ' judge |'
  const judgeRule = judge === undefined ? '' : '---|'
  if (mode === 'retrieval') {
    console.log(`| # | lang | question | gold rank in pool | stage |`)
    console.log(`|---|---|---|---|---|`)
  } else {
    console.log(`| # | lang | question | scope | shown | verdict | stage |${judgeHeader}`)
    console.log(`|---|---|---|---|---|---|---|${judgeRule}`)
  }
  let rows: Row[]
  if (live) {
    rows = []
    for (const kase of fixture.cases) rows.push(await runCase(kase, model))
  } else {
    const batched = new BatchedAsks(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.batches)
    const pending = fixture.cases.map((kase, index) => batched.run(`case-${index + 1}`, (ask) => runCase(kase, ask)))
    await batched.whenParked(fixture.cases.length)
    // A second round is the box's shorter ask for the answers that ran long.
    for (const sent of await batched.rounds()) console.error(`batch ${sent.id}: ${sent.succeeded} of ${sent.sent} answered`)
    rows = await Promise.all(pending)
  }
  // One at a time, after the run: a batch's two hundred answers judged at
  // once would be two hundred concurrent calls against one key.
  const judged = { input: 0, output: 0 }
  const judgeRow = async (row: Row): Promise<Row> => {
    if (judge === undefined) return row
    if (row.json.shown === '') return withJudge(row, null, gates)
    try {
      const verdict = await judge.verdict({ question: row.json.question, answer: row.json.shown, laws: row.judgeLaws })
      judged.input += verdict.usage?.input ?? 0
      judged.output += verdict.usage?.output ?? 0
      return withJudge(row, { faithful: verdict.faithful, relevant: verdict.relevant, why: verdict.why }, gates)
    } catch (error) {
      console.error(`case ${row.json.n}: the judge did not answer`, error)
      return withJudge(row, null, gates)
    }
  }
  if (judge !== undefined) {
    const next: Row[] = []
    for (const row of rows) next.push(await judgeRow(row))
    rows = next
    console.error(`judge: ${gates ? 'a gate' : 'a column only'} (calibration ${calibration?.lastRun === null || calibration === null ? 'never run' : `${calibration.lastRun.agreement} on ${calibration.lastRun.at.slice(0, 10)}`})`)
  }
  // The gate's flake allowance (decision 34): a lone holdout case newly wrong against
  // the baseline is run once more, live, and its second answer is the one
  // that counts and the one recorded. Done before anything is printed, so the
  // table, the summary and eval-run.json all describe the same answers. The
  // first answer's spend is kept in the cost: it was paid for.
  const baseline = baselineFor(mode)
  const discarded: Row[] = []
  let rerun: RunFile['rerun'] = null
  const lone = baseline.baseline === null ? null : rerunOf(deltas(baseline.baseline.rows, rows.map((row) => row.json)))
  if (lone !== null) {
    const kase = fixture.cases.find((each) => numberOf.get(each) === lone)!
    const again = await judgeRow(await runCase(kase, model))
    discarded.push(rows.find((row) => row.json.n === lone)!)
    rows = rows.map((row) => (row.json.n === lone ? again : row))
    rerun = { n: lone, ok: again.json.ok }
    console.error(`case ${lone} was the one holdout case newly wrong: re-ran it once, live -- ${again.json.ok ? 'right this time, so it does not count' : 'wrong again, so it counts'}`)
  }
  // Holdout rows in their own table and block (decision 11), after the rest,
  // so a tuning pass reads its own numbers without them mixed in.
  const tuning = rows.filter((row) => !row.holdout)
  const held = rows.filter((row) => row.holdout)
  for (const row of tuning) console.log(row.line)
  if (held.length > 0) {
    console.log(`\nHoldout -- never tuned against:\n`)
    console.log(mode === 'retrieval' ? `| # | lang | question | gold rank in pool | stage |\n|---|---|---|---|---|` : `| # | lang | question | scope | shown | verdict | stage |\n|---|---|---|---|---|---|---|`)
    for (const row of held) console.log(row.line)
  }
  // The ranked pool of a tuning case's miss. A holdout's pool is not printed:
  // reading it is looking at the case.
  if (explain) for (const row of tuning) for (const line of row.explain ?? []) console.log(line)
  const failed = rows.filter((row) => row.failed).length
  if (mode === 'full') console.log(`\n${rows.length - failed} of ${rows.length} right.`)
  const summary = summarize(tuning.map((row) => row.scored), mode, rerank !== undefined)
  const title = `${mode === 'retrieval' ? `Retrieval${rerank === undefined ? ' (no rerank)' : ''}` : 'Full'} run${only === undefined ? '' : `, ${only}`}: ${tuning.length} case(s)`
  for (const line of summaryLines(summary, title)) console.log(line)
  const holdoutSummary = held.length === 0 ? null : summarize(held.map((row) => row.scored), mode, rerank !== undefined)
  if (holdoutSummary !== null) for (const line of summaryLines(holdoutSummary, `Holdout: ${held.length} case(s)`)) console.log(line)
  if (heldBack > 0) console.log(`  ${heldBack} holdout case(s) not run: a whole run reports them`)
  if (mode === 'retrieval') console.log('  answering model: not called')
  const models = turnModels()
  const spent: Spent[] = [
    { model: models.answering, batch: !live, ...[...rows, ...discarded].reduce((sum, row) => ({ input: sum.input + row.spent.answering.input, output: sum.output + row.spent.answering.output }), { input: 0, output: 0 }) },
    {
      model: models.helpers,
      ...[...rows, ...discarded].reduce(
        (sum, row) => ({ input: sum.input + row.spent.turn.input - row.spent.answering.input, output: sum.output + row.spent.turn.output - row.spent.answering.output }),
        { input: 0, output: 0 },
      ),
    },
  ]
  if (judge !== undefined) spent.push({ model: JUDGE_MODEL, ...judged })
  const cost = costUsd(spent)
  console.log(`  cost: $${cost.toFixed(2)} at list prices (at most: cached input is priced as fresh)`)
  const run: RunFile = {
    mode,
    reranked: rerank !== undefined,
    state: only ?? null,
    partial: !whole,
    commit_sha: commitSha(),
    prompt_sha: promptSha(),
    corpus_hash: corpusHash(),
    cost_usd: Number(cost.toFixed(4)),
    judge_agreement: judge === undefined || calibration === null ? null : recordedAgreement(calibration),
    judge_gate: judge !== undefined && gates,
    rows: rows.map((row) => row.json),
    summary,
    holdout_summary: holdoutSummary,
    rerun,
  }
  // `--json-file <path>` is the corpus push's eval (scripts/push-eval.ts):
  // written beside the repository's eval-run.json rather than over it, which
  // may be a whole run waiting for `eval:accept`.
  const runFile = argv.includes('--json-file') ? argv[argv.indexOf('--json-file') + 1] : argv.includes('--json') ? RUN_FILE : undefined
  if (runFile !== undefined) {
    writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`)
    console.log(`  wrote ${runFile}`)
  }
  const verdict = againstBaseline(run, baseline)
  if (rerank !== undefined && rerank.failures() > 0) return reranked(rerank.failures())
  // With a baseline, the gate decides (decision 34): the baseline's own misses
  // are known, and a run that repeats them is green. Without one, every miss is.
  return verdict ?? (failed === 0 ? 0 : 1)
}

/**
 * The accepted baseline when it is a run of the same mode as this one, or
 * null, saying why. A retrieval run compared with a full baseline would call
 * every generation miss "newly right".
 */
function baselineFor(mode: Mode): { baseline: RunFile | null; why?: string } {
  const file = path.join(process.cwd(), BASELINE)
  if (!existsSync(file)) return { baseline: null, why: `no baseline yet (${BASELINE}): run --all --json, then npm run eval:accept` }
  const baseline = JSON.parse(readFileSync(file, 'utf8')) as RunFile
  if (baseline.mode !== mode) return { baseline: null, why: `the baseline is a ${baseline.mode} run and this is a ${mode} run: no deltas` }
  return { baseline }
}

/**
 * The run against the accepted baseline, printed with the gate's verdict;
 * the exit code when there is a baseline to compare with, or null when there
 * is not.
 */
function againstBaseline(run: RunFile, { baseline, why }: { baseline: RunFile | null; why?: string }): number | null {
  if (baseline === null) {
    console.log(`\n${why}`)
    return null
  }
  const found = deltas(baseline.rows, run.rows)
  console.log(`\nAgainst the baseline (${baseline.commit_sha.slice(0, 8)}): ${found.compared} case(s) in both`)
  for (const line of deltaLines(found.tuning, 'Deltas')) console.log(line)
  if (run.rows.some((row) => row.holdout === true)) for (const line of deltaLines(found.holdout, 'Holdout deltas')) console.log(line)
  const stageOfCase = (n: number) => run.rows.find((row) => row.n === n)?.stage ?? 'unattributed'
  const gate = gateOf(found, stageOfCase, baseline.summary ?? null, run.summary)
  console.log(gate.exit === 0 ? '\nGate: passed' : '\nGate: failed -- npm run eval:accept in the PR is the written override')
  for (const reason of gate.reasons) console.log(`  ${reason}`)
  return gate.exit
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(2)
  },
)

