/**
 * What the app reports about how it is used, and nothing else.
 *
 * Three properties hold this module together, and each one is load-bearing:
 *
 * 1. **Its own switch.** `VITE_ANALYTICS_BASE`, never `VITE_API_BASE`.
 *    `apiConfigured()` is what App.tsx passes as `paywallActive`, so pointing
 *    analytics at the paywall's variable would switch the paywall on as a side
 *    effect of wanting a number. Production ships with the paywall dormant on
 *    purpose. The two switches are independent even when they name one worker.
 *
 * 2. **Two identifiers, and they are joinable now.** `access.ts` mints a device
 *    id so a purchase can be attached to a browser; this module mints its own,
 *    separately, under its own key. For a long time the device id was
 *    deliberately withheld from these payloads so that behavior could never be
 *    attached to a paying identity.
 *
 *    That answered a privacy question at the cost of a commercial one: "which
 *    behavior leads to a sale" and "did this buyer ever use the thing" were
 *    both unanswerable. The device id now rides along, and `/api/stats` reports
 *    conversion per rung of the funnel because of it. Both ids remain random
 *    numbers minted on the device -- neither is a name, and the app still asks
 *    for none -- and README.md and the privacy page say what changed.
 *
 * 3. **Fire and forget.** The app worked with no network at all before this
 *    existed -- see RoadSign.tsx on the licensing office's wifi -- and it still
 *    must. Nothing here is awaited, nothing here can throw into a caller, and
 *    no screen waits on a beacon. An unreachable analytics origin is invisible.
 *
 * The payload is a closed enum plus integers, two ids and a card id. Nothing
 * typed, no free text, and never the answer somebody picked.
 */

import { deviceId } from './access'
import { currentLevel, isPassingScore } from './exam'
import { courseOf, resultsOffer, type FlowState, type PaywallReason } from './flow'
import { currentTarget } from './path'
import { uuid } from './uuid'

/**
 * Where reports go, and whether they go at all.
 *
 *   unset          nowhere. Every build is silent until told otherwise, which
 *                  is what keeps `npm run dev` out of the numbers.
 *   'same-origin'  this page's own address, which is what production ships.
 *                  A Pages Function serves /api/ there and hands it to the
 *                  worker; see functions/api/[[path]].ts for why that matters.
 *   https://…      that origin. The behavioral suite points at a host that
 *                  cannot resolve, so an unreachable server is what every
 *                  suite proves the app survives.
 */
const CONFIGURED = import.meta.env.VITE_ANALYTICS_BASE ?? ''
const SAME_ORIGIN = CONFIGURED === 'same-origin'

/** Empty for same-origin, so `${BASE}/api/event` is simply `/api/event`. */
const BASE = SAME_ORIGIN ? '' : CONFIGURED.replace(/\/$/, '')

/**
 * Where a report is actually sent, given how the build was configured.
 *
 * Pulled out and exported because this one string is the difference between
 * arriving and being silently dropped by a browser, and it is not otherwise
 * observable from a test: a beacon that goes to the wrong place fails exactly
 * as quietly as one that goes to the right place.
 */
export function endpointFor(path: string, configured = CONFIGURED): string {
  if (configured === 'same-origin') return path
  return configured.replace(/\/$/, '') + path
}

/**
 * Whether a build is allowed to report from a developer's own machine.
 *
 * Set only by playwright.config.ts, for the two builds the behavioral suite
 * drives -- which are pointed at a host that cannot resolve, so what they
 * "report" goes nowhere. tests/unit/deploy-config.test.ts holds the line that
 * it never appears in .env.production.
 */
const ALLOW_LOCAL = import.meta.env.VITE_ANALYTICS_ALLOW_LOCAL === '1'

/**
 * Whether a page served from `hostname` is a real visit worth counting.
 *
 * A visit is a person on the deployed site, wherever it is deployed -- so this
 * names the places that are *not* that, rather than trying to know the one
 * that is. The site's hostname is about to change, and a rule written around
 * the current one would quietly stop reporting the day it did.
 *
 * This exists because the build-time switch could not tell the difference.
 * `npm run deploy` builds dist/ with the real worker's address in it, and that
 * bundle reports from wherever it is opened -- including `vite preview` on a
 * laptop. That is not a hypothetical: a preview server left running on 4174
 * served a deploy's files to the behavioral suite, and 150 tests wrote
 * `unhandled boom` and every feedback fixture into the production tables. The
 * build is aimed correctly now, and this is the second lock: the page has to be
 * somewhere a visitor could actually be.
 */
export function reportsFrom(hostname: string, allowLocal = ALLOW_LOCAL): boolean {
  if (allowLocal) return true
  if (hostname.length === 0) return false
  return (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '0.0.0.0' &&
    hostname !== '::1' &&
    hostname !== '[::1]' &&
    // Bonjour names (`joels-mac.local`) and the hosts file conventions people
    // point at their own machines.
    !hostname.endsWith('.local') &&
    !hostname.endsWith('.localhost') &&
    !hostname.endsWith('.test') &&
    !isPreview(hostname)
  )
}

