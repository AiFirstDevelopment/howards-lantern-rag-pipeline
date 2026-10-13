/**
 * One address holds the app; every other name we own sends you to it.
 *
 * The reasoning lives in ./canonical.ts, next to the decision it explains. This
 * file is the Workers glue: read the configured host, redirect or carry on.
 *
 * `302`, temporarily, and that word is load-bearing.
 *
 * This was a 301 for about an hour, on the reasoning that a permanent redirect
 * is tidier: browsers stop asking, and the surviving name is what ends up in
 * bookmarks. Then the certification name was promoted from a redirect to a site
 * of its own -- and every browser that had already seen the 301 went on
 * redirecting anyway, because that is exactly what "permanent" licenses them to
 * do. The server said 200 and the browser never asked.
 *
 * Which name runs the app is a decision that can be revisited, and this one was
 * revisited the same afternoon. A redirect that cannot be taken back should not
 * be used for a decision that can. The cost of 302 is that browsers keep
 * asking; the cost of 301 was a site that looked broken and could only be fixed
 * by every visitor clearing their own cache.
 */

import { redirectTo } from './canonical'
import { canonicalPath } from './paths'

interface Env {
  /**
   * The hostnames that run the app, comma separated, first one winning for
   * anything not listed. Set on the Pages project rather than in the
   * repository, so adding or retiring a site is a dashboard change.
   *
   * Unset redirects nothing, which is why this can ship before the DNS exists.
   */
  CANONICAL_HOSTS?: string
  /** The single-host name this replaced. Read as a fallback so an old setting keeps working. */
  CANONICAL_HOST?: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const destination = redirectTo(url, context.env.CANONICAL_HOSTS ?? context.env.CANONICAL_HOST)
  if (destination !== null) return Response.redirect(destination, 302)

  /**
   * `308`, permanently, and the difference from the `302` above is the point.
   *
   * That one carries a product decision -- which of our names runs the app --
   * and was revisited the same afternoon it was made, which is why it must stay
   * takeable-back. This one carries a spelling. `/drivers/md` and `/drivers/MD/`
   * are not two decisions, they are one page and a way of typing it, and
   * Cloudflare Pages already answers the un-slashed form with a 308 of its own.
   *
   * What makes permanent safe here is that no URL this site publishes is ever
   * redirected: every canonical tag, every sitemap entry and every internal
   * link already names the target spelling. Only a path somebody typed or
   * mis-cased reaches this line, so a browser that caches the answer forever
   * has cached something we would never have wanted to change.
   */
  const spelled = canonicalPath(url.pathname)
  if (spelled !== null) {
    return Response.redirect(`${url.origin}${spelled}${url.search}`, 308)
  }

  return await context.next()
}
