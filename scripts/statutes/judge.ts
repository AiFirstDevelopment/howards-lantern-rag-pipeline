#!/usr/bin/env tsx
/**
 * The verdicts for topics no state has been judged on yet, written by Sonnet
 * and read by a person (docs/plans/trusted-by-date.md, decision 2).
 *
 *   npm run statutes:judge -- MD --topic dui-first-fine
 *   npm run statutes:judge -- all --topic dui-first-fine dui-first-jail
 *   npm run statutes:judge -- all            (every topic without a verdict)
 *   npm run statutes:judge -- all --topic window-tint --batch
 *
 * For each state and topic with no verdict, Sonnet is shown two pools: the 24
 * laws `retrieve` returns for the topic's question alone -- the pool
 * tests/unit/statute-coverage.test.ts holds every verdict to -- in full, and
 * the laws the box would read live on top of those, from the rephraser's
 * searches and the meaning index, by id only. Only the first pool can become
 * a verdict, and the first judging pass, on Opus at effort high with both
 * pools' text, cost about $17 for 408 judgments; the second pool's words were
 * half of every prompt and could only ever produce a `none`. It names the one
 * law of the first pool that states the rule, or `none` with a reason. A law that answers but is in the live pool
 * only is written `none` with the reason `only with the index: <id>`: the
 * offline pool is what makes a comparison page honest, so such a verdict
 * cannot stand, but the id says the question could be reworded to reach it.
 *
 * Resumable, and it never overwrites a verdict: each one is written to
 * coverage.json the moment it is judged, so a run cut short by credits or a
 * crash resumes where it stopped, and a verdict already there -- written by
 * hand, by /add-code, or by an earlier run -- is skipped before any model or
 * index is asked, and said so. A credit error stops the run without a retry:
 * every further call would fail the same way and cost a request each.
 *
 * `--batch` sends every judgment of the run as one Message Batch, at half the
 * price, and writes the verdicts when it ends. The pools are built first and
 * recorded in BATCH_FILE with the batch's id, so a run killed while it waits
 * resumes the same batch rather than paying for it twice.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { statesOf } from '../law-vectors'
import { CANDIDATE_LAWS, poolSize } from '../../worker/src/law-rerank'
import { retrieve, type AskLaw } from '../../worker/src/law-retrieval'
import { STATE_NAMES } from '../../worker/src/states'
import { COVERAGE_FILE, lawsOf, readCoverage, topicsOf, type Coverage, type Topic, type Verdict } from './laws'

export const JUDGE_MODEL = 'claude-sonnet-5-5'

/** Medium, not high: picking one law of 24 that states a figure is reading, not reasoning, and the effort is most of the bill. */
export const JUDGE_EFFORT = 'medium'

/** Where a batch run records what it sent, until its verdicts are written; gitignored. */
export const BATCH_FILE = '.judge-batch.json'

/** The verdict's `from` for a law id, by the same reading the coverage test applies. */
export function kindOf(id: string): Exclude<Verdict['from'], 'none'> {
  return /-C-/.test(id) ? 'code' : /-S\d+$/.test(id) ? 'statute' : 'manual'
}

/** The reason a verdict carries when the law that answers is in the live pool only. */
export function onlyWithIndex(id: string): string {
  return `only with the index: ${id}`
}

/**
 * The state's block with one verdict added, in topics.json order, or the
 * block untouched when the topic already has one. Never overwrites: a
 * hand-corrected verdict silently replaced by a re-run is a comparison page
 * changing under a reviewer who already read it.
 */
export function withVerdict(
  coverage: Coverage,
  code: string,
  topic: string,
  verdict: Verdict,
  order: readonly string[],
): { coverage: Coverage; written: boolean } {
  const block = coverage[code] ?? {}
  if (block[topic] !== undefined) return { coverage, written: false }
  const merged: Record<string, Verdict> = { ...block, [topic]: verdict }
  const ordered: Record<string, Verdict> = {}
  for (const id of order) if (merged[id] !== undefined) ordered[id] = merged[id]
  for (const [id, each] of Object.entries(merged)) if (ordered[id] === undefined) ordered[id] = each
  return { coverage: { ...coverage, [code]: ordered }, written: true }
}

/** Every state and topic of the ones asked for that has no verdict yet, states in alphabetical order. */
export function unjudged(coverage: Coverage, states: readonly string[], topics: readonly string[]): { code: string; topic: string }[] {
  return [...states].sort().flatMap((code) => topics.filter((topic) => coverage[code]?.[topic] === undefined).map((topic) => ({ code, topic })))
}