/**
 * A Cloudflare Pages preview deployment, which is a build being looked at
 * rather than a site being used.
 *
 * Previews are served from `<branch>.<project>.pages.dev` and
 * `<commit>.<project>.pages.dev` with a real domain name, a real certificate
 * and nothing about them a hostname rule for laptops would catch -- so every
 * tap somebody takes while reviewing a branch landed in the production tables,
 * indistinguishable from a learner. That is the same defect the comment above
 * describes, wearing a different hat: the build is aimed correctly and the page
 * is somewhere a visitor *could* be, and it is still not a visit.
 *
 * The rule is copied from `functions/canonical.ts`, deliberately and with the
 * same reasoning: `<project>.pages.dev` carries no prefix, is not a preview,
 * and is redirected to the real name -- so it keeps reporting, exactly as the
 * host list above says it should. The two are not shared because the app must
 * not import from the Pages Functions build; they are held to the same answer
 * by tests/unit/reporting.test.ts naming both shapes.
 */
function isPreview(hostname: string): boolean {
  return hostname.endsWith('.pages.dev') && hostname.split('.').length > 3
}

/**
 * Which of our sites this page is.
 *
 * The app runs under more than one name, and each is its own origin with its
 * own storage -- so they are two audiences, on purpose. Without this on every
 * event the numbers pool them, and the split tells you nothing: you would be
 * running two properties and reading one figure.
 *
 * Bounded so it stays a label rather than an open text field, and undefined
 * where there is no location worth the name.
 */
export function siteName(): string | undefined {
  try {
    const host = window.location.hostname.toLowerCase()
    return /^[a-z0-9.-]{1,64}$/.test(host) ? host : undefined
  } catch {
    return undefined
  }
}

/**
 * Which exam this page is about.
 *
 * The same job `siteName` does one level up. The app runs more than one exam
 * now, reached by URL rather than by menu, and without this on every row two
 * products pool into one indistinguishable funnel -- at which point none of
 * the existing analysis means anything, because "how many people finish the
 * study pass" would be an average over two different passes.
 *
 * Read from the path rather than from storage, because the path is what
 * decides which product the visitor is actually in; see src/path.ts.
 */
export function productName(): string | undefined {
  try {
    return currentTarget().product.id
  } catch {
    // No window, or a registry that could not be built. An event with no
    // product is still worth having; see COALESCE in worker/src/analytics.ts.
    return undefined
  }
}

/**
 * How this visit arrived, gathered once and sent only with `opened`.
 *
 * Five facts, and each one earns its place by answering a question nothing else
 * here can:
 *
 * - **`source`** — which site linked here. Deliberately not `ref`, which names
 *   a partner's campaign code. Until this existed, a visit from a forum, a
 *   school's website or a search result was indistinguishable from somebody
 *   typing the address, and Search Console covers only the last of those.
 * - **`campaign`** — the `utm_campaign` on the link, for the first newsletter
 *   or ad that wants to know whether it worked.
 * - **`entry`** — the page landed on. The one question the search console
 *   cannot answer for non-search traffic: which page is doing the work of
 *   bringing people in.
 * - **`viewport`** — three buckets, never pixels. Whether mobile-first is still
 *   the right bet is a design argument nobody can currently settle.
 * - **`lang`** — the primary subtag. Whether enough people are reading this in
 *   Spanish to be worth translating for is a product decision with no evidence
 *   behind it today.
 *
 * Everything here is bounded before it leaves, and the worker bounds it again
 * on arrival -- the same two-pass discipline `scrub` runs on, and for the same
 * reason: the client half is the half an attacker controls.
 */
export interface Arrival {
  source?: string
  campaign?: string
  entry?: string
  viewport?: string
  lang?: string
}

/**
 * The referring site, as a bare host, or undefined.
 *
 * **Our own hosts are dropped**, and that is the line that makes the number
 * mean anything. This is a single-page app: an internal navigation, a reload,
 * and the return trip from Stripe all set `document.referrer` to the site it is
 * already on. Counting those would make howardslantern.com far and away the
 * largest referrer to howardslantern.com, burying every real source under our
 * own traffic.
 *
 * `www.` is stripped for the same reason `ref` is uppercased: one site must not
 * become two rows in a group-by.
 */
export function referrerHost(
  referrer = typeof document === 'undefined' ? '' : document.referrer,
  self = typeof window === 'undefined' ? '' : window.location.hostname,
): string | undefined {
  try {
    if (referrer.length === 0) return undefined
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    if (host.length === 0) return undefined
    const here = self.toLowerCase().replace(/^www\./, '')
    // Our own name, and every name that ends in it: the certification domain,
    // the pages.dev previews, and any future subdomain nobody has thought of.
    if (host === here || host.endsWith('.pages.dev')) return undefined
    if (/(^|\.)howardslantern(certification)?\.com$/.test(host)) return undefined
    return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(host) ? canonicalHost(host) : undefined
  } catch {
    // A referrer that is not a URL. Not worth a report and not worth a throw.
    return undefined
  }
}

