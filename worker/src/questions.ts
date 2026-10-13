import { PACKS, packForAmount, packOf, type Pack } from '../../src/pricing'
import type { MailSender } from './mail'
import {
  createQuestionsCheckoutSession,
  emailOf,
  isPaid,
  isQuestionsSession,
  retrieveCheckoutSession,
  retrievePrice,
  startedByThisApp,
  type CheckoutSession,
  type StripeConfig,
} from './stripe'

/**
 * Question tokens (docs/plans/trusted-by-date.md, decisions 20-24): a pack
 * bought through Stripe Checkout, held under a code rather than an account,
 * and spent by the worker one question at a time.
 *
 * Three routes and the webhook's half:
 *
 *   POST /api/questions/checkout          a pack -> a Checkout session
 *   GET  /api/questions/claim?session=    the code a paid session was recorded under
 *   GET  /api/questions/balance?code=     what a code has left, for "I have a code"
 *   GET  /api/questions/history?code=     the questions asked under a code, for any device holding it
 *
 * and `recordCredits`, which both the webhook and the claim call for the same
 * session; whichever arrives first writes the row and the other finds it.
 *
 * **The browser's count is never trusted.** The box shows a balance, but the
 * only balance that decides anything is `bought - spent` in `question_credits`,
 * debited here before the model is asked (learner-api.ts).
 *
 * **The price ids are a secret, not code.** `STRIPE_TOKEN_PRICES` is a JSON map
 * from a pack's dollars to its live Price id, set with `wrangler secret put` by
 * the person who created the Prices. Absent or incomplete, checkout answers 503
 * with a line the pop-up shows as *not for sale yet*, and everything else --
 * the free questions, a code already bought, the balance -- goes on working.
 * The amounts are not read from the secret: what a session is worth is decided
 * by `amount_total` against src/pricing.ts, the file the margin test holds.
 */

/** Crockford's base32, as the recovery code uses it: nothing to confuse with 1, 0 or V. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Ten characters, two more than the recovery code. A recovery code opens one
 * purchase on five browsers; a question code is spent by whoever holds it, is
 * meant to be shared across a classroom, and the balance endpoint answers for
 * any code typed into it. 32^10 is about 10^15.
 */
export const QUESTION_CODE_LENGTH = 10

export function makeQuestionCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  // Rejection-free because 256 is a multiple of 32, as in recovery.ts.
  let out = ''
  for (const byte of randomBytes(QUESTION_CODE_LENGTH)) out += ALPHABET[byte % ALPHABET.length]
  return out
}

/**
 * `LQ-1A2B3-C4D5E`. The prefix starts with L, which Crockford's alphabet does
 * not contain, so stripping it can never eat the first character of a code
 * typed without it -- the reason the recovery code's `LP` works the same way.
 */
export function formatQuestionCode(code: string): string {
  return `LQ-${code.slice(0, 5)}-${code.slice(5)}`
}

/** What somebody actually types -- lower case, spaces, the prefix, the three substitutions -- or null. */
export function normalizeQuestionCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^LQ/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
  if (cleaned.length !== QUESTION_CODE_LENGTH) return null
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null
  return cleaned
}

/**
 * The live Price id for every pack, from the secret, or null when any is
 * missing. All or nothing: a pop-up offering four packs of which one fails at
 * the button is worse than one that says plainly the packs are not on sale.
 */