/** Writes one verdict to coverage.json, re-reading the file first so nothing written since is lost. */
export function writeVerdict(root: string, code: string, topic: string, verdict: Verdict, order: readonly string[]): boolean {
  const { coverage, written } = withVerdict(readCoverage(root), code, topic, verdict, order)
  if (written) writeFileSync(path.join(root, COVERAGE_FILE), `${JSON.stringify(coverage, null, 2)}\n`)
  return written
}

/** What the judge answers: a law id from either pool, or `none`, and why. */
export interface Judgment {
  law: string
  reason: string
}

const RULES = `You are checking which law in one US state's driver manual or vehicle code answers a question, for a page that compares every state's answer.
You are given the question, then pool A, that state's laws in full, each "[id] (manual|code|statute) text (citation)", then pool B, the ids of laws a wider search also reached, without their text.
Name the one law that states the rule the question asks about, with its figure where the question asks for one. Read the law's own text: a law that names the subject without the rule or figure does not answer it, and neither does a law about a different offence, a different offender (a minor where the question is about adults) or a different occurrence (a second offence where the question asks about the first).
Answer from pool A. Name an id of pool B only if no law in pool A states the rule and the id's section is one you know states it; it is recorded as a law the page cannot yet use, not as the answer.
Where a manual law and a code law in the same pool both state it, prefer the manual law unless it states the rule wrongly or without the figure.
If no law in pool A states it and no id in pool B is one you know does, answer "none".
In "reason", say in one sentence what the law you named says that answers the question, or, for "none", what the pools hold instead and what is missing. Write figures as the law does.`

function lawLine(law: AskLaw): string {
  const kind = law.kind === 'statute' ? kindOf(law.id) : 'manual'
  return `[${law.id}] (${kind}) ${law.law.replace(/\s+/g, ' ').trim()}${law.citation === null ? '' : ` (${law.citation})`}`
}

/** The prompt for one state and topic: the offline pool's text as A, the ids only the live pool adds as B. */
export function judgePrompt(stateName: string, topic: Topic, offline: AskLaw[], liveOnly: AskLaw[]): string {
  return [
    `State: ${stateName}`,
    `Question: ${topic.question}`,
    '',
    'Pool A:',
    ...offline.map(lawLine),
    '',
    'Pool B:',
    ...(liveOnly.length === 0 ? ['(empty)'] : liveOnly.map((law) => law.id)),
  ].join('\n')
}

/** The judge's answer as a verdict: an id of pool A is a verdict, one of pool B or anything else is `none`. */
export function verdictOf(judgment: Judgment, offline: readonly { id: string }[], liveOnly: readonly { id: string }[]): Verdict {
  if (offline.some((law) => law.id === judgment.law)) return { from: kindOf(judgment.law), law: judgment.law }
  if (liveOnly.some((law) => law.id === judgment.law)) return { from: 'none', reason: onlyWithIndex(judgment.law) }
  const reason = judgment.reason.trim()
  return { from: 'none', reason: reason.length > 0 ? reason : 'no law in the pool states the rule' }
}

/** True for the API's answer when the account has run out: never retried. */
export function isCreditError(error: unknown): boolean {
  return /credit balance is too low/i.test(error instanceof Error ? error.message : String(error))
}

interface Usage {
  input: number
  output: number
  calls: number
}

/** One judgment's request, the same whether it is sent alone or in a batch. */
export function judgeParams(prompt: string, ids: string[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: JUDGE_MODEL,
    max_tokens: 8000,
    system: RULES,
    output_config: {
      effort: JUDGE_EFFORT,
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { law: { type: 'string', enum: [...ids, 'none'] }, reason: { type: 'string' } },
          required: ['law', 'reason'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: prompt }],
  }
}

function judgmentOf(message: Anthropic.Message, usage: Usage): Judgment {
  usage.input += message.usage.input_tokens
  usage.output += message.usage.output_tokens
  usage.calls += 1
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as Anthropic.TextBlock).text)
    .join('')
  const parsed = JSON.parse(text) as Partial<Judgment>
  if (typeof parsed.law !== 'string' || typeof parsed.reason !== 'string') throw new Error(`unreadable judgment: ${text}`)
  return { law: parsed.law, reason: parsed.reason }
}

async function judge(client: Anthropic, prompt: string, ids: string[], usage: Usage): Promise<Judgment> {
  return judgmentOf(await client.messages.create(judgeParams(prompt, ids)), usage)
}

/** A batch request's custom_id for a state and topic, and back: the API allows letters, digits, `_` and `-`. */
export function batchId(code: string, topic: string): string {
  return `${code}__${topic}`
}

