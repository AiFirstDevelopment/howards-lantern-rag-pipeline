# Statute corpus: road law the manual does not state, from the state's own code

branch: statute-corpus
slug: statute-corpus

Written 2026-10-05, after [learner-ask-law](learner-ask-law.md) went live
(#643, #644). The ask box answers road law only from the chosen state's
manual, and the first live misses were laws the manual simply does not state:
Maryland's manual never mentions a fire hydrant, though Maryland law sets the
distance at 15 feet (Md. Code, Transp. § 21-1003(m)). Joel's brief: the
knowledge base should answer questions about laws, **built statically** —
laws rarely change, and a lookup per question costs money on every miss for
ever.

## Intent

A Maryland learner asks *how far from a hydrant must I park?* and reads:

> **At least 15 feet.** — Not in your manual. Maryland law, Transp.
> § 21-1003(m): "A person may not stand or park a vehicle within 15 feet of a
> fire hydrant."

The statute is a second committed source beside the manual corpus, verified
the way the corpus is (every quote found verbatim in a committed copy of the
official page, pinned by URL, date and hash), served in the same
`/ask-laws/<CODE>.json` file, retrieved by the same code and refused by the
same checks. Nothing about the box's honesty changes: it still answers only
from text this repo committed and checked. The manual stays first — a statute
law is offered to the model only for what the manual does not say, and is
labelled as the law, not the manual, wherever it is shown.

## What is already true

- `worker/src/law-retrieval.ts`: `askLaws` compacts a corpus to `{ id, law,
  question, concept, citation }`; `retrieve` is BM25 with typo and compound
  tolerance; `citedPages` reads `p.N` from a citation.
- `worker/src/learner-ask.ts`: `checkLawAnswer` refuses an id not retrieved, a
  page no cited law is on, a figure the law and its quote do not state.
- The `corpus` plugin in `vite.config.ts` emits `ask-laws/<CODE>.json`.
- `AskBox` renders each citation with `manualReference` and
  `t.question.inTheManual(page)`.
- Concept ids are not shared across states (4,085 distinct across 50 corpora),
  so "the union of concepts" cannot be the topic list as it stands.

## Decisions — flip any in the PR

1. **A canonical topic list: `resource/statutes/topics.json`.** Each topic is
   `{ id, question, keywords }` — a road-law question learners ask that a
   statute answers with a rule or a figure. The first list is ~35 statutory
   topics, chosen for being on permit tests and having a code section in every
   state: parking distances (hydrant, crosswalk, intersection, stop sign or
   signal, railroad crossing, fire station, curb), school bus stops, move-over,
   following a fire truck, headlight hours and dimming distance, seat belts,
   child seats, adult and under-21 alcohol limits, implied consent, handheld
   phones and texting, signalling distance, right and left on red, U-turns,
   default and school-zone speed limits, passing on the right, headphones,
   open containers, and the graduated-licence rules (permit age, holding
   period, supervising driver, provisional curfew and passengers). Sign
   shapes, defensive driving and the like are not statutory and are not here.
2. **Per state, only the gaps.** For each topic, the builder checks whether
   the state's manual corpus answers it (retrieve the topic question; a person
   or the build agent reads the top laws). Covered → nothing. Not covered →
   the section is sourced from the state's official code site (the
   legislature's, or the official publisher it designates) and nowhere else.
3. **The committed source.** `resource/statutes/sources/<CODE>/<section>.txt`
   is the section's text as served, and `resource/statutes/SOURCES.json`
   records its URL, retrieval date and sha256 — the manual corpus's
   discipline. `resource/statutes/<CODE>.json` holds the laws: `{ id:
   '<CODE>-S-<n>', topic, law, question, citation: "<Code>, <title>
   § <section>(<sub>) — '<verbatim quote>'", source }`.
4. **Verified at build time.** A unit test holds every statute law's quote to
   appear verbatim (whitespace-normalised) in its committed source, every
   source's sha to `SOURCES.json`, every id unique, every topic id known, and
   no statute law in a state whose manual already covers that topic.
5. **One retrieval file, two kinds.** `ask-laws/<CODE>.json` gains the
   statute laws with `kind: 'statute'`; manual laws are `kind: 'manual'`.
   Retrieval ranks a manual law above a statute law at equal score. The prompt
   labels each statute line *(state law, not the manual)* and tells the model
   to prefer the manual and to say "<State> law" when it uses a statute.
6. **The checks do not change in kind.** A statute citation has no page; an
   answer naming a page with a statute cited is refused as today. Figures are
   grounded on the statute's rule and quote. `uncited` and `not-covered` mean
   what they mean now.
7. **What the learner sees.** A statute citation renders as *Not in your
   manual. Maryland law, Transp. § 21-1003(m): "…"* (Spanish: *No está en su
   manual. Ley de Maryland, …*). The citation is parsed the same defensive way
   as a manual one: the reference before the dash, the quote inside it.
8. **Kept current.** `npm run statutes:check` re-fetches every source and
   reports any whose sha changed; run by hand, yearly or when a state amends.
   A changed section is re-read and its laws re-verified before the new copy
   is committed.
9. **Not on the cards, not in the tests.** Statute laws feed the ask box only.
   The cards and the practice tests stay the manual's, because the real exam
   is written from the manual.

## Acceptance criteria

1. On Maryland, *How far from a fire hydrant can I park?* answers 15 feet with
   the statute citation, labelled as Maryland law and not the manual.
2. On Florida, the same question still answers from the manual (p.66), and no
   Florida statute law is retrieved for it.
3. A statute answer whose figure the statute does not state is refused.
4. Every committed statute quote is found verbatim in its committed source,
   and every source matches its recorded hash.
5. The Maryland gaps in the topic list are each sourced or named as not found
   in the code, with the reason.
6. The ask box's notice and the privacy page say road law comes from your
   state's manual and, where the manual is silent, its law.

## How this fails silently

1. **A quote nobody checked.** Unit: each quote against its source. Mutation:
   change one word of the MD hydrant quote → red.
2. **A source that changed under its quote.** Unit: sha against
   `SOURCES.json`. Mutation: edit the source text → red.
3. **The statute shown as the manual.** E2E (in-process worker as
   learner-ask-law.spec.ts): MD hydrant → citation reads *Maryland law*, not
   *In the manual*. Mutation: render statute citations with the manual label →
   red.
4. **A statute crowding out the manual.** E2E: FL hydrant → p.66, the model
   was given no `FL-S-` law. Mutation: statute laws emitted for covered topics
   → red (the unit gap test is the first line; this is the surface).
5. **Pages does not publish the statute laws.** E2E: `/ask-laws/MD.json`
   contains `MD-S-` hydrant law with `kind: 'statute'`. Mutation: plugin skips
   statutes → red.

## Build order

1. Topic list; the gap check for Maryland; Maryland's sources and laws; the
   verification test. One PR, Maryland only, so the format is reviewed once.
2. The worker, plugin and box changes; the e2e guards; the eval gains MD
   statute cases.
3. Then state by state through the same pipeline the corpora were built with,
   one PR per batch, each with its gap report.

## Non-goals

- A live lookup of any kind at question time.
- Statutes on the cards or in the practice tests.
- Case law, regulations, local ordinances (Baltimore City's own rules, say).
- Legal advice: the box states the rule with its source, as it does now.
