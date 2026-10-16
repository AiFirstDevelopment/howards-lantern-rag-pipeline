import { handleAdmin } from './admin-api'
import { operatorFor } from './admin-auth'
import {
  computeStats,
  parseError,
  readGeo,
  recordCrash,
  windowDays,
} from './analytics'
import { handleEvent } from './event-sink'
import { handleEvalIngest } from './eval-ingest'
import { askerFor } from './ask'
import { leadAssistFor } from './lead-assist'
import { handleContact } from './contact'
import { handleLearnersAsk, handleLearnersRate } from './learner-api'
import { learnerAskerFor } from './learner-ask'
import { LAWS_ORIGIN, lawsPath, type AskLaw } from './law-retrieval'
import { nearLawsFor } from './law-vectors'
import { lawsByIdFor, lawsBySectionFor, nearLawsNationwide, penaltiesForDb, processRowsForDb } from './law-nationwide'
import { firstOf, haikuRerankFor, rerankFor } from './law-rerank'
import { haikuRephraseFor } from './law-rephrase'
import { haikuTopicsFor, topicPath, topicsPath, type NationwideTopic, type StateLaw } from './law-topics'
import { bearerFrom, importVerifyKey } from '../../mcp/shared/auth'
import { exchangeToken } from './mint'
import { meshAskerFor } from './mesh-ask'
import { parseFeedback, recordFeedback, sentRecently } from './feedback'
import { mailerFor, type SendEmailBinding } from './mail'
import { handlePartner, handlePartnersAsk, handleRepsAsk } from './partner-api'
import {
  DEVICE_LIMIT,
  entitlementFor,
  markRefunded,
  recordPurchase,
  redeemRecoveryCode,
} from './purchases'
import { couponFor, normalizeCode, resolveReferral } from './referral'
import { turnstileFor } from './turnstile'
import { handleConfirm, handleSubscribe, handleUnsubscribe, newToken } from './subscribe'
import {
  handleQuestionsBalance,
  handleQuestionsCheckout,
  handleQuestionsClaim,
  handleQuestionsHistory,
  recordCredits,
  type QuestionsDeps,
} from './questions'
import {
  createCheckoutSession,
  isQuestionsSession,
  createPercentCoupon,
  retrieveCheckoutSession,
  retrievePrice,
  verifyWebhookSignature,
  type StripeConfig,
  type StripeEvent,
} from './stripe'
import { STATE_SHAPE } from './states'
import { DEFAULT_PRODUCT, PRODUCT } from './validate'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  SUPPORT_EMAIL: string
  STRIPE_API_BASE: string
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_ID: string
  STRIPE_WEBHOOK_SECRET: string
  /**
   * The live Price id of each pack of question tokens, as JSON keyed by the
   * pack's dollars -- `{ "1": "price_…", "5": "price_…", "10": "price_…",
   * "25": "price_…" }` -- set with `wrangler secret put STRIPE_TOKEN_PRICES` by
   * the person who created the Prices (worker/src/questions.ts). Optional:
   * absent, the packs answer 503 *not for sale yet* and nothing else changes.
   */
  STRIPE_TOKEN_PRICES?: string
  /**
   * The partner network's three pieces of configuration, all optional so the
   * worker deploys before any of them exists.
   *
   * `SEND_EMAIL` is the Cloudflare Email Service binding. Absent, no link is
   * sent and the failure is loud in the logs -- which is the right shape for
   * something whose whole job is to deliver, and `npm run partners --
   * login-link` is what gets somebody in meanwhile.
   *
   * `TURNSTILE_SECRET` absent refuses every application, the same stance
   * `verifyWebhookSignature` takes about its own missing secret.
   *
   * `PARTNER_ORIGIN` is the one name every partner link is generated against,
   * because the two names this app runs under are separate origins with
   * separate storage and a link on the other one loses its attribution
   * silently.
   */
  SEND_EMAIL?: SendEmailBinding
  /**
   * Cloudflare Access, which is the whole of who may administer the program.
   *
   * All three optional, and all three absent means every `/api/admin/*` route
   * answers 403. That is the case that actually happens -- the first deploy,
   * before the Access application exists -- and a default of "allow when
   * unconfigured" is exactly the silent, correct-looking failure this
   * repository keeps shipping. See worker/src/admin-auth.ts.
   *
   * `ADMIN_OPERATORS` is in `wrangler.toml` rather than in D1 on purpose: the
   * admin portal's entire job is writing to D1, so an operator list stored
   * there would be editable by anybody who reached the portal. Authorization
   * data the authorized surface can edit is not authorization. Changing who may
   * administer the program is a deploy, and the deploy is the audit trail.
   */
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ADMIN_OPERATORS?: string
  /**
   * A Resend API key, set with `wrangler secret put RESEND_API_KEY`. Present, it
   * is what sends; absent, `SEND_EMAIL` is. See the comment on `MailConfig`:
   * the binding cannot reach an address nobody has verified, which is every
   * address a stranger types into the application form.
   */
  RESEND_API_KEY?: string
  /** One-off: addresses owed an apology for the long verification email. */
  APOLOGISE_TO?: string
  /**
   * What answers a partner's -- or a prospect's -- question, set with
   * `wrangler secret put ANTHROPIC_API_KEY`.
   *
   * Absent, both ask routes answer with the contact address and HTTP 200 rather
   * than 500. That is the opposite direction from `TURNSTILE_SECRET` above, and
   * deliberately: an unconfigured challenge must refuse a form that mails
   * strangers, while an unconfigured router should land somebody on a person.
   * See worker/src/ask.ts.
   */
  ANTHROPIC_API_KEY?: string
  TURNSTILE_SECRET?: string
  PARTNER_ORIGIN?: string
  PARTNER_FROM?: string
  /**
   * The mesh: the six R2 objects the fine servers read, the key that signs the
   * tokens they verify, and the flag that decides whether any of it is used.
   *
   * All optional, and every one of them absent is the shape this worker is
   * deployed in today. `ASK_VIA_MESH` unset means `/api/partners/ask` and
   * `/api/partner/ask` answer exactly as they always have -- the mesh ships
   * inert, and turning it on is one variable with a one-variable rollback.
   *
   * `MESH_PRIVATE_KEY` is a secret and the only private key in this system;
   * `MESH_PUBLIC_KEY` is the verifying half, and is what the exchange uses to
   * check the token a coarse server presents. A deployment holding the private
   * half and not the public one cannot exchange, which is loud rather than
   * quiet: `/api/mesh/exchange` answers 503.
   */
  KB?: R2Bucket
  /**
   * Workers AI and the law index, for the ask box's meaning search
   * (worker/src/law-vectors.ts). Optional: without either, road law is
   * retrieved by BM25 alone, as it was before they were bound.
   */
  AI?: Ai
  LAWS?: VectorizeIndex
  MESH_PRIVATE_KEY?: string
  MESH_PUBLIC_KEY?: string
  ASK_VIA_MESH?: string
  /**
   * The coarse worker, as a service binding.
   *
   * Worker to worker, so the aggregator has no public route it needs and the
   * only thing that can reach it is something holding a token this worker
   * signed. Absent with the flag on is the old path, loudly logged, rather than
   * a broken box.
   */
  COARSE?: Fetcher
  /**
   * The key CI's eval job presents to `POST /api/eval/runs`, set with
   * `wrangler secret put EVAL_INGEST_KEY` and as the repository secret of the
   * same name. Absent, the route answers 503 to everyone: an ingest open
   * until somebody remembered the secret would take runs from anybody.
   */
  EVAL_INGEST_KEY?: string
}

