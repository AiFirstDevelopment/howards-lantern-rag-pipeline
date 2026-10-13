/**
 * What a learner says about the app, sent because they pressed Send.
 *
 * Its own module rather than a fourth function in `analytics.ts`, because it
 * breaks that module's third property on purpose. Analytics is fire and
 * forget: never awaited, never throwing, failures invisible. That is right for
 * a beacon and wrong for a person watching a button. A comment that silently
 * vanished is worse than a comment box that admits it could not send.
 *
 * So this one is awaited, returns what happened, and lets the screen say so.
 * What it keeps from analytics is everything else:
 *
 *  - **The same switch.** `VITE_ANALYTICS_BASE`, never `VITE_API_BASE`, so
 *    wanting feedback cannot turn the paywall on.
 *  - **The same identifier**, and now one more. The analytics id is here so a
 *    public write can be rate-limited at all. It used to be the only one, so
 *    that an opinion could not be joined to a paying identity -- but `events`
 *    gained the device id on 2026-09-01 and made that link reachable in two
 *    hops regardless, so the isolation was already gone and only the ability to
 *    use it on purpose was missing. The device id is sent too, because
 *    `outcome` is the only record this app has of what happened at the real
 *    licensing office, and "did the people who reached Prepared actually pass"
 *    is the question the product exists to answer.
 *  - **The same scrub**, minus one line. See `scrubComment`.
 *
 * It is still true that nothing else in the app waits on this. No screen but
 * the feedback screen calls it, and that screen is reached only on purpose.
 */

import { RELEASE, analyticsConfigured, analyticsId, endpointFor, scrubComment } from './analytics'
import { deviceId } from './access'

/** Whether there is anywhere to send feedback. See `analyticsConfigured`. */
export function feedbackConfigured(): boolean {
  return analyticsConfigured()
}

/**
 * Long enough for a real complaint, short enough not to be a way to fill a
 * table. The worker bounds it again on arrival; this limit is what stops the
 * textarea growing without end, not what protects the database.
 */
export const COMMENT_LIMIT = 600

/** What happened at the licensing office, which is the whole point of asking. */
export const OUTCOMES = ['passed', 'failed', 'not_yet'] as const
export type Outcome = (typeof OUTCOMES)[number]

export interface FeedbackDraft {
  /** 1-5. The one required answer, because one tap is most of what will arrive. */
  rating: number
  outcome: Outcome | null
  comment: string
}

/**
 * The sender's own progress, attached as numbers.
 *
 * This is what turns a comment into a report. "Too easy" from someone at level
 * zero with one test behind them is a different statement from "too easy" from
 * a Prepared user who has passed the real exam, and nothing in the text can
 * tell them apart.
 */
export interface FeedbackContext {
  /** Which exam they are rating. Which one somebody passed is the question. */
  product: string
  state: string | null
  level: number
  tests: number
  score: number | null
  total: number | null
  /**
   * The language the app was in when this was written. Sent only for Spanish:
   * an English comment is the body every row already had, and the worker
   * stores an absent one as null, which reads as English.
   */
  lang?: 'en' | 'es'
}

export type SendResult = 'sent' | 'duplicate' | 'failed'

/**
 * Exactly what goes over the wire, built purely so it can be tested without a
 * network. Undefined fields are dropped by `JSON.stringify`, and the worker
 * rejects any key it was not expecting, so this shape is the contract.
 */
export function feedbackPayload(
  draft: FeedbackDraft,
  context: FeedbackContext,
  session: string,
): Record<string, unknown> {
  const comment = scrubComment(draft.comment, COMMENT_LIMIT).trim()
  return {
    session,
    device: deviceId(),
    product: context.product,
    rating: draft.rating,
    outcome: draft.outcome ?? undefined,
    comment: comment.length > 0 ? comment : undefined,
    state: context.state ?? undefined,
    level: context.level,
    tests: context.tests,
    score: context.score ?? undefined,
    total: context.total ?? undefined,
    ...(context.lang === 'es' ? { lang: 'es' } : {}),
    release: RELEASE,
  }
}

/** A rating is the only thing that must be there before Send does anything. */
export function isSendable(draft: FeedbackDraft): boolean {
  return Number.isInteger(draft.rating) && draft.rating >= 1 && draft.rating <= 5
}

/**
 * Send it, and say what happened.
 *
 * `duplicate` is not a failure: the worker allows one per hour per browser, and
 * from the sender's side a second one means what they had to say has already
 * been said. Only `failed` keeps the typed text on screen for another go.
 *
 * Real JSON with a real content type, unlike the beacons, so this takes a CORS
 * preflight. That is affordable here for the reason it is not there: nobody is
 * closing the tab halfway through pressing a button they are watching.
 */
export async function sendFeedback(
  draft: FeedbackDraft,
  context: FeedbackContext,
): Promise<SendResult> {
  if (!feedbackConfigured() || !isSendable(draft)) return 'failed'
  try {
    const response = await fetch(endpointFor('/api/feedback'), {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedbackPayload(draft, context, analyticsId())),
    })
    if (!response.ok) return 'failed'
    const body = (await response.json()) as { ok?: boolean; duplicate?: boolean }
    if (body.ok !== true) return 'failed'
    return body.duplicate === true ? 'duplicate' : 'sent'
  } catch {
    // An unreachable origin, a blocked request, a reply that is not JSON. The
    // learner is told, and what they wrote is still on the screen.
    return 'failed'
  }
}
