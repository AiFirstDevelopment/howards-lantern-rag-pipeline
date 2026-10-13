#!/usr/bin/env tsx
/**
 * Whether each coverage verdict's law reaches the model (docs/plans/rerank.md).
 *
 *   npm run statutes:rerank -- AZ
 *
 * The offline suite holds a verdict to the pool the reranker reads; whether it
 * survives the reranker into the three the model is given can only be asked of
 * the deployed reranker. This asks it, topic by topic, with the deployed
 * meaning index fused in as the worker fuses it, and prints a line per verdict
 * and a count for the state's PR. Writes nothing.
 */
import { ANSWER_LAWS, chooseLaws, poolSize } from '../../worker/src/law-rerank'
import { RETRIEVED_LAWS, retrieve } from '../../worker/src/law-retrieval'
import { failed, nearLawsOverRest, deployedRerankOverRest, deployedRephrase } from '../live'
import { lawsOf, readCoverage, topicsOf } from './laws'

async function main(code: string): Promise<number> {
  const root = process.cwd()
  const block = readCoverage(root)[code]
  if (block === undefined) throw new Error(`${code} has no coverage block`)
  const laws = lawsOf(root, code)
  const near = nearLawsOverRest()
  const rerank = deployedRerankOverRest()
  const rephrase = deployedRephrase()
  let given = 0
  let judged = 0
  for (const topic of topicsOf(root)) {
    const verdict = block[topic.id]
    if (verdict === undefined || verdict.from === 'none') continue
    judged += 1
    const nearIds = await near(code, topic.question)
    const worded = rephrase === undefined ? [] : await rephrase(topic.question).catch(() => [])
    const searches = await Promise.all(worded.map(async (search) => ({ search, near: await near(code, search).catch(() => []) })))
    const pool = retrieve(laws, topic.question, poolSize(searches), nearIds, searches)
    const chosen = await chooseLaws(pool, retrieve(laws, topic.question, RETRIEVED_LAWS, nearIds, searches), topic.question, rerank)
    const rank = chosen.findIndex((law) => law.id === verdict.law)
    if (rank >= 0) given += 1
    console.log(`${rank >= 0 ? 'given ' : 'MISSED'} ${topic.id.padEnd(22)} ${verdict.law}${rank >= 0 ? ` (#${rank + 1})` : `; given ${chosen.map((law) => law.id).join(' ')}`}`)
  }
  console.log(`\n${code}: ${given} of ${judged} verdicts reach the model's ${ANSWER_LAWS}${rerank.fellBack() > 0 ? ` (${rerank.fellBack()} fell back to the cross-encoder)` : ''}`)
  return rerank.failures() === 0 ? 0 : failed(rerank.failures())
}

const code = process.argv.slice(2).find((arg) => /^[A-Z]{2}$/.test(arg))
if (code === undefined) {
  console.error('usage: npm run statutes:rerank -- XX')
  process.exit(2)
}
main(code).then(
  (exit) => process.exit(exit),
  (error: unknown) => {
    console.error(error)
    process.exit(2)
  },
)