export function tokenPricesFrom(raw: string | undefined): Map<number, string> | null {
  if (raw === undefined || raw.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('STRIPE_TOKEN_PRICES is not JSON')
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const prices = new Map<number, string>()
  for (const pack of PACKS) {
    const id = (parsed as Record<string, unknown>)[String(pack.dollars)]
    if (typeof id !== 'string' || !/^price_[A-Za-z0-9]+$/.test(id)) {
      console.error(`STRIPE_TOKEN_PRICES names no Price for the $${pack.dollars} pack`)
      return null
    }
    prices.set(pack.dollars, id)
  }
  return prices
}

/** A code's paid questions and what came of each, for `npm run questions -- --code`; run there over the D1 REST API, here by the suite. */
export const CODE_QUESTIONS = `SELECT asked_at, state, question, model FROM learner_questions
  WHERE credit_code = ?1 AND paid = 1 ORDER BY asked_at, id`

/** How many exchanges the history route answers with: the device keeps the same number (src/storage.ts). */
export const HISTORY_LIMIT = 50

/**
 * A code's answered questions, newest first. `credit_code = ?1` is the whole
 * of what keeps one code's questions from another holder's screen.
 */
export const CODE_HISTORY = `SELECT conversation, question, answer, scope, sources, state, lang, asked_at FROM learner_questions
  WHERE credit_code = ?1 AND answer IS NOT NULL AND answer <> ''
  ORDER BY asked_at DESC, id DESC LIMIT ${HISTORY_LIMIT}`
export const CODE_BALANCE = 'SELECT bought, spent FROM question_credits WHERE code = ?1'

/** What a code has left, or null for a code nobody holds. */
export async function balanceOf(db: D1Database, code: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT bought - spent AS left FROM question_credits WHERE code = ?')
    .bind(code)
    .first<{ left: number }>()
  return row === null ? null : row.left
}

/**
 * Take `tokens` from a code, or nothing. One statement, conditional on the
 * balance, so two devices sharing a classroom's code and asking at the same
 * moment cannot both spend its last token: the second UPDATE matches no row.
 * Null when the code is unknown or holds too few.
 */
export async function debit(db: D1Database, code: string, tokens: number): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE question_credits SET spent = spent + ?
        WHERE code = ? AND bought - spent >= ?
        RETURNING bought - spent AS left`,
    )
    .bind(tokens, code, tokens)
    .first<{ left: number }>()
  return row === null ? null : row.left
}

/** Give back what `debit` took, when the answer never came. Returns the balance after. */
export async function refund(db: D1Database, code: string, tokens: number): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE question_credits SET spent = spent - ?
        WHERE code = ? AND spent >= ?
        RETURNING bought - spent AS left`,
    )
    .bind(tokens, code, tokens)
    .first<{ left: number }>()
  return row === null ? null : row.left
}

export interface Credited {
  /** As a person reads it: LQ-XXXXX-XXXXX. */
  code: string
  left: number
  tokens: number
}

export interface RecordDeps {
  newCode?: () => string
  /** Sends the code to the address Stripe collected; absent, nothing is mailed. */
  sendMail?: MailSender
  now: () => number
}

/**
 * Write down a paid pack, once, under its code.
 *
 * Refuses, as recordPurchase does, anything unpaid or not started by this app,
 * and anything that is not a pack of tokens. **The tokens are decided by what
 * was paid**, `amount_total` against src/pricing.ts -- never by metadata, which
 * this app wrote but a webhook from the shared account cannot prove it did,
 * and never by the Price id, which a person set. An amount that is no pack's
 * credits nothing and says so in the log: a Price created at the wrong amount
 * must not sell tokens at a price the margin test never saw.
 *
 * A browser that already held a code sends it as `merge_from`; its remainder
 * moves onto the new code on the write that creates it, and only then, so a
 * redelivered webhook moves nothing twice. The old code keeps its history --
 * the questions it paid for still carry it -- with `bought` brought down to
 * what it spent.
 */
export async function recordCredits(
  db: D1Database,
  session: CheckoutSession,
  deps: RecordDeps,
): Promise<Credited | null> {
  if (!isPaid(session) || !startedByThisApp(session) || !isQuestionsSession(session)) return null
  const pack = (session.currency ?? 'usd').toLowerCase() === 'usd' ? packForAmount(session.amount_total) : null
  if (pack === null) {
    console.error(`question tokens: session ${session.id} paid ${session.amount_total} ${session.currency}, which is no pack`)
    return null
  }

  const existing = await recordedUnder(db, session.id)
  if (existing !== null) return { ...existing, tokens: pack.tokens }

  let code = normalizeQuestionCode(session.metadata?.question_code ?? null) ?? (deps.newCode ?? makeQuestionCode)()
  let inserted = await insertCredits(db, code, pack, session.id, deps.now())
  if (inserted === null) {
    // Either the other caller recorded this session first, or -- once in 10^15
    // -- the code minted at checkout is already somebody's. The first is
    // adopted; the second gets a fresh code rather than the other buyer's.
    const winner = await recordedUnder(db, session.id)
    if (winner !== null) return { ...winner, tokens: pack.tokens }
    code = (deps.newCode ?? makeQuestionCode)()
    inserted = await insertCredits(db, code, pack, session.id, deps.now())
    if (inserted === null) return null
  }

  const from = normalizeQuestionCode(session.metadata?.merge_from ?? null)
  if (from !== null && from !== code) await carryOver(db, from, code)

  const left = (await balanceOf(db, code)) ?? pack.tokens
  if (deps.sendMail !== undefined) await mailCode(deps.sendMail, session, code, pack, left)
  return { code: formatQuestionCode(code), left, tokens: pack.tokens }
}

