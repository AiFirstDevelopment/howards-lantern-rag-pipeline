/**
 * Answering a question about the partner program by *choosing* a written
 * answer, never by writing one.
 *
 * Everything a visitor reads comes out of `knowledge-base.md` verbatim. The
 * model's whole job is to name which entry answers the question, and the
 * response schema it is given has one field -- an id, out of an enum built from
 * this audience's entries -- so there is no turn on which it could compose a
 * term instead. That matters more on the public page than in the portal, not
 * less: an answer given to somebody *before* they sign anything is a
 * pre-contractual representation about money. Choosing wrongly reads as a
 * non-sequitur and is obvious; writing wrongly looks right.
 *
 * Two audiences over one core. The public route is constructed with the 56
 * entries marked `Audience: anyone` and cannot reach the other sixteen, because
 * those are not in the list it was built with -- not because a flag is checked
 * somewhere. `entryFor` then refuses an id outside the audience a second time,
 * for the case where the model returns something that was never in its enum.
 *
 * The model is injected as an `Asker`, exactly as `MailSender` and
 * `TurnstileVerifier` are, which is what lets the workerd suite drive parse,
 * filter, route, fill, render and log with no API key and no network call.
 */
import Anthropic from '@anthropic-ai/sdk'
import knowledgeBase from './knowledge-base.json'
import repKnowledgeBase from './rep-knowledge-base.json'
import {
  NO_MATCH,
  PARTNER_CONTACT_EMAIL,
  PLACEHOLDERS,
  type Audience,
  type Entry,
  type Placeholder,
} from './kb/rules'

/**
 * What an entry is, and the two constants an entry is held to, both defined in
 * `kb/rules.ts` and re-exported here so that every existing importer keeps
 * working.
 *
 * They moved because the mesh gave them a second reader: a fine server
 * validating an R2 object at read time needs the same definition of a
 * placeholder and the same contact address as this module, and `rules.ts` is
 * the one place both can import without dragging the Anthropic client into a
 * worker that has no use for it.
 */
export { NO_MATCH, PARTNER_CONTACT_EMAIL, PLACEHOLDERS }
export type { Audience, Entry, Placeholder }

/**
 * Generated from `knowledge-base.md` by `npm run kb:build` and committed.
 *
 * Asserted rather than validated at runtime: the shape is checked by
 * tests/unit/knowledge-base.test.ts, which also regenerates this file and
 * compares, so a worker that boots at all is a worker whose entries are the
 * ones in the document. TypeScript can only see a data file's literals.
 */
export const ENTRIES = knowledgeBase as unknown as Entry[]

/**
 * The sales-rep box's answers, from `rep-knowledge-base.md`, and the only list
 * the `rep` asker is ever offered.
 *
 * Kept apart from `ENTRIES` rather than filtered out of it: a rep asking what
 * they earn must never be quoted a partner's 50%, and a partner prospect must
 * never be quoted a rep's 15%. Two lists make that the shape of the data rather
 * than a condition somebody can get backwards.
 */
export const REP_ENTRIES = repKnowledgeBase as unknown as Entry[]

/**
 * Opus 5 at `effort: low`.
 *
 * Routing accuracy is the only quality that matters here and it is the first
 * thing a cheaper model would cost; `npm run ask:eval` exists so that swapping
 * it later is an argued change rather than a guess.
 */
export const ASK_MODEL = 'claude-opus-5'

/** Long enough for a real question, short enough not to be a way to send prose. */
export const MAX_QUESTION_CHARS = 500

/** A conversation, not a correspondence. */
export const MAX_TURNS = 10

/**
 * What the public route may cost in a day.
 *
 * The first unauthenticated thing in this repository that spends money per
 * request, so it has a ceiling -- and past it the route answers with the
 * contact address rather than an error. A cap that degrades to the honest
 * fallback is one nobody has to be paged about.
 */
export const PUBLIC_DAILY_QUESTIONS = 300

/**
 * What one signed-in partner may ask in a day.
 *
 * The portal route was shipped with no limit at all, on the argument that a
 * session makes every question attributable to an account we can suspend.
 * Neither half of that holds: `partnerFromSession` accepts a `pending` row, so
 * anybody who can receive email can have a session five minutes after applying,
 * and a suspended partner can mail themselves a fresh link because `handleLogin`
 * refuses only `closed`. Without this the first authenticated route in this
 * worker that spends money per request has no bound on what it can spend, and
 * the operator finds out from an invoice.
 *
 * Higher than a real partner will ever reach -- the portal's own examples are
 * three questions about the figures on the screen -- and low enough that a
 * scripted loop costs pennies before it stops.
 */
export const PARTNER_DAILY_QUESTIONS = 60

/**
 * How long a logged question lives, in seconds.
 *
 * The same 180 days `src/legal.ts` promises above the box and both privacy
 * documents state. It is here, in the worker, because a promise about deletion
 * that no code enforces is a false statement to somebody who believed it --
 * which is what shipped before this constant existed.
 */
export const QUESTION_RETENTION_SECONDS = 180 * 86_400

export { citeFor } from './cite'

export type PartnerFacts = Record<Placeholder, string>

export function entriesFor(audience: Audience): Entry[] {
  if (audience === 'rep') return REP_ENTRIES
  return audience === 'anyone' ? ENTRIES.filter((entry) => entry.audience === 'anyone') : ENTRIES
}