/**
 * The paywall's server half. It owns exactly one fact — whether a browser has
 * paid — and the two ways that fact can be established: a completed Stripe
 * checkout, or a recovery code typed in from a receipt.
 *
 * It deliberately knows nothing about the learner's progress. Study progress
 * stays in localStorage where it has always been, so the worker being down
 * costs a buyer their access to new tests and nothing else.
 */
export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, supportEmail: env.SUPPORT_EMAIL }, 200, cors)
      }
      if (url.pathname === '/api/price' && request.method === 'GET') {
        return await handlePrice(env, cors)
      }
      if (url.pathname === '/api/geo' && request.method === 'GET') {
        return handleGeo(request, cors)
      }
      if (url.pathname === '/api/entitlement' && request.method === 'GET') {
        return await handleEntitlement(url, env, cors)
      }
      if (url.pathname === '/api/checkout' && request.method === 'POST') {
        return await handleCheckout(request, env, cors, origin)
      }
      // The quote a partner code produces, so the buyer sees the real price
      // before paying. Public, and rate limited: it is an oracle over a code
      // namespace.
      if (url.pathname === '/api/referral' && request.method === 'GET') {
        return await handleReferral(request, url, env, cors)
      }
      if (url.pathname === '/api/claim' && request.method === 'POST') {
        return await handleClaim(request, env, cors)
      }
      if (url.pathname === '/api/redeem' && request.method === 'POST') {
        return await handleRedeem(request, env, cors)
      }
      // Question tokens: a pack to Checkout, the code a paid session was
      // recorded under, and what a typed code holds. See worker/src/questions.ts.
      if (url.pathname === '/api/questions/checkout' && request.method === 'POST') {
        return await handleQuestionsCheckout(request, questionsDeps(env, origin), cors)
      }
      if (url.pathname === '/api/questions/claim' && request.method === 'GET') {
        return await handleQuestionsClaim(url, questionsDeps(env, origin), cors)
      }
      if (url.pathname === '/api/questions/balance' && request.method === 'GET') {
        return await handleQuestionsBalance(request, url, questionsDeps(env, origin), cors)
      }
      if (url.pathname === '/api/questions/history' && request.method === 'GET') {
        return await handleQuestionsHistory(request, url, questionsDeps(env, origin), cors)
      }
      // The observability pair. Write is a sink, read is public aggregates --
      // see docs/plans/add-observability.md, and worker/src/analytics.ts for
      // why neither of them can reach the purchase tables.
      if (url.pathname === '/api/event' && request.method === 'POST') {
        return await handleEvent(request, env.DB, cors, {
          // The sender alone, built the way `partnerDeps` builds it but without
          // the rest of that object -- an Anthropic client among it -- on the
          // busiest path this worker has.
          sendMail: mailerFor({
            binding: env.SEND_EMAIL,
            apiKey: env.RESEND_API_KEY,
            from: env.PARTNER_FROM ?? 'partners@howardslantern.com',
          }),
          // Absent only where something calls this handler without a runtime
          // behind it; the alert then runs unwatched and may be cut short, as a
          // dropped beacon's would be, and the event is written either way.
          defer: (work) => ctx?.waitUntil(work),
          now: () => Date.now(),
        })
      }
      if (url.pathname === '/api/error' && request.method === 'POST') {
        return await handleCrash(request, env, cors)
      }
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return await handleStats(url, env)
      }
      // The one write in this worker that a person is waiting on. See below.
      if (url.pathname === '/api/feedback' && request.method === 'POST') {
        return await handleFeedback(request, env, cors)
      }
      // The one partner route with no session behind it: the box on the public
      // partner page, answering a prospect's questions from the 56 entries
      // marked `Audience: anyone`. Its own path rather than a widening of the
      // prefix below, so that the handler which can reach account entries and
      // the handler a stranger can call are never the same function.
      if (url.pathname === '/api/partners/ask' && request.method === 'POST') {
        return await handlePartnersAsk(request, env.DB, cors, partnerDeps(env))
      }
      // The same box on the sales-rep page, answering only from
      // rep-knowledge-base.md, so a prospective rep is never quoted a partner's
      // terms. Same protections and the same daily pool as the route above.
      if (url.pathname === '/api/sales-rep/ask' && request.method === 'POST') {
        return await handleRepsAsk(request, env.DB, cors, partnerDeps(env))
      }
      // The learner's box, on /#ask. Its own handler and its own table, so the
      // function a stranger calls can reach nothing a partner's can; and the
      // one route in this worker on which a model writes to a learner, under
      // the checks in learner-ask.ts.
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        return await handleLearnersAsk(request, env.DB, cors, {
          askLearner: learnerAskerFor(env.ANTHROPIC_API_KEY),
          lawsFor: lawsFromPages,
          nearLaws: nearLawsFor(env.AI, env.LAWS),
          rerank: firstOf(haikuRerankFor(env.ANTHROPIC_API_KEY), rerankFor(env.AI)),
          rephrase: haikuRephraseFor(env.ANTHROPIC_API_KEY),
          topics: () => listFromPages<NationwideTopic>(topicsPath()),
          topicLawsFor: (topic) => listFromPages<StateLaw>(topicPath(topic)),
          topicsFor: haikuTopicsFor(env.ANTHROPIC_API_KEY),
          nearLawsNationwide: nearLawsNationwide(env.AI, env.LAWS),
          lawsById: lawsByIdFor(env.DB),
          lawsBySection: lawsBySectionFor(env.DB),
          penaltiesFor: penaltiesForDb(env.DB),
          processRowsFor: processRowsForDb(env.DB),
          verifyTurnstile: turnstileFor(env.TURNSTILE_SECRET),
          now: () => Math.floor(Date.now() / 1000),
          contact: env.SUPPORT_EMAIL,
        })
      }
      // A thumbs up or down on one of the box's answers, from the browser
      // holding its thread (docs/plans/eval-lifecycle-build.md, decision 6).
      if (url.pathname === '/api/ask/rate' && request.method === 'POST') {
        return await handleLearnersRate(request, env.DB, cors, () => Math.floor(Date.now() / 1000))
      }
      // The contact page's form: one email to the operator, nothing stored,
      // the challenge on every send. See worker/src/contact.ts.
      if (url.pathname === '/api/contact' && request.method === 'POST') {
        return await handleContact(request, cors, {
          sendMail: mailerFor({
            binding: env.SEND_EMAIL,
            apiKey: env.RESEND_API_KEY,
            from: env.PARTNER_FROM ?? 'partners@howardslantern.com',
          }),
          verifyTurnstile: turnstileFor(env.TURNSTILE_SECRET),
          to: env.SUPPORT_EMAIL,
        })
      }
      // The monthly list of what changed in state driving law: one row and one
      // confirmation mail per address, the challenge on every sign-up, and the
      // two links that mail carries. See worker/src/subscribe.ts.
      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        return await handleSubscribe(request, cors, {
          db: env.DB,
          sendMail: mailerFor({
            binding: env.SEND_EMAIL,
            apiKey: env.RESEND_API_KEY,
            from: env.PARTNER_FROM ?? 'partners@howardslantern.com',
          }),
          verifyTurnstile: turnstileFor(env.TURNSTILE_SECRET),
          now: () => Math.floor(Date.now() / 1000),
          newToken,
          origin: env.PARTNER_ORIGIN ?? 'https://howardslantern.com',
        })
      }
      if (url.pathname === '/api/subscribe/confirm' && request.method === 'GET') {
        return await handleConfirm(url, { db: env.DB, now: () => Math.floor(Date.now() / 1000) })
      }
      if (url.pathname === '/api/subscribe/unsubscribe' && request.method === 'GET') {
        return await handleUnsubscribe(url, { db: env.DB, now: () => Math.floor(Date.now() / 1000) })
      }
      // The portal's own API. Everything under here takes its partner id from
      // the session and from nowhere else; see worker/src/partners.ts.
      if (url.pathname.startsWith('/api/partner/')) {
        return await handlePartner(request, env.DB, url, cors, partnerDeps(env))
      }
      // The operator's own API. Everything under here proves who is asking
      // against Cloudflare Access before a route is looked at, and this
      // application issues no credential of its own; see worker/src/admin-api.ts.
      if (url.pathname.startsWith('/api/admin/')) {
        return await handleAdmin(request, env.DB, url, cors, adminDeps(env))
      }
      // The mesh's one public route, and it is not a browser surface: the
      // coarse worker presents the token it was given and asks for one
      // audienced to a single fine server. The presented token is the whole of
      // the authentication -- there is nothing else to check, which is the
      // point of claims.
      if (url.pathname === '/api/mesh/exchange' && request.method === 'POST') {
        return await handleExchange(request, env)
      }
      // A whole eval run from CI (docs/plans/eval-lifecycle-build.md, decision
      // 33). Not a browser either: the ingest key is the authentication, and
      // without the secret set the route refuses everything.
      if (url.pathname === '/api/eval/runs' && request.method === 'POST') {
        return await handleEvalIngest(request, env.DB, env.EVAL_INGEST_KEY, () => Math.floor(Date.now() / 1000))
      }
      // Stripe is not a browser: no CORS, and the signature is the authentication.
      if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
        return await handleWebhook(request, env)
      }
      return json({ error: 'Not found' }, 404, cors)
    } catch (error) {
      console.error('unhandled', error)
      return json({ error: 'Something went wrong' }, 500, cors)
    }
  },

}