async function recordedUnder(db: D1Database, session: string): Promise<{ code: string; left: number } | null> {
  const row = await db
    .prepare('SELECT code, bought - spent AS left FROM question_credits WHERE stripe_session = ?')
    .bind(session)
    .first<{ code: string; left: number }>()
  return row === null ? null : { code: formatQuestionCode(row.code), left: row.left }
}

async function insertCredits(db: D1Database, code: string, pack: Pack, session: string, now: number): Promise<string | null> {
  const row = await db
    .prepare(
      `INSERT INTO question_credits (code, bought, spent, created_at, stripe_session)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING code`,
    )
    .bind(code, pack.tokens, now, session)
    .first<{ code: string }>()
  return row?.code ?? null
}

/**
 * The old code's remainder onto the new one. Conditional on the remainder
 * still being what was read, so a question spent from another device between
 * the read and the write moves nothing rather than more than was there. One
 * batch, which D1 runs as one transaction, and the credit only where the
 * emptying changed a row (`changes()`): two statements run apart could empty
 * the old code and die before crediting the new, losing the remainder.
 */
async function carryOver(db: D1Database, from: string, to: string): Promise<void> {
  const left = await balanceOf(db, from)
  if (left === null || left <= 0) return
  await db.batch([
    db.prepare('UPDATE question_credits SET bought = spent WHERE code = ? AND bought - spent = ?').bind(from, left),
    db.prepare('UPDATE question_credits SET bought = bought + ? WHERE code = ? AND changes() > 0').bind(left, to),
  ])
}

/**
 * The code, in the buyer's inbox. The course's recovery code is not mailed --
 * the FAQ says so -- but a pack is meant to be carried to a classroom's other
 * machines, and a code that lived only on the screen it was shown on is a
 * pack lost with a closed tab. Best effort: a mail that does not go leaves
 * the code on the screen and on Stripe's receipt, and costs the sale nothing.
 */
async function mailCode(sendMail: MailSender, session: CheckoutSession, code: string, pack: Pack, left: number): Promise<void> {
  const to = emailOf(session)
  if (to === null) return
  const shown = formatQuestionCode(code)
  const spanish = session.metadata?.lang === 'es'
  try {
    await sendMail(
      spanish
        ? {
            to,
            subject: `Su código de preguntas: ${shown}`,
            text: [
              `Gracias. Sus ${pack.tokens} créditos de preguntas están guardados con este código:`,
              '',
              `    ${shown}`,
              '',
              `Saldo: ${left} créditos. Un crédito es una pregunta sobre un estado; una pregunta para todo el país cuesta cinco.`,
              'Para usarlos en otro dispositivo, abra "Haga una pregunta", toque el saldo y elija "Tengo un código". Un mismo código sirve para todos los dispositivos de una clase.',
              'Los créditos no caducan. Un paquete sin usar se reembolsa: escriba a refund@howardslantern.com con este código.',
            ].join('\n'),
          }
        : {
            to,
            subject: `Your question code: ${shown}`,
            text: [
              `Thank you. Your ${pack.tokens} question tokens are held under this code:`,
              '',
              `    ${shown}`,
              '',
              `Balance: ${left} tokens. A token is a question about one state; a nationwide question is five.`,
              'To use them on another device, open "Ask a question", tap the balance and choose "I have a code". One code works on every device in a classroom.',
              'Tokens do not expire. An unused pack is refundable: write to refund@howardslantern.com with this code.',
            ].join('\n'),
          },
    )
  } catch (error) {
    console.error('question tokens: the code could not be mailed', error)
  }
}