/**
 * Hosts that are one source wearing several names.
 *
 * Same rule as stripping `www.`, stated where that is: one site must not become
 * four rows in a group-by. Facebook routes clicks through a link shim and a
 * mobile host, so a single post arrives as `facebook.com`, `m.facebook.com`,
 * `l.facebook.com` and `lm.facebook.com` -- four rows, none of which is the
 * number anybody wanted. Google's country domains do the same thing on a larger
 * scale.
 *
 * Only the suffix is matched, so a subdomain nobody has thought of collapses
 * too. Deliberately a short list of the ones that actually split: a general
 * "take the last two labels" rule would fold `bbc.co.uk` into `co.uk`.
 */
const SAME_SOURCE: [RegExp, string][] = [
  [/(^|\.)facebook\.com$/, 'facebook.com'],
  [/(^|\.)instagram\.com$/, 'instagram.com'],
  [/(^|\.)reddit\.com$/, 'reddit.com'],
  [/(^|\.)youtube\.com$/, 'youtube.com'],
  [/(^|\.)tiktok\.com$/, 'tiktok.com'],
  // t.co is Twitter's shim and carries no other traffic.
  [/^t\.co$/, 'x.com'],
  [/(^|\.)(twitter|x)\.com$/, 'x.com'],
  [/(^|\.)google(\.[a-z]{2,3}){1,2}$/, 'google.com'],
  [/(^|\.)bing\.com$/, 'bing.com'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo.com'],
]

/** The name a host should be counted under. Itself, unless it is a variant. */
export function canonicalHost(host: string): string {
  for (const [pattern, name] of SAME_SOURCE) if (pattern.test(host)) return name
  return host
}

/** Three buckets, chosen at the breakpoints the layout already uses. */
function viewportBucket(width: number): string {
  if (width < 640) return 'sm'
  return width < 1024 ? 'md' : 'lg'
}

/** A `utm_` parameter, lowercased and bounded, or undefined. */
function utm(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key)
  if (raw === null) return undefined
  const value = raw.toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value) ? value : undefined
}

export function arrival(): Arrival {
  try {
    const params = new URLSearchParams(window.location.search)
    // An explicit `utm_source` beats an inferred referrer: whoever wrote the
    // link said where it was going to be, and a link posted on one site and
    // shared onto another would otherwise be credited to the wrong one.
    const source = utm(params, 'utm_source') ?? referrerHost()
    // The path only. The query is where `?ref=` and everything a campaign
    // appended live, and none of it belongs in a grouping column.
    const path = window.location.pathname
    return {
      source,
      campaign: utm(params, 'utm_campaign'),
      entry: /^\/[A-Za-z0-9/_-]{0,95}$/.test(path) ? path : undefined,
      viewport: viewportBucket(window.innerWidth),
      lang: (navigator.language ?? '').toLowerCase().split('-')[0] || undefined,
    }
  } catch {
    // No window, no navigator, storage blocked. An `opened` with no arrival is
    // still worth having -- it is the visit that says somebody was here.
    return {}
  }
}

/**
 * Where the operator's mark is kept once they have made it.
 *
 * Its own key rather than a field on anything: it outlives the progress store,
 * which is wiped every time a fresh run of the first-visit experience is
 * tested, and that wipe is exactly the habit this has to survive.
 */
const OPERATOR_KEY = 'teach-and-test/v1/operator'

/**
 * Whether this browser belongs to the operator, so that what it does is
 * testing rather than a visit.
 *
 * Read from the URL first and stored after, which is the part that makes it
 * work at all. On 2026-09-22 the roster's forty Baltimore sessions were forty
 * *different* device ids -- one per sitting -- because the only honest way to
 * look at what a first-time visitor sees is a browser that has never been
 * here. A mark that lived only in storage would be wiped by that very habit
 * and would fail silently, which is the worst of the available failures: a
 * roster that looks clean because nothing was excluded and nothing was sent.
 *
 * So the mark rides in the address: `?op=1`, bookmarked and opened in a fresh
 * private window, is set before the first beacon of the load goes out. The
 * store is for the rest of that browser's life, so a second page opened
 * without the parameter is still the operator. `?op=0` takes it off, because a
 * mark with no way back is a browser that has silently stopped reporting and
 * no way to find out.
 *
 * Geography deliberately has nothing to do with it. Baltimore is Maryland's
 * largest city in this product's flagship state, and a rule that read "not
 * Baltimore" would hide a real learner there for good, with nothing on any
 * screen to say it had happened.
 */
export function operatorBrowser(): boolean {
  try {
    const marked = new URLSearchParams(window.location.search).get('op')
    if (marked === '1') {
      localStorage.setItem(OPERATOR_KEY, '1')
      return true
    }
    if (marked === '0') {
      localStorage.removeItem(OPERATOR_KEY)
      return false
    }
    return localStorage.getItem(OPERATOR_KEY) === '1'
  } catch {
    // No window, or storage refused. Nobody is marked, which is the same
    // answer every visitor gets and the safe one: a session counted that
    // should not have been is a number to correct, and the alternative --
    // failing closed and excluding a stranger -- is a number nobody can see.
    return false
  }
}

