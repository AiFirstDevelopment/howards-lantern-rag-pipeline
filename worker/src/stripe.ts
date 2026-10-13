/**
 * Stripe over plain fetch, the way the crossfire worker does it. The SDK is a
 * Node library; this runs on Workers, and all we need is three form-encoded
 * calls and an HMAC check.
 */

export interface StripeConfig {
  secretKey: string
  /** Overridden in tests to point at a stub. Production is always api.stripe.com. */
  apiBase: string
}

export interface CheckoutSession {
  id: string
  url?: string
  payment_status?: string
  amount_total?: number | null
  currency?: string | null
  livemode?: boolean
  client_reference_id?: string | null
  customer_email?: string | null
  customer_details?: { email?: string | null } | null
  /**
   * Everything this app has to know about a session when it comes back through
   * a webhook that has never seen the browser.
   *
   * `app` is what makes it ours (see APP_MARK). `device_id` is what attaches it
   * to a browser. `product` is which exam was bought, and `ref` is the partner
   * code it was bought under -- both stamped at creation and read back here,
   * because the webhook-only path (a buyer who closed the tab) has no request
   * body to read them from and Stripe's own discount object never names the
   * partner.
   */
  metadata?: {
    app?: string | null
    device_id?: string | null
    product?: string | null
    ref?: string | null
    /**
     * The discount that was resolved, in basis points. Carried because
     * `amount_total` alone cannot say afterwards whether $15.99 was 20% off
     * $19.99 or 27% off $21.99, and reconciling a partner's arithmetic against
     * ours is the first thing anybody asks for when a commission is disputed.
     */
    discount?: string | null
    /** The language the buyer paid in, `en` or `es`; absent before it was sent. */
    lang?: string | null
    /**
     * The state whose exam was bought, two letters. Absent on every session
     * created before it was sent, and on one whose state did not look like a
     * state -- a sale that then earns no rep a territory commission.
     */
    state?: string | null
    /**
     * `questions` on a pack of question tokens (docs/plans/trusted-by-date.md,
     * decision 22), absent on the course. Both are marked as this app's, so
     * the mark alone cannot tell a webhook which of the two was bought -- and
     * a token session recorded as a purchase would grant the whole course for
     * a dollar. See `isQuestionsSession`.
     */
    kind?: string | null
    /** The code the pack's tokens are held under, minted at checkout so Stripe's receipt can carry it. */
    question_code?: string | null
    /** A code this browser already held, whose remaining tokens move onto the new one. */
    merge_from?: string | null
  } | null
  /**
   * The payment behind the session, kept because it is the only field a refund
   * shares with the purchase it undoes. A refund arrives as a Charge: no
   * session id, no metadata of ours, nothing else to match on.
   *
   * A string on the sessions this app creates (`mode: payment`). Stripe will
   * expand it into an object if asked, which we never do -- hence the union,
   * and `paymentIntentOf` below, which takes the id out of either shape.
   */
  payment_intent?: string | { id?: string } | null
}

/** The id, whichever shape Stripe sent it in. Null when there is none. */
export function paymentIntentOf(session: CheckoutSession): string | null {
  const intent = session.payment_intent
  if (typeof intent === 'string') return intent.length > 0 ? intent : null
  return typeof intent?.id === 'string' ? intent.id : null
}

/**
 * A charge, as it arrives on a refund.
 *
 * The payment intent is the only field that decides anything: it is what a
 * refund is matched to a purchase by, since a charge carries no session id and
 * no metadata of ours. The amounts are kept because they are worth having in a
 * log, and are read by nothing.
 *
 * There was an `isFullyRefunded` here, and it is gone rather than left unused.
 * It existed to spare a goodwill dollar from revoking somebody's access, which
 * was sound until you look at what a refund at this business is: Stripe keeps
 * its fee, so returning the whole charge costs us $0.76, and every refund we
 * issue holds that back. Every one of them was partial, so the exemption was
 * not an edge case -- it was every case, and it meant a buyer could be refunded
 * all but the fee and keep the product. A refund is a refund now, whatever
 * fraction it was, and a helper nothing calls is how that gate gets quietly put
 * back.
 */
export interface Charge {
  id?: string
  payment_intent?: string | null
  refunded?: boolean
  amount?: number | null
  amount_refunded?: number | null
}