export interface QuestionsDeps {
  db: D1Database
  stripe: StripeConfig
  /** `STRIPE_TOKEN_PRICES`, unparsed. */
  prices: string | undefined
  /** Where Stripe sends the buyer back: an allowed origin, never one the request named on its own. */
  returnTo: string
  sendMail?: MailSender
  now: () => number
  newCode?: () => string
}

/**
 * The path the buyer was on, so Stripe sends them back to the same page --
 * `/drivers/MD/`, a comparison page -- rather than to the front page with a
 * different state on it. Anything that does not look like one of our paths
 * is the root.
 */
function returnPath(value: unknown): string {
  return typeof value === 'string' && /^\/[A-Za-z0-9/_-]{0,200}$/.test(value) ? value : '/'
}

/**
 * Every live Price's amount, read once an hour per isolate. A Price created at
 * the wrong amount, or recurring, would charge a figure the pop-up does not
 * show; refusing to sell it is the one place that mistake can be caught
 * before a buyer finds it.
 */
const checkedPrices = new Map<string, { at: number; ok: boolean }>()

async function priceMatches(stripe: StripeConfig, priceId: string, pack: Pack, now: number): Promise<boolean> {
  const cached = checkedPrices.get(priceId)
  if (cached !== undefined && now - cached.at < 3600) return cached.ok
  const price = await retrievePrice(stripe, priceId)
  const ok = price.unit_amount === pack.cents && price.currency.toLowerCase() === 'usd' && price.recurring === null
  if (!ok) {
    console.error(`question tokens: ${priceId} is ${price.unit_amount} ${price.currency}${price.recurring === null ? '' : ' recurring'}, not the $${pack.dollars} pack`)
  }
  checkedPrices.set(priceId, { at: now, ok })
  return ok
}

/** The line the pop-up shows when the packs cannot be sold: no secret, or a Price that is not the pack's. */
export const NOT_FOR_SALE = 'not-for-sale'

export async function handleQuestionsCheckout(request: Request, deps: QuestionsDeps, cors: HeadersInit): Promise<Response> {
  const body = await readJson<{ pack?: unknown; lang?: unknown; from?: unknown; path?: unknown }>(request)
  const pack = packOf(body?.pack)
  if (pack === null) return json({ error: 'pack not recognized' }, 400, cors)
  const lang = body?.lang === 'es' ? 'es' : 'en'

  const prices = tokenPricesFrom(deps.prices)
  const priceId = prices?.get(pack.dollars)
  if (priceId === undefined) return json({ error: NOT_FOR_SALE }, 503, cors)
  let matches: boolean
  try {
    matches = await priceMatches(deps.stripe, priceId, pack, deps.now())
  } catch (error) {
    console.error('question tokens: could not read the Price', error)
    return json({ error: 'Could not reach the payment page' }, 502, cors)
  }
  if (!matches) return json({ error: NOT_FOR_SALE }, 503, cors)

  const code = (deps.newCode ?? makeQuestionCode)()
  const path = returnPath(body?.path)
  const session = await createQuestionsCheckoutSession(deps.stripe, {
    priceId,
    code,
    shownCode: formatQuestionCode(code),
    tokens: pack.tokens,
    lang,
    mergeFrom: normalizeQuestionCode(body?.from),
    // The query before the hash: `#ask?session=` is not the ask route, and the
    // page would open on the front page with the session lost in a fragment.
    successUrl: `${deps.returnTo}${path}?session={CHECKOUT_SESSION_ID}#ask`,
    cancelUrl: `${deps.returnTo}${path}#ask`,
  })
  if (session.url === undefined) return json({ error: 'Stripe returned no URL' }, 502, cors)
  return json({ checkoutUrl: session.url }, 200, cors)
}

/**
 * The buyer's own browser, back from Stripe. The table first, because the
 * webhook usually lands before the redirect does; then Stripe itself, as
 * /api/claim does for the course, so a webhook that is late or lost does not
 * leave somebody who paid staring at nothing. An unpaid session is 202, and
 * the page asks again for a few seconds.
 */
