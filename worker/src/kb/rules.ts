/**
 * One definition of what a valid knowledge base is, in a module every place
 * that needs it can import.
 *
 * Until the mesh, "valid" lived in `tests/unit/knowledge-base.test.ts` and was
 * enforced by `npm test`. That worked because the answers were a file in this
 * repository and could not change without a deploy. **Move them to R2 and every
 * one of those guarantees is gone**: an operator edits a live object, the fine
 * server serves it on the next request, and nothing ran. So the checks are here
 * instead, and three callers run them --
 *
 * - the suite, over `worker/src/knowledge-base.md`, exactly as before;
 * - `worker/src/admin-kb.ts`, before an edited object is written, so a bad edit
 *   is refused rather than published;
 * - `worker/src/kb-cron.ts` and every fine server's read-time validation, so an
 *   object that was correct when written and stopped being true when the *code*
 *   moved underneath it is caught with no edit involved.
 *
 * Two definitions of "valid" would drift, and the one that drifted would be the
 * one guarding production.
 *
 * **This module imports nothing that is not available in a Worker.** No
 * `node:*`, no `scripts/`, no `src/`, and nothing that reaches the network or a
 * database -- the numbers it checks against arrive as `DeployedFacts` from
 * whichever caller has them. `worker/src/cite.ts` is the one import, and it is
 * already a leaf for the same reason.
 */

import { citeFor } from '../cite'

/**
 * Who may be told this.
 *
 * `anyone` is a stranger on the partner page who has signed nothing; everything
 * else needs a partner session, because it is either about their own row or
 * only makes sense in front of a screen they are looking at.
 *
 * `rep` is an *asker*, never something an entry is marked with: the parser
 * writes only `anyone` or `partner`. It names the sales-rep box, which answers
 * from `rep-knowledge-base.md` and nothing else, so that a rep asking what they
 * earn is never quoted a partner's rate.
 */
export type Audience = 'anyone' | 'partner' | 'rep'

export interface Entry {
  id: string
  /** The questions the entry answers, as written, for the router prompt. */
  asks: string[]
  audience: Audience
  /** Verbatim. The worker renders this and never anything derived from it. */
  answer: string
  /** What proves it -- an agreement section or a worker symbol. */
  cite: string | null
}

/**
 * Not an entry id. Nothing may ever be named this, and `parseKnowledgeBase`
 * refuses a section that is -- an entry called `no-match` would be offered to
 * the router and then resolved to null by `entryFor`, answering with the
 * contact address for ever with nothing saying so.
 */
export const NO_MATCH = 'no-match'

/**
 * Where everything this cannot answer goes, and a person reads it.
 *
 * One copy: the `contact` entry promises this address and the fallback serves
 * it, and `sendsEverybodyToTheAddress` below holds the two together.
 */
export const PARTNER_CONTACT_EMAIL = 'partners@howardslantern.com'

/** The facts a partner's own row can supply. Nothing else may appear in braces. */
export const PLACEHOLDERS = [
  'terms',
  'code',
  'code_expires',
  'sales',
  'pending',
  'payable',
  'paid',
  'payout_detail',
] as const

export type Placeholder = (typeof PLACEHOLDERS)[number]

/** An entry id: kebab-case, because it is also an enum value in a schema. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Every `## ` section of the file, in order.
 *
 * The document's own prose sections -- the rules, the audience note, the
 * placeholder table, the closing "what this must not answer" -- are headings
 * too. They are told apart from entries by having no `**Asks:**` line rather
 * than by their position, so moving one does not silently turn it into an entry
 * that answers questions.
 */
function sectionsOf(source: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string[] }[] = []
  for (const line of source.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading !== null) {
      sections.push({ heading: heading[1].trim(), body: [] })
    } else if (sections.length > 0) {
      sections[sections.length - 1].body.push(line)
    }
  }
  return sections.map((section) => ({
    heading: section.heading,
    body: section.body.join('\n'),
  }))
}

/**
 * The same sections, kept as the bytes they were written in.
 *
 * `scripts/kb-push.ts` splits one document into six R2 objects by moving whole
 * sections, and the only way the answers can be byte-identical afterwards is if
 * nothing re-renders them. So the split copies these slices and the parse
 * happens again on the other side, which is what `tests/unit/kb-partition.test.ts`
 * checks: parse, split, re-parse, compare.
 */
