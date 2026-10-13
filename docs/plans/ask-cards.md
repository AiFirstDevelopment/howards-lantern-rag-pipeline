# Ask a question: a link to the card the answer came from

branch: ask-cards
slug: ask-cards

Written 2026-10-07. [learner-ask-law](learner-ask-law.md) answers road law
from the learner's own state's corpus and renders the citation from the corpus
record. Most of those records *are* cards: the law the answer cites is the law
a study card teaches and a practice question is drawn from. This plan puts a
link under the answer to that card. Run as `/implement ASK-CARDS`.

## Intent

A Maryland learner asks *how far from a fire hydrant can I park?* and reads
*At least 15 feet* with the manual's page under it. The card that teaches that
rule, with the question the test will ask about it, is in the same app, and
today nothing on the answer says so. A web search gives the same figure. What a
web search cannot do is put the learner on the card and ask them the question.

> **At least 15 feet.** — In the manual, p.66: "15 feet of a fire hydrant."
> See the card →

The link exists only when there is a card to go to. An answer written from the
state's vehicle code, or from a hand-written statute law that is not in the
study pass, has no card and shows no link. Nothing about the answer itself
changes.

## What is already true

- A road-law answer carries `citations[{ id, location, kind? }]`, one per law
  the model used and the worker accepted (`worker/src/learner-ask.ts`, the
  `checked.laws.map` near line 670). The `id` is the corpus id. The client
  type is `AskAnswer.citations` in `src/ask.ts`; `AskBox.tsx` renders one
  citation line per entry, statute and manual differently.
- The study pass is `state.studyLaws`, from `getStudyLaws(code)`
  (`src/data/laws.ts`), each with the same `id`. Every one of Maryland's 216
  corpus laws is in `/ask-laws/MD.json` under the same id; the other 4,484
  entries there are code chunks (`kind: 'statute'`, no concept) and 15
  hand-written statute laws (`MD-S01`, concept `park-hydrant`) that are not
  cards. So *has a card* is exactly *the id is in `studyLaws`*.
- `openedAtConcept` in `src/App.tsx` already moves a learner onto a card by
  URL, with the ceiling: never past `furthestStudyCard(state)` (`src/flow.ts`),
  never off a test or a quiz. Its comment says why, and it holds here.
- The ask page is `src/screens/Ask.tsx`, rendered from `App.tsx` as the `ask`
  overlay with `onBack={closeOverlay}` and `stateCode={scopeState}`. The
  partner boxes (`Partner.tsx`, `partners/*`) render `AskBox` too and must not
  change.
- Labels reach `AskBox` through `t.ask.labels` (`src/strings.ts`, EN and ES).
  The Spanish strings already call a card *tarjeta*.
- `tests/e2e/learner-ask-law.spec.ts` runs the worker's `answerLearner` over
  the real corpus with the model faked, through `/#ask`; `seed(page,
  progress)` in `tests/e2e/app.ts` places the pass wherever a test needs it.

## Decisions — flip any in the PR

1. **The link opens a card the pass has reached, and only that.** `App` gives
   the ask page `card(id)`: null unless the screen is `study` or `hub`, the id
   is in `studyLaws`, and its index is at or below `furthestStudyCard(state)`;
   otherwise a function that closes the overlay and sets `studyView` to that
   index on the `study` screen — what `openedAtConcept` does, lifted into
   `openedAtCard(state, index)` and shared. A learner who has not yet been
   taught the card gets the answer exactly as today, with no link: the ceiling
   argument in `openedAtConcept` is not weaker because the request came from
   the ask box. *Flip:* also link before the pass has reached the card, opening
   it read-only without moving `studyIndex`. That is a new screen state and a
   second plan; it is the flip to take if the first week shows the link is
   mostly absent.
2. **Matched by id, never by concept.** A concept holds several laws; the
   answer cites one, and the card shown must be that one. `openedAtConcept`
   matches by concept because a search result names one; this does not.
3. **One link per cited card, on the citation's own line.** Two citations with
   cards get two links; a citation without one gets none. The link is a
   `<button>` in the `text-sky underline` style the box already uses for its
   links, because it changes app state rather than a URL. `data-testid`
   `ask-card`.
4. **`AskBox` gets one optional prop, `card?: (id: string) => (() => void) |
   null`, and a label `labels.card`.** Absent prop, no link: the partner boxes
   are unchanged without being touched. Labels: EN *See the card*, ES *Ver la
   tarjeta*.
5. **`studyIndex` does not move.** Opening a card is review, like the arrows.
   The pass resumes where it was.
6. **No analytics event in this PR.** Events in `src/analytics.ts` are derived
   from state transitions, and a card opened from the ask box is
   indistinguishable from one reached by the arrows without a marker on the
   state. *Flip:* add the marker and an `ask_card_opened` event if the count is
   wanted; it is a small, separate change.

## Acceptance criteria

1. On Florida, with the pass seeded past the hydrant card, *How far from a
   fire hydrant can I park?* shows Florida's figure and citation as today, and
   under the citation a *See the card* control. Pressing it closes the ask
   page and shows the hydrant card: the law's text and *p.66*. `studyIndex` in
   storage is unchanged.
2. The same question with the pass seeded before the hydrant card shows the
   same answer and no control.
3. A question answered from the vehicle code (the Maryland case in
   `learner-ask-law.spec.ts`, cited as *Maryland law*) shows no control.
4. An app question shows no control.
5. With a test in progress, a road-law question shows no control.
6. In Spanish the control reads *Ver la tarjeta*.
7. An answer citing two laws, one with a card reached and one without, shows
   exactly one control, on the line of the law that has the card.
8. The partner boxes render as before: no control, no new prop.

## How this fails silently

- **The id matches nothing.** `/ask-laws` and the corpus are built from the
  same files today, so ids agree. If a future build renumbers one and not the
  other, every link vanishes and nothing goes red; AC1 is the guard, and it
  must assert the control is present, not merely that nothing broke.
- **The link opens the wrong card.** Matching by concept (decision 2) would
  pass a test that checks only the concept. AC1 asserts the law's own text.
- **The ceiling is bypassed.** A `card(id)` that forgets the
  `furthestStudyCard` check puts a new visitor on card 140 of 216. AC2.
- **The overlay does not close.** `closeOverlay` runs first, as `onChooseState`
  does, or the card arrives underneath the ask page and the learner sees
  nothing happen. AC1 checks the card is on screen, not only in state.
- **The answer changes.** The link is rendered by the app beside the citation,
  as the citation is. Nothing in the prompt, the checks or the worker moves:
  the eval's pass rate is the same before and after, and the PR says so.

## Non-goals

- Changing the worker, the prompt, or `checkLawAnswer`.
- Linking a card the pass has not reached (decision 1's flip).
- Linking to the public concept pages (`/drivers/MD/<concept>/`); they are
  for search, and the learner with a state chosen is already in the app.
- A link from the partner boxes, or from the landing page with no state
  chosen, where no road-law answer is given.
- Returning the expected test question in the answer text. The card shows it.