export function fromBatchId(id: string): { code: string; topic: string } {
  const [code, topic] = id.split('__')
  return { code, topic }
}

/** What a batch run sent: the pools' ids are all a verdict needs once the answer is back. */
export interface PendingBatch {
  id: string
  pools: Record<string, { offline: string[]; liveOnly: string[] }>
}

export function parseArgs(args: string[], known: readonly string[]): { states: string[]; topics: string[] | null; batch: boolean } | null {
  const states: string[] = []
  const topics: string[] = []
  let inTopics = false
  let batch = false
  for (const arg of args) {
    if (arg === '--topic') inTopics = true
    else if (arg === '--batch') {
      batch = true
      inTopics = false
    }
    else if (arg.startsWith('--')) inTopics = false
    else if (inTopics) topics.push(arg)
    else if (arg === 'all') states.push(...known)
    else if (/^[A-Z]{2}$/.test(arg)) states.push(arg)
    else return null
  }
  return states.length === 0 ? null : { states: [...new Set(states)], topics: topics.length === 0 ? null : topics, batch }
}

async function main(): Promise<number> {
  const root = process.cwd()
  const known = statesOf(root)
  const args = parseArgs(process.argv.slice(2), known)
  if (args === null) {
    console.error('usage: npm run statutes:judge -- XX|all [--topic <id>...] [--batch]')
    return 2
  }
  const topics = topicsOf(root)
  const order = topics.map((topic) => topic.id)
  const asked = args.topics ?? order
  const unknown = asked.filter((id) => !order.includes(id))
  if (unknown.length > 0) {
    console.error(`not topics in topics.json: ${unknown.join(' ')}`)
    return 2
  }
  const coverage = readCoverage(root)
  // Said before anything is asked of the model, so a re-run on judged states
  // costs nothing and says why it did nothing.
  for (const code of args.states) {
    for (const id of asked) {
      const verdict = coverage[code]?.[id]
      if (verdict !== undefined) console.log(`${code} ${id}: already judged (${verdict.from}${verdict.law === undefined ? '' : ` ${verdict.law}`}), left as it is`)
    }
  }
  const todo = unjudged(coverage, args.states, asked)
  if (todo.length === 0) {
    console.log('nothing to judge: every state asked for has a verdict on every topic asked for')
    return 0
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    console.error('no ANTHROPIC_API_KEY: nothing judged')
    return 2
  }
  // Imported here, not at the top: they reach for wrangler's token, which a
  // run with nothing to judge has no business asking for.
  const { nearLawsOverRest, deployedRephrase } = await import('../live')
  const rest = nearLawsOverRest()
  // Cloudflare's embedding endpoint answers null under load rather than an
  // error, which nearLawsOverRest reads as a crash. Retried, never skipped: a
  // live pool built without the index hides the law only the index reaches,
  // and the verdict would say no law states the rule instead of naming it.
  const near = async (code: string, text: string): Promise<string[]> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await rest(code, text)
      } catch (error) {
        if (attempt >= 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
      }
    }
  }
  const rephrase = deployedRephrase()
  // One rephrasing per topic for the run: the question is the same in every state.
  const worded = new Map<string, Promise<string[]>>()
  const client = new Anthropic({ apiKey, maxRetries: 2 })
  const usage: Usage = { input: 0, output: 0, calls: 0 }
  const pendingFile = path.join(root, BATCH_FILE)
  if (args.batch && existsSync(pendingFile)) {
    const pending = JSON.parse(readFileSync(pendingFile, 'utf8')) as PendingBatch
    console.log(`resuming batch ${pending.id} from ${BATCH_FILE}: nothing new is sent`)
    return finishBatch(root, client, pending, order, usage)
  }
  const laws = new Map<string, AskLaw[]>()
  const requests: Anthropic.Messages.BatchCreateParams.Request[] = []
  const pools: PendingBatch['pools'] = {}
  let done = 0
  for (const { code, topic: id } of todo) {
    const topic = topics.find((each) => each.id === id)!
    if (!laws.has(code)) laws.set(code, lawsOf(root, code))
    const stateLaws = laws.get(code)!
    const offline = retrieve(stateLaws, topic.question, CANDIDATE_LAWS)
    if (!worded.has(id)) worded.set(id, rephrase === undefined ? Promise.resolve([]) : rephrase(topic.question).catch(() => []))
    const nearIds = await near(code, topic.question)
    const searches = await Promise.all((await worded.get(id)!).map(async (search) => ({ search, near: await near(code, search) })))
    const live = retrieve(stateLaws, topic.question, poolSize(searches), nearIds, searches)
    const inOffline = new Set(offline.map((law) => law.id))
    const liveOnly = live.filter((law) => !inOffline.has(law.id))
    if (args.batch) {
      const prompt = judgePrompt(STATE_NAMES[code] ?? code, topic, offline, liveOnly)
      requests.push({ custom_id: batchId(code, id), params: judgeParams(prompt, [...offline, ...liveOnly].map((law) => law.id)) })
      pools[batchId(code, id)] = { offline: offline.map((law) => law.id), liveOnly: liveOnly.map((law) => law.id) }
      continue
    }
    let judgment: Judgment
    try {
      judgment = await judge(client, judgePrompt(STATE_NAMES[code] ?? code, topic, offline, liveOnly), [...offline, ...liveOnly].map((law) => law.id), usage)
    } catch (error) {
      if (isCreditError(error)) {
        const left = todo.slice(done)
        console.error(`\ncredit balance is too low: stopped after ${done} of ${todo.length}, not retried`)
        const byState = new Map<string, string[]>()
        for (const each of left) byState.set(each.code, [...(byState.get(each.code) ?? []), each.topic])
        for (const [state, ids] of byState) console.error(`  remaining ${state}: ${ids.join(' ')}`)
        console.error(`resume with: npm run statutes:judge -- ${[...byState.keys()].join(' ')} --topic ${asked.join(' ')}`)
        report(usage)
        return 3
      }
      throw error
    }
    const verdict = verdictOf(judgment, offline, liveOnly)
    writeVerdict(root, code, id, verdict, order)
    done += 1
    console.log(`${code} ${id}: ${verdict.from}${verdict.law === undefined ? '' : ` ${verdict.law}`} -- ${verdict.reason ?? judgment.reason}`)
  }
  if (args.batch) {
    let created: Anthropic.Messages.MessageBatch
    try {
      created = await client.messages.batches.create({ requests })
    } catch (error) {
      if (isCreditError(error)) {
        console.error('\ncredit balance is too low: the batch was not sent, nothing judged')
        return 3
      }
      throw error
    }
    const pending: PendingBatch = { id: created.id, pools }
    writeFileSync(pendingFile, `${JSON.stringify(pending)}\n`)
    console.log(`sent batch ${created.id}: ${requests.length} judgments, recorded in ${BATCH_FILE}`)
    return finishBatch(root, client, pending, order, usage)
  }
  report(usage)
  return 0
}

