import type { HistoryRow } from './ask-thread'
import type { ContactAnswer } from './contact'
import { NOT_ENTITLED, type Entitlement } from './access'
import type { AskAnswer } from './ask'

/**
 * The paywall worker, and whether the paywall exists at all.
 *
 *   unset          dormant. Nothing is asked, nothing is charged, and every
 *                  test stays free -- which is what production shipped for as
 *                  long as Stripe was in test mode.
 *   'same-origin'  this page's own address, which is what production ships.
 *                  A Pages Function serves /api/ there and hands it to the
 *                  worker; see functions/api/[[path]].ts for why that matters.
 *   https://…      that origin. The behavioral suite points at a host that
 *                  cannot resolve, which is how it proves the app survives a
 *                  worker it cannot reach.
 *
 * Same-origin is not a preference. The entitlement call sends a persistent
 * random id from localStorage, and sending that to another registrable domain
 * is, in shape, a tracking pixel -- which is exactly what Safari started
 * dropping when analytics did it from pages.dev to workers.dev. Analytics
 * losing beacons cost numbers. The paywall losing this call costs a paying
 * customer their access, on the platform that is most of mobile.
 *
 * Every call here fails soft. The worker only ever answers one question — has
 * this browser paid — and if it cannot be reached the honest answer is "we do
 * not know", which the caller treats as the cached answer rather than as no.
 */
const CONFIGURED = import.meta.env.VITE_API_BASE ?? ''

/**
 * Whether this build has a paywall at all.
 *
 * Read from what was configured rather than from BASE: same-origin resolves to
 * an empty base, and a dormant build has an empty base too. Telling those apart
 * is the whole job -- getting it wrong in the quiet direction turns the paywall
 * off in production and gives the app away.
 */
export function apiConfigured(): boolean {
  return CONFIGURED.length > 0
}

/**
 * Where a call actually goes, given how the build was configured.
 *
 * Exported and pure for the same reason `endpointFor` is in analytics.ts: this
 * one string decides whether a request arrives, and a request sent to the wrong
 * place fails exactly as quietly as one sent to the right place -- these calls
 * all fail soft by design.
 */
export function apiUrl(path: string, configured = CONFIGURED): string {
  if (configured === 'same-origin') return path
  return configured.replace(/\/$/, '') + path
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Null means "could not ask", which is different from "not entitled". */
export async function fetchEntitlement(deviceId: string): Promise<Entitlement | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(
      apiUrl(`/api/entitlement?deviceId=${encodeURIComponent(deviceId)}`),
    )
    if (!response.ok) return NOT_ENTITLED
    return (await response.json()) as Entitlement
  } catch {
    return null
  }
}

export interface Price {
  unitAmount: number
  currency: string
}

/** What Stripe says we charge. Null means ask again later, not "free". */
export async function fetchPrice(): Promise<Price | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl('/api/price'))
    if (!response.ok) return null
    return (await response.json()) as Price
  } catch {
    return null
  }
}

/**
 * The state the edge places this visitor in, or null outside the US, when it
 * cannot tell, or when the call fails -- every one of which leaves the picker
 * empty, as it always was.
 */
export async function fetchGeoState(): Promise<string | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl('/api/geo'))
    if (!response.ok) return null
    const body = (await response.json()) as { state?: unknown }
    return typeof body.state === 'string' ? body.state : null
  } catch {
    return null
  }
}

/**
 * What a partner code is worth, before anything is paid.
 *
 * The status matters as much as the number: `unknown` is a code that resolved
 * to nothing -- disabled, mistyped, or off a coupon site -- and the paywall has
 * to say so rather than quietly charging full price, because a dead code that
 * fails silently costs a partner their commission and nobody finds out.
 */
export interface ReferralQuote {
  status: 'none' | 'ok' | 'unknown' | 'refused'
  /** The undiscounted price, so the saving can be shown without a second call. */
  listAmount: number
  unitAmount: number
  currency: string
  discountBps: number
  /**
   * The partner's own name for themselves, or null.
   *
   * Only ever sent on `ok`, so a code that stops resolving takes the name off
   * the page with the discount. Optional in the type as well as null-able,
   * because a tab left open against an older worker gets a body without the
   * field at all and must read as "no name" rather than as undefined text.
   */
  partner?: string | null
  /**
   * Whether that name stands in for `HowardsLantern.com` at the top of every
   * screen. From this worker it is exactly `partner !== null`: the switch
   * decides whether the name is sent at all, so the two cannot disagree.
   *
   * Optional, and that is the whole reason it is still a field. A tab open
   * against a worker older than the branding switch gets a body with `partner`
   * set -- that worker credits every live code -- and no flag at all. Anything
   * but `true` has to read as "our own name", which is what every learner sees
   * today; inferring it from `partner` instead would hand the header to every
   * partner the first time Pages shipped ahead of the worker.
   */
  branded?: boolean
}

export async function fetchReferral(
  code: string,
  product: string,
): Promise<ReferralQuote | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(
      apiUrl(
        `/api/referral?code=${encodeURIComponent(code)}&product=${encodeURIComponent(product)}`,
      ),
    )
    if (!response.ok) return null
    return (await response.json()) as ReferralQuote
  } catch {
    return null
  }
}

/**
 * Start a checkout, naming the exam and -- if this browser is carrying one --
 * the code that sent them.
 *
 * The code is a claim, not a decision: the worker resolves it again here, at
 * the moment it decides money, and a code disabled since the quote yields no
 * discount and no commission.
 */
