# What happens if: whole sections, the court's schedule, the state's own pages, and an answer a sixteen-year-old would read

**2026-10-11: phase 4 is the pull request on branch `state-chips`** (decisions 21–27, criteria 20–26, guards 15–20, and the free-chips criterion Joel added the same day). Phases 1–3 are live (deploy/20261011-1818).

**2026-10-11: phase 3 is the pull request on branch `what-happens-if-3`** (decisions 14–18, criteria 15–19, guards 11–13, with decisions 19 and 20 as they apply). Phases 1 and 2 are live (#794, #795).

**2026-10-11: phase 2 is the pull request on branch `what-happens-if-2`** (decisions 9–13, criteria 9–14, guards 7–10).

**2026-10-10: phase 1 is the pull request on branch `what-happens-if-1`** (decisions 1–8, criteria 1–8, guards 1–6 and 14), live since deploy/20261011-0234.

branch: what-happens-if
slug: what-happens-if

Written 2026-10-10, the evening all five trusted-by-date phases went live.
Joel asked the box "what happens if I get pulled over and I don't have my
license with me?" and got, for Texas, "you are required by law to display
your driver license when an officer asks for it … a first conviction carries
a fine of up to $200", and for Maryland, "Maryland law requires every driver
to have their license with them. The laws given here do not state the
penalty." Both are the rule and a fine. Neither is what happens. The answer a
learner wanted was two sentences: in Texas, *you'll get a ticket with a fine
of up to $200, but if you bring your valid license to court the charge is
dropped*; in Maryland, *the officer looks you up by name and date of birth,
and if you're licensed you'll usually get a $50 ticket you can pay by mail,
with no points and no court date.*

Joel's brief, in his words: a pattern for fetching authoritative data to
answer the random ad hoc questions a teenager might ask, for every state;
ingest it; and make sure the prompts in the pipeline produce answers that are
concise and targeted for a teen. "They want an answer in a couple sentences,
that is all, boiled down." Not lawyers.

The pattern this plan builds on is that **the statute section number is the
join key**. What *happens* is spread over three bodies in every state, and all
three are organised by the section the code uses: the code itself holds the
duty, the penalty range and any way out (Texas § 521.025(a)–(f): the duty, the
officer's power to stop you for it, the fine, the defence if you produce the
license in court, the $10 fee when it is dismissed that way); the court's or
DMV's fine and points schedule holds the figure a learner actually pays and
whether they must appear (Maryland's DC-CR-090 lists "16-112(c) Fail to
Display License on Demand … $50", payable; § 16-402 gives it no points); and
the DMV's and court's own pages hold the process that no section states (what
a ticket means, how soon you can retake the test, what a provisional-license
conviction does). Once retrieval has found the section, which it does today,
the rest is a lookup, not a search. Three phases, each one PR through the
implement skill, in this order:

- **Phase 1 — the section, whole; the answer, for a teen.** Give the model
  every subsection of a section when any of them is retrieved; teach the
  prompt the shape of a "what happens if" answer and the register of every
  answer; teach the rephraser to search for consequences; twelve eval cases of
  this shape. No new data. This alone fixes Texas.
- **Phase 2 — the number.** A `penalties` table keyed by state and section,
  harvested from each state's schedule where one exists and from the code's
  own range where not, dated and refreshed like the laws, joined into the
  answer as a cited row. This fixes Maryland.
- **Phase 3 — the process.** A registry of about six official pages per
  state, harvested into dated, quote-checked rows that join the state's
  retrieval pool, for the questions no section answers: how soon can I
  retake, how long do I hold the permit, what happens to a provisional
  license, what a ticket means.

## What is already true, so nobody re-derives it

1. **Every state's vehicle code and manual are in the `laws` table** (172,486
   rows, all dated, `as_of` since #782), one row per subsection, with a
   `citation` whose text before " — " is the section reference in the
   state's own style: `Md. Code, Transp. § 16-112(b)`, `Tex. Transp. Code
   § 521.025(d)`, `75 Pa.C.S. § 1511(a)`, `Cal. Veh. Code § 12951(a)`, `Fla.
   Stat. § 322.15(1)`. The reference with its trailing parenthesised parts
   removed is the section, in every state. Ids do not carry the section
   uniformly (`MD-C-16-112-b`, `TX-C-521.025-c-1`, `NC-C-20-137.1-a-p2`), so
   the citation, not the id, is where the key comes from.
2. **The state path hands the model three or four laws** after
   `chooseLaws` reranks a pool of 24 or 32 (`worker/src/law-rerank.ts`), and
   each row competes on its own words. For the Texas question the pool held
   § 521.457 (driving while invalid, a different offence) and manual entries,
   and none of § 521.025's six subsections; the Maryland pool held
   § 16-112(b) alone and the model was given (b) alone.
3. **The prompt already asks for brevity but not for a teen.** `RULES.roadLaw`
   (`worker/src/learner-ask.ts`) says "in at most two sentences", "write
   figures in digits", "do not write page or section numbers"; it also says
   "if no law given answers the question … leave answer empty", which is the
   origin of "the laws given here do not state the penalty". `NATIONWIDE_RULE`
   allows five sentences. `MAX_ANSWER_CHARS = 600` is the checker's cap and
   `road-law:overlong` the refusal (#792 is the index path crossing it one
   run in three on the front-seat question).
4. **Fine and points schedules are not in the code for most states.**
   Maryland's § 16-112 has no penalty subsection; the $50 is the District
   Court's preset fine (DC-CR-090, Rev. 10/2026, effective 1 October 2026,
   `https://www.mdcourts.gov/sites/default/files/court-forms/dccr090.pdf`),
   "payable" there against "MA" (must appear) for § 16-101 driving without a
   license; the points are § 16-402, which lists driving while not licensed
   at 5 and failing to display at nothing. Texas puts the range in the
   section itself (§ 521.025(c)) and local courts set the amount within it.
   Some states carry the whole schedule in statute (Colorado § 42-4-1701,
   Florida § 318.18 are the known cases, to verify when harvested).
5. **Source registries with a retrieved date already exist and are the
   pattern to copy:** `src/assets/drivers-manuals/SOURCES.json` (one entry per
   state: source, sourcePage, edition, agency, retrieved) and
   `resource/statutes/sources/<XX>/SOURCES.json`; `npm run statutes:refresh`
   re-fetches and diffs monthly and `/refresh-codes` is the skill. A quote
   check against the fetched text is how a citation is verified at authoring
   time (memory: verify citations at authoring time).
6. **The eval** (`scripts/learner-ask-eval.json`, 133 cases, `--state XX`
   while iterating, `--all --store` once per PR, batched at half price) scores
   `scope`, `contains` and `cites`. It has no case of the "what happens if"
   shape and no check on register.
7. **The live log is 39 questions**, nearly all our own hydrant tests, so the
   teen question families below are seeded from the GDL rules and the
   manuals, not mined; the log is re-read when traffic exists.
8. **Chips** (`resource/chips-answers.json`, 83 of 98, #791) are stored
   answers written under today's prompt. They are checked offline against the
   chip's topics and corpus hash, not against the prompt, so a register change
   does not invalidate them by test; it does make them read differently from
   the live box until rebuilt.
9. **Spend rules** stand: `--state XX` while iterating, the whole eval once
   per PR, one `chips:build` per register change, one live REST caller at a
   time, nothing in `npm test` calls a model.

## Decisions — flip any in the PR

### Phase 1 — the section, whole; the answer, for a teen

1. **A `section` column on `laws`**, derived at `laws:store` time from the
   citation's reference with its parenthesised tail removed (`Md. Code,
   Transp. § 16-112`, `Tex. Transp. Code § 521.025`), null for manual rows;
   indexed with `state`. `scripts/laws-store.ts` writes it; the hash that
   decides a re-push includes it. Applied to production by hand before the
   worker: `ALTER TABLE laws ADD COLUMN section TEXT`, `CREATE INDEX … ON
   laws(state, section)`, then `npm run laws:store -- --push --all` once.
2. **Whole sections for the model.** After `chooseLaws`, every statute row
   chosen brings its section's other subsections (`SELECT … WHERE state = ?
   AND section = ?`, through `lawsById`'s neighbour `lawsBySection`), in
   their order, up to 12 rows per section and 40 in all; the chosen rows
   stay first. The prompt is told, once, "a section's other subsections are
   given with the one that matched, so a penalty or a defence in the same
   section is visible: use them". Manual rows are unchanged. Nationwide is
   unchanged in this phase (its rows are verdict laws, already chosen per
   state).
3. **The register, for every road-law answer.** `RULES.roadLaw` and
   `NATIONWIDE_RULE` gain, in these words or better: *Write for a
   sixteen-year-old who asked a friend who knows: plain words, "you", the
   figure once, no law names or numbers in the sentences (the app shows them
   underneath).* The "leave answer empty" rule narrows: it applies when no law
   given touches the question; when a law states the duty and none states the
   penalty, answer the duty in one sentence and stop, never "the laws given
   here do not state".
4. **The shape of a consequence question.** When the question asks what
   happens, what if, will I, do I have to, or how much (the *consequence
   shape*), the answer is at most three sentences in the order things happen:
   what the officer or court does, then the cost (fine, points, whether you
   go to court), then the way out if a law given states one (produce it in
   court and it is dismissed). The shape is named in the prompt with the
   Texas example as the worked case. Spanish the same.
5. **The rephraser searches for the consequence.** `law-rephrase.ts`'s
   instruction gains: for a consequence-shaped question, one search in the
   law's words for the duty and one for its penalty or defence ("fine",
   "offense", "defense to prosecution", "produces in court", "points",
   "suspend"), so the pool holds the section's penalty subsections and not
   only its duty.
6. **Twelve eval cases of the consequence shape**, in
   `scripts/learner-ask-eval.json`: MD, TX, CA, FL, PA × "pulled over without
   my license" and "caught texting while driving", plus MD and TX "drove past
   my provisional curfew"; three with Spanish twins. Each `contains` the
   figure the state's code states (TX "200"; CA § 12951 and § 40611's
   dismissal; FL § 322.15) and `cites` the section's row ids; Maryland's
   expects the duty and, until phase 2, no invented fine. Scores before and
   after phase 1 go in the PR. A new `register` verdict in the eval's table:
   sentences ≤ 3 for the consequence shape and ≤ 2 otherwise, and no "§",
   "p.", "page" or a section number pattern in the shown answer; a miss is a
   miss.
7. **Chips rebuilt once** after the register change (`npm run chips:build`
   re-asks only what is missing or stale, so the rebuild is forced by a
   `--register` flag that re-asks every stored chip), one batch; the
   before/after count in the PR.
8. **Out-of-scope consequence questions are one honest sentence.** "Will my
   parents find out", "will my insurance go up", "can the cop search my car"
   are not road law: the prompt's scope rule gains them as examples whose
   answer names who decides (your insurer; the court sends notices to the
   address on the license; that is a question for a lawyer) in one sentence
   with no law cited, scope `other`. Three eval cases expect that scope.

### Phase 2 — the number

9. **A `penalties` table**, `worker/schema.sql`:
   `penalties (state TEXT, section TEXT, offence TEXT, fine_text TEXT,
   fine_min_cents INTEGER, fine_max_cents INTEGER, points INTEGER, appear
   TEXT CHECK (appear IN ('payable','must-appear','court-sets')), source_url
   TEXT, source_title TEXT, as_of TEXT, quote TEXT, PRIMARY KEY (state,
   section, offence))`. One row per section the schedule lists; `offence` is
   the schedule's own wording. Applied by hand before the worker.
10. **A registry per state, `resource/penalties/SOURCES.json`**, one entry per
    state with `kind`: `schedule` (a statewide prepayable fine schedule
    exists: url, title, agency, retrieved, and how it is keyed), `code` (the
    fines are in the code's own sections: the section that holds them), or
    `local` (local courts set the amount within the code's range: the row
    carries the range and `appear: 'court-sets'`). The build's first step is
    the discovery pass that fills this file, one state at a time, from each
    state's court rules and DMV pages; the candidates known tonight, every
    one **to verify before it is written**: Maryland DC-CR-090 (confirmed
    above); California's Uniform Bail and Penalty Schedule; Virginia's Uniform
    Fine Schedule (Rule 3B:2); Washington's IRLJ 6.2 monetary penalty
    schedule; New Jersey's Statewide Violations Bureau schedule;
    Massachusetts's schedule of assessments; Connecticut's infractions
    schedule; Oregon's presumptive fines (ORS 153); Colorado's and Florida's
    in-code schedules; Michigan's points in MCL 257.320a; Ohio's in ORC
    4510.036; Georgia's in OCGA 40-5-57. A state whose schedule cannot be
    found in the pass is `local`, and the PR lists them by name.
11. **`npm run penalties:fetch -- XX|all`** (`scripts/penalties/fetch.ts`):
    fetches the registered source, extracts rows keyed by section (a PDF
    table, a statute's list, or an HTML table — one small adapter per
    source shape, chosen by the registry's `format`), verifies each row's
    `quote` is a substring of the fetched text (a row that fails is not
    written and is named), writes `resource/penalties/<XX>.json`, and
    `--push` upserts the table. Deterministic; no model. `npm run
    statutes:refresh` gains a penalties pass that re-fetches every
    registered source and reports changed rows, and `/refresh-codes` says so.
12. **The join, as a cited row.** When a statute row given has a `penalties`
    row for its `(state, section)`, the worker appends a law
    `{ id: 'MD-P-16-112-c', kind: 'penalty', law: 'Fail to Display License
    on Demand: $50, payable by mail, no points.', citation: 'District Court
    of Maryland, DC-CR-090 (Rev. 10/2026) — "16-112(c) Fail to Display
    License on Demand $50.00"', asOf }` to the laws given, so the figure is
    grounded by `checkLawAnswer` exactly as a statute's is and the citation
    shows beneath the answer with its date. The prompt is told what a row
    marked penalty is. For `court-sets` the row says "a fine set by the
    court within $X to $Y" and names no single figure. Points come from the
    schedule where it lists them, else from the code's points section where
    one exists (Maryland § 16-402 is already a law row; the fetch reads it),
    else null and the answer says nothing about points.
13. **Six more eval cases** whose `contains` is the schedule's figure (MD
    "50"; the others as discovered), scored before and after.

### Phase 3 — the process

14. **Six families per state:** `gdl-rules` (passengers, hours, phone for a
    permit or provisional holder), `provisional-sanctions` (what a conviction
    or crash does to a provisional license), `test-and-retake` (how soon,
    how many tries, what it costs), `permit-holding` (how long before the
    road test, supervised hours), `insurance-minimums` (whose policy, the
    minimums), `ticket-procedure` (what a citation means, pay or contest,
    the days allowed). `resource/process/SOURCES.json`: per state, per
    family, `{ url, title, agency, retrieved }`, the DMV's or court's own
    page and nothing else (no lawyer sites, no aggregators).
15. **`npm run process:fetch -- XX|all`** fetches each page, asks Haiku for
    at most five verbatim passages that state the family's rule (a passage
    that is not a substring of the fetched text is dropped and named, so an
    invented quote cannot be stored), and writes them as `laws` rows with
    `kind: 'process'`, ids `XX-R-<family>-<n>`, `question` the family's
    question, `citation` "<agency> — <page title> — '<passage>'", `as_of`
    the retrieved date, then `--push`. They join the state's BM25 and vector
    pools like any law (`laws:embed` learns the new ids), and the prompt
    names them "the state's own page", preferred over the manual for process
    and never for the rule of the road.
16. **A family is also fetched by key.** When the rephraser names a family
    for the question (its instruction gains the six names and what they
    cover, as the topic chooser's has families), the family's rows for the
    state are added to the pool before reranking, so "how soon can I retake
    the test" never depends on the page's words matching the learner's.
17. **Refresh and report** with the statutes: a changed page is a row in the
    monthly report, applying it is `process:fetch XX` by a person, as for a
    code.
18. **Eight eval cases** across the families and four states, with
    `contains` from the page and `cites` the `XX-R-` id; Spanish twins for
    two.

### Across the phases

19. **Deploy order.** Each phase: schema statements by hand (phase 1's
    `section` column, phase 2's table), then `laws:store --push --all`
    where the rows changed, then the worker, then Pages. The eval slice for
    the five states before and after, the whole eval once per PR.
20. **The pattern is written down once**, in `docs/how-to-build-laws.md` or
    beside it: the section is the key; the three source classes; what each
    phase's registry entry needs; how a new state is added to each (the
    `/add-code` skill gains the two fetches beside `laws:store`).

## The change

### Phase 1
- `worker/schema.sql`: `section` on `laws`, index. `scripts/laws-store.ts`:
  derive and write it; `tests/unit/laws-store.test.ts` covers the derivation
  for the five citation styles above and a manual row (null).
- `worker/src/law-nationwide.ts` (`lawsBySection`), `worker/src/learner-ask.ts`
  (expansion after `chooseLaws`; `RULES.roadLaw`, `NATIONWIDE_RULE`, the
  consequence shape, the narrowed empty-answer rule, the out-of-scope
  examples), `worker/src/law-rephrase.ts` (consequence searches).
- `scripts/learner-ask-eval.ts`: the `register` verdict; `scripts/learner-ask-eval.json`: 15 cases.
- `scripts/chips-build.ts`: `--register`.
- Tests: `tests/unit/learner-prompt.test.ts` (the rules present, the
  expansion shown in section order with the matched row first),
  `worker/tests/learner-ask.test.ts` (expansion through workerd against a
  seeded `laws` table: two subsections of one section given → the model
  sees all six; a manual row → nothing added; the cap), the eval.

### Phase 2
- `worker/schema.sql`: `penalties`. `scripts/penalties/fetch.ts`, adapters
  under `scripts/penalties/formats/`, `resource/penalties/SOURCES.json` and
  `<XX>.json`; `scripts/statutes/refresh.ts` penalties pass;
  `.claude/skills/refresh-codes/SKILL.md`, `.claude/skills/add-code/SKILL.md`.
- Worker: the join in `learner-ask.ts` (a `penaltiesFor(state, sections)`
  dependency like `lawsById`), the prompt line.
- Tests: unit on each adapter against a fixture page (the Maryland PDF's
  text, a statute list, an HTML table), unit on the quote check, workerd on
  the join (a seeded row appears as a cited law; `court-sets` names a range
  and no figure), the eval.

### Phase 3
- `scripts/process/fetch.ts`, `resource/process/SOURCES.json`; `laws:embed`
  for the new ids; the rephraser's families; the prompt line.
- Tests: unit on the passage check (a passage not in the page is dropped),
  workerd on fetch-by-family (a family named → its rows in the pool before
  the reranker), the eval.

## Acceptance criteria

**Phase 1.**
1. Every statute row in the production `laws` table has a `section` equal to
   its citation's reference without its parenthesised tail; every manual
   row's is null; `npm run laws:store -- --push --all` after the column
   reports every row re-sent once and none after.
2. For a Texas learner asking what happens if they are pulled over without
   their license, the model is given every subsection of § 521.025 that the
   table holds, (c) and (d) among them, and the shown answer names the fine
   and that producing the license in court is a defence, in at most three
   sentences, with no section number in the sentences.
3. For a Maryland learner asking the same, the shown answer states the duty
   to carry and show the license in one or two sentences and does not say
   that the laws do not state the penalty.
4. A chosen manual row brings no neighbours; a chosen statute row brings at
   most 12 of its section and the laws given number at most 40.
5. Every road-law answer in the eval has at most two sentences, or three for
   the consequence shape, and no "§", "p.", "page" or section number pattern:
   the `register` verdict passes for every case that passes otherwise.
6. The 15 new cases score at least 12 of 15 after phase 1, and the whole
   eval does not fall below its score before the change (132 of 133 on
   2026-10-10, #791's comment).
7. "Will my parents find out" for any state is answered in one sentence that
   names who sends what to whom, cites no law, and is scope `other`.
8. The chips are rebuilt under the new prompt, every stored answer still
   passes `tests/unit/chips.test.ts`, and the count stored is reported
   against 83.

**Phase 2.**
9. `resource/penalties/SOURCES.json` has an entry for all 51 states, each
   `schedule`, `code` or `local`, each with a URL that answers 200 at build
   time and a `retrieved` date; the PR lists the `local` states.
10. `npm run penalties:fetch -- MD` writes a row for `Md. Code, Transp.
    § 16-112` with `fine_text` "$50.00", `appear` "payable", `points` 0, a
    `quote` that is a substring of the fetched DC-CR-090 text, and `as_of`
    the fetch date; run again it changes nothing and says so.
11. A row whose quote is not in the fetched text is not written and is
    named in the output.
12. The Maryland answer to the no-license question names $50, says it can
    be paid without going to court and that it carries no points, in at most
    three sentences, with the schedule's citation and date shown beneath.
13. For a `court-sets` state the answer gives the range and says the court
    sets the amount; it names no single figure.
14. `npm run statutes:refresh` reports a changed penalty row when a source
    changes (stub fetcher) and nothing when it does not.

**Phase 3.**
15. `resource/process/SOURCES.json` names an official page for every state
    and family, or `none` with a reason, and the PR lists the `none`s.
16. `npm run process:fetch -- MD` stores at most five passages per family,
    each a substring of the page, as `kind: 'process'` rows with the page's
    citation and date; a passage not in the page is dropped and named.
17. "How soon can I retake the test" for a state with a `test-and-retake`
    page is answered from that page's row, in at most two sentences, with
    the page cited and dated beneath, whether or not the learner's words
    match the page's.
18. The rule of the road ("how far from a hydrant") is never answered from a
    process row when a manual or code row is given.
19. The 8 new cases score at least 6 of 8; the whole eval does not fall.

## How this fails silently

1. **A section key that splits one section in two.** Unit on the derivation:
   `Tex. Transp. Code § 521.025(c)(1)` and `§ 521.025(d)` share a key;
   `Md. Code, Transp. § 16-112(b)` and `§ 16-112(c)` share one; a manual
   citation (`p.30 (printed)`) yields null. Mutation: strip only the last
   parenthesised group → (c)(1) keys differently from (d) → red.
2. **Neighbours that push the matched row out.** Workerd: two chosen rows
   and a six-row section → the matched rows are first in the prompt, the
   rest follow in order. Mutation: append chosen rows after their section →
   red on the order assertion.
3. **The cap ignored.** Workerd: a 30-subsection section → 12 given; three
   such sections → 40 in all. Mutation: remove the per-section slice → red.
4. **The empty-answer rule still firing on a stated duty.** Eval case 3
   (Maryland, no-license): `contains` a phrase of the duty and a `not`
   assertion on "do not state"; mutation: restore the old sentence in the
   prompt → the model says it → red. (A live-model guard; recorded as the
   measurement, six runs.)
5. **Register drift.** The eval's `register` verdict: a case whose answer has
   four sentences or a "§" fails. Unit on the verdict function with three
   fixtures (two sentences, four sentences, a "§"); mutation: count only
   full stops → "¿Qué pasa? Pagas $50." miscounts → red.
6. **The consequence shape leaking into other questions.** Eval: "how far
   from a hydrant" stays two sentences. Covered by guard 5's threshold per
   shape; mutation: apply the three-sentence allowance to every question →
   the hydrant case with three sentences passes → red on the fixture.
7. **A penalty row with a quote from nowhere.** Unit on `penalties:fetch`
   with a fixture whose row text is altered → the row is not written and is
   named. Mutation: skip the substring check → written → red.
8. **A penalty joined to the wrong section.** Workerd: rows for § 16-112 and
   § 16-113 seeded; a § 16-113 statute given → only its row appended.
   Mutation: match on the section's prefix → both → red.
9. **A `court-sets` figure stated as the fine.** Workerd on the join's law
   text: a `court-sets` row renders a range and the words "set by the
   court"; mutation: render `fine_min` alone → red. And the eval case for
   that state `contains` the range's two figures.
10. **A refresh that cannot see a changed schedule.** Unit with a stub
    fetcher returning a changed fine → one changed row in the report;
    unchanged → none; a fetcher that throws → "unreachable", never
    "unchanged". Mutation: catch and report unchanged → red.
11. **A process passage the page does not say.** Unit: a passage with one
    word changed is dropped and named. Mutation: compare after collapsing
    whitespace *and* case-folding away a figure → a "15 days" / "10 days"
    swap passes → red.
12. **A process row answering the rule of the road.** Eval case 18 and a
    workerd test: a process row and a code row both in the pool for a
    hydrant question → the code row is given first and the prompt's
    preference line is present. Mutation: drop the preference line → the
    prompt test red.
13. **The family fetched by key for the wrong state.** Workerd: MD and VA
    rows seeded, a VA learner names `test-and-retake` → only VA rows added.
    Mutation: query by family alone → red.
14. **Chips not rebuilt after the register change.** Unit:
    `resource/chips-answers.json` carries a `promptHash` of the rules it was
    built under and the test compares it with the current rules' hash; red
    until `chips:build --register` has run. Mutation: hash the rules without
    the new sentence → stale file passes → red on the fixture.

## Non-goals

- No change to which laws a state question *retrieves* beyond the section
  expansion and the consequence searches: no new weighting of BM25 against
  vectors (the next lever named in the ask-rephrase checkpoint, measured
  separately).
- No local-court fine amounts: a `local` state gets the code's range and the
  words "set by the court", never a city's bail schedule.
- No legal advice: no "you should", no "a lawyer would", no prediction of what
  a judge will do. A way out is stated only when a law given states it.
- No new topics or chips in this plan (phase 1's rebuild re-asks the existing
  pool).
- No change to the nationwide answer's content in phase 1 beyond the
  register; phases 2 and 3 do not join penalties or process into nationwide
  answers (a comparison of fines across states is a topic for `/add-code`
  judging, not this).
- No mining of the question log until it holds real traffic; the families
  above are seeded, and the plan says so.

## Open questions, decided for now

- **Which states have a statewide schedule** is not known tonight beyond
  Maryland; decision 10 makes the discovery pass part of phase 2's build and
  makes `local` an honest outcome, so the phase cannot stall on a state.
- **Whether process extraction may use a model** (decision 15): yes, Haiku
  chooses passages, because 306 pages by hand is the work of a week; the
  substring check is what makes the output trustworthy, and it is the same
  check the statutes use.
- **Whether the register applies to the paid test's own Ask (the learner KB
  path)**: no; those answers are routed to written entries already in the
  register. Only road-law answers change.

## Phase 4 — state chips: three questions a teen would ask, answered once per state and served free

Added 2026-10-11 after Joel re-tested the high-beam answer on his phone and
saw the nationwide chips under the box: "we should have chips for the state
level as well." Ranked above the nationwide chips in value: the state path is
where learners are, a teenager does not know what to ask, a stored answer
costs nothing per tap and never touches the weekly limit, and the same
answers make a per-state facts page in the exact "what happens if I … in
Maryland" phrasing people search for.

### Decisions — flip any in the PR

21. **The pool.** `resource/state-chips.json`: about twelve questions, each
    with `id`, `family` (one of phase 3's six, or `consequence` for the
    "what happens if" shape, or `rule`), and `question` in English and
    Spanish, worded as a sixteen-year-old would type them: pulled over
    without my license; caught texting; past my curfew; how many friends in
    the car; how soon can I retake the test; how long do I hold the permit;
    what insurance do I need; what happens if I crash my parents' car; how
    far from a hydrant; can I use my phone at a red light; the fine for
    speeding in a school zone; what happens if I'm caught driving alone on a
    permit. Every one is answerable from the state's laws, schedule or pages;
    none is "will my parents find out".
22. **Answered through the state pipeline, exactly as the box answers**, by
    `npm run chips:build -- --states [XX…]`: `answerLearner` with the state
    chosen, the published laws file, the production `laws`, `penalties` and
    page rows read over the eval's `--store` path, Haiku rephrasing and
    reranking, Opus writing, `checkLawAnswer` deciding, then the stored
    answer's own harder checks (`scripts/chips.ts`, extended for state
    answers: every figure grounded in a cited row's text from the committed
    corpus, penalties or process files; at most two sentences; no law name in
    the prose). Batched. Written to `resource/state-chips/<XX>.json`, one file
    per state so a phone loads only its own; `--states all` is 51 × 12 × 2.
    A chip that fails for a state is simply absent for that state, named in
    the output, and the facts page skips it.
23. **Stale by source, not by date.** Each stored answer records the ids it
    cited and the `as_of` of each; `tests/unit/state-chips.test.ts` is red
    for a state whose cited rows no longer match the committed corpus,
    penalties or process files (text or date), and the monthly refresh's
    report names the states whose chips need a rebuild; `chips:build --states
    XX` re-asks only what is missing or stale. `/add-code` and `/add-state`
    gain the step.
24. **Under the box, three for the chosen state**, when Nationwide is not
    ticked, drawn the way the nationwide chips are (different each load,
    never one already tapped on this device, `src/chips.ts` generalised by
    state), with the same heading in the register the nationwide one has. A
    tap shows the stored answer in the answer card with the folded sources
    line and `Show the law`, counts `chip_tapped { id, state }`, costs no
    question, and leaves the box ready for a follow-up, which goes live.
25. **A facts page per state**, `/drivers/XX/facts/`, prerendered from the
    state's file like `/drivers/laws/facts/`: the question as the heading,
    the stored answer, the sources line, the as-of; linked from
    `/drivers/XX/laws/` and the state's landing page, in the sitemap, with
    one sentence for search saying any question about XX's driving law can
    be asked. Spanish under its language path as the other pages are.
26. **Cost, once and then only on change.** 51 × 12 × 2 ≈ 1,224 Opus
    answers in one batch at half price plus Haiku's rephrase and rerank per
    question: on the order of $20 once. The PR records the actual spend from
    the batch's usage. A rebuild after a monthly refresh re-asks only the
    chips whose cited rows changed.
27. **Deploy order.** No schema. Pages only, after the build; the worker is
    unchanged unless the chip answer card needs a field the API does not
    send (say so in the PR).

### Acceptance criteria

20. `resource/state-chips.json` holds at least twelve questions in both
    languages, each with a family, and the pool test refuses a question with
    a figure in it or a state's name.
21. `npm run chips:build -- --states MD` writes `resource/state-chips/MD.json`
    with a stored answer for every chip that passes, each at most two
    sentences, every figure grounded in a cited row the state's committed
    files hold, and names each chip it refused with the reason; run again
    with nothing changed it writes nothing.
22. With Maryland chosen and Nationwide unticked, three chips show under the
    box; a tap shows the stored answer with the folded sources line, sends
    nothing to `/api/ask`, leaves the week's counter unchanged, and the chip
    is not offered again on that device; ticking Nationwide swaps them for
    the nationwide three.
23. `/drivers/MD/facts/` is prerendered with every stored Maryland chip as a
    heading, answer and sources line, is linked from `/drivers/MD/laws/`,
    and is in the sitemap; a state with no stored chips has no page and no
    link.
24. A stored answer whose cited row changed text or date in the committed
    files turns `tests/unit/state-chips.test.ts` red for that state and no
    other, and the refresh report names the state.
25. The build runs for all 51 states in both languages in one batch; the PR
    records how many chips each state stored and the batch's spend.
26. Nothing in the nationwide chips, the facts page at `/drivers/laws/facts/`
    or the weekly limit changes.
27. (Added by Joel, 2026-10-11, in this PR.) A learner sees at a glance that
    chips are free and unlimited and that a typed question is what counts:
    the heading over either row says so ("Free answers for Maryland — tap as
    many as you like", "Free facts across the states — tap as many as you
    like"), every chip carries the one muted word "free", and the box's label
    reads "Ask your own question — counts toward this week's 10, or spends a
    token" (3 with Nationwide ticked), in English and Spanish; a chip tap
    leaves the counter beside the box unchanged and a typed question changes
    it.

### How this fails silently

15. **A state chip answered from another state's law.** Unit on the stored
    file: every cited id's state prefix is the file's state; mutation: drop
    the prefix check → a planted `TX-` id in `MD.json` passes → red.
16. **A figure the chip's own sources do not hold.** Unit: a stored answer
    with "$75" where the cited penalty row says "$50" is refused; mutation:
    ground figures against the whole corpus instead of the cited rows → red.
17. **A chip counted as a question.** E2E: the counter before and after a
    tap is equal and `/api/ask` is never requested; mutation: record the tap
    as a question → red.
18. **Chips shown for the wrong state.** E2E: choose Maryland, tap a chip,
    change the state to Texas → the three chips are Texas's and the
    Maryland answer card is gone; mutation: cache the chips by device alone →
    red.
19. **A facts page for a state with no chips.** Unit on the prerender: a
    state whose file is absent yields no page and no sitemap entry;
    mutation: emit the page anyway → red.
20. **A stale answer served.** Unit: alter a cited row's text in a fixture
    corpus → the state's test is red and names the chip; mutation: compare
    ids only, not text → red.
21. **A chip read as costing a question.** E2E: the headings, the "free"
    mark and the box's label carry those words in both languages; mutation:
    drop "Free" from the heading → red.

### Non-goals for phase 4

- No new questions answered live: chips are the stored pool only.
- No per-state wording of the pool: one pool, twelve questions, the states'
  answers differ because their laws do.
- No chips on the nationwide path beyond what phase 4 of trusted-by-date
  built.

