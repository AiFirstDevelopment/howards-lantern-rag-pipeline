import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { statesOf } from '../../scripts/law-vectors'
import { statesWithSources } from '../../scripts/statutes/fetch'
import { lawsOf, readCoverage, topicLaws, topicsOf, type Verdict } from '../../scripts/statutes/laws'
import { CANDIDATE_LAWS } from '../../worker/src/law-rerank'
import { TOPIC_FAMILIES } from '../../worker/src/law-topics'
import { retrieve, type AskLaw } from '../../worker/src/law-retrieval'

/**
 * coverage.json is how "can the box answer X in Y" is read off the
 * repository (docs/plans/vehicle-code.md, decision 7), and the law pages are
 * built from it -- so a verdict that names a law retrieval never reaches is a
 * page answering a question the box cannot, and a missing topic is a question
 * nobody checked. Every verdict is held here to the worker's own `retrieve`
 * over the state's whole retrieval file.
 *
 * Every test is named `XX: …`, so `-t " XX: "` runs one state's and nothing else. Not
 * `^XX:`: vitest matches the whole name, describe block first, so an anchored
 * filter runs nothing and exits 0 -- a per-state check that is green on no test.
 */
const ROOT = process.cwd()
const coverage = readCoverage(ROOT)
const topics = topicsOf(ROOT)
const kindOf = (id: string): Verdict['from'] => (/-C-/.test(id) ? 'code' : /-S\d+$/.test(id) ? 'statute' : 'manual')
const BLOCKED = /^official site not fetchable: \S/

describe('which questions each state can answer, and from what', () => {
  // The states `/add-code all` has still to do: a note, not a failure, or this
  // would be red until the fifty-first state merged.
  it('lists the states with no coverage block yet', () => {
    const remaining = statesOf(ROOT).filter((code) => coverage[code] === undefined)
    if (remaining.length > 0) console.log(`no coverage block yet: ${remaining.join(' ')}`)
    expect(Object.keys(coverage).every((code) => statesOf(ROOT).includes(code))).toBe(true)
  })

  for (const code of [...new Set([...statesOf(ROOT), ...statesWithSources(ROOT)])].sort()) {
    const block = coverage[code]
    const started = block !== undefined || statesWithSources(ROOT).includes(code) || existsSync(path.join(ROOT, 'scripts/statutes/sites', `${code}.ts`))
    if (!started) continue

    it(`${code}: has a verdict for every topic, and a reason on every none`, () => {
      expect(block, `${code} has a site module or sources but no block in coverage.json`).toBeDefined()
      for (const topic of topics) {
        const verdict = block![topic.id]
        expect(verdict, `${code} has no verdict for ${topic.id}`).toBeDefined()
        if (verdict.from === 'none') expect(verdict.reason ?? '', `${code} ${topic.id} is none with no reason`).not.toBe('')
        else expect(verdict.law, `${code} ${topic.id} names no law`).toBeDefined()
      }
      expect(Object.keys(block!).filter((id) => !topics.some((topic) => topic.id === id))).toEqual([])
    })

    // Held to the pool the reranker reads (docs/plans/rerank.md): the reranker
    // cannot run offline, so whether a verdict's law reaches the model's three
    // is `npm run statutes:rerank -- XX`, run live in each state's PR.
    it(`${code}: every verdict names a law in the pool the box reranks for the topic's question`, () => {
      const laws = lawsOf(ROOT, code)
      for (const topic of topics) {
        const verdict = block?.[topic.id]
        if (verdict === undefined || verdict.from === 'none') continue
        expect(kindOf(verdict.law!), `${code} ${topic.id}: ${verdict.law} is not a ${verdict.from} law`).toBe(verdict.from)
        expect(laws.some((law) => law.id === verdict.law), `${code} ${topic.id}: ${verdict.law} is not in the retrieval file`).toBe(true)
        expect(
          retrieve(laws, topic.question, CANDIDATE_LAWS).map((law) => law.id),
          `${code} ${topic.id}: ${verdict.law} is not in the pool for "${topic.question}"`,
        ).toContain(verdict.law)
      }
    })

    it(`${code}: a state with its code fetched answers at least one topic, and a blocked one says why`, () => {
      const verdicts = Object.values(block ?? {})
      if (statesWithSources(ROOT).includes(code)) {
        // Every topic none with the code committed is a fetch that got the wrong title.
        expect(verdicts.some((verdict) => verdict.from === 'code' || verdict.from === 'manual')).toBe(true)
      } else {
        const blocked = verdicts.filter((verdict) => verdict.from === 'none' && BLOCKED.test(verdict.reason ?? ''))
        expect(blocked.length, `${code} has no sources and no "official site not fetchable" reason`).toBeGreaterThan(0)
      }
    })
  }
})