/**
 * A coarse token in, a token for one named fine server out.
 *
 * This is the hop the whole auth design exists for. Pass-through -- letting the
 * caller's token travel to the fine servers unchanged -- would be one fewer
 * step and would give every fine server a credential that works against all of
 * the others: a bug in `kb-promotion`, the server with no live data and the
 * least reason to be hardened, would yield a token that opens `kb-money`. The
 * exchange is what makes six services six blast radii instead of one.
 *
 * **No CORS headers and no browser ever calls it**, and that is now true of the
 * code as well as of the sentence: this used to answer through `cors`, so a
 * request carrying an allowed `Origin` got a freshly minted bearer token back
 * with `Access-Control-Allow-Origin` on it. Not reachable today -- only
 * `Content-Type` is in the allowed header list, so a cross-origin fetch cannot
 * attach `Authorization` -- but the docstring asserted a property the code did
 * not have, and the day somebody adds `Authorization` to that list for an
 * unrelated route it would become one. `Cache-Control: no-store` for the same
 * reason every other token-carrying response in this change sets it.
 *
 * `exchangeToken` refuses an audience that is not one of the six, refuses a
 * token that is not audienced to the coarse server, narrows the scopes to what
 * the named server has a use for, and never issues a token that outlives the
 * one presented.
 */
