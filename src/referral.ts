/**
 * Who sent this visitor, remembered on their own browser.
 *
 * A partner hands out `howardslantern.com/drivers/MD?ref=LANTERN20`. The code
 * has to survive the gap between arriving and paying, which is rarely one
 * sitting: somebody clicks a link on a phone, reads two cards, takes a test a
 * day later and buys the day after that. So it is stored, with a last-touch
 * window of sixty days -- the most recent code wins, because the most recent
 * link is the one that did the work.
 *
 * Two things this deliberately is not.
 *
 * It is **not a cookie and not a tracking identifier**. It is one short string
 * naming a shop or a driving school, in this browser's own storage, sent only
 * when a price is quoted or a checkout is started. Nothing about the visitor
 * goes with it.
 *
 * It is **not the authority on what the discount is**. The worker resolves the
 * code twice -- once so the buyer sees the real price, and once at checkout,
 * where a code disabled in between yields nothing. What is stored here is the
 * claim; the resolution is the worker's.
 *
 * Storage is per origin, which is why every partner link names one host. A code
 * captured on `howardslantern.com` does not exist for a buyer who comes back
 * via `howardslanterncertification.com`, and no code in this file can fix that
 * -- the portal generates every link against the one name instead.
 */

/**
 * Exported so a test that seeds a record seeds the one the app reads. A spec
 * holding its own copy of the string goes on passing after a re-key, green
 * because the app saw nothing at all rather than because the rule held.
 */
export const REFERRAL_KEY = 'teach-and-test/v1/referral'

/** Sixty days. Long enough for the gap between a flyer and a decision. */
const LAST_TOUCH_MS = 60 * 86_400_000

/**
 * The shape of a partner code, matching the worker's `normalizeCode`.
 *
 * Written twice on purpose, like `RESERVED_SEGMENTS` is: the app and the worker
 * are two builds and neither may import the other. Held together by
 * tests/unit/referral.test.ts, which reads the worker's copy as text.
 */
const CODE_SHAPE = /^[A-Z0-9]{3,32}$/

/** The code as the worker will hold it, or null if it could never be one. */
export function normalizeCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return CODE_SHAPE.test(cleaned) ? cleaned : null
}

interface StoredReferral {
  code: string
  at: number
  /**
   * The state the arriving link named, or null where it named none.
   *
   * It is stored because it cannot be recovered later: the state is only ever
   * in the address on the way in, and the code outlives that visit by sixty
   * days. A learner a partner sent to one state's page is not offered the way
   * back out to the picker (see canGoHome in src/App.tsx), and on the second
   * visit this field is the only thing that still knows which kind of link
   * they came in on.
   *
   * Optional because a browser that captured a code before this field existed
   * has a record without it. Missing reads as "named no state", which leaves
   * Home where it is -- the direction that cannot strand anybody on one
   * state's pages.
   */
  state?: string | null
  /**
   * The business name of the partner who sent them, as the worker last resolved
   * it, or null where there is none.
   *
   * Stored rather than asked for on every load, because the header is drawn
   * before any request could come back. A learner on a branded partner's link
   * would otherwise see `HowardsLantern.com` for a moment on every reload and
   * watch it flip, which is small and looks broken.
   *
   * It is a cache of somebody else's answer, so it can be out of date for
   * exactly one paint: `applyCode` in src/App.tsx re-quotes a live code on every
   * load and drops this the moment the worker refuses it.
   */
  partner?: string | null
  /**
   * Whether that partner asked for their name to stand in for ours.
   *
   * It is not a second answer any more. The switch decides whether the name
   * leaves the worker at all, so a record written by the current worker has
   * this true exactly when `partner` is a string.
   *
   * Held as its own field because a body without it has to read as "our own
   * name". A worker that predates the branding switch sends `partner` for every
   * live code and no flag, so a client that inferred branding from "there is a
   * name" would put every partner's name in the header the moment Pages shipped
   * ahead of the worker -- the forgotten-second-step failure CLAUDE.md names,
   * and one no partner could switch off, because the column deciding it would
   * not exist yet.
   */
  branded?: boolean
}

/** The name and flag a record carries, which travel together or not at all. */
interface Brand {
  name: string | null
  branded: boolean
}

interface LiveReferral extends Brand {
  code: string
  at: number
  state: string | null
}

/** The record this browser is carrying, or null once it is older than the window. */
function liveReferral(now: number): LiveReferral | null {
  try {
    const raw = localStorage.getItem(REFERRAL_KEY)
    if (raw === null) return null
    const stored = JSON.parse(raw) as StoredReferral
    const code = normalizeCode(stored?.code)
    if (code === null) return null
    if (typeof stored.at !== 'number' || now - stored.at > LAST_TOUCH_MS) return null
    return {
      code,
      at: stored.at,
      state: typeof stored.state === 'string' ? stored.state : null,
      // Missing reads as "no name" and "not branded", which is the record every
      // browser that followed a partner link before this field existed is
      // carrying -- and the direction that shows our own name rather than
      // inventing somebody else's.
      name: typeof stored.partner === 'string' ? stored.partner : null,
      branded: stored.branded === true,
    }
  } catch {
    // Storage blocked, or something that is not our JSON. Either way there is
    // no referral, which is the ordinary case for nearly every visitor.
    return null
  }
}

/** The code this browser is carrying, or null once it is older than the window. */
export function storedReferral(now = Date.now()): string | null {
  return liveReferral(now)?.code ?? null
}

