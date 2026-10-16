/**
 * The laws the model is given, chosen by a reranker from a wider pool
 * (docs/plans/rerank.md): Claude Haiku first, the cross-encoder behind it.
 *
 * Retrieval -- BM25 fused with the meaning index -- ranks by how a law is
 * worded, and a manual law written as a plain sentence beside a question
 * outranks the code's text for a plain question whether or not it answers it:
 * of eleven rules the first states' codes hold and retrieval missed, it reached
 * two. A reranker reads the question and the laws together and judges which
 * answer it, so the pool is widened and the reranker picks.
 *
 * Absent or failing, the model gets what retrieval gave it before the reranker
 * existed -- the first RETRIEVED_LAWS, retrieved as they were -- because a box that
 * answers from today's eight beats one that answers nothing.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { AskLaw } from './law-retrieval'
import { embeddingText } from './law-vectors'
import { Meter, carryingUsage, usageCarried, usageOf, type Usage } from './usage'

export const RERANK_MODEL = '@cf/baai/bge-reranker-base'

/**
 * The reranker the box asks first: a model that reads the question and every
 * candidate law and says which answer it. The cross-encoder above scores each
 * law against the question alone, by likeness, and likeness is how it gave
 * Nevada's side-window tint question the windshield strip, Pennsylvania's
 * early licence question the automatic one at 18, and California's adult
 * blood-alcohol question three under-21 limits.
 */
export const HAIKU_RERANK_MODEL = 'claude-haiku-4-5-20251001'

/**
 * How long the box waits for Haiku before the cross-encoder answers instead,
 * with no retry: the rerank runs before every question with a state, and the
 * SDK's own default -- ten minutes, retried twice -- would hold a learner's
 * question that long on a hung call.
 */
const HAIKU_TIMEOUT_MS = 5000

/** How many laws Haiku names, best first. The rest are unranked: they score -Infinity and keep their place in the pool. */
const HAIKU_RANKS = 5

/** How many retrieved laws the reranker reads. */
export const CANDIDATE_LAWS = 24

/**
 * How many when the question was also searched in the law's words
 * (law-rephrase.ts). Fusing a search's rankings beside the question's own
 * moves laws out of the pool as well as in: reciprocal-rank fusion rewards a
 * law that is mediocre in every ranking over one that is first in the
 * question's alone. By words alone, Pennsylvania's move-over law is in the 24
 * for its topic question and out of them once two searches are fused, and
 * so are Nevada's, New York's and Ohio's and Texas's implied-consent law --
 * all within 32 -- while California's implied-consent and pass-on-right laws
 * are out at 32 too. The box would have refused questions the question alone
 * answered. The live-index count is in the PR that introduced this (#767).
 */
export const SEARCHED_CANDIDATE_LAWS = 32

/** The pool for a question: wider when searches were fused into it. */
export function poolSize(searches: readonly unknown[]): number {
  return searches.length > 0 ? SEARCHED_CANDIDATE_LAWS : CANDIDATE_LAWS
}

/**
 * How many it gives the model. No score floor: a Spanish question against the
 * English hydrant rule scored 0.065 where the English question scored 0.516,
 * still first, and a floor that suited English would cut the Spanish answer.
 */
export const ANSWER_LAWS = 3

/**
 * A score for each text, in the order given, and what the call spent where it
 * went to a model (the cross-encoder on Workers AI reports none): the eval
 * lifecycle's cost per question counts the reranker too (usage.ts).
 */
export type Scores = number[] & { usage?: Usage }
export type Rerank = (question: string, texts: string[]) => Promise<Scores>

/** The deployed reranker, through the worker's Workers AI binding. */
export function rerankFor(ai: Ai | undefined): Rerank | undefined {
  if (ai === undefined) return undefined
  const run = ai.run.bind(ai) as unknown as (model: string, input: unknown) => Promise<unknown>
  return async (question, texts) => {
    const result = (await run(RERANK_MODEL, {
      query: question,
      contexts: texts.map((text) => ({ text })),
      top_k: texts.length,
    })) as { response: { id: number; score: number }[] }
    const scores = texts.map(() => Number.NEGATIVE_INFINITY)
    for (const { id, score } of result.response) scores[id] = score
    return scores
  }
}

const HAIKU_RULES = `You choose which laws answer a learner driver's question.
You are given the question and a numbered list of laws from one state's driver manual and vehicle code.
Return the numbers of the laws that answer the question, best first, at most ${HAIKU_RANKS}.
A law that states the rule, figure or penalty asked about ranks above one that only names the subject.
Match the situation asked about: an adult's limit is not an under-21 limit, a side window is not a windshield, a first offence is not a second.
Return an empty list if none answers it.`

const HAIKU_SCHEMA = {
  type: 'object',
  properties: { ranked: { type: 'array', items: { type: 'integer' } } },
  required: ['ranked'],
  additionalProperties: false,
} as const

/** The part of the Anthropic client the reranker calls; a test passes its own. */
export type HaikuClient = Pick<Anthropic, 'messages'>

/**
 * Haiku as a `Rerank`: the laws it names score from HAIKU_RANKS down, in its
 * order; every other law is unranked, -Infinity, and keeps its place in the
 * pool. Throws on anything it cannot read, so the caller falls back.
 */
