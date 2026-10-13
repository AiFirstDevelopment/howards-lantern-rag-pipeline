#!/usr/bin/env tsx
/**
 * For each topic on resource/statutes/topics.json, the three laws the box would
 * retrieve first for the topic's question over the state's whole retrieval
 * file -- the manual, any hand-written laws and the chunked code -- so whoever
 * writes the state's block in coverage.json reads what retrieval actually
 * reaches rather than what they expect it to (docs/plans/vehicle-code.md,
 * decision 7).
 *
 *   npm run statutes:gaps -- MD
 *
 * Prints; writes nothing. The verdict is a person's (or a subagent's) reading.
 */
import { retrieve } from '../../worker/src/law-retrieval'
import { lawsOf, topicsOf } from './laws'

const code = process.argv.slice(2).find((arg) => /^[A-Z]{2}$/.test(arg))
if (code === undefined) {
  console.error('usage: npm run statutes:gaps -- XX')
  process.exit(2)
}
const root = process.cwd()
const laws = lawsOf(root, code)
console.log(`${code}: ${laws.length} laws in the retrieval file\n`)
for (const topic of topicsOf(root)) {
  console.log(`## ${topic.id}: ${topic.question}`)
  for (const law of retrieve(laws, topic.question).slice(0, 3)) {
    const from = law.kind === 'statute' ? (/-C-/.test(law.id) ? 'code' : 'statute') : 'manual'
    console.log(`  ${law.id} [${from}] ${law.law.slice(0, 220).replace(/\s+/g, ' ')}`)
  }
  console.log('')
}