/**
 * The topics every state is compared on (docs/plans/nationwide.md): the files
 * a nationwide question is answered from, and the titles of the pages that
 * tabulate them. A topic file that dropped a state is a comparison that leaves
 * it out without saying so, and one carrying a law its state's file no longer
 * holds quotes a law nobody can find.
 */
describe('the topics every state is compared on', () => {
  // Guard 14: "<title> by State — Pass the Test" fits in seventy.
  it('gives every topic a title of at most 45 characters', () => {
    for (const topic of topics) {
      expect(topic.title, `${topic.id} has no title`).toBeTruthy()
      expect(topic.title.length, `${topic.id}: "${topic.title}" is ${topic.title.length} characters`).toBeLessThanOrEqual(45)
    }
  })

  // trusted-by-date guard 4: a family misspelt on one topic is a family of
  // one the chooser is never told about, so "hardest on drunk driving" reads
  // two topics and that one is never among them.
  it('gives every topic in a family a family the chooser is told about', () => {
    for (const topic of topics) {
      if (topic.family === undefined) continue
      expect(Object.keys(TOPIC_FAMILIES), `${topic.id}: family "${topic.family}"`).toContain(topic.family)
    }
  })

  // trusted-by-date AC1: what "hardest on drunk driving" is compared on.
  it('puts the two limits, the refusal, open containers and the six penalties in the drunk-driving family, and nothing else', () => {
    expect(topics.filter((topic) => topic.family === 'dui').map((topic) => topic.id).sort()).toEqual([
      'bac-adult',
      'bac-under-21',
      'dui-first-fine',
      'dui-first-jail',
      'dui-first-suspension',
      'dui-high-bac',
      'dui-interlock',
      'dui-lookback',
      'implied-consent',
      'open-container',
    ])
    for (const id of ['points-suspension', 'texting-fine']) expect(topics.some((topic) => topic.id === id), id).toBe(true)
  })

  // AC9.
  it('holds each topic’s file to exactly its verdict laws, in state order, each as its state publishes it', () => {
    const files = topicLaws(ROOT)
    // Once per state: a state's file is its whole code, read from hundreds of files.
    const published = new Map<string, AskLaw[]>()
    const publishedBy = (code: string) => {
      if (!published.has(code)) published.set(code, lawsOf(ROOT, code))
      return published.get(code)!
    }
    for (const topic of topics) {
      const states = Object.keys(coverage)
        .sort()
        .filter((code) => coverage[code][topic.id] !== undefined && coverage[code][topic.id].from !== 'none')
      if (states.length === 0) {
        expect(files.has(topic.id), `${topic.id} has no verdict law anywhere, so no file`).toBe(false)
        continue
      }
      const laws = files.get(topic.id) ?? []
      expect(laws.map((law) => law.state), `${topic.id}: the states`).toEqual(states)
      for (const { state, ...law } of laws) {
        expect(law.id, `${topic.id} ${state}`).toBe(coverage[state][topic.id].law)
        expect(law, `${topic.id} ${state}: as the state's file holds it`).toEqual(publishedBy(state).find((each) => each.id === law.id))
      }
    }
  })
})
