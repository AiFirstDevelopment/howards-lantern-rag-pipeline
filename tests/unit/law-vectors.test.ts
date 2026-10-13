import { describe, expect, it } from 'vitest'
import { batches, fingerprint, lawsOf, readManifest, statesOf } from '../../scripts/law-vectors'
import { EMBEDDING_MODEL, LAWS_INDEX, embeddingText } from '../../worker/src/law-vectors'

/**
 * The vector index is filled from the corpus by hand (`npm run laws:embed --
 * --push`), so it can fall behind it silently: a law reworded, a statute
 * added, a state published, and the index ranks what it was given last time.
 * The text shown is never stale -- the worker reads it from the published file
 * by id -- but the ranking would be, and nothing on screen would say so. This
 * is where that becomes red: every published state's laws must hash to what
 * the manifest says was embedded (docs/plans/law-vectors.md).
 */
describe('the law index', () => {
  const root = process.cwd()
  const manifest = readManifest(root)

  it('was filled with the model and the index the worker queries', () => {
    expect(manifest.model).toBe(EMBEDDING_MODEL)
    expect(manifest.index).toBe(LAWS_INDEX)
  })

  for (const code of statesOf(root)) {
    it(`${code}: holds the laws Pages publishes, as they are now (else run npm run laws:embed -- --push ${code})`, () => {
      const laws = lawsOf(root, code)
      expect(manifest.states[code]?.sha256).toBe(fingerprint(laws))
      expect(manifest.states[code]?.laws).toBe(laws.length)
    })
  }
})

/**
 * A subsection cut from its section is embedded with the section's heading,
 * or the index cannot find "(c) … a mandatory fine of $500" for a question
 * about the fine for no proof of insurance: the subsection never says what it
 * is the fine for (docs/plans/vehicle-code.md).
 */
describe('what is embedded for a law', () => {
  const chunk = { id: 'AK-C-28.22.019-c', law: '(c) … a mandatory fine of $500.', question: '', concept: 'Proof of insurance to be exhibited on demand; penalty' }

  it('heads a code chunk with the section it was cut from', () => {
    expect(embeddingText(chunk)).toBe('Proof of insurance to be exhibited on demand; penalty: (c) … a mandatory fine of $500.')
  })

  it('embeds a manual law and a hand-written law as before, with no topic slug', () => {
    expect(embeddingText({ ...chunk, id: 'MD-S01', concept: 'park-hydrant' })).toBe('(c) … a mandatory fine of $500.')
    expect(embeddingText({ id: 'FL-399', law: 'Rule.', question: 'Question?', concept: 'parking' })).toBe('Rule. Question?')
  })
})

/**
 * bge-m3 refuses a request over 60,000 tokens, counting every text padded to
 * the longest in the request. A hundred of Alabama's code subsections were
 * refused at 68,400 -- a hundred texts padded to one of 684 tokens -- and the
 * push died with nothing written to the manifest. Batches are cut by that
 * padded size as well as by count, and lose and reorder nothing.
 */
describe('cutting the laws into embedding requests', () => {
  const law = (n: number, size: number) => ({ id: `XX-C-${n}`, law: 'x'.repeat(size), question: '', concept: '', citation: null })

  it('keeps every request under the model’s size and Vectorize’s count, losing and reordering nothing', () => {
    // One long subsection among short ones: summed, the batch fits; padded to it, it does not.
    const laws = [law(0, 2000), ...Array.from({ length: 300 }, (_, n) => law(1 + n, 300))]
    const cut = batches(laws)
    for (const batch of cut) {
      expect(batch.length).toBeLessThanOrEqual(100)
      expect(batch.length * Math.max(...batch.map((each) => each.law.length))).toBeLessThanOrEqual(60_000)
    }
    expect(cut.flat().map((each) => each.id)).toEqual(laws.map((each) => each.id))
  })
})