/**
 * Whether the link that brought this browser here named a state, and is still
 * inside the window.
 *
 * The one question the menu asks of this file: a learner sent to a state by a
 * partner keeps that state, so Home is not offered to walk them off it. It
 * expires with the code because it is the same record -- and that clock is last
 * touch, not first: `applyCode` re-quotes a live code on every load and writes
 * the record back, so sixty days runs from the most recent visit. A learner who
 * keeps studying never ages out and keeps the state indefinitely. That is the
 * decision, taken on 2026-09-23 after the review panel found the plan had
 * promised a bound that was not there -- not an oversight. Giving the state its
 * own first-touch timestamp is the change if that is ever wanted, and it is its
 * own release.
 */
export function referralNamedState(now = Date.now()): boolean {
  const live = liveReferral(now)
  return live !== null && live.state !== null
}

/**
 * Remember a code that did not arrive on the address -- typed into the paywall,
 * or written back when the worker quotes one this browser already holds.
 *
 * Last touch rather than first: two partners both advertising is a case where
 * the second link is the one that brought them back, and first-touch would pay
 * somebody for a visit that did not convert. So a *different* code replaces the
 * record outright, state and all, and names no state of its own -- a code read
 * off a whiteboard says nothing about the link anybody arrived on.
 *
 * The same code keeps the state it was stored with, and that is not a nicety.
 * Every load carrying a code re-quotes it and writes the answer back
 * (`applyCode` in src/App.tsx), seconds after `captureReferral` recorded what
 * the link named -- so a write-back that dropped the state would erase it on
 * the very visit it arrived, and the learner a partner sent to one state would
 * be offered the way off it on every visit but the first.
 */
export function rememberReferral(
  code: string,
  now = Date.now(),
  brand: Brand | null = null,
): string | null {
  const same = keptFor(code, now)
  const state = same?.state ?? null
  // The quote's answer where there is one, and what is already stored where
  // there is not: this is called on every load carrying a live code, and a
  // write-back that dropped the name would take it off the header for the rest
  // of the visit it arrived on.
  return writeReferral(code, state, now, brand ?? same)
}

/** What is already stored under this exact code, or null for any other. */
function keptFor(code: string, now: number): LiveReferral | null {
  const live = liveReferral(now)
  return live !== null && live.code === normalizeCode(code) ? live : null
}

/**
 * Drop everything a code claimed about itself when the worker refuses it,
 * keeping the code itself.
 *
 * Three claims, all written from the address or from an earlier quote before
 * anybody re-checked them: which state the link named, the partner's business
 * name, and whether that name may stand in for ours.
 *
 * The state is what takes the Home row away (see `canGoHome` in src/App.tsx),
 * and until this existed the app decided a partner had sent this learner from
 * an unvalidated `?ref=` alone -- so a retired code on an old flyer removed the
 * picker for sixty days from somebody the worker had already said it did not
 * recognise, and #4 had just removed the landing page's way out as well. The
 * name is the same shape of claim one screen further on: a refused code that
 * kept its name would print a driving school's name over the whole app for a
 * learner nobody is being paid for. The worker's answer is the only thing that
 * knows a partner is real; honouring it here is the same answer the price
 * already gets.
 *
 * The original `at` is kept rather than refreshed. Stamping `now` would extend
 * the commission window on a code that earns nobody anything, which is a
 * change to attribution and not this function's business. The code stays
 * because a refusal may be a bad quote and `onBuy` still resolves it server
 * side; only the unverified claims are withdrawn.
 */
export function forgetReferralClaims(code: string, now = Date.now()): void {
  const live = keptFor(code, now)
  if (live === null) return
  if (live.state === null && live.name === null && !live.branded) return
  writeReferral(live.code, null, live.at, null)
}

/**
 * The partner's own name for this browser's header, or null.
 *
 * Both halves, and not because a name can outlive the switch -- it cannot, now
 * that the worker withholds the name itself. The flag is what a body from a
 * worker older than the switch does not have, and its absence has to mean our
 * own name rather than the name that body still carries. Read from storage
 * rather than from the quote so the header is right on the first paint of a
 * reload instead of flipping once the worker answers.
 */
export function brandedPartnerName(now = Date.now()): string | null {
  const live = liveReferral(now)
  return live !== null && live.branded ? live.name : null
}

function writeReferral(
  code: string,
  state: string | null,
  at: number,
  brand: Brand | null,
): string | null {
  const normalized = normalizeCode(code)
  if (normalized === null) return null
  try {
    localStorage.setItem(
      REFERRAL_KEY,
      JSON.stringify({
        code: normalized,
        at,
        state,
        partner: brand?.name ?? null,
        branded: brand?.branded === true,
      }),
    )
  } catch {
    // Private mode with storage blocked: the code lasts as long as the tab,
    // which is still enough to buy with.
  }
  return normalized
}

/**
 * The code on the address this page was opened at, remembered if there is one,
 * with the state that same address named.
 *
 * Returns it so the caller can report `referral_seen` -- a link that arrived is
 * a fact worth counting even if nobody ever buys, because it is the denominator
 * of the ratio that catches a leaked coupon.
 */
export function captureReferral(
  search: string,
  state: string | null,
  now = Date.now(),
): string | null {
  try {
    const code = new URLSearchParams(search).get('ref')
    if (code === null) return null
    // The state comes off the address, which is the only place it ever is. The
    // name does not: it is kept where this is the same code already stored, so
    // reloading the link a learner arrived on does not blank the header for the
    // moment it takes the quote to come back.
    return writeReferral(code, state, now, keptFor(code, now))
  } catch {
    return null
  }
}
