#!/usr/bin/env tsx
/**
 * How often the router picks the right written answer.
 *
 * **Not part of `npm test`, deliberately.** It calls the live model, so it
 * costs money and is not deterministic -- and a suite that is sometimes red for
 * neither of the reasons a suite is red teaches people to ignore it. The
 * behavioral suite injects an `Asker` instead and drives everything around the
 * model; this measures the model itself.
 *
 * What it is for: `claude-opus-5` at `effort: low` was chosen because routing
 * accuracy is the only quality that matters here and it is the first thing a
 * cheaper model would cost. This is the evidence a change of model has to be
 * argued against. Run it before, change `ASK_MODEL`, run it after, and put both
 * numbers in the pull request.
 *
 * Three kinds of case, and the third is the one worth reading:
 *
 * - **Every entry's own first phrasing**, generated rather than written down.
 *   These are in the prompt, so they are a floor rather than a score: anything
 *   below 100% here is a routing problem, not a wording one.
 * - **Paraphrases**, in `ask-eval.json` -- how somebody actually types it.
 * - **Questions that must reach a person.** A wrong entry is a non-sequitur
 *   somebody can see; a confident answer to "should I register an LLC" is the
 *   failure this whole design exists to make impossible, and it is the number
 *   to look at first.
 *
 * **The baseline is the point of the whole thing now.** Every step of the mesh
 * makes routing harder -- six tool descriptions instead of one enum, an entry
 * chosen from a domain's list rather than from all seventy-two -- and without a
 * before-number a drop in accuracy is unattributable. `--record` writes
 * `scripts/ask-eval-baseline.json`; every run after that prints the delta and
 * **exits non-zero on a drop**, so "we think it is about the same" stops being
 * a thing anybody can say. Recording it is a named human step: it needs
 * `ANTHROPIC_API_KEY`, and the build pipeline has none.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ASK_MODEL,
  NO_MATCH,
  askerFor,
  entriesFor,
  type AskTurn,
  type Audience,
} from '../worker/src/ask'

/** Where the recorded numbers live. Committed, and empty until somebody records. */
export const BASELINE = 'scripts/ask-eval-baseline.json'

export interface Tally {
  asked: number
  right: number
}

export interface Baseline {
  /** ISO date, or null when nothing has ever been recorded. */
  recordedAt: string | null
  model: string | null
  totals: Record<string, Tally>
}

/**
 * The run against the recorded one, and whether anything got worse.
 *
 * Percentages rather than counts, because the case list grows: an entry added
 * to the knowledge base adds a case, and comparing "right" against an older
 * "right" would read that as an improvement. A kind that did not exist in the
 * baseline is reported as new rather than as a drop -- the first run after a
 * domain is added must not be red for having more to do.
 */
