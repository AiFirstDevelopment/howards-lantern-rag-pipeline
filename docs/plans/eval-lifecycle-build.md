# The eval lifecycle, built: traced answers, a golden set with gold laws, per-stage scoring, a labelling screen that finds the law, nightly scoring, and a gated run

**2026-10-15: phase 6, the last, is the pull request on branch `eval-lifecycle-6`** (decisions 35–37 and 40, criteria 33–36, guards 23–24). With it every phase is built: phases 0–5 are merged (#824, #826, #828, #829, #830, #831, #832). [eval-lifecycle.md](eval-lifecycle.md) now describes what was built, with every deviation below folded in, and has no header note. No baseline is committed yet, so the gate (decision 34) has nothing to compare with and a run exits 1 on any miss until `eval:accept` commits one. `eval.yml` and `eval-label.yml` are disabled on GitHub until Joel's steps below are done. `refresh.yml` lands enabled, as every new workflow file does, and is inert without its secrets (its first job names them and the rest skip); the coordinator disables it on GitHub right after this PR merges (`gh workflow disable refresh.yml`), and Joel's step is `gh workflow enable refresh.yml`. Each install step pins `npm install -g npm@11.21.1` before `npm ci`, because Node 20's npm 10.8.2 fails on this lockfile ("Cannot read properties of null (reading 'edgesOut')").

branch: eval-lifecycle-6
slug: eval-lifecycle-build

Written 2026-10-15. [docs/plans/eval-lifecycle.md](eval-lifecycle.md) describes
the ask box's production eval lifecycle in the present tense, as a document to
teach from. Sections A and B of it are true; sections C and D are a design.
This plan builds sections C and D so that the document becomes true, one
phase per pull request, in order. Phase 0 is a schema change and ships alone.

Joel's brief: build all of it so it becomes real, and **make it as easy as
possible to identify the correct laws for a question** — in the labelling
screen, in the harness's output, and for the 202 cases that already exist.
That brief is why phase 2 backfills `gold` from the citation checks the cases
already carry rather than asking anybody to label them, why the labelling
screen shows the pipeline's own candidate pool with the question's figures
highlighted before it offers a search box, and why a miss in the harness
prints the pool with ranks rather than a reason alone.

Read [eval-lifecycle.md](eval-lifecycle.md) first; this plan does not restate
what each stage is for. Where this plan and that document differ, this plan
wins, and the differences are listed under *Deviations from the design* at the
end so the document can be corrected in the last phase.

## What is already true, so nobody re-derives it

- `answerLearner` (`worker/src/learner-ask.ts:1218`) takes every outside
  resource as an injected `LearnerPipeline` dependency and returns
  `{ body, outcome, path? }`, where `LearnerOutcome` is
  `{ answer, scope, sources, model }`. The handler
  (`worker/src/learner-api.ts`) claims the turn before the model is asked and
  `UPDATE`s the row with the outcome after. The row id is `claimed`, a D1
  integer, and is not sent to the client today.
- Inside `answerLearner` for a state question the hops are named and
  sequential: `retrieve()` → `retrieval` (the fused pool); `chooseLaws()` →
  `chosen`; `wholeSections()` → `sectioned`; `withPenalties()` → `retrieved`
  (what the model is given). `pagesLast` reorders; nothing else changes the
  set.
- `learnerReplyFrom(response)` reads an `Anthropic.Message`; `response.usage`
  is there and unused.
- The harness `scripts/learner-ask-eval.ts` builds the pipeline from the
  committed corpus (`publishedLawsOf`) and REST-backed `nearLawsOverRest`,
  `deployedRerankOverRest`, `deployedRephrase`, `lawsBySectionFromCorpus`,
  etc.; `runCase` scores with `misses()` and `registerMisses()` and prints one
  table row. `--state`, `--all`, `--live`, `--store`, `--no-rerank` exist.
  Message Batches go through `scripts/eval-batch.ts`.
- A case's citation checks resolve against the shown citations:
  `citesLaw` is a substring of a citation's location (`"§ 21-1003(m)"`),
  `citesId` is an id prefix, `cites` is a manual page (`citedPages`). The
  published laws carry `id`, `citation`, `kind`; a statute chunk's citation
  begins with its reference (`Md. Code, Transp. § 21-1003(m) — '…'`).
- The admin is a React app at `/admin/` behind Cloudflare Access; tabs are the
  `Tab` union and `TABS` array in `src/admin/Admin.tsx:80`; every call goes
  through `call()` in `src/admin/api.ts` with credentials; routes are
  matched by name in `handleAdmin` (`worker/src/admin-api.ts`), windowed ones
  through `windowOf`. `Activity` in `src/admin/Chart.tsx` draws a bucketed
  chart. `tests/e2e/admin.spec.ts` stubs `/api/admin/*` with `stubAdmin`.
- The `learners-permit-api` worker is bound to `DB` (D1), `LAWS`
  (Vectorize), `AI` (Workers AI), `KB` (R2) and has `ANTHROPIC_API_KEY` as a
  secret. `kb-cron` (`mcp/cron/`) runs at `17 6 * * *` UTC with `DB`, `KB`,
  `SEND_EMAIL` (to `KB_ALERT_TO`) and no Anthropic key; its `scheduled`
  handler calls `runKnowledgeCheck` from `worker/src/kb-cron.ts`, so worker
  code is shared by import, not duplicated.
- `learner_questions` rows are purged at 180 days on the write path
  (`claimTurn`). The privacy page (`src/screens/Privacy.tsx`,
  `privacy-learner-questions`) says what the box keeps; a unit test holds the
  learner book to it.
- `.github/workflows/regression-tests.yml` is disabled on GitHub to stop the
  Actions bill; it is the only workflow. No repository secrets exist.
- `resource/laws-store.json` and `resource/law-vectors.json` carry a hash per
  state of what was pushed; `tests/unit/laws-store.test.ts` holds the store
  hash to the corpus.
- `worker/schema.sql` is applied to production by hand, statement by
  statement, before the worker that reads it deploys; SQLite has no
  `ADD COLUMN IF NOT EXISTS`.

## Decisions — flip any in the PR

### Phase 0 — the schema, alone

1. **One PR, schema only, no worker change.** Per CLAUDE.md a migration ships
   with nothing visible beside it. The statements, appended to
   `worker/schema.sql` with the usual one-shot note:

   ```sql
   ALTER TABLE learner_questions ADD COLUMN latency_ms INTEGER;
   ALTER TABLE learner_questions ADD COLUMN tokens_in INTEGER;
   ALTER TABLE learner_questions ADD COLUMN tokens_out INTEGER;
   ALTER TABLE learner_questions ADD COLUMN trace TEXT;      -- JSON {pool,chosen,given,searches}
   CREATE TABLE IF NOT EXISTS answer_ratings (
     question_id INTEGER PRIMARY KEY, rating INTEGER NOT NULL, rated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS eval_candidates (
     question_id INTEGER PRIMARY KEY, sampled_at INTEGER NOT NULL,
     reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
   CREATE INDEX IF NOT EXISTS idx_eval_candidates_status ON eval_candidates(status, sampled_at);
   CREATE TABLE IF NOT EXISTS eval_labels (
     question_id INTEGER PRIMARY KEY, labelled_at INTEGER NOT NULL, verdict TEXT NOT NULL,
     contains TEXT, not_contains TEXT, gold TEXT, holdout INTEGER NOT NULL DEFAULT 0,
     promoted_at INTEGER);
   CREATE TABLE IF NOT EXISTS answer_scores (
     question_id INTEGER PRIMARY KEY, scored_at INTEGER NOT NULL,
     faithful INTEGER, relevant INTEGER, judge_model TEXT, judge_agreement REAL);
   CREATE TABLE IF NOT EXISTS ask_daily (
     day TEXT PRIMARY KEY, asked INTEGER NOT NULL, shown INTEGER NOT NULL, refused INTEGER NOT NULL,
     reasons TEXT NOT NULL, faithful_rate REAL, relevant_rate REAL,
     rated_up INTEGER NOT NULL, rated_down INTEGER NOT NULL,
     p50_latency_ms INTEGER, p95_latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL);
   CREATE TABLE IF NOT EXISTS eval_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at INTEGER NOT NULL, trigger TEXT NOT NULL,
     commit_sha TEXT NOT NULL, prompt_sha TEXT, corpus_hash TEXT, cases INTEGER NOT NULL,
     right INTEGER NOT NULL, recall REAL, mrr REAL, rerank_survival REAL, widening REAL,
     generation REAL, refusal_precision REAL, refusal_recall REAL, judge_agreement REAL, cost_usd REAL);
   CREATE TABLE IF NOT EXISTS eval_results (
     run_id INTEGER NOT NULL, case_no INTEGER NOT NULL, stage TEXT, ok INTEGER NOT NULL,
     reasons TEXT, shown TEXT, PRIMARY KEY (run_id, case_no));
   ```

   `ask_daily.reasons` is one JSON object (`{"ungrounded": 3, …}`) rather than
   a column per reason, so a new refusal reason needs no migration. The
   workerd test harness applies `schema.sql` whole, so every later phase's
   tests see these.
2. **Joel applies it to production** with one `wrangler d1 execute` of the
   new statements, and the PR body says so, before phase 1's worker deploys.
   Nothing reads the new columns until phase 1, so the order cannot fail
   quietly: a phase-1 worker on a phase-0-less database fails every INSERT
   loudly, as the existing one-shot notes describe.

### Phase 1 — every answer carries its trace, and a learner can rate it

3. **`LearnerOutcome` gains `trace`** — `{ pool: string[], chosen: string[],
   given: string[], searches: string[] }` — filled inside `answerLearner` from
   `retrieval`, `chosen`, `retrieved` and the rephraser's searches, for state
   questions; for nationwide, `{ topics: [...] }` or the index path's ids;
   for a book answer, the sources. Law ids only, never text, so the column
   stays small and holds nothing a learner typed.
4. **Usage and latency are measured, not estimated.** `LearnerReply` carries
   `usage: { input, output }` from `response.usage` (and from the reranker's
   and rephraser's calls, summed); the handler times `answerLearner` and
   writes `latency_ms`, `tokens_in`, `tokens_out`, `trace` in the same
   `UPDATE` that writes the outcome.
5. **The response gains `questionId`** — the claimed row id — so the client
   can rate the row. An integer that means nothing outside this table.
6. **`POST /api/ask/rate`** `{ conversation, questionId, rating: 1 | -1 }`:
   `INSERT OR REPLACE INTO answer_ratings` only where a `learner_questions`
   row has that id *and* that conversation, so a rating can only be given by
   the browser that holds the thread. 204 on success, 404 otherwise. A
   thumbs-down also adds the row to `eval_candidates` with
   `reason = 'rated_down'` through `addCandidate` (decision 6a). No
   Turnstile: a rating spends nothing.
6a. **One place adds a candidate, and it refuses a repeat** (Joel,
   2026-10-15: the exact same question must never appear twice as a
   candidate). `worker/src/eval-candidates.ts` exports
   `addCandidate(db, questionId, reason, now)` and is the only writer of
   `eval_candidates`: the thumbs-down path here and the nightly sampler in
   phase 4 both call it. It returns `'added'` or `'duplicate'`, refusing when
   a candidate of any status already exists for the same question under the
   same state — "the same question" being `questionKey(question)`: lower-
   cased, trimmed, whitespace collapsed, a trailing `?`, `.` or `!` removed —
   found by joining `eval_candidates` to `learner_questions`. `questionKey`
   is exported from the same module and imported by the scripts, so
   decision 18's fixture validation and decision 23's promotion mean the
   same thing by "duplicate" as the queue does.
7. **The thumbs on the answer card** (`AskBox.tsx`, under the sources line):
   two small buttons, `ask-rate-up` / `ask-rate-down`, shown only on an answer
   that was shown (never on a refusal or a chip); pressing one posts, marks
   the pressed one, and keeps the choice in the thread state so a reload
   shows it. Labels in both languages in `src/strings.ts`.
8. **The purge keeps up.** `claimTurn`'s delete also deletes from
   `answer_ratings`, `answer_scores`, `eval_candidates` and `eval_labels`
   where `question_id` no longer exists — one statement each, so a purged
   question leaves no orphan row with its id.
9. **The privacy page says it.** One sentence under *If you ask a question*:
   the answer can be rated, the rating is kept with the question, and which
   laws the box considered is kept beside the answer as a list of citations.
   The learner book's matching section gets the same sentence (`kb:build`).

### Phase 2 — the harness knows which law was right, and which stage lost it

10. **Every case gets `gold`, mostly without a human.** `npm run eval:gold`
    resolves each existing case's citation checks against the state's
    published laws: `citesLaw` → every statute chunk whose citation reference
    contains it; `citesId` → every id with that prefix; `cites` → every
    manual law on that page; nationwide `path: topic` cases → the topic's
    law ids for the states named in `contains`. Where that yields one to four
    ids, it writes `gold` into `scripts/learner-ask-eval.json` in place.
    Where it yields none or more than four, it prints the case and the
    candidates and writes nothing; those cases are the only ones a person
    labels, in the admin (phase 3), which can import the fixture's open
    cases as candidates (`eval:gold --queue` writes them to
    `eval_candidates` with `reason = 'fixture'`). Measured before writing:
    the PR body says how many of 202 resolved automatically.
11. **`from` and `holdout`.** `eval:gold` also stamps `from` on every
    existing case from git history — `seed` for the 33 in the first commit,
    `ingest` for a case added in the same commit as its state's
    `resource/statutes/sources/XX/`, `failure` otherwise — and marks every
    tenth road-law case `holdout: true`, chosen by a fixed seed so the set is
    stable. `--all` reports holdout cases in their own block and never
    counts them in the deltas a tuning run looks at.
12. **The trace is captured by wrapping, not by a flag.** `runCase` wraps the
    pipeline's `nearLaws`, `rerank`, `lawsBySection` and `askLearner` to
    record pool, chosen, given and the raw reply per case — the same shape as
    `outcome.trace` (decision 3), and the harness asserts the two agree on
    every case so the wrap cannot drift from production.
13. **`stageOf()`** attributes every miss with a `gold` by the table in
    eval-lifecycle.md stage 2 (retrieval → rerank → widening → generation →
    checker; `unattributed` without `gold`). A case whose *fact* is needed
    for widening is the first `contains` entry; "in a given law's text" is a
    case-insensitive substring over `law.law`.
14. **The summary block** prints recall@pool, MRR, rerank survival, widening
    coverage, generation accuracy, refusal precision and recall, and a count
    per stage, after the table; `--json` writes the table rows, the summary,
    `commit_sha`, `prompt_sha` (sha256 of `learnerPrompt`'s text),
    `corpus_hash` (sha256 over `resource/laws-store.json` hashes) and
    `cost_usd` (from summed usage at the models' list prices, in
    `scripts/eval-cost.ts`) to `eval-run.json`.
15. **A miss shows the pool.** With `--explain` (on by default under
    `--state`, off under `--all`), a missed case prints its pool as ranked
    lines — `#3 MD-C-21-1003-m  § 21-1003(m) — 'A vehicle may not be parked
    … within 15 feet of a fire hydrant'` — with the gold id marked and the
    chosen ones starred, so the right law is readable from the terminal
    without opening a file.
16. **The baseline.** `scripts/learner-ask-eval-baseline.json` is an accepted
    `eval-run.json`. Every run prints deltas against it — newly right, newly
    wrong, stage changed — and `npm run eval:accept` copies `eval-run.json`
    over it. The harness exits 1 on a regression as stage 4 defines it
    (decision 28) and 0 otherwise, so a run with the same misses as the
    baseline is green.
17. **`--retrieval`** runs rephrase, retrieve, rerank and widening only — no
    answering model, no judge — and reports the retrieval metrics. It is the
    cheap check phase 6 attaches to corpus moves.
18. **The set is validated before a run**: two cases with the same question
    (by `questionKey`, decision 6a) and state, or a `gold` id absent from its state's published laws, stop
    the harness with the case number. A re-chunk that renames ids is loud.
19. **Unit tests, not e2e, for the harness's pure parts** — `stageOf`,
    the metrics, `resolveGold`, the validation, `eval-cost` — in
    `tests/unit/eval-harness.test.ts` over fixture traces. The harness itself
    is never run by the suite (it costs money); that stays.

### Phase 3 — the labelling screen, built to find the law

20. **A new admin tab, `quality`** (label *Ask quality*), with three panels:
    *To label*, *Daily*, *Runs*. Phase 3 builds *To label*; phase 4 the
    other two. `Tab` and `TABS` gain `'quality'`; the e2e stub gains its
    routes.
21. **The queue** (`GET /api/admin/eval/candidates?status=open`): open
    candidates newest first, each row showing the question, state, language,
    when, the reason it was sampled, what was shown (or the refusal reason in
    words), and the rating if any. Opening a row shows the labelling card.
22. **The labelling card finds the law for you, in this order:**
    - **The pool, ranked.** The row's `trace.pool`, each law's citation
      reference and text read from `laws` by id
      (`GET /api/admin/eval/laws?ids=`), chosen laws starred, given laws
      marked, and **every figure in the question** (`numbersIn` over the
      question, both languages) **highlighted wherever it appears in a law's
      text**, so a hydrant question lights up the one law that says 15. One
      button per law: *This is the law* sets `gold` (several may be set).
    - **The section, whole.** Each pool law has *Show its section*, which
      expands its neighbours (`GET /api/admin/eval/section?state&section`,
      the same `lawsBySection` the box uses) in print order with the same
      highlighting, for the case where the figure is in (c) and the pool
      found (b).
    - **Search.** A box that runs the box's own retrieval over the state's
      laws — `GET /api/admin/eval/search?state&q`, BM25 over the published
      file plus Vectorize when bound, fused as `retrieve()` fuses them — and
      lists the top 12 the same way. Typing the law's own words ("fire
      hydrant 15 feet") finds it in one try when the pipeline's search did
      not.
    - **The fact, from the law.** Clicking a highlighted figure in a chosen
      law fills `contains` with it; the field stays editable. `not_contains`
      is pre-filled with any figure the shown answer contains that the gold
      law does not.
    - **The verdict**: four buttons — *right*, *wrong*, *refusal was
      correct*, *refusal was wrong* — and a *Hold out* toggle. *Save*
      (`POST /api/admin/eval/label`) writes `eval_labels`, marks the
      candidate `labelled`, and moves to the next row; *Skip* marks it
      `skipped`. Keys: `j`/`k` next and previous, `g` sets gold on the
      focused law, `s` saves.
    A card never shows a learner id, a session or a code: the question, the
    answer, the laws and the rating are the whole of it.
23. **Promotion is a script and a PR, not a button.** `npm run eval:cases`
    reads labels with `promoted_at IS NULL`, appends each as a case with
    `from: { kind: 'labelled', row, on }` and `holdout` as labelled, refuses
    a duplicate question (by `questionKey`, decision 6a) for the same state, writes `promoted_at` back
    through `POST /api/admin/eval/promoted` (so the script needs the
    operator's Access cookie or a service token: it takes `ADMIN_COOKIE` from
    the environment, as `scripts/kb-push.ts` takes its token), and leaves the
    fixture changed for a human to commit. The PR's eval run is the new
    case's first.
24. **Reading rows for the queue is the worker's job, scrubbed as always.**
    The routes return `question`, `answer`, `sources`, `model`, `state`,
    `lang`, `asked_at`, `trace`, the rating; never `conversation`, `session`,
    `credit_code`. A test asserts the response text contains none of them.

### Phase 4 — the judge, the nightly scoring, and the two other panels

25. **The judge** is `worker/src/eval-judge.ts` (so the cron worker and the
    harness share it): Haiku (`REPHRASE_MODEL`'s constant, renamed
    `HAIKU_MODEL` where both use it), a fixed rubric, JSON schema
    `{ faithful: boolean, relevant: boolean, why: string }`, given the
    question, the shown answer and the given laws' text. `scripts/eval-judge.ts`
    is the Node entry. In the harness the judge runs under `--all` on every
    shown answer and adds a `judge` column; it is a gate only when calibrated
    (decision 26).
26. **Calibration.** `scripts/eval-judge-calibration.json` is 60 answers
    with my own `faithful`/`relevant` labels, seeded in this phase from the
    first 60 `eval_labels` with a verdict (exported by `eval:calibrate
    --seed`, then edited by hand). `npm run eval:calibrate` runs the judge
    over them and prints agreement per question; the harness reads the last
    agreement from the calibration file's `lastRun` and treats the judge as
    a gate only at ≥ 0.9. `eval_runs.judge_agreement` records it.
27. **Nightly, in `kb-cron`**: `worker/src/eval-cron.ts` exports
    `sampleForLabelling(db, now)` (stage 1: up to 20 of yesterday's rows,
    stratified by `state`, `scope`, `lang`, `paid`, `model`, refusals and
    thumbs-downs first, each through `addCandidate`, a refused row skipped
    and the next in its stratum taken so a popular question cannot eat the
    night's twenty), `scoreYesterday(db, judge,
    now)` (every shown answer of yesterday, or a random 200, through the
    judge against its `sources` text from `laws`, into `answer_scores`), and
    `rollUpDay(db, day)` (into `ask_daily` from `learner_questions`,
    `answer_scores`, `answer_ratings`; `cost_usd` from tokens at list price).
    `mcp/cron/index.ts` calls the three after `runKnowledgeCheck`, each in
    its own try/catch, each logged. `kb-cron` gains the `ANTHROPIC_API_KEY`
    secret (Joel's step) and skips scoring, loudly, without it.
28. **Alerts** go through the existing `SEND_EMAIL` binding to `KB_ALERT_TO`,
    at most one a day, when over the last three days `faithful_rate < 0.9`,
    or `ungrounded` > 15% of shown, or `rated_down` > 20% of ratings, or
    p95 latency > 2× the 30-day median. `alertText` names the figure and
    links `/admin/?tab=quality`.
29. **The *Daily* panel** draws 30 days of `ask_daily` with `Activity`:
    asked and shown; refusals stacked by reason; faithful and relevant
    rates; ratings; p50/p95 latency; cost. Every figure opens onto its rows
    (`GET /api/admin/eval/day?day=`), the way the Learners tab opens.
30. **The *Runs* panel** lists `eval_runs` newest first with the per-stage
    numbers and the commit, and draws recall, rerank survival and generation
    over time; a run opens onto its `eval_results` grouped by stage.

### Phase 5 — the run in CI, gated, recorded through the worker

31. **`.github/workflows/eval.yml`**, enabled, with `workflow_dispatch`, the
    PR label `run-eval`, and a `paths` filter on the pipeline's files
    (eval-lifecycle.md stage 4 lists them). **No schedule**, deliberately,
    while Actions billing is the reason `regression-tests` is paused; the
    schedule line is in the file, commented, with the reason. The job runs
    `npm run ask:eval:learner -- --all --store --json`, uploads
    `eval-run.json` and the table as artifacts, posts the table as a PR
    comment with `gh pr comment`, and posts `eval-run.json` to the worker.
32. **Secrets**: `CLOUDFLARE_API_TOKEN` (Workers AI Read, Vectorize Read, D1
    Read on `learners-permit`), `ANTHROPIC_API_KEY` (a key made for CI),
    `EVAL_INGEST_KEY` (random, also set on the worker with `wrangler secret
    put`). Creating the token and the key and setting the three are Joel's
    steps; the PR body lists the exact scopes and commands.
33. **`POST /api/eval/runs`** on `learners-permit-api`, authenticated by the
    `EVAL_INGEST_KEY` header, writes `eval_runs` and `eval_results` from the
    body; 401 otherwise; the body is validated field by field like every
    other parser in the worker.
34. **The gate** is in the harness, not the workflow: exit 1 when a holdout
    case is newly wrong, or two or more cases are newly wrong in one stage,
    or recall or generation is down more than 2 points against the
    baseline; a single newly-wrong case is re-run once with `--live` before
    it counts. The workflow fails on exit 1; `eval:accept` in the PR is the
    written override.

### Phase 6 — the corpus moves, the eval runs

35. **`laws:store --push XX` and `laws:embed --push XX`** end by running the
    retrieval eval for the state (`--retrieval --state XX --json`) and write
    `evalRecall` and `evalMrr` beside the hash in `resource/laws-store.json`
    / `resource/law-vectors.json`; `--no-eval` skips it. A state with no
    cases writes `null` and says so.
36. **`.github/workflows/refresh.yml`**: `workflow_dispatch` and a monthly
    schedule (`0 5 1 * *`, enabled — one run a month is the cost of a cup of
    coffee) that runs `npm run statutes:refresh`, and when the report lists a
    changed section, `--retrieval --all`; commits the report and opens a PR
    with both tables. Applying a change is still a person's route, as the
    `refresh-codes` skill says.
37. **`eval-lifecycle.md` is corrected** to match what was built, using the
    *Deviations* list below, and its header note is removed.

### Across the phases

38. Every new route is in `handleAdmin` or `index.ts` behind the same checks
    as its neighbours; every new table is read by the worker and never by a
    script with a database token, except `eval:cases` through the admin
    route (decision 23).
39. The register for comments and test names is this repo's: say the
    failure, name the one that happened where there is one.
40. **Everything this plan builds is mirrored into the public reading copy,
    `github.com/AiFirstDevelopment/howards-lantern-rag-pipeline`, phase by
    phase.** That repo is a snapshot of the ask path with paths preserved
    (its README says what is left out: the rest of the app,
    `worker/wrangler.toml`, the partner knowledge bases, every key), and the
    eval lifecycle is exactly the kind of reference it exists to be. The
    mechanism is `scripts/public-mirror.ts`, added in phase 1: it holds the
    **mirror list** — every path the public repo carries, which is the
    current public tree plus each phase's files from *The change* — copies
    those paths from this repo's `main` into a clone given by `--into <dir>`,
    reports what changed, and with `--pr` commits on a branch, pushes and
    opens the PR there. It never copies a path outside the list, so the
    exclusions hold by construction; a path on the list that this repo no
    longer has is deleted in the copy. The list is checked by a unit test
    (guard 25): every module in the import closure of
    `scripts/learner-ask-eval.ts`, `worker/src/eval-cron.ts`,
    `worker/src/eval-admin.ts` and `src/admin/Quality.tsx` must be on it,
    except the paths the README names as excluded, so the harness in the
    public repo always resolves. **Running it is Joel's step, after each
    phase deploys**: the auto-mode classifier refuses this session any push
    of private-repo content to the public repo, and the script is written so
    that one command does the whole of it. Each phase's PR body ends with
    that command.

## The change

### Phase 0
`worker/schema.sql`.

### Phase 1
`worker/src/learner-ask.ts` (trace, usage), `worker/src/learner-api.ts`
(timing, the UPDATE, `questionId`, `/api/ask/rate`, the purge),
`worker/src/index.ts` (the route), `src/api.ts` (`questionId`, `rateAnswer`),
`src/components/AskBox.tsx` + `src/ask-thread.ts` (the thumbs and the kept
choice), `src/strings.ts`, `src/screens/Privacy.tsx`,
`worker/src/learner-knowledge-base.md` + regenerated JSON,
`worker/tests/learner-ask.test.ts`, `tests/e2e/learner-ask.spec.ts`;
new `worker/src/eval-candidates.ts` + `worker/tests/eval-candidates.test.ts`;
new `scripts/public-mirror.ts` with its list (phase 0's `worker/schema.sql`
and `worker/tests/eval-schema.test.ts` on it too), `package.json`
(`public:mirror`), `tests/unit/public-mirror.test.ts`. Every later phase adds
its files to the list in the same PR.

### Phase 2
`scripts/learner-ask-eval.ts`, new `scripts/eval-gold.ts`,
`scripts/eval-stage.ts` (pure: `stageOf`, metrics, `resolveGold`,
validation), `scripts/eval-cost.ts`, `scripts/eval-accept.ts`,
`scripts/learner-ask-eval.json` (gold, from, holdout on existing cases),
new `scripts/learner-ask-eval-baseline.json` (the first accepted run),
`package.json` scripts, `tests/unit/eval-harness.test.ts`.

### Phase 3
`src/admin/Admin.tsx` (tab), new `src/admin/Quality.tsx` + `src/admin/Label.tsx`,
`src/admin/api.ts`, `worker/src/admin-api.ts` + new `worker/src/eval-admin.ts`
(candidates, laws, section, search, label, promoted),
new `scripts/eval-cases.ts`, `worker/tests/eval-admin.test.ts`,
`tests/e2e/admin.spec.ts`.

### Phase 4
new `worker/src/eval-judge.ts`, `worker/src/eval-cron.ts`, `mcp/cron/index.ts`,
`scripts/eval-judge.ts`, `scripts/eval-calibrate.ts`,
new `scripts/eval-judge-calibration.json`, `scripts/learner-ask-eval.ts`
(judge column, gate on calibration), `src/admin/Quality.tsx` (Daily, Runs),
`worker/src/eval-admin.ts` (day, runs, results), `worker/tests/eval-cron.test.ts`,
`tests/unit/eval-harness.test.ts`, `tests/e2e/admin.spec.ts`.

### Phase 5
new `.github/workflows/eval.yml`, `worker/src/index.ts` + new
`worker/src/eval-ingest.ts`, `worker/tests/eval-ingest.test.ts`,
`scripts/learner-ask-eval.ts` (the gate), `tests/unit/eval-harness.test.ts`.

### Phase 6
`scripts/laws-store.ts`, `scripts/law-vectors.ts`, new
`.github/workflows/refresh.yml`, `tests/unit/laws-store.test.ts`,
`docs/plans/eval-lifecycle.md`.

## Acceptance criteria

Phase 0
1. `worker/schema.sql` applied whole to an empty database creates every
   table and column named in decision 1, and applying only the new
   statements to a database at today's schema succeeds.

Phase 1
2. After a state question is answered, its `learner_questions` row holds
   `latency_ms` > 0, `tokens_in` and `tokens_out` > 0, and a `trace` whose
   `pool`, `chosen` and `given` are law ids, with `chosen ⊆ pool` and
   `chosen ⊆ given`, and whose `given` equals the ids the model was sent.
3. A refused answer's row holds the same trace and timing as a shown one.
4. The ask response carries `questionId`, and `POST /api/ask/rate` with that
   id and the thread's conversation writes one `answer_ratings` row; with a
   different conversation it writes nothing and answers 404.
5. A thumbs-down also places the row in `eval_candidates` with reason
   `rated_down`; a thumbs-up does not.
5a. A thumbs-down on a question whose normalised text and state already
   have a candidate of any status adds no row — "How far from a fire hydrant
   can I park?" after "how far from a fire hydrant can i park" adds nothing —
   while the identical question under another state adds one.
6. On the ask screen, a shown answer offers two rating buttons, a refusal
   offers none, pressing one marks it and sends one request, and the mark is
   still there after a reload of the same thread.
7. The purge that runs on a question's write removes rating, score,
   candidate and label rows whose question has been purged.
8. The privacy page and the learner book both say an answer can be rated and
   that the laws considered are kept as citations beside it.

Phase 2
9. `npm run eval:gold` writes `gold` on every case whose citation checks
   resolve to one to four published ids, writes `from` on every case, marks
   every tenth road-law case `holdout`, and prints the cases it could not
   resolve with their candidates; running it twice changes nothing.
10. A `--state XX` run prints, for each case, the stage column, and for a
    miss the ranked pool with the gold id marked and the chosen ids starred.
11. The summary block reports recall@pool, MRR, rerank survival, widening
    coverage, generation accuracy, refusal precision and recall, and a
    per-stage count, and `--json` writes them with `commit_sha`,
    `prompt_sha`, `corpus_hash` and `cost_usd`.
12. `stageOf` attributes a miss exactly as the table in eval-lifecycle.md
    stage 2 says, for each of its six rows.
13. A run prints newly-right, newly-wrong and stage-changed deltas against
    the baseline, `eval:accept` replaces the baseline with the run, and a run
    identical to the baseline exits 0.
14. `--retrieval` makes no answering-model call and reports the retrieval
    metrics.
15. The harness refuses to run on a fixture with a duplicate question-and-
    state, or a `gold` id its state's laws do not hold, naming the case.

Phase 3
16. The admin has an *Ask quality* tab whose *To label* panel lists open
    candidates newest first with question, state, when, reason, what was
    shown or why not, and the rating.
17. Opening a candidate shows its pool with each law's reference and text,
    chosen laws starred, given laws marked, and every figure from the
    question highlighted where a law's text contains it.
18. *Show its section* on a pool law lists the section's other rows in print
    order with the same highlighting.
19. The search box lists the top laws for typed words from the state's
    published laws, with the same highlighting, and *This is the law* on one
    of them sets it as gold.
20. Clicking a highlighted figure in a gold law fills `contains`; a figure
    the shown answer has that the gold law lacks is pre-filled in
    `not_contains`.
21. Saving writes an `eval_labels` row with the verdict, contains,
    not_contains, gold and holdout, marks the candidate labelled, and shows
    the next candidate; skipping marks it skipped.
22. No admin eval response contains a conversation id, a session id or a
    credit code.
23. `npm run eval:cases` appends each unpromoted label as a case with
    `from.kind = 'labelled'`, refuses a duplicate, marks the label promoted,
    and leaves the fixture changed and uncommitted.

Phase 4
24. The judge returns `faithful` and `relevant` for a shown answer and its
    laws, and a `--all` run shows them as a column.
25. `eval:calibrate` prints agreement per question against the calibration
    file and records it; the harness treats the judge as a gate only when
    the recorded agreement is at least 0.9.
26. The nightly job places up to 20 of yesterday's rows in
    `eval_candidates`, refusals and thumbs-downs first, never a row already
    there.
27. The nightly job scores yesterday's shown answers into `answer_scores`
    and writes one `ask_daily` row with counts, the refusal reasons, rates,
    ratings, latency percentiles, tokens and cost; without an Anthropic key
    it writes the row with null rates and logs why.
28. One alert email is sent when any threshold in decision 28 is crossed,
    and none the next day for the same crossing.
29. The *Daily* panel draws 30 days of `ask_daily` and each figure opens
    onto its rows; the *Runs* panel lists runs with per-stage numbers and
    opens a run onto its results by stage.

Phase 5
30. `POST /api/eval/runs` with the ingest key writes an `eval_runs` row and
    its `eval_results`; without the key it answers 401 and writes nothing.
31. `eval.yml` runs on dispatch, on the `run-eval` label and on the pipeline
    paths, never on push, and its steps post the table to the PR and the run
    to the worker.
32. The harness exits 1 on a holdout case newly wrong, on two newly-wrong
    cases in one stage, or on recall or generation down more than 2 points,
    after re-running a single newly-wrong case once; otherwise 0.

Phase 6
33. `laws:store --push XX` and `laws:embed --push XX` write `evalRecall` and
    `evalMrr` for the state beside its hash, `null` for a state without
    cases, and `--no-eval` leaves them as they were.
34. `refresh.yml` runs `statutes:refresh` on dispatch and monthly, runs the
    retrieval eval when a section changed, and opens a PR with the report
    and the table.
35. `eval-lifecycle.md` describes what is built, with no header note.

Across the phases
36. `npm run public:mirror -- --into <clone>` copies every path on the mirror
    list from this repo into the clone and nothing else, deletes a listed
    path this repo no longer has, prints what changed, and with `--pr`
    commits, pushes and opens a pull request there; and the mirror list
    holds every module in the import closure of the harness, the cron job,
    the admin eval routes and the Ask quality tab, except the paths the
    public README names as excluded.

## How this fails silently

Each names the failure and the mutation that proves a test sees it.

1. **The trace is written but wrong** — `given` recorded before widening, so
   the widening stage can never be attributed. Mutation: build `trace.given`
   from `chosen` instead of `retrieved`. AC 2's assertion that `given` equals
   the ids sent to the model goes red.
2. **Usage summed from one call** — the reranker's and rephraser's tokens
   left out, so `cost_usd` understates every run. Mutation: drop the
   reranker's usage from the sum. The worker test's expected `tokens_in`
   goes red.
3. **A rating by a stranger** — `/api/ask/rate` checks the id but not the
   conversation. Mutation: remove `AND conversation = ?`. AC 4's
   other-conversation test writes a row and goes red on `404`.
4. **Thumbs on a refusal** — the buttons drawn under "nothing was shown",
   inviting a rating of nothing. Mutation: drop the `answer !== ''`
   condition. AC 6's refusal assertion (`toHaveCount(0)`) goes red.
5. **Orphans after the purge** — a purged question's rating stays, keyed to
   an id the next AUTOINCREMENT will never reuse but a report will count.
   Mutation: delete the `answer_ratings` cleanup statement. AC 7 goes red.
5a. **The same question queued twice** — ten learners ask the hydrant
   question in Florida and the queue holds ten rows to label, nine of them
   wasted. Mutation: compare `question` instead of `questionKey(question)`
   in `addCandidate`'s NOT EXISTS. AC 5a's test (a second row differing only
   in case and a trailing "?") goes red.
6. **`eval:gold` writes an ambiguous gold** — five chunks match
   `§ 340.01` and all five become gold, so the stage attribution calls every
   retrieval hit a success. Mutation: raise the cap from four to twenty. AC
   9's "could not resolve" case goes red.
7. **Holdout counted in the tuning deltas** — the set is tuned to the cases
   it was meant to confirm against. Mutation: include holdout cases in the
   delta block. AC 13's unit test over a fixture run goes red.
8. **`stageOf` calls a retrieval miss a generation miss** — the one
   mis-attribution that sends somebody to the prompt when the index is the
   problem. Mutation: test `chosen` before `pool`. AC 12's retrieval row
   goes red.
9. **The harness's trace drifts from production's** — the wrap records
   `given` from a different variable than `outcome.trace`. Mutation: record
   `sectioned` in the wrap. The per-case equality assertion goes red.
10. **A renamed id scores silently** — a re-chunk renames `MD-C-21-1003-m`
    and every case holding it attributes to retrieval forever. Mutation:
    skip the gold-exists validation. AC 15 goes red.
11. **The highlight misses a spelled figure** — "fifteen feet" in the law,
    "15" in the question, nothing lit. Mutation: highlight digits only. AC
    17's spelled-number case goes red.
12. **Search runs over the wrong state** — the search route ignores `state`
    and ranks Maryland's laws for a Florida question. Mutation: drop the
    state filter. AC 19 goes red on the first result's id prefix.
13. **A label saves without a gold on a "right" verdict** — a case that can
    never be attributed. Mutation: remove the required-gold check for
    `verdict = right`. AC 21's red-on-missing-gold assertion goes red.
14. **An admin response leaks a session** — the candidates route selects
    `session` with everything else. Mutation: add `session` to the SELECT.
    AC 22's text assertion goes red.
15. **`eval:cases` promotes the same label twice** — two identical cases, one
    counted twice in every score. Mutation: skip writing `promoted_at`. AC
    23's second-run assertion goes red.
16. **The judge gates while uncalibrated** — a judge at 0.7 agreement fails
    PRs. Mutation: ignore `lastRun.agreement`. AC 25 goes red.
17. **Sampling takes the same rows every night** — ordering by `asked_at`
    with no exclusion of rows already sampled. Mutation: drop the
    `NOT EXISTS` on `eval_candidates`. AC 26 goes red.
18. **The rollup counts a refusal as shown** — `shown` from rows with
    `answer IS NOT NULL` rather than `answer != ''`. Mutation: change the
    predicate. AC 27's `shown` count goes red.
19. **Alerts every day** — the "none the next day" rule dropped, and the
    inbox trains itself to ignore it. Mutation: remove the last-alert check.
    AC 28's second-day assertion goes red.
20. **Ingest without the key** — a 200 on a missing header. Mutation: skip
    the header check. AC 30 goes red.
21. **The workflow runs on push** — every merge to main spends a run.
    Mutation: add `push: [main]` to `on:`. AC 31's unit test over the parsed
    YAML goes red.
22. **The gate ignores holdout** — a holdout miss counted like any other.
    Mutation: treat holdout as open in the gate. AC 32 goes red.
23. **`laws:store` writes `evalRecall` for a state with no cases as 1.0** —
    perfect recall over nothing. Mutation: default the metric to 1. AC 33's
    `null` assertion goes red.
24. **`refresh.yml` skips the eval when a section changed** — the one thing
    it exists to notice. Mutation: invert the changed-sections condition. AC
    34's unit test over the parsed YAML goes red.
25. **The public copy's harness stops resolving** — a phase adds
    `worker/src/eval-judge.ts`, the harness imports it, and the mirror list
    is not updated, so the public repo gets a `learner-ask-eval.ts` whose
    import fails. Mutation: remove `worker/src/eval-judge.ts` from the list.
    `tests/unit/public-mirror.test.ts`, which walks the import closure of
    the four roots and asserts each module is listed or excluded, goes red
    naming the path.
26. **The mirror copies something excluded** — a list entry for
    `worker/wrangler.toml` or `worker/src/knowledge-base.json`, and a key or
    the partner book is public. Mutation: add `worker/wrangler.toml` to the
    list. The same test's exclusion assertion goes red.

## Non-goals

- No third-party eval, tracing or observability service; nothing leaves
  Cloudflare, GitHub, Anthropic's API and this repo.
- No change to how retrieval ranks, how the reranker chooses, how sections
  are widened, or what the checker allows. Measuring is this plan; tuning
  is the next one, and it will have numbers.
- No automatic promotion of a label into the fixture, and no automatic
  acceptance of a baseline. Both are a PR a person reads.
- No learner-facing change beyond the two rating buttons and the privacy
  sentence. The box answers exactly as before.
- No scheduled CI eval while `regression-tests` is paused for billing; the
  schedule line exists, commented, for the day it is not.
- No change to the partner page's box or its eval.
- No learner id, session or code on any eval screen, row or export.

## Joel's steps, outside the repo

Each phase's PR body names its own; collected here so none is missed.

- Phase 0 → before phase 1 deploys: apply the new statements to production
  D1 (`npx wrangler d1 execute learners-permit --remote --config
  worker/wrangler.toml --command "…"`), then deploy the worker.
- Phase 4: `npx wrangler secret put ANTHROPIC_API_KEY --config
  mcp/cron/wrangler.toml`; deploy `kb-cron`.
- Phase 5: create the read-only Cloudflare API token (Workers AI Read,
  Vectorize Read, D1 Read on `learners-permit`) and a CI Anthropic key;
  `gh secret set CLOUDFLARE_API_TOKEN`, `gh secret set ANTHROPIC_API_KEY`,
  `gh secret set EVAL_INGEST_KEY`; `npx wrangler secret put EVAL_INGEST_KEY
  --config worker/wrangler.toml`; `gh workflow enable eval.yml`.
- Phase 6: phase 5's two secrets (`CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`)
  are the ones `refresh.yml` needs; let Actions open pull requests
  (`gh api -X PUT repos/AiFirstDevelopment/learners-permit-test/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`),
  or the report job fails at `gh pr create`; then
  `gh workflow enable refresh.yml` (it is disabled on GitHub right after
  merge, since a new workflow lands enabled).
- **After every phase deploys**: mirror it into the public repo —
  `git clone https://github.com/AiFirstDevelopment/howards-lantern-rag-pipeline /tmp/public-rag && npm run public:mirror -- --into /tmp/public-rag --pr`,
  then merge the PR it opens. The classifier refuses this session that
  push; the script makes it one command.

## Deviations from the design (eval-lifecycle.md), to fold back in phase 6

- The public mirror (decision 40) is not in the design; it is Joel's
  addition of 2026-10-15, and phase 6 adds a paragraph for it.

- `ask_daily.reasons` is one JSON object, not a column per reason.
- `eval.yml` has no live schedule while CI billing is paused.
- `eval:cases` writes `promoted_at` through an admin route, not a database
  token.
- The judge and the calibration file are seeded from the first labels, not
  written beforehand.
- The harness's `--explain` output (decision 15) and `eval:gold` (decision
  10) are not in the design; they are the brief's "as easy as possible".
- Phase 4: the cron runs at `17 6 * * *` (kb-cron's existing trigger), not
  `0 3 * * *`; "yesterday" is the UTC day before the run. `ask_daily.cost_usd`
  prices every token at the answering model's list price (an upper bound: a
  row's tokens are the turn's, Opus and Haiku together). The calibration
  ships empty and uncalibrated. The Daily panel draws its own bars and a
  table of figures rather than `Activity`, which is the partner chart with
  its four series built in. An alert is mailed on the night a figure newly
  crosses (crossed over the three days ending yesterday, not over the three
  ending the day before), so no state beyond `ask_daily` is kept.
  Each alert has a volume floor over its window (30 judged answers, 30
  shown, 10 ratings, 30 answered and a median from 7 days), and the
  faithful-rate alert never fires while the judge is uncalibrated. The
  judge gates only on a calibration of at least 60 answers. The night
  rolls up the day before yesterday again beside yesterday, so a rating
  pressed after 06:17 UTC reaches its day.
- Phase 4, guard 17: dropping the sampler's `NOT EXISTS` is caught by the
  night's refused count (worker/tests/eval-cron.test.ts, the "never queues
  a row already queued" test), not by the queue's contents. Those are
  protected a second time by `addCandidate`, the queue's only writer;
  sampling around it is caught by the same test's `added` assertion.
- Phase 5: the `run-eval` label is `.github/workflows/eval-label.yml`, which
  calls `eval.yml` (`workflow_call`); a `paths` filter applies to the
  `labeled` activity too, so in one file the label would do nothing on a pull
  request outside the paths. The key travels in `X-Eval-Ingest-Key`. The
  route takes only a whole full run (`partial: false`, `mode: "full"`) with a
  40-character commit and a `trigger` the workflow adds (`dispatch`, `label`,
  `paths`, `schedule`, `manual`); an absent secret answers 503. The gate
  passes a lone tuning case newly wrong (decision 34 counts two in a stage),
  without a re-run, and re-runs a case only when it is the run's one
  newly-wrong holdout case, whatever the tuning cases did; the re-run's answer is the one printed, written to eval-run.json
  (with `rerun: { n, ok }`) and recorded. The job checks the three secrets
  are set before it installs anything. Neither workflow is on the public
  mirror: that repository holds no secrets, and the last step posts to this
  production worker.
- Phase 6: `refresh.yml` does not run `npm run statutes:refresh` in one job.
  Every state's 33,522 sections at one request a second is over nine hours,
  and a hosted job is killed at six, so the report would never reach a pull
  request. It runs eight shards (`scripts/statutes/refresh-ci.ts`, the same
  three passes as `statutes:refresh -- XX`, balanced by section count, AR,
  GA, MS, OK and TN included for their schedules and pages), merges their
  reports, and opens the PR from a third job, on `refresh-codes-<day>-<run
  id>` so a same-day re-run does not collide; the checkout keeps no
  credentials and only that last step holds the write token. It lands
  enabled but is inert until its secrets are set, and is disabled on GitHub
  right after merge until Joel enables it, rather than "enabled" as decision
  36 says. Its retrieval eval measures the corpus as
  committed — the refresh applies nothing — so it is the figure the state's
  later push is read against, and the design's "on a drop in recall or MRR,
  the full eval" is not built: nothing has moved for it to drop against. The
  PR is opened with the workflow's own token, which needs the repository to
  let Actions open pull requests, and starts no other workflow, so
  `eval.yml`'s paths trigger does not fire on it.
- Phase 6: the harness gained `--json-file <path>`, so a push's eval writes
  beside `eval-run.json` instead of over a whole run awaiting `eval:accept`.
  A push's eval without `ANTHROPIC_API_KEY` is not run (it would measure a
  pipeline with no rephraser): the figures are null, the reason is printed,
  and the push exits 0, as it does when the eval fails. The figures are set
  to null when the hash changes and filled after the eval, so a run that
  dies in the eval leaves no old figure beside a new hash. `laws:embed --push
  --kind process` ends with the eval too. `laws:embed` waits up to ten
  minutes for Vectorize to report the push's last upsert applied
  (`processedUpToMutation`) before its eval, and writes null with the reason
  if it does not; a push's eval is stopped at 45 minutes. Both figures read
  law text from the committed corpus (the harness runs without `--store`),
  so the store's figure measures the same thing as the embed's. `process:fetch --push` rewrites a
  state's `laws-store.json` entry without the two fields, as it did before;
  a follow-up, not changed here.
- Stage 7's "a case that flips three runs in a row is tagged `flaky`" was
  never built by any phase; the design no longer says it.

## Open questions, decided for now

- **Should a thumbs-up ever reach the queue?** No; it is counted in
  `ask_daily` and nothing else. Flip by adding `rated_up` to the sampling
  reasons.
- **Should the labelling card let me edit the question?** No; a case is the
  question as asked. A typo is a typo a learner made.
- **Gold on a book (`app`) case?** The book's section ids are the sources;
  `eval:gold` sets `gold` to the `contains`-matching section id where one
  section holds the figure, else leaves it for the queue.