async function handleExchange(request: Request, env: Env): Promise<Response> {
  const cors = { 'Cache-Control': 'no-store' }
  const body = await readJson<{ audience?: unknown }>(request)
  const audience = typeof body?.audience === 'string' ? body.audience : ''
  const now = Math.floor(Date.now() / 1000)

  const exchanged = await exchangeToken(
    env.MESH_PRIVATE_KEY,
    await importVerifyKey(env.MESH_PUBLIC_KEY ?? ''),
    bearerFrom(request),
    audience,
    now,
  )
  if (exchanged.ok) {
    return json({ token: exchanged.token, expiresAt: exchanged.expiresAt }, 200, cors)
  }
  if (exchanged.because === 'unconfigured') {
    // A deployment with no key cannot sign, and says so rather than answering
    // 401 -- an operator diagnosing "the mesh is refusing everybody" must be
    // able to tell a missing secret from a refused token.
    return json({ error: 'the mesh signing key is not configured' }, 503, cors)
  }
  // `audience` and `refused` are one answer on purpose: naming which of the two
  // it was tells a caller holding a bad token whether the audience they guessed
  // exists.
  return json({ error: 'not authorized' }, 401, cors)
}

/**
 * Cached for an hour. A price changes about never, and the paywall should not
 * make a Stripe round trip every time someone opens it.
 */
let cachedPrice: { at: number; body: { unitAmount: number; currency: string } } | null = null

/**
 * What we charge, and why the answer is shared rather than fetched twice.
 *
 * Three things now need the list price: the paywall's own quote, the discounted
 * quote a partner code produces, and the floor check at checkout. Deriving all
 * of them from this one number is what stops two endpoints eventually
 * disagreeing about the price of the same thing -- and the one the buyer saw is
 * the one they will hold us to.
 *
 * A result rather than a throw, because its two callers want opposite things
 * from a failure: /api/price reports exactly what Stripe said, since every
 * failure there is a misconfiguration somebody has to diagnose, while a
 * checkout has no use for the detail.
 */
type PriceResult =
  | { ok: true; body: { unitAmount: number; currency: string } }
  | { ok: false; status: number; error: string }

async function readPrice(env: Env): Promise<PriceResult> {
  const now = Date.now()
  if (cachedPrice !== null && now - cachedPrice.at < 3_600_000) {
    return { ok: true, body: cachedPrice.body }
  }
  let price
  try {
    price = await retrievePrice(stripeConfig(env), env.STRIPE_PRICE_ID)
  } catch (error) {
    // Stripe's own message names which misconfiguration this is: a price id
    // from the wrong mode, a typo, a key for another account. Nothing secret is
    // in it — the price id is public config.
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : 'Could not read the price',
    }
  }
  if (price.unit_amount === null) return { ok: false, status: 502, error: 'Price has no amount' }
  // Stripe's product form defaults to Recurring, and a recurring price is only
  // rejected later, at checkout, with an error the buyer sees and the operator
  // does not. Catching it here means the setup check fails instead of the sale.
  if (price.recurring !== null && price.recurring !== undefined) {
    return {
      ok: false,
      status: 502,
      error:
        'That price is recurring. Checkout takes a single payment, so ' +
        'STRIPE_PRICE_ID must be a one-off price.',
    }
  }
  const body = { unitAmount: price.unit_amount, currency: price.currency }
  cachedPrice = { at: now, body }
  return { ok: true, body }
}

/**
 * The state the visitor appears to be in, so the pickers can open on it.
 *
 * Only inside the United States: Cloudflare's `regionCode` is a subdivision
 * code everywhere, and Ontario's "ON" or a Mexican state's code would land on
 * whichever two letters happen to match a published state. The page decides
 * whether the answer is a state it offers; this only says where the edge put
 * the request. Never cached anywhere, because the answer is per visitor -- a
 * shared cache would open every later visitor on the first one's state.
 */
function handleGeo(request: Request, cors: HeadersInit): Response {
  const geo = readGeo(request)
  const state = geo.country === 'US' ? geo.region : null
  return json({ state }, 200, { ...cors, 'Cache-Control': 'private, no-store' })
}

async function handlePrice(env: Env, cors: HeadersInit): Promise<Response> {
  const result = await readPrice(env)
  // This one endpoint reports what Stripe actually said, because it is how
  // setup is checked; the generic handler still covers the rest.
  return result.ok
    ? json(result.body, 200, cors)
    : json({ error: result.error }, result.status, cors)
}

/** The list price for the endpoints that need the number and not the diagnosis. */
async function currentPrice(env: Env): Promise<{ unitAmount: number; currency: string } | null> {
  const result = await readPrice(env)
  return result.ok ? result.body : null
}

async function handleEntitlement(url: URL, env: Env, cors: HeadersInit): Promise<Response> {
  const deviceId = url.searchParams.get('deviceId') ?? ''
  if (!isDeviceId(deviceId)) return json({ error: 'deviceId required' }, 400, cors)
  return json(await entitlementFor(env.DB, deviceId), 200, cors)
}