/**
 * Deliberately not `apiConfigured()`. See property 1 above.
 *
 * Two conditions, and both are load-bearing: a worker to report to, and a page
 * that is actually on the site rather than on somebody's laptop.
 */
export function analyticsConfigured(): boolean {
  if (!SAME_ORIGIN && BASE.length === 0) return false
  try {
    return reportsFrom(window.location.hostname)
  } catch {
    // No window: nothing is being visited.
    return false
  }
}

/** Deliberately not `teach-and-test/v1/device-id`. See property 2 above. */
const ANALYTICS_KEY = 'teach-and-test/v1/analytics-id'

/**
 * Random per install, stored so that "do learners come back" is answerable, and
 * derived from nothing about the person. A browser that will not give us
 * storage gets an id that lasts as long as the tab, which costs the retention
 * figure and nothing else.
 */
export function analyticsId(): string {
  try {
    const stored = localStorage.getItem(ANALYTICS_KEY)
    if (stored !== null && stored.length > 0) return stored
    const fresh = uuid()
    localStorage.setItem(ANALYTICS_KEY, fresh)
    return fresh
  } catch {
    return uuid()
  }
}

/**
 * Strip the four things in this app that must never leave the browser.
 *
 * Bounding is left to the two callers below, which differ from each other on
 * exactly one line -- whether an email address is one of the four.
 *
 * Errors are diagnostic rather than behavioral, so unlike the events above
 * they carry real text -- a message and a stack are the whole point, and
 * without them an error report says only that something, somewhere, broke.
 * There is very little user-typed text in this app to leak -- AC8 leaves the
 * recovery-code box and the feedback comment, and nothing else -- but there are
 * four specific strings that would be serious, and each is removed by name
 * rather than by hoping:
 *
 *  1. The recovery code, which IS the buyer's proof of purchase. Redacted by
 *     its exact stored value, not by pattern, so a code in any format goes.
 *  2. Stripe session ids, which ride in the URL on the way back from checkout
 *     and so end up in stack traces.
 *  3. The device id and this analytics id. They are joined on purpose in the
 *     tables, so the reason is no longer that they must not meet -- it is that
 *     an id inside a stack trace is one no schema declares, no test lists and
 *     no privacy page describes. Identity belongs in a column that can be
 *     named, dropped and reasoned about, never in free text.
 *  4. Query strings, which are where the first two arrive.
 */
function redact(text: string): string {
  let out = text
  try {
    // The one value we can redact exactly rather than guess at.
    for (const key of ['teach-and-test/v1/recovery-code', 'teach-and-test/v1/device-id', ANALYTICS_KEY]) {
      const held = localStorage.getItem(key)
      if (held !== null && held.length >= 8) out = out.split(held).join('<redacted>')
    }
  } catch {
    // No storage: nothing stored to leak either.
  }
  return out
    // Only inside a URL: a bare `?` in a message is optional chaining, and
    // `x?.y is not a function` is exactly the text worth keeping.
    .replace(/(https?:\/\/[^\s)]*?)\?[^\s)]*/g, '$1?<query>')
    .replace(/\bLP-[0-9A-Z]{4}-[0-9A-Z]{4}\b/gi, '<recovery-code>')
    .replace(/\b(cs|pi|sk|pk|price|prod|sub|cus)_[A-Za-z0-9_]+/g, '<stripe-id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
}

export function scrub(text: string, limit: number): string {
  return redact(text)
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>')
    .slice(0, limit)
}

/**
 * The same removals for text somebody typed on purpose -- a feedback comment --
 * except the address.
 *
 * A crash message with an email in it caught one by accident. A comment with an
 * email in it is somebody asking to be answered, and taking it out would be the
 * app deciding on their behalf that they did not mean it. The recovery code,
 * the ids and the query strings still go: pasting a proof of purchase into a
 * comment box does not make it belong in a table.
 */
export function scrubComment(text: string, limit: number): string {
  return redact(text).slice(0, limit)
}

/**
 * Which build a stack came from, so a minified frame can be matched to the
 * bundle that produced it. Vite substitutes this at build time.
 */
export const RELEASE = import.meta.env.VITE_RELEASE ?? 'dev'

export const MESSAGE_LIMIT = 300
export const STACK_LIMIT = 2000

/** Where an error came from. An enum, so it can be counted. */
export type ErrorKind = 'render' | 'rejection' | 'window'

/**
 * Report a crash. Same rules as `record`: never awaited, never throws.
 *
 * This goes to its own endpoint and its own table, and `/api/stats` reports
 * only counts of it. That is deliberate: the stats endpoint is public, so a
 * stack trace flowing through it would not merely be stored but published, and
 * a scrubbing miss would be published with it. Messages are read with
 * `wrangler d1 execute`, which is authenticated.
 */
