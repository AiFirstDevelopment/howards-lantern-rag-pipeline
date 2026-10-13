/**
 * The page saying how an answer is made and checked (docs/plans/trusted-by-date.md,
 * decision 8): linked from the ask page's notice, the comparison pages and the
 * footer. A real file Pages serves, not an app route: the app never mounts
 * there, so a reader is shown the article rather than the welcome screen.
 *
 * A module of its own, importing nothing, beside COMPARED_PAGE's home in
 * src/topics.ts rather than in it: the Playwright specs read this, and
 * topics.ts imports a JSON file Node's loader refuses there without an import
 * attribute -- which failed every spec at load, not one test.
 */
export const METHOD_PAGE = '/how-it-works/'

/**
 * What changed in state driving law (docs/plans/trusted-by-date.md, decision
 * 12): the monthly refresh's reports, newest first, and the list's form.
 * Written with no script, as the method page is, so the app never reads the
 * address as a comparison topic called `changes` and opens the ask box over
 * it. worker/src/subscribe.ts repeats it for the links back from its pages;
 * tests/unit/changes-page.test.ts holds the two equal.
 */
export const CHANGES_PAGE = '/drivers/laws/changes/'

/** The third segment of that address: no comparison topic may take it, or its page and this one are one file. */
export const CHANGES_SEGMENT = 'changes'

/**
 * The chips' stored answers as a page (docs/plans/trusted-by-date.md,
 * decision 19). Standalone like the changes page, and for the same reason: the
 * app would read `facts` as a comparison topic and open the ask box over it.
 */
export const FACTS_PAGE = '/drivers/laws/facts/'

/** The third segment of that address, which no comparison topic may take. */
export const FACTS_SEGMENT = 'facts'
