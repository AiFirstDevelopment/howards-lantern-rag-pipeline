import { describe, expect, it } from 'vitest'
import { MAX_SENTENCE_WORDS, consequenceShaped, longestSentenceWords, namesALaw, registerMisses, sentencesIn } from '../../scripts/answer-register'

/**
 * The register verdict the eval scores every shown answer by
 * (docs/plans/what-happens-if.md, decision 6, guards 5 and 6). The eval runs
 * the live model and is read by hand, so a counter that drifted -- counting
 * only full stops, or giving every question the consequence shape's third
 * sentence -- would turn a whole run's register column green over answers a
 * sixteen-year-old would not read. These fixtures are where that goes red.
 */
describe('the register an answer is held to', () => {
  const hydrant = 'how far from a fire hydrant can i park'
  const noLicense = "what happens if I get pulled over and I don't have my license with me?"

  it('passes a two-sentence road-law answer with its figure and no law number in it', () => {
    const shown = 'You can get a ticket with a fine of up to $200. If you bring your valid license to court, the charge is dropped.'
    expect(sentencesIn(shown)).toBe(2)
    expect(registerMisses({ question: hydrant, scope: 'road-law', shown })).toEqual([])
  })

  it('fails a four-sentence answer, even to a question of the consequence shape', () => {
    const shown = 'The officer writes you a ticket. The fine is up to $200. You may have to go to court. Bring your license and it is dropped.'
    expect(sentencesIn(shown)).toBe(4)
    expect(registerMisses({ question: noLicense, scope: 'road-law', shown })).toEqual(['register: 4 sentences, at most 3'])
  })

  it('fails an answer that writes the section the app already shows under it', () => {
    expect(registerMisses({ question: hydrant, scope: 'road-law', shown: 'Under § 21-1003(m) you may not park within 15 feet.' })).toEqual([
      'register: names a law or page in the sentences',
    ])
    for (const named of ['Section 521.025 says you must carry it.', 'See page 30 of the manual.', 'It is in p.30.', 'Under 16-112 you must carry it.', 'Fla. Stat. 322.15 requires it.']) {
      expect(namesALaw(named), named).toBe(true)
    }
  })

  // A blood alcohol limit, a fine with cents, a fine range and a time of day
  // are figures, and an answer that states them is the answer the box wants.
  it('does not read a figure as a section number', () => {
    for (const figure of ['A limit of 0.08 applies.', 'The fine is $12.50.', 'A fine of $25-$99.', 'Not between midnight and 5 a.m. on any day.', 'A 16-year-old may drive.', 'Not between 12:01 a.m. and 5 a.m.', 'Home by 11:00 p.m.', 'A fine of 25-100 dollars.']) {
      expect(namesALaw(figure), figure).toBe(false)
    }
  })

  // Guard 5's mutation: a counter that counts only full stops reads this as
  // one sentence, and a Spanish answer of three questions and a statement
  // passes a two-sentence limit.
  it('counts a Spanish question as a sentence though it holds no full stop', () => {
    expect(sentencesIn('¿Qué pasa? Pagas $50.')).toBe(2)
    expect(sentencesIn('¡Cuidado! ¿Lo llevas? Debes llevarla. Siempre.')).toBe(4)
  })

  // #799: "U.S. Department of Transportation" split North Dakota's two-sentence
  // helmet answer into three, and a right answer missed the register.
  it('does not split a sentence at an initialism before a name', () => {
    expect(sentencesIn('Yes. Anyone under 18 must wear a helmet that meets U.S. Department of Transportation standards.')).toBe(2)
    expect(sentencesIn('It is the law in the U.S. and it applies to you. Wear one.')).toBe(2)
  })

  it('does not split a sentence at a time of day or a decimal', () => {
    expect(sentencesIn('You may not drive between 12 midnight and 5 a.m. unless an adult over 21 is with you.')).toBe(1)
    expect(sentencesIn('Under 21, a level of 0.02 or higher costs you your license.')).toBe(1)
  })

  // Guard 6: the third sentence is the consequence shape's alone.
  it('allows three sentences for what happens, and holds every other question to two', () => {
    const three = 'The officer writes you a ticket. The fine is up to $200. Bring your license to court and it is dropped.'
    expect(consequenceShaped(noLicense)).toBe(true)
    expect(consequenceShaped('¿qué pasa si me paran sin licencia?')).toBe(true)
    expect(consequenceShaped(hydrant)).toBe(false)
    expect(registerMisses({ question: noLicense, scope: 'road-law', shown: three })).toEqual([])
    expect(registerMisses({ question: hydrant, scope: 'road-law', shown: three })).toEqual(['register: 3 sentences, at most 2'])
  })

  it('gives a nationwide comparison its five sentences, and still no section number', () => {
    const five = 'Nevada is farthest at 20 feet. Most states set 15 feet. New Jersey sets 10 feet. Vermont sets 6 feet. Iowa sets 5 feet.'
    expect(registerMisses({ question: 'which state is farthest from a hydrant', scope: 'road-law', shown: five, nationwide: true })).toEqual([])
    expect(registerMisses({ question: 'which state is farthest from a hydrant', scope: 'road-law', shown: `${five} Utah sets 20 feet.`, nationwide: true })).toEqual([
      'register: 6 sentences, at most 5',
    ])
    expect(registerMisses({ question: 'which state', scope: 'road-law', shown: 'Nevada, under NRS 484B.450, is farthest.', nationwide: true })).toEqual([
      'register: names a law or page in the sentences',
    ])
  })

  // Joel's high-beam answer, 2026-10-11: two sentences, so inside the count,
  // and still "way too detailed and verbose" -- its first sentence carried
  // both distances joined by "and Maryland law also says", 36 words long.
  it('fails an answer whose sentence runs past 28 words, though it has only two sentences', () => {
    const highBeams =
      'You must switch to low beams at least 500 feet before you reach a car coming toward you, and Maryland law also says you can’t use high beams when you’re within 300 feet behind another car. If an officer stops you for either one, you get a $60 ticket that you can pay without going to court, with no points.'
    expect(sentencesIn(highBeams)).toBe(2)
    expect(longestSentenceWords(highBeams)).toBe(36)
    expect(registerMisses({ question: 'How can I get into trouble using my highbeams?', scope: 'road-law', shown: highBeams })).toEqual([
      `register: a sentence of 36 words, at most ${MAX_SENTENCE_WORDS}`,
    ])
  })

  it('passes the high-beam answer as it should have read, and a sentence of exactly 28 words', () => {
    const short = 'Dim your high beams within 500 feet of an oncoming car, or 300 feet behind one. Otherwise it’s a $60 ticket, no points, no court.'
    expect(longestSentenceWords(short)).toBe(16)
    expect(registerMisses({ question: 'How can I get into trouble using my highbeams?', scope: 'road-law', shown: short })).toEqual([])
    const twentyEight = `${Array.from({ length: 27 }, () => 'word').join(' ')} end.`
    expect(longestSentenceWords(twentyEight)).toBe(28)
    expect(registerMisses({ question: 'how far from a fire hydrant can i park', scope: 'road-law', shown: twentyEight })).toEqual([])
    expect(registerMisses({ question: 'how far from a fire hydrant can i park', scope: 'road-law', shown: `One ${twentyEight}` })).toEqual([
      'register: a sentence of 29 words, at most 28',
    ])
  })

  // A dash between clauses is not a word, and a figure is: "$60" is the
  // thing a learner reads, and a counter that skipped it would pass a
  // sentence heavier with figures than its count says.
  it('counts a figure as a word and a lone dash as none', () => {
    expect(longestSentenceWords('It costs $60 — no points.')).toBe(5)
    expect(longestSentenceWords('¿Qué pasa? Te ponen una multa de $50, sin puntos.')).toBe(8)
  })

  it('holds an out-of-scope consequence question to one sentence, and judges nothing that was not shown', () => {
    expect(registerMisses({ question: 'will my parents find out', scope: 'other', shown: 'The court mails notices to the address on your license.' })).toEqual([])
    expect(registerMisses({ question: 'will my parents find out', scope: 'other', shown: 'Maybe. The court mails notices.' })).toEqual(['register: 2 sentences, at most 1'])
    expect(registerMisses({ question: hydrant, scope: 'road-law', shown: '' })).toEqual([])
    expect(registerMisses({ question: 'is it free', scope: 'app', shown: 'One. Two. Three. Four.' })).toEqual([])
  })
})
