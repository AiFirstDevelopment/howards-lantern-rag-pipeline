/**
 * How the app is used, written as a closed set of events and read back only as
 * aggregates.
 *
 * Two halves, and the wall between them is the point. `parseEvent` is a
 * gatekeeper: a public unauthenticated write can be sent anything, so nothing
 * reaches the table that is not a name from the enum plus bounded numbers.
 * `computeStats` is the only reader, and it can only produce counts -- there is
 * no code path here that returns a row, a session id, or a single answer.
 */

import {
  computeFeedbackStats,
  emptyTally,
  type FeedbackStats,
  type FeedbackTally,
} from './feedback'
import {
  CAMPAIGN,
  ENTRY_PATH,
  LANG,
  PRODUCT,
  SESSION,
  SOURCE_HOST,
  STATE,
  VIEWPORT,
  isInteger,
  scrub,
} from './validate'

export const EVENT_NAMES = [
  'opened',
  'state_chosen',
  'study_progress',
  'card_answered',
  'pass_complete',
  // The short course chosen, and the short course finished
  // (docs/plans/short-course.md). `short_complete` is its own name rather
  // than a field on `pass_complete`, so that rung goes on counting learners
  // who finished the whole pass.
  'short_course_chosen',
  'short_complete',
  'test_started',
  'test_progress',
  'test_finished',
  'level_earned',
  // The offer on the ten-question test's results, counted when it is shown.
  // `paywall_shown` is the press; this is the look. Without both, a campaign
  // that sells nothing cannot say whether the price was refused or never seen.
  'offer_shown',
  'paywall_shown',
  // The pass bar at a checkpoint pressed: the only way into the section map.
  'map_opened',
  // A concept the pass has taught, walked over again from the map.
  'section_revised',
  // A section ahead of the pass, asked as questions from the map instead of
  // being taught. Two names rather than one with a field, because a row is a
  // column per field and a new column is a migration.
  'section_tested_out',
  // The Buy button pressed. The one step between the price and a row in
  // `purchases`, and without it "saw the price, did not pay" cannot say which
  // of two opposite things happened: nobody pressed, or everybody pressed and
  // nobody finished at Stripe.
  'checkout_started',
  'unknown_product',
  'unknown_state',
  'unknown_concept',
  'referral_seen',
  'referral_applied',
  'unknown_referral',
  'result_shared',
  // Somebody looked at the first screen and left without pressing anything.
  // The one event that fires with no action behind it, which is why it
  // carries a duration and nothing else: it exists to say whether an arrival
  // that pressed nothing read the page or bounced off it.
  'left_landing',
  // The partner portal's front page and its application form, opened. Counted
  // against the applications in `partners` on the admin dashboard, so a pitch
  // nobody reads and a pitch everybody reads and leaves can be told apart.
  'partners_viewed',
  'partners_apply_viewed',
  // A page the menu leads to, opened. Which one travels as `page` and is kept
  // in the `entry` column; see `EventRow.entry`.
  'page_viewed',
  // The operator's own browser, saying so. Stored like any other row and read
  // by nothing but `AN_OPERATOR` in learners.ts, which drops the session from
  // the tiles and the roster together.
  'operator_session',
  // A chip under the nationwide box tapped (docs/plans/trusted-by-date.md,
  // decision 18). Which chip travels as `chip` and is kept in `entry`. Counted
  // here because nothing else is written: a tap shows a stored answer and asks
  // the model nothing, so no `learner_questions` row says it happened.
  'chip_tapped',
  // One of a state's chips under the box tapped (docs/plans/what-happens-if.md,
  // decision 24). Which chip travels as `chip` and is kept in `entry`; the
  // state in `state`. A name of its own rather than a field on `chip_tapped`:
  // that shape refuses a state, because a nationwide answer has none, and
  // every state's pool is the same twelve ids, so without the state the
  // stats could not tell Maryland's curfew answer from Texas's.
  'state_chip_tapped',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

/** The app's `MENU_PAGES`, held to it by tests/unit/event-vocabulary.test.ts. */
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

export interface EventRow {
  session: string
  /**
   * The id a purchase is attached to, carried so that behavior and purchase
   * can be read together -- "did this buyer actually use it", and "what did
   * the people who bought do first". Both ids are random numbers minted on the
   * device; neither is a name.
   */
  device: string | null
  /**
   * Which of our sites this happened on. The app runs under more than one
   * name, each its own origin with its own storage, so they are two audiences
   * -- and pooling them in the numbers would make the split unreadable.
   */
  site: string | null
  /**
   * Which exam it was about. The app teaches more than one, reached by URL,
   * and a state means something different under each -- so without this two
   * products pool into one funnel and every existing figure becomes an average
   * of two things nobody wanted averaged.
   *
   * Null on the rows written before the column existed; read through
   * COALESCE(product, 'drivers'), because the app those rows came from was the
   * driving one.
   */
  product: string | null
  name: EventName
  state: string | null
  law: string | null
  /**
   * The partner code a referral event was about.
   *
   * Only ever set by the three referral events, and the reason they are worth
   * having at all: a count of dead codes says something is wrong, and the code
   * itself says which campaign. It is also the numerator of the one ratio that
   * catches coupon leakage -- a partner whose redemptions arrive with no
   * matching referral clicks is being redeemed by people they never sent.
   *
   * It names a partner's campaign, never a person. Nothing about the buyer is
   * in it.
   */
  ref: string | null
  mode: string | null
  /**
   * Where this visit came from, and it is deliberately not `ref`.
   *
   * `ref` above is a partner's campaign code -- who handed out a card. This is
   * the site that linked here: a forum, a school's page, a search engine. The
   * two answer different questions and were conflated in conversation once,
   * which is why they sit next to each other with this note between them.
   *
   * A host and never a URL, and never one of our own hosts: an in-app
   * navigation reports the site it is already on, and counting that would make
   * howardslantern.com the largest referrer to howardslantern.com.
   *
   * Set only by `opened`, and null for the visit that was typed in directly --
   * which is most of them.
   */
  source: string | null
  /** The `utm_campaign` on the link, for a newsletter or an ad. `opened` only. */
  campaign: string | null
  /**
   * The path landed on, no query and no fragment, on `opened`. On
   * `page_viewed` it is which menu page was opened, one of `MENU_PAGES` -- a
   * page the visitor went to is the same kind of fact as the page they arrived
   * on, and a column of its own would be a D1 migration for one closed list.
   * Read it with the event name, never alone.
   */
  entry: string | null
  /** Window width as one of three buckets, never pixels. `opened` only. */
  viewport: string | null
  /**
   * The primary language subtag. On `opened` it is what the browser reads; on
   * `state_chosen` it is the language the learner chose the state in, `en` or
   * `es` (docs/plans/spanish-app.md, §6). On nothing else.
   */
  lang: string | null
  score: number | null
  total: number | null
  /** Seconds on the first screen before leaving. Only ever on `left_landing`. */
  seconds: number | null
  /**
   * Which door led to the price. On `paywall_shown`, and on `checkout_started`
   * so the press can be read against the look door by door.
   *
   * Optional there, and that is deliberate rather than lax: every phone
   * holding the bundle from before this shipped goes on sending the event
   * bare for as long as its tab lives, and a required field would refuse each
   * one with a 204 and no trace -- which is exactly how `unknown_concept` was
   * discarded for a whole release. Null means "sent by an older app", not
   * "reached by an unknown door".
   */
  reason: string | null
  level: number | null
  passed: number | null
}

/**
 * Exactly which fields each event may carry. Anything absent that is required,
 * or present that is not listed, is not one of our events -- which is the whole
 * of "closed set". Kept as data so the table below reads like the plan's.
 */
const SHAPES: Record<EventName, { required: readonly string[]; optional: readonly string[] }> = {
  // The one event that carries how somebody arrived. On `opened` alone rather
  // than on every beacon: it is a fact about the visit, not about the action,
  // and repeating it on each of forty study events would be forty copies of one
  // answer and forty chances to disagree with it.
  opened: {
    required: [],
    optional: ['state', 'source', 'campaign', 'entry', 'viewport', 'lang'],
  },
  // The language the state was chosen in, the one event besides `opened` that
  // carries it: "which states get picked, and in which language".
  state_chosen: { required: ['state'], optional: ['lang'] },
  // A position and a length, and deliberately nothing else. Which card, and
  // whether it was answered right, are facts about a person rather than about
  // the material -- see docs/plans/add-observability.md.
  study_progress: { required: ['state', 'score', 'total'], optional: [] },
  // The one event that carries which card, and whether it was answered right.
  // See worker/schema.sql for what that changed and why it was worth changing.
  card_answered: { required: ['state', 'law', 'passed'], optional: [] },
  pass_complete: { required: ['state'], optional: [] },
  // The state, and nothing else. Which course somebody is on is the event's
  // own name, and how far they got is `study_progress` -- a field here would
  // be a column on `events` and a migration, for a fact two names carry.
  short_course_chosen: { required: ['state'], optional: [] },
  short_complete: { required: ['state'], optional: [] },
  test_started: { required: ['state', 'mode'], optional: [] },
  // A position and a length, like study_progress: how far in, never which
  // question and never whether it was right.
  test_progress: { required: ['state', 'mode', 'score', 'total'], optional: [] },
  test_finished: {
    required: ['state', 'mode', 'score', 'total', 'passed'],
    optional: [],
  },
  level_earned: { required: ['state', 'level'], optional: [] },
  offer_shown: { required: ['state'], optional: [] },
  // `reason` is optional for the reason written on `EventRow.reason`: a bundle
  // that predates it is still sending this event, and refusing those would
  // put a hole in the rung the day it shipped.
  paywall_shown: { required: ['state'], optional: ['reason'] },
  // The three the section map sends. `state` and nothing else: which concept
  // was tapped is a fact about a person's route through one state's material,
  // and `card_answered` is the only event that carries that grain -- see the
  // privacy page for why it is the exception rather than the pattern.
  map_opened: { required: ['state'], optional: [] },
  section_revised: { required: ['state'], optional: [] },
  section_tested_out: { required: ['state'], optional: [] },
  // The same door as the paywall it was pressed on, and optional for the same
  // reason -- it is read off the screen, and a screen from an older bundle
  // may not carry one.
  checkout_started: { required: ['state'], optional: ['reason'] },
  // A broken link, arriving as a count and nothing else. No state: the whole
  // point of these three is that the path named something we do not have, so
  // there is no state to attribute them to -- and a code that is not one of
  // ours must not appear in the per-state numbers as though it were.
  unknown_product: { required: [], optional: [] },
  unknown_state: { required: [], optional: [] },
  // Nothing at all, on purpose. It says who is at the keyboard and must never
  // grow a field: anything it carried would be a fact about the operator's own
  // testing, kept forever, answering no question anybody has.
  operator_session: { required: [], optional: [] },
  // Nothing: which page is the name, and who is asking is not a question the
  // pitch needs answered. A field here would be the first thing a partner's
  // own visits could be picked out by.
  partners_viewed: { required: [], optional: [] },
  partners_apply_viewed: { required: [], optional: [] },
  // Which page, and nothing about who opened it or from where.
  page_viewed: { required: ['page'], optional: [] },
  // Which chip, and nothing else: not the question's words, which are the
  // chip's own, and not the state, which a nationwide answer has none of.
  chip_tapped: { required: ['chip'], optional: [] },
  // Which chip and the state it answered for, and nothing else: not the
  // question's words, which are the chip's own.
  state_chip_tapped: { required: ['chip', 'state'], optional: [] },
  // The third of them, and the one that was missing here for long enough to
  // matter: the app has been sending it since the SEO pass, this closed set
  // did not know the name, and so every one was discarded with a 204 -- no
  // error, no row, no sign anything had happened. It answers whether a search
  // result still points at a concept the corpus has since renamed, which is
  // exactly the question a site that has just been reorganized needs to ask.
  // tests/unit/event-vocabulary.test.ts now holds the two lists together.
  unknown_concept: { required: [], optional: [] },
  // The three referral events. Each carries the code and nothing else: which
  // link was clicked, which code reached a checkout, and -- the one worth more
  // than the other two combined -- which code resolved to nothing, because a
  // campaign that has quietly died looks exactly like one nobody is using.
  referral_seen: { required: [], optional: ['ref'] },
  referral_applied: { required: [], optional: ['ref'] },
  unknown_referral: { required: [], optional: ['ref'] },
  // The state, and nothing else -- no score, no level, nothing about the
  // sentence that was posted. Which of the three sentences a learner was
  // offered is already the level they hold, and the level is already counted.
  result_shared: { required: ['state'], optional: [] },
  // A duration, and the state whose page it was when there was one. Never
  // the address, which is already on `opened` for the same session.
  left_landing: { required: ['seconds'], optional: ['state'] },
}

/** A full paper is tens of questions. The bound is a table-filling guard. */
const MAX_QUESTIONS = 500
const MAX_LEVEL = 99
/** Seconds on the first screen: a day is the ceiling, see `parseEvent`. */
const MAX_SECONDS = 86_400

/**
 * The submitted body, or null if it is not one of our events.
 *
 * Null is not an error condition to report. The caller answers 204 either way:
 * a browser that sent something we do not recognize has nothing useful to do
 * with the news, and telling the internet which payloads are accepted only
 * helps whoever is probing.
 */
export function parseEvent(body: unknown): EventRow | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const input = body as Record<string, unknown>

  const name = input.name
  if (typeof name !== 'string') return null
  if (!(EVENT_NAMES as readonly string[]).includes(name)) return null
  const eventName = name as EventName

  const session = input.session
  if (typeof session !== 'string' || !SESSION.test(session)) return null

  const shape = SHAPES[eventName]
  // `device`, `site` and `product` are allowed on every event rather than
  // listed in each shape: they say who and where, not what, so they are
  // orthogonal to which event this is.
  const allowed = new Set([
    'name', 'session', 'device', 'site', 'product', ...shape.required, ...shape.optional,
  ])
  for (const key of Object.keys(input)) if (!allowed.has(key)) return null
  for (const key of shape.required) if (input[key] === undefined) return null

  const row: EventRow = {
    session,
    device: null,
    site: null,
    product: null,
    name: eventName,
    state: null,
    law: null,
    ref: null,
    mode: null,
    source: null,
    campaign: null,
    entry: null,
    viewport: null,
    lang: null,
    score: null,
    total: null,
    seconds: null,
    reason: null,
    level: null,
    passed: null,
  }

  if (input.site !== undefined && input.site !== null) {
    // A hostname, bounded. It is a label for grouping, not a free text field.
    if (typeof input.site !== 'string' || !/^[a-z0-9.-]{1,64}$/.test(input.site)) return null
    row.site = input.site
  }
  if (input.product !== undefined && input.product !== null) {
    // Shaped, not checked against a list. A second product ships as data --
    // a corpus and a manifest entry -- and a worker validating ids against
    // something it does not have would drop every one of its events until
    // somebody remembered to redeploy this.
    if (typeof input.product !== 'string' || !PRODUCT.test(input.product)) return null
    row.product = input.product
  }
  if (input.device !== undefined && input.device !== null) {
    // The same shape as the id `devices` is keyed by, which is the whole point
    // of carrying it: it has to join.
    if (typeof input.device !== 'string' || !SESSION.test(input.device)) return null
    row.device = input.device
  }
  if (input.state !== undefined) {
    if (typeof input.state !== 'string' || !STATE.test(input.state)) return null
    row.state = input.state
  }
  if (input.law !== undefined) {
    // Shaped, not checked against the corpus: adding a state is data-only here,
    // and a worker validating ids against a list it does not have would drop a
    // new state's cards until somebody remembered to redeploy it.
    if (typeof input.law !== 'string' || !/^[A-Za-z]{2}-[0-9]{1,6}$/.test(input.law)) return null
    row.law = input.law
  }
  if (input.mode !== undefined) {
    // 'diagnostic' is the ten-question test the app offers before the study
    // pass is covered. Stored like any other mode rather than dropped: a
    // beacon this worker refuses is a rung that reads zero forever, and the
    // reports tell the modes apart in SQL -- see `notDiagnostic` below.
    if (input.mode !== 'full' && input.mode !== 'missed' && input.mode !== 'diagnostic') {
      return null
    }
    row.mode = input.mode
  }
  if (input.reason !== undefined) {
    // A closed enum like `mode`, checked here rather than trusted: the three
    // are the three doors to the price in src/flow.ts, and a fourth string
    // arriving in this column would be a rung nobody can name.
    if (input.reason !== 'offer' && input.reason !== 'wall' && input.reason !== 'spent') {
      return null
    }
    row.reason = input.reason
  }
  if (input.ref !== undefined && input.ref !== null) {
    // The same shape `partner_codes` is keyed by, uppercased on arrival so the
    // numbers group the way the table does -- a code typed in lower case off a
    // whiteboard must not become a second campaign in the reports.
    if (typeof input.ref !== 'string') return null
    const ref = input.ref.toUpperCase()
    if (!/^[A-Z0-9]{3,32}$/.test(ref)) return null
    row.ref = ref
  }
  if (input.source !== undefined && input.source !== null) {
    // Lowercased on arrival for the same reason `ref` is uppercased: one site
    // must not become two rows because a browser sent a capital.
    if (typeof input.source !== 'string') return null
    const source = input.source.toLowerCase()
    if (!SOURCE_HOST.test(source)) return null
    row.source = source
  }
  if (input.campaign !== undefined && input.campaign !== null) {
    if (typeof input.campaign !== 'string') return null
    const campaign = input.campaign.toLowerCase()
    if (!CAMPAIGN.test(campaign)) return null
    row.campaign = campaign
  }
  if (input.entry !== undefined && input.entry !== null) {
    // Not lowercased: `/drivers/MD` and `/drivers/md` are one page only because
    // the edge redirects one to the other, and folding them here would hide a
    // link somewhere that is costing a redirect on every visit.
    if (typeof input.entry !== 'string' || !ENTRY_PATH.test(input.entry)) return null
    row.entry = input.entry
  }
  if (input.page !== undefined) {
    // A closed list rather than a pattern: anything else is not one of our
    // pages, and a free string here would be a field anything could travel in.
    if (!(MENU_PAGES as readonly unknown[]).includes(input.page)) return null
    row.entry = input.page as string
  }
  if (input.chip !== undefined) {
    // Shaped, not checked against the pool: the pool is data that changes
    // with a rebuild, and a worker holding a stale list would drop the taps on
    // every chip added since -- with a 204 and no trace, as `unknown_concept`
    // once was.
    if (typeof input.chip !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input.chip)) return null
    row.entry = input.chip
  }
  if (input.viewport !== undefined && input.viewport !== null) {
    if (typeof input.viewport !== 'string' || !VIEWPORT.test(input.viewport)) return null
    row.viewport = input.viewport
  }
  if (input.lang !== undefined && input.lang !== null) {
    if (typeof input.lang !== 'string') return null
    const lang = input.lang.toLowerCase()
    if (!LANG.test(lang)) return null
    row.lang = lang
  }
  if (input.total !== undefined) {
    if (!isInteger(input.total, 1, MAX_QUESTIONS)) return null
    row.total = input.total
  }
  if (input.score !== undefined) {
    if (!isInteger(input.score, 0, MAX_QUESTIONS)) return null
    // A score above its own total is not a run that happened.
    if (row.total !== null && input.score > row.total) return null
    row.score = input.score
  }
  if (input.seconds !== undefined) {
    // A day, which nobody spends on a landing page: a tab left open overnight
    // reports as one, and anything past it is a clock that went wrong.
    if (!isInteger(input.seconds, 0, MAX_SECONDS)) return null
    row.seconds = input.seconds
  }
  if (input.level !== undefined) {
    if (!isInteger(input.level, 0, MAX_LEVEL)) return null
    row.level = input.level
  }
  if (input.passed !== undefined) {
    if (typeof input.passed !== 'boolean') return null
    row.passed = input.passed ? 1 : 0
  }
  return row
}

