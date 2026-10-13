/**
 * The register verdict (docs/plans/what-happens-if.md, decision 6): whether a
 * shown answer reads the way a sixteen-year-old wants one -- a couple of
 * sentences, boiled down, with no law's number in them. The eval
 * (scripts/learner-ask-eval.ts) scores every case by it beside scope,
 * contains and cites, and a miss is a miss.
 *
 * Its own module because the eval runs its `main` on import, and this is the
 * one part of it a unit test has to reach (tests/unit/answer-register.test.ts): a
 * counter that miscounted "¿Qué pasa? Pagas $50." would pass a four-sentence
 * answer or fail a two-sentence one in Spanish, and only a fixture sees that.
 */

/**
 * A question of the consequence shape: what happens, what if, will I, do I
 * have to, how much -- and the same in Spanish. These may take three
 * sentences, because what the officer does, what it costs and the way out are
 * three things; every other question takes two.
 */
export function consequenceShaped(question: string): boolean {
  return /\b(what happens|what if|will i|do i have to|how much)\b|qu[eé] (pasa|sucede|me pasa)|\by si\b|\bme van a\b|\btengo que\b|\bcu[aá]nto\b/i.test(question)
}

/**
 * The sentences a text holds. A sentence ends at a full stop, a question mark
 * or an exclamation mark followed by a space and a capital, or at the end of
 * the text: "5 a.m. and" and "0.08" are not two sentences, and the Spanish
 * question "¿Qué pasa?" is one even though it holds no full stop. Nor is an
 * initialism before a name: North Dakota's helmet answer, "a helmet that
 * meets U.S. Department of Transportation standards", was two sentences
 * counted as three, and five right answers in six missed the register (#799).
 */
export function sentencesIn(text: string): number {
  return sentencesOf(text).length
}

function sentencesOf(text: string): string[] {
  return text
    .trim()
    .split(/(?<!\b(?:\p{Lu}\.){2,})(?<=[.!?])["”’)]?\s+(?=["“¿¡(]?[\p{Lu}\d$])/u)
    .filter((sentence) => /\p{L}/u.test(sentence))
}

/**
 * The longest a sentence may run, in words. Joel's high-beam answer
 * (2026-10-11) was two sentences, inside the count, and its first ran 36
 * words with two figures joined by "and Maryland law also says": "way too
 * detailed and verbose. This is for teenagers." The prompt asks for under
 * about 20; 28 is where a sentence is a miss, so a right answer of 22 words
 * is not refused by a counter stricter than the rule it checks.
 */
export const MAX_SENTENCE_WORDS = 28

/** The words in the longest sentence: a word is a run without spaces holding a letter or a digit, so "$60" counts and "—" does not. */
export function longestSentenceWords(text: string): number {
  return Math.max(0, ...sentencesOf(text).map((sentence) => sentence.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word)).length))
}

/**
 * A law's name or number written into the sentences, which the app already
 * shows under them: "§ 16-112", "p.30", "page 30", "Section 521.025",
 * "subsection (d)", or a bare section number of the shapes the codes use
 * (16-112, 521.025, 322.15, 484B.450). A figure is not one: "0.08" has one digit before
 * its point, "$12.50" and "$25-$99" are money, and "11:00 p.m." and
 * "25-100 dollars" are a time and a range (verifier, 2026-10-10).
 */
export function namesALaw(text: string): boolean {
  return (
    /§|\bp\.\s?\d|\bpages?\b|\bp[aá]gina\b|\b(sub)?sections?\s+\(?\d|\bsubsection\b|\b(art[ií]culo|secci[oó]n)\s+\d/i.test(text) ||
    /(?<![$\d.,])\b\d{2,}[A-Z]{0,2}[.:-]\d+(?![\d.]*\s*(?:[ap]\.?m\b|dollars?|days?|feet|miles?|mph|hours?|years?|months?|percent|points?|d[oó]lares|d[ií]as|pies|horas|a[nñ]os))/i.test(text)
  )
}

/** The scopes whose shown answer the register applies to: a road-law answer, and the one honest sentence of an out-of-scope consequence question. */
const REGISTERED = new Set(['road-law', 'other'])

/** A nationwide comparison names states and their figures, and NATIONWIDE_RULE allows it five sentences. */
export const NATIONWIDE_SENTENCES = 5

/**
 * What is wrong with a shown answer's register, or nothing. An answer that
 * was not shown has no register to judge: the eval scores it as refused.
 */
export function registerMisses(found: { question: string; scope: string; shown: string; nationwide?: boolean }): string[] {
  if (found.shown.trim() === '' || !REGISTERED.has(found.scope)) return []
  const out: string[] = []
  const most =
    found.scope === 'other' ? 1 : found.nationwide === true ? NATIONWIDE_SENTENCES : consequenceShaped(found.question) ? 3 : 2
  const count = sentencesIn(found.shown)
  if (count > most) out.push(`register: ${count} sentences, at most ${most}`)
  const longest = longestSentenceWords(found.shown)
  if (longest > MAX_SENTENCE_WORDS) out.push(`register: a sentence of ${longest} words, at most ${MAX_SENTENCE_WORDS}`)
  if (namesALaw(found.shown)) out.push('register: names a law or page in the sentences')
  return out
}
