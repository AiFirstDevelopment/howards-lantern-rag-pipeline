# Ask a question: road law, from the learner's own state's manual

branch: learner-ask-law
slug: learner-ask-law

Written 2026-10-05. [learner-ask](learner-ask.md) (#545, #546) shipped the
`/#ask` box with road law refused by construction, and named this as "the
natural next plan": grounding road-law answers on the corpus, whose every law
already cites the manual. Run as `/implement ASK-LAW`.

## Intent

A learner studying Florida types *how far from a fire hydrant can I park?*
Today the box says *I can't answer road law here*, while the answer sits on a
card two taps away: *You may not park within 15 feet of a fire hydrant*, cited
*p.66 (printed) — '15 feet of a fire hydrant.'* The value is that sentence,
answered in the shape of the question, with the page the learner can check:

> **At least 15 feet.** — In the manual, p.66: "15 feet of a fire hydrant."

What keeps this from being the thing this repo has refused since the partner
box — a model writing road law from memory — is the same move the learner box
already makes, applied to a different book: **the worker retrieves the laws, the
model writes only from what was retrieved, and the worker checks the answer
against what was retrieved before anybody sees it.** The citation the learner
reads is rendered by the app from the corpus record, in the card's format,
never from the model's text.

## What is already true

- `worker/src/learner-ask.ts`: one structured call (`scope`, `answer`,
  `sources`), `checkAnswer` (scope ≠ app → refused; unsourced; priced;
  ungrounded digits; overlong), `pointerFor` writing the worker's own lines.
  `worker/src/learner-api.ts`: `handleLearnersAsk`, scrub (`scrub` +
  `withoutPhones`), `learner_questions` with `state`, no id. The client sends
  `state` (two capitals) already.
- The corpus: `resource/corpus/drivers/<CODE>.json`, `laws[]` with `id`,
  `law`, `question`, `concept`, `citations[{ source: 'manual:<CODE>', location:
  "p.66 (printed) — '…'" }]`. ~8 MB compacted across 50 states — too much to
  bundle into the worker (356 KB gzipped today) and parse at every cold start.
- The card renders a citation with `manualReference` (`src/citation.ts`) as
  `t.question.inTheManual(page): “quote”` (`QuestionCard.tsx`, testid
  `citation`). In Spanish, over an English citation, `inTheEnglishManual`.
- `/api/` is same-origin (Pages Functions proxy to the worker), so the worker
  can read a static file Pages publishes at `https://howardslantern.com/…`.

## Decisions — flip any in the PR

1. **Pages publishes each state's retrieval file; the worker fetches it.** The
   `corpus` Vite plugin emits `ask-laws/<CODE>.json` for every manifest state:
   `[{ id, law, question, concept, citation }]` where `citation` is the first
   `manual:` location — the law the cards show and the citation they render,
   from one build, so the box can never cite a corpus version the cards do not.
   The compaction is one pure function (`worker/src/law-retrieval.ts`,
   `askLaws`) that the plugin, the eval and the e2e stub all call. The worker
   reads `${LAWS_ORIGIN}/ask-laws/<CODE>.json` (`LAWS_ORIGIN =
   'https://howardslantern.com'`, a constant, not a var — no `wrangler.toml`
   change) through an injected `lawsFor(code)`; a failed fetch is reason
   `no-laws` on the row and the honest no-match line, never a generic answer.
2. **Retrieval is lexical, in the worker, deterministic.** BM25 over each law's
   `law` + `question` + `concept` words (lower-cased, stop-words dropped, a
   plural `s` folded), top `RETRIEVED_LAWS = 8`. The model sees those eight and
   nothing else from the corpus. Only the selected state's file is ever read.
3. **One call, as now.** The laws go into the final user message (`Laws from
   your state's manual retrieved for this question: [FL-399] … (p.66 …)`),
   after the cached book, so app questions keep their cached prefix. Rule 4
   changes from *road law → empty* to *road law → answer only from the laws
   given, cite their ids in `sources`; if none answers it, leave `answer`
   empty*. The other four rules and every app-scope check are unchanged.
4. **The road-law checks** (`checkLawAnswer`), in order, each a reason on the
   row: no state → `no-state`; no laws fetched → `no-laws`; empty answer or no
   sources → `not-covered`; any source id not in the retrieved set →
   `uncited`; any page the answer names (`p.N`, `page N`, `pages N`) not a page
   of a cited law → `uncited`; any number in the answer not in the cited laws'
   text and citation → `ungrounded`; longer than `MAX_ANSWER_CHARS` →
   `overlong`. A cited law with no manual citation fails as `uncited` too, so
   **no answer is shown without a citation**. Currency is not refused here: a
   fine is road law and its figure is grounded like any other.
5. **What the learner sees.**
   - Shown: the model's answer, then one `ask-citation` line per cited law,
     rendered from the corpus location with `manualReference` in the card's
     words (`In the manual, p.66: “15 feet of a fire hydrant.”`; in Spanish
     `En el manual en inglés, …`). Response: `{ id: 'answer', answer,
     citations: [{ id, location }] }`.
   - `not-covered`: *Your state's manual doesn't answer that, as far as I can
     find, so I won't guess.* + link to `/drivers/<CODE>/`. No figure.
   - `no-state`: *Pick your state first: the answer comes from its manual.*
     with a button that opens the state picker (`ask-choose-state`).
   - any other road-law refusal: *I can't give you an answer I can check
     against your state's manual.* + the state's page.
   App, price, promise and other scopes behave exactly as today.
6. **Spanish**: retrieval and citations are the English corpus (the Spanish
   packs translate cards, not citations by page everywhere); the model answers
   in Spanish, the citation is labelled as the English manual's. Declared.
7. **The notice, the book and the privacy page stop saying road law is
   refused.** The notice: road-law answers come only from the laws of your
   state's manual, with the page; storage and scrub sentence unchanged. The
   book's `asking-this-box` section and `privacy-learner-questions` updated to
   match. Existing tests that assert *road law is not answered here* are
   re-pointed to the new sentence — a changed behaviour, declared.
8. **Privacy unchanged.** The question is scrubbed before retrieval, the model
   and the row; `sources` on the row are law ids; no id is stored.

## Acceptance criteria

1. On Florida, *How far from a fire hydrant can I park?* shows Florida's figure
   (15 feet) with Florida's citation, *p.66*, in the card's citation format.
2. The same question on Ohio shows Ohio's figure (10 feet) and Ohio's page
   (*p.30*), and neither *15* nor *p.66*.
3. A question no law covers shows the *not in your manual* line and a link to
   the state's page, and no figure.
4. An app question (*how do I reset my progress?*) is answered exactly as
   today: the model's text with its book sections, no citation line.
5. A model reply that cites a law outside the retrieved set, or names a page
   no cited law is on, is not shown.
6. With no state selected, a road-law question is answered with *pick your
   state*, a control that opens the picker, and no figure.
7. The question that reaches retrieval, the model and the row is scrubbed of
   phone numbers and email addresses; the row carries no id.
8. Pages serves `/ask-laws/<CODE>.json` for each published state, containing
   the laws and citations the cards show.
9. The eval gains grounded road-law cases; its pass rate is reported before
   and after.

## How this fails silently

The e2e suite stubs `/api/ask` at the network edge. **For this plan the stub
answers by running the worker's own pipeline in-process** — `answerLearner`
with `askLaws` over the real `resource/corpus/drivers/<CODE>.json`, the real
retrieval and the real checks — with only the model faked, so a guard on
retrieval or on a check is red in Playwright, through `/#ask`. Workerd holds
the handler (row, scrub, fetch failure).

1. **Another state's laws answer.** E2E: Ohio hydrant shows `10` and `p.30`,
   not `15`/`p.66`. Mutation: `lawsFor` ignores the code and reads FL. Red on
   the Ohio figure.
2. **The citation comes from the model, or not at all.** E2E: Florida hydrant
   shows `ask-citation` with `p.66` and the manual's quote. Mutation: drop
   `citations` from the response. Red on `ask-citation`.
3. **A guess on a law nobody retrieved.** E2E: an uncovered question, the fake
   model writing a figure anyway with no source → not-covered line, no digit.
   Mutation: `checkLawAnswer` accepts empty sources. Red on the absent answer.
4. **A page outside the retrieved set.** E2E: fake cites `FL-1` (real, not
   retrieved) → refused; fake answer *see p.99* citing FL-399 → refused.
   Mutation: drop the retrieved-set check; then drop the page check. Red each.
5. **A generic answer with no state.** E2E: no state, road-law → pick-your-state
   line and `ask-choose-state`, which lands on the picker. Mutation: no-state
   check removed (retrieval of an empty set falls to not-covered). Red on the
   choose control.
6. **App answers change.** E2E: reset question → `ask-answer` with the book
   source link, no `ask-citation`. Mutation: road-law path taken for every
   scope. Red on the sources link.
7. **The scrub is bypassed by retrieval.** Workerd: a question with a phone and
   an email → the fake asker's request and the row have neither. Mutation:
   retrieve on the raw question and pass it. Red on the recorded request.
8. **Pages does not publish the file the worker reads.** E2E: GET
   `/ask-laws/FL.json` from the preview → contains `FL-399` with its p.66
   citation. Mutation: plugin skips emission. Red on the 404.
9. **A fetch failure becomes a generic answer.** Workerd: `lawsFor` throws →
   200, no answer, row `model = 'no-laws'`. Mutation: catch returns `[]` and
   proceeds. Red on the reason.

## Non-goals

- Spanish-manual citations by page; a vector index; answers across states.
- Any change to the partner or rep boxes, their routes, tables, ceilings.
- Schema changes: `learner_questions` already has every column needed.
- Statutes, the agency's site, or anything not in the corpus.