/**
 * One row in one table. `purchases` and `devices` are not named here, and
 * nothing in this file may ever name them: the analytics half of this worker
 * writes events and reads events.
 */
export async function recordEvent(
  db: D1Database,
  row: EventRow,
  geo: EventGeo,
  at: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO events ' +
        '(at, session, device, site, product, name, state, law, mode, score, total, seconds, level, passed, ' +
        'country, region, city, postal_code, timezone, as_org, ' +
        'ref, source, campaign, entry, viewport, lang, reason) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      at, row.session, row.device, row.site, row.product, row.name, row.state, row.law,
      row.mode, row.score, row.total, row.seconds, row.level, row.passed,
      geo.country, geo.region, geo.city, geo.postalCode, geo.timezone, geo.asOrganization,
      row.ref,
      row.source, row.campaign, row.entry, row.viewport, row.lang, row.reason,
    )
    .run()
}

/**
 * Roughly where a request came from, taken from the connection rather than
 * from the body -- which is what separates it from every other field here.
 *
 * `parseEvent` above is a gatekeeper over what the browser says about itself.
 * This is not passed through it, and must never be: a page that could name its
 * own country would make the column worth nothing, and would do it quietly.
 * The two are kept apart in the types for that reason -- `EventGeo` is not part
 * of `EventRow`, so there is no shape in which a body can arrive carrying one.
 */
