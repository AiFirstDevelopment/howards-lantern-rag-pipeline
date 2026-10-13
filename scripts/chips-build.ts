#!/usr/bin/env tsx
/**
 * `npm run chips:build`: every chip in resource/chips.json, in English and in
 * Spanish, answered through the live nationwide pipeline and written to
 * resource/chips-answers.json (docs/plans/trusted-by-date.md, decision 15).
 *
 * The pipeline is the eval's: `answerLearner` with Haiku choosing the topics,
 * the topic files the build publishes, Opus writing, and `checkLawAnswer`
 * deciding -- so a stored answer is one the box would have shown. The model
 * calls go up as one Message Batch (scripts/eval-batch.ts) at half the price.
 * Then the stored answer's own checks (scripts/chips.ts) run on top, and a
 * chip either check refuses is not written and is named in the output.
 *
 * Only what is missing or stale is asked: a chip whose stored answer still
 * passes its checks -- same question, same topics, same corpus hash -- is kept
 * as it is. A corpus change re-answers the chips on the topics it touched and
 * no others; tests/unit/chips.test.ts is red until this has run. The chooser
 * must read the chip's own topics: one it sends elsewhere is refused before
 * the model is asked, so a misrouted chip costs a Haiku call, not an Opus one.
 *
 * `--register` asks every chip again, stored or not (docs/plans/what-happens-if.md,
 * decision 7): a change to the rules answers are written under leaves every
 * stored answer passing its checks and reading like the box before it, and
 * this is the rebuild. Only a `--register` build writes the current rules'
 * `promptHash`, so a build that kept stored answers cannot vouch for them.
 *
 * `--dry-run` says what would be asked and asks nothing.
 *
 * `--states XX [YY…] | all` builds the state chips instead
 * (scripts/state-chips-build.ts, docs/plans/what-happens-if.md, phase 4): one
 * command for both pools, so `/add-code` and `/add-state` name one script.
 */
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { BatchedAsks } from './eval-batch'
import { deployedRephrase, deployedTopics } from './live'
import { topicLaws, topicsOf } from './statutes/laws'
import {
  CHIP_ANSWERS_FILE,
  CHIP_LANGS,
  checkStoredChip,
  chipPromptHash,
  chipTopics,
  corpusHash,
  readChipAnswers,
  readChips,
  type Chip,
  type ChipAnswer,
  type ChipContext,
} from './chips'
import { answerLearner, NATIONWIDE, type Lang, type LearnerAskRequest, type LearnerReply } from '../worker/src/learner-ask'

type Outcome = { stored: ChipAnswer } | { refused: string }

