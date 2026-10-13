import { describe, expect, it } from 'vitest'
import {
  CHIP_LANGS,
  checkStoredChip,
  chipPromptHash,
  chipTopics,
  corpusHash,
  givenFor,
  readChipAnswers,
  readChips,
  statesNamedIn,
  type ChipAnswer,
} from '../../scripts/chips'
import { topicLaws, topicsOf } from '../../scripts/statutes/laws'
import { checkLawAnswer, nationwideCitations, NATIONWIDE_ANSWER_CHARS, stateName } from '../../worker/src/learner-ask'

/**
 * The chips' stored answers (docs/plans/trusted-by-date.md, decision 16).
 *
 * Nobody reads them by hand before they are shown: a tap shows the stored
 * answer as if Opus had just written it, to a driver's-ed class as often as to
 * one learner. So each is held here to everything the live checker holds an
 * answer to, re-run offline on the laws the build publishes, and to the one
 * rule the live checker cannot apply -- every state the answer names is a state
 * whose law it cites. A chip that fails is the one a person looks at; the fix
 * is `npm run chips:build`, never an edit to the answer.
 */
const ROOT = process.cwd()
const chips = readChips(ROOT)
const topics = topicsOf(ROOT)
const laws = topicLaws(ROOT)
const context = { topics, topicLaws: laws }
const stored = readChipAnswers(ROOT).chips
const CORPUS_MOVED = /corpus that has since changed/

describe('the pool', () => {
  it('holds forty to sixty questions, each with English and Spanish text and a topic that exists', () => {
    expect(chips.length).toBeGreaterThanOrEqual(40)
    expect(chips.length).toBeLessThanOrEqual(60)
    expect(new Set(chips.map((chip) => chip.id)).size).toBe(chips.length)
    for (const chip of chips) {
      for (const lang of CHIP_LANGS) expect(chip.question[lang]?.trim() ?? '', `${chip.id} (${lang})`).not.toBe('')
      expect(() => chipTopics(chip, topics), chip.id).not.toThrow()
    }
  })

  // Three are drawn per page load; fewer stored in a language is a row that
  // is short for every Spanish visitor until somebody notices.
  it('has at least three stored answers in each language, so the box always has three to draw', () => {
    for (const lang of CHIP_LANGS) expect(stored.filter((answer) => answer.lang === lang).length, lang).toBeGreaterThanOrEqual(3)
  })

  it('stores each chip once per language, and nothing for a chip the pool no longer has', () => {
    const keys = stored.map((answer) => `${answer.id}/${answer.lang}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(stored.filter((answer) => !chips.some((chip) => chip.id === answer.id)).map((answer) => answer.id)).toEqual([])
  })
})

describe('every stored answer is one the box would show, and names no state it does not cite', () => {
  for (const answer of stored) {
    // AC19: verdict laws of its topics, every figure in a cited law, every
    // state named a cited state -- everything but the corpus hash, which the
    // next test holds so a stale corpus reads as that and nothing else.
    it(`${answer.id} (${answer.lang}): cites only its topics’ verdict laws, grounds every figure, and names only cited states`, () => {
      const chip = chips.find((each) => each.id === answer.id)
      expect(checkStoredChip(answer, chip, context).filter((problem) => !CORPUS_MOVED.test(problem))).toEqual([])
    })
  }

  // docs/plans/what-happens-if.md, guard 14. The checks above hold an answer
  // to its laws, not to how it is written: after the register change every
  // stored chip still passed them and still read like the box before it -- two
  // sentences of statute for a learner the live box now answers in plain
  // words. Red until `npm run chips:build -- --register` has asked them all
  // under the rules the box answers with today.
  it('was written under the rules the box answers with today', () => {
    expect(readChipAnswers(ROOT).promptHash, 'run npm run chips:build -- --register').toBe(chipPromptHash())
  })

  // Guard 19. A law reworded or re-dated under a stored answer leaves that
  // answer quoting words the box no longer publishes; red until rebuilt.
  it('was answered from the laws the build publishes for its topics today', () => {
    const stale = stored.filter((answer) => {
      const chip = chips.find((each) => each.id === answer.id)
      return chip === undefined || answer.corpus !== corpusHash(chipTopics(chip, topics), laws)
    })
    expect(stale.map((answer) => `${answer.id} (${answer.lang})`), 'run npm run chips:build').toEqual([])
  })
})

/**
 * The gap the live checker has and this one closes: a figure grounded on one
 * state's law beside a state named that nothing cited. Built from the real
 * corpus, so the fixture is the shape a stored answer actually takes.
 */
describe('a stored answer naming a state it does not cite', () => {
  const chip = chips.find((each) => each.id === 'bac-lowest')!
  const own = chipTopics(chip, topics)
  const given = givenFor(own, laws, topics)
  const utah = given.laws.find((law) => law.state === 'UT')!
  function fixture(answer: string, lang: 'en' | 'es' = 'en'): ChipAnswer {
    return {
      id: chip.id,
      lang,
      question: chip.question[lang],
      topics: own,
      corpus: corpusHash(own, laws),
      answer,
      sources: nationwideCitations([utah], given.laws),
      absent: given.absent.map(stateName),
      asOf: '2026-10-10',
      model: 'claude-opus-5-5',
    }
  }

  // Guard 18. The Nebraska that got through once, in Spanish.
  it('is refused for naming Nebraska beside Utah’s law alone, though the live checker would show it', () => {
    const answer = fixture('Utah has the lowest limit at 0.05, and Nebraska is the next strictest.')
    const live = checkLawAnswer(
      { kind: 'reply', scope: 'road-law', answer: answer.answer, sources: [utah.id], model: answer.model },
      'en',
      given.laws,
      given.laws,
      answer.question,
      { counts: given.counts, maxChars: NATIONWIDE_ANSWER_CHARS },
    )
    expect(live.ok, 'the live checker cannot see an uncited state').toBe(true)
    expect(checkStoredChip(answer, chip, context)).toEqual(['names Nebraska, whose law it does not cite'])
  })

  it('reads a state named in Spanish, and passes the same answer naming only the state it cites', () => {
    expect(checkStoredChip(fixture('Utah tiene el límite más bajo, 0.05, y Nueva York lo sigue.', 'es'), chip, context)).toEqual([
      'names New York, whose law it does not cite',
    ])
    expect(checkStoredChip(fixture('Utah has the lowest limit for adult drivers, at 0.05.'), chip, context)).toEqual([])
  })

  it('tells West Virginia from Virginia, Arkansas from Kansas, and the District from Washington', () => {
    expect(statesNamedIn('West Virginia and Arkansas')).toEqual(['AR', 'WV'])
    expect(statesNamedIn('Virginia, Kansas and Washington')).toEqual(['KS', 'VA', 'WA'])
    expect(statesNamedIn('Washington, D.C. and Carolina del Norte')).toEqual(['DC', 'NC'])
  })
})