export async function startCheckout(
  deviceId: string,
  product: string,
  ref: string | null = null,
  /**
   * The language the paywall was shown in. Recorded on the purchase, because
   * it decides whether the guarantee covers it (docs/plans/spanish-app.md, §6),
   * and it asks Stripe for a Spanish checkout page.
   */
  lang: 'en' | 'es' = 'en',
  /**
   * The state whose exam the paywall is selling -- the same code `events.state`
   * carries. It decides which sales rep the sale pays, so it is sent whenever
   * there is one; the worker drops anything that is not a state rather than
   * refusing the sale.
   */
  state: string | null = null,
): Promise<string | null> {
  const result = await post<{ checkoutUrl?: string }>('/api/checkout', {
    deviceId,
    product,
    ...(ref === null ? {} : { ref }),
    lang,
    ...(state === null ? {} : { state }),
  })
  return result?.checkoutUrl ?? null
}

/** Called on the way back from Stripe, with the session id it put in the URL. */
export async function claimPurchase(
  deviceId: string,
  sessionId: string,
): Promise<Entitlement | null> {
  return await post<Entitlement>('/api/claim', { deviceId, sessionId })
}

/**
 * A redemption carries why it failed, which an entitlement does not.
 *
 * The paywall answered every refusal with "That code was not recognized", and
 * from 2026-09-23 one of them is a code recognized perfectly well that has
 * reached its device ceiling. Telling a buyer their code is unknown when it is
 * really their sixth browser sends them to support with the wrong question.
 */
export interface RedeemResult extends Entitlement {
  refusedBecause?: 'unknown-code' | 'device-limit' | null
}

export async function redeemCode(deviceId: string, code: string): Promise<RedeemResult | null> {
  return await post<RedeemResult>('/api/redeem', { deviceId, code })
}

/**
 * A question about the partner program, from somebody who has signed nothing.
 *
 * The one partner call the study app makes. It goes to `/api/partners/ask`,
 * which is a different handler from the portal's `/api/partner/ask` and can
 * only ever reach the entries marked as answerable to anyone -- see
 * worker/src/partner-api.ts for why those are two functions rather than one.
 *
 * Null means the worker could not be reached, which the box says plainly rather
 * than showing somebody a "no answer" that would have been an answer.
 */
export async function askPartners(input: {
  conversation: string
  question: string
  turnstile: string
}): Promise<AskAnswer | null> {
  return await post<AskAnswer>('/api/partners/ask', input)
}

/**
 * The learner's box, on /#ask. Its own route and its own handler on the worker
 * (worker/src/learner-api.ts): the language picks the book the model answers
 * from, and the state code lets a road-law refusal point at the state's page.
 */
/** The contact page's form, to `/api/contact` (worker/src/contact.ts). */
export async function sendContact(input: {
  email: string
  message: string
  turnstile: string
  lang: 'en' | 'es'
}): Promise<ContactAnswer | null> {
  return await post<ContactAnswer>('/api/contact', input)
}

export async function askLearners(input: {
  conversation: string
  question: string
  turnstile: string
  lang: 'en' | 'es'
  state: string | null
  /** A question code, only when this question is to be paid for with it. */
  spend?: string
  /** The question code this browser holds, on every question: the row is kept under it. */
  code?: string
}): Promise<AskAnswer | null> {
  return await post<AskAnswer>('/api/ask', input)
}

/**
 * A pack of question tokens to Stripe Checkout (worker/src/questions.ts).
 * `from` is the code this browser already holds, whose remainder moves onto
 * the new one; `path` is the page to come back to. `unavailable` is the
 * worker saying the packs are not on sale yet -- no Price ids configured --
 * which the pop-up says in words rather than as a failure to connect.
 */
export async function startQuestionsCheckout(input: {
  pack: number
  lang: 'en' | 'es'
  from: string | null
  path: string
}): Promise<{ checkoutUrl: string } | 'unavailable' | null> {
  const result = await post<{ checkoutUrl?: string; error?: string }>('/api/questions/checkout', input)
  if (result?.error === 'not-for-sale') return 'unavailable'
  return typeof result?.checkoutUrl === 'string' ? { checkoutUrl: result.checkoutUrl } : null
}

export interface QuestionBalance {
  /** As a person reads it: LQ-XXXXX-XXXXX. */
  code: string
  left: number
}

/**
 * The code a paid session was recorded under, on the way back from Stripe.
 * `pending` while Stripe has not yet called it paid; null when the worker
 * could not be reached or the session bought nothing.
 */
export async function claimQuestions(session: string): Promise<QuestionBalance | 'pending' | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl(`/api/questions/claim?session=${encodeURIComponent(session)}`))
    if (response.status === 202) return 'pending'
    if (!response.ok) return null
    return (await response.json()) as QuestionBalance
  } catch {
    return null
  }
}

/** The questions asked under a code, newest first: `unknown` for a code nobody holds, null when the worker could not say. */
export async function fetchQuestionHistory(code: string): Promise<HistoryRow[] | 'unknown' | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl(`/api/questions/history?code=${encodeURIComponent(code)}`))
    if (response.status === 404) return 'unknown'
    if (!response.ok) return null
    const body = (await response.json()) as { questions?: unknown }
    return Array.isArray(body.questions) ? (body.questions as HistoryRow[]) : null
  } catch {
    return null
  }
}

/** What a code holds: `unknown` for a code nobody holds, null when the worker could not say. */
export async function fetchQuestionBalance(code: string): Promise<QuestionBalance | 'unknown' | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl(`/api/questions/balance?code=${encodeURIComponent(code)}`))
    if (response.status === 404) return 'unknown'
    if (!response.ok) return null
    return (await response.json()) as QuestionBalance
  } catch {
    return null
  }
}
