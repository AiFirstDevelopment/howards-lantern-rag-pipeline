# Teach me how my RAG system's eval lifecycle works, end to end

You are a tutor. I built a RAG system — the "ask box" in Howard's Lantern, a
permit-test study app at howardslantern.com — and it has a full production
eval lifecycle: a golden set that grows from real traffic, per-stage scoring,
a judge that is calibrated before it is trusted, gated CI runs against a
baseline, nightly production monitoring, and re-evaluation whenever the corpus
moves. It runs entirely on what the app already uses: Cloudflare (D1, Workers
with cron triggers, Workers AI, Vectorize, R2), GitHub Actions, and the repo's
own scripts. There are no third-party eval tools.

I want to understand how it works, piece by piece, well enough to explain it
to somebody else and to trace any miss to the stage that caused it. Teach it
one stage at a time. After each stage, ask me to explain it back in my own
words; correct me where I am wrong; only then move on. Use the real names
below — files, functions, constants, tables, columns — in every example.
Treat this document as the system as built: teach from it, and do not go
looking for the files. If you need a detail it does not give, ask me to look
it up rather than inventing it.

Section A is the ask box. Section B is the golden set and the harness.
Section C is the lifecycle, stage by stage. Section D is what I want to be
able to do afterwards. Section E is how to run the lesson. Section F is the
public reading copy of all of it.

---

## A. The ask box

**What it does.** A learner studying for a state's driving permit test types
a question. The box answers either from a *book* about the app (an account
question, the price, the refund) or from *road law* — the learner's state's
driver manual and vehicle code — with citations. Anything else is declined
with a pointer. Free questions are rate-limited (10 state and 3 nationwide a
week per browser, 300 a day site-wide); past that a learner buys a pack of
question tokens and each question is paid for with one. A conversation has
no length limit; the model is shown its last 10 turns (`HISTORY_TURNS`).

**The request path.** `src/screens/Ask.tsx` → `POST /api/ask` → a Cloudflare
Pages Function proxies to the worker `learners-permit-api`
(`worker/src/index.ts`) → `handleLearnersAsk` in `worker/src/learner-api.ts`
(validation, the Turnstile challenge on turn one, the quota, the turn claimed
in D1 before the model is asked) → `answerLearner` in
`worker/src/learner-ask.ts`, the pipeline. `answerLearner` takes every outside
resource as an injected dependency (`nearLaws`, `rerank`, `rephrase`,
`lawsBySection`, `penaltiesFor`, `processRowsFor`, `askLearner`), which is
what lets the eval run the identical function outside the worker. It returns
the answer and a `LearnerOutcome` that carries, beside the answer, the
`trace` and the `usage` the eval reads.

**The pipeline for a state question**, in order:

1. **Rephrase** — `law-rephrase.ts`, Haiku (`HAIKU_MODEL`,
   `claude-haiku-4-5-20251001`): the question restated in the words a
   statute uses, up to `REPHRASE_SEARCHES = 2` searches ("texting" →
   "electronic message").
2. **Retrieve** — `law-retrieval.ts` + `law-vectors.ts`: two rankings over
   the state's published laws, fused by reciprocal rank. BM25 in the worker
   over each law's text and its card question; and the Vectorize index
   `howard-laws` (`@cf/baai/bge-m3` on Workers AI, one namespace per state,
   `NEAR_LAWS = 8` per search). The index returns ids only; words always come
   from the state's published file `/ask-laws/XX.json`. The pool is
   `CANDIDATE_LAWS = 24`, or `SEARCHED_CANDIDATE_LAWS = 32` when the rephraser
   produced searches.
3. **Rerank** — `law-rerank.ts`: Haiku (`haikuRerankFor`) reads the pool and
   chooses `ANSWER_LAWS = 3`; `@cf/baai/bge-reranker-base` on Workers AI is
   the fallback without an Anthropic key.
4. **Widen** — `wholeSections`, `withPenalties`, `familyBeside`: each chosen
   statute's whole section is read from the D1 `laws` table by its `section`
   column (every sibling under the section root, in print order, capped at
   `SECTION_LAWS = 12` a section, `SECTION_CHARS = 24_000`, `GIVEN_LAWS = 40`
   in all); the court's fine-schedule rows keyed by section; the licensing
   agency's own page for the question's family (e.g. `test-and-retake`).
   Chosen laws stay first in the prompt.
5. **Answer** — `learnerRequestFor`, `LEARNER_ASK_MODEL = 'claude-opus-5-5'`,
   `effort: low`, JSON-schema output `{scope, answer, sources}`. System
   prompt = the rules + the book as a cached prefix; messages = the last 10
   turns, then the question with its laws listed as
   `[id] (the state's law, not the manual) text (citation)`.
6. **Check** — `checkAnswer` and its road-law counterpart decide, in one
   place, whether the model's text may be shown: the scope is allowed; it
   cites at least one law it was actually given; every number in it, digits
   or spelled (`numbersIn`), appears in a cited source; it names no price; it
   is under the length cap (two sentences, three for a "what happens if").
   A refusal is written to the row's `model` column as its reason:
   `ungrounded`, `unsourced`, `scope:road-law`, `overlong`, `priced`,
   `not-covered`, `road-law:no-laws`, `unreachable`, `unparsed`, `refused`.
