/**
 * What a citation is allowed to say, and what it may point at.
 *
 * Its own module, with no dependency on the model client, for one reason: the
 * Playwright fixture has to serve exactly what the worker serves, and the way
 * it did that was by retyping these two regexes. That copy agreed with itself
 * forever -- it reproduced the single-section truncation below rather than
 * exposing it, so the bug shipped past a test written to catch precisely this.
 * A test importing the real function cannot make that mistake, and importing
 * ask.ts would drag the Anthropic SDK into a browser test.
 */

/**
 * A repository path or a source symbol -- what a citation must never be when
 * somebody outside reads it.
 *
 * Nine of the fifty-six public entries prove themselves by naming a file in a
 * private repository, and `account-signin` goes further and publishes an
 * internal note that one of our own documents is out of date. That text was
 * written for a code reviewer and it was being rendered under the answer on a
 * public page.
 */
const INTERNAL =
  /(?:\b(?:worker|scripts|src|docs|tests)\/[\w./-]+)|(?:[\w-]+\.(?:ts|tsx|sql|md)\b)|(?:`[A-Za-z_][A-Za-z0-9_]*`)/

/**
 * `Agreement §4`, however the entry capitalised it -- and **every section
 * joined to it**, which is the part that was wrong.
 *
 * Twelve entries cite two sections (`Agreement §13 and §14.`), and a
 * single-capture match served the first and silently dropped the rest: a
 * partner asking why they were suspended was shown §13 alone, over an answer
 * that section 14 is half the authority for.
 *
 * The run has to stop where the agreement's own sections stop, which is why
 * this is not simply every `§` in the string. `Agreement §4, and
 * ``docs/plans/partners-v2.md`` §2 for the removal.` carries a second section
 * belonging to a different document, and gathering both would render
 * "Agreement §4 and §2" -- a citation that is not merely incomplete but false.
 * So the pattern walks section references joined by `and` or a comma and stops
 * at the first thing that is neither, which is the backtick in that example.
 */
const AGREEMENT_SECTIONS = /agreement\s+(§\s*\d+(?:\s*(?:and|,)\s*§\s*\d+)*)/i

/**
 * `Sales rep agreement §4`, which is a different document with its own §4.
 *
 * Tried before the partner pattern, because that pattern would also match the
 * tail of this one and send a rep to `/partners/agreement` -- whose §4 is a
 * partner's commission, not theirs.
 */
const REP_AGREEMENT_SECTIONS =
  /sales\s+rep(?:resentative)?\s+agreement\s+(§\s*\d+(?:\s*(?:and|,)\s*§\s*\d+)*)/i

/** `§13 and §14`, or `§2, §4 and §15` -- read aloud the way the entries write it. */
function joinSections(numbers: string[]): string {
  const tags = numbers.map((n) => `§${n}`)
  if (tags.length === 1) return tags[0]
  return `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`
}

/**
 * The citation as it is served, and the published document it points at.
 *
 * One rule, and it is the rule rather than a filter: **what is shown names a
 * document the reader can open, or nothing at all.** A citation that names an
 * agreement section is served as that section -- which is the form most of them
 * already take, and which is a link; one that names nothing internal is served
 * as written; anything else is not served, because a file path inside a private
 * repository proves nothing to the person reading it and discloses something to
 * everybody else.
 *
 * It runs for both audiences on purpose. A signed-in partner is no more staff
 * than a stranger is, and the proof stays where maintainers actually read it,
 * in knowledge-base.md beside the answer it belongs to.
 */
export function citeFor(cite: string | null): { cite: string | null; url: string | null } {
  if (cite === null) return { cite: null, url: null }
  const rep = REP_AGREEMENT_SECTIONS.exec(cite)
  if (rep !== null) {
    const numbers = rep[1].match(/\d+/g) ?? []
    return { cite: `Sales rep agreement ${joinSections(numbers)}.`, url: '/sales-rep/agreement' }
  }
  const run = AGREEMENT_SECTIONS.exec(cite)
  if (run !== null) {
    const numbers = run[1].match(/\d+/g) ?? []
    return { cite: `Agreement ${joinSections(numbers)}.`, url: '/partners/agreement' }
  }
  if (INTERNAL.test(cite)) return { cite: null, url: null }
  return { cite, url: null }
}