export function compareToBaseline(
  baseline: Baseline,
  totals: Map<string, Tally>,
): { lines: string[]; dropped: boolean } {
  if (baseline.recordedAt === null) {
    return {
      lines: [`no baseline recorded. \`npm run ask:eval -- --record\` writes ${BASELINE}.`],
      dropped: false,
    }
  }
  const lines = [`baseline recorded ${baseline.recordedAt}${
    baseline.model === null ? '' : ` against ${baseline.model}`
  }`]
  let dropped = false
  for (const [kind, tally] of totals) {
    const score = (tally.right / tally.asked) * 100
    const before = baseline.totals[kind]
    if (before === undefined) {
      lines.push(`${kind.padEnd(20)} ${score.toFixed(0)}%  (new; nothing to compare)`)
      continue
    }
    const was = (before.right / before.asked) * 100
    const delta = score - was
    if (delta < 0) dropped = true
    lines.push(
      `${kind.padEnd(20)} ${score.toFixed(0)}%  was ${was.toFixed(0)}%  ${
        delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} points`
      }`,
    )
  }
  for (const kind of Object.keys(baseline.totals)) {
    if (!totals.has(kind)) {
      // A kind that has stopped being measured is a drop to nothing, and the
      // most likely cause is a fixture that quietly stopped loading.
      dropped = true
      lines.push(`${kind.padEnd(20)} no cases ran, and the baseline has ${baseline.totals[kind].asked}`)
    }
  }
  return { lines, dropped }
}

export function readBaseline(root: string): Baseline {
  return JSON.parse(readFileSync(path.join(root, BASELINE), 'utf8')) as Baseline
}

interface Fixture {
  paraphrases: { ask: string; expect: string }[]
  /** Asked of the sales-rep box, which routes over rep-knowledge-base.md alone. */
  repParaphrases: { ask: string; expect: string }[]
  followUps: { history: AskTurn[]; ask: string; expect: string[] }[]
  mustNotAnswer: { ask: string; why: string }[]
}

interface Case {
  kind: string
  audience: Audience
  ask: string
  history: AskTurn[]
  /** Any of these is right. `no-match` is an expectation like any other. */
  expect: string[]
}

function casesFrom(fixture: Fixture): Case[] {
  const cases: Case[] = []
  for (const entry of entriesFor('partner')) {
    cases.push({
      kind: 'own phrasing',
      audience: entry.audience === 'anyone' ? 'anyone' : 'partner',
      ask: entry.asks[0],
      history: [],
      expect: [entry.id],
    })
  }
  for (const paraphrase of fixture.paraphrases) {
    cases.push({
      kind: 'paraphrase',
      audience: 'anyone',
      ask: paraphrase.ask,
      history: [],
      expect: [paraphrase.expect],
    })
  }
  for (const paraphrase of fixture.repParaphrases) {
    cases.push({
      kind: 'rep paraphrase',
      audience: 'rep',
      ask: paraphrase.ask,
      history: [],
      expect: [paraphrase.expect],
    })
  }
  for (const followUp of fixture.followUps) {
    cases.push({
      kind: 'follow-up',
      audience: 'anyone',
      ask: followUp.ask,
      history: followUp.history,
      expect: followUp.expect,
    })
  }
  for (const refusal of fixture.mustNotAnswer) {
    cases.push({
      kind: 'must reach a person',
      audience: 'anyone',
      ask: refusal.ask,
      history: [],
      expect: [NO_MATCH],
    })
  }
  return cases
}

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY
  if (key === undefined || key.length === 0) {
    console.error('ANTHROPIC_API_KEY is not set. This one really does call the model.')
    process.exit(1)
  }
  const fixture = JSON.parse(
    readFileSync(path.join(process.cwd(), 'scripts/ask-eval.json'), 'utf8'),
  ) as Fixture
  const ask = askerFor(key)
  const cases = casesFrom(fixture)
  const missed: { kind: string; ask: string; expected: string[]; got: string }[] = []
  const totals = new Map<string, { asked: number; right: number }>()

  console.log(`${cases.length} cases against ${ASK_MODEL}.\n`)
  for (const [index, one] of cases.entries()) {
    const chosen = await ask({ audience: one.audience, question: one.ask, history: one.history })
    const right = one.expect.includes(chosen.id)
    const tally = totals.get(one.kind) ?? { asked: 0, right: 0 }
    totals.set(one.kind, { asked: tally.asked + 1, right: tally.right + (right ? 1 : 0) })
    if (!right) missed.push({ kind: one.kind, ask: one.ask, expected: one.expect, got: chosen.id })
    process.stdout.write(`${right ? '.' : 'x'}${(index + 1) % 50 === 0 ? '\n' : ''}`)
  }

  console.log('\n')
  for (const [kind, tally] of totals) {
    const score = Math.round((tally.right / tally.asked) * 100)
    console.log(`${kind.padEnd(20)} ${tally.right}/${tally.asked}  ${score}%`)
  }
  if (missed.length > 0) {
    console.log('\nMissed:')
    for (const miss of missed) {
      console.log(`  [${miss.kind}] "${miss.ask}"`)
      console.log(`      wanted ${miss.expected.join(' | ')}, got ${miss.got}`)
    }
  }

  if (process.argv.includes('--record')) {
    const recorded: Baseline = {
      recordedAt: new Date().toISOString().slice(0, 10),
      model: ASK_MODEL,
      totals: Object.fromEntries(totals),
    }
    writeFileSync(
      path.join(process.cwd(), BASELINE),
      `${JSON.stringify(recorded, null, 2)}\n`,
    )
    console.log(`\nrecorded ${BASELINE}. Commit it: it is the only before-number there will be.`)
    return
  }

  console.log('')
  const compared = compareToBaseline(readBaseline(process.cwd()), totals)
  for (const line of compared.lines) console.log(line)
  if (compared.dropped) {
    // Non-zero, so a run in a pipeline is a failure rather than a paragraph
    // somebody skims. A deliberate regression is recorded with `--record` and
    // argued in the pull request; there is no third option.
    console.error('\nrouting accuracy dropped against the baseline.')
    process.exit(1)
  }
}

// Only when run as a command. `tests/unit/ask-eval.test.ts` imports the
// baseline comparison and must not start a run that spends money -- and must
// certainly not reach the `process.exit(1)` above, which would take the suite's
// worker with it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
