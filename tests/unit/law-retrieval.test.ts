import { describe, expect, it } from 'vitest'
import { CANDIDATE_LAWS } from '../../worker/src/law-rerank'
import { retrieve } from '../../worker/src/law-retrieval'
import { lawsOf } from '../../scripts/statutes/laws'

/**
 * Texas, as published: for "what is the highest posted speed limit", BM25
 * puts the laws that contain the words "posted speed limit" on top -- golf
 * carts, scooters -- and § 545.353(h-2), the 85 mph limit, 44th, outside the
 * 24-law pool. Searched for as the statute puts it, by words alone, it is in
 * the pool. The search is what the rephraser (law-rephrase.ts) gives; here
 * it is written by hand, so this holds the fusion and not the model.
 */
describe('retrieval with the question said again in the law’s words', () => {
  const laws = lawsOf(process.cwd(), 'TX')
  const question = 'what is the highest posted speed limit'
  const target = 'TX-C-545.353-h-2'

  it('reaches a law the learner’s own words miss', () => {
    expect(laws.find((law) => law.id === target)?.law).toContain('85 miles per hour')
    expect(retrieve(laws, question, CANDIDATE_LAWS).map((law) => law.id), 'the premise: the question alone misses it').not.toContain(target)
    expect(retrieve(laws, question, CANDIDATE_LAWS, [], [{ search: 'maximum speed limit highway', near: [] }]).map((law) => law.id)).toContain(target)
  })

  it('takes what the index found for the search as a ranking of its own', () => {
    const seventy = 'TX-C-545.352-b-2'
    expect(retrieve(laws, question, CANDIDATE_LAWS, [], [{ search: 'maximum speed limit highway', near: [] }]).map((law) => law.id), 'the premise: the words alone miss it').not.toContain(seventy)
    expect(retrieve(laws, question, CANDIDATE_LAWS, [], [{ search: 'maximum speed limit highway', near: [seventy] }]).map((law) => law.id)).toContain(seventy)
  })

  it('runs on the question alone when there are no searches, exactly as before', () => {
    expect(retrieve(laws, question, CANDIDATE_LAWS, [], [])).toEqual(retrieve(laws, question, CANDIDATE_LAWS))
  })
})

/**
 * BM25 indexes a laws array once and keeps the index by the array (the box
 * retrieves over one array several times a question). The index must belong to
 * that array alone: read for another state's laws, or for the same state's
 * laws less one, it would score laws by another document's counts and map a
 * score to the wrong law.
 */
describe('the index BM25 keeps per laws array', () => {
  const laws = lawsOf(process.cwd(), 'TX')
  const question = 'how far from a fire hydrant can i park'

  it('gives the same ranking the second time over the same array as the first', () => {
    const first = retrieve(laws, question, CANDIDATE_LAWS).map((law) => law.id)
    expect(retrieve(laws, question, CANDIDATE_LAWS).map((law) => law.id)).toEqual(first)
  })

  it('never reads one array’s index for another: the next state’s laws rank by their own words', () => {
    expect(retrieve(laws, question, CANDIDATE_LAWS)[0].law).toMatch(/hydrant/i)
    // Scored by Texas's counts and mapped onto California's array, the first
    // law would be whichever Californian law sits at the Texan hydrant law's
    // index -- a law about something else entirely.
    const california = lawsOf(process.cwd(), 'CA')
    const [first] = retrieve(california, question, CANDIDATE_LAWS)
    expect(first.id.startsWith('CA-')).toBe(true)
    expect(first.law, 'scored by California’s own counts, not Texas’s').toMatch(/hydrant/i)
  })
})
