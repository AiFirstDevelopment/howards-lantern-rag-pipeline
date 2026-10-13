/**
 * How a path is spelled, decided without touching a request object so it can be
 * tested from the app's own suite.
 *
 * Every page this site publishes is now a file: `/drivers/MD/` is
 * `drivers/MD/index.html`, and `/drivers/MD/right-of-way/` is one directory
 * deeper. A static host can only match a file by its exact name, so the spelling
 * stopped being cosmetic the moment the pages became real.
 *
 * `parsePath` in src/path.ts is deliberately case-insensitive, because a URL
 * gets retyped by hand off a flyer and `/drivers/md` should work. It still
 * does -- but it now works by arriving here first and being sent to the one
 * spelling that names a file, rather than by the app quietly accepting anything
 * and rendering from an `index.html` that Pages served as a fallback.
 */

/**
 * Path segments Cloudflare Pages serves before the app is reached: the
 * Functions proxy, the built bundle, the corpus, the recorded voice. Repeated
 * from src/products.ts rather than imported, because a Pages Function and the
 * browser bundle are two builds and this one may not reach into src/.
 * tests/unit/canonical-path.test.ts holds the two copies together -- and earned
 * its keep the day `audio` was added to one of them and not the other.
 */
export const RESERVED: readonly string[] = [
  'admin',
  'api',
  'assets',
  'audio',
  'how-it-works',
  'partners',
  'resource',
  'sales-rep',
]

/**
 * The addresses public/_redirects sends to the app's hash pages with a 302
 * (docs/plans/trust-signals.md, decision 7). This middleware runs before that
 * file is read, so without this list `/terms` was answered here first -- a
 * permanent 308 to `/terms/` -- and every browser that typed it would cache a
 * redirect nobody chose. tests/unit/canonical-path.test.ts reads _redirects and
 * holds this list to it.
 */
export const REDIRECTED: readonly string[] = ['terms', 'privacy', 'faq', 'about']

/**
 * The second segment of the comparison pages, `/drivers/laws/` and
 * `/drivers/laws/<topic>/` (docs/plans/nationwide.md). Not a state code, so it
 * is not upper-cased: read as one, every comparison page in the sitemap was
 * answered with a permanent 308 to `/drivers/LAWS/`, a file that does not
 * exist -- cached by every browser that followed it, and caught only by
 * routing.spec.ts under `wrangler pages dev`. Repeated from `LAWS_SEGMENT` in
 * src/path.ts for the reason RESERVED is; tests/unit/canonical-path.test.ts
 * holds the two together.
 */
export const COMPARED_SEGMENT = 'laws'

/** The most segments this site publishes: product, state, concept. */
const DEEPEST = 3

/**
 * Where a path should be sent, or null to serve it where it is.
 *
 * Null is the answer for everything that is not shaped like one of our pages --
 * a file with an extension, a reserved prefix, a path deeper than we publish --
 * because the cost of being wrong here is redirecting a bundle to nowhere and
 * taking the site down. It only ever rewrites a path made of two or three plain
 * segments, which is the only shape it knows anything about.
 */
export function canonicalPath(pathname: string): string | null {
  const parts = pathname.split('/').filter((part) => part.length > 0)
  if (parts.length === 0 || parts.length > DEEPEST) return null
  // A dot means a filename -- `/og-image.jpg`, `/assets/index-abc123.js`,
  // `/robots.txt`. Upper-casing the second segment of one of those would break
  // it, and breaking `/assets/` breaks every page at once.
  if (parts.some((part) => part.includes('.'))) return null
  if (RESERVED.includes(parts[0].toLowerCase())) return null
  // A leading underscore is Cloudflare's own namespace -- `_headers`,
  // `_redirects`, `_routes.json`, `_worker.js`. They sit in `public/` and are
  // consumed at deploy rather than served, so none of them is a page and a 301
  // pointing at one is a redirect to nothing. Ruled out by shape rather than by
  // name so the next one added is covered before anybody notices it exists.
  if (parts[0].startsWith('_')) return null
  if (parts.length === 1 && REDIRECTED.includes(parts[0])) return null

  // Product lower, state upper, concept lower: the spelling the build writes,
  // and the spelling every canonical tag and sitemap entry names.
  const second = parts[1]?.toLowerCase() === COMPARED_SEGMENT ? COMPARED_SEGMENT : parts[1]?.toUpperCase()
  const canonical = [
    parts[0].toLowerCase(),
    ...(parts.length > 1 ? [second] : []),
    ...(parts.length > 2 ? [parts[2].toLowerCase()] : []),
  ]
  const target = `/${canonical.join('/')}/`
  return target === pathname ? null : target
}
