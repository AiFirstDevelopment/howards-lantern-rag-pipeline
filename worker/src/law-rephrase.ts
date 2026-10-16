/**
 * The learner's question, said again in the words the law uses, so that
 * retrieval can find the law.
 *
 * Retrieval ranks by words (BM25) and by meaning (the vector index), and both
 * answer in the learner's vocabulary. For "what is the highest posted speed
 * limit", both put the laws that *contain* "posted speed limit" on top -- the
 * golf-cart and scooter rules -- and Texas's 70, 75 and 85 mph laws ranked
 * 25th, 45th and 46th, outside the pool the reranker reads. Reworded as the
 * statute puts it, "maximum speed limit on a highway in miles per hour", the
 * same laws ranked 1st, 2nd and 4th. So before retrieving, Haiku is asked for
 * one or two searches in the code's own words, and retrieval runs on all of
 * them (law-retrieval.ts). Absent or failing, retrieval runs on the question
 * alone, exactly as before.
 *
 * A question of the consequence shape -- "what happens if I'm pulled over
 * without my license" -- gets one search for the duty and one for its penalty
 * or defence (docs/plans/what-happens-if.md, decision 5): in Texas the pool
 * for that question held § 521.457, a different offence, and manual entries,
 * and no subsection of § 521.025, so there was no section to make whole.
 *
 * And it names the family of process question it reads, if any (phase 3,
 * decision 16): "how soon can I retake the test" is answered by the licensing
 * agency's own page, whose words are rarely the learner's ("retake" against
 * a page that says "re-examination" or "waiting period"), so the family's
 * rows for the state are added to the pool by that name, not left to a
 * search to find.
 */
import Anthropic from '@anthropic-ai/sdk'
import { PROCESS_FAMILIES, isProcessFamily, type ProcessFamily } from './process-families'
import { carryingUsage, usageOf, type Usage } from './usage'

/**
 * The rephraser's model, and the eval judge's (worker/src/eval-judge.ts): one
 * constant, so the calibration that says the judge can be trusted is the
 * calibration of the model that judges -- a judge moved to another model
 * without it would gate on agreement measured for a different one.
 */
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

/** How long the box waits before searching with the question alone; it runs before every question with a state. */
const REPHRASE_TIMEOUT_MS = 5000

/** At most this many searches: each is one more BM25 ranking fused into the pool. */
export const REPHRASE_SEARCHES = 2

export const REPHRASE_RULES = `A learner driver asked a question about their state's road law.
Write one or two short searches, in the words a state's vehicle code and driver manual use for the same thing, that would find the law that answers it.
Use the law's names for things: "maximum speed limit" for the highest limit, "instruction permit" or "learner's permit" for a permit, "financial responsibility" or "liability insurance" for insurance, "implied consent" for a breath test; a code never says "texting": a search for it says "electronic message or text message", because some codes use one and some the other, and "wireless communication device" or "handheld telephone" for a phone.
Keep the kind of figure asked about (feet, miles per hour, days, years, dollars) but never a figure.
When the question asks what happens, what if, will I, do I have to, or how much, write two searches: one for the duty, as a code states what a driver must or may not do ("have in possession", "display on demand"), and one for its penalty or defence in the words a code uses for them ("fine", "offense", "defense to prosecution", "produces in court", "points", "suspend").
Not having your license with you ("I don't have it on me", "no llevo mi licencia") is the duty to have it in your possession and display it on demand, not driving without a license, which is a different offence: search for the duty to carry it.
Every code and manual is written in English, so every search is in English, whatever language the question is in. A question in Spanish is road law exactly as it would be in English: "¿a qué distancia de un hidrante puedo estacionar?" is "parking distance from fire hydrant", "¿dónde no puedo estacionar?" is "parking prohibited places".
Each search is at most eight words. Return no searches if the question is not about road law.
Also name the one family of process question it is, if it is one of these, or "none":
${PROCESS_FAMILIES.map((family) => `- ${family.id}: ${family.covers}`).join('\n')}
A rule of the road (where to park, how fast, who goes first) is "none", even when a permit holder asks it.
"ticket-procedure" is only a ticket the learner already has. It is not the penalty or the fine for an offence, and not a question about being pulled over, stopped or caught doing something ("what happens if I get pulled over without my license", "how much is the ticket for texting"): those are "none".`

const SCHEMA = {
  type: 'object',
  properties: {
    searches: { type: 'array', items: { type: 'string' } },
    family: { type: 'string', enum: [...PROCESS_FAMILIES.map((family) => family.id), 'none'] },
  },
  required: ['searches', 'family'],
  additionalProperties: false,
} as const

/**
 * The searches, best first, carrying the process family the rephraser read
 * where it read one. An array still, so every caller that only searches --
 * the nationwide loop, the judge, a test's stub returning plain strings --
 * reads it as it always did.
 */
export type Searches = string[] & { family?: ProcessFamily; usage?: Usage }

/**
 * A search's learner words that no code uses, said as the codes say them.
 * "Texting" is in no state's vehicle code: Texas writes "electronic message",
 * Maryland "text message", and a search for "texting while driving fine"
 * ranked by words reaches the manual's one-line ban and never the section
 * whose subsection holds the fine -- so the texting fine was not shown in 18
 * runs of 18 across Texas and Maryland (#799). Haiku is told this too, and
 * still wrote "texting" in a third of its searches; this is what holds when
 * it does. Both words, because a state uses one or the other; "text" and
 * "texts" too ("text and drive"), but not the "text" of "text message",
 * which is already the code's word.
 */
export function inLawWords(search: string): string {
  return search.replace(/\btext(?:s|ing|ed)?\b(?!\s+messag)/gi, 'electronic message text message')
}

/** Searches in the law's words for a learner's question, best first; empty when it is not road law. */
export type Rephrase = (question: string) => Promise<Searches>

/** The part of the Anthropic client the rephraser calls; a test passes its own. */
export type RephraseClient = Pick<Anthropic, 'messages'>

/**
 * Haiku as a `Rephrase`. Throws on anything it cannot read, so the caller
 * searches with the question alone.
 */
export function haikuRephraseFor(apiKey: string | undefined, client?: RephraseClient): Rephrase | undefined {
  if (client === undefined && (apiKey === undefined || apiKey.length === 0)) return undefined
  const anthropic = client ?? new Anthropic({ apiKey, timeout: REPHRASE_TIMEOUT_MS, maxRetries: 0 })
  return async (question) => {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 128,
      system: REPHRASE_RULES,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: question }],
    })
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('')
    let parsed: { searches?: unknown; family?: unknown }
    try {
      parsed = JSON.parse(text) as { searches?: unknown; family?: unknown }
      if (!Array.isArray(parsed.searches) || parsed.searches.some((search) => typeof search !== 'string')) {
        throw new Error(`the rephraser answered with no searches: ${text}`)
      }
    } catch (error) {
      throw carryingUsage(error, response)
    }
    const searches = parsed.searches
    const kept: Searches = (searches as string[])
      .map((search) => search.trim())
      .filter((search) => search.length > 0 && search.length <= 80)
      .slice(0, REPHRASE_SEARCHES)
      .map(inLawWords)
    // A family the list does not hold is no family: it would look up rows
    // no fetch ever stored, and find nothing, silently.
    if (isProcessFamily(parsed.family)) kept.family = parsed.family
    kept.usage = usageOf(response)
    return kept
  }
}
