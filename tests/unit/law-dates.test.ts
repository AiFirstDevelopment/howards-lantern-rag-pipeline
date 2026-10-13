import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { statesOf } from '../../scripts/law-vectors'
import { MANUAL_SOURCES_FILE, codeChunksOf, handLawsOf, lawsOf, readCoverage, readSources, topicLawsFrom, topicsOf } from '../../scripts/statutes/laws'
import type { AskLaw } from '../../worker/src/law-retrieval'

/**
 * Every published law carries the date it was true as of
 * (docs/plans/trusted-by-date.md, decision 6), and the date is the fetch
 * record's, not the build's: a code law's is the day its section was fetched,
 * by the file it was cut from; a manual law's is the day its state's manual
 * was fetched. A build that stamped its own day on every law would put a
 * check nobody made under every answer and in every row of every comparison,
 * and look exactly right on the day it shipped.
 *
 * The expected dates are read here from the two fetch records directly --
 * each statute by its own `source`, each manual by its state -- rather than
 * off `lawsOf`.
 */
describe('the date each published law was true as of', () => {
  const root = process.cwd()
  const manuals = JSON.parse(readFileSync(path.join(root, MANUAL_SOURCES_FILE), 'utf8')) as Record<string, { retrieved?: string }>
  const published = new Map<string, AskLaw[]>()
  const lawsFor = (code: string) => {
    if (!published.has(code)) published.set(code, lawsOf(root, code))
    return published.get(code)!
  }
  const misdated = (laws: AskLaw[], expected: (law: AskLaw) => string | undefined) =>
    laws.flatMap((law) => (expected(law) !== undefined && law.asOf === expected(law) ? [] : [`${law.id}: ${law.asOf} (wanted ${expected(law)})`]))

  // Guard 7: a state with no manual record would be dated by nothing.
  it('has a manual fetch date for every state the manifest declares', () => {
    const undated = statesOf(root).filter((code) => !/^\d{4}-\d{2}-\d{2}$/.test(manuals[code]?.retrieved ?? ''))
    expect(undated).toEqual([])
  })

  for (const code of statesOf(root)) {
    // Guard 7.
    it(`${code}: dates every manual law by the day its manual was fetched`, () => {
      const wrong = misdated(lawsFor(code).filter((law) => law.kind !== 'statute'), () => manuals[code]?.retrieved)
      expect(wrong.slice(0, 5), `${wrong.length} misdated`).toEqual([])
    })

    // Guard 6.
    it(`${code}: dates every code law by the day its section was fetched`, () => {
      const fetched = readSources(root, code)?.files ?? {}
      const statuteDate = new Map(
        [...(handLawsOf(root, code) ?? []), ...codeChunksOf(root, code)].map((law) => [law.id, fetched[law.source]?.retrieved]),
      )
      const wrong = misdated(lawsFor(code).filter((law) => law.kind === 'statute'), (law) => statuteDate.get(law.id))
      expect(wrong.slice(0, 5), `${wrong.length} misdated`).toEqual([])
    })
  }

  it('carries each law’s date into the topic files, unchanged', () => {
    const topics = topicLawsFrom(topicsOf(root), readCoverage(root), lawsFor)
    for (const [topic, laws] of topics) {
      for (const law of laws) {
        expect(law.asOf, `${topic} ${law.id}`).toBe(lawsFor(law.state).find((each) => each.id === law.id)?.asOf)
        expect(law.asOf, `${topic} ${law.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})
