# Ask first

Written 2026-09-23. **Every section of the pass opens on its questions, and the
cards follow.** The mechanism already exists as "Test out of this section"; this
makes it the order of the pass rather than a shortcut, and says why.

**Lands after [the section map](section-map.md) and before
[the short course](short-course.md).** All three rewrite `quizPassed`,
`studyAgain` and `startPrescreen`, so they are sequential on `main`, never
parallel branches. This one is second because it is the smallest and touches
every learner; the short course's table of `sectionAt` consumers is where
`openSection` below gets added when that plan runs.

## Why now

The buyer changed. The sale is to a driving instructor who will put their name
on a recommendation, and an instructor judges a study app on one thing: whether
their students learn from it. Until now the pass opened every section on a card
because a card is the gentler first contact, and gentleness was a
direct-to-consumer instinct — nobody wants a stranger's first ninety seconds to
be six wrong answers. An instructor's student is not a stranger. They arrive
told what this is, and the thing that earns the instructor's next referral is
that their students pass.

So the order of the pass is decided on learning quality, and the evidence on
order is not close. What follows was decided on that basis, and the risk it
takes is stated rather than hedged.

## What is already true, so nobody re-derives it

**The pretest is built, and it is built correctly.** `startPrescreen` opens a
section's questions before its cards; `prescreenAnswered` grades each one as
the card's own quiz would. A right answer puts the law in `progress.skipped`
and the pass walks past its card. **A wrong answer marks the correct row,
shows `law.why`, shows the diagram where there is one, and the card is still
taught afterwards** — `QuestionCard.tsx` draws the explanation on a miss, and
`nextTaught` resumes on the first card not skipped. That is a retrieval
attempt, immediate corrective feedback, and full study of the item after: the
sequence the literature below is about, already shipped.

**Every law has the feedback.** All 13,810 laws across 26 corpora carry a
non-empty `why`. Measured 2026-09-23.

**It is opt-in, and the docblock says the choice was deliberate:** *"Opt-in from
the section's first card rather than the default, so the taught-then-quizzed
order every other card keeps is still what a learner meets unless they ask to
test out."* The study card draws a ghost button, `Test out of this section`, at
the frontier on a section's first card and nowhere else (`App.tsx` at the
`study` case).

**It is framed as doing less.** `Prescreen.tsx` heads the screen `Testing out ·
question 1 of 6` and the exit reads `Study the cards instead`; the checkpoint
reports `tested out of N`. Nothing anywhere tells a learner it might teach them
better. The only person who presses it is someone hoping to skip work, which is
the opposite of who it helps most.

**The exit is real and keeps what was answered.** `leavePrescreen` clears the
prescreen, leaves every right answer in `skipped`, and resumes the pass on the
first card not skipped. A learner who finds the questions harder than expected
loses nothing by leaving.

**The wall covers it.** `holdAtWall` inspects `prescreen` alongside `study` and
`quiz`, so a prescreen at or past `wallIndex` is the paywall. Nothing here
touches that.

**The answers are already counted.** `card_answered` fires for a prescreen
answer exactly as for a quiz answer (`src/analytics.ts` at the prescreen
branch). No event distinguishes the two, and no column exists for a field that
would.

**The section map's grey tap is a prescreen** (`section_tested_out`), and the
short course's sections are six anchors from six concepts. Both reach this
screen through `startPrescreen` and neither needs to know the default changed.

## The evidence, and its limits

The claim is narrow: *answering before being taught, then being taught, retains
better than being taught alone.* Three lines of work support it and one caveat
bounds it.

- **Retrieval beats restudy.** Roediger & Karpicke (2006), and the practice-
  testing entry in Dunlosky et al. (2013), which rates it among the two
  techniques with the strongest support. The pass already does this on every
  card; asking first adds a second retrieval per law.
- **Pretesting.** Kornell, Hays & Bjork (2009), *Unsuccessful retrieval
  attempts enhance subsequent learning*: guessing wrong and then seeing the
  answer beat studying the answer alone, even when the guess was hopeless.
  Richland, Kornell & Kao (2009) found the same on prose: pretested facts were
  recalled better later.
- **Errors do not stick when feedback follows.** Metcalfe (2017), *Learning
  from Errors*, Annual Review of Psychology: the old fear that a wrong answer
  imprints is not supported once corrective feedback is given, and errors with
  feedback improve retention over errorless study. Our feedback is the correct
  row, the reason, and the card.

**The caveat:** the pretesting benefit falls on the *pretested items*, and some
studies find a small cost to untested material in the same passage. Every card
in a section is pretested here, so the caveat does not bite — but it is the
reason a prescreen must ask *every* question of the section, never a sample.

**The limit:** none of this is measured on our learners, and it cannot be.
`card_answered` reports right or wrong, not retention, and outcomes are never
joined to behaviour by design. The decision rests on the literature and on
the mechanism being the one the literature describes.

## The change

### 1. The default order

Reaching a section's first card at the frontier opens its prescreen. Concretely:
every route that would land `studyView` on an index with `sectionAt(...)
.position === 0` at `studyIndex` — `quizPassed` crossing into a new section,
`selectState` resuming a pass, `studyAgain` — lands on `prescreen` instead of
`study`. One helper, `openSection(state, index)`, so the three cannot disagree.

Behind the frontier nothing changes: review is cards, as today.

### 2. The frame

The screen stops calling itself a shortcut.