export interface SourceSection {
  heading: string
  /** From the `## ` line to the line before the next one, trailing blanks trimmed. */
  text: string
}

export function sourceSections(source: string): SourceSection[] {
  const sections: { heading: string; lines: string[] }[] = []
  for (const line of source.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading !== null) {
      sections.push({ heading: heading[1].trim(), lines: [line] })
    } else if (sections.length > 0) {
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections.map((section) => ({
    heading: section.heading,
    text: section.lines.join('\n').replace(/\s+$/, ''),
  }))
}

function blocksOf(body: string): string[] {
  return body
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

/** A trailing `*...*` paragraph, which is how every citation in the file is written. */
function isCitation(block: string): boolean {
  return block.startsWith('*') && !block.startsWith('**') && block.endsWith('*')
}

export function parseKnowledgeBase(source: string): Entry[] {
  const entries: Entry[] = []
  const seen = new Set<string>()

  for (const section of sectionsOf(source)) {
    const id = section.heading
    const blocks = blocksOf(section.body)

    /**
     * The header: every leading `**Asks:**` and `**Audience:**` block, in
     * whichever order they were written and however many times.
     *
     * Order-insensitive and repetition-tolerant on purpose. A duplicated
     * audience line is a typo, and an audience line written above the asks is
     * somebody being tidy -- neither should change what an entry means, and
     * neither should make it vanish. What must never happen is an entry
     * quietly *not being one*: a section with a kebab id that this loop
     * skipped would be an answer nobody could ever be given, with nothing
     * anywhere saying so.
     */
    let rest = blocks
    const asks: string[] = []
    const declared = new Set<string>()
    while (rest.length > 0) {
      if (rest[0].startsWith('**Asks:**')) {
        asks.push(
          ...rest[0]
            .slice('**Asks:**'.length)
            .split('·')
            .map((ask) => ask.replace(/\s+/g, ' ').trim())
            .filter((ask) => ask.length > 0),
        )
      } else if (rest[0].startsWith('**Audience:**')) {
        declared.add(rest[0].slice('**Audience:**'.length).trim())
      } else break
      rest = rest.slice(1)
    }

    if (asks.length === 0) {
      // The document's own prose sections -- the rules, the audience note, the
      // placeholder table, the closing table of what this must not answer --
      // are headings too, and are told apart by having no questions rather
      // than by their position.
      if (ID.test(id)) throw new Error(`${id}: looks like an entry but names no question`)
      continue
    }
    if (!ID.test(id)) throw new Error(`${id}: an entry id must be kebab-case`)
    if (seen.has(id)) throw new Error(`${id}: two entries share an id`)
    // `no-match` is what the worker answers with when nothing matched; it is
    // not an id. An entry named that would parse, build, be offered to the
    // router in its enum, and then be resolved to null by `entryFor` before the
    // lookup -- so it would be answered with the contact address every time,
    // for ever, with nothing anywhere saying so. Same silent-drop species as
    // the "looks like an entry but names no question" guard above, and this is
    // the assertion the comment on NO_MATCH claims exists.
    if (id === NO_MATCH) throw new Error(`${id}: is what the worker says when nothing matched`)
    seen.add(id)

    if (declared.size > 1) {
      throw new Error(`${id}: declares two different audiences`)
    }
    const [audience] = [...declared]
    if (audience !== undefined && audience !== 'anyone') {
      throw new Error(`${id}: "${audience}" is not an audience; write "anyone" or nothing`)
    }

    const cite = rest.length > 0 && isCitation(rest[rest.length - 1]) ? rest[rest.length - 1] : null
    const answer = (cite === null ? rest : rest.slice(0, -1)).join('\n\n')
    if (answer.length === 0) throw new Error(`${id}: has no answer`)

    entries.push({
      id,
      asks,
      audience: audience === 'anyone' ? 'anyone' : 'partner',
      answer,
      cite: cite === null ? null : cite.slice(1, -1).trim(),
    })
  }

  if (entries.length === 0) throw new Error('this knowledge base holds no entries')
  return entries
}

/**
 * The deployed numbers an entry is held to.
 *
 * Passed in rather than imported, because the point of every rule that uses one
 * is that the *code* is the authority and the entry is the copy. A module that
 * held its own 5000 would agree with itself for ever, which is the failure
 * `tests/unit/knowledge-base.test.ts` was written against in the first place.
 */
export interface DeployedFacts {
  linkTtlSeconds: number
  sessionTtlSeconds: number
  payoutMinimumCents: number
  taxFormThresholdCents: number
  payoutHoldSeconds: number
  codeTermSeconds: number
  refundWindowDays: number
  /** From the seeded `programs` row: there is no constant, the window is per-program. */
  clearingDays: number
  /** Which `§N` an entry may cite. See `AGREEMENT_SECTIONS` in worker/src/agreement.ts. */
  agreementSections: readonly number[]
  /** What the source is called, so a failure names the object an operator would open. */
  sourceName: string
}

/** One broken rule, named the way the test that used to hold it named it. */
export interface Violation {
  /** The rule's own name -- a sentence about behaviour, not a code. */
  rule: string
  /** The entry at fault, or null for a rule about the corpus as a whole. */
  entry: string | null
  /** What the assertion used to print. This is what an operator reads. */
  detail: string
}

export interface Corpus {
  entries: Entry[]
  /** The markdown the entries were parsed from. Rule 4 compares against it. */
  source: string
  facts: DeployedFacts
  /**
   * Whether `entries` is the entire knowledge base or one domain's object.
   *
   * A fine server holds a sixth of the corpus, so "no phrasing is claimed
   * twice" and "the public half is still worth having" cannot be decided there
   * and must not be *pretended* to be decided there. The write gate and the
   * cron read all six objects and pass `whole: true`, which is where those
   * rules actually run.
   */
  whole: boolean
}

export interface Rule {
  /** The sentence the suite states it as, kept word for word from the test it came from. */
  name: string
  check: (corpus: Corpus) => Violation[]
}

/**
 * Small numbers as the entries write them.
 *
 * The answers are prose -- "four hours", "seven-day hold" -- and a guard that
 * only compared digits would pass while the sentence a partner reads said
 * something else.
 */
export const SPELLED = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

/** The floor under how much of the corpus a prospect may read. See the rule below. */
export const PUBLIC_ENTRY_FLOOR = 50

function rule(name: string, check: (corpus: Corpus) => Violation[]): Rule {
  return { name, check }
}

/** An entry by id, or undefined -- which at object scope means "not in this domain". */
function find(corpus: Corpus, id: string): Entry | undefined {
  return corpus.entries.find((entry) => entry.id === id)
}

/**
 * Hold every named entry to a sentence, and -- when this is the whole corpus --
 * hold the corpus to still having them.
 *
 * The second half is what stops a rule from passing by deletion. At object
 * scope it cannot run, because `kb-refunds` legitimately has no `paid-when`.
 */
function eachNamed(
  corpus: Corpus,
  name: string,
  ids: string[],
  says: (entry: Entry, facts: DeployedFacts) => string | null,
): Violation[] {
  const violations: Violation[] = []
  for (const id of ids) {
    const entry = find(corpus, id)
    if (entry === undefined) {
      if (corpus.whole) {
        violations.push({ rule: name, entry: id, detail: `no such entry: ${id}` })
      }
      continue
    }
    const complaint = says(entry, corpus.facts)
    if (complaint !== null) violations.push({ rule: name, entry: id, detail: complaint })
  }
  return violations
}

const CARRIES_EVERY_ENTRY_ONCE = 'carries every entry once, under a kebab-case id'
const NEVER_NAMES_NO_MATCH = 'never names an entry what the worker says when nothing matched'
const ONE_ENTRY_PER_PHRASING = 'advertises each phrasing to the router under one entry only'
const ANSWERS_ARE_VERBATIM = 'holds every answer verbatim, as it appears in the document'
const NO_PUBLIC_PLACEHOLDER = 'never marks an entry with a placeholder as answerable to anyone'
const ONLY_FILLABLE_FACTS = 'asks only for facts the worker can fill'
const PUBLIC_HALF_WORTH_HAVING = 'keeps a public half worth having'
const SIGNIN_LINK_LASTS = 'says how long a sign-in link lasts'
const SESSION_LASTS = 'says how long a session lasts'
const PAYOUT_FLOOR = 'says the payout floor everywhere it promises one'
const W9_THRESHOLD = 'says the figure that makes a W-9 necessary'
const PAYOUT_HOLD = 'says how long changing payout details holds a payment'
const CODE_LASTS = 'says how long a code lasts'
const CODE_RENEWS = 'says a code renews itself, as agreement §3 does'
const REFUND_DEADLINE = 'says the refund deadline, measured from payment'
const REFUND_INSIDE_CLEARING =
  'keeps the refund window inside the clearing window, with the margin it claims'
const CONTACT_ADDRESS = 'sends everybody it cannot answer to the address the worker uses'
const SECTIONS_EXIST = 'names only sections the agreement actually has'
const NO_INTERNAL_PATHS = 'never shows a reader a file inside this repository'
const EVERY_SECTION_SERVED =
  'shows every agreement section an entry cites, and no section belonging to another document'

/**
 * Every rule, in the order the suite states them.
 *
 * Each is a *rot* guard rather than a behaviour test. The answers these hold
 * are read by somebody deciding whether to sign a contract, and the way they go
 * wrong is not that somebody edits them badly -- it is that nobody edits them
 * at all while the worker moves underneath. `LINK_TTL_SECONDS` has already done
 * exactly that once: docs/work/partners/emails.md still says fifteen minutes,
 * four hours after `9db148c` said otherwise, and nothing running ever noticed.
 */
export const RULES: readonly Rule[] = [
  rule(CARRIES_EVERY_ENTRY_ONCE, (corpus) => {
    const violations: Violation[] = []
    const seen = new Set<string>()
    for (const entry of corpus.entries) {
      if (seen.has(entry.id)) {
        violations.push({
          rule: CARRIES_EVERY_ENTRY_ONCE,
          entry: entry.id,
          detail: `${entry.id}: two entries share an id`,
        })
      }
      seen.add(entry.id)
      if (!ID.test(entry.id)) {
        violations.push({
          rule: CARRIES_EVERY_ENTRY_ONCE,
          entry: entry.id,
          detail: `${entry.id}: an entry id must be kebab-case`,
        })
      }
    }
    return violations
  }),

  /**
   * The assertion `NO_MATCH`'s own comment used to claim and nobody had
   * written. An entry called `no-match` parses, builds, and is offered to the
   * router in its enum -- and `entryFor` then resolves it to null before the
   * lookup, so it answers with the contact address every time, for ever, with
   * nothing anywhere saying so.
   */
  rule(NEVER_NAMES_NO_MATCH, (corpus) =>
    corpus.entries
      .filter((entry) => entry.id === NO_MATCH)
      .map((entry) => ({
        rule: NEVER_NAMES_NO_MATCH,
        entry: entry.id,
        detail: `${entry.id}: is what the worker says when nothing matched`,
      })),
  ),

  /**
   * Two entries advertising the same question to the router is a coin toss
   * between them, and it is invisible: both ids are real, both answers are
   * written, and whichever comes back reads like an answer. Four phrasings were
   * duplicated when this shipped -- "is this a pyramid scheme" was claimed by
   * `join-cost`, which is about the joining fee, as well as by the entry
   * written for it -- and `npm run ask:eval` scores the loser as a routing
   * failure the model did not commit.
   *
   * Whole-corpus only, and that is the point rather than a limitation: two
   * domains claiming one phrasing is exactly the collision the split makes
   * possible, and a fine server holding a sixth of the entries cannot see it.
   */
  rule(ONE_ENTRY_PER_PHRASING, (corpus) => {
    if (!corpus.whole) return []
    const violations: Violation[] = []
    const claimed = new Map<string, string>()
    for (const entry of corpus.entries) {
      for (const ask of entry.asks) {
        const phrasing = ask.toLowerCase().trim()
        const already = claimed.get(phrasing)
        if (already !== undefined) {
          violations.push({
            rule: ONE_ENTRY_PER_PHRASING,
            entry: entry.id,
            detail: `"${ask}" is claimed by both ${already} and ${entry.id}`,
          })
        }
        claimed.set(phrasing, entry.id)
      }
    }
    return violations
  }),

  /**
   * The worker renders `answer` and nothing derived from it, so an answer that
   * is not a verbatim slice of the document would be a sentence nobody wrote
   * being shown as though somebody had.
   */
  rule(ANSWERS_ARE_VERBATIM, (corpus) => {
    const violations: Violation[] = []
    for (const entry of corpus.entries) {
      if (!corpus.source.includes(entry.answer)) {
        violations.push({
          rule: ANSWERS_ARE_VERBATIM,
          entry: entry.id,
          detail: `${entry.id}: the built answer is not in ${corpus.facts.sourceName}`,
        })
      }
      if (entry.cite !== null && !corpus.source.includes(entry.cite)) {
        violations.push({
          rule: ANSWERS_ARE_VERBATIM,
          entry: entry.id,
          detail: `${entry.id}: the built citation is not`,
        })
      }
    }
    return violations
  }),

  /**
   * The whole of what keeps the public route safe from a *content* mistake
   * rather than a code one.
   *
   * A placeholder can only be filled from a partner's own row, and the public
   * route has none -- so an entry that acquires one while still marked `anyone`
   * would either show a stranger `{payable}` or show them somebody's figures.
   * Neither is recoverable once it has happened.
   */
  rule(NO_PUBLIC_PLACEHOLDER, (corpus) =>
    corpus.entries
      .filter((entry) => entry.audience === 'anyone' && /\{[a-z_]+\}/.test(entry.answer))
      .map((entry) => ({
        rule: NO_PUBLIC_PLACEHOLDER,
        entry: entry.id,
        detail: `${entry.id}: public and carries a placeholder`,
      })),
  ),

  /**
   * The other half of the placeholder rule. An entry may only ask for a fact
   * the worker knows how to fill: a `{turnover}` nobody computes renders as a
   * gap in the middle of a sentence about money, and `fill` would replace it
   * with nothing rather than refuse.
   */
  rule(ONLY_FILLABLE_FACTS, (corpus) => {
    const violations: Violation[] = []
    for (const entry of corpus.entries) {
      for (const match of entry.answer.matchAll(/\{([a-z_]+)\}/g)) {
        if (!(PLACEHOLDERS as readonly string[]).includes(match[1])) {
          violations.push({
            rule: ONLY_FILLABLE_FACTS,
            entry: entry.id,
            detail: `${entry.id} asks for {${match[1]}}, which nothing fills`,
          })
        }
      }
    }
    return violations
  }),

  /**
   * Not an arbitrary floor: the recruitment case for this whole feature is that
   * a prospect can get answers before signing anything. A change that quietly
   * made most entries portal-only would defeat it silently.
   */
  rule(PUBLIC_HALF_WORTH_HAVING, (corpus) => {
    if (!corpus.whole) return []
    const shared = corpus.entries.filter((entry) => entry.audience === 'anyone').length
    return shared >= PUBLIC_ENTRY_FLOOR
      ? []
      : [
          {
            rule: PUBLIC_HALF_WORTH_HAVING,
            entry: null,
            detail: `only ${shared} entries are answerable to anyone, and ${PUBLIC_ENTRY_FLOOR} is the floor`,
          },
        ]
  }),

  rule(SIGNIN_LINK_LASTS, (corpus) =>
    eachNamed(corpus, SIGNIN_LINK_LASTS, ['account-signin'], (entry, facts) => {
      const said = `expires ${SPELLED[facts.linkTtlSeconds / 3600]} hours later`
      return entry.answer.includes(said) ? null : `account-signin no longer says "${said}"`
    }),
  ),

  rule(SESSION_LASTS, (corpus) =>
    eachNamed(corpus, SESSION_LASTS, ['account-session'], (entry, facts) => {
      const said = `lasts ${facts.sessionTtlSeconds / 86_400} days on that device`
      return entry.answer.includes(said) ? null : `account-session no longer says "${said}"`
    }),
  ),

  rule(PAYOUT_FLOOR, (corpus) =>
    eachNamed(
      corpus,
      PAYOUT_FLOOR,
      [
        'paid-when',
        'paid-threshold',
        'join-paid',
        'paid-triggers',
        'paid-first-payment',
        'paid-blocked-reasons',
      ],
      (entry, facts) => {
        const floor = `$${facts.payoutMinimumCents / 100}`
        return entry.answer.includes(floor) ? null : `${entry.id} no longer says ${floor}`
      },
    ),
  ),

  rule(W9_THRESHOLD, (corpus) =>
    eachNamed(
      corpus,
      W9_THRESHOLD,
      ['paid-w9', 'paid-triggers', 'paid-blocked-reasons'],
      (entry, facts) => {
        const threshold = `$${facts.taxFormThresholdCents / 100}`
        return entry.answer.includes(threshold) ? null : `${entry.id} no longer says ${threshold}`
      },
    ),
  ),

  rule(PAYOUT_HOLD, (corpus) => {
    const days = corpus.facts.payoutHoldSeconds / 86_400
    return [
      ...eachNamed(corpus, PAYOUT_HOLD, ['paid-changed-details'], (entry) =>
        entry.answer.includes(`${SPELLED[days]}-day hold`)
          ? null
          : `paid-changed-details no longer says a ${SPELLED[days]}-day hold`,
      ),
      ...eachNamed(corpus, PAYOUT_HOLD, ['paid-triggers', 'paid-blocked-reasons'], (entry) =>
        entry.answer.includes(`last ${SPELLED[days]} days`)
          ? null
          : `${entry.id} no longer says "last ${SPELLED[days]} days"`,
      ),
    ]
  }),

  rule(CODE_LASTS, (corpus) =>
    eachNamed(corpus, CODE_LASTS, ['code-expiry', 'join-code-term'], (entry, facts) => {
      const months = Math.round(facts.codeTermSeconds / 86_400 / 30.4375)
      return entry.answer.toLowerCase().includes(`${SPELLED[months]} months`)
        ? null
        : `${entry.id} no longer says ${SPELLED[months]} months`
    }),
  ),

  /**
   * Agreement §3 has said a code renews itself since version 4, and
   * `resolveReferral` has done it since the same day -- while these three
   * answers went on telling partners it expires, sells at list price once it
   * does, and has to be renewed by asking. Nothing noticed for three versions of
   * the contract, because every other rule here checks a number and this was a
   * sentence.
   */
  rule(CODE_RENEWS, (corpus) =>
    eachNamed(corpus, CODE_RENEWS, ['code-expiry', 'code-expired', 'join-code-term'], (entry) => {
      if (/does not renew|list price|ask us to renew/i.test(entry.answer)) {
        return `${entry.id} still says a code dies on its date`
      }
      return /renews (itself|it)/i.test(entry.answer)
        ? null
        : `${entry.id} no longer says the code renews`
    }),
  ),

  rule(REFUND_DEADLINE, (corpus) => [
    ...eachNamed(corpus, REFUND_DEADLINE, ['refund-window'], (entry, facts) => {
      const said = `${facts.refundWindowDays} days from the date they paid`
      return entry.answer.includes(said) ? null : `refund-window no longer says "${said}"`
    }),
    ...eachNamed(corpus, REFUND_DEADLINE, ['refund-buyer-process'], (entry, facts) => {
      const said = `within ${facts.refundWindowDays} days of paying`
      return entry.answer.includes(said) ? null : `refund-buyer-process no longer says "${said}"`
    }),
  ]),

  /**
   * The reason `refund-after-payment` can say "it cannot happen by
   * construction" rather than "it is unlikely".
   *
   * A buyer has 21 days to ask; a commission is pending for 30. If anybody ever
   * lengthens the refund policy without moving the program with it, a partner
   * is paid on a sale that can still be undone -- and the entry promising that
   * cannot happen would still be sitting there saying so. `setProgram` refuses
   * the same relationship from the other side; this refuses the source of it.
   */
  rule(REFUND_INSIDE_CLEARING, (corpus) => {
    const { refundWindowDays, clearingDays } = corpus.facts
    const violations: Violation[] = []
    if (refundWindowDays >= clearingDays) {
      violations.push({
        rule: REFUND_INSIDE_CLEARING,
        entry: null,
        detail: 'a refund can now be asked for after a commission has cleared and been paid',
      })
    }
    return [
      ...violations,
      ...eachNamed(corpus, REFUND_INSIDE_CLEARING, ['refund-after-payment'], (entry) => {
        const missing = [
          `${refundWindowDays} days to ask`,
          `pending for ${clearingDays} days`,
          `${SPELLED[clearingDays - refundWindowDays]} days of margin`,
        ].filter((said) => !entry.answer.includes(said))
        return missing.length === 0
          ? null
          : `refund-after-payment no longer says ${missing.map((said) => `"${said}"`).join(', ')}`
      }),
    ]
  }),

  /**
   * One address, in one place. The fallback the route serves when nothing
   * matches is the same string this entry promises a person reads.
   */
  rule(CONTACT_ADDRESS, (corpus) =>
    eachNamed(corpus, CONTACT_ADDRESS, ['contact'], (entry) =>
      entry.answer.includes(PARTNER_CONTACT_EMAIL)
        ? null
        : `contact no longer names ${PARTNER_CONTACT_EMAIL}`,
    ),
  ),

  rule(SECTIONS_EXIST, (corpus) => {
    const violations: Violation[] = []
    for (const entry of corpus.entries) {
      for (const match of (entry.cite ?? '').matchAll(/§(\d+)/g)) {
        if (!corpus.facts.agreementSections.includes(Number(match[1]))) {
          violations.push({
            rule: SECTIONS_EXIST,
            entry: entry.id,
            detail: `${entry.id} cites §${match[1]}, which does not exist`,
          })
        }
      }
    }
    return violations
  }),

  /**
   * A citation is shown under the answer, to somebody outside this repository.
   *
   * Nine of the fifty-six public entries proved themselves by naming a file in
   * a private repository, and `account-signin` published an internal note that
   * one of our own documents was out of date -- rendered verbatim under the
   * answer on a page whose whole job is recruitment. The proof stays in the
   * document, where a maintainer reads it; `citeFor` is what decides what a
   * reader is shown, and this is the guard that it still refuses to show a path.
   */
  rule(NO_INTERNAL_PATHS, (corpus) => {
    const violations: Violation[] = []
    for (const entry of corpus.entries) {
      const shown = citeFor(entry.cite).cite
      if (shown === null) continue
      if (/\b(?:worker|scripts|src|docs|tests)\//.test(shown)) {
        violations.push({
          rule: NO_INTERNAL_PATHS,
          entry: entry.id,
          detail: `${entry.id} would show ${shown}`,
        })
      }
      if (/\.(?:ts|tsx|sql|md)\b/.test(shown)) {
        violations.push({
          rule: NO_INTERNAL_PATHS,
          entry: entry.id,
          detail: `${entry.id} would show a source file`,
        })
      }
    }
    return violations
  }),

  /**
   * Every section an entry cites reaches the reader, not just the first.
   *
   * Twelve entries name two sections, and a single-capture match served the
   * first and dropped the rest silently: somebody asking why they were
   * suspended was shown `Agreement §13.` over an answer that §14 is half the
   * authority for.
   *
   * **Counted against the agreement's own run, not against every `§` in the
   * string.** `compare-not-mlm` cites "Agreement §4, and `docs/plans/…` §2 for
   * the removal", where the second section belongs to a different document and
   * gathering it would render "Agreement §4 and §2" -- a citation that is not
   * incomplete but false. So `INTENDED` walks the same chain `citeFor` does and
   * additionally accepts a repeated "Agreement" between the links, which is the
   * shape an operator's edit most easily produces:
   * `Agreement §13 and Agreement §14` stops `citeFor` dead at §13 while looking
   * completely correct in the document.
   *
   * This used to compare the counts the other way round -- it fired only when
   * `citeFor` served *more* sections than were written, which cannot happen
   * from an edit and never fired at all. Now it gates writes through /admin,
   * so a rule that names a defect it does not catch is a gate that waves the
   * defect through.
   */
  rule(EVERY_SECTION_SERVED, (corpus) => {
    const INTENDED = /agreement\s+(§\s*\d+(?:\s*(?:and|,)\s*(?:agreement\s+)?§\s*\d+)*)/i
    const violations: Violation[] = []
    for (const entry of corpus.entries) {
      const shown = citeFor(entry.cite).cite
      if (shown === null) continue
      const served = (shown.match(/§\d+/g) ?? []).length
      const run = INTENDED.exec(entry.cite ?? '')
      const written = run === null ? 0 : (run[1].match(/\d+/g) ?? []).length
      if (served !== written) {
        violations.push({
          rule: EVERY_SECTION_SERVED,
          entry: entry.id,
          detail: `${entry.id} serves ${served} of ${written} sections`,
        })
      }
    }
    return violations
  }),
]

/**
 * Every rule, over one corpus. An empty list is the only passing answer.
 *
 * A list rather than a throw, because every caller wants all of them: the
 * editor names each broken rule in one refusal, the cron names each in one
 * alert, and the suite prints them all rather than the first.
 */
export function validateKnowledgeBase(
  entries: Entry[],
  source: string,
  facts: DeployedFacts,
  whole = true,
): Violation[] {
  const corpus: Corpus = { entries, source, facts, whole }
  return RULES.flatMap((each) => each.check(corpus))
}

/** A refusal an operator reads, one line per broken rule. */
export function describeViolations(violations: readonly Violation[]): string {
  return violations.map((each) => `${each.rule}: ${each.detail}`).join('\n')
}
