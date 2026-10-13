# The whole vehicle code, every state, and the ask box where a visitor can see it

branch: vehicle-code
slug: vehicle-code

Written 2026-10-06. Joel's brief: the site is being promoted as the place to
ask about the written test and the driving law behind it, and the box has to
answer **any** question about a state's driving law — the whole vehicle code,
not a topic list. Maryland (#647) proved the mechanism on nine sections and
fifteen hand-written rules; this ingests the code itself, for every state, one
subagent per state, serially, **each state merged to `main` before the next
starts** (Joel, 2026-10-06).

So it is two phases. **Phase 1 is the implement skill's PR**: the pipeline,
proved on Maryland, plus the ask box's new place and what search is told.
**Phase 2 is the loop**, fifty states one after another, each its own branch,
PR and merge on the local gate — run by a skill Phase 1 creates, `/add-code`,
which Joel starts once Phase 1 has merged.

Three things are true today and set the shape of this:

1. **The box answers from what the repository committed and checked, and
   nothing else.** Every statute quote is found verbatim in a committed copy of
   the official page, pinned by hash; the checker refuses a figure the cited
   text does not state. That stays. Ingesting a code is ingesting its text,
   verbatim, under the same test.
2. **A statute law needs no code to be served.** `retrievalFile` appends
   anything in `resource/statutes/XX.json` with `kind: 'statute'`; the worker
   labels it *(the state's law, not the manual)*; the box renders *Not in your
   manual — <reference>: "<quote>"*. A section of the code chunked into
   subsection-sized laws of that exact shape rides the whole path with no
   worker or box change, and no deploy-order hazard.
3. **The way in is a grey button in the corner.** Measured 2026-10-06: nine
   of the twenty-three questions in the production log arrived with no state
   chosen; no title or description names asking. Sections B and C below are
   that half of the brief.

## Intent

A learner in any of the fifty-one jurisdictions asks the box anything their
state's vehicle code answers — a parking distance, a fine, what counts as a
moped, when a licence is suspended — and reads the rule from the code,
labelled as the law and not the manual, with the subsection quoted. The manual
stays first for what it states. Every section the box can cite is committed,
hashed and quoted verbatim; a state whose official code cannot be fetched is
named in the repository as such, never filled from a mirror.

And the way in is visible: a full-width entry under the site's name on the two
front pages, the chrome button the one coloured control in its row, and search
told the same thing — the landing page's title, and one indexable page per
state that answers the topic questions with the section, so a search for
*how far from a fire hydrant can you park in Maryland* has a page to land on.

## What is already true, so nobody re-derives it

- `scripts/statutes/fetch.ts`: `SECTIONS[code] = { official, extract,
  sections }`; `npm run statutes:fetch -- XX` writes
  `resource/statutes/sources/XX/<file>.txt` and a shared `SOURCES.json`
  (URL, date, sha256). `extractMgaleg` keeps the in-effect text. Only `MD` is
  declared, with nine sections.
- `resource/statutes/MD.json`: fifteen laws `{ id: 'MD-S01', topic, law,
  question, citation: "<Code> § <section>(<sub>) — '<verbatim quote>'",
  source }` for topics on `topics.json` the manual does not state.
- `tests/unit/statutes.test.ts`: quote verbatim in its source; source at its
  hash and under `official`; ids unique; topics known.
- `worker/src/law-retrieval.ts`: `retrievalFile` = manual laws + statute laws
  (`kind: 'statute'`); `retrieve` = BM25 over `law + question + concept`,
  fused with Vectorize's nearest (`NEAR_LAWS = 8`), top `RETRIEVED_LAWS = 8`.
  `withLaws` in learner-ask.ts labels a statute line; `checkLawAnswer` grounds
  figures on `law.law` plus the quote after ` — ` in the citation, so a
  section number grounds nothing.
- `lawsFromPages` fetches `/ask-laws/XX.json` with a one-hour edge cache on
  200. Files are 80–360 KB today.
- `scripts/law-vectors.ts` embeds `retrievalFile` output with bge-m3 in
  batches of 100, one namespace per state; `tests/unit/law-vectors.test.ts`
  is red for any state whose published laws differ from the manifest's hash.
- `src/assets/drivers-manuals/*.pages.txt` were made with `pdftotext`
  (scripts/ne-text.py, hi-text.py), so a PDF source has a precedent.
- The chrome's `AskButton` (src/components/Screen.tsx), `StateSelect`,
  `Landing`, `seo/prerender.ts`, `seo/pages.ts`, `tests/e2e/seo.spec.ts` and
  `tests/unit/seo.test.ts` (175-character descriptions) as named in B and C.

## Decisions — flip any in the PR

1. **"The vehicle code" is every title a licence-holder is bound by.** Rules
   of the road; driver licensing including the graduated rules; vehicle
   equipment and occupant protection; alcohol and drug driving offences
   wherever the state codifies them; duties after a crash; financial
   responsibility and insurance; registration and plates; definitions;
   penalties and points. Excluded: the agency's own organisation, toll and
   turnpike authorities, railroads, aviation, ports, motor-carrier and dealer
   regulation. A state's site module names its titles and says why each is in
   or out. If Joel wants the excluded titles too, that is more sections through
   the same pipe.
2. **The unit the box retrieves is a subsection, cut by a script from the
   committed section text.** `worker/src/code-chunks.ts`: a section splits at
   its top-level labels — `(a)`, `(b)` or `1.`, `2.`, whichever the state
   uses — each chunk carrying the section's catchline as its `concept`; a
   subsection over ~900 characters splits again at the next label or
   paragraph; a section with no labels is one chunk per ~900 characters at
   paragraph boundaries. Chunk text is a verbatim substring of the source.
   Ids `XX-C-<section>-<label>` (`MD-C-21-1003-m`), or `-p<n>` where there is
   no label. One function, shared by the Vite plugin, the embed script, the
   eval and the e2e harness, as `retrievalFile` is.
3. **A chunk is a statute law.** `{ id, topic: '', law: <text>, question:
   '', citation: "<cite> § <section>(<label>) — '<text>'", source }` →
   `kind: 'statute'` through `askStatutes`. The text appears twice in the file
   and once on the wire (gzip folds the repeat); in return the worker, the
   checker, the box and every existing test run unchanged, and a Pages deploy
   that lands before the worker's cannot mislabel anything. A `kind: 'code'`
   with a reference-only citation was the alternative: three small branches
   and a deploy-order hazard, for a smaller file.
4. **Sources per state, one file per section, metadata beside them.**
   `resource/statutes/sources/XX/<file>.txt` as today, hundreds of them, and
   `resource/statutes/sources/XX/SOURCES.json` — moved from the shared file —
   with `{ url, retrieved, sha256, cite: "Md. Code, Transp. § 21-1003",
   heading: "Stopping, standing, and parking prohibited…" }` per file, written
   by the fetch from the site module's listing. ~1–5 MB of text per state,
   ~100 MB in the working tree, a quarter of that packed. Committed, because
   the verbatim test and the build read it offline; R2 with hashes in git was
   the alternative and would put the build on the network.
5. **One site module per state, so states cannot collide.**
   `scripts/statutes/sites/XX.ts` exports `{ official, cite(section),
   titles: [{ id, why }], enumerate(): Promise<Listing[]>, extract(html |
   pdfText, listing) }`. `enumerate` is the one of four shapes the site has:
   a chapter page holding every section (FL, TX, PA, DE, IL); an index page
   listing section URLs (MD, VA, OH, MI, HI, WV); a bulk file (NY's API, CA's
   pubinfo); a PDF per section or chapter (KY, CO), read with `pdftotext` and
   the PDF's own sha recorded. `fetch.ts` becomes the loop: one request a
   second, a named User-Agent, three retries with backoff, and **resumable** —
   a file already present with its hash recorded is skipped unless
   `--refresh`. `statutes:check` re-fetches and reports drift, as today.
6. **A code the script cannot fetch is reported, not worked around.** Only
   the legislature's site or the publisher it designates. A code behind a
   click-through licence (Georgia, Mississippi, Arkansas, Tennessee publish
   through LexisNexis), a JavaScript-only reader, or a site refusing the
   request is **blocked**: no sources, every topic `none` with the reason
   `official site not fetchable: <what>`, the state named in the PR body. No
   mirror (Justia, FindLaw, Casetext), whatever it offers. No hand-written
   fallback in this pass — a hand-written law needs a committed source too.
7. **Coverage stays a committed verdict, and is how "can it answer X in Y"
   is read off the repository.** `resource/statutes/coverage.json`, per state
   per topic on `topics.json`: `{ from: 'manual' | 'statute' | 'code' |
   'none', law: <id>, reason? }`. `npm run statutes:gaps -- XX` runs the
   worker's `retrieve` over the state's full retrieval file for each topic
   question and prints the top three; the subagent reads and writes the
   verdict. A unit test holds every verdict to retrieval (guards 2–3). With
   the code in, most verdicts are `manual` or `code`; a state whose verdicts
   are all `none` is a fetch that got the wrong title, caught here.
8. **Maryland's fifteen hand-written laws stay.** They are better sentences
   than the subsections they quote, and still verified; its code is ingested
   beside them. No other state gets hand-written laws.
9. **Retrieval and the prompt do not change in kind.** `RETRIEVED_LAWS`
   stays 8; a chunk is at most ~900 characters, so the model reads at most a
   page. `withLaws` already says *(the state's law, not the manual)*. The
   system prompt gains one sentence: prefer the manual where it states the
   rule; use the code for what the manual does not state or for the law as
   written; say "<State> law" when citing it. BM25 runs over a few thousand
   documents in the worker, ~50 ms; the file is edge-cached for an hour.
10. **One subagent per state, one at a time; each state its own PR, merged
    before the next starts.** As Joel asked (2026-10-06). Serial because one
    polite fetcher at a time is what an official site should see, and a
    merge per state because a state is a self-contained data change whose
    evidence is the whole suite on its own commit: fifty small PRs each
    proven, rather than one that cannot be bisected. The session does not
    read statutes itself: it spawns, checks, embeds, commits, gates, merges.
    The loop lives in `.claude/skills/add-code/SKILL.md`, written in Phase 1,
    because the implement skill builds one PR and stops; installing the skill
    is not running it — Joel starts `/add-code all`. Deploy stays the deploy
    skill's and deliberate: merged states go live at the next `/deploy`, and
    a run ends by saying how many are merged and not yet deployed.
11. **Vectorize grows to the whole code.** Up to ~5,000 chunks a state,
    ~250,000 vectors over fifty-one namespaces, inside the index's limit.
    Embedded by the session after each state (`laws:embed -- --push XX`),
    safe before deploy since the worker drops ids the published file lacks.
12. **The entry on the front pages is a field that opens the page, not a box
    in the page.** It looks like the box's own input — the same border, the
    placeholder *Ask any question about Maryland driving law* (welcome
    screen: *your state's driving law*), the ask icon — and a tap opens the
    ask page with the input focused. Mounting `AskBox` on the landing would
    load Turnstile and the exchange UI on the page a search result lands on.
13. **The chrome button keeps its place and words and gains the colour**: the
    speech toggle's "on" style, so it is the one coloured control in the row.
    No new height on any screen.
14. **The ask page's examples say road law is in scope**: *How far from a
    fire hydrant can I park?*, *When must I stop for a school bus?*, and the
    account question. Spanish the same.
15. **Search is told once, in the two strings it reads first.** Landing
    `<title>`: *Permit Practice Test & Driving Law Answers — Pass the Test*.
    Landing description ends *Ask any question on its law.*, held to 175
    characters. The state page's ask section says the answer comes from the
    manual *or the state's code, with the page or the section*. State page
    titles do not change: the exam figures are the head term.
16. **No page per section.** Fifty thousand pages of statute text would be
    the official sites' own content again; the pages that rank are the state
    and concept pages, and the box is what answers.
17. **Topics do not grow in this pass.** The thirty-five stay as the
    measured floor; with the code in, the unanswered questions in
    `learner_questions` become the feed for what to check next.
18. **One indexable page per state answers the topic questions:
    `/drivers/XX/laws/`.** Checked 2026-10-06: a search for the Maryland
    hydrant distance returns content farms and no Maryland answer. This page
    is that answer, fifty-one times, built from `coverage.json`: every topic
    whose verdict is not `none`, as a question, its answer, and its citation
    linked to the official source — the manual law's sentence and reason with
    the page, Maryland's hand-written law with its section, or the chunk's
    text with its section and the URL from `SOURCES.json`. Title *Maryland
    Driving Laws, Answered — Pass the Test*; h1 *Maryland driving law,
    answered*; FAQPage JSON-LD from the same list, so the markup cannot say
    what the page does not. A topic with no answer is not on the page: a
    question with no answer under it is the content-farm shape this competes
    against. `laws` collides with no concept id in any corpus (checked).
19. **The app opens the box over that page.** React mounts over the
    prerendered article as it does on every page; `parsePath` learns the
    `laws` segment and the app opens that state with the ask overlay, so the
    person who arrived from a search is one tap from asking the question the
    page did not answer. A visitor at `/drivers/MD/laws/` today would get the
    state page and an `unknown_concept` event.
20. **The landing and the state page link to it.** The landing's prerendered
    body gains *Driving law, answered, by state* — fifty-one links — which
    is the first internal linking the front page has had; the state page's
    ask section links its own law page. No global `/ask/` page: the hash
    route stays, and the per-state pages are the indexable door because the
    query always names a state (docs/plans/seo.md).

## The change

### A. The code, state by state

**Step 0, by the session, before any subagent.** The pipeline, proved on
Maryland:

- `worker/src/code-chunks.ts` (decision 2) and its unit test on a fixture
  section: labels found, 900-character cap, every chunk a substring.
- `scripts/statutes/sites/MD.ts` from today's `SECTIONS.MD`, with
  `enumerate` reading mgaleg's article index for Titles 11, 13, 16, 17, 20, 21,
  22, 26 and 27; `fetch.ts` as decision 5; `SOURCES.json` moved per state
  (`SOURCES_FILE` becomes a function of the code).
- The Vite plugin, `scripts/law-vectors.ts`, `scripts/learner-ask-eval.ts`
  and the e2e harness's `lawsOf` all build the retrieval file through one
  helper that reads the manual corpus, the hand statutes and the chunked
  sources — built once per state and cached in the e2e harness, since a
  `page.route` handler reading two thousand files per request would time out.
- `tests/unit/statutes.test.ts` generalised: hand laws as today; every chunk
  verbatim in its source; every source at hash and under `official`.
- `scripts/statutes/gaps.ts`, `tests/unit/statute-coverage.test.ts`, and
  Maryland's thirty-five verdicts in `coverage.json`.
- The system-prompt sentence (decision 9).
- `npm run statutes:fetch -- MD` (hours, in the background), the narrowed
  tests, `laws:embed -- --push MD`, the Maryland eval cases still green plus
  one new case on a chunk outside the topic list. Commit.

Also in Phase 1: `scripts/learner-ask-eval.ts` takes `--state XX` and runs
only that state's cases, so a state's PR does not pay for fifty states' model
calls; and `.claude/skills/add-code/SKILL.md`, the loop below, with the
subagent prompt carried verbatim (its plan path `docs/plans/vehicle-code.md`,
the merged name). Phase 1 ends as the implement skill ends: PR, report, stop.

**Phase 2: the loop, as `/add-code`.** `/add-code XX` does one state;
`/add-code all` does every remaining state in order, each merged before the
next starts. The states to do are every code `statesOf` returns with no block
in `coverage.json`, alphabetical, read afresh from the file at each turn — a
run that resumes reads the same file and continues. For each:

1. **Preconditions.** Tree clean, on `main`, `git fetch origin`, 0 behind.
   Branch `code-XX` off `origin/main`.
2. **Spawn** one subagent with the prompt below, `run_in_background: false`,
   in this checkout (not a worktree: the session commits what it writes).
   Inherit the session's model; never a smaller one.
3. **Check its report.** `git status --porcelain` shows only
   `scripts/statutes/sites/XX.ts`, `resource/statutes/sources/XX/`,
   `resource/statutes/coverage.json` and `scripts/learner-ask-eval.json`;
   anything else is reverted and named in the PR. Then
   `npx vitest run tests/unit/statutes.test.ts tests/unit/statute-coverage.test.ts -t "^XX:"`
   (every test in both files is named `XX: …`, so the anchor is what keeps
   `-t IN` from matching nothing or everything) and
   `npx tsc --noEmit -p scripts/tsconfig.json`. Red goes back to the same
   subagent once (SendMessage, its context intact); red twice is a blocked
   state — files reverted, topics `none` with the reason, said in the PR.
4. **Embed.** `npm run laws:embed -- --push XX`.
5. **Commit** explicit paths: the four above plus `resource/law-vectors.json`.
   *<State>'s vehicle code: N sections in M titles, K chunks* — or
   *<State>'s vehicle code: blocked, <reason>*.
6. **Local gate.** The whole of `npm test` on that commit, tree clean, 0
   behind `origin/main`, nothing else running on the machine. Red is a
   regression: if it is the state's own data (a chunk a page cannot render,
   a verdict retrieval does not reach) it is fixed in a second commit; if it
   is anything else, stop and report — never weaken a test, never merge red.
7. **Eval, narrowed.** `npm run ask:eval:learner -- --state XX` green, or
   the case or the verdict is fixed and the gate re-run.
8. **Push, PR, merge.** Body: the state; titles with why; sections and
   chunks; verdict counts and every `none` reason; blocked reason if any;
   the eval line; the merge-eligibility line CLAUDE.md asks for (`npm test`
   on `<sha>`, clean, 0 behind; CI paused, merges on the local run). Poll
   until the PR is mergeable, then `gh pr merge --squash --delete-branch`
   (this repo's `--auto` merges at once and `main` is unprotected). Then
   `git checkout main && git pull`.
9. **Next state.** Never two fetches at once. Never a merge with the next
   state's branch already cut.

A run ends — the list empty, a stop in step 6, or the session's end — by
saying which states merged in this run, which are blocked and why, and how
many merged states are not yet deployed. Deploy is `/deploy`, Joel's call, at
least once a session so the merged law pages go live.

Budget, stated so nobody is surprised: a state is an hour or two of fetch at
one request a second plus the suite, so the fifty are several sessions. A
run that stops leaves every finished state on `main`; nothing is held on a
long-lived branch.

When the list is empty: `npm run ask:eval:learner` over every case, once,
and its score in the last state's PR.

### The subagent prompt

Fill `XX` and `<State>`; send the rest as written.

> You are ingesting one state's vehicle code for the ask box in
> `/Users/joelstevick/projects/learners-permit-test`, on the current branch.
> State: `XX` (<State>). **You change only these paths:**
> `scripts/statutes/sites/XX.ts` (new), `resource/statutes/sources/XX/`
> (written by the fetch), `resource/statutes/coverage.json` (your state's
> block only), `scripts/learner-ask-eval.json` (append). **Do not commit, do
> not push, do not run `npm test`, do not run `laws:embed`.**
>
> Read first: the plan at `docs/plans/vehicle-code.md` (in Phase 1, before
> the rename, `docs/plans/implement.md`), decisions 1–7; `scripts/statutes/
> sites/MD.ts` and `fetch.ts` (Maryland is the worked example, an index-page
> `enumerate`); `tests/unit/statutes.test.ts` and
> `tests/unit/statute-coverage.test.ts`, which your work is held to.
>
> 1. Find the state's official code: the legislature's site, or the publisher
>    it designates. Decide which titles are the vehicle code by decision 1 and
>    write them into `titles` with one line of why each. Decide which of the
>    four `enumerate` shapes the site is (chapter page, index page, bulk file,
>    PDF) and write the module: `official`, `cite(section)` in the state's
>    own citation form ("Fla. Stat. § 316.1945"), `enumerate`, `extract`.
>    `extract` must be deterministic and keep only the text in effect — a
>    section served with a future version drops the future copy, as
>    Maryland's does.
> 2. If the site cannot be fetched by a script — click-through licence,
>    JavaScript-only reader, PDF the `pdftotext` path cannot read, a refusal
>    — stop: write no module, write every topic for your state in
>    `coverage.json` as `none` with reason `official site not fetchable:
>    <what you met>`, and report **blocked**.
> 3. `npm run statutes:fetch -- XX`, in the background; it is resumable, so
>    re-run it until it reports every listed section present. Read a sample
>    of the committed `.txt` files — the first section of each title and
>    three at random — and confirm they are the statute text, in effect, and
>    not navigation, a licence notice or an empty page. If a title came back
>    wrong, fix `extract` and re-run with `--refresh` for that title.
> 4. `npm run statutes:gaps -- XX`. For each of the thirty-five topics write
>    the verdict in your state's block: `manual` with the manual law's id,
>    `code` with the chunk's id, `statute` only if a hand law exists (it will
>    not), or `none` with the reason. A law that names the subject without
>    the rule or figure is not a verdict for it.
> 5. Append two cases to `scripts/learner-ask-eval.json`, `lang: en`, `state:
>    XX`, `expect.scope: 'road-law'`: the hydrant question if its verdict is
>    `code` (`contains: [<figure>]`, `citesLaw: '§ <section>'`), and one
>    question outside the topic list that a chunk you read answers with a
>    figure or a named rule.
> 6. `npx vitest run tests/unit/statutes.test.ts tests/unit/statute-coverage.test.ts -t "^XX:"`
>    and `npx tsc --noEmit -p scripts/tsconfig.json`. Green, or fix what is
>    yours and re-run.
>
> Report, in this shape and nothing else: state; **done** or **blocked**
> (with the reason); titles ingested (id → why) and any excluded; sections
> fetched and chunks produced; verdict counts — manual / code / none — and
> every `none` with its reason; the eval cases added; the test command and
> its result; the paths you touched. Your report is the only thing the
> session sees.

### B. The ask box's place

- `src/components/AskEntry.tsx`: a `button` styled as the box's input
  (border, paper, the ask icon at the left, muted placeholder text), full
  width, `data-testid="ask-entry"`, `aria-label` the placeholder text. Props:
  `stateName: string | null`, `onOpen`. Rendered first in the body of
  `StateSelect` (null → *your state's driving law*) and `Landing` (the
  state's name), directly under the site-name row. Opening is what the chrome
  button does (`menu.ask`), with the ask page's input focused on arrival
  from the entry.
- `AskButton` in `Screen.tsx` takes the speech toggle's "on" classes. Words,
  size, breakpoints, test ids unchanged.
- `STRINGS.en.ask.examples` and `.es` per decision 14; a new
  `ask.entry(stateName | null)` string in both languages.
- Check `tests/` for what counts controls on the welcome and landing screens
  (layout.spec, landing.spec, read-aloud.spec's chrome filter) before adding
  the entry, and fix those specs in the same pass.

### C. What search is told

Built after A's step 0 and before the loop: C2 reads `coverage.json` and
the chunks, and Maryland's block is the fixture it is written against; the
loop then grows the pages one state at a time with no further code.

- **C1. The landing strings.** `seo/prerender.ts` `landingPage`: the title
  and the description's last sentence, per decision 15; `tests/unit/seo.test.ts`
  fixtures follow.
- **C2. The law page.** `seo/pages.ts` gains `lawPage(product, state,
  corpus, coverage, chunks, sources)` and `lawPath`, built in `buildPages`
  for every state with at least one verdict that is not `none` (a blocked
  state still has its manual verdicts, so it still has a page). Body: h1;
  one paragraph naming the sources — the manual by its display name and the
  code's titles from the site module, each linked to `official`; then one
  `<section>` per topic in `topics.json` order: `<h3>` the topic question,
  `<p>` the answer, `<p>` the citation (`manualCitation` rendering for a
  manual law, *<State> law, <cite>* linked to the source URL for a chunk or
  hand law); then `askSection` and a link back to the state page; then the
  footer. Description ≤ 175 characters, in the shape *Maryland driving law
  answered with the section: how far from a hydrant, when to stop for a
  school bus, and N more. From the MVA manual and the Transportation
  Article.* Canonical to itself; in the sitemap through `buildPages`.
- **C3. Routing.** `src/path.ts` `parsePath`: a third segment equal to
  `laws` returns `{ product, state, concept: null, page: 'laws' }`; App
  opens the state with the ask overlay. `tests/unit/deep-links.test.ts`
  gains the case, beside its "cannot collide with a file the site already
  serves" test, which now also names this path.
- **C4. The links.** `askSection` says *the answer comes from <manual> or
  <State>'s code, with the page or the section it is in*, keeps *Easier than
  searching the manual* (seo.spec asserts it), and links *<State> driving
  law, answered* to the law page — only when that page is built, so no
  state page links a 404. `landingAskSection` keeps its text and is
  followed by `byStateSection`: *Driving law, answered, by state*, one link
  per published state with a law page, in manifest order.

## Acceptance criteria

**Phase 1 — the implement skill's PR.** What its verifier checks.

1. Maryland's sources hold the sections of Titles 11, 13, 16, 17, 20, 21, 22,
   26 and 27 with `SOURCES.json` beside them, and Maryland's block in
   `coverage.json` has a verdict for every topic in `topics.json`.
2. Every `manual`, `statute` or `code` verdict names a law that `retrieve`
   returns, within its eight, for the topic's question over that state's full
   retrieval file; every `none` carries a reason.
3. On Maryland, asking *how far from a fire hydrant can I park* through
   `/#ask` still shows 15 feet with the hand-written citation; asking a
   question only the code answers — chosen by the builder from a chunk,
   outside the topic list — shows the rule with a citation labelled as
   Maryland law and the subsection quoted, and the model was given that
   chunk.
4. Every chunk and every hand-written quote is found verbatim in its
   committed source; every source is at its recorded hash and under its
   state's official origin.
5. `resource/law-vectors.json` matches every state's published laws.
6. A figure in an answer that the cited chunk does not state is refused.
7. On `/` and on `/drivers/MD/` at 375px, an entry under the site's name
   reads *Ask any question about your state's driving law* / *… Maryland
   driving law*; tapping it shows the ask page with its input focused.
8. The ask page's example questions include *How far from a fire hydrant
   can I park?*
9. The HTML a crawler is served at `/` carries the title *Permit Practice
   Test & Driving Law Answers — Pass the Test* and a description ending *Ask
   any question on its law.* of at most 175 characters; at `/drivers/MD/`
   the ask section names the manual or the state's code and links
   `/drivers/MD/laws/`.
10. The HTML a crawler is served at `/drivers/MD/laws/` carries the title
    *Maryland Driving Laws, Answered — Pass the Test*, a canonical to itself,
    the hydrant question with *15 feet* and *§ 21-1003(m)* under it, a link
    to mgaleg.maryland.gov, and FAQPage JSON-LD whose questions are exactly
    the page's `<h3>`s; `/sitemap.xml` lists it; `/` lists it under *Driving
    law, answered, by state*.
11. No law page carries a topic whose verdict is `none`, and a state with no
    coverage block has no law page and no link to one.
12. Opening `/drivers/MD/laws/` in the browser shows the ask page with
    Maryland chosen, not the state page and not the welcome screen.
13. `npm run ask:eval:learner -- --state MD` runs Maryland's cases only and
    is green, including a new case on a chunk outside the topic list.
14. `.claude/skills/add-code/SKILL.md` exists and carries the loop and the
    subagent prompt above, and `/add-code` is listed as a skill.

**Phase 2 — each state's PR**, checked by `/add-code` on that PR, and in sum
when `/add-code all` reports no state remaining.

15. The state has a coverage block with a verdict for every topic, and
    either its sources with `SOURCES.json` or a blocked reason on every
    `none`.
16. Criteria 2, 4 and 5 hold over every state merged so far — the unit
    tests run in that PR's `npm test`.
17. For a state whose coverage marks `park-hydrant` as `code`, the browser
    flow shows the figure, labelled as the state's law, and the model was
    given that state's chunk — the e2e spec reads the states to drive from
    `coverage.json`, so each merged state adds its own case.
18. Each of AZ, HI, KY, MA, MO, OH, SC, SD and WI, when its PR lands, has a
    `code` verdict for `park-hydrant` or is blocked with the reason in its
    PR body.
19. `npm run ask:eval:learner -- --state XX` is green on the state's two
    cases, and the whole eval once at the end of the loop.
20. When no state remains, every jurisdiction `statesOf` returns has a block
    and a law page or a blocked reason.

## How this fails silently

1. **A chunk that is not the law.** Unit (`statutes.test.ts`, every state):
   every chunk a verbatim substring of its source. Mutation: have the chunker
   trim a trailing word → red on that state's "quotes every chunk verbatim".
2. **A verdict that lies.** Unit (`statute-coverage.test.ts`): each verdict's
   law exists and is retrieved for the topic question. Mutation: point FL's
   `park-hydrant` at a seat-belt law → red.
3. **A whole title fetched as navigation.** Unit: no source file under 200
   characters unless its `SOURCES.json` entry marks it `repealed`, and a
   state not marked blocked has at least one `code` or `manual` verdict.
   Mutation: replace one source's text with a menu → red on its hash; delete
   its hash entry too → red on the length floor.
4. **A section number grounding a figure.** E2E (`learner-ask-law.spec.ts`,
   existing shape): a stub answer *At least 21 feet* citing `MD-C-21-1003-m`
   is refused. Mutation: have the checker ground on the whole citation → red.
5. **A state done from another state's site.** Unit (existing): every source
   URL under the state's `official`. Mutation: point one source at
   mgaleg.maryland.gov → red.
6. **An index left behind.** Unit (existing, `law-vectors.test.ts`).
   Mutation: edit one chunk's source without re-embedding → red for that
   state.
7. **The code shown as the manual.** E2E: the citation under a chunk-cited
   answer reads *Not in your manual — <State> law*. Mutation: render statute
   citations with the manual label → red.
8. **A chunker that silently swallows a subsection.** Unit on the fixture:
   the chunks' texts, concatenated, equal the section's text less
   whitespace. Mutation: skip the last label → red.
9. **An entry that opens nothing.** E2E: tap `ask-entry` on `/` and on
   `/drivers/MD/` → ask heading visible, input focused. Mutation: drop the
   entry's `onClick` → red on the heading assertion.
10. **The crawler told the old story.** E2E (`seo.spec.ts`, request-based).
    Mutation: revert the landing title → red.
11. **A state half done.** Unit: a state with a site module or a sources
    folder has a coverage block, and every block has every topic. The list
    of states with no block at all is what `/add-code all` works from, so it
    is printed by the test as a note, not a failure — otherwise Phase 1 would
    be red until the last state merged. Mutation: delete one topic from
    Maryland's block → red naming the state and the topic.
12. **Markup that says what the page does not.** Unit (`seo.test.ts`): every
    FAQPage question on a law page is an `<h3>` in its body, and the counts
    match. Mutation: add a JSON-LD entry without its section → red.
13. **A question with no answer under it.** Unit: no law page names a topic
    whose verdict is `none`; a state with only `none` verdicts has no page.
    Mutation: emit `none` topics with the reason as the answer → red.
14. **A citation link off the official site.** Unit: every code citation
    link on a law page starts with that state's `official`. Mutation: link a
    chunk to Justia → red.
15. **The search visitor dropped on the wrong screen.** E2E
    (`deep-links.spec.ts`): `/drivers/MD/laws/` → ask heading visible,
    state name Maryland in the chrome. Mutation: treat `laws` as a concept
    → red on the heading.

## Non-goals

- A live lookup of any kind at question time (Joel, 2026-10-05).
- Statutes on the cards or in the practice tests.
- Regulations, case law, local ordinances, agency and authority titles
  (decision 1).
- A page per section (decision 16); a global `/ask/` page (decision 20);
  new topics (decision 17).
- Spanish translations of statute text: the box says *No está en su manual
  — …* over the English quote, as Maryland does today.
- Hand-written laws for any state but Maryland; a fallback for a blocked
  state.
- Changing the state pages' titles, the chrome's words and breakpoints, or
  `RETRIEVED_LAWS`.
- Deploying from the loop: merged states go live at the next `/deploy`.
