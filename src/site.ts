/**
 * Which of our names the visitor came in through, written the way it should be
 * read rather than the way a browser stores it.
 *
 * The app runs under more than one name and each is its own origin, so a
 * visitor's progress belongs to whichever one they arrived at. Saying which
 * one, on every screen, is the only cue they get: two people can be looking at
 * the same app with entirely different progress, and nothing else on the page
 * would explain why.
 *
 * Hostnames are case-insensitive and arrive lowercased, so the capitals here
 * are a deliberate rendering rather than an echo of what was typed.
 */

/** The name a local run stands in for -- the site nearly every visitor lands on. */
const CANONICAL_HOST = 'howardslantern.com'

const NAMES: Record<string, string> = {
  'howardslantern.com': 'HowardsLantern.com',
  'howardslanterncertification.com': 'HowardsLanternCertification.com',
}

/**
 * Where a developer is standing. Shows the default name, so the header on a
 * local run looks like the header in production.
 *
 * This used to return null, on the argument that `localhost:4174` is noise on
 * a developer's screen. That was right about the hostname and wrong about the
 * consequence: what it actually produced was a header that was blank in every
 * place anybody ever looks at this app, and the site name being "missing" was
 * reported three times in one day by somebody looking at a local run. A cue
 * that is invisible exactly where it is checked is not a cue.
 *
 * `127.0.0.1` as well as the name, because `vite preview` and a phone on the
 * LAN reach it by address.
 */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * The label for a hostname, or null where there is nothing worth saying.
 *
 * Null for preview deployments and for anything we do not run: a label there
 * would be a lie. Only the names we publish, and localhost, get one.
 *
 * `www` is folded because it is a typing accident rather than a different
 * place -- the redirect takes it to the bare name anyway, and showing
 * `www.` for the instant before that would be a flicker of the wrong answer.
 */
export function siteLabel(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  if (LOCAL.test(host)) return NAMES[CANONICAL_HOST]
  return NAMES[host] ?? null
}

/**
 * The label for the page currently being viewed, with a partner's own name
 * standing in for ours where one has asked for it.
 *
 * The substitution happens **only where our own canonical name would have been
 * shown**, which is the one constraint that matters here. The other name this
 * app answers on is a separate property with separate storage and separate
 * purchases, and that little label is how somebody can tell which of the two
 * holds their progress -- so a partner's name there would be a lie about
 * something a visitor has no other way to check. Partner links always point at
 * the canonical name, so this costs nothing.
 *
 * `siteLabel` above stays a pure function of the hostname. This is the only
 * place the two ideas meet, and the caller supplies the name rather than this
 * file reaching into storage for it.
 */
export function currentSiteLabel(insteadOfOurs: string | null = null): string | null {
  try {
    const label = siteLabel(window.location.hostname)
    if (insteadOfOurs !== null && label === NAMES[CANONICAL_HOST]) return insteadOfOurs
    return label
  } catch {
    return null
  }
}