export async function handleQuestionsClaim(url: URL, deps: QuestionsDeps, cors: HeadersInit): Promise<Response> {
  const session = url.searchParams.get('session') ?? ''
  if (!/^cs_[A-Za-z0-9_]+$/.test(session)) return json({ error: 'session required' }, 400, cors)
  const recorded = await recordedUnder(deps.db, session)
  if (recorded !== null) return json(recorded, 200, cors)
  let checkout: CheckoutSession
  try {
    checkout = await retrieveCheckoutSession(deps.stripe, session)
  } catch (error) {
    console.error('question tokens: could not read the session', error)
    return json({ error: 'Could not reach Stripe' }, 502, cors)
  }
  const credited = await recordCredits(deps.db, checkout, { newCode: deps.newCode, sendMail: deps.sendMail, now: deps.now })
  if (credited !== null) return json({ code: credited.code, left: credited.left }, 200, cors)
  if (!isPaid(checkout) && startedByThisApp(checkout) && isQuestionsSession(checkout)) {
    return json({ pending: true }, 202, cors)
  }
  return json({ error: 'That checkout bought no question tokens' }, 404, cors)
}

/**
 * How often one address may ask what a code holds, per isolate -- the same
 * shape and the same reasoning as the referral lookup in index.ts: the
 * endpoint is an oracle over a namespace of bearer codes, and an address is
 * never stored to count it.
 */
const BALANCE_WINDOW_MS = 60_000
const BALANCE_PER_WINDOW = 20
const balanceHits = new Map<string, { windowStartedAt: number; count: number }>()

function tooManyBalanceLookups(key: string, now: number): boolean {
  if (balanceHits.size > 5_000) balanceHits.clear()
  const seen = balanceHits.get(key)
  if (seen === undefined || now - seen.windowStartedAt >= BALANCE_WINDOW_MS) {
    balanceHits.set(key, { windowStartedAt: now, count: 1 })
    return false
  }
  seen.count += 1
  return seen.count > BALANCE_PER_WINDOW
}

/** "I have a code": what a code holds, under the spelling a person reads. */
export async function handleQuestionsBalance(request: Request, url: URL, deps: QuestionsDeps, cors: HeadersInit): Promise<Response> {
  if (tooManyBalanceLookups(request.headers.get('CF-Connecting-IP') ?? 'unknown', Date.now())) {
    return json({ error: 'Too many attempts. Try again in a minute.' }, 429, cors)
  }
  const code = normalizeQuestionCode(url.searchParams.get('code'))
  const left = code === null ? null : await balanceOf(deps.db, code)
  if (code === null || left === null) return json({ error: 'That code was not recognized' }, 404, cors)
  return json({ code: formatQuestionCode(code), left }, 200, cors)
}

export interface HistoryRow {
  conversation: string
  question: string
  answer: string
  scope: string | null
  sources: string[]
  state: string | null
  lang: string
  asked_at: number
}

/**
 * The questions asked under a code, on a device that holds it. Counted with
 * the balance lookups: it answers for any code typed into it, and the same
 * limit is what keeps it from being walked.
 */
export async function handleQuestionsHistory(request: Request, url: URL, deps: QuestionsDeps, cors: HeadersInit): Promise<Response> {
  if (tooManyBalanceLookups(request.headers.get('CF-Connecting-IP') ?? 'unknown', Date.now())) {
    return json({ error: 'Too many attempts. Try again in a minute.' }, 429, cors)
  }
  const code = normalizeQuestionCode(url.searchParams.get('code'))
  if (code === null || (await balanceOf(deps.db, code)) === null) return json({ error: 'That code was not recognized' }, 404, cors)
  const rows = await deps.db
    .prepare(CODE_HISTORY)
    .bind(code)
    .all<Omit<HistoryRow, 'sources'> & { sources: string | null }>()
  const questions: HistoryRow[] = (rows.results ?? []).map((row) => ({ ...row, sources: sourceIds(row.sources) }))
  return json({ code: formatQuestionCode(code), questions }, 200, cors)
}

/** A row's section ids; an unreadable column is no sources rather than a 500 for the whole history. */
function sourceIds(raw: string | null): string[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}