export interface EventGeo {
  /** ISO two-letter, as the edge resolved it. Null when it had no answer. */
  country: string | null
  /**
   * The region code -- inside the United States, the state. The code rather
   * than the name, because it is then the same alphabet as the state a visitor
   * picks, and the question this column exists to answer ("is the exam they
   * are studying the one where they live?") becomes an equals sign.
   */
  region: string | null
  /** The town the edge resolved, free text and bounded rather than a code. */
  city: string | null
  /** The postcode the edge resolved. Also free text: formats differ by country. */
  postalCode: string | null
  /** An IANA zone, e.g. "America/New_York". Stable, and finer than a region. */
  timezone: string | null
  /**
   * Who owns the network the request came over.
   *
   * The most useful field here and the least obvious. A residential ISP and a
   * cloud provider look identical in every other column, and the difference is
   * exactly the question docs/todo.md item 3 asks: seventeen sessions from one
   * region with one event each is either a school class or a crawler fleet,
   * and the network operator is the only column that answers it.
   */
  asOrganization: string | null
}

export const NO_GEO: EventGeo = {
  country: null,
  region: null,
  city: null,
  postalCode: null,
  timezone: null,
  asOrganization: null,
}

/**
 * The header each geo field arrives in when the request came through the site's
 * own address, and the header that says it did.
 *
 * A second copy of the names in `functions/edge-geo.ts`, because the two are
 * separate bundles with separate tsconfigs and neither can import the other.
 * `tests/unit/visitor-geo.test.ts` holds them equal: a name that drifts on one
 * side breaks nothing loudly, it just puts Cloudflare back in the geo columns.
 */
