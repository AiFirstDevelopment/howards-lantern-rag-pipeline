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
 * environment. Exits non-zero on any miss, so a prompt change that broke a case
 * cannot be called "about the same". The whole fixture runs only with `--all`;
 * `--state XX` is for iterating, because every case is a paid model call.
 *
 * The model calls go up as one Message Batch (scripts/eval-batch.ts), at half
 * the price; `--live` sends them one at a time as the worker does, for a run
 * that must finish in minutes rather than wait on a batch.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { citedPages, type AskLaw } from '../worker/src/law-retrieval'
import { registerMisses } from './answer-register'
import { BatchedAsks } from './eval-batch'
import type { StateLaw } from '../worker/src/law-topics'
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
  type Lang,
  type LearnerAsker,
  type LearnerReply,
  type LearnerTurn,
  type NationwidePath,
  type Scope,
} from '../worker/src/learner-ask'

interface Case {
  lang: Lang
  /** The chosen state; absent means none chosen. */
  state?: string
  question: string
  history?: LearnerTurn[]
  expect: {
    scope: Scope
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
    path?: NationwidePath
    /** Nationwide: at least this many citations, from as many different states. */
    states?: number
    /** Road law: an honest refusal counts as right, so long as nothing ungrounded is shown. */
    mayRefuse?: boolean
  }
}

interface Fixture {
  cases: Case[]
}

export const FIXTURE = 'scripts/learner-ask-eval.json'

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
  const model = learnerAskerFor(process.env.ANTHROPIC_API_KEY)
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
  const lawsFor = async (code: string) => {
    if (!built.has(code)) built.set(code, publishedLawsOf(process.cwd(), code))
    return built.get(code)!
  }
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
  fixture.cases = fixture.cases.filter((kase) => only === undefined || kase.state === only)
  if (fixture.cases.length === 0) throw new Error(`no cases for ${only}`)
  // The whole run is asked for by name. It is live Opus and Haiku for every
  // case -- about ten dollars at 130 cases -- and on 2026-10-10 it was run
  // five times in a day between a session and two builders, which emptied the
  // account twice. Iterating is `--state XX`; the whole run is once per PR.
  if (only === undefined && !argv.includes('--all')) {
    console.error(`${fixture.cases.length} cases, every one a live model call. Iterate with --state XX; run the whole fixture once per PR with --all.`)
    return 2
  }
  const live = process.argv.includes('--live') || process.env.ANTHROPIC_API_KEY === undefined
  // One case, end to end, with the asker it is given: the live model, or the
  // batch's parking asker.
  async function runCase(kase: Case, index: number, ask: LearnerAsker): Promise<{ line: string; failed: boolean }> {
    // A holder rather than a `let`: the model is called inside the closure.
    const seen: { reply: LearnerReply } = { reply: { kind: 'failed', model: 'unreachable' } }
    const started = Date.now()
    const { body, outcome, path: answeredBy } = await answerLearner(
      { lang: kase.lang, state: kase.state ?? null, question: kase.question },
      kase.history ?? [],
      {
        askLearner: async (request) => (seen.reply = await ask(request)),
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
    return {
      failed: wrong.length > 0,
      line: `| ${index + 1} | ${kase.lang}${kase.state === undefined ? '' : ` ${kase.state}`} | ${cell(kase.question)} | ${scope}${how} | ${cell(shown + citedAs)} | ${
        wrong.length === 0 ? 'ok' : cell(wrong.join('; '))
      } |`,
    }
    }
  console.log(`| # | lang | question | scope | shown | verdict |`)
  console.log(`|---|---|---|---|---|---|`)
  let rows: { line: string; failed: boolean }[]
  if (live) {
    rows = []
    for (const [index, kase] of fixture.cases.entries()) rows.push(await runCase(kase, index, model))
  } else {
    const batched = new BatchedAsks(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.batches)
    const pending = fixture.cases.map((kase, index) => batched.run(`case-${index + 1}`, (ask) => runCase(kase, index, ask)))
    await batched.whenParked(fixture.cases.length)
    const sent = await batched.submit()
    console.error(`batch ${sent.id}: ${sent.succeeded} of ${sent.sent} answered`)
    rows = await Promise.all(pending)
  }
  for (const row of rows) console.log(row.line)
  const failed = rows.filter((row) => row.failed).length
  console.log(`\n${fixture.cases.length - failed} of ${fixture.cases.length} right.`)
  if (rerank !== undefined && rerank.failures() > 0) return reranked(rerank.failures())
  return failed === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(2)
  },
)