export function haikuRerankFor(apiKey: string | undefined, client?: HaikuClient): Rerank | undefined {
  if (client === undefined && (apiKey === undefined || apiKey.length === 0)) return undefined
  const anthropic = client ?? new Anthropic({ apiKey, timeout: HAIKU_TIMEOUT_MS, maxRetries: 0 })
  return async (question, texts) => {
    const listed = texts.map((text, index) => `[${index}] ${text}`).join('\n\n')
    const response = await anthropic.messages.create({
      model: HAIKU_RERANK_MODEL,
      max_tokens: 256,
      system: HAIKU_RULES,
      output_config: { format: { type: 'json_schema', schema: HAIKU_SCHEMA } },
      messages: [{ role: 'user', content: `Question: ${question}\n\nLaws:\n\n${listed}` }],
    })
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('')
    let ranked: unknown
    try {
      ranked = (JSON.parse(text) as { ranked?: unknown }).ranked
      if (!Array.isArray(ranked) || ranked.some((id) => !Number.isInteger(id) || id < 0 || id >= texts.length)) {
        throw new Error(`the reranker named laws that were not given: ${text}`)
      }
    } catch (error) {
      throw carryingUsage(error, response)
    }
    const scores: Scores = texts.map(() => Number.NEGATIVE_INFINITY)
    scores.usage = usageOf(response)
    ;[...new Set(ranked as number[])].slice(0, HAIKU_RANKS).forEach((id, position) => (scores[id] = HAIKU_RANKS - position))
    return scores
  }
}

/** The first reranker that answers: Haiku, then the cross-encoder; the caller falls back past both. */
export function firstOf(...rerankers: (Rerank | undefined)[]): Rerank | undefined {
  const present = rerankers.filter((rerank): rerank is Rerank => rerank !== undefined)
  if (present.length === 0) return undefined
  return async (question, texts) => {
    let last: unknown
    // What a reranker that failed still spent goes with the answer of the one
    // that did not: Haiku naming a law it was not given was billed, and the
    // cross-encoder after it reports nothing.
    const spent = new Meter()
    for (const rerank of present) {
      try {
        const scores = await rerank(question, texts)
        if (spent.input + spent.output === 0) return scores
        spent.add(scores.usage)
        return Object.assign(scores, { usage: spent.usage })
      } catch (error) {
        console.error('learner ask: a reranker did not answer', error)
        spent.add(usageCarried(error))
        last = error
      }
    }
    throw spent.input + spent.output === 0 ? last : Object.assign(last as object, { usage: spent.usage })
  }
}

/**
 * The laws the model answers from: the reranker's best ANSWER_LAWS of the
 * pool -- with the cross-encoder, the manual's best among them -- or, with no reranker or a
 * failing one, `fallback`: what retrieval gave before the reranker existed.
 *
 * `fallback` is its own retrieval rather than the pool's first eight, because
 * the two differ: `retrieve` fuses BM25 over twice its limit with the meaning
 * index, so a 24-law pool reaches BM25 ranks an 8-law retrieval never did, and
 * its first eight are other laws (175 of 175 topic questions, with the index).
 *
 * The manual's best is kept because the manual stays first for what it states
 * (docs/plans/vehicle-code.md). Left to itself the reranker gave Maryland's
 * adult blood-alcohol question three code subsections about repeat offenders
 * and drivers under 21, and dropped the manual's ".08 or higher" -- the one
 * law that answered. So when the three hold no manual law and the pool does,
 * the manual law the reranker scored highest takes the third place.
 */
export async function chooseLaws(
  pool: AskLaw[],
  fallback: AskLaw[],
  question: string,
  rerank?: Rerank,
): Promise<AskLaw[]> {
  if (rerank === undefined || pool.length === 0) return fallback
  try {
    const scores = await rerank(question, pool.map(embeddingText))
    if (scores.length !== pool.length) throw new Error(`${scores.length} scores for ${pool.length} laws`)
    const ranked = pool.map((law, index) => ({ law, score: scores[index] })).sort((a, b) => b.score - a.score)
    // A row of the state's own page the reranker puts among its first is
    // given beside the three, never in place of one (docs/plans/what-happens-
    // if.md, phase 3): Maryland's "how much is the ticket if I'm driving
    // without my license" named the ticket family, the court's "take one of
    // four actions within 30 days" took a place, § 16-112 lost its own, and
    // with it went the schedule's $50 -- the box answered nothing (eval,
    // 2026-10-11). A pool with no page rows is chosen exactly as before.
    const page = (law: AskLaw) => law.kind === 'process'
    const pages = ranked.slice(0, ANSWER_LAWS).filter(({ law }) => page(law)).map(({ law }) => law)
    const chosen = ranked.filter(({ law }) => !page(law)).slice(0, ANSWER_LAWS).map(({ law }) => law)
    const first = pool.find((law) => !page(law))
    // Retrieval's own first choice keeps a place. Left to itself the reranker
    // gave California's adult blood-alcohol question three under-21 limits and
    // dropped the 0.08% law retrieval ranked first. Measured over nine states'
    // 280 verdicts: 80% reach the model without this, 86% with it, and the
    // reranker's reach on rules only the code states (6 of 11) is unchanged.
    //
    // Both protections cover the cross-encoder's misses, and stand only for
    // it -- a reranker that scores every law. Haiku names the laws that answer
    // and leaves the rest out (-Infinity); putting retrieval's first or the
    // manual's best back over its third choice undid the choice, and Nevada's
    // side-window tint answer lost § 484D.440(3)(a) to it.
    if (scores.every(Number.isFinite)) {
      if (first !== undefined && !chosen.some((law) => law.id === first.id)) chosen[chosen.length - 1] = first
      // The manual is a law with no kind: a state's own page (`process`) is
      // not the manual, and counted as one it would hold the place the
      // manual's own rule was kept for.
      const manual = ranked.find(({ law }) => law.kind === undefined)?.law
      if (manual !== undefined && !chosen.some((law) => law.kind === undefined)) chosen[chosen.length - 1] = manual
    }
    return [...chosen, ...pages]
  } catch (error) {
    console.error('learner ask: the reranker did not answer', error)
    return fallback
  }
}