export const VISITOR_GEO_HEADERS = {
  country: 'x-visitor-country',
  region: 'x-visitor-region',
  city: 'x-visitor-city',
  postalCode: 'x-visitor-postal-code',
  timezone: 'x-visitor-timezone',
  asOrganization: 'x-visitor-as-org',
} as const

/** Set by the Pages proxy on every request it forwards. See `readGeo`. */
export const VISITOR_EDGE_HEADER = 'x-visitor-edge'

/**
 * Where the request came from, as the edge that met the visitor worked it out.
 *
 * The IP address is neither read here nor stored anywhere: both sources below
 * are answers an edge arrived at before this worker ran.
 *
 * Two sources, and which is right depends on how the request reached us.
 *
 * `/api/` is served from the site's own address and proxied here by
 * `functions/api/[[path]].ts`, which re-fetches this worker over the public
 * internet. On that path our own `request.cf` describes Cloudflare talking to
 * Cloudflare -- not a coarser answer, an answer about the wrong connection --
 * and it is why `as_org` read "Cloudflare, Inc." on every row between
 * 2026-09-12 and the commit that added this. So when the proxy says it ran, its
 * headers are the whole answer and `cf` is ignored outright: a field it could
 * not resolve is a null, never a reason to reach back for the colo's own town.
 *
 * With no such header the request arrived directly -- the workers.dev hostname,
 * or a test -- and there `cf` is genuinely about the caller.
 *
 * Nothing here is trusted further than the endpoint already trusts a caller.
 * The beacon takes unauthenticated bodies by design, so anyone who could forge
 * a header could already forge the whole session. What the delete-then-set in
 * `withVisitorGeo` buys is that a *browser* on the normal path cannot, which is
 * the property `event.test.ts` pins.
 *
 * Absent in a plain `new Request()`, so this answers nulls rather than throwing
 * when there is no edge in front of it.
 */
export function readGeo(request: Request): EventGeo {
  if (request.headers.get(VISITOR_EDGE_HEADER) !== null) {
    const visitor = (field: keyof typeof VISITOR_GEO_HEADERS): string | null =>
      decodeVisitor(request.headers.get(VISITOR_GEO_HEADERS[field]))
    return {
      country: geoCode(visitor('country')),
      region: geoCode(visitor('region')),
      city: geoText(visitor('city')),
      postalCode: geoText(visitor('postalCode')),
      timezone: geoText(visitor('timezone')),
      asOrganization: geoText(visitor('asOrganization')),
    }
  }

  const cf = (request as { cf?: Record<string, unknown> }).cf
  return {
    country: geoCode(cf?.country),
    region: geoCode(cf?.regionCode),
    city: geoText(cf?.city),
    postalCode: geoText(cf?.postalCode),
    timezone: geoText(cf?.timezone),
    asOrganization: geoText(cf?.asOrganization),
  }
}

/**
 * Undo the percent-encoding `withVisitorGeo` applies.
 *
 * A header is Latin-1 and a town is not, so "Zürich" crosses the hop encoded. A
 * malformed sequence throws in `decodeURIComponent`, and no beacon is worth a
 * 500: an undecodable town is no town.
 */
function decodeVisitor(value: string | null): string | null {
  if (value === null) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * A free-text geo field, bounded.
 *
 * Not `geoCode`: a town, a postcode, a zone and a network operator are none of
 * them two or three characters, and squeezing them through that pattern would
 * store null for every one of them while looking like it worked. Bounded
 * because these arrive from the edge rather than from a body but still end up
 * in a column, and a column with no length on it is a column somebody fills.
 */
function geoText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, GEO_TEXT_LIMIT)
  return text === '' ? null : text
}

/** Long enough for "Kingston upon Thames" and for an AS name. */
export const GEO_TEXT_LIMIT = 80

/**
 * A short code, or nothing.
 *
 * The edge is trusted and still bounded: this column is read back in group-bys,
 * and the cost of being wrong about that trust is unbounded text in a table
 * that is supposed to hold codes. Cloudflare's own oddities pass -- 'T1' for
 * Tor, 'XX' for unknown -- because they are answers, and flattening them to
 * null would quietly file them with the rows that were never asked.
 */
function geoCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9]{1,3}$/.test(code) ? code : null
}

export const ERROR_KINDS = ['render', 'rejection', 'window'] as const
export type ErrorKind = (typeof ERROR_KINDS)[number]

export interface ErrorRow {
  session: string
  kind: ErrorKind
  screen: string | null
  message: string
  stack: string
  release: string | null
}

/** Bounded on this side too: the client's limits are a courtesy, not a control. */
const MESSAGE_LIMIT = 300
const STACK_LIMIT = 2000
const SCREEN_LIMIT = 40
const RELEASE_LIMIT = 40

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null
  return scrub(value).slice(0, limit)
}

/** The submitted crash, or null if it is not one of ours. */
export function parseError(body: unknown): ErrorRow | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const input = body as Record<string, unknown>

  const allowed = new Set(['session', 'kind', 'screen', 'message', 'stack', 'release'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) return null

  const session = input.session
  if (typeof session !== 'string' || !SESSION.test(session)) return null

  const kind = input.kind
  if (typeof kind !== 'string' || !(ERROR_KINDS as readonly string[]).includes(kind)) return null

  // A crash with neither a message nor a stack says nothing worth storing.
  const message = text(input.message, MESSAGE_LIMIT) ?? ''
  const stack = text(input.stack, STACK_LIMIT) ?? ''
  if (message.length === 0 && stack.length === 0) return null

  // Component names only: a screen is reported, so it is shaped, not trusted.
  let screen: string | null = null
  if (input.screen !== undefined && input.screen !== null) {
    if (typeof input.screen !== 'string') return null
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(input.screen)) return null
    screen = input.screen.slice(0, SCREEN_LIMIT)
  }

  let release: string | null = null
  if (input.release !== undefined && input.release !== null) {
    if (typeof input.release !== 'string') return null
    if (!/^[A-Za-z0-9._-]+$/.test(input.release)) return null
    release = input.release.slice(0, RELEASE_LIMIT)
  }

  return { session, kind: kind as ErrorKind, screen, message, stack, release }
}

/**
 * A stable identity for "the same bug", so fifty crashes are one thing to fix.
 *
 * Built from the kind, the screen and a *normalised* message -- and pointedly
 * NOT from the stack. Stack positions are minified offsets (`index-abc.js:1:45231`)
 * that move on every build, so a fingerprint containing them would mint a fresh
 * issue on every deploy and nothing could ever stay marked fixed. Kind, screen
 * and message survive a rebuild; that is what identity has to be made of.
 *
 * The message is normalised because the varying part of an error is usually a
 * value: an index, an id, a quoted name. Two crashes that differ only in which
 * law id was undefined are one bug.
 */
export function fingerprintOf(kind: string, screen: string | null, message: string): string {
  const normalized = message
    .replace(/\d+/g, 'N')
    .replace(/'[^']*'/g, "'V'")
    .replace(/"[^"]*"/g, '"V"')
    .replace(/<[a-z-]+>/g, '<V>')
    .trim()
    .toLowerCase()
  return hash(`${kind}|${screen ?? ''}|${normalized}`)
}

/** FNV-1a, 32-bit. Short enough to read out and type back in. */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export async function recordCrash(db: D1Database, row: ErrorRow, at: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO errors (at, session, kind, screen, message, stack, release, fingerprint) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      at,
      row.session,
      row.kind,
      row.screen,
      row.message,
      row.stack,
      row.release,
      fingerprintOf(row.kind, row.screen, row.message),
    )
    .run()
}