/**
 * The mark this app puts on the checkouts it starts, and the only thing that
 * makes one of them recognizably ours.
 *
 * A Stripe account is shared by every app its owner runs, and Stripe delivers
 * every event on the account to every webhook endpoint registered on it. A
 * signature therefore proves only that Stripe sent it -- never that it was
 * about us. Without this mark, a checkout completed in a different product on
 * the same account arrives here correctly signed, and `recordPurchase` mints a
 * recovery code granting this app's paid content to somebody who bought
 * something else entirely. The same holds for /api/claim, where a session id
 * from any product on the account retrieves perfectly well.
 *
 * Set on the session at creation, checked before anything is written. A value
 * rather than a mere presence check, so a second app of ours on the same
 * account is a different string and not an accident waiting to happen.
 */
export const APP_MARK = 'learners-permit'

/**
 * Whether a session is one this app started.
 *
 * Unmarked is not ours. That is deliberate and it is the whole point: the
 * sessions this cannot recognize are exactly the ones written by something
 * else. It also means the two test-mode sessions from before the mark existed
 * no longer claim -- they are already recorded, and there are no other
 * purchases in the table, so nothing real turns on them.
 */
export function startedByThisApp(session: CheckoutSession): boolean {
  return session.metadata?.app === APP_MARK
}

/**
 * The two shapes this worker acts on, and nothing else.
 *
 * A `checkout.session.completed` carries a session; a `charge.refunded`
 * carries a charge. They share no useful field, so the object is the union and
 * each handler narrows it by the event type it was reached from -- which is
 * the only thing that says which of the two arrived.
 */
export interface StripeEvent {
  type: string
  data: { object: CheckoutSession & Charge }
}

class StripeError extends Error {}