/**
 * The entry an id names, or null -- including when the id names a real entry
 * this audience may not see.
 *
 * The second of the two guards on the audience split, and the one that catches
 * a model returning an id that was never offered to it.
 */
export function entryFor(audience: Audience, id: string): Entry | null {
  if (id === NO_MATCH) return null
  return entriesFor(audience).find((entry) => entry.id === id) ?? null
}

/**
 * Fill an entry's placeholders from a partner's own row.
 *
 * Every `{...}` is replaced, whether or not it is a name we know: an answer
 * that reached a partner with a brace still in it would be the most visible
 * possible failure, and the empty string is the least misleading thing to put
 * in a sentence we cannot complete. AC8 is the assertion that nothing gets out
 * of here carrying one.
 */
export function fill(text: string, facts: Partial<PartnerFacts>): string {
  return text.replace(/\{([a-z_]+)\}/g, (_match, name: string) => facts[name as Placeholder] ?? '')
}

/** One turn of a conversation, as it was logged rather than as a client sent it. */
export interface AskTurn {
  question: string
  /** The entry that answered it, or `no-match`. */
  id: string
}

export interface AskRequest {
  audience: Audience
  question: string
  /** Earlier turns, oldest first, so that "what if I don't hit that?" resolves. */
  history: AskTurn[]
}

/** What answered, and which entry it chose. */
export interface AskChoice {
  id: string
  /**
   * The model that chose, or why nothing did: `unavailable` when there is no
   * key, `unreachable` when the call failed. Written to `partner_questions` so
   * that a run of no-matches can be told apart from a run of outages.
   */
  model: string
}

export type Asker = (request: AskRequest) => Promise<AskChoice>

/**
 * The instructions, and the entries this audience is allowed to know about.
 *
 * The public router is never given the *names* of the portal-only entries, let
 * alone their text, which is why the audience split cannot be undone by a
 * cleverly worded question.
 */
export function routerPrompt(audience: Audience): string {
  const entries = entriesFor(audience)
    .map((entry) => `## ${entry.id}\nAsked as: ${entry.asks.join(' · ')}\n\n${entry.answer}`)
    .join('\n\n')
  return [
    'You route a question about a referral program to one written answer.',
    'You never write an answer, and nothing you return is shown to anybody: the',
    'id you choose selects text that is already written.',
    '',
    'Return the id of the entry that answers the question. Return',
    `"${NO_MATCH}" when none of them does -- including when the question asks`,
    'about a named buyer, somebody’s own tax or legal position, whether a',
    'particular advert is compliant, or anything that would promise a date, an',
    'amount or an approval. A wrong entry is a non-sequitur somebody can see;',
    `"${NO_MATCH}" puts them in front of a person, which is never the wrong`,
    'answer.',
    '',
    'Earlier turns of the conversation are given so that a follow-up resolves:',
    '"what if I don’t hit that?" after a question about payment is asking about',
    'the payout floor.',
    '',
    'The entries:',
    '',
    entries,
  ].join('\n')
}

/** The response schema: one field, and an enum of exactly what this audience may see. */
function idSchema(audience: Audience): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        enum: [...entriesFor(audience).map((entry) => entry.id), NO_MATCH],
      },
    },
    required: ['id'],
    additionalProperties: false,
  }
}

/**
 * The asker the deployed worker uses.
 *
 * An unset key answers `no-match`, which is the contact address and an HTTP
 * 200 rather than a 500. That is the opposite of the stance `turnstileFor`
 * takes about its own missing secret, and deliberately: refusing everything is
 * right for a form that mails strangers, and wrong here, where the failure a
 * visitor should meet is a person's email address rather than an error. Every
 * path in this file points the same way -- no key, model unreachable, a reply
 * that will not parse, an id outside the enum: all of them land on somebody.
 */
export function askerFor(apiKey: string | undefined): Asker {
  if (apiKey === undefined || apiKey.length === 0) {
    return async () => {
      console.error('no ANTHROPIC_API_KEY: every question answers with the contact address')
      return { id: NO_MATCH, model: 'unavailable' }
    }
  }
  const client = new Anthropic({ apiKey })
  return async ({ audience, question, history }) => {
    try {
      const response = await client.messages.create({
        model: ASK_MODEL,
        max_tokens: 1024,
        // The entries are the stable prefix and the conversation goes after
        // them, so a follow-up reads the cache rather than rebuilding it.
        cache_control: { type: 'ephemeral' },
        system: routerPrompt(audience),
        output_config: {
          // Choosing among written answers is not a reasoning task.
          effort: 'low',
          format: { type: 'json_schema', schema: idSchema(audience) },
        },
        messages: [
          // Replayed as they were logged: the assistant's turn is the id it
          // chose, because an id is the only thing it has ever returned.
          ...history.flatMap((turn): Anthropic.MessageParam[] => [
            { role: 'user', content: turn.question },
            { role: 'assistant', content: JSON.stringify({ id: turn.id }) },
          ]),
          { role: 'user', content: question },
        ],
      })
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      const chosen = JSON.parse(text) as { id?: unknown }
      // An unparseable or absent id is a no-match rather than an error: the
      // schema constrains the model, and anything that got past it is not
      // something to render an answer from.
      return { id: typeof chosen.id === 'string' ? chosen.id : NO_MATCH, model: ASK_MODEL }
    } catch (error) {
      console.error('ask: could not reach the model', error)
      return { id: NO_MATCH, model: 'unreachable' }
    }
  }
}