export const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365

export function windowDays(raw: string | null): number {
  if (raw === null) return DEFAULT_WINDOW_DAYS
  const days = Number(raw)
  if (!Number.isInteger(days) || days < 1) return DEFAULT_WINDOW_DAYS
  return Math.min(days, MAX_WINDOW_DAYS)
}

/**
 * Where the four score bands fall, as fractions of the paper being sat.
 *
 * Maryland asks 25 and Pennsylvania asks 18, so a band written as an absolute
 * score would file every Pennsylvania run into the bottom two buckets and make
 * a shorter paper look like a worse corpus -- which is the exact misreading
 * this histogram exists to prevent. Scaled to the paper, it compares like with
 * like, and it needs no edit when a third state arrives with a third length.
 *
 * The edges are Maryland's own: 12, 18 and 22 out of 25, so a 25-question
 * paper still buckets as 0-11 / 12-17 / 18-21 / 22-25 exactly.
 */
const BAND_STARTS = [12, 18, 22] as const
const BAND_REFERENCE = 25

/**
 * The four bands for a paper of `total` questions, lowest first.
 *
 * Integer arithmetic on purpose: `total * 12 / 25` is exactly 12 for a
 * 25-question paper where `total * 0.48` is a hair under it, and one rounding
 * away from relabelling Maryland's own bands. A band with no scores in it --
 * only possible on an absurdly short paper -- is left out rather than given a
 * backwards label.
 */
function bandsFor(total: number): { label: string; from: number }[] {
  const starts = [0, ...BAND_STARTS.map((s) => Math.ceil((total * s) / BAND_REFERENCE))]
  const bands: { label: string; from: number }[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i]
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : total
    if (from > to) continue
    bands.push({ label: `${from}-${to}`, from })
  }
  return bands
}

function histogramFor(total: number): Record<string, number> {
  return Object.fromEntries(bandsFor(total).map((band) => [band.label, 0]))
}

/** Which band a score falls in, as a position rather than a label. */
function bandIndex(score: number, total: number): number {
  const bands = bandsFor(total)
  let index = 0
  for (let i = 0; i < bands.length; i += 1) if (score >= bands[i].from) index = i
  return index
}

/**
 * Everything this endpoint says about one state -- including, now, what the
 * people who sat that state's real exam said about it.
 *
 * `passed / tests` is how often the *practice* test is passed. `exam.passed /
 * (exam.passed + exam.failed)` is how often the real one is. The gap between
 * those two numbers is the only measure of calibration this app can produce,
 * and it is the reason feedback is reported per state rather than only in
 * total: a practice test that is too easy cannot detect that on its own.
 */
/** A card, how often it was met, and how often it was missed first time. */
export interface HardCard {
  law: string
  firstAttempts: number
  missRate: number
}

/** Sessions by how far into the study pass they got, in tenths. */
export type StudyDropOff = Record<string, number>

function emptyDropOff(): StudyDropOff {
  return Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`${(i + 1) * 10}%`, 0]),
  )
}

export interface StateStats extends FeedbackTally {
  chosen: number
  pass_complete: number
  tests: number
  passed: number
  scoreHistogram: Record<string, number>
  levels: Record<string, number>
  /**
   * How far into the study pass each session got, counted once per session at
   * its furthest point. `100%` is a finished pass.
   *
   * This is where drop-off actually happens and it used to be invisible: the
   * funnel went straight from `state_chosen` to `pass_complete`, so somebody
   * who left on the third card and somebody who left on the thirtieth were the
   * same silence. A pile in the low tenths is a pass that is too long or opens
   * badly; a flat spread is people running out of time.
   */
  studyDropOff: StudyDropOff
  /**
   * How far into a test each session got, counted once per session at its
   * furthest question. `100%` finished the paper.
   *
   * The last place a learner can be lost before the offer: the paywall is met
   * by asking for a *second* full test, so a run abandoned two thirds through
   * is somebody who never sees it.
   */
  testDropOff: StudyDropOff
  /**
   * The ten cards missed most often on a first meeting, worst first.
   *
   * This is the list that changes the corpus. A card at the top is either badly
   * written, badly distractored, or teaching something the card before it
   * should have. Ten, because a list nobody reads is not a finding.
   */
  hardestCards: HardCard[]
}