7. **Log** — one row per question in D1 `learner_questions`: `id`,
   `conversation`, `turn`, `asked_at`, `lang`, `state`, `question` (scrubbed
   of phones, codes, emails), `answer` (what was shown; `''` if nothing),
   `scope`, `sources` (JSON array of law ids), `model` (the model, or the
   refusal reason), `credit_code`, `paid`, `session` (the browser's analytics
   id), and the columns the eval reads, written in the same `UPDATE` as the
   outcome: `latency_ms` (how long `answerLearner` took), `tokens_in` and
   `tokens_out` (measured from every call the turn made — the answering
   model, the rephraser, the reranker and the nationwide topic chooser,
   summed), and `trace`. Rows are purged at 180 days, and the purge also
   deletes the rating, score, candidate and label rows whose question is
   gone.

**The trace** is a small JSON of the pipeline's decisions, law ids only,
never text: for a state question `{pool, chosen, given, searches}` — `pool`
the ranked list the choice was made from (the reranker's pool, or
retrieval's fallback when there was no reranker), `chosen` what was picked,
`given` exactly the ids the model was sent after widening, `searches` the
rephraser's; for a nationwide question `{topics}` on the topic path or
`{given, searches}` on the index path; for a book answer `{sources}`. It is
written beside the answer so a production row can be scored stage by stage
later without re-running it. The response to `/api/ask` carries the row's
id as `questionId`, so the browser can rate the answer it was shown.

**Nationwide questions** (state `US`) take a separate branch: a Haiku topic
chooser maps the question to one of ~30 pre-compared topics (helmets, window
tint, BAC…) holding every state's law on it, or falls back to a 51-namespace
index search with words read from the `laws` table.

**The corpus**, built offline by `scripts/`: `statutes:fetch` stores each
section of a state's vehicle code as a text file under
`resource/statutes/sources/XX/` with `SOURCES.json` (url, date, sha256,
section, citation, heading); `chunkSection` (`worker/src/code-chunks.ts`,
pure) cuts each section at its subsection labels into chunks of ~900 chars
with ids like `MD-C-21-902-a`; `publishedLawsOf` assembles the manual's laws,
the statute chunks and the agency-page passages per state; the Vite build
publishes `/ask-laws/XX.json`; `laws:store --push` writes the D1 `laws` table
(id, state, kind, law, question, concept, citation, as_of, section);
`laws:embed --push` writes Vectorize. `resource/laws-store.json` and
`resource/law-vectors.json` hold, per state, a hash of what was last pushed
and the retrieval eval's figures for it (stage 6), and a unit test holds each
hash to the corpus. `statutes:refresh` checks monthly that each legislature
still serves the same text. 51 states, 172,486 law rows.

**Admin.** The operator's dashboard at `/admin/` is a React app behind
Cloudflare Access talking to `worker/src/admin-api.ts`. Its Learners tab has
an "Asked" tile opening onto who asked and what they were shown. Its **Ask
quality** tab (`src/admin/Quality.tsx`, deep-linked as `/admin/?tab=quality`)
is the eval's window, with three panels — *To label*, *Daily*, *Runs* — whose
routes live in `worker/src/eval-admin.ts` under `/api/admin/eval/`.

**Tests.** `npm test` = typecheck + unit + worker tests in workerd with a
*scripted* model + Playwright e2e with `/api/ask` stubbed at the network
edge. Nothing in it calls a real model; the eval is what does. The eval's
pure parts — `stageOf`, the metrics, the gate, gold resolution, the
validation, the cost — are unit-tested over fixture traces
(`tests/unit/eval-harness.test.ts`), and its workflows are unit-tested as
parsed YAML (`tests/unit/eval-workflow.test.ts`). The harness itself is never
run by the suite: every run costs money.

---

## B. The golden set and the harness

**`scripts/learner-ask-eval.json`** is the golden set. A case:

```json
{ "lang": "en", "state": "FL",
  "question": "How far from a fire hydrant can I park?",
  "gold": ["FL-C-316.1945-a-1"],
  "expect": { "scope": "road-law", "contains": ["15"],
              "notContains": ["10 feet", "20 feet"], "cites": ["66"] },
  "from": { "kind": "labelled", "row": 48213, "on": "2026-10-20" } }
```

`expect` pins the facts a right answer must carry: `scope`; `contains` (an
entry that is a list is met by any one of it); `notContains`; `lead`
(`yes`/`no`/`sí`); `cites` (manual page), `citesLaw` (statute section, e.g.
`§ 21-1003(m)`), `citesId` (an id prefix); `unanswered`; `mayRefuse`; for
nationwide `path` and `states`. **`gold`**, on the case beside `expect`, is
the law id (or ids, any one enough) that answers the question — the key the
per-stage scoring needs, because a citation check says the answer was right
but only a gold id says where in the pipeline it had to come from. `from`
says where the case came from: `{kind: "seed" | "ingest" | "failure", commit,
on}` for the cases written before the lifecycle existed, stamped from git
history, or `{kind: "labelled", row, on}` for a production row labelled in
the admin. **`holdout: true`** marks a case never looked at while tuning. A
retired case keeps its row with `"retired": "why"` and is skipped, so no
other case's number moves.

Today the set is 202 cases: 168 road law (150 of them under a chosen state,
across 46 states, 1–17 a state, median 2), 13 nationwide, 23 about the app,
26 in Spanish, 3 with a thread history. 89 carry `gold`; 17 are `holdout`;
2 are retired.

**How `gold` got there.** `npm run eval:gold` (`scripts/eval-gold.ts`)
resolved each existing case's citation checks against the state's published
laws — `citesLaw` to every statute chunk whose citation reference contains
it, `citesId` to every id with that prefix, `cites` to every manual law on
that page — and wrote `gold` where that came to one to four ids. Where it
came to none or more than four it printed the case and its candidates and
wrote nothing: a guessed gold is worse than none, because it attributes
every miss with confidence. Nationwide cases have no gold (their topic is
chosen at run time); a book case has one only where exactly one section
holds every fact. It never overwrites, so a gold somebody picked by hand
survives, and a second run changes nothing. The same script stamped `from`
from git history and marked one road-law case in ten `holdout` by a fixed,
seeded pick. It reads only local files and git, and costs nothing.

**How the initial set was populated, with Claude Code assisting.** The set
was written in Claude Code sessions, one pull request at a time, alongside
the behaviour each PR added — never generated in bulk, and never with the
model grading its own answers. Three methods, in the order they were used:

1. **The seed list (33 cases, 2026-10-01).** The design document
   (`docs/plans/learner-ask.md`, decision 12) named the questions the box had
   to handle before it existed — *do i need an account*, *can i use it on my
   laptop too*, *is this the real dmv test*, *what does it cost*, *cuánto
   cuesta*, and three follow-ups. In the session that built the box, Claude
   Code turned each into a case whose `expect` is the app's own fact: the
   device limit is 5, so the laptop answer must `lead` with `yes` and
   `contain` "5". These are `from: seed`.
2. **A few per state, at ingestion.** When a state's vehicle code was
   fetched and chunked (`/add-code XX`), the same session read the committed
   section files and proposed cases for it: a fact a learner would actually
   ask about, stated in the code as a number — the hydrant distance, the
   permit age, the under-21 BAC, the texting fine — with the figure read off
   the section into `contains` and the section into `citesLaw`, which is what
   `eval:gold` later resolved to the chunk's id. I reviewed each proposed
   case against the section text before it was committed; a case whose
   figure Claude Code could not point to in the file was dropped. Then
   `--state XX` ran, and a case the box got wrong was kept as a miss if the
   box was wrong, or corrected if the case was (a right answer that said
   "D.C." where the case wanted "District of Columbia" is how `contains`
   alternatives came to exist). Coverage was kept deliberately thin — one to
   seventeen cases a state, two in the middle — because every case is a paid
   model call on every run; the aim was a few hard, specific facts per state.
   These are `from: ingest`.
3. **A case for every failure.** When a real question was answered badly, or
   a run showed a miss, the fix came with a case that would have caught it.
   `notContains` is how a case remembers a wrong answer: Florida's hydrant
   case refuses `10 feet` and `20 feet` because an answer once said one of
   them. These are `from: failure`, with the commit that added them.

What made this a golden set rather than a pile of model output is the rule
every method shared: the expected value came from the source — the plan, the
statute file, the manual page — and a person checked it there before it went
in. Claude Code's part was reading the sections, proposing the question a
learner would ask and the figure it turns on, and writing the JSON; the
judgement of whether the figure was right, and whether the case was worth
its cost, stayed with me. Labelled production rows (stage 1) are the same
rule applied to live traffic.

**`scripts/learner-ask-eval.ts`** is the harness. Before any case runs, the
set is validated: two cases with the same question (by `questionKey` —
lower-cased, trimmed, whitespace collapsed, a trailing `?`, `.` or `!`
dropped) under the same state, or a `gold` id the state's published laws no
longer hold, stop the run naming the case, so a re-chunk that renamed ids is
loud rather than scored quietly wrong. Then, for each case:

1. It calls the real `answerLearner` with real dependencies — the state's
   published laws built from the committed corpus (or the production `laws`
   table with `--store`), Vectorize and the Workers AI reranker over
   Cloudflare's REST API (`CLOUDFLARE_API_TOKEN`, else `wrangler auth token`),
   Haiku and Opus through `ANTHROPIC_API_KEY`.
2. It reads the stage decisions from the outcome's own `trace` — the same
   value the worker writes to `learner_questions.trace` — and wraps the
   answering model to record what the trace does not hold: the text of the
   laws it was handed and its first raw reply. The wrap and the trace must
   name the same `given` laws or the run stops (`givenDrift`): a stage column
   computed from a different variable than production's would attribute a
   pipeline that does not run.
3. It takes what the learner would have been *shown* — empty if the checker
   refused — and scores it: `misses()` check by check against `expect`, plus
   the length/register rule, plus the **stage attribution** (stage 2).
4. It prints a markdown table — number, language and state, question, scope,
   the shown answer with citations, the verdict, the stage — then a summary
   block of per-stage metrics, and `N of M right`. `--json` writes the rows,
   the summary, `commit_sha`, `prompt_sha` (a hash of every block of the
   prompt in both languages), `corpus_hash` (a hash over the store manifest's
   per-state hashes) and `cost_usd` to `eval-run.json`; `--json-file <path>`
   writes it elsewhere. Every run is compared with
   `scripts/learner-ask-eval-baseline.json`, case by case, and the gate
   (stage 4) decides the exit code. Until the first whole run is accepted
   there is no baseline, and a run exits 1 on any miss.

A missed case prints its pool as ranked lines — `#3 MD-C-21-1003-m § 21-1003(m)
— 'A vehicle may not be parked … within 15 feet of a fire hydrant'` — with the
gold id marked and the chosen ids starred, so the right law is readable from
the terminal (`--explain`, on by default under `--state`, off under `--all`;
`--no-explain` turns it off).

`--state XX` to iterate; `--cases 56,72` for named cases; `--all` once per
PR — a whole run must be asked for by name, because it is live Opus and Haiku
for every case. Model calls go up as one Message Batch at half price
(`scripts/eval-batch.ts`), `--live` for one at a time; `--no-rerank` for a
before/after. Holdout cases run only in a whole run or when named with
`--cases`, and are reported in their own table and summary block, never in
the deltas a tuning pass reads. `--retrieval` runs the rephraser, retrieval,
the reranker and widening only, with an answering model that answers nothing,
for the cheap check (stage 6).

The partner page's own box has the same pair, `scripts/ask-eval.ts` +
`ask-eval.json` + `ask-eval-baseline.json`, and an older, smaller version of
the same idea; teach the learner box and mention it once.

---

## C. The lifecycle, stage by stage

Teach each stage as: *what it is → the failure it exists to catch → exactly
how it works in my app → what it costs → what it still cannot tell me.*

### Stage 1 — The golden set grows from production

**Sampling.** The `kb-cron` worker (`mcp/cron/index.ts`, Cloudflare cron
trigger `17 6 * * *`, its existing knowledge-check trigger) calls
`runNightly` from `worker/src/eval-cron.ts` after the knowledge check. Its
first step, `sampleForLabelling()`, takes up to `SAMPLE_SIZE = 20` of
yesterday's (the UTC day before the run) `learner_questions` rows into D1
**`eval_candidates`** (`question_id`, `sampled_at`, `reason`, `status`
(`open` / `labelled` / `skipped`)). It fills the twenty in tiers —
thumbs-downs first (`reason = rated_down`), then refusals (`refusal`), then
the rest (`random`) — because those are the rows most likely to be wrong, and
within each tier takes one row per stratum (`state`, `scope`, `lang`, `paid`,
`model`) in turn, so a night of Texas questions still queues the one from
Ohio. Every write goes through `addCandidate` (`worker/src/eval-candidates.ts`),
the queue's only writer, which refuses a question already queued under the
same state, whatever its status (by `questionKey`); the sampler then takes
the next row in that stratum, so ten learners asking Florida's hydrant
question cost the night one turn, not ten. A row never carries a learner id;
the question, the answer, the sources and the refusal reason are enough.

**Labelling.** The admin **Ask quality → To label** panel lists open
candidates newest first (`GET /api/admin/eval/candidates?status=open`): the
question, state, language, when, the reason it was sampled, what was shown
(or the refusal reason in words), and the rating. Opening one shows the
labelling card (`src/admin/Label.tsx`), built to find the law:

- **The pool, ranked** — the row's `trace.pool`, each law's citation and
  text read from `laws` by id (`GET /api/admin/eval/laws?ids=`), chosen laws
  starred, given laws marked, and every figure in the question highlighted
  wherever it appears in a law's text, spelled numbers included
  (`figuresIn`, in the question's own language), so a hydrant question
  lights up the one law that says fifteen. *This is the law* sets `gold`
  (several may be set).
- **The section, whole** — *Show its section* lists the law's neighbours in
  print order (`GET /api/admin/eval/section`), for the case where the figure
  is in (c) and the pool found (b).
- **Search** — the box's own retrieval over the state's laws, BM25 fused
  with Vectorize as `retrieve()` fuses them, top `SEARCH_LAWS = 12`
  (`GET /api/admin/eval/search?state&q`).
- **The fact, from the law** — clicking a highlighted figure in a gold law
  fills `contains`; `not_contains` is pre-filled with any figure the shown
  answer has that the gold law lacks.
- **The verdict** — *right*, *wrong*, *refusal was correct*, *refusal was
  wrong*, and a *Hold out* toggle. A *right* verdict needs a gold law. *Save*
  (`POST /api/admin/eval/label`) writes **`eval_labels`** (`question_id`,
  `labelled_at`, `verdict`, `contains`, `not_contains`, `gold`, `holdout`,
  `promoted_at`), marks the candidate `labelled` and moves on; *Skip*
  (`POST /api/admin/eval/skip`) marks it `skipped`. Keys: `j`/`k` next and
  previous, `g` gold on the focused law, `s` save.

A card never shows a learner id, a session or a code, and no eval route
returns `conversation`, `session` or `credit_code`.

**Promotion is a script and a PR, not a button.** `ADMIN_COOKIE=<CF_Authorization>
npm run eval:cases` (`scripts/eval-cases.ts`) reads unpromoted labels through
the admin route (`GET /api/admin/eval/labels`) — never with a database
token — appends each to `scripts/learner-ask-eval.json` with
`from: {kind: "labelled", row, on}` and `holdout` as labelled, writes
`promoted_at` back (`POST /api/admin/eval/promoted`), and leaves the fixture
changed and uncommitted for a person to put in a PR. A label whose question
is already a case under its state is refused, stays unpromoted and is named
on every run; relabelling a promoted label answers 409, so a case cannot be
appended twice. The PR's eval run (stage 4) is the first time the new case
is scored; a case that fails on arrival is a real regression already in
production, which is the point.

The fixture's own cases with no gold are not in the queue: a candidate is a
`learner_questions` row, and inventing rows for questions nobody asked would
put them into every production count. They were printed by `eval:gold` with
their candidates, for a person to resolve in the fixture.

**Cost.** Nothing at sample time; my time to label (about a minute a row;
twenty rows a night is more than I need, so most nights I label five).

**What it cannot tell me.** Anything about questions nobody asked. Rare
states stay thin until someone from them asks.

### Stage 2 — Every miss is attributed to a stage

**The attribution rule**, `stageOf()` in `scripts/eval-stage.ts`, applied to
a missed case, tested in the order a law travels so a law retrieval never
found is never put down to the reranker or the model:

| If … | Stage |
|---|---|
| no `gold` on the case (or no state trace) | **unattributed** (reported, so I know which cases need one) |
| gold not in `pool` | **retrieval** |
| in `pool`, not in `chosen` | **rerank** |
| in `chosen`, but the fact needed (the first `contains` entry) is in no `given` law's text | **widening** |
| the fact is in a `given` law and the model's raw reply lacks it | **generation** |
| the model's raw reply was right and the checker refused it | **checker** |

A shown answer that carried the fact and still missed — the lead word, the
register, a citation the model chose — is **generation** too: it is the
model's writing, not a check's refusal. A case every deterministic check
passed and the judge failed, while the judge is a gate (stage 3), is
**judge**. Under `--retrieval` only the first
three rows can be decided, and a case that got past the reranker has no
stage.

**The metrics**, in the summary block, in `eval-run.json` and in `eval_runs`:

- **Recall@pool**: share of cases with gold whose gold id was in the pool
  (24 or 32). **MRR**: mean of 1/rank of the gold id in the pool — a gold at
  rank 1 scores 1, at rank 8 scores 0.125, absent scores 0 — which tells me
  whether BM25 + the index are finding the law at all, and whether they put
  it where the reranker will see it well. Both are null over no gold cases,
  never 1.
- **Rerank survival**: of cases whose gold was in the pool, the share where
  it was among the `ANSWER_LAWS = 3`.
- **Widening coverage**: of cases whose gold was chosen, the share where the
  needed fact was in a `given` law.
- **Generation accuracy**: of cases with the fact in `given`, the share the
  model's raw reply got right.
- **Refusal precision and recall**: of refusals, how many the case allowed
  (`unanswered`/`mayRefuse`); of answers that should have been refused, how
  many were.
- A count per stage.

Each **`eval_runs`** row (`id`, `ran_at`, `trigger`, `commit_sha`,
`prompt_sha`, `corpus_hash`, `cases`, `right`, `recall`, `mrr`,
`rerank_survival`, `widening`, `generation`, `refusal_precision`,
`refusal_recall`, `judge_agreement`, `cost_usd`) is one run; **`eval_results`**
holds one row per case per run (`run_id`, `case_no`, `stage`, `ok`, `reasons`,
`shown`), which is what the Runs panel reads.

**What it cannot tell me.** Why retrieval missed — only that it did, and
where the gold sat in the pool. A retrieval miss sends me to the rephraser's
searches and the embedding text, by hand.

### Stage 3 — Deterministic checks, and a judge that is calibrated before it is trusted

**Deterministic first.** `contains`, `notContains`, `citesLaw`/`cites`/
`citesId`, `lead`, the `numbersIn` grounding check and the sentence count
decide most cases, cost nothing, and never disagree with themselves. Their
blind spot is meaning: an answer can contain "15", cite p.66, and say you
must park *at least* 15 feet from a hydrant when the law says *within*.

**The judge.** `worker/src/eval-judge.ts`, in the worker so the nightly job
and the harness ask the same model the same thing (`scripts/eval-judge.ts` is
its Node entry). `JUDGE_MODEL` is `HAIKU_MODEL`; `JUDGE_RUBRIC` is fixed, with
a JSON schema `{faithful, relevant, why}`, given the question, the shown
answer and the text of the laws it was given: *faithful* — is every claim in
the answer stated by the given laws ("at least" for "within" is a claim, and
false); *relevant* — does it answer the question asked, not a neighbouring
one. It runs on every shown answer of a `--all` run, as a column, and on
production every night (stage 5).

**Calibration.** `scripts/eval-judge-calibration.json` holds answers I
labelled myself (faithful / not, relevant / not) and the `lastRun` of the
judge over them. It is seeded from production —
`ADMIN_COOKIE=… npm run eval:calibrate -- --seed` reads the first sixty
labelled, shown answers through `GET /api/admin/eval/seed` — then labelled by
hand, then `npm run eval:calibrate` runs the judge over them, prints
agreement per answer and records it. The judge's verdict fails a case only
while `judgeGates` holds: a `lastRun` for this judge model, within
`CALIBRATION_DAYS = 90`, over at least `MIN_CALIBRATED_ANSWERS = 60`, at
`GATE_AGREEMENT = 0.9` or better. Every other state of the file — never run,
run for another model, run long ago, run at 0.7 — leaves the judge a column.
The file ships empty, so until I have labelled sixty answers the judge is a
column and nothing more. The recorded agreement goes to
`eval_runs.judge_agreement` and `answer_scores.judge_agreement`, so a score
says which judge produced it.

**The baseline.** `scripts/learner-ask-eval-baseline.json` is an accepted
`eval-run.json`: its per-case rows and per-stage summary, with the
`prompt_sha` and `corpus_hash` it was measured against. Every run reports
deltas against it, case by case — *newly right*, *newly wrong*, *stage
changed* — tuning and holdout apart. `npm run eval:accept` copies
`eval-run.json` over it, and refuses a partial run (`--state` or `--cases`),
since every case it did not run would leave the deltas. Accepting is a
reviewed change in the PR, so "the score went down and we accepted it" is
written down with its reason. The first baseline is the first whole paid run
somebody accepts.

**Cost.** One Haiku call per shown answer, a few cents a full run.

### Stage 4 — Runs in CI, gated, against the baseline

**`.github/workflows/eval.yml`** runs `npm run ask:eval:learner -- --all
--store --json` on three triggers: `workflow_dispatch`; a pull request
touching the pipeline's files (`worker/src/learner-*.ts`,
`worker/src/law-*.ts`, `worker/src/code-chunks.ts`, the learner book's `.md`
and `.json`, `scripts/learner-ask-eval*.json`, `resource/statutes/**`,
`resource/process/**`, `resource/penalties/**`); and the label `run-eval` on
any pull request, through **`.github/workflows/eval-label.yml`**, which calls
`eval.yml` (`workflow_call`). The label lives in its own file because GitHub
applies a `paths` filter to the `labeled` activity too: in one file, the
label would do nothing on exactly the pull requests it exists for. Never on
push, and no schedule: the weekly `0 4 * * 1` line is in the file, commented,
while Actions billing keeps `regression-tests` paused, to be turned on in the
PR that re-enables it.

**Secrets**, set with `gh secret set`: `CLOUDFLARE_API_TOKEN` — an API token
made for this, scoped *Workers AI: Read*, *Vectorize: Read*, *D1: Read* on
`learners-permit`, and nothing else, so a PR branch can never write to
production; `ANTHROPIC_API_KEY` — a key made for CI, so it can be revoked
without touching mine; and `EVAL_INGEST_KEY`. The job's first step checks
all three are set and fails naming the missing ones before anything is
installed or paid for: an unset secret arrives as an empty string, and an
empty Cloudflare token would otherwise surface as a 401 a case, which reads
like an outage. The install pins `npm install -g npm@11.21.1` before
`npm ci`, because Node 20's npm 10.8.2 cannot read this lockfile. The
harness takes `CLOUDFLARE_API_TOKEN` before it would try `wrangler auth
token`, which is what makes a runner with no browser login work. Both eval
workflows are disabled on GitHub until those secrets exist.

**Recording the run.** The job cannot write D1 with a read-only token, so it
posts `eval-run.json` to the worker at `POST /api/eval/runs`
(`worker/src/eval-ingest.ts`), with the key in an `X-Eval-Ingest-Key` header
(a header with an underscore can be dropped by a proxy). Without the key it
answers 401; with no `EVAL_INGEST_KEY` secret on the worker it answers 503,
never open. It takes only a whole, full run — a 40-character commit (the
PR's head, `EVAL_COMMIT_SHA`, not GitHub's temporary merge commit), a
`trigger` from a fixed list (`dispatch`, `label`, `paths`, `schedule`,
`manual`), at most 1,000 rows — validated field by field and written to
`eval_runs` and `eval_results` in one batch. The table is uploaded as a job
artifact and posted on the PR by `gh pr comment` (its last 60,000 characters
when longer); upload, comment and record all run even when the gate failed,
because a failed gate is the run somebody needs to read.

**The gate** is the harness's exit code, not the workflow's (`gateOf` in
`scripts/eval-stage.ts`). A run fails when: a `holdout` case is newly wrong —
one is enough, since holdout is the only honest witness that a change
generalises; two or more tuning cases are newly wrong in the same stage — a
loss with a shape; or recall@pool or generation accuracy is more than 2
points below the baseline's. A lone tuning case newly wrong is reported and
passes. The flake allowance is spent only on holdout: when exactly one
holdout case is newly wrong, it is re-run once, live, and its second answer
is the one that counts, is printed and is recorded (`rerun: {n, ok}` in
`eval-run.json`). A failed gate is a red check; `eval:accept` in the PR is
the written override.

**Cost**, per full run: ~200 Opus answers at `effort: low` with the cached
book, ~200 Haiku reranks and rephrases, a Haiku judge call per shown answer,
a few hundred embedding and Vectorize queries. Live, that was about ten
dollars at 130 cases; batched, half the model calls' price. `cost_usd` is computed from the usage the SDK
returns at list prices (`scripts/eval-cost.ts`, prices in
`worker/src/list-prices.ts`), with cached input priced as fresh, so it is an
upper bound, measured, not guessed.

**What it cannot tell me.** Whether a change helped the questions real
learners ask this week; that is stage 5.

### Stage 5 — Production is scored every night

**The judge, nightly.** After sampling, `runNightly`'s `scoreYesterday()`
takes yesterday's shown answers not yet scored — every one, or a random
`SCORE_LIMIT = 200` — and runs the judge on each against the text of what its
`sources` name: a law's citation and words from `laws`, or the book's
section. An answer none of whose sources can be read is counted
`unjudgeable`, not judged against nothing. Refusals need no judge: their
`model` column already says why. Results go to **`answer_scores`**
(`question_id`, `scored_at`, `faithful`, `relevant`, `judge_model`,
`judge_agreement`). `kb-cron` needs its own `ANTHROPIC_API_KEY` secret for
this; without it the night logs, in a line of its own, that nothing was
judged, and the day's rates stay null — never read as "nothing unfaithful".
Five judge failures in a row end the night's scoring.

**The daily rollup.** `rollUpDay()` writes one **`ask_daily`** row (`day`,
`asked`, `shown`, `refused`, `reasons` — one JSON object of refusal counts by
reason, e.g. `{"road-law:ungrounded": 3}`, so a new reason needs no
migration — `faithful_rate`, `relevant_rate`, `rated_up`, `rated_down`,
`p50_latency_ms`, `p95_latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`)
from `learner_questions`, `answer_scores` and `answer_ratings`, counted over
the questions asked that day. `shown` is an answer that is not `''`. The cost
prices every token at the answering model's list price — an upper bound,
because a row's tokens are the whole turn's. The night rolls up the day
before yesterday again beside yesterday, so a rating pressed after 06:17 UTC
still reaches its day.

**The rating.** Each shown answer carries a thumbs up/down under its card
(`AskBox.tsx`, `ask-rate-up` / `ask-rate-down`; never on a refusal); the tap
posts `{conversation, questionId, rating}` to `POST /api/ask/rate`, which
writes **`answer_ratings`** (`question_id`, `rating`, `rated_at`) only where
the row has that id *and* that conversation — so only the browser holding
the thread can rate it — and answers 204, or 404. The choice is kept in the
thread, so a reload shows it. A thumbs-down also goes through `addCandidate`
with `reason = rated_down`, so it is in the labelling queue; that is the loop
closing back into stage 1.

**The admin tab.** The *Daily* panel draws 30 days of `ask_daily` — asked and
shown as bars, and a table of refusals by reason, faithful and relevant
rates, ratings, p50/p95 latency and cost — and every figure opens onto its
rows (`GET /api/admin/eval/day?day=`), the way the Learners tab does. The
*Runs* panel lists `eval_runs` newest first with the per-stage numbers and
the commit, draws recall, rerank survival and generation over time, and
opens a run onto its `eval_results` grouped by stage.

**Reading it.** An `ungrounded` spike with the corpus unchanged is a prompt
or model problem; `road-law:no-laws` rising in one state means its index or
file is behind; `scope:road-law` rising means learners asking the wrong box,
which is a product question, not a pipeline one; a faithful rate drifting
down with no deploy is the model vendor moving under me.

**Alerting.** `alertOnDaily()` sends one email through `kb-cron`'s
`SEND_EMAIL` binding to `KB_ALERT_TO` when, over the three days ending
yesterday: the faithful rate is under 0.9; `ungrounded` refusals are over 15%
of shown; thumbs-downs are over 20% of ratings; or p95 latency is over twice
the median daily p95 of the thirty days before. Each has a floor
(`ALERT_FLOORS`: 30 judged answers, 30 shown, 10 ratings, 30 answered, and 7
days of history for the median), so one thumbs-down of one rating is not
"100% rated down". The faithful-rate alert never fires while the judge is
uncalibrated. A figure is mailed on the night it newly crosses — crossed over
the three days ending yesterday and not over the three ending the day before
— so a rate that stays low for a week is one email, not seven, and no state
is kept beyond `ask_daily`. The email names each figure and links
`/admin/?tab=quality`; the first look is always the rows behind it.

**Cost.** One Haiku call per shown answer per day — at today's volume,
cents.

**What it cannot tell me.** Whether an answer was *correct*; the judge sees
only faithfulness to what was cited. Correctness still needs a label, which
is why thumbs-downs go to the queue rather than straight to a score.

### Stage 6 — The corpus is a dependency, and moving it re-runs the eval

Retrieval can change with no line of code changing. Four events do it, and
each ends with an eval:

- **`laws:store --push XX`** and **`laws:embed --push XX`** end, for each
  state pushed, by running `ask:eval:learner -- --retrieval --state XX` as a
  child process (`scripts/push-eval.ts`) and writing the state's recall and
  MRR as `evalRecall` and `evalMrr` beside its hash in
  `resource/laws-store.json` / `resource/law-vectors.json`, so the manifest
  says not only *what* was pushed but *how well it retrieves*. Be exact about
  what that figure measures: the harness runs without `--store`, so it reads
  every law's text from the committed corpus and ranks with the production
  Vectorize index — never with the D1 table `laws:store` just wrote. The
  figure beside the embed's hash is the index just written (the push waits
  for Vectorize to report its last upsert applied — up to ten minutes —
  and writes `null` with the reason if it does not). The figure beside the
  store's hash is the same measurement taken again: it says the committed
  corpus retrieves this well against the current index, not that the table
  was read. A state embedded then stored is measured twice, and the two
  figures should agree. A state with
  no road-law case, or none with a gold law, writes `null` and says so —
  never a perfect recall over nothing. So does a run that could not be made:
  no `ANTHROPIC_API_KEY` (the rephraser and reranker would not be
  production's), a harness that exited 2, or one stopped at its 45-minute
  limit (`EVAL_TIMEOUT_MS`). The push is never undone by its
  eval — the rows are in production by then — and the figures are set to
  `null` the moment the hash changes, so a run that dies in the eval never
  leaves the last corpus's figures beside the new hash. `--no-eval` skips the
  eval and leaves the figures as they were.
- **`statutes:refresh`** runs monthly in **`.github/workflows/refresh.yml`**
  (05:00 UTC on the 1st, and by hand). The whole refresh is over nine hours
  at one request a second and a hosted job is killed at six, so it runs in
  eight shards (`scripts/statutes/refresh-ci.ts`, the same three passes as
  `npm run statutes:refresh -- XX` for each shard's states), whose reports
  are merged into the day's. When the merged report lists a changed section,
  it runs `ask:eval:learner -- --retrieval --all --json` — no answering
  model, cents. It then commits the reports on `refresh-codes-<day>-<run id>`
  (the checkout keeps no credentials; the write token reaches only the last
  step, which pushes) and
  opens a PR with the refresh's table, each changed section's diff, the
  verdict laws and chips resting on what moved, and the eval's table. That
  eval measures the corpus *as committed*, before anybody applies the change:
  the refresh only reports, and the figure it records is the one the state's
  push, after the change is applied, is read against. The workflow does
  nothing until its secrets are set — its first job names the missing ones
  and the rest are skipped. A new workflow file lands enabled, so it is
  disabled on GitHub right after it merges (`gh workflow disable
  refresh.yml`), and I turn it on with `gh workflow enable refresh.yml` once
  its secrets are set and Actions may open pull requests.
- **A re-chunk** (`CHUNK_CHARS`, the label rules in `code-chunks.ts`) changes
  ids, so it is its own PR, gated by the full eval — its paths are the
  pipeline's — and followed by a push and an embed of every state; the
  validation (section B) stops any case whose gold was renamed.
- **Adding a state** adds its cases in the same PR (`from: ingest`), and the
  PR's eval is the first run that includes them.

The existing hash guards still do their job: a corpus change deployed
without a push is red in the unit suite before any eval runs.

**What it cannot tell me.** That a law's *meaning* changed. `refresh` sees
bytes; a repealed subsection that is still served reads as unchanged.

### Stage 7 — The set is code

- Each case carries `from`, and a run and the baseline carry `commit_sha`,
  `prompt_sha` and `corpus_hash`, so any score can be placed against the
  code, prompt and corpus it measured.
- The harness refuses to run on a set with two cases of the same question
  and state, or a `gold` id its state's published laws do not hold, so a
  re-chunk that renamed ids breaks the set loudly rather than scoring it
  quietly wrong. The suite runs the same validation over the committed
  fixture, so it is red before any paid run.
- `holdout` cases are reported but never used to tune: they run only in a
  whole run, in their own block, and their pools are not printed. A prompt
  change is judged on the open cases and *confirmed* on the holdout.
- A case is never deleted: it is retired with a reason, so no other case's
  number moves and `eval_results` stay comparable across runs.
- The eval goes through `answerLearner` with injected dependencies, never
  around it. An eval that called the model with hand-built prompts would
  measure a pipeline that does not exist.

---

## D. What I want to be able to do afterwards

1. Given a failing row in the eval table, name the stage and say which
   column proves it.
2. Read the Ask quality tab on a given morning and say whether what I see is
   a prompt problem, a corpus problem, a model-vendor problem or a product
   problem — and which rows to open first.
3. Walk a thumbs-down from the learner's screen to a committed case: every
   table it touches, every script, every screen.
4. Explain the gate: what blocks a PR, what the flake allowance is, and why
   a holdout miss is treated differently.
5. State what a full run costs and what the nightly scoring costs, and where
   the number comes from.
6. Explain the read-only token and the ingest key — why CI can read
   production but not write it, and how the run still gets recorded.

---

## E. How to run the lesson

- One stage per turn. Open each with a two-sentence summary, then the
  detail, then a question that makes me apply it (e.g. "a case misses with
  `does not cite § 21-1003(m)` and the answer says 15 feet; `gold` is
  `MD-C-21-1003-m`, which is in `pool` at rank 11 and not in `chosen` — which
  stage, and what single number in the summary block would move if I fixed
  it?").
- Wait for my answer. Correct it. Only then move on.
- Use my names — files, functions, constants, tables, columns — over generic
  terms. If a detail is not in this document, ask me to look it up.
- At the end, give me a one-page summary I can keep: the seven stages, the
  tables each one writes, and the two questions each one answers.

---

## F. The public reading copy

The ask path and its whole eval lifecycle are published as a reading copy at
`github.com/AiFirstDevelopment/howards-lantern-rag-pipeline`, paths
preserved. Its README says what is left out: the rest of the app,
`worker/wrangler.toml`, the partner knowledge bases and every key. The CI
workflows (`eval.yml`, `eval-label.yml`, `refresh.yml`) and
`scripts/statutes/refresh-ci.ts`, which only `refresh.yml` runs, are left out
too: the public repository holds no secrets, and `eval.yml`'s last step posts
to the production worker. It is kept in step by
`npm run public:mirror -- --into <clone> [--pr]` (`scripts/public-mirror.ts`),
which copies a fixed list of paths from this repository's `origin/main`
into a clone of the public one, deletes a listed path `main` no longer has,
prints what changed, and with `--pr` commits, pushes and opens the pull
request there. Nothing off the list can reach the copy, so the exclusions
hold by construction rather than by care, and a unit test
(`tests/unit/public-mirror.test.ts`) holds the list to the import closure of
the harness, the nightly job, the admin eval routes and the Ask quality tab,
so the public harness always resolves. Running it is mine to do after each
deploy: it pushes to another repository.
