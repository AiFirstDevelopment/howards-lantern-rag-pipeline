/**
 * The visitor's own location and network, carried by hand across the API hop.
 *
 * `functions/api/[[path]].ts` re-fetches the worker at the worker's own
 * hostname, so the `request.cf` the worker reads describes *that* connection --
 * Cloudflare calling Cloudflare -- and not the learner who opened the page.
 * Every geo column written since that proxy shipped on 2026-09-01 is therefore
 * the colo we answered from rather than the person we answered.
 *
 * It looked right for ten days because colos are real places: Baltimore,
 * Pittsburgh, Amsterdam, Zhengzhou all read as plausible learners. `as_org` is
 * what gave it away -- "Cloudflare, Inc." on every one of the sixteen rows that
 * had one, which is not a distribution any population of ISPs produces. That
 * column was added to tell a crawler fleet from a Maryland learner
 * (docs/todo.md item 3) and could never have answered the question, because the
 * only network it could ever see was ours.
 *
 * A Pages function is the last place in the chain that still sees the visitor.
 * So it reads the six fields here and sends them on as headers.
 *
 * The headers are *set*, never appended, and the incoming ones are deleted
 * first: a browser that sends `x-visitor-city: Nowhere` has it overwritten
 * before the worker sees it, which keeps the property `event.test.ts` already
 * pins -- the page cannot name its own town.
 */

/**
 * Each field, the `request.cf` key it comes from, and the header it travels in.
 *
 * The worker keeps its own copy of the header names -- it cannot import this
 * file, being a separate bundle with a separate tsconfig -- and
 * `tests/unit/visitor-geo.test.ts` holds the two lists equal. A header stamped
 * here under a name the worker does not read would not fail anything: it would
 * silently leave the geo columns reading Cloudflare, which is exactly the
 * failure this file exists to end.
 */
export const VISITOR_GEO_FIELDS = [
  { cf: 'country', header: 'x-visitor-country' },
  { cf: 'regionCode', header: 'x-visitor-region' },
  { cf: 'city', header: 'x-visitor-city' },
  { cf: 'postalCode', header: 'x-visitor-postal-code' },
  { cf: 'timezone', header: 'x-visitor-timezone' },
  { cf: 'asOrganization', header: 'x-visitor-as-org' },
] as const

/**
 * Says the hop happened at all.
 *
 * Without it the worker cannot tell "the proxy found no city for this visitor"
 * from "no proxy ran", and the two want opposite answers: the first is a null
 * city, the second is a request whose own `cf` is genuine and should be used.
 * Falling back field by field would mix them -- a visitor whose city did not
 * resolve would silently get the colo's city back, which is the same defect in
 * a smaller place.
 */
export const VISITOR_EDGE_HEADER = 'x-visitor-edge'

/**
 * The request's headers, with the visitor's own geo stamped on.
 *
 * Takes `cf` as an argument rather than reaching into the request, because
 * `cf` is a Workers extension: Node's `Request` drops it from the init object
 * without a word, and a version of this that read `request.cf` could only ever
 * be tested by the runtime it is meant to be checked against. It returned six
 * nulls under the suite and looked like a bug in the test.
 *
 * Values are percent-encoded because a header is Latin-1 and a town is not:
 * "Zürich" either throws or arrives mangled. `readGeo` in the worker decodes.
 */
export function withVisitorGeo(
  requestHeaders: Headers,
  cf: Record<string, unknown> | undefined,
): Headers {
  const headers = new Headers(requestHeaders)

  headers.set(VISITOR_EDGE_HEADER, '1')
  for (const field of VISITOR_GEO_FIELDS) {
    headers.delete(field.header)
    const value = cf?.[field.cf]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    headers.set(field.header, encodeURIComponent(trimmed))
  }
  return headers
}