export interface Stats {
  window: { days: number; from: string; to: string }
  /**
   * How many times each thing happened. Useful for volume and almost nothing
   * else -- see `people` below, which is the unit most questions are actually
   * asked in.
   */
  funnel: Record<string, number>
  /**
   * How many distinct browsers reached each step, and how many arrived at all.
   *
   * This is the ladder to read as a ladder: `visitors` down to
   * `finished_a_test` only ever falls, and wherever it falls hardest is the
   * thing to fix. Counting events instead would let one person reloading eight
   * times look like eight arrivals.
   */
  people: {
    visitors: number
    chose_a_state: number
    started_studying: number
    finished_the_pass: number
    took_a_test: number
    finished_a_test: number
    /**
     * Was SHOWN the offer on the ten-question test's results (#387).
     *
     * Deliberately not placed as a rung that `saw_the_paywall` is read as a
     * fall from: every rung here is filtered by `notDiagnostic`, which drops
     * the ten-question runs this offer follows, so `finished_a_test` does not
     * contain these people and this number can exceed it. What it is for is
     * the pair immediately below it -- shown, then pressed.
     */
    saw_the_offer: number
    /** Pressed through to the price. Zero for as long as the paywall is dormant. */
    saw_the_paywall: number
    pressed_buy: number
  }
  /**
   * Money, counted rather than named.
   *
   * A count over a window beside another count over the same window: enough to
   * say "roughly one in twenty of the people who saw the offer bought", and
   * deliberately not enough to say which ones.
   *
   * That used to be a property of the data -- the two identities were kept
   * apart, so no query could have said more. They are joined now, on purpose,
   * and `conversion` below reads across them. What keeps this figure a count is
   * the endpoint rather than the schema: /api/stats is public, and a public
   * reader can only receive a column this function names.
   */
  purchases: {
    count: number
    conversionOfPaywallShown: number | null
    conversionOfCheckoutStarted: number | null
  }
  /**
   * Which door people came to the price by, as events.
   *
   * `offer` is the ten-question results (#387), `wall` the end of the free
   * section (#391), `spent` a full test asked for after the free one. `older`
   * is an event from a bundle that predates the field -- not a fourth door,
   * and it drains to zero as tabs are closed. Kept visible rather than folded
   * into one of the three, because a number that silently absorbs the unknown
   * is how a rung starts lying.
   */
  paywallReasons: { offer: number; wall: number; spent: number; older: number }
  /**
   * The ladder per site, since the app runs under more than one name and each
   * is its own audience with its own storage. Comparing the two is the reason
   * for running them separately at all.
   */
  sites: Record<string, { visitors: number; chose_a_state: number; finished_the_pass: number; took_a_test: number; saw_the_paywall: number }>
  /**
   * The same ladder per exam, because the app teaches more than one and they
   * are reached by URL rather than by menu.
   *
   * Without this the two pool: "how many people finish the study pass" becomes
   * an average over two different passes, and every number that was worth
   * reading before stops meaning anything. `feedback` rides along because
   * which exam somebody passed is the whole point of asking whether they did.
   *
   * Rows written before the column existed count as `drivers` -- see the
   * COALESCE below -- so the 484 that were already there keep counting.
   */
  products: Record<
    string,
    {
      visitors: number
      chose_a_state: number
      finished_the_pass: number
      took_a_test: number
      saw_the_paywall: number
      feedback: FeedbackTally
    }
  >
  /**
   * How often each rung of the ladder ends in a sale.
   *
   * This is what the ids being joinable buys. `purchases.count` says how many
   * bought; this says what those people had *done* first, so "what do we need
   * to do to get people to pay" stops being a guess. If the rate jumps between
   * finishing the pass and finishing a test, the test is the thing that sells;
   * if it is flat until the paywall, the offer is doing all the work.
   *
   * `of` is how many browsers reached that rung; `bought` is how many of those
   * ids appear against a purchase.
   */
  conversion: { stage: string; of: number; bought: number }[]
  states: Record<string, StateStats>
  daily: { date: string; opened: number; test_finished: number }[]
  /**
   * First-try accuracy on the study cards, by day.
   *
   * The population getting better, rather than any individual: a rising line
   * means the material teaches, a flat one means it is being memorised or
   * skipped. Nobody's own curve is computed here, and the mastery record that
   * would allow it never leaves the learner's browser.
   */
  learning: { date: string; answers: number; correct: number }[]
  returning: { sessionsWithPriorDay: number; total: number }
  /**
   * How many crashes, of which kind. Counts only, and deliberately: this
   * endpoint is public, so it must not be able to publish a stack trace. The
   * query below selects `kind` and nothing else from the errors table.
   */
  errors: { total: number; byKind: Record<string, number> }
  /**
   * Ratings and self-reported exam outcomes, as counts. Never a comment: what
   * people write lives in its own table, is selected by its own module, and is
   * read with an authenticated tool. This endpoint is public, and a public
   * endpoint that could return free text would not merely store a scrubbing
   * mistake, it would publish one.
   */
  feedback: FeedbackStats
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The ladder's test rungs mean the practice test, and nothing else.
 *
 * `took_a_test` and `finished_a_test` are read as "reached the thing the
 * paywall is about", and the ten-question diagnostic is deliberately not that
 * thing: it is ungated, unlimited, and does not consume the free full test. A
 * rung that counted it would climb the day the diagnostic shipped and say
 * nothing about whether anybody sat a paper -- and the conversion ladder
 * underneath it would divide purchases by a denominator that had changed
 * meaning.
 *
 * Written as one predicate used by every query that reads a rung, because the
 * first draft of this filtered `people` alone and left the per-site and
 * per-product ladders counting something different under the same column name.
 * Exported for `learners.ts`, which computes the partner and operator portals'
 * own `tested` rung from the same table: the second draft filtered this file
 * and left that one counting diagnostics, so a partner's funnel read "took a
 * practice test: 20" under "started studying: 6".
 *
 * NULL-safe on `mode`, and that is not defensive decoration. `mode` is NULL on
 * every event that is not a test, and it is also NULL on any test row written
 * around the validator -- every fixture in `worker/tests` inserts straight into
 * the table. `mode = 'diagnostic'` is NULL rather than false for those, and
 * `NOT NULL` is NULL, which a WHERE clause and a CASE both read as no: without
 * the explicit IS NULL arm this predicate silently drops the very rows it is
 * meant to keep, and a rung reads zero with nothing to show for it.
 */
export function notDiagnostic(prefix = ''): string {
  return (
    `NOT (${prefix}name IN ('test_started', 'test_finished') ` +
    `AND ${prefix}mode IS NOT NULL AND ${prefix}mode = 'diagnostic')`
  )
}

function emptyState(): StateStats {
  return {
    chosen: 0,
    pass_complete: 0,
    tests: 0,
    passed: 0,
    scoreHistogram: {},
    levels: {},
    studyDropOff: emptyDropOff(),
    testDropOff: emptyDropOff(),
    hardestCards: [],
    ratings: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    exam: { passed: 0, failed: 0, not_yet: 0, unanswered: 0 },
  }
}

/**
 * Everything GET /api/stats can say, which is counts and rates over a window.
 *
 * Six grouped queries and no row-level read anywhere: the endpoint is public,
 * so the guarantee that it cannot leak a session id or a single answer has to
 * hold in the SQL rather than in a filter applied afterwards.
 */
export async function computeStats(db: D1Database, days: number, now: number): Promise<Stats> {
  const since = now - days * 86_400_000

  const funnelRows = await db
    .prepare('SELECT name, COUNT(*) AS c FROM events WHERE at >= ? GROUP BY name')
    .bind(since)
    .all<{ name: string; c: number }>()

  // The ladder again, split by the site it happened on -- which is the whole
  // reason the app runs under two names rather than redirecting one to the
  // other. Without this the two audiences are added together and the split
  // answers nothing.
  const siteRows = await db
    .prepare(
      'SELECT site, name, COUNT(DISTINCT session) AS people FROM events ' +
        `WHERE at >= ? AND site IS NOT NULL AND ${notDiagnostic()} ` +
        'GROUP BY site, name',
    )
    .bind(since)
    .all<{ site: string; name: string; people: number }>()

  // The same ladder split by exam. COALESCE rather than a backfill: every row
  // written before the column existed came from the driving app, because it
  // was the only app there was -- so an UPDATE could write nothing but that
  // same constant, and would rewrite history to do it.
  const productRows = await db
    .prepare(
      "SELECT COALESCE(product, 'drivers') AS product, name, COUNT(DISTINCT session) AS people " +
        // COALESCE repeated rather than `GROUP BY product`: the alias shares
        // its name with the real column, and SQLite groups by the column --
        // which would put the null rows in their own group and then label it
        // 'drivers' as well, so one of the two would silently win.
        `FROM events WHERE at >= ? AND ${notDiagnostic()} ` +
        "GROUP BY COALESCE(product, 'drivers'), name",
    )
    .bind(since)
    .all<{ product: string; name: string; people: number }>()

  const productVisitorRows = await db
    .prepare(
      "SELECT COALESCE(product, 'drivers') AS product, COUNT(DISTINCT session) AS people " +
        "FROM events WHERE at >= ? GROUP BY COALESCE(product, 'drivers')",
    )
    .bind(since)
    .all<{ product: string; people: number }>()

  const siteVisitorRows = await db
    .prepare(
      'SELECT site, COUNT(DISTINCT session) AS people FROM events ' +
        'WHERE at >= ? AND site IS NOT NULL GROUP BY site',
    )
    .bind(since)
    .all<{ site: string; people: number }>()

  // The same ladder counted in people rather than in events.
  //
  // `funnel` counts things that happened, which is the wrong unit for almost
  // every question worth asking: one person who reloads eight times is eight
  // `opened` events and one visitor, and a sentence like "most people leave
  // before the first test" cannot be built out of event counts at all.
  const peopleRows = await db
    .prepare(
      'SELECT name, COUNT(DISTINCT session) AS people FROM events ' +
        `WHERE at >= ? AND ${notDiagnostic()} GROUP BY name`,
    )
    .bind(since)
    .all<{ name: string; people: number }>()

  const visitorRow = await db
    .prepare('SELECT COUNT(DISTINCT session) AS people FROM events WHERE at >= ?')
    .bind(since)
    .first<{ people: number }>()

  const stateRows = await db
    .prepare(
      'SELECT state, name, mode, passed, COUNT(*) AS c FROM events ' +
        'WHERE at >= ? AND state IS NOT NULL GROUP BY state, name, mode, passed',
    )
    .bind(since)
    .all<{ state: string; name: string; mode: string | null; passed: number | null; c: number }>()

  // Which door led to the price. Grouped in SQL rather than counted in the
  // loop above, because `reason` is on one event and grouping the whole funnel
  // by it would add a column of nulls to every other row.
  const reasonRows = await db
    .prepare(
      "SELECT reason, COUNT(*) AS c FROM events WHERE at >= ? AND name = 'paywall_shown' " +
        'GROUP BY reason',
    )
    .bind(since)
    .all<{ reason: string | null; c: number }>()

  // Grouped, so what comes back is a count per distinct score -- never a run.
  const scoreRows = await db
    .prepare(
      'SELECT state, total, score, COUNT(*) AS c FROM events ' +
        "WHERE at >= ? AND name = 'test_finished' AND mode = 'full' " +
        'AND state IS NOT NULL AND score IS NOT NULL AND total IS NOT NULL ' +
        'GROUP BY state, total, score',
    )
    .bind(since)
    .all<{ state: string; total: number; score: number; c: number }>()

  const levelRows = await db
    .prepare(
      "SELECT state, level, COUNT(*) AS c FROM events WHERE at >= ? AND name = 'level_earned' " +
        'AND state IS NOT NULL AND level IS NOT NULL GROUP BY state, level',
    )
    .bind(since)
    .all<{ state: string; level: number; c: number }>()

  // Where people stop inside the study pass, one row per session rather than
  // per event: what matters is how far someone got, not how many times they
  // were counted getting there. Expressed in tenths so a state with 37 cards
  // and a state with two hundred can be read side by side.
  const studyRows = await db
    .prepare(
      'SELECT state, tenth, COUNT(*) AS sessions FROM (' +
        'SELECT state, session, MAX((score * 10) / total) AS tenth FROM events ' +
        "WHERE at >= ? AND name = 'study_progress' AND state IS NOT NULL " +
        'AND score IS NOT NULL AND total > 0 GROUP BY state, session' +
        ') GROUP BY state, tenth',
    )
    .bind(since)
    .all<{ state: string; tenth: number; sessions: number }>()

  const testProgressRows = await db
    .prepare(
      'SELECT state, tenth, COUNT(*) AS sessions FROM (' +
        'SELECT state, session, MAX((score * 10) / total) AS tenth FROM events ' +
        "WHERE at >= ? AND name = 'test_progress' AND mode = 'full' AND state IS NOT NULL " +
        'AND score IS NOT NULL AND total > 0 GROUP BY state, session' +
        ') GROUP BY state, tenth',
    )
    .bind(since)
    .all<{ state: string; tenth: number; sessions: number }>()

  // Which cards fail to teach.
  //
  // First attempts only, and the reason is the whole point of collecting this:
  // the study loop makes you answer a card again until you get it right, so
  // counting every attempt would say that every card is eventually learned,
  // which is true and useless. What is worth knowing is how often a card is
  // missed by somebody meeting it for the first time.
  const cardRows = await db
    .prepare(
      'SELECT state, law, COUNT(*) AS attempts, SUM(passed) AS correct FROM (' +
        'SELECT state, law, session, passed, ' +
        'ROW_NUMBER() OVER (PARTITION BY session, law ORDER BY at) AS attempt ' +
        'FROM events ' +
        "WHERE at >= ? AND name = 'card_answered' AND law IS NOT NULL AND state IS NOT NULL" +
        ') WHERE attempt = 1 GROUP BY state, law',
    )
    .bind(since)
    .all<{ state: string; law: string; attempts: number; correct: number | null }>()

  /**
   * How often each rung ends in a sale.
   *
   * One query per rung would be five round trips; this is one, grouped by the
   * event name, joining the browsers that reached a rung to the ones that show
   * up against a purchase. `devices` is keyed by the id the app now carries on
   * every event, which is the join that used to be impossible on purpose.
   */
  const conversionRows = await db
    .prepare(
      'SELECT e.name AS stage, COUNT(DISTINCT e.device) AS reached, ' +
        'COUNT(DISTINCT d.device_id) AS bought ' +
        'FROM events e LEFT JOIN devices d ON d.device_id = e.device ' +
        `WHERE e.at >= ? AND e.device IS NOT NULL AND ${notDiagnostic('e.')} ` +
        'GROUP BY e.name',
    )
    .bind(since)
    .all<{ stage: string; reached: number; bought: number }>()

  // Whether people are getting better, as the population rather than as
  // individuals: first-try accuracy by day. A rising line means the material is
  // teaching; a flat one means it is being memorised or skipped.
  const accuracyRows = await db
    .prepare(
      "SELECT date(at / 1000, 'unixepoch') AS d, COUNT(*) AS answers, " +
        'SUM(passed) AS correct FROM events ' +
        "WHERE at >= ? AND name = 'card_answered' GROUP BY d ORDER BY d",
    )
    .bind(since)
    .all<{ d: string; answers: number; correct: number | null }>()

  const dailyRows = await db
    .prepare(
      "SELECT date(at / 1000, 'unixepoch') AS d, " +
        "SUM(name = 'opened') AS opened, SUM(name = 'test_finished') AS finished " +
        'FROM events WHERE at >= ? GROUP BY d ORDER BY d',
    )
    .bind(since)
    .all<{ d: string; opened: number; finished: number }>()

  // `kind` and a count. No message column, no stack column, on purpose.
  const errorRows = await db
    .prepare('SELECT kind, COUNT(*) AS c FROM errors WHERE at >= ? GROUP BY kind')
    .bind(since)
    .all<{ kind: string; c: number }>()

  // Counts only, and computed in feedback.ts rather than here, so that no
  // query in this file has any way to name the column the comments are in.
  const feedback = await computeFeedbackStats(db, since)

  // A count and nothing else: no join, no device id, no row.
  const purchaseRow = await db
    .prepare('SELECT COUNT(*) AS c FROM purchases WHERE created_at >= ?')
    .bind(since)
    .first<{ c: number }>()

  const returningRows = await db
    .prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN days > 1 THEN 1 ELSE 0 END) AS withPrior FROM (' +
        "SELECT session, COUNT(DISTINCT date(at / 1000, 'unixepoch')) AS days " +
        'FROM events WHERE at >= ? GROUP BY session)',
    )
    .bind(since)
    .all<{ total: number; withPrior: number | null }>()