export function recordError(kind: ErrorKind, error: unknown, screen?: string): void {
  try {
    if (!analyticsConfigured()) return
    const raw = error instanceof Error ? error : new Error(String(error))
    const body = JSON.stringify({
      session: analyticsId(),
      kind,
      screen,
      message: scrub(raw.message, MESSAGE_LIMIT),
      stack: scrub(raw.stack ?? '', STACK_LIMIT),
      release: RELEASE,
    })
    const url = endpointFor('/api/error')
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
    if (navigator.sendBeacon?.(url, blob) === true) return
    void fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }).catch(() => {})
  } catch {
    // A reporter that throws while reporting a throw is the worst of both.
  }
}

/**
 * The closed set, as data rather than as a union, so it can be counted at
 * runtime. src/legal.ts describes each of these to the person sending them,
 * and a test holds that description to this list -- a new event fails the
 * suite until the privacy page admits to it. Said without a count on purpose:
 * this comment read "an eighth event" long after the eighth, and
 * docs/observability.md said "twelve" for the same reason.
 */
export const EVENT_NAMES = [
  'opened',
  'state_chosen',
  'study_progress',
  'card_answered',
  'pass_complete',
  // The short course, chosen (docs/plans/short-course.md). It answers the one
  // question the change is worth measuring on -- whether anybody takes it --
  // and it is what lets `study_progress` be read at all afterwards: the
  // frontier leaps in the short course, so without a name for who is on it
  // the tenths would look like a scoring bug spread across the funnel.
  'short_course_chosen',
  // The short course, finished. Deliberately NOT `pass_complete`: that rung
  // counts how many finish the whole pass, and a course that teaches one or
  // two laws per topic is not that. Two names rather than a field on one,
  // because `events` is a column per field and a new column is a D1 migration
  // this change does not otherwise need.
  'short_complete',
  'test_started',
  'test_progress',
  'test_finished',
  'level_earned',
  // The offer on the ten-question test's results, counted when it is SHOWN.
  // `paywall_shown` fires on the transition to the paywall, which is the
  // press -- so without this one a campaign that sells nothing cannot tell
  // "nobody was shown a price" from "everybody was, and walked away from it",
  // and those have opposite fixes. Fired from the same `resultsOffer` call
  // that draws the button, so the two cannot come apart.
  'offer_shown',
  'paywall_shown',
  // The pass bar at a checkpoint pressed, which is the only way into the
  // section map. Separate from the two taps below because opening the map and
  // doing something with it are different answers: without this, a map nobody
  // opens and a map everybody opens and closes again look identical.
  'map_opened',
  // A green pill: a concept the pass has taught, walked over again.
  'section_revised',
  // A grey pill: a section ahead of the pass, asked as questions instead of
  // taught. The pair is the question the map exists to answer -- whether
  // learners want to skip ahead or to go back -- and it cannot be a field on
  // one name, because `events` is a column per field and a new column is a D1
  // migration this does not otherwise need.
  'section_tested_out',
  // The Buy button pressed, before the checkout is asked for. Five learners
  // met the price on 2026-09-22 and none paid, and nothing between
  // `paywall_shown` and a row in `purchases` could say whether they read the
  // figure and left or pressed Buy and lost heart at Stripe -- two failures
  // with opposite fixes. `referral_applied` fires from the same press, but
  // only when a code is being carried, which is nearly nobody.
  'checkout_started',
  // Somebody arrived on a link naming an exam we do not run, or a state we do
  // not carry. They were shown the ordinary welcome screen -- never a dead end
  // -- and this is the only trace that the link was wrong.
  //
  // A count, and deliberately nothing more. Which bad link it was is knowable
  // from the advert that was written; what was not knowable is whether anybody
  // is hitting it, and a campaign that silently degrades to the home page is a
  // failure that hides for as long as nobody thinks to look.
  'unknown_product',
  'unknown_state',
  // The same thing one level deeper: a link naming a concept this state does
  // not carry. Reachable in a way the two above are not -- every concept is a
  // page in the sitemap, so a concept renamed in the corpus turns every
  // search result that still points at the old name into one of these.
  'unknown_concept',
  // Somebody arrived on a partner's link, took a code to a checkout, or
  // presented one that resolved to nothing. The third is the dead-campaign
  // signal and is worth more than the other two combined: a code that has been
  // disabled, mistyped or copied off a coupon site looks exactly like a code
  // nobody is using, and only this tells them apart.
  'referral_seen',
  'referral_applied',
  'unknown_referral',
  // Somebody offered their pass to somebody else. The one number that decides
  // whether the share card is worth keeping, and deliberately the whole of what
  // is known about it: the sentence a learner posts is theirs, and which of the
  // three they were offered is already derivable from the level they hold.
  'result_shared',
  // Somebody looked at the first screen and left without pressing anything.
  // How long they looked, and the state whose page it was if it was one --
  // nothing else, because the question is only whether they read it or
  // bounced, and the answer to that is a number of seconds.
  'left_landing',
  // Somebody opened the partner portal's front page, or its application form.
  // Sent by the portal on load and carrying nothing. Until these existed the
  // only trace of the program's pitch working was a row in `partners`, so a
  // page nobody visits and a page everybody visits and leaves looked the same
  // -- nothing -- and those have opposite fixes: find the schools, or rewrite
  // the page. Two names rather than a field, for the reason given above.
  'partners_viewed',
  'partners_apply_viewed',
  // One of the pages the menu leads to, opened -- by the menu, by the feedback
  // button on a result, or by arriving on its address. Which one is `page`,
  // from a closed list; one name rather than eleven, because the question is
  // the same for all of them: does anybody open this?
  'page_viewed',
  // This browser is the operator's own, and everything it does is testing.
  //
  // Sent once a load, from a browser that has been marked -- see
  // `operatorBrowser`. It carries nothing at all: it is not a measurement, it
  // is the one fact that stops a measurement being taken. The rows still
  // arrive and are still stored; the roster and the tiles exclude the session
  // when they read, exactly as they do for a crawler network.
  'operator_session',
  // A chip under the nationwide box tapped: a stored answer shown, and the
  // model asked nothing (docs/plans/trusted-by-date.md, decision 18). Which
  // chip is the whole of it, so the stats can say which facts people like --
  // nothing else records a tap, because no question was sent to be logged.
  'chip_tapped',
  // One of a state's chips under the box tapped (docs/plans/what-happens-if.md,
  // decision 24): which chip and the state it was answered for. Its own name
  // because every state's pool is the same twelve ids, and `chip_tapped`
  // carries no state -- a nationwide answer has none.
  'state_chip_tapped',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

/**
 * The pages `page_viewed` may name: everything the menu and its submenus open,
 * and the menu itself, which is the denominator every other row is read
 * against. The section map is not here -- it is opened from a checkpoint, and
 * `map_opened` already counts it.
 *
 * The worker holds its own copy and refuses a name outside it;
 * tests/unit/event-vocabulary.test.ts holds the two together.
 */
export const MENU_PAGES = [
  'menu',
  'numbers',
  'exam',
  'course',
  'feedback',
  'refund',
  'about',
  'partner',
  'privacy',
  'terms',
  'faq',
  'ask',
  'contact',
  'restart',
] as const

export type MenuPage = (typeof MENU_PAGES)[number]

export interface EventFields {
  /** Which site this happened on. Set for every event; see `record`. */
  site?: string
  /** Which exam this happened in. Set for every event; see `record`. */
  product?: string
  state?: string
  /** Which card. Only ever on `card_answered`; see the privacy page. */
  law?: string
  /** Which menu page. Only ever on `page_viewed`; see `MENU_PAGES`. */
  page?: MenuPage
  /** Which chip, by its id in resource/chips.json or resource/state-chips.json. Only ever on `chip_tapped` and `state_chip_tapped`. */
  chip?: string
  /** Which partner code. Only ever on the three referral events. */
  ref?: string
  /**
   * How the visit arrived. Only ever on `opened`, which is why these are five
   * separate optional fields rather than a nested object: the worker's shape
   * table lists allowed keys per event, and a nested one would have to be
   * unpacked before it could be checked. See `arrival`.
   */
  source?: string
  campaign?: string
  entry?: string
  viewport?: string
  lang?: string
  /** Which kind of run. 'diagnostic' is the ten-question test before the pass. */
  mode?: 'full' | 'missed' | 'diagnostic'
  score?: number
  total?: number
  /** Seconds on the first screen before leaving. Only ever on `left_landing`. */
  seconds?: number
  level?: number
  passed?: boolean
  /**
   * Which door led to the price. On `paywall_shown`, and on `checkout_started`
   * for the same reason: which door's price got pressed is the question.
   *
   * Not derivable from anything else that is sent: the wall after the free
   * section and a test asked for after the free one are both reached from the
   * study card. Three values, from `Screen`'s own discriminant -- `offer` (the
   * ten-question results, #387), `wall` (#391), `spent` (the free full test is
   * gone).
   */
  reason?: PaywallReason
}

export interface AnalyticsEvent {
  name: EventName
  fields: EventFields
}

/**
 * Send one event. Returns nothing, waits for nothing, and cannot fail.
 *
 * `sendBeacon` first: the browser owns the request from there, so it survives
 * the page being closed a moment later -- which is exactly when the last event
 * of a session is sent. `fetch` with `keepalive` where there is no beacon.
 *
 * The body goes as `text/plain` rather than `application/json` so that it stays
 * a simple CORS request. `application/json` would earn a preflight, which is a
 * round trip before the round trip and the one thing a beacon cannot wait for.
 * The worker reads the body as JSON regardless of what the type header claims.
 */
export function record(name: EventName, fields: EventFields = {}): void {
  try {
    if (!analyticsConfigured()) return
    const body = JSON.stringify({
      session: analyticsId(),
      // The id a purchase is attached to, so what somebody did and what they
      // bought can be read together. It used to be deliberately withheld here;
      // see the note on property 2 above for what changed and why.
      device: deviceId(),
      // Which of our sites this happened on.
      //
      // The app runs under more than one name, and each is its own origin with
      // its own storage -- so they are two audiences, deliberately. Without
      // this the numbers pool them and the split tells you nothing: you would
      // be running two properties and reading one figure.
      site: siteName(),
      // Which exam. One level above the state: two products asked about the
      // same state are two different bodies of knowledge, and adding their
      // funnels together would make every existing number an average of two
      // things nobody wanted averaged.
      product: productName(),
      name,
      ...fields,
    })
    const url = endpointFor('/api/event')
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
    if (navigator.sendBeacon?.(url, blob) === true) return
    void fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }).catch(() => {
      // An unreachable origin is not the app's problem to handle.
    })
  } catch {
    // Neither is a browser that refuses beacons, storage, or Blob.
  }
}