async function handleCheckout(
  request: Request,
  env: Env,
  cors: HeadersInit,
  origin: string | null,
): Promise<Response> {
  const body = await readJson<{
    deviceId?: string
    product?: string
    ref?: string
    lang?: unknown
    state?: unknown
  }>(request)
  const deviceId = body?.deviceId ?? ''
  if (!isDeviceId(deviceId)) return json({ error: 'deviceId required' }, 400, cors)
  // The language the paywall was shown in, recorded on the purchase because it
  // decides whether pass-or-refund covers it (docs/plans/spanish-app.md, §6).
  // Absent is English: every phone still holding a bundle from before this
  // sends none, and all of them were English. Anything else is refused rather
  // than stored, so the column only ever says one of the two things Terms
  // gives a meaning to.
  const lang = body?.lang ?? 'en'
  if (lang !== 'en' && lang !== 'es') return json({ error: 'lang not recognized' }, 400, cors)

  // An absent product is the bundle that shipped before this column existed;
  // an ill-shaped one is not a product at all and must not reach Stripe. The
  // difference matters: the first is a deploy lag, the second is a string from
  // the open internet on its way into a grouping column.
  const product = body?.product ?? DEFAULT_PRODUCT
  if (!PRODUCT.test(product)) return json({ error: 'product not recognized' }, 400, cors)

  // The exam's state, which decides which sales rep the sale pays. Dropped
  // rather than refused when it does not look like a state: a checkout must
  // never fail on attribution, and a sale with no state is recorded, sold, and
  // simply earns no territory commission -- which `whyNoTerritoryCommission`
  // then says.
  const state = typeof body?.state === 'string' && STATE_SHAPE.test(body.state) ? body.state : null

  // Already paid: say so rather than taking the money twice.
  const held = await entitlementFor(env.DB, deviceId)
  if (held.entitled) {
    return json(
      {
        // Said in words a partner testing their own link will understand: this
        // is the most likely first thing they do, and "Already purchased" on
        // its own reads as the program being broken.
        error: 'Already purchased. This browser already holds the tests, so there is nothing to buy.',
        ...held,
      },
      409,
      cors,
    )
  }

  // Resolved here, at the moment it decides money, and not from whatever the
  // quote said a few minutes ago: a code can be disabled in between, and only
  // this resolution is trusted. See worker/src/referral.ts.
  //
  // A price we could not read means no sale *when a code was presented*, and no
  // discount otherwise. The floor check needs the list price, and without it
  // there are only two ways to finish a referred checkout: charge the list
  // price to somebody who was quoted less, or sell under a floor nobody
  // checked. Both are worse than a retry, and the first also drops the
  // attribution -- no `metadata[ref]`, so the purchase row records no partner
  // and the commission cannot be recovered from it afterwards. `/api/referral`
  // already answers 502 for the same reason.
  const price = await currentPrice(env)
  if (price === null) {
    if (normalizeCode(body?.ref ?? null) !== null) {
      return json({ error: 'Could not read the price' }, 502, cors)
    }
  }
  const outcome =
    price === null
      ? null
      : await resolveReferral(env.DB, {
          code: body?.ref ?? null,
          product,
          listAmountCents: price.unitAmount,
        })
  if (outcome !== null && outcome.status === 'refused') {
    // The floor. Refused at the point of sale rather than discovered in a
    // monthly total, which is the whole reason min_keep_cents is checked here
    // and not only in the script that writes the rows.
    return json({ error: 'That code cannot be used on this purchase' }, 409, cors)
  }
  const referral = outcome !== null && outcome.status === 'ok' ? outcome.referral : null
  const coupon =
    referral === null
      ? null
      : await couponFor(
          env.DB,
          (percentOff, name) => createPercentCoupon(stripeConfig(env), percentOff, name),
          referral.discountBps,
          Math.floor(Date.now() / 1000),
        )

  const returnTo = allowedOrigin(origin, env) ?? firstAllowedOrigin(env)
  let session
  try {
    session = await createCheckoutSession(stripeConfig(env), {
      priceId: env.STRIPE_PRICE_ID,
      deviceId,
      product,
      coupon,
      ref: referral?.code ?? null,
      discountBps: referral?.discountBps ?? null,
      lang,
      state,
      // Stripe substitutes the real id into the placeholder on redirect.
      successUrl: `${returnTo}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      // British spelling on purpose, and the one string the American-English
      // pass of 2026-09-08 was reverted on. This is not prose: it is a value
      // Stripe echoes back in the address bar, and the client matches it
      // literally. Renaming it strands every checkout session created before
      // the deploy -- their cancel_url still says `cancelled` while the page
      // that receives them looks for `canceled`, so a buyer who backs out sees
      // nothing instead of being told what happened.
      cancelUrl: `${returnTo}/?purchase=cancelled`,
    })
  } catch (error) {
    // A coupon Stripe will not accept is a stale row in `discount_coupons`,
    // not a reason to stop selling for ever. The pool is keyed by percentage
    // alone, so a coupon deleted in the dashboard -- or an API key moved
    // between test and live mode, where coupon objects do not follow -- leaves
    // an id that can never resolve again, and every referred buyer at that
    // percentage is blocked while unreferred ones are unaffected. Dropping the
    // row lets the next attempt mint a fresh coupon; the buyer sees the retry
    // message the paywall already shows and the retry works. Matched on the
    // coupon id appearing in Stripe's own message so an unrelated failure --
    // a rate limit, a network blip -- does not discard a good row.
    if (coupon !== null && error instanceof Error && error.message.includes(coupon)) {
      await env.DB.prepare('DELETE FROM discount_coupons WHERE stripe_coupon = ?')
        .bind(coupon)
        .run()
    }
    throw error
  }
  if (session.url === undefined) return json({ error: 'Stripe returned no URL' }, 502, cors)
  return json({ checkoutUrl: session.url }, 200, cors)
}

/**
 * How often one address may ask what a code is worth, and the window it is
 * counted in.
 *
 * Held in this isolate's memory rather than in a table, because the alternative
 * is storing the IP address a request came from -- and this database
 * deliberately never has (see the geo columns in worker/schema.sql, which keep
 * a country and never an address). A per-isolate limit is not a global one and
 * is not claimed to be: what it stops is one client walking the code namespace
 * from one connection, which is the whole of what the endpoint is worth
 * attacking for.
 */
const REFERRAL_WINDOW_MS = 60_000
const REFERRAL_PER_WINDOW = 20
const referralHits = new Map<string, { windowStartedAt: number; count: number }>()

function tooManyReferralLookups(key: string, now: number): boolean {
  // Bounded, so a stream of distinct addresses cannot grow this without limit;
  // dropping the whole map is correct because every entry is at most a window
  // old and losing one only means somebody gets their allowance back early.
  if (referralHits.size > 5_000) referralHits.clear()
  const seen = referralHits.get(key)
  if (seen === undefined || now - seen.windowStartedAt >= REFERRAL_WINDOW_MS) {
    referralHits.set(key, { windowStartedAt: now, count: 1 })
    return false
  }
  seen.count += 1
  return seen.count > REFERRAL_PER_WINDOW
}

/**
 * What a code is worth, before anybody pays, and who is handing it out.
 *
 * It named no partner at all until a driving school asked to be visible to the
 * learners it sends. `partner` is `partners.display_name` and nothing else: a
 * name the partner typed into their own portal knowing where it appears. A
 * partner who has never filled that field in is null here, which is every row
 * that existed before the column did.
 *
 * That field does make this endpoint an oracle it was not before -- a code
 * guessed correctly now yields a name as well as a number. It is accepted
 * rather than overlooked: the codes are printed on flyers and read aloud in
 * lessons, the name is one the partner published on purpose, and the rate
 * limiter above already stands between a guesser and the namespace.
 *
 * `unknown` rather than an error for a code that resolves to nothing, and the
 * same answer for a disabled code, an expired one, and one belonging to a
 * suspended partner. There is nothing useful to tell somebody probing, and a
 * specific message is only a hint. The name rides on the `ok` branch alone, so
 * a suspended partner's name leaves the page at the same moment their discount
 * does rather than lingering on a screen that no longer sells at their price.
 */
async function handleReferral(
  request: Request,
  url: URL,
  env: Env,
  cors: HeadersInit,
): Promise<Response> {
  const from = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (tooManyReferralLookups(from, Date.now())) {
    return json({ error: 'Too many attempts. Try again in a minute.' }, 429, cors)
  }

  const product = url.searchParams.get('product') ?? DEFAULT_PRODUCT
  if (!PRODUCT.test(product)) return json({ error: 'product not recognized' }, 400, cors)

  const price = await currentPrice(env)
  if (price === null) return json({ error: 'Could not read the price' }, 502, cors)

  const outcome = await resolveReferral(env.DB, {
    code: url.searchParams.get('code'),
    product,
    listAmountCents: price.unitAmount,
  })
  return json(
    {
      status: outcome.status,
      // The list price as well as the discounted one, so the paywall can show
      // what is being saved without a second call that could disagree.
      listAmount: price.unitAmount,
      unitAmount: outcome.amountCents,
      currency: price.currency,
      discountBps: outcome.status === 'ok' ? outcome.referral.discountBps : 0,
      /**
       * Who sent them, or null -- and null is also what a partner who has
       * switched their branding off gets, on every surface at once.
       *
       * This was written as two independent fields, `partner` for the credit
       * line and `branded` for the header, on the reading that they answer two
       * questions. They do not. The design document settles it in one sentence:
       * unchecked, "they see HowardsLantern.com as they do today and the
       * business name appears *nowhere at all*".
       *
       * Gating only the header left a partner with no way to withdraw their
       * name from anything. An empty save is refused now that the name is
       * required, so the field that used to be the way out is closed, and the
       * switch that replaced it took the name off the header while leaving it
       * on the landing page and beside the price. An instructor who applied
       * under her own name could change what it said and never take it down.
       * The security lens found that; see reviews/004-security.md F1.
       *
       * So the switch decides whether the name leaves the worker, and every
       * surface follows from that one answer rather than from three.
       */
      partner:
        outcome.status === 'ok' && outcome.referral.privateBranding
          ? outcome.referral.partnerName
          : null,
      /**
       * Kept as its own key, and now exactly `partner !== null`.
       *
       * Not for compatibility with a deployed client: nothing has ever shipped
       * that reads this, and an earlier draft of this comment claimed otherwise
       * -- `git grep branded origin/main -- src worker` is empty. It is kept
       * because of the worker this one replaces, which has no `private_branding`
       * column and sends `partner` for every live code. Pages and the worker
       * deploy as two steps, and the second is the one CLAUDE.md says is quiet
       * to forget; a client that inferred branding from `partner !== null` would
       * then put every partner's name at the top of every screen, with no switch
       * in existence to take it back down. An absent flag reads as false, which
       * is our own name, which is the safe direction to fail in.
       *
       * tests/e2e/referral.spec.ts drives that older body directly.
       */
      branded:
        outcome.status === 'ok' &&
        outcome.referral.privateBranding &&
        outcome.referral.partnerName !== null,
    },
    200,
    cors,
  )
}

/**
 * The buyer's own browser, back from Stripe. We ask Stripe directly whether the
 * session is paid rather than trusting the redirect, which is just a URL anyone
 * could type. This usually beats the webhook, so it is the path that actually
 * grants access; the webhook is the backstop for a tab closed too early.
 */
async function handleClaim(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const body = await readJson<{ deviceId?: string; sessionId?: string }>(request)
  const deviceId = body?.deviceId ?? ''
  const sessionId = body?.sessionId ?? ''
  if (!isDeviceId(deviceId)) return json({ error: 'deviceId required' }, 400, cors)
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: 'sessionId required' }, 400, cors)

  const session = await retrieveCheckoutSession(stripeConfig(env), sessionId)
  const result = await recordPurchase(env.DB, session, deviceId)
  return json(result, result.entitled ? 200 : 402, cors)
}

async function handleRedeem(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const body = await readJson<{ deviceId?: string; code?: string }>(request)
  const deviceId = body?.deviceId ?? ''
  const code = body?.code ?? ''
  if (!isDeviceId(deviceId)) return json({ error: 'deviceId required' }, 400, cors)

  const result = await redeemRecoveryCode(env.DB, deviceId, code)
  if (result.entitled) return json(result, 200, cors)
  // 409 rather than another 404, because this is the one refusal where the code
  // is real and the person holding it may well be the person who paid. A
  // support mail saying "it tells me my code is not recognized" cannot be told
  // apart from a typo; one quoting this sentence names the cause.
  if (result.refusedBecause === 'device-limit') {
    const error = `That code is already in use on ${DEVICE_LIMIT} devices. Open the app on one of those, or contact support.`
    return json({ error, ...result }, 409, cors)
  }
  return json({ error: 'That code was not recognized', ...result }, 404, cors)
}

/**
 * The crash sink. A second sink rather than a branch of the first, because what
 * it writes is different in kind: `events` is a closed enum plus integers,
 * `errors` carries a message and a stack. Keeping them in separate tables is
 * what stops the public stats endpoint from ever being able to read one out.
 *
 * 204 always, for the same reason /api/event is: the page that sent this may
 * be in the middle of falling over, and is certainly not listening.
 */
async function handleCrash(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: cors })
  let row = null
  try {
    row = parseError(JSON.parse(await request.text()) as unknown)
  } catch {
    // Not JSON, or not one of ours. Silently, as with the event sink.
  }
  if (row === null) return noContent
  try {
    await recordCrash(env.DB, row, Date.now())
  } catch (error) {
    console.error('crash report dropped', error)
  }
  return noContent
}

/**
 * Feedback, which is not a sink.
 *
 * The two endpoints above answer 204 whatever happens, because nothing is
 * listening. This one is the opposite: somebody typed something, pressed Send,
 * and is watching the button. Silence here is the app losing what they wrote
 * and telling them it went fine, which is worse than no feedback screen at all.
 * So it answers honestly -- including "you already sent one", which is a fact
 * the sender is owed rather than a rejection to hide.
 *
 * `{ ok: false }` carries no reason. The client validates first, so a bad shape
 * arriving here is a bug or a probe, and neither needs to be told which fields
 * would have worked.
 */
async function handleFeedback(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const row = parseFeedback(await readJson<unknown>(request))
  if (row === null) return json({ ok: false }, 400, cors)

  const now = Date.now()
  // Answered as a success, because from the sender's side it is one: what they
  // had to say has been said. The alternative is an error for doing nothing
  // wrong, and a second copy of a comment we already have.
  if (await sentRecently(env.DB, row.session, now)) {
    return json({ ok: true, duplicate: true }, 200, cors)
  }
  // The same edge answer the events get, taken from the connection rather than
  // the body -- a rating with no idea where it came from was the gap that made
  // the one real production row unattributable after `events` was cleared.
  await recordFeedback(env.DB, row, now, readGeo(request))
  return json({ ok: true }, 200, cors)
}

/**
 * Cached for five minutes, per window, the same way the price is: a public
 * endpoint that runs six grouped queries should not be a way to generate load.
 */
let cachedStats: { at: number; days: number; body: unknown } | null = null

/**
 * Public, and aggregates only.
 *
 * Public because the one client that matters cannot send an `Authorization`
 * header, and a token in a query string is a secret pasted into a chat log.
 * That access constraint and the privacy constraint want the same thing: if it
 * cannot be published it should not be on an endpoint a browser can reach.
 *
 * So: no auth, and nothing to authorize. Counts, rates and distributions --
 * never a row, never a session id, never a single question's answer.
 */
async function handleStats(url: URL, env: Env): Promise<Response> {
  const days = windowDays(url.searchParams.get('days'))
  const now = Date.now()
  const headers = {
    // Readable by anyone, from anywhere, with no headers set. That is the
    // shape, not an oversight.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  }
  if (cachedStats !== null && cachedStats.days === days && now - cachedStats.at < 300_000) {
    return json(cachedStats.body, 200, headers)
  }
  const body = await computeStats(env.DB, days, now)
  cachedStats = { at: now, days, body }
  return json(body, 200, headers)
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const payload = await request.text()
  const valid = await verifyWebhookSignature(
    payload,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET,
  )
  if (!valid) return json({ error: 'Bad signature' }, 400, {})

  const event = JSON.parse(payload) as StripeEvent
  if (event.type === 'checkout.session.completed') {
    // A valid signature says Stripe sent this, not that it was about us: the
    // account is shared with another app and every endpoint on it receives
    // every event. Both recorders refuse anything this app did not start, and
    // each refuses the other's kind -- a pack of tokens is never the course.
    if (isQuestionsSession(event.data.object)) {
      await recordCredits(env.DB, event.data.object, questionsDeps(env, null))
    } else {
      await recordPurchase(env.DB, event.data.object, null)
    }
  }
  /**
   * The money going back. A refund is a refund, whatever fraction it was.
   *
   * This used to turn on `isFullyRefunded`, on the reasoning that a goodwill
   * dollar back has not un-sold anything and revoking a course somebody is
   * halfway through would be a support ticket caused by the fix. Sound, and
   * wrong here, because of what a refund at this business actually looks like:
   * Stripe keeps its fee on a refund, so returning the whole $15.99 costs us
   * $0.76 of our own money. Every refund we issue therefore holds that back --
   * $15.23 of $15.99 -- and **every one of them is partial to Stripe**.
   *
   * So the gate never opened. A buyer could be refunded all but the processing
   * fee, keep the product, and leave a commission standing on money that had
   * gone back. That is not the edge case the gate was written for; it was the
   * only case there was going to be.
   *
   * No threshold replaces it. A threshold is a number somebody has to keep in
   * step with a refund policy that lives outside this repository, and the first
   * time the policy moves the number is silently wrong. Either money went back
   * or it did not.
   *
   * A charge carries no session id and no metadata of ours, so the match is on
   * the payment intent recorded with the purchase. That is also what keeps the
   * other app on this account out of it: only intents this app wrote are in
   * that column, so their refunds match nothing.
   */
  if (event.type === 'charge.refunded') {
    const intent = event.data.object.payment_intent
    const at = Math.floor(Date.now() / 1000)
    if (typeof intent === 'string') {
      // One call, which revokes the access and reverses the commission
      // together. They were briefly two, and a mutation test found the second
      // could be deleted without a single test noticing -- because
      // `markRefunded` had been doing both jobs all along.
      //
      // Logged rather than answered with an error. A refund that matches
      // nothing is the ordinary case for a shared account, not a failure.
      if (!(await markRefunded(env.DB, intent, at))) {
        console.log('refund matched no purchase of ours')
      }
    }
  }
  // Anything else is acknowledged so Stripe stops retrying it -- including the
  // other app's purchases, which we will never want and should not spend a
  // week of retries and a warning email refusing.
  return json({ received: true }, 200, {})
}

function stripeConfig(env: Env): StripeConfig {
  return { secretKey: env.STRIPE_SECRET_KEY, apiBase: env.STRIPE_API_BASE }
}

/**
 * What the question-token routes and the webhook's half of them are given.
 * The return address is an allowed origin, as the course checkout's is: a
 * request naming its own origin decides nothing about where a buyer lands.
 */
function questionsDeps(env: Env, origin: string | null): QuestionsDeps {
  return {
    db: env.DB,
    stripe: stripeConfig(env),
    prices: env.STRIPE_TOKEN_PRICES,
    returnTo: allowedOrigin(origin, env) ?? firstAllowedOrigin(env),
    sendMail: mailerFor({
      binding: env.SEND_EMAIL,
      apiKey: env.RESEND_API_KEY,
      from: env.PARTNER_FROM ?? 'partners@howardslantern.com',
    }),
    now: () => Math.floor(Date.now() / 1000),
  }
}

/**
 * The three things the partner API is not allowed to reach for itself, built
 * from whatever the deployment actually has.
 *
 * Injected rather than imported by the handlers, the way `newCode` is in
 * `recordPurchase`, so the suite drives the real code path with a sender it can
 * read and a challenge it can pass or fail on purpose.
 */
function partnerDeps(env: Env) {
  return {
    sendMail: mailerFor({
      binding: env.SEND_EMAIL,
      apiKey: env.RESEND_API_KEY,
      from: env.PARTNER_FROM ?? 'partners@howardslantern.com',
    }),
    verifyTurnstile: turnstileFor(env.TURNSTILE_SECRET),
    ask: askerFor(env.ANTHROPIC_API_KEY),
    leadAssist: leadAssistFor(env.ANTHROPIC_API_KEY),
    /**
     * Undefined unless `ASK_VIA_MESH` is on, and undefined is what the two ask
     * handlers read as "answer the way you always have". The mesh ships inert:
     * a deploy carrying all of it changes nothing a visitor sees until this
     * variable is set, and unsetting it is the whole of the rollback.
     */
    askMesh: meshAskerFor({
      enabled: env.ASK_VIA_MESH,
      privateKey: env.MESH_PRIVATE_KEY,
      coarse: env.COARSE,
      now: () => Math.floor(Date.now() / 1000),
    }),
    /**
     * The store the editor writes to, for the last-hop audience check only.
     *
     * Without it that check reads the entry list compiled at build time, and an
     * entry added through /admin is refused however correct it is -- the asker
     * gets the contact address for a question that now has a written answer.
     * See `liveEntryFor`.
     */
    kb: env.KB,
    now: () => Math.floor(Date.now() / 1000),
    portalOrigin: env.PARTNER_ORIGIN ?? 'https://howardslantern.com',
    /**
     * Where a new application is announced. `SUPPORT_EMAIL` is the operator's
     * own address and is already the one `allowed_destination_addresses`
     * permits, so this reaches somebody on the pilot's mail binding rather than
     * needing a second name nobody has verified.
     */
    operatorEmail: env.SUPPORT_EMAIL,
    apologiseTo: env.APOLOGISE_TO,
  }
}

/**
 * The operator's identity, as whatever the deployment actually has.
 *
 * Built per request the way `partnerDeps` is. `operatorFor` refuses everything
 * when any of the three is missing, so a worker deployed before the Access
 * application exists serves an admin portal on which nothing works -- which is
 * the right direction for the failure to point.
 */
function adminDeps(env: Env) {
  const partner = partnerDeps(env)
  return {
    now: () => Math.floor(Date.now() / 1000),
    // The partner API's sender and origin, not a second copy of how they are
    // built: an approval email from a different From address than every other
    // partner message is one a spam filter reads as a different sender.
    sendMail: partner.sendMail,
    portalOrigin: partner.portalOrigin,
    verifyOperator: operatorFor({
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      operators: env.ADMIN_OPERATORS,
    }),
    /**
     * The knowledge base an operator edits, behind the same Access application
     * that fronts every other admin route. Undefined until the bucket exists,
     * and undefined means those routes are not there at all rather than open.
     */
    kb: {
      kb: env.KB,
      now: () => Math.floor(Date.now() / 1000),
      meshPrivateKey: env.MESH_PRIVATE_KEY,
    },
    /**
     * What the labelling card's search reads: the box's own published file
     * and vector index, so a law the search finds is a law the box could.
     */
    evalAdmin: {
      lawsFor: lawsFromPages,
      nearLaws: nearLawsFor(env.AI, env.LAWS),
    },
  }
}

/**
 * A v4 UUID minted by the browser. Constrained because it is a primary key and
 * arrives from the open internet — an unbounded string here is a way to fill
 * the table up.
 */
function isDeviceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
}

function firstAllowedOrigin(env: Env): string {
  return allowedOrigins(env)[0] ?? ''
}

function allowedOrigin(origin: string | null, env: Env): string | null {
  if (origin === null) return null
  return allowedOrigins(env).includes(origin) ? origin : null
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = allowedOrigin(origin, env)
  if (allowed === null) return {}
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * A state's retrieval file, read from the Pages build that published it
 * (worker/src/law-retrieval.ts). A 200 is edge-cached for an hour: a corpus changes when
 * Pages is deployed, and an hour of the previous version is the same lag the
 * learner's own cached bundle has. Anything but a 200 throws, which the box
 * answers as `no-laws` -- never as a road-law answer without its laws.
 */
async function lawsFromPages(code: string): Promise<AskLaw[]> {
  return listFromPages<AskLaw>(lawsPath(code))
}

/**
 * Any list Pages publishes for the box: a state's laws, or the nationwide
 * topics and a topic's every-state file (law-topics.ts). One reader, so the
 * topic files get the same cache rule as the state files -- the reason for it
 * below applies to them on the deploy that first publishes them.
 */
async function listFromPages<T>(at: string): Promise<T[]> {
  // Only a 200 is cached: a 404 cached for an hour would keep road law
  // answering `no-laws` long after the Pages deploy that publishes the file --
  // the worker ships first, so that window opens on every deploy.
  const response = await fetch(`${LAWS_ORIGIN}${at}`, {
    cf: { cacheTtlByStatus: { '200': 3600, '300-599': 0 }, cacheEverything: true },
  })
  if (!response.ok) throw new Error(`${at} answered ${response.status}`)
  const list: unknown = await response.json()
  if (!Array.isArray(list)) throw new Error(`${at} is not a list`)
  return list as T[]
}