- Header: `Before the cards · question 1 of 6`.
- **Once, the first time a learner meets it**, a short explainer above the
  first question: *You'll get most of these wrong. That's fine — a wrong guess
  with the answer right behind it sticks better than reading. Anything you
  miss, we teach next.* Dismissed by answering; never shown again. A flag in
  the same place the motion preference lives, not in `Progress`.
- Verdict copy on a miss is unchanged: the correct row, `Not quite.`, the
  reason, the diagram.
- Exit: `Skip to the cards`. Kept, and kept a single tap. The literature is
  about retention; a learner who is upset is a learner who leaves, and the
  exit is what makes the default safe to ship.

### 3. The study card's button goes

`Test out of this section` is removed. The section opens on its questions, so
there is nothing to opt into. The button's only remaining job — testing out of
a section *ahead* of the frontier — is the section map's grey pill, which
dispatches `startPrescreen` with an explicit `at`.

### 4. The checkpoint's line

`tested out of N` becomes `N you already knew`. The count is the same
`testedOutBefore`; the sentence now describes what happened to a learner who
did not opt into anything.

### 5. The first section is not an exception

Argued both ways, decided against an exception.

For one: a stranger's first contact is six questions about a state they have
not opened a card in, and the free tier is exactly one section, so the price
arrives right after six wrong answers.

Against, and this won: the same six questions are also the strongest thing the
product can show an instructor who tries it before recommending it. They know
the material; they answer five of six; the pass skips five cards in front of
them and says so. That is the product proving it respects what you know, in
the first minute, to the person who decides whether their students see it.
The learner who knows nothing gets the explainer in 2, the reason after every
miss, and the exit. And one rule is a rule an instructor can repeat; a rule with
an exception in section one is a paragraph.

**The free sample gets richer, not poorer.** Section one is six questions and
then six cards where it was six cards; the wall is the same boundary it was.

### 6. Short course and section map

Unchanged. A short-course section is six anchors from six concepts; its
prescreen asks those six. A grey pill on the map is a prescreen ahead of the
frontier, exactly as today, and `prescreenAnswered` already refuses to move
`studyIndex` for one.

### 7. Analytics

Nothing new. `card_answered` already carries every prescreen answer, right or
wrong, per law — which is the signal an author wants for "which sections are
too easy". Distinguishing a prescreen answer from a quiz answer would need a
column; it is not needed to make or to check this decision.

### 8. What must not move

- `studyIndex` still means *the furthest card taught*. A prescreen ahead of the
  frontier leaves it alone; `prescreenAnswered` already guards this.
- `skipped` still means *answered right before its card*, and `studyAgain`
  still clears it on a restarted pass.
- `holdAtWall` still inspects `prescreen`.
- `why` is still drawn on a miss. Drawing it on a right answer too is a
  separate question, in Deferred.

## How this fails silently, and what is written to catch it

Playwright on the built app, Maryland fixture. Every guard mutation-tested.

1. **A section opens on a card.** From a fresh state, the first screen of the
   pass is the prescreen with `question 1 of 6`. After a checkpoint, `Keep
   going` lands on the next section's prescreen. Mutation: route to `study`.
2. **A miss shows no reason.** Answer wrong; assert the law's `why` text and
   the correct row are on the page. Mutation: draw the verdict only.
3. **A wrong answer's card is not taught.** Answer all six wrong; the next six
   screens are those six cards, in order. Mutation: put every answer in
   `skipped`.
4. **A right answer's card is taught anyway.** Answer one right and five
   wrong; five cards follow, and the checkpoint says `1 you already knew`.
   Mutation: ignore `correct`.
5. **The exit loses answers or resumes in the wrong place.** Answer two right,
   leave; the pass resumes on the third card and the two are still skipped.
   Mutation: clear `skipped` on leave.
6. **The explainer repeats, or never appears.** First prescreen shows it;
   the second does not; a reload between them does not bring it back.
   Mutation: key it to the section instead of once.
7. **The wall opens.** As an unpaid learner, finish section one; the next
   thing on screen is the paywall, and no question and no law text is on the
   page. Mutation: exempt `prescreen` from `holdAtWall`.
8. **The old button survives.** `study-test-out` is absent from every study
   card. Text assertion, so the affordance cannot quietly come back.

## Build order

1. **The frame** — header, explainer, exit copy, checkpoint line. Opt-in stays.
   No behaviour changes; the reframe alone is worth shipping and is the thing
   to look at on a phone. Guards 2 (already true today) and 6.
2. **The default** — `openSection`, the three routes, the button's removal.
   Guards 1, 3, 4, 5, 7, 8.

Two PRs. The first is copy and can be reverted in a minute if the explainer
reads badly; the second changes what every learner meets and should land on
its own so that if section-one abandonment moves, it is the only suspect.

## Considered and dropped

**Keeping opt-in and only fixing the frame.** It fixes the words and leaves the
order, and the order is the finding. A learner who has to press a button to get
the better sequence mostly will not, whatever the button says.

**An exception for section one.** See 5.

**Removing the exit**, so that the sequence always completes. The evidence is
about retention, not about persistence, and a learner who cannot leave six
questions they are failing is a learner who closes the tab. The exit stays.

**Deferred: the reason on a right answer.** Feedback after a *correct* answer
also helps when confidence was low (Butler, Karpicke & Roediger 2008), and
some right answers here are guesses. Against it: the three-minute sitting, and
a right answer that opens a paragraph reads as a wrong one. Its own change,
with its own look on a phone.

**Deferred: asking a sample rather than every question.** Faster, and it is
exactly what the caveat above warns against — untested items in a pretested
section may retain worse. Every question, or none.