/**
 * The events implied by the app moving from one state to the next.
 *
 * Derived from the transition rather than fired at call sites, because the
 * moments worth counting are reached by more than one path -- a test starts
 * from the study screen, from the hub, and from the receipt -- and a call site
 * added later would silently stop counting. One place, and the reducer stays
 * pure.
 *
 * Pure, so the seven events are unit-testable against the real reducer.
 */
export function flowEvents(prev: FlowState | null, next: FlowState): AnalyticsEvent[] {
  // The first render is not a transition. It is also where a resumed run and a
  // remembered state arrive, and neither of those is a thing anyone just did.
  if (prev === null) return []
  const state = next.stateCode
  if (state === null) return []

  // Arriving at a state -- picked now, or restored from the last visit -- is
  // one event and never any of the others. Progress loaded off the disk is not
  // a pass completed, a level earned, or a test begun.
  if (prev.stateCode !== state) {
    const arrived: AnalyticsEvent[] = [{ name: 'state_chosen', fields: { state } }]
    /**
     * The one exception, and it is a run that genuinely began here.
     *
     * The picker and a state's landing page both offer the ten-question test
     * as their primary action, and taking it selects the state and opens the
     * run in the same handler -- which React batches into one render, so this
     * function is handed both at once. Returning `state_chosen` alone would
     * drop `test_started` for the two paths the whole change makes primary,
     * and `took_a_test` would count only the diagnostics started from a study
     * card. The funnel would quietly undercount exactly what it was widened to
     * measure.
     *
     * Narrow on purpose: a diagnostic, at its first question. A stored run
     * restored from disk on a state switch is still not a run begun, and a
     * full-length paper can never arrive this way -- `requestTest` needs a
     * covered pass, which needs a state already chosen.
     */
    if (
      next.screen.name === 'test' &&
      next.screen.mode === 'diagnostic' &&
      next.screen.current === 0
    ) {
      arrived.push({ name: 'test_started', fields: { state, mode: 'diagnostic' } })
    }
    return arrived
  }

  const events: AnalyticsEvent[] = []
  /**
   * How far into the study pass somebody got.
   *
   * Without this the funnel jumps straight from `state_chosen` to
   * `pass_complete`, and 37 cards of the product are a black box: a learner who
   * left on card 3 and one who left on card 30 are the same single `opened`.
   * That is precisely where drop-off would be, and it was invisible.
   *
   * Emitted on crossing each tenth of the pass, so it is nine events at most
   * however long a state's corpus is -- and so the number means the same thing
   * in Maryland's 37 cards as in a state with two hundred. It carries a
   * position and a length, never which law or whether it was answered right:
   * where somebody stopped is a fact about the material, what they got wrong
   * is a fact about them.
   */
  /**
   * Every card, as it is answered, right or wrong.
   *
   * This is the one event that carries which card and how it went, and adding
   * it reversed a promise this app used to make. That was deliberate and it is
   * written down in README.md and on the privacy page in the same words: the
   * question it answers -- which cards fail to teach -- cannot be answered any
   * other way, and it is the only question whose answer improves the material.
   *
   * What it is not: it is a card id and a right-or-wrong under an id minted at
   * random on the device, joined to no purchase and to no person, and nobody's
   * own curve is computed from it. The mastery record that would allow that
   * stays in the learner's browser, as it always has.
   *
   * Read as *first* attempts server-side, because the study loop makes you
   * answer a card until it is right -- counting every attempt would say every
   * card is eventually learned, which is true and useless.
   */
  const answered = prev.screen.name === 'quiz' && next.screen.name !== 'quiz'
  // A prescreen answer is the same fact -- a card answered -- given before the
  // card instead of after it (#383). Detected by the question moving on, which
  // includes leaving the prescreen on its last question; the law is the one
  // that was being asked, and right is the one thing a prescreen records
  // beyond mastery: its id joining `skipped`.
  if (prev.screen.name === 'prescreen') {
    const moved = next.screen.name !== 'prescreen' || next.screen.current !== prev.screen.current
    const law = prev.studyLaws[prev.screen.current]
    if (moved && law !== undefined && next.progress.mastery[law.id] !== prev.progress.mastery[law.id]) {
      events.push({
        name: 'card_answered',
        fields: {
          state,
          law: law.id,
          passed: next.progress.skipped.includes(law.id) && !prev.progress.skipped.includes(law.id),
        },
      })
    }
  }
  if (answered) {
    // The card that was on screen, which is not always the furthest card
    // reached: a learner stepping back over the pass answers behind it. Read
    // from the record rather than the view, this named the furthest card and
    // called every review answer a miss (#120).
    const law = prev.studyLaws[prev.studyView]
    if (law !== undefined) {
      events.push({
        name: 'card_answered',
        // Advancing means it was right; staying put means it was not. In the
        // pass the record moves; in a review only the view does.
        fields: {
          state,
          law: law.id,
          passed:
            next.progress.studyIndex > prev.progress.studyIndex ||
            next.studyView > prev.studyView,
        },
      })
    }
  }

  const total = next.studyLaws.length
  if (total > 0) {
    const tenth = (index: number) => Math.floor((Math.min(index, total) / total) * 10)
    if (tenth(next.progress.studyIndex) > tenth(prev.progress.studyIndex)) {
      events.push({
        name: 'study_progress',
        fields: { state, score: Math.min(next.progress.studyIndex, total), total },
      })
    }
  }
  /**
   * Somebody switched to the short course.
   *
   * Read off the record rather than fired from the button, so the two cannot
   * come apart: a second way to switch -- a deep link, a restored record --
   * would be counted here without anybody remembering to instrument it, and a
   * button that fired this without changing the course would count a switch
   * that never happened.
   */
  if (courseOf(prev.progress) !== 'short' && courseOf(next.progress) === 'short') {
    events.push({ name: 'short_course_chosen', fields: { state } })
  }
  if (!prev.progress.coveredOnce && next.progress.coveredOnce) {
    // Which course was finished, so "how many finish the study pass" goes on
    // meaning the whole pass. A short course counted as `pass_complete` would
    // inflate that rung with learners who were taught a fifth of the laws.
    const name = courseOf(next.progress) === 'short' ? 'short_complete' : 'pass_complete'
    events.push({ name, fields: { state } })
  }
  if (next.screen.name === 'test' && prev.screen.name !== 'test') {
    events.push({ name: 'test_started', fields: { state, mode: next.screen.mode } })
  }
  /**
   * How far into a test somebody got before they stopped.
   *
   * The same hole as the study pass had, in the last place anyone can afford
   * one: the offer waits at the end of a run -- the free full test's, or since
   * #387 the ten-question test's -- so a run abandoned at question twelve is
   * somebody who will never see it. In the funnel that used to be a
   * `test_started` with no `test_finished` and no clue which question lost
   * them.
   *
   * Tenths again, so a 25-question paper and an 18-question one read alike,
   * and so a long test is a fixed handful of reports rather than one per
   * question -- which would also edge towards telling us which questions a
   * particular person was on when they gave up.
   */
  if (next.screen.name === 'test' && prev.screen.name === 'test') {
    const asked = next.screen.questionIds.length
    if (asked > 0) {
      const tenth = (at: number) => Math.floor((Math.min(at, asked) / asked) * 10)
      if (tenth(next.screen.current) > tenth(prev.screen.current)) {
        events.push({
          name: 'test_progress',
          fields: { state, mode: next.screen.mode, score: next.screen.current, total: asked },
        })
      }
    }
  }
  /**
   * Arriving from the run, and only from the run. The results screen is also
   * put back by "Not now" on the offer made from it (#387), and that arrival
   * was counting as a second finish -- one run, two `test_finished`, and a
   * `passed` rung that could exceed `tested`.
   */
  if (next.screen.name === 'results' && prev.screen.name === 'test') {
    const result = next.screen.result
    events.push({
      name: 'test_finished',
      fields: {
        state,
        mode: result.mode,
        score: result.score,
        total: result.total,
        // The app's own definition of passing, so the recorded rate and the
        // rate the learner was shown can never disagree.
        passed: isPassingScore(result, next.exam),
      },
    })
  }
  /**
   * The offer was drawn, which is a different fact from its being pressed.
   *
   * Guarded on the arrival from the run rather than on a render, for the same
   * reason `test_finished` above is: "Not now" puts this very screen back, and
   * a rule that fired whenever the results screen was on show would count the
   * offer again every time somebody looked at the price and declined it --
   * inflating exactly the denominator the press is measured against.
   *
   * `resultsOffer` is the button's own condition, so this is silent wherever
   * there is no button: after the pass, for a learner who already owns the
   * paper, and in a build with nothing to sell.
   */
  if (
    next.screen.name === 'results' &&
    prev.screen.name === 'test' &&
    resultsOffer(next) === 'priced'
  ) {
    events.push({ name: 'offer_shown', fields: { state } })
  }
  const level = currentLevel(next.progress, next.exam)
  if (level > currentLevel(prev.progress, prev.exam)) {
    events.push({ name: 'level_earned', fields: { state, level } })
  }
  if (next.screen.name === 'paywall' && prev.screen.name !== 'paywall') {
    events.push({ name: 'paywall_shown', fields: { state, reason: next.screen.reason } })
  }
  return events
}
