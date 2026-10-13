/**
 * Which hostnames run the app, decided without touching a request object so it
 * can be tested from the app's own suite.
 *
 * More than one name may run it. Each is its own site: the browser scopes
 * `localStorage` to an origin, so a visitor's study progress, test history,
 * analytics id and the flag that says they paid belong to whichever name they
 * arrived at. Two sites are therefore two audiences with two sets of everything,
 * which is a deliberate choice here rather than an accident -- the two names are
 * being run as separate properties.
 *
 * The cost is worth naming because it will eventually be somebody's support
 * question: a learner who studies on one name and later types the other finds an
 * empty app and a purchase that appears not to exist, and has to use the
 * recovery code from their receipt. Nothing in the app can detect that, because
 * from its side the second visit is simply a new browser.
 *
 * What is *not* split is `www`. That prefix is a typing accident rather than a
 * choice, so it is folded onto its own bare name -- splitting there would halve
 * each audience for no reason. Anything else we own but do not run, such as the
 * old `pages.dev` address, goes to the first site in the list.
 */

/** Split a comma-separated host list, tolerating spaces and empties. */
function parseHosts(configured: string | undefined): string[] {
  return (configured ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
}

/**
 * Where a request should go, or null to serve it where it is.
 *
 * `configured` unset means redirect nothing, which is the state before any
 * custom domain exists and is what lets this ship ahead of the DNS.
 */
export function redirectTo(url: URL, configured: string | undefined): string | null {
  const sites = parseHosts(configured)
  if (sites.length === 0) return null

  const host = url.hostname.toLowerCase()
  // A site, on its own name. This is the branch that keeps the two apart.
  if (sites.includes(host)) return null

  // Preview deployments are addressed by a prefix on the project's own name --
  // `<commit>.<project>.pages.dev`, `<branch>.<project>.pages.dev` -- and have
  // to keep working as themselves or no build could be looked at before
  // release. `<project>.pages.dev` carries no prefix and is not a preview: it
  // is the app's old address, and it goes to the first site like anything else.
  if (host.endsWith('.pages.dev') && host.split('.').length > 3) return null

  // `www` is a typo, not a decision: fold it onto the site it belongs to.
  const bare = host.startsWith('www.') ? host.slice(4) : host
  const target = sites.includes(bare) ? bare : sites[0]

  // Path and query carry over. The fragment never reaches a server, and the
  // browser reapplies it to the destination itself -- which is what keeps a
  // shared /#privacy link working across the redirect.
  return `https://${target}${url.pathname}${url.search}`
}