/**
 * Waits for a batch to end and writes each verdict it brought back, never
 * over one already written. A request that errored or expired is named and
 * left unjudged, so the next run asks it again; the record is removed only
 * once every answer that came back is written.
 */
async function finishBatch(root: string, client: Anthropic, pending: PendingBatch, order: readonly string[], usage: Usage): Promise<number> {
  for (;;) {
    const batch = await client.messages.batches.retrieve(pending.id)
    if (batch.processing_status === 'ended') break
    console.log(`batch ${pending.id}: ${batch.request_counts.processing} still processing`)
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }
  const failed: string[] = []
  let credit = false
  for await (const result of await client.messages.batches.results(pending.id)) {
    const { code, topic } = fromBatchId(result.custom_id)
    const pool = pending.pools[result.custom_id]
    if (result.result.type !== 'succeeded' || pool === undefined) {
      if (result.result.type === 'errored' && isCreditError(JSON.stringify(result.result.error))) credit = true
      failed.push(`${code} ${topic} (${result.result.type})`)
      continue
    }
    const judgment = judgmentOf(result.result.message, usage)
    const verdict = verdictOf(judgment, pool.offline.map((id) => ({ id })), pool.liveOnly.map((id) => ({ id })))
    const written = writeVerdict(root, code, topic, verdict, order)
    console.log(`${code} ${topic}: ${written ? '' : 'already judged, not written: '}${verdict.from}${verdict.law === undefined ? '' : ` ${verdict.law}`} -- ${verdict.reason ?? judgment.reason}`)
  }
  rmSync(path.join(root, BATCH_FILE), { force: true })
  if (failed.length > 0) console.error(`\nnot judged, ask again: ${failed.join(', ')}`)
  if (credit) console.error('credit balance is too low')
  report(usage, true)
  return failed.length > 0 ? 3 : 0
}

function report(usage: Usage, batch = false): void {
  console.log(`\n${usage.calls} judgments, ${usage.input} input tokens, ${usage.output} output tokens${batch ? ', billed at the batch rate (half)' : ''}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (exit) => process.exit(exit),
    (error: unknown) => {
      console.error(error)
      process.exit(2)
    },
  )
}
