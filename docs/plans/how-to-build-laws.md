# Adding a state to a product's corpus

How to produce, for some state other than Maryland, the data that
`resource/corpus/drivers/MD.json` currently holds — and how to know when you
have actually finished rather than merely stopped.

**A corpus belongs to a product as well as a state.** The files are
`resource/corpus/<product>/<STATE>.json`, one per pair, and
`resource/manifest.json` lists which pairs exist. Today the only product is
`drivers`; a hunting-licence exam would be `resource/corpus/hunting/PA.json`
and would need none of the driving corpus. Wherever this document says "the
state", read "this product's version of this state" — a hunting exam in
Maryland is a different corpus from a driving one, not a variant of it.

Read this whole file before writing any JSON. The schema is the easy part; the
constraints are not, and several of them will reject a corpus that looks fine.

## What already works

Production has no runtime branch or configuration keyed to `"MD"`. The app
reads whatever the manifest declares: the validated catalog builds the state
list from it, progress is stored per product and state under
`teach-and-test/v1/<product>/<code>`, and the study pass and question pool are
derived per state. Adding a valid corpus file and its manifest entry is
genuinely all the application needs. Exam question count, pass mark, display
name and pictorial concepts are required state data. The catalog rejects
incomplete or impossible state-level configuration rather than silently
borrowing another state's rules.

## What this touches outside the corpus file

Mostly the JSON, but not only. The inventory, so nothing is discovered late:

