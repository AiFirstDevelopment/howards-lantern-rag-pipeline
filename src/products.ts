/**
 * Which exams this app teaches, and what each one is called.
 *
 * The app used to be one product that never said so: `resource/laws.json` was
 * keyed by state, and nothing sat above that. A hunting-license exam is not a
 * new screen, it is a dimension the data did not have -- so the corpus gained a
 * level, and this is the registry over it.
 *
 * Deliberately small. It holds a product's id, the name it is called by, the
 * tagline that says what it is, and which states it carries -- and nothing
 * else. Vocabulary is the temptation, because a hunting exam does not test
 * "laws" or "road rules", but a registry that ends up describing every string
 * in the app is a template engine nobody asked for. Only the handful of nouns
 * that actually reach the screen belong here.
 *
 * The states carry their name and exam shape but not a single line of law
 * text. That split is the whole point: the welcome screen needs kilobytes to
 * draw its selector, and a fiftieth state must cost nothing to the forty-nine
 * people who did not choose it.
 */

import { productManifest } from 'virtual:corpus'
import type { ExamShape } from './data/laws'

/** What the manifest says about one of a product's states. */
export interface ProductState {
  code: string
  name: string
  exam: ExamShape
  /**
   * Whether this state is currently offered.
   *
   * A concealed state is still registered, still bundled and still resolvable:
   * `/drivers/PA` opens Pennsylvania for anybody holding the link, and their
   * progress under `teach-and-test/v1/drivers/PA` is untouched. What it loses
   * is discovery -- the picker, the sitemap and the prerendered pages.
   *
   * **It has to stay registered.** Dropping it from the registry would make
   * `parsePath` report `missing: 'state'`, which fires `unknown_state` -- the
   * event that exists to catch an advert naming a state we do not carry. A
   * state concealed on purpose reporting "this link is broken" would cost that
   * number the only meaning it has.
   */
  published: boolean
  /**
   * Whether the build carries a Spanish pack for this state
   * (docs/plans/spanish-app.md). Declared rather than discovered, the way a
   * state is: a pack nobody declares is not bundled, and a declaration with no
   * file fails the build -- so this is true exactly when the pack is loadable.
   */
  spanish: boolean
}

export interface Product {
  id: string
  /** What this exam is called, for anywhere it has to be named. */
  name: string
  /** What this is, in one line, shown above the state selector. */
  tagline: string
  /** Every state, offered or concealed. What a URL is resolved against. */
  states: readonly ProductState[]
  /**
   * The states actually on offer, in manifest order.
   *
   * Everything a visitor can discover is derived from the length of this, not
   * from a state code written into a condition: one published state means no
   * picker and `/` is that state's page; two or more means the picker comes
   * back on its own. Publishing a state again is one word in
   * `resource/manifest.json`, and nothing has to be remembered or undone.
   * docs/plans/maryland-only.md is the argument.
   */
  published: readonly ProductState[]
}

export interface ProductRegistry {
  products: readonly Product[]
  get(id: string): Product | undefined
}

/**
 * What `/` means, and what every key written before products existed belongs
 * to. There is no `selected-product` in storage: the URL carries the product
 * and the absence of one means this.
 */
export const DEFAULT_PRODUCT = 'drivers'

/**
 * The shape of a product id, which is also the shape of the first path segment.
 *
 * Lowercase and bounded, because it is read out of a URL and written into the
 * numbers: `/DRIVERS` and `/drivers` are the same product, and nothing longer
 * than this is a name anybody would put in an advert.
 */
export const PRODUCT_ID = /^[a-z][a-z0-9-]{0,31}$/