async function call(
  cfg: StripeConfig,
  path: string,
  init?: { method: 'POST'; body: URLSearchParams },
): Promise<unknown> {
  const response = await fetch(`${cfg.apiBase}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      ...(init ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init?.body.toString(),
  })
  const payload = (await response.json()) as { error?: { message?: string } }
  if (!response.ok || payload.error) {
    throw new StripeError(payload.error?.message ?? `Stripe returned ${response.status}`)
  }
  return payload
}

/**
 * A one-time payment, not a subscription: someone passes their permit test once.
 * `client_reference_id` carries the device id through Stripe and back out again
 * in the webhook, which is what lets a purchase find its browser without a login.
 */
export async function createCheckoutSession(
  cfg: StripeConfig,
  args: {
    priceId: string
    deviceId: string
    successUrl: string
    cancelUrl: string
    /** Which exam is being bought, so the purchase row can say. */
    product: string
    /**
     * The Stripe coupon the resolved partner discount is applied from, if any.
     * Stripe does the arithmetic, so `amount_total` comes back already correct
     * -- which matters, because that field is what a commission is computed
     * from and it is already recorded.
     */
    coupon?: string | null
    /**
     * The partner code this sale was resolved under. Our own attribution,
     * never read back out of Stripe's discount object: the two are separate
     * jobs and conflating them is what breaks the webhook-only path.
     */
    ref?: string | null
    /** The resolved discount in basis points, recorded with the purchase. */
    discountBps?: number | null
    /**
     * The language the buyer paid in. Recorded in metadata so the purchase row
     * can say it, and handed to Stripe as the checkout page's locale for a
     * Spanish buyer only -- an English one keeps whatever Stripe chose before.
     */
    lang?: 'en' | 'es'
    /** The exam's state, already checked for shape; null stamps nothing. */
    state?: string | null
  },
): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': args.priceId,
    'line_items[0][quantity]': '1',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.deviceId,
    'metadata[device_id]': args.deviceId,
    'metadata[product]': args.product,
    // What makes the completed session recognizable as ours when it comes back
    // through a webhook shared with every other app on the account. See
    // APP_MARK.
    'metadata[app]': APP_MARK,
    'metadata[lang]': args.lang ?? 'en',
  })
  if (args.lang === 'es') body.set('locale', 'es')
  // `allow_promotion_codes` is never set, here or anywhere. Stripe refuses it
  // alongside `discounts` in any case, but the real reason is the shared
  // account: a promotion code created on it is typable into any checkout on
  // that account that allows typed codes, including the other app's. Codes are
  // resolved by us, from our own tables, or not at all.
  if (args.coupon !== null && args.coupon !== undefined && args.coupon !== '') {
    body.set('discounts[0][coupon]', args.coupon)
  }
  if (args.ref !== null && args.ref !== undefined && args.ref !== '') {
    body.set('metadata[ref]', args.ref)
  }
  if (args.discountBps !== null && args.discountBps !== undefined && args.discountBps > 0) {
    body.set('metadata[discount]', String(args.discountBps))
  }
  if (args.state !== null && args.state !== undefined) body.set('metadata[state]', args.state)
  return (await call(cfg, '/v1/checkout/sessions', { method: 'POST', body })) as CheckoutSession
}

/** What marks a Checkout session as a pack of question tokens rather than the course. */
export const QUESTIONS_KIND = 'questions'

/** Whether a session bought question tokens; the course's sessions carry no kind at all. */
export function isQuestionsSession(session: CheckoutSession): boolean {
  return session.metadata?.kind === QUESTIONS_KIND
}

/**
 * A pack of question tokens: one-off, like the course, and marked as ours the
 * same way, plus the kind that keeps it from ever being recorded as the course.
 *
 * The code is minted here rather than when the payment lands, so it can ride
 * the payment's description onto Stripe's own receipt as well as our mail --
 * a teacher who loses the screen it was shown on still has it in two inboxes.
 * Nothing hands it to the browser until the session is paid: the claim reads
 * it from the table the paid session was recorded into.
 */
export async function createQuestionsCheckoutSession(
  cfg: StripeConfig,
  args: {
    priceId: string
    code: string
    /** The code as a person reads it, for the receipt line. */
    shownCode: string
    tokens: number
    lang: 'en' | 'es'
    mergeFrom: string | null
    successUrl: string
    cancelUrl: string
  },
): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': args.priceId,
    'line_items[0][quantity]': '1',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    'metadata[app]': APP_MARK,
    'metadata[kind]': QUESTIONS_KIND,
    'metadata[question_code]': args.code,
    'metadata[lang]': args.lang,
    'payment_intent_data[description]':
      args.lang === 'es'
        ? `${args.tokens} créditos de preguntas — código ${args.shownCode}`
        : `${args.tokens} question tokens — code ${args.shownCode}`,
  })
  if (args.lang === 'es') body.set('locale', 'es')
  if (args.mergeFrom !== null) body.set('metadata[merge_from]', args.mergeFrom)
  return (await call(cfg, '/v1/checkout/sessions', { method: 'POST', body })) as CheckoutSession
}

/**
 * The percentage coupons a partner discount is applied from, pooled by the
 * percentage itself rather than minted per partner.
 *
 * Two hundred partners on 20% share one coupon object; the identity of the
 * seller lives in our own `metadata[ref]`, not in Stripe's coupon. `duration:
 * once` because these sessions are one-off payments and a repeating duration
 * on a one-time price is a setting that means nothing and reads as though it
 * does.
 */
export async function createPercentCoupon(
  cfg: StripeConfig,
  percentOff: number,
  name: string,
): Promise<{ id: string }> {
  const body = new URLSearchParams({
    percent_off: String(percentOff),
    duration: 'once',
    name,
  })
  return (await call(cfg, '/v1/coupons', { method: 'POST', body })) as { id: string }
}

export interface Price {
  unit_amount: number | null
  currency: string
  /** Null on a one-time price, an object on a subscription price. */
  recurring: unknown | null
}

/**
 * What we actually charge, read from Stripe rather than written into the app.
 *
 * The whole handover story is "swap three secrets, change no code". A price
 * typed into a React component breaks that the moment the next owner sets a
 * different one in their own account, and the app would then quote a number it
 * does not charge.
 */
export async function retrievePrice(cfg: StripeConfig, priceId: string): Promise<Price> {
  return (await call(cfg, `/v1/prices/${encodeURIComponent(priceId)}`)) as Price
}

export async function retrieveCheckoutSession(
  cfg: StripeConfig,
  sessionId: string,
): Promise<CheckoutSession> {
  return (await call(
    cfg,
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
  )) as CheckoutSession
}

/** The buyer's address, wherever Stripe put it on this particular session shape. */
export function emailOf(session: CheckoutSession): string | null {
  return session.customer_details?.email ?? session.customer_email ?? null
}

export function isPaid(session: CheckoutSession): boolean {
  return session.payment_status === 'paid'
}

/**
 * Stripe signs `${timestamp}.${body}` with the endpoint secret. Verifying it is
 * the only thing standing between the webhook and anyone who can POST to it, so
 * this compares in constant time and rejects anything older than the tolerance
 * to stop a captured request being replayed.
 */
export async function verifyWebhookSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  // Any missing secret refuses everything: an unconfigured worker must not
  // treat "nothing to check against" as "nothing to check".
  if (header === null || !secret) return false
  const parts = header.split(',').map((p) => p.trim())
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2)
  // Stripe may send several v1 signatures during a secret roll; any may match.
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (timestamp === undefined || signatures.length === 0) return false

  const sent = Number(timestamp)
  if (!Number.isFinite(sent)) return false
  if (Math.abs(nowSeconds - sent) > toleranceSeconds) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  )
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return signatures.some((candidate) => timingSafeEqual(candidate, expected))
}

/** Length-independent so it never leaks how much of a guess was right. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