  const funnel: Record<string, number> = {
    opened: 0,
    state_chosen: 0,
    study_progress: 0,
    card_answered: 0,
    pass_complete: 0,
    test_started: 0,
    test_progress: 0,
    test_finished: 0,
    // The offer shown, then the offer pressed. Two numbers rather than one,
    // because a campaign that produces no sales is read here: many shown and
    // few pressed is a button nobody sees, many pressed and none bought is a
    // price nobody wants, and until `offer_shown` existed those arrived as the
    // same silence.
    offer_shown: 0,
    // Not in the plan's sketch, but it is one of the seven events and a number
    // nobody can read is not observability. Zero while the paywall is dormant.
    paywall_shown: 0,
    // The press, after the price. `purchases.count` is the step after this one.
    checkout_started: 0,
  }
  for (const row of funnelRows.results) {
    if (row.name in funnel) funnel[row.name] = row.c
  }

  const states: Record<string, StateStats> = {}
  const stateFor = (code: string): StateStats => (states[code] ??= emptyState())

  for (const row of stateRows.results) {
    const stats = stateFor(row.state)
    if (row.name === 'state_chosen') stats.chosen += row.c
    if (row.name === 'pass_complete') stats.pass_complete += row.c
    // Completed full runs, so `passed / tests` is a pass rate and the histogram
    // below sums to `tests`. Starts are in the funnel, where drop-off is read.
    if (row.name === 'test_finished' && row.mode === 'full') {
      stats.tests += row.c
      if (row.passed === 1) stats.passed += row.c
    }
  }