/**
 * Path segments a product may not be named.
 *
 * Cloudflare Pages falls back to `index.html` for anything it has no file for,
 * which is why `/drivers/MD` reaches the app with no edge routing at all. What
 * is reserved is whatever it serves *before* that fallback: `/api` is the
 * Functions proxy, `/assets` is the built bundle, `/resource` is the corpus.
 * A product named one of those would be unreachable — every request for it
 * would be answered by the file, and the failure would look like the deep link
 * simply not working.
 *
 * Files in `public/` are reserved too. Most carry extensions and so cannot match
 * PRODUCT_ID in the first place -- but a *directory* there has no extension and
 * matches perfectly, which is how `audio` got onto this list: the recorded voice
 * lives at `public/audio/<STATE>/`, so `/audio` is now a real path and a product
 * called `audio` would be answered by the directory forever.
 * tests/unit/deep-links.test.ts reads `public/` and holds this, which is what
 * caught that addition rather than a learner finding a dead deep link.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  // The operator's own portal, a third bundle emitting a real
  // `dist/admin/index.html` for the same reason `partners` is one. A product
  // named `admin` would be answered by that file for ever, and the symptom
  // would be an admin screen appearing where an exam should -- or, the other
  // way round, `/admin` quietly resolving to a product and showing the welcome
  // screen to somebody who came to approve a partner.
  'admin',
  'api',
  'assets',
  'audio',
  // The method page, `dist/how-it-works/index.html`, written by
  // seo/prerender.ts with no script (docs/plans/trusted-by-date.md, decision
  // 8): a product of this name would be answered by that article for ever.
  'how-it-works',
  // The partner portal, which is its own bundle emitting a real
  // `dist/partners/index.html` -- so Pages serves it before the SPA fallback,
  // exactly as it serves `public/audio`. `PRODUCT_ID` matches `partners`
  // perfectly, so without this reservation a product could be named it and
  // every request for the portal would be answered by the app, which would emit
  // `unknown_product` and show the welcome screen.
  'partners',
  'resource',
  // The sales reps' portal: the partner bundle again, copied to
  // `dist/sales-rep/` by `portal()` in vite.config.ts. Reserved in
  // functions/paths.ts too, where it matters most -- unreserved,
  // `/sales-rep/apply` is a two-segment path `canonicalPath` 301s to
  // `/sales-rep/APPLY/`, and a 301 is cached in every browser that saw it.
  'sales-rep',
]

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function productState(value: unknown, label: string): ProductState {
  const entry = record(value, label)
  const code = text(entry.code, `${label}.code`)
  const exam = record(entry.exam, `${label}.exam`)
  const questions = positiveInteger(exam.questions, `${label}.exam.questions`)
  const passMark = positiveInteger(exam.passMark, `${label}.exam.passMark`)
  if (passMark > questions) {
    throw new Error(`${label} pass mark cannot exceed its question count`)
  }
  // Absent means offered. A manifest where every state has to declare itself
  // published is one where adding a state and forgetting the flag ships a
  // state nobody can reach, and the symptom -- a picker missing an entry -- is
  // one nobody notices. Concealment is the exception and says so.
  const published = entry.published ?? true
  if (typeof published !== 'boolean') {
    throw new Error(`${label}.published must be true or false`)
  }
  // Absent means no pack, the opposite default to `published`: a state is in
  // English until somebody has translated it, and a pack claimed by default
  // would be a Spanish switch that falls back to English on the first card.
  const spanish = entry.spanish ?? false
  if (typeof spanish !== 'boolean') {
    throw new Error(`${label}.spanish must be true or false`)
  }
  return {
    code,
    name: text(entry.name, `${label}.name`),
    exam: { questions, passMark },
    published,
    spanish,
  }
}

/**
 * Convert the external manifest into the only product shape production code
 * can use -- the same boundary `createStateCatalog` draws around a state's
 * laws, and just as strict. Everything downstream of here may assume a product
 * has a name, a tagline and at least one state with a possible exam.
 */
export function createProductRegistry(input: unknown): ProductRegistry {
  const root = record(input, 'product manifest')
  if (!Array.isArray(root.products) || root.products.length === 0) {
    throw new Error('product manifest must list at least one product')
  }
  const products = root.products.map((value: unknown, index: number): Product => {
    const entry = record(value, `product ${index}`)
    const id = text(entry.id, `product ${index}.id`)
    if (!PRODUCT_ID.test(id)) {
      throw new Error(`${id} is not a usable product id: it has to fit ${PRODUCT_ID}`)
    }
    if (RESERVED_SEGMENTS.includes(id)) {
      throw new Error(`${id} is reserved: Cloudflare Pages serves /${id} before the app sees it`)
    }
    if (!Array.isArray(entry.states) || entry.states.length === 0) {
      throw new Error(`${id} must carry at least one state`)
    }
    const states = entry.states.map((state: unknown, at: number) =>
      productState(state, `${id}.states[${at}]`),
    )
    const codes = new Set(states.map((state) => state.code))
    if (codes.size !== states.length) throw new Error(`${id} lists a state twice`)
    const published = states.filter((state) => state.published)
    // A product with every state concealed renders a welcome screen offering
    // nothing, with no indication of why -- the same quiet degradation the
    // missing-default-product check below exists to refuse.
    if (published.length === 0) throw new Error(`${id} conceals every state it carries`)
    return {
      id,
      name: text(entry.name, `${id}.name`),
      tagline: text(entry.tagline, `${id}.tagline`),
      states,
      published,
    }
  })
  const byId = new Map(products.map((product) => [product.id, product]))
  if (byId.size !== products.length) throw new Error('product manifest lists a product twice')
  return { products, get: (id) => byId.get(id) }
}

export const productRegistry = createProductRegistry(productManifest)

/**
 * There is no fallback if the default product is missing from the manifest.
 * `/` would otherwise render a state selector with nothing in it and no
 * indication of why, which is the failure this app has been bitten by before:
 * a misconfiguration that degrades quietly instead of stopping.
 */
if (productRegistry.get(DEFAULT_PRODUCT) === undefined) {
  throw new Error(`product manifest does not carry the default product ${DEFAULT_PRODUCT}`)
}

/**
 * Whether this state can be studied in Spanish, which is whether the build
 * carries its pack. False for a state the product does not carry.
 */
export function hasSpanish(productId: string, stateCode: string): boolean {
  return (
    productRegistry.get(productId)?.states.some((state) => state.code === stateCode && state.spanish) ??
    false
  )
}

/**
 * Whether any state of this product has a Spanish pack -- the one condition
 * every Spanish affordance is drawn on. While it is false, which is production
 * until Maryland's pack lands, the switch, `?lang=es` and the portal's Spanish
 * link do not exist: an affordance with nothing behind it is the thing the plan
 * refuses to ship.
 */
export function anySpanish(productId: string): boolean {
  return productRegistry.get(productId)?.states.some((state) => state.spanish) ?? false
}
