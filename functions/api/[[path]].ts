/**
 * Everything under /api/, served from the app's own address.
 *
 * The worker is the implementation and stays the implementation; this only
 * changes which door the browser knocks on.
 *
 * It exists because of Safari. The app is served from one registrable domain
 * and the worker from another -- `pages.dev` and `workers.dev` are both on the
 * Public Suffix List, so to a browser they are not two parts of one product,
 * they are strangers. A page that writes a persistent random id into
 * localStorage and posts it to a stranger on load is, in shape, a tracking
 * pixel. Safari's advanced privacy protection agrees: it puts a banner over the
 * app offering to reduce protections, and then it starts dropping the requests.
 *
 * It did. Three sessions reported and everything after was silently discarded,
 * which is the worst failure this system can have -- a dropped beacon is
 * indistinguishable from a visit that never happened, and it would have gone on
 * hiding iPhone users, who are most of mobile, behind numbers that looked fine.
 *
 * Same origin, so there is no third party to classify, no CORS preflight, and
 * nothing for a privacy heuristic to object to. When the app moves to its own
 * domain this can stay or go: `api.example.com` and `example.com` are same-site
 * and would work too. This works today, without owning a name.
 */

import { withVisitorGeo } from '../edge-geo'

interface Env {
  /**
   * Where the worker actually lives. Configured on the Pages project so that
   * moving the worker does not mean editing and redeploying the site; the
   * default is the address it has had all along, so a missing variable degrades
   * to working rather than to broken.
   */
  API_ORIGIN?: string
}

const DEFAULT_ORIGIN = 'https://learners-permit-api.joelstevick.workers.dev'

export const onRequest: PagesFunction<Env> = async (context) => {
  const incoming = new URL(context.request.url)
  const origin = (context.env.API_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, '')
  const target = `${origin}${incoming.pathname}${incoming.search}`

  // The method, the body and the content type all carry through unchanged --
  // the beacons are text/plain and the feedback is JSON, and the worker tells
  // them apart the same way it always has.
  //
  // The headers do not carry through unchanged, and that is the one thing this
  // hop has to add. Re-fetching the worker makes *us* the client, so the `cf`
  // it reads is our edge and not the visitor; `withVisitorGeo` copies the
  // visitor's own country, region, town, postcode, zone and network onto the
  // request before it leaves. See ../edge-geo.ts for the ten days of geo
  // columns that recorded Cloudflare because this was missing.
  const response = await fetch(target, {
    method: context.request.method,
    headers: withVisitorGeo(
      context.request.headers,
      context.request.cf as unknown as Record<string, unknown> | undefined,
    ),
    body: context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : context.request.body,
    // Required by workerd when a body is a stream rather than a buffer.
    duplex: 'half',
  } as RequestInit)

  // Returned as-is apart from being made mutable. The CORS headers the worker
  // attaches are simply unused now: a same-origin request does not consult them.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