**Always — the manual and its provenance.**
`src/assets/drivers-manuals/<CODE>.pdf` and an entry in that directory's
`SOURCES.json`. Nothing imports the PDF and nothing bundles it — a build puts
no manual in `dist` — so it is provenance in the same sense as
`src/assets/signs/SOURCES.json`, and it is the source every citation in the
corpus resolves against. See [Phase 0](#phase-0--the-manual-before-any-writing).

**Always — the manifest.** `resource/manifest.json` gains the state's code,
display name and exam shape under its product. That entry is what the welcome
screen's selector is drawn from and what tells the build to bundle the file, so
a corpus file nobody declares ships nothing and a declaration with no file
fails the build. `tests/unit/manifest.test.ts` holds both, and holds the name
and exam shape to what the corpus file says about itself — the two places are
checked against each other rather than trusted.

**No change at all — application code.** `src/App.tsx`, the screens, the flow
reducer, storage: none of them name a state. The state list, the study pass, the
pool and the per-state progress key all derive from the data.

**No change — production or existing test code.** The data, question-quality
and sign suites discover every corpus key automatically. A new state is covered
without adding a test case or naming its code in test source. The assembled
browser suite separately proves that a differently shaped state works through
the same application.

**Conditional — assets and provenance only:**

| Change | Needed when |
|---|---|
| New SVG plus `src/assets/signs/SOURCES.json` provenance | the state needs artwork the shared library does not carry |
| A new `resource/corpus/<product>/` directory | this is the first state of a new product |
| `public/audio/<STATE>/` — the recorded voice | you want the state read aloud in the real voice rather than the browser's. Optional, and last: see Phase 10 |

The existing sign-fetching tool may be used when it already supports the asset.
Do not modify the tool as an incidental part of adding a state. If the asset
workflow itself needs a new capability, follow the compatibility rule below.

**Leave alone.** `tests/unit/storage.test.ts`, `gate.test.ts` and `fixtures.ts`
also say `'MD'`, but they use it as *an arbitrary state code* to exercise
storage and the readiness gate — not as the corpus under test. Generalising
those buys nothing.

## Compatibility rule — stop when the model does not fit

**Never modify production code or existing tests to special-case a new state or
force its facts into the current model.** A state code, state name or
state-specific rule must not appear in a runtime branch, fallback, exception
list or test-only accommodation. Adding one valid state must continue to require
only data and, when necessary, shared sign assets and provenance.

If authoritative facts for a state cannot be represented faithfully by the
current schema or application model, **stop the state-addition work and exit
with a proposal**. A failing valid corpus is not permission to change code. Do
not distort the facts, borrow another state's defaults, repurpose a field,
weaken a generic contract or implement a one-state exception. Report:

1. the authoritative fact that does not fit, with its source;
2. the current schema, validation or behavior that cannot represent it;
3. a proposed general, state-neutral schema or model extension;
4. backward-compatible migration and default behavior for every existing state;
5. generic contract tests and fully assembled behavior tests proving both the
   new capability and unchanged behavior for existing states; and
6. effects on storage, historical results, UI, accessibility and documentation.

Treat that proposal as a separate design change. **Do not implement it as part
of adding the state unless it is separately reviewed and approved.** After
approval, extend the shared model generically first; then resume the data-only
state addition.

## Phase 0 — the manual, before any writing

**The state's own driver manual is the syllabus, and a law that is not in it
does not go in the corpus.** Everything else is a supporting source that may
corroborate a fact the manual already carries, and may not be the reason a fact
exists.

This rule is not fastidiousness. Maryland's corpus was written from the open
web before the manuals were kept locally, and eleven of its fifty-six numeric
laws state a figure that appears nowhere in the Maryland manual — the `0.07`
DWI threshold, the `0.02` under-21 limit, a `$570` school-bus fine, the `1967`
seat-belt requirement. Every one of those is true. Every one is real Maryland
law. None of them is in the book the learner is told to study, and a learner
who spends an evening on them sits an exam that never asks. The statute is
larger than the handbook; the handbook is what the paper is written from.

Read the whole of Phase 0 before opening an editor. Nothing here is optional
and two of the steps exist only because they have already misled a reviewer.

### The manual is downloaded by hand

Save it as `src/assets/drivers-manuals/<CODE>.pdf` — the same code as
`resource/corpus/<product>/<CODE>.json`, `public/audio/<CODE>/` and the
manifest, so the manual is reachable from the corpus key with no mapping table.
It is committed, deliberately, against the `src/assets/bio-pics/` precedent in
`.gitignore`: a page-number citation is only checkable against the exact bytes
it was written from, and an ignored manual makes every `page 34` in the corpus
unverifiable the moment the agency revises the PDF at the same URL.

**By hand, not by fetcher.** Every automatic version of this fails in a way
nobody sees: a 200 and a login wall, the Spanish edition, the CDL manual, or a
2019 revision still sitting at the 2026 URL. The manuals differ per state in
exactly the ways that break scripts — Virginia's is one PDF at a stable path,
Pennsylvania's primary edition is a website with a PDF beside it that lags,
West Virginia's is a 17 MB InDesign export. A person opening the agency's page,
reading which edition is current and saving the file is the step that cannot
silently pick up the wrong document.

Then record it in `src/assets/drivers-manuals/SOURCES.json`, which has the same
shape and the same job as `src/assets/signs/SOURCES.json`: the URL, the agency,
the edition, the date retrieved, the sha256, the page count, and the two fields
below.

### Establish the page offset before citing anything

**Printed page numbers are not physical page numbers**, and the gap is
different in every manual. The four already here run 0, 4, 2 and 10.

Virginia is the worked example. Its corpus cites "Section 2, Traffic Signs —
Sign Shapes, pages 6-7". Physical page 6 of `VA.pdf` is "Section 1: Testing —
Road Skills Test"; Sign Shapes is physical page 8. A reviewer told to open page
6 and check the quote finds a different section, reports a good citation as
wrong, and is themselves wrong. The offset costs one measurement and saves
every reviewer after you.

To find it, extract the header and footer of each page and look for a printed
number:

```sh
pdftotext -q -f 12 -l 12 src/assets/drivers-manuals/VA.pdf - | head -3
```

Where no page number survives extraction — West Virginia prints none the text
layer can see — derive it from content instead: find a phrase the corpus or the
contents page places on a known printed page, locate the physical page carrying
it, subtract, and confirm on two more before believing it. Write the basis into
`pageOffsetBasis`, not just the number, so the next person can check your
arithmetic rather than trusting it.

### Check the text layer, and know when it cannot help you

Run the extraction and read some of it. `textLayer` is `clean`, `partial` or
`none`, and it decides whether a mechanical check means anything.

West Virginia is why the field exists. `pdftotext` returns 22,957 words from
`WV.pdf`, which sounds like a clean extraction and is not: **33 of its 90 pages
come out as mojibake**, through a font whose encoding is shifted 31 code points
down, so `DrivingInOtherStates` arrives as `%SJWJOHJO0UIFS4UBUFT`. A script
asking "does this quoted sentence appear on this page" returns *no match* for a
third of that handbook — and a no-match is indistinguishable from a fabricated
citation. On a `partial` or `none` manual, absence is not evidence. A person
reads the page.

Maryland carries the smaller version of the same trap: it writes the BAC
threshold as `.08` with no leading zero, so the first script run against it
reported the most famous number in drunk-driving law as missing from the book.
Whatever you script, sanity-check it against something you know is there before
you believe what it says is not.

### The supporting sources, and what each may not do

The roles are real; what changed is that none of them may originate a law.

| Source | Answers | May not |
|---|---|---|
| **The manual** | the substance of every law | — it is the syllabus, and nothing enters without a page in it |
| **The agency's test page and press releases** | which topics carry weight, and the exam's shape | be the substance of a law. See the one exception below |
| **The statute** | the exact figure the manual states loosely | be the reason a law exists. A manual saying "the speed limit in a business district" without the number is completed from the code; a limit the manual never mentions is not a law for this corpus |
| **Third-party miss-rates** | where to add depth | decide inclusion |
| **Practice-test vendors** | nothing | be used at all. They are how off-syllabus law got in, and twenty-two of Maryland's citations point at them |

**The one exception.** A topic the agency's test page explicitly says is
tested, which the manual does not cover, may be included — and must carry an
`offManual` field naming the agency source that puts it on the paper. Maryland's
MVA press release naming hands-free driving and sharing the road with cyclists
is the real case. Barring it outright was considered and rejected: the fact is
genuinely on the test, so a ban invites it back in under a vague manual
citation, where it is indistinguishable from a sourced one. An honest flag is
worth more than a rule nobody follows, and the field makes the exceptions
countable — a state accumulating thirty of them is telling you something about
its manual.

### The rest of Phase 0, unchanged

- **The agency's name and structure.** DMV, MVA, MVD, BMV, DPS, DOL, Secretary
  of State — and in some states licensing sits under the police. Find the body
  that actually issues the permit; `metadata.licensingAgency` is free text.
- **Several manuals.** Some states publish one per licence class. Say in
  `metadata.sourceManual` which one you used and why, and commit that one.
- **No linkable statute.** Not every state has a free, public code. Where none
  exists the manual is your only numeric source — record that limitation in
  `metadata.factCheck` rather than implying a statutory check you did not do.
- **The test's shape.** Question count, pass mark, time limit, languages. This
  fills `metadata.knowledgeTest`; get it from the agency, not from a
  practice-test vendor. `questions` and `passMark` drive the running and scoring
  of the assembled application, so neither may be omitted or inferred.

Write each source into `metadata.references` as you go, not afterwards. You will
not remember which page a number came from.

## Phase 1 — the law objects

Every entry is one testable fact. Maryland has 190 for 40 concepts, which is
deliberate redundancy: the same concept asked several ways is what makes repeat
runs differ.

```jsonc
{
  "id": "VA-001",                    // "<CODE>-<3 digits>", unique, in file order
  "category": "learners-permit",      // fine-grained topic; MD has 34
  "concept": "permit-and-provisional",// the testable concept; MD has 37
  "law": "A learner's permit holder must always be accompanied by …",
  "why": "A supervising driver is there to catch what a beginner misses …",
  "question": "A learner's permit holder must be accompanied by …",
  "answers": [                        // exactly 4, exactly 1 correct
    { "answer": "at least 18 years old with any valid license", "isCorrect": false },
    { "answer": "at least 21 years old, licensed for at least 3 years, and seated beside the driver", "isCorrect": true },
    { "answer": "…", "isCorrect": false },
    { "answer": "…", "isCorrect": false }
  ],
  "inPool": true,                     // may a test draw this?
  "examLikely": true,                 // is this a study anchor?
  "anchorRank": 1,                    // 1 = the concept's sole anchor, 2 = reinforcement
  "anchorBasis": "sole study anchor for the 'permit-and-provisional' concept",
  "sign": "stop",                     // only for sign-recognition concepts
  "examCitations": [ { "source": "…", "location": "…", "supports": "…" } ]
}
```

Field by field, with the parts that are not obvious:

- **`law`** — the rule, stated plainly. It is shown as the study card.
- **`why`** — *required for every pooled law* (a test enforces it). One sentence
  on why the rule exists, in words the learner already has — see
  [Phase 4](#and-then-write-it-for-the-person-reading-it), which sets a reading
  floor and refuses one sentence shared across many laws. It is shown when a
  learner gets the question wrong, where the law text alone tends to restate the
  answer back at them. Reasoning survives being asked in unfamiliar words; a
  memorised answer does not.
- **`inPool`** — `false` for licensing paperwork and trivia that the real paper
  would not ask. Everything else `true`. Maryland pools all 190, because after
  the manual-first rebuild every law in it is on the syllabus.
- **`examLikely` + `anchorRank`** — one `anchorRank: 1` law per concept, in the
  order the concepts first appear in the file. These mark what the paper is
  most likely to ask; they no longer define the study pass, which since
  2026-09-04 is every pooled law (`data.test.ts` holds it to `getStudyLaws()`). `anchorRank: 2` is a reinforcement anchor:
  it stays in the pool but is not taught, and at least one must exist.
- **`sign`** — see [Phase 5](#phase-5--signs).
- **`citations` / `examCitations`** — free-form provenance. Use them for
  anything a reviewer would otherwise have to take on faith.

**Keep laws of the same concept contiguous in the file.** Concept order is
derived from first appearance, so the study pass reads in file order. Scattered
concepts produce a study pass that jumps around.

## Phase 2 — deciding what is actually on the exam

### First, a trap in the field name

**`examLikely` does not mean "likely to appear on the exam".** It once did — it
marked the 40 laws believed most likely to be asked — and
`metadata.conceptModel.rationale` records why that was abandoned: narrowing the
pool to predicted questions destroys the predictive validity the app exists to
provide. A learner needs ~92.8% per-question accuracy to have a good chance at a
high pass mark, and a study set that small yields roughly a 2% pass probability
when the rest is answered at 60%.

Today `examLikely: true` means **"this law is a study anchor"**, nothing more.
The name is a leftover. Do not use it as a likelihood filter, and do not let
exam-likelihood decide `inPool` either.

### So where does exam likelihood actually belong?

Three places, all of them about *emphasis* rather than exclusion:

1. **Which concepts exist at all.** A topic the agency names as tested deserves
   to be its own concept rather than being folded into a neighbour.
2. **Which concepts get a second anchor.** `anchorRank: 2` is reinforcement:
   pooled and asked, but not taught in the study pass. Maryland gave these to
   high-yield concepts — its `anchorBasis` values include
   `"Traffic Signals is the #2 most-missed area (31.2%)"` and
   `"MVA names 'roadway signage' first among tested content"`.
3. **How many laws a concept gets.** A heavily tested concept earns more
   variations, so repeat runs keep finding new ways to ask it.

### The evidence hierarchy

Two questions, and it matters which one you are asking. **What exists** is
settled by Phase 0's rule and has no hierarchy: the manual carries it or it is
not a law here. What follows ranks evidence for **emphasis** only — which
concept earns a second anchor, which earns more variations. Strongest first,
and record which rung you took.

1. **The manual's own structure.** It is the syllabus, so its chapter weighting
   is the primary signal: what it spends eight pages on and what it gives a
   paragraph. Many manuals also state outright which chapters the test draws on.
2. **The agency's own statement of tested content.** Maryland's best single
   source was a news release: *"25 random questions that include roadway signage
   and rules of the road, the dangers and penalties related to the impaired
   operation, and specific topics about sharing the road with bicyclists and
   hands-free driving laws."* That one sentence justified 23 citations. Look on
   the test page, the manual's introduction, and press releases. Strong on
   weight; not a licence to add a law the manual omits, except under the
   `offManual` rule in Phase 0.
3. **Official sample questions.** Some agencies publish a practice test. Its
   topic distribution is direct evidence.
4. **Aggregate miss-rates.** Third parties publish which topics test-takers fail
   most. This tells you where to add *depth*, never what to include.

Practice-test vendors' topic lists used to be a fifth rung, admitted "to
corroborate, never alone." **They are now barred.** They are marketing copy,
recycled between states, and twenty-two of Maryland's citations point at them —
they are the mechanism by which off-syllabus law got in. A rung nobody should
stand on is better removed than labelled.

### The citation contract

A citation to the manual names the local file by code, not by URL:

```jsonc
{
  "source": "manual:VA",
  "location": "p.14 (printed) — 'A flashing red light means the same as a stop sign.'",
  "supports": "the rule itself"
}
```

`manual:<CODE>` is what makes the claim checkable offline and stable across
agency site redesigns — the failure Pennsylvania is currently sitting on, where
all 267 of its citations point at a live HTML page and not one names a page
number, so the evidence evaporates the next time PennDOT re-flows the site.
Page numbers are the manual's **printed** numbers; `SOURCES.json` carries the
offset that turns them into physical ones.

### Recording it

Two fields carry this, and both should quote rather than summarise:

```jsonc
"examCitations": [{
  "source": "https://…",
  "location": "paragraph 8: 'The online test is given with 25 random questions that include roadway signage and rules of the road…'",
  "supports": "'rules of the road' (topic-level: statutory speed limits)"
}],
"anchorBasis": "Traffic Signals is the #2 most-missed area (31.2%)"
```

`location` quotes the actual text so a reviewer can check the claim without
re-reading the page — and so you can tell later whether the page has changed.
`supports` states plainly how the quote bears on *this* law, including when the
link is topic-level rather than specific. Say "topic-level" when it is; a stated
weak link is worth more than an implied strong one.

Where you have no evidence for a concept, the honest `anchorBasis` is the
structural one Maryland uses elsewhere: `"sole study anchor for the '<concept>'
concept"`. That claims nothing about the exam, which is correct when you know
nothing about it.

## Phase 3 — the concept model

Concepts are the spine. `190 → 40` for Maryland, because the corpus is
deliberately redundant: a concept asked six ways is what makes two runs of the
exam feel different.

Hard requirements, each enforced by a test:

- Every law has a non-empty `concept`.
- Every concept has **exactly one** `anchorRank: 1` law.
- Every study anchor is also `inPool: true` — the pass never teaches something a
  test cannot ask.
- At least one `anchorRank: 2` law exists, is pooled, and is *not* in the study
  pass.
- The pool is larger than `metadata.knowledgeTest.questions`, or runs would not
  vary.

**Do not narrow the pool to "likely" questions.** `metadata.conceptModel`
records why at length: with a high pass mark, a learner needs ~92.8%
per-question accuracy, and modelling a 25-question draw shows that a 40-law
study set yields roughly a 2% pass probability. Narrowing the pool destroys the
predictive validity the app exists to provide. Compress by concept instead.

## Phase 4 — writing answers that do not give themselves away

This is where a fresh corpus fails. `tests/unit/question-quality.test.ts` exists
because 71% of an earlier Maryland pool could be answered with **no knowledge at
all** by picking the longest option. Read that file before writing answers; it
is the single highest-value thing in this document.

The three tells it enforces against:

1. **Length.** The correct answer must not be conspicuously longer (or shorter)
   than the distractors. This happens naturally: you write the right answer
   precisely and the wrong ones quickly. Write the distractors to the same
   length and specificity.
2. **Absolutes.** `always / never / all / none / every / any / only / whenever`
   must appear at a similar rate in right and wrong answers. Do not make
   distractors wrong by over-generalising — make them wrong on substance.
3. **Numeric position.** On a four-number question, the answer must not sit in
   the middle two. Maryland's did in 21 of 22 numeric questions, so crossing off
   the extremes took a learner from 25% to 50% knowing nothing. Distractors must
   *straddle* the answer, not surround it.

Also enforced: four distinct options, exactly one correct, none shorter than
four characters, and every pooled law has a `why`.

There is an end-to-end check too: a simulated coached guesser applying length
and hedging in the order they are taught must score below 40%.

### And then write it for the person reading it

`tests/unit/readability.test.ts` holds every state's `why` text to a floor, and
it exists because Pennsylvania shipped at a reading level its learners do not
have. Maryland's explanations average 68 on Flesch reading ease and West
Virginia's 68; Pennsylvania's averaged 37, with 67 of its 175 entries below 30
— academic-paper density — and several negative:

> "Automatic conversion ends the age-based junior classification without
> requiring another driving examination."

Nothing was wrong with the facts. The register was wrong, and `why` is shown at
the one moment a learner has just got something wrong, which is the worst place
in the app for a sentence that has to be read twice.

The diagnosis is the useful part, because it is not what anyone guesses.
Pennsylvania's sentences were the *shortest* of the three states — 16.3 words
against Maryland's 18.6. Its words were the longest: 1.79 syllables against
1.38, and 19% of them three syllables or more against 7%. It was not verbose,
it was abstract. It wrote about the rule where the others wrote about the
driver.

So when this test fails, **use shorter words; do not add full stops.** The
formula is crude and chopping a sentence in two raises the score without
helping anybody. Three things that do help:

- Name the thing. "A car parked at the corner" rather than "clear space near
  the crosswalk preserves sight lines".
- Say the failure the rule prevents, which is the register the rest of this
  repo is written in — see the comments in `src/site.ts`.
- Do not reach for the Latin. `restriction`, `classification`, `consequences`,
  `accountability`, `predictably` were Pennsylvania's tell; they barely appear
  in the other two.

Second person is not the lever, and it is worth knowing that before you reach
for it: Maryland uses "you" in 41% of its explanations and West Virginia in 2%,
and West Virginia reads the most easily of the three. Concrete words are what
matter, not the pronoun.

The same test also refuses to let one sentence stand in for many. West Virginia
was written with a single line shared across all 39 sign questions and
Pennsylvania with one across 16; a learner who misses four sign questions was
told the same thing four times and taught nothing about any of them. Every
pooled law gets its own explanation.

### And write it in American English

`tests/unit/register.test.ts` holds every state to US spelling and idiom, in
the law text, the question, the answers and the metadata. It exists because
Maryland shipped with 58 British forms in it — `licence`, `kerb`, `tyre`,
`windscreen`, `give way`, `junction` — and because both later states picked
more up as they were written and rewritten. None of it is wrong, exactly, which
is what makes it slip through: a learner reads "give way" and "kerb" on a
Maryland exam and quietly wonders whether this app knows which country it is
in. The real handbook says yield and curb, and so will the paper.

Expect to reach for the wrong register without noticing — whoever writes,
writes in the English they think in. Run the test rather than trusting your
ear.

Two cautions, because both have already bitten:

- **A quotation is reproduced as written.** `citations` and `examCitations`
  quote a source; if a handbook phrases something in a way the list dislikes,
  the handbook wins. The test only reads learner-visible text and the metadata.
- **Do not fix these with a global search and replace.** Doing exactly that
  turned "a junction" into "a intersection" twice, and an earlier pass turned
  "a car parked" into "a parking loted" in three explanations, which shipped.
  Convert, then read what you changed.

The list is deliberately confined to forms that are unambiguously British.
`pavement` is the road surface in every US driver's handbook and cannot be
banned; `roundabout` is the MUTCD's own word; `overtaking` appears in US
traffic statutes even though handbooks prefer passing. A list that flagged
those would be a list nobody could keep green, and a list nobody can keep green
gets switched off.

## Phase 5 — signs

MUTCD designs are federal works and the manual states they are not protected by
copyright, so **the artwork already in `src/assets/signs/` is reusable by any
state**. A new state normally needs no new files.

The rules, all enforced:

- Declare the state's pictorial concepts in
  `metadata.signImagery.pictorialConcepts`. Every law in them **must** have a
  `sign`; no law outside them may have one. Concept names are state data and do
  not require a test change.
- `sign` must match the basename of an SVG in `src/assets/signs/`, and that same
  key must have provenance and visible-only `alt` text in `SOURCES.json`.
- **The question must not name the shape or colour.** "An eight-sided red sign
  means…" hands over the thing being tested. `signs.test.ts` holds the list of
  giveaway words and fails on any of them.
- Alt text describes what is *visible*, never what it means — interpreting the
  sign leaks the answer through the accessibility tree.

If your state genuinely needs a sign the repo lacks, add the verified SVG and a
matching `SOURCES.json` record containing its source, licence, modifications,
MUTCD identifier and visible-only `alt` text. The artwork is discovered from
those assets; `RoadSign.tsx` must not be edited. The existing fetcher may be used
only when it already supports the sign without a code change. Every shipped
sign must be used by some question — unused artwork fails a test.

## Phase 6 — metadata

`metadata` is not decoration; its derived numbers are checked against the corpus
because they drifted once and nobody noticed:

| Field | Must equal |
|---|---|
| `conceptModel.concepts` | distinct `concept` values |
| `conceptModel.poolSize` | laws with `inPool: true` |
| `conceptModel.anchors` | laws with `examLikely: true` |
| `conceptModel.studyPass.laws` | laws the study pass teaches — every pooled law |
| `signImagery.expanded` | must contain the pool's true signage share as `NN%` |
| `sourceManual` | the edition named in `src/assets/drivers-manuals/SOURCES.json` |

`tests/unit/drivers-manuals.test.ts` holds the manual itself: every declared
state has a PDF, its sha256 still matches what `SOURCES.json` records, and no
citation names a printed page past the end of the book. The hash is the
load-bearing one — an agency that revises its manual at the same URL renumbers
every page at once, and without it each `p.34` in the corpus would go on looking
exactly as correct as it does now.

A product's `tagline` in the manifest has a budget as well as a job: it is
rendered immediately above the state selector, and the welcome screen has to
keep that selector above the fold on a 375x700 phone. One line at 14px is about
45 characters; a longer one wraps and fails
`tests/e2e/study.spec.ts` › "the states still above the fold". That test is the
budget — do not raise it, shorten the tagline.

`stateName` and `knowledgeTest` are also written in `resource/manifest.json`,
which is what the welcome screen reads before any law text is loaded. The two
must agree; a test says so, because nothing about editing one file makes you
edit the other.

Also fill `stateName` (this is the label in the state-select dropdown),
`licensingAgency`, `sourceManual`, `knowledgeTest`, `updated`, and `references`.
The state-level configuration has these hard requirements:

- `stateName` is a non-empty string.
- `knowledgeTest.questions` and `knowledgeTest.passMark` are positive integers.
- `passMark` does not exceed `questions`.
- The question pool contains at least `questions` laws and, for varied runs,
  should contain more than `questions` laws.
- `signImagery.pictorialConcepts` is an array of concept names. It may be empty
  only when the state's test genuinely has no pictorial sign-recognition
  concepts.

There is deliberately no default exam shape. Missing configuration is an error,
not a reason to inherit Maryland's values.

## Phase 7 — let the existing contract inspect it

Do not add state-specific assertions. The corpus, quality and sign contracts
iterate every key automatically. Running them is the proof that the new data
meets the same rules. The browser suite also assembles the application with a
second, differently shaped state to protect the data-only architecture itself.

The completion invariant is strict: adding a state may add a corpus file, its
manifest entry, its manual under `src/assets/drivers-manuals/<CODE>.pdf` with
the matching `SOURCES.json` entry, **one row in `src/license-cards.ts`**, when
necessary sign assets and provenance, and its recorded audio under
`public/audio/<STATE>/` (Phase 10). Beyond that row it must not require a change
under `src/` that any code imports — the manual and both `SOURCES.json` files sit
under `src/assets/` and are read by tooling and by people, never by the bundle.
If a new state breaks this invariant, the state addition is blocked; the remedy
is a separately approved, backward-compatible extension to the shared
model—not a state-specific code or test change.

**The licence-card row is the one exception, and it was written here as a
prohibition until Wisconsin.** `src/license-cards.ts` maps a state code to its
card image and the bundle imports it; with no row, `licenseCardFor` returns
`undefined`, the state page draws no card at all, and
`published-states.spec.ts` › "draws a card of its own for every published state,
not Maryland's" goes red. So "a state addition touches nothing importable" and
"every published state draws its own card" cannot both hold, and this document
asserted both for nine states — the ninth is where a plan wrote the prohibition
into an acceptance criterion and the criterion could not be met. It belongs in
the **manual** PR, with the artwork it names: see Step 1 of the `add-state`
skill.

**`tests/unit/data.test.ts`'s `DECLARED` table is a second exception**, added by
#258. It pins every state's question count and pass mark and asserts its keys
equal the shipped states, so a new state must add its row or the suite fails.
That is the table doing its job, not a state-specific assertion of the kind
Phase 7 forbids — the row is data, and `scoringShape` has no state-shaped branch.

## Phase 8 — verify

```sh
npm run build         # types, test types and the production bundle
npm run test:unit     # corpus contract: schema, concepts, quality, signs, metadata
npm run test:e2e      # fully assembled application, including an alternate exam shape
npm test              # both unit and assembled behavioral suites
npm run test:coverage # measured unit coverage; browser behavior is reported separately
npm run dev           # pick the new state and walk the study pass
```

The unit suite is the corpus-quality gate: it checks every state key and should
be run early while writing. The Playwright suite is the behavior gate: it drives
the production build through a real browser and assembles it with an additional
state whose exam shape differs from Maryland's. Both must pass. Unit coverage
does not include browser execution, so do not weaken behavior tests merely to
inflate that percentage.

## Phase 9 — have it checked by something that did not write it

**A green suite is not evidence the corpus is right.** Every contract in
`tests/unit/` checks the shape of the data — that each concept has an anchor,
that no answer gives itself away, that the metadata counts what is there. Not
one of them can tell you whether a speed limit is the real speed limit, whether
a citation points at a page that carries the claim, or whether the sentence in
`location` is what the source actually says. Those are the failures that reach
a learner, and they are invisible to the person who wrote them, because
checking your own numbers re-reads them in the order that produced them.

**So before the state is shipped, spawn a subagent to validate it, and give it
the brief of finding you wrong.** Not "review this" — an adversarial brief that
names what to check and tells it to assume mistakes exist. Have it:

1. read this document first, then verify the addition against every rule in it;
2. confirm the completion invariant mechanically — `git status --porcelain`
   should show the corpus file, the manifest, the manual and its `SOURCES.json`
   entry, the `src/license-cards.ts` row, the `data.test.ts` `DECLARED` row, and
   nothing else;
3. run `npm run test:unit` and `npm run build` itself and report the real
   output, rather than trusting a claim that they passed;
4. **fact-check every law that states a number against the local manual**, at
   the physical page `SOURCES.json`'s offset resolves the citation to — not at
   the printed number, which is a different page in three of the four manuals
   here. Report any figure the page does not carry and any citation pointing
   somewhere that does not support it. On a manual whose `textLayer` is
   `partial` or `none`, a no-match is not a finding until a person has looked at
   the page, because a third of West Virginia's handbook returns no-match for
   everything;
5. read a sample of questions for defects the contracts cannot see — an answer
   guessable without knowledge, an option that does not answer the question
   asked, a distractor that is arguably also correct, a `why` that restates
   rather than explains, or a sentence a fifteen-year-old would have to read
   twice;
6. check the sign questions against `tests/unit/signs.test.ts` by hand, since
   the giveaway check is a substring match and words like "reduce" contain
   "red";
7. **hunt for the same fact asked twice in different words**, and hardest of
   all across two parts of a sectioned paper;
8. **trace every law back to a page of the manual, and report any that cannot
   be.** This is the check the whole of Phase 0 exists to make possible, and it
   is a reading job rather than a contract because it needs judgement about what
   a paraphrase covers — a law can restate a manual's paragraph in entirely
   different words and still be squarely on the syllabus. A law with no page
   behind it is off-syllabus and comes out, unless it carries `offManual` with
   an agency source naming it as tested.

That last one deserves its own paragraph, because it is the failure this
document can least afford to leave to a contract. `data.test.ts` does check
that the pool teaches each fact once — and it compares `law` text exactly, and
`law` text plus sorted options exactly. A restatement is not an exact match, so
it passes. Virginia shipped one: "expect more animals after one crosses" as a
sign question in part one and again as a hazard question in part two. The parts
draw separately and de-duplicate only by law id, so a single forty-question run
could ask that fact twice — a paper that asks thirty-nine things, scored
against a bar the real exam sets over forty.

**Do not try to close this with a similarity check.** It was measured on
Virginia and it does not work: the real duplicate scores 0.25 on token overlap,
and at that threshold sixteen unrelated pairs in the same clean corpus score as
high. Even at 0.5 a false positive is already there — a no-right-turn sign and
checking for signs before a U-turn. There is no separating threshold, and a
test nobody can keep green gets switched off. Reading is the control here, which
is why it is on this list rather than in `tests/unit/`.

**Two more signals were tried across all twenty-four corpora on 2026-09-21, and
both failed worse than token overlap did.** The Illinois review panel reported
five near-duplicate pairs and the argument above was used to reject acting on
them in one state, which is right but is not an answer — so the question was
reopened with the whole fleet rather than one corpus (#365). It stays rejected,
and it is now rejected on evidence rather than on a single measurement.

*Citation identity* — two pooled laws quoting the same sentence of the manual —
finds 30 pairs in 11,971 pooled laws, and it is wrong in both directions. Its
precision is about half: Georgia's GA-033 and GA-034 both ask what a sign warns
is in the road, which is one fact twice, but Colorado's CO-011 and CO-012 ask
who may supervise a permit driver and whether an out-of-state relative may,
which is two. Its recall is worse than that: it reports **zero** for Virginia,
the one corpus with a documented duplicate, because a restatement is usually
written from a different sentence. A signal that misses the case it was built
for is not a weak signal, it is the wrong one.

*Answer identity* — two pooled laws in the same concept with the same correct
answer — is the one that looks most promising and is the most thoroughly wrong.
It finds 48 groups, and **every one of them is two different rules that happen
to share an answer.** 63% share a number, which is the whole problem stated
plainly: driving law is a list of distinct duties that land on the same figures.
Pennsylvania may not pass within 100 feet of an intersection *or* of a bridge;
New Jersey may not park within 50 feet of a stop sign *or* of a railroad
crossing; Idaho's low beams must light 100 feet ahead and its brake lights be
visible 100 feet behind. The 37% that share no number are no better — two
offences that both cost a year, two conditions that both want low beams, two
violations that both revoke the licence. A guard on this would be red on
twenty-four corpora on the day it shipped with nothing true in it.

One pair out of the 48 is worth a human look rather than a verdict: Kentucky's
KY question on average perception time and the one on average reaction time
give the same answer, three quarters of a second to one second. That is either
one fact asked twice or a distinction the manual draws and the corpus flattened.
It is named here rather than counted as a hit, because the point of this
paragraph is that the counting does not work.

**So the decision stands, and what generalises is the reason.** Whether two
cards teach the same fact is a question about meaning, and every cheap proxy
for it — shared words, shared source sentence, shared answer — is a property
this corpus has for legitimate reasons all over. Reading is still the control.
What a future attempt should not do is re-run one of these three and conclude
it is new.

Then **fix what it finds and send it back to re-verify.** The second pass is
not ceremony: adding West Virginia, the first pass found a citation pointing at
the wrong page, and the fix for it moved a different citation onto a page that
did not carry its sentence. A fix is a change, and a change is unverified.

Where the agent is wrong, say so and show the source rather than quietly
complying — one finding against West Virginia was mistaken, and the handbook
settled it. The point of the exercise is a corpus that can be checked, not a
corpus that agrees with the last thing it was told.

## Phase 10 — record the voice, last of all

A state ships perfectly well without this. `src/read-aloud.ts` asks each state
whether it has recordings and falls back to `speechSynthesis` where it does not,
so an unrecorded state is read aloud by the browser exactly as every state was
before Maryland. The completeness test skips a state with no `index.json`
entirely, so nothing here blocks Phase 8. **Do it anyway, and do it here, at the
end.**

**Last, because every correction costs another render.** Each clip is paid for
by the character, and a law rewritten after Phase 9's check renames its clip and
orphans the recording. Rendering before the facts are verified means paying for
the same sentences twice — and paying, at 60,000 to 150,000 characters a state,
is not a figure of speech.

```sh
npm run voice -- --dry-run           # characters and cost. Writes nothing
npm run voice -- --state PA          # render one state
npm run voice -- --state PA --prune  # and delete clips no corpus string asks for
```

Idempotent by presence on disk, so an interrupted run is safe to repeat and a
one-word fix later costs one clip rather than a state. What it makes:

- `public/audio/<STATE>/<hash>.mp3`, one per unique spoken string —
  `law`, `question`, `why` and each `answer`, plus the four number words the
  answers are read out with
- `public/audio/<STATE>/index.json`, the manifest the completeness test reads

Expect roughly **1,100–2,300 clips and 40–90 MB** for a state the size of the
ones already here. That is committed to the repository, and git keeps every blob
forever, so a re-render is additive and permanent.

**Do not change the render settings for one state.** Voice, model, speed and
bitrate are fixed at the top of `scripts/voice.ts` and are the whole product's,
not a per-state choice — a learner who switches states mid-study should not
notice. The generator refuses to append to a directory recorded with different
settings rather than silently mixing two voices, which is inaudible in any one
clip and obvious across two.

**Once a state is recorded, its corpus is held to it.**
`tests/unit/audio-clip.test.ts` stops skipping and starts requiring that every
spoken string has a clip. From then on, editing a law without re-running the
generator is a red build rather than a card that has quietly gone silent — which
is the point, and is why the clip's name is the hash of what it says rather than
something written down beside it.

An API key is needed: `ELEVENLABS_API_KEY` in `.env.local`, which is gitignored.
The script is run by hand and never in CI, because a workflow that can spend
money is a workflow that eventually will.

## Honesty, which is the whole job

An agent writing two hundred laws will be tempted to invent numbers, because
they are the fastest thing to write and the hardest to notice. A wrong speed
limit or BAC threshold teaches a learner to fail the real test.

`metadata.factCheck` exists for exactly this: it records how many laws contain
a figure, names which were checked, and says plainly what it does not cover. Do
the same. **Numbers are the falsifiable subset — check them against the manual,
cite them by page, and record what you did not check.** Claiming a corpus is
verified when it is not is worse than shipping it with the gaps named. Keep the
counts true, too: Maryland's `factCheck` said "62 of 201 laws" while the corpus
held 221, because prose in `metadata` is not checked against the data the way
the `conceptModel` counts in Phase 6 are, and it drifted exactly as they would
have.

**Off-syllabus law is the same failure one level up, and it is harder to see.**
An invented number is at least false; a law lifted from the statute is true,
citable, and still wrong to put in front of a learner, because it costs them
study time against an exam that will not ask it. It survives every contract in
`tests/unit/`, it survives a careful reading, and it survived four states. The
only thing that catches it is Phase 0's rule at the moment of writing and Phase
9 item 8 afterwards. **If you cannot point at the page, do not write the law.**
