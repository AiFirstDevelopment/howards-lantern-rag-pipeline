import { isCodeChunk } from './code-chunks'
import type { AskLaw } from './law-retrieval'

/**
 * The meaning half of the ask box's retrieval (docs/plans/law-vectors.md).
 *
 * BM25 finds a law that shares the question's words. This finds one that
 * shares its meaning -- "can I leave my car right by a fireplug", or the same
 * question in Spanish against English law text, neither of which shares a word
 * with "You may not park within 15 feet of a fire hydrant". The two rankings
 * are merged in law-retrieval.ts; neither one decides alone.
 *
 * Only ids come back from here. The words of every law shown, and the
 * citation under it, are read from the published retrieval file by id and
 * checked exactly as before, so the index can rank badly but cannot put text
 * on screen.
 */

/** Multilingual, so a Spanish question lands near the English law that answers it. */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3'

/** The Vectorize index; one namespace per state, so a query cannot leave the chosen one. */
export const LAWS_INDEX = 'howard-laws'

/** How many neighbours a question asks for. */
export const NEAR_LAWS = 8

/**
 * Below this a neighbour is not a match, only the nearest thing there was.
 *
 * Set for recall, not precision. Measured on the live index on 2026-10-05: the
 * law that answers scored 0.56-0.79 -- "fireplug" 0.654, a school bus 0.776,
 * and Spanish against English as low as 0.564 ("¿puedo girar a la derecha con
 * la luz roja?" to Ohio's right-on-red law). The nearest law to an unrelated
 * question scored 0.36-0.58: "the speed limit on the moon" 0.575, "reset my
 * progress" 0.48, "the Super Bowl" 0.365. The bands overlap, and a cutoff of
 * 0.6 lost the Spanish law to keep the moon out. That is the wrong way round:
 * a law that does not answer the question costs a few tokens and is declined
 * by the model, with `checkLawAnswer` behind it; a law that does answer and is
 * cut here is a learner told their manual does not say.
 */
export const NEAR_ENOUGH = 0.5

/**
 * What is embedded for a law: its rule and the card's question, which is how a
 * learner would ask it -- and, for a chunk of a state's code, the heading of
 * the section it was cut from. Alaska's "(c) A person convicted under this
 * section … shall pay a mandatory fine of $500" sat at 0.504 from "what is the
 * fine if i cannot show proof of insurance", a hair over NEAR_ENOUGH and
 * below every law it was fused against; headed "Proof of insurance to be
 * exhibited on demand; penalty" it is 0.654, above the manual's own 0.614. A
 * state with no catchlines (Maryland) embeds exactly what it did.
 */
export function embeddingText(law: Pick<AskLaw, 'id' | 'law' | 'question' | 'concept'>): string {
  const heading = isCodeChunk(law.id) && law.concept !== '' ? `${law.concept}: ` : ''
  return `${heading}${law.law} ${law.question}`.trim()
}

export type NearLaws = (code: string, question: string) => Promise<string[]>

/** The deployed search: embed the question, then ask the state's namespace for its nearest laws. */
export function nearLawsFor(ai: Ai | undefined, index: VectorizeIndex | undefined): NearLaws | undefined {
  if (ai === undefined || index === undefined) return undefined
  return async (code, question) => {
    const embedded = (await ai.run(EMBEDDING_MODEL, { text: [question] })) as { data: number[][] }
    const found = await index.query(embedded.data[0], { topK: NEAR_LAWS, namespace: code })
    return found.matches.filter((match) => match.score >= NEAR_ENOUGH).map((match) => match.id)
  }
}