  // The paper this state actually sat, taken as the length most of its runs
  // used, so one stray run against an older corpus cannot relabel the bands.
  const commonTotal = new Map<string, { total: number; count: number }>()
  for (const row of scoreRows.results) {
    const held = commonTotal.get(row.state)
    if (held === undefined || row.c > held.count || (row.c === held.count && row.total > held.total)) {
      commonTotal.set(row.state, { total: row.total, count: row.c })
    }
  }
  for (const [code, { total }] of commonTotal) {
    stateFor(code).scoreHistogram = histogramFor(total)
  }
  for (const row of scoreRows.results) {
    const stats = stateFor(row.state)
    // Banded against the paper it was actually sat, so a run against an older
    // corpus lands in the band it earned rather than the band its label says.
    const labels = Object.keys(stats.scoreHistogram)
    // By position, not by name: a run sat against a paper of a different length
    // is banded against its own paper and counted in the matching band here,
    // rather than dropped for carrying a label this state does not use.
    const label = labels[Math.min(bandIndex(row.score, row.total), labels.length - 1)]
    if (label !== undefined) stats.scoreHistogram[label] += row.c
  }

  for (const row of levelRows.results) {
    stateFor(row.state).levels[String(row.level)] = row.c
  }

  for (const row of studyRows.results) {
    const label = `${Math.min(Math.max(row.tenth, 1), 10) * 10}%`
    const stats = stateFor(row.state)
    if (label in stats.studyDropOff) stats.studyDropOff[label] += row.sessions
  }

  // Worst first, and only cards enough people have met for the rate to mean
  // something: one person missing a card once is not evidence about the card.
  const MIN_ATTEMPTS = 5
  for (const row of cardRows.results) {
    if (row.attempts < MIN_ATTEMPTS) continue
    const missRate = (row.attempts - (row.correct ?? 0)) / row.attempts
    stateFor(row.state).hardestCards.push({
      law: row.law,
      firstAttempts: row.attempts,
      missRate: Math.round(missRate * 100) / 100,
    })
  }
  for (const stats of Object.values(states)) {
    stats.hardestCards.sort((a, b) => b.missRate - a.missRate || b.firstAttempts - a.firstAttempts)
    stats.hardestCards = stats.hardestCards.slice(0, 10)
  }

  for (const row of testProgressRows.results) {
    const label = `${Math.min(Math.max(row.tenth, 1), 10) * 10}%`
    const stats = stateFor(row.state)
    if (label in stats.testDropOff) stats.testDropOff[label] += row.sessions
  }

  // A state somebody rated but never generated an event for still gets a row:
  // the rating happened, and dropping it would hide the one state whose
  // learners had something to say.
  for (const [code, tally] of Object.entries(feedback.byState)) {
    const stats = stateFor(code)
    stats.ratings = tally.ratings
    stats.exam = tally.exam
  }

  // Null is its own bucket rather than being dropped or folded into a door:
  // it means an app bundle older than the column, and a total that quietly
  // lost those rows would disagree with `funnel.paywall_shown` for a week with
  // nothing to say why.
  const reasons = { offer: 0, wall: 0, spent: 0, older: 0 }
  for (const row of reasonRows.results) {
    if (row.reason === 'offer' || row.reason === 'wall' || row.reason === 'spent') {
      reasons[row.reason] = row.c
    } else {
      reasons.older += row.c
    }
  }

  const returning = returningRows.results[0]
  const peopleFor = (name: string): number =>
    peopleRows.results.find((row) => row.name === name)?.people ?? 0

  return {
    window: { days, from: isoDate(since), to: isoDate(now) },
    funnel,
    people: {
      visitors: visitorRow?.people ?? 0,
      chose_a_state: peopleFor('state_chosen'),
      started_studying: peopleFor('study_progress'),
      finished_the_pass: peopleFor('pass_complete'),
      took_a_test: peopleFor('test_started'),
      finished_a_test: peopleFor('test_finished'),
      saw_the_offer: peopleFor('offer_shown'),
      saw_the_paywall: peopleFor('paywall_shown'),
      pressed_buy: peopleFor('checkout_started'),
    },
    // In the order the ladder is climbed, so it reads down the page.
    conversion: [
      'state_chosen',
      'study_progress',
      'pass_complete',
      'test_started',
      'test_finished',
      // Between the two for reading order only. It is NOT a step down from
      // `test_finished`: every stage above is filtered by `notDiagnostic` and
      // this one is not filtered at all, because the run it follows is a
      // ten-question one. Read the pair `offer_shown` -> `paywall_shown`, which
      // is the same population, and never the drop into it.
      'offer_shown',
      'paywall_shown',
      // The last rung before the purchase itself. `of` here against
      // `saw_the_paywall` is the press rate; `bought` against `of` is what
      // happens at Stripe. They were one indistinguishable silence before.
      'checkout_started',
    ].map((stage) => {
      const row = conversionRows.results.find((r) => r.stage === stage)
      return { stage, of: row?.reached ?? 0, bought: row?.bought ?? 0 }
    }),
    sites: Object.fromEntries(
      siteVisitorRows.results.map((row) => {
        const at = (name: string) =>
          siteRows.results.find((r) => r.site === row.site && r.name === name)?.people ?? 0
        return [
          row.site,
          {
            visitors: row.people,
            chose_a_state: at('state_chosen'),
            finished_the_pass: at('pass_complete'),
            took_a_test: at('test_started'),
            saw_the_paywall: at('paywall_shown'),
          },
        ]
      }),
    ),
    products: Object.fromEntries(
      productVisitorRows.results.map((row) => {
        const at = (name: string) =>
          productRows.results.find((r) => r.product === row.product && r.name === name)?.people ?? 0
        return [
          row.product,
          {
            visitors: row.people,
            chose_a_state: at('state_chosen'),
            finished_the_pass: at('pass_complete'),
            took_a_test: at('test_started'),
            saw_the_paywall: at('paywall_shown'),
            // An exam somebody rated without generating an event for it still
            // gets its tally, the same way a state does: the rating happened.
            feedback: feedback.byProduct[row.product] ?? emptyTally(),
          },
        ]
      }),
    ),
    purchases: {
      count: purchaseRow?.c ?? 0,
      // Null rather than zero when nobody has seen the offer: a rate with no
      // denominator is not 0%, it is a question that has not been asked yet.
      conversionOfPaywallShown:
        peopleFor('paywall_shown') > 0
          ? (purchaseRow?.c ?? 0) / peopleFor('paywall_shown')
          : null,
      // The same rate one step later, so the two can be read against each
      // other: a low first and a high second is a price that is not pressed;
      // a high first and a low second is a checkout that loses people.
      conversionOfCheckoutStarted:
        peopleFor('checkout_started') > 0
          ? (purchaseRow?.c ?? 0) / peopleFor('checkout_started')
          : null,
    },
    paywallReasons: reasons,
    states: Object.fromEntries(Object.entries(states).sort(([a], [b]) => a.localeCompare(b))),
    daily: dailyRows.results.map((row) => ({
      date: row.d,
      opened: row.opened ?? 0,
      test_finished: row.finished ?? 0,
    })),
    learning: accuracyRows.results.map((row) => ({
      date: row.d,
      answers: row.answers,
      correct: row.correct ?? 0,
    })),
    returning: {
      sessionsWithPriorDay: returning?.withPrior ?? 0,
      total: returning?.total ?? 0,
    },
    feedback: feedback.overall,
    errors: {
      total: errorRows.results.reduce((sum, row) => sum + row.c, 0),
      byKind: Object.fromEntries(
        ERROR_KINDS.map((kind) => [
          kind,
          errorRows.results.find((row) => row.kind === kind)?.c ?? 0,
        ]),
      ),
    },
  }
}
