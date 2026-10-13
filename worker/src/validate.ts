/**
 * What everything arriving from a browser is checked and cleaned with.
 *
 * Three endpoints write to this database from the open internet, and all three
 * bound the same handful of things: an id that is a primary key, a state code
 * that is two letters, a number that must not be enormous, and text that must
 * not carry a proof of purchase. Kept here so the three parsers agree by
 * construction rather than by three copies staying in step -- and so that
 * `analytics.ts` and `feedback.ts` can share them without importing each other.
 */

/** A v4 UUID, as the app mints it. Bounded because it is written to a table. */
export const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Shape, not membership.
 *
 * Adding a state to this app is data-only -- a corpus file under
 * resource/corpus/ and its manifest entry, and nothing else -- and checking a code against a list here would quietly end
 * that: the day a third state shipped, its events would be dropped by a worker
 * nobody thought to redeploy. Two capitals bound the column; that is enough.
 */
export const STATE = /^[A-Z]{2}$/

/**
 * Shape, not membership -- the same reasoning as STATE above, one level up.
 *
 * A product is added to this app by shipping a corpus and a manifest entry.
 * Checking the id against a list here would mean the day a second product
 * launched, every one of its events was dropped by a worker nobody thought to
 * redeploy. Lowercase, bounded, and that is enough for a grouping column.
 */
export const PRODUCT = /^[a-z][a-z0-9-]{0,31}$/

/**
 * What a row with no product means.
 *
 * Every row written before there was a second exam was written by the driving
 * app, because it was the only app there was -- which is why `events` and
 * `purchases` are both read through `COALESCE(product, 'drivers')` rather than
 * backfilled with a constant. The same answer serves a checkout arriving from a
 * bundle deployed before it learned to name its product: a purchase filed under
 * the wrong exam would be worse than one filed under the one that was, until
 * today, the only possibility.
 */
export const DEFAULT_PRODUCT = 'drivers'

/**
 * A hostname, as a referrer reduces to.
 *
 * Only the host is ever kept -- never the path and never the query. A full
 * referrer URL routinely carries the search terms somebody typed, the private
 * group they were reading, and occasionally a token: unbounded text from the
 * open internet, arriving in a table built to hold codes. The host answers the
 * question that was actually asked ("which sites send us people") and carries
 * none of that.
 */
export const SOURCE_HOST = /^[a-z0-9][a-z0-9.-]{0,63}$/

/**
 * A campaign or source label off a `utm_` parameter.
 *
 * Shape, not membership, for the same reason PRODUCT is: a campaign is invented
 * by whoever writes the link, and a list here would mean the first newsletter
 * nobody redeployed the worker for went uncounted.
 */
export const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/**
 * The path somebody landed on, with no query and no fragment.
 *
 * This app's paths are structural -- `/drivers/MD/regulatory-signs` names an
 * exam, a state and a topic -- so the entry point says which page is doing the
 * work of bringing people in, which is the one question the search console
 * cannot answer about non-search traffic. The query string is dropped before
 * this ever sees it: that is where `?ref=` and anything a campaign appended
 * live, and none of it belongs in a column read back in group-bys.
 */
export const ENTRY_PATH = /^\/[A-Za-z0-9/_-]{0,95}$/

/**
 * How wide the window was, in three buckets and never in pixels.
 *
 * The app is mobile-first and the question is whether that is still the right
 * bet. An exact width is a fingerprinting surface for no extra answer; three
 * buckets settle the design argument and nothing else.
 */
export const VIEWPORT = /^(sm|md|lg)$/

/**
 * The primary language subtag, and only the primary one.
 *
 * `es` rather than `es-419`: the product question is whether enough people are
 * reading this in Spanish to be worth translating for, and the region subtag
 * adds nothing to that while narrowing the crowd somebody sits in.
 */
export const LANG = /^[a-z]{2,3}$/

export function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Defense in depth. The browser scrubs before sending, and this runs the same
 * removals again on arrival -- because the client half is the half an attacker
 * controls, and because free text is the one payload here that can carry
 * anything at all. Neither pass is trusted to be the only one.
 *
 * What always goes: the proof of purchase, the two ids that would re-join text
 * to an identity, and the query strings those arrive in.
 */
function redact(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s)]*?)\?[^\s)]*/g, '$1?<query>')
    .replace(/\bLP-[0-9A-Z]{4}-[0-9A-Z]{4}\b/gi, '<recovery-code>')
    .replace(/\b(cs|pi|sk|pk|price|prod|sub|cus)_[A-Za-z0-9_]+/g, '<stripe-id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
}

/**
 * Text nobody chose to send: a crash message, a stack trace. An address in one
 * of those got there by accident -- out of a URL, out of a browser-filled
 * field, out of an error string -- so it goes.
 */
export function scrub(text: string): string {
  return redact(text).replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>')
}

/**
 * Text somebody typed on purpose, knowing where it was going.
 *
 * The address stays, and that is the one line where this differs from `scrub`
 * above. Someone who writes "email me back at ..." is asking to be answered,
 * and redacting it destroys the only thing that made the comment answerable --
 * it would be the app deciding, on their behalf, that they did not mean it.
 * Everything else still goes: a recovery code pasted into a comment is still a
 * proof of purchase sitting in a table that has no use for one.
 */
export function scrubComment(text: string): string {
  return redact(text)
}
