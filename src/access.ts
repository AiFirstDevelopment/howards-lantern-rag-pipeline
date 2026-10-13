/**
 * Who this browser is, and whether it has paid.
 *
 * There is no login. A learner who is about to take a 25-question test should
 * not be asked to invent a password first, and the thing being sold is three
 * dollars of practice, not an account. So the browser identifies itself with a
 * random id it mints on first use, and the purchase is attached to that.
 *
 * The cost of that choice is that clearing site data, or moving to a phone,
 * looks like a new browser. That is what the recovery code is for: it is shown
 * once after payment and can be typed into any other browser to move the
 * purchase across. See worker/src/recovery.ts for the code itself.
 */

import { uuid } from './uuid'

const DEVICE_KEY = 'teach-and-test/v1/device-id'
const ENTITLED_KEY = 'teach-and-test/v1/entitled'
const CODE_KEY = 'teach-and-test/v1/recovery-code'

export interface Entitlement {
  entitled: boolean
  recoveryCode: string | null
}

export const NOT_ENTITLED: Entitlement = { entitled: false, recoveryCode: null }

/** Stable for the life of this browser's storage. Minted on first read. */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY)
    if (stored !== null && stored.length > 0) return stored
    const fresh = uuid()
    localStorage.setItem(DEVICE_KEY, fresh)
    return fresh
  } catch {
    // Private mode with storage blocked: the id lasts as long as the tab, which
    // is enough to buy and use, just not to come back to.
    return uuid()
  }
}

/**
 * The last answer the server gave, so a paid learner is not locked out of the
 * tests they bought while the network is slow or down. It is a cache, not the
 * authority — the worker is asked again on every load.
 */
export function cachedEntitlement(): Entitlement {
  try {
    if (localStorage.getItem(ENTITLED_KEY) !== 'yes') return NOT_ENTITLED
    return { entitled: true, recoveryCode: localStorage.getItem(CODE_KEY) }
  } catch {
    return NOT_ENTITLED
  }
}

export function cacheEntitlement(entitlement: Entitlement): void {
  try {
    if (entitlement.entitled) {
      localStorage.setItem(ENTITLED_KEY, 'yes')
      if (entitlement.recoveryCode !== null) {
        localStorage.setItem(CODE_KEY, entitlement.recoveryCode)
      }
    } else {
      localStorage.removeItem(ENTITLED_KEY)
      localStorage.removeItem(CODE_KEY)
    }
  } catch {
    // Same as above: it still works, it just will not survive a reload.
  }
}

/** `LP-1A2B-3C4D`, matching what the worker prints on the receipt screen. */
export function formatRecoveryCode(code: string): string {
  return code.startsWith('LP-') ? code : `LP-${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * What the paywall says it costs, until Stripe has told us otherwise.
 *
 * Only ever a placeholder for the first paint: the real figure comes from the
 * price object, so changing the price in Stripe changes what the app quotes
 * without anyone editing a component. Kept in step with the live price so a
 * slow network never shows a number we do not charge.
 */
export const FALLBACK_PRICE = { unitAmount: 999, currency: 'usd' }

export function formatPrice(price: { unitAmount: number; currency: string }): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    // $3 rather than $3.00 when it is a whole number of dollars, which is how
    // a price is spoken; $2.99 keeps its cents.
    minimumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
  }).format(price.unitAmount / 100)
}

/**
 * How many full-length tests may be taken before paying.
 *
 * One. The first test is where a learner finds out that having read the 37
 * cards once is not the same as being ready — the corpus's own modelling puts a
 * single study pass at around a 2% chance of passing the real exam. Charging
 * before that moment means charging people who still believe they are ready,
 * which is both a worse offer and a worse argument.
 */
export const FREE_FULL_TESTS = 1

/**
 * How many sections of the study pass may be studied before paying (#391).
 *
 * One. The whole pass was free until 2026-09-22, with the price two gates
 * further on -- past the pass, then past the one free full test -- and in the
 * thirty days before the change 1,304 visitors produced 24 studiers, 349
 * answered cards between them, and nobody who reached either gate. Fourteen
 * of the 24 answered six cards or more, which is one Maryland section; seven
 * answered twelve or more. The offer has to arrive while somebody is still
 * here, and after one section most of them still are: six cards at most, a
 * taste of how the cards teach, and then the price.
 *
 * A constant rather than a rule so the wall can move by one line while the
 * experiment runs. Every free-tier sentence reads it -- `FREE_TO_START`, the
 * checkpoint that ends the free part, the README -- for the reason
 * `FREE_FULL_TESTS` gives: the copy and the gate must not be able to disagree.
 */
export const FREE_SECTIONS = 1

export function freeTestsRemaining(completedFullTests: number): number {
  return Math.max(0, FREE_FULL_TESTS - completedFullTests)
}

/**
 * Whether the partner programme is recruiting: the strip above both front
 * pages and the menu's "Become a partner" row are shown only while it is.
 *
 * Suspended, not removed. The partner page, the portal, the application form
 * and every referral link keep working; only the two invitations go, so a
 * programme that has stopped selling stops asking every visitor to join it.
 *
 * Open for exactly `open` and nothing else, because the failure that matters
 * is the quiet one: a deploy that forgot the line, or spelt it `Open`, would
 * show the invitations -- which is what the app always did, so nobody would
 * look. Failing closed means the mistake hides a strip rather than reopening a
 * programme by accident. `.env.production` is where the value lives, and
 * tests/unit/deploy-config.test.ts pins it.
 */
export function partnerProgramOpen(value: string | undefined): boolean {
  return value === 'open'
}

// `env?.` for the reason src/legal.ts gives: scripts/build-learner-kb.ts and
// scripts/partners.ts import this file under tsx, where there is no
// `import.meta.env`, and an unguarded read would kill both on load. The cast is
// for scripts/tsconfig.json, which typechecks partners.ts without Vite's types
// and refused `import.meta.env` as a property that does not exist -- the build
// stopped there. It is erased on compile, so Vite still sees the plain read.
export const PARTNER_PROGRAM_OPEN = partnerProgramOpen(
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PARTNER_PROGRAM,
)