async function main(): Promise<number> {
  const root = process.cwd()
  const chips = readChips(root)
  const topics = topicsOf(root)
  const laws = topicLaws(root)
  const context: ChipContext = { topics, topicLaws: laws }
  const published = topics.filter((topic) => laws.has(topic.id))
  const { chips: previous, promptHash: previousHash } = readChipAnswers(root)
  const register = process.argv.includes('--register')
  const promptHash = chipPromptHash()

  const kept: ChipAnswer[] = []
  const asking: { chip: Chip; lang: Lang }[] = []
  for (const chip of chips) {
    for (const lang of CHIP_LANGS) {
      const stored = previous.find((each) => each.id === chip.id && each.lang === lang)
      if (!register && stored !== undefined && checkStoredChip(stored, chip, context).length === 0) kept.push(stored)
      else asking.push({ chip, lang })
    }
  }
  console.error(`${kept.length} stored answers still hold; ${asking.length} to ask.`)
  if (process.argv.includes('--dry-run')) {
    for (const { chip, lang } of asking) console.log(`would ask ${chip.id} (${lang}): ${chip.question[lang]}`)
    return 0
  }
  if (asking.length > 0 && process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('no ANTHROPIC_API_KEY: nothing can be answered')
    return 2
  }

  const topicsFor = deployedTopics()
  const rephrase = deployedRephrase()
  const today = new Date().toISOString().slice(0, 10)

  // One chip in one language, end to end, with the batch's parking asker.
  async function answer(chip: Chip, lang: Lang, ask: (request: LearnerAskRequest) => Promise<LearnerReply>): Promise<Outcome> {
    const own = chipTopics(chip, topics)
    const read: string[] = []
    const seen: { reply?: LearnerReply; refused?: string } = {}
    const question = chip.question[lang]
    const { body, outcome, path: answeredBy } = await answerLearner({ lang, state: NATIONWIDE, question }, [], {
      askLearner: async (request) => {
        // Asked before Opus is: a chip answered from a topic that is not its
        // own fails its checks whatever Opus writes, so it is not worth a call.
        const strays = read.filter((id) => !own.includes(id))
        if (read.length === 0 || strays.length > 0) {
          seen.refused = `the chooser read ${read.length === 0 ? 'no topic' : read.join(', ')}, not ${own.join(', ')}`
          return { kind: 'failed', model: 'unreachable' }
        }
        return (seen.reply = await ask(request))
      },
      lawsFor: async () => [],
      rephrase,
      topics: async () => published,
      topicLawsFor: async (id) => {
        read.push(id)
        const found = laws.get(id)
        if (found === undefined) throw new Error(`no topic file for ${id}`)
        return found
      },
      topicsFor,
      contact: 'support@example.test',
    })
    if (seen.refused !== undefined) return { refused: seen.refused }
    const wrote = seen.reply?.kind === 'reply' && seen.reply.answer !== '' ? ` (wrote: ${seen.reply.answer})` : ''
    if (body.id !== 'answer' || body.answer === undefined || answeredBy !== 'topic') {
      return { refused: `the live checker refused it: ${outcome.model}${wrote}` }
    }
    const stored: ChipAnswer = {
      id: chip.id,
      lang,
      question,
      topics: [...read].sort(),
      corpus: corpusHash(own, laws),
      answer: body.answer,
      sources: body.citations ?? [],
      absent: body.absent ?? [],
      asOf: today,
      model: seen.reply?.kind === 'reply' ? seen.reply.model : outcome.model,
    }
    const problems = checkStoredChip(stored, chip, context)
    return problems.length === 0 ? { stored } : { refused: `${problems.join('; ')}${wrote}` }
  }

  const answered: ChipAnswer[] = []
  const refused: { chip: Chip; lang: Lang; why: string }[] = []
  if (asking.length > 0) {
    const batched = new BatchedAsks(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.batches)
    const pending = asking.map(({ chip, lang }) => batched.run(`${chip.id}-${lang}`, (ask) => answer(chip, lang, ask)))
    await batched.whenParked(asking.length)
    const sent = await batched.submit()
    console.error(`batch ${sent.id || '(none)'}: ${sent.succeeded} of ${sent.sent} answered`)
    const outcomes = await Promise.all(pending)
    outcomes.forEach((outcome, index) => {
      if ('stored' in outcome) answered.push(outcome.stored)
      else refused.push({ ...asking[index], why: outcome.refused })
    })
  }

  // In the pool's order, English before Spanish, so a rebuild's diff is only
  // the answers that changed.
  const order = (each: ChipAnswer) => chips.findIndex((chip) => chip.id === each.id) * CHIP_LANGS.length + CHIP_LANGS.indexOf(each.lang)
  const written = [...kept, ...answered].sort((left, right) => order(left) - order(right))
  // The hash says every stored answer was written under these rules: true
  // after a --register build, and still true after an ordinary one only if it
  // already was.
  const vouched = register || previousHash === promptHash ? promptHash : previousHash
  writeFileSync(path.join(root, CHIP_ANSWERS_FILE), `${JSON.stringify({ ...(vouched === undefined ? {} : { promptHash: vouched }), chips: written }, null, 2)}\n`)

  console.log(`${written.length} stored (${kept.length} kept, ${answered.length} answered); ${refused.length} refused.`)
  if (register) {
    const lost = previous.filter((before) => !written.some((now) => now.id === before.id && now.lang === before.lang))
    for (const each of lost) console.log(`LOST ${each.id} (${each.lang}): stored before, refused under the new rules`)
  }
  for (const { chip, lang, why } of refused) console.log(`REFUSED ${chip.id} (${lang}): ${why}`)
  return 0
}

// The state chips are their own build, asked for by `--states`, and never
// alongside the nationwide pool: the two are separate batches and separate
// files, and a state's PR should not pay for fifty nationwide questions.
const run = process.argv.includes('--states') ? import('./state-chips-build').then((build) => build.main()) : main()

run.then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(2)
  },
)
