# The eval: the golden set and the harness that runs it

The test suites in this repo never call the model. The worker suite injects a
scripted one and drives everything around it; the Playwright suite stubs
`/api/ask` at the network edge. That is deliberate — a real model call costs
money and does not give the same answer twice — but it leaves one question
nothing in `npm test` can answer: *does the box actually answer well?*

The eval is the one thing that measures that. It is two files:

- **`scripts/learner-ask-eval.json`** — the *golden set* (also called the
  fixture): 202 questions, each with the facts a right answer must carry.
- **`scripts/learner-ask-eval.ts`** — the *harness*: the script that runs every
  question through the real pipeline against the live model, scores what the
  learner would have been shown, and prints a table.

It is run by hand, before a change to the prompt, the model, retrieval or the
corpus, and its table goes in the pull request. `docs/plans/learner-ask.md`,
decision 12, is where that rule was set.

## The golden set

### What a case looks like

```json
{ "lang": "en", "state": "FL",
  "question": "How far from a fire hydrant can I park?",
  "expect": { "scope": "road-law", "contains": ["15"],
              "notContains": ["10 feet", "20 feet"], "cites": ["66"] } }
```

A case is a question as a learner would type it — lower case, no state named
in the words, sometimes in Spanish — the state chosen on the screen, and an
`expect` block saying what the shown answer has to do. The checks are partial
on purpose: not a reference answer to match, but the few facts that make an
answer right or wrong.

| `expect` field | What it pins | Used by |
|---|---|---|
| `scope` | how the model classed the question: `road-law`, `app`, `price`, `promise`, `other` | every case |
| `contains` | words the answer must have; an entry that is a list is met by any one of it (`"District of Columbia"` or `"D.C."`) | 163 |
| `citesLaw` / `cites` / `citesId` | the statute section, manual page, or page id a shown citation must name | 91 / 12 / 35 |
| `lead` | the first word of a yes-or-no answer: `yes`, `no`, `sí` | 24 |
| `path` / `states` | nationwide: which answering path, and how many states must be cited | 8 / 3 |
| `notContains` | wrong figures a bad answer once carried | 7 |
| `unanswered` / `mayRefuse` | nothing the model wrote may be shown; or a refusal counts as right | 4 / 1 |

Three cases carry a `history` — earlier turns of the same thread — so a
follow-up ("and on a tablet?") is tested as a follow-up.

### How it was built

The set was not written in one sitting and it was not generated from the
corpus. It grew one pull request at a time, in Claude Code sessions, alongside
the behaviour each PR added — so every case was written by somebody who had
just read the source it tests against. The git history of the file shows the
shape of that:

| Date | Cases | What landed with them |
|---|---|---|
| 2026-10-01 | 33 | the box itself: 22 questions about the app, the price and the promise, five about road law, three follow-ups — the seed list from the design document |
| 2026-10-05 | 44 → 52 | road law from the state's manual, then from its code, then the vector index |
| 2026-10-06 onward | +1 to +18 a state | each state's vehicle code as it was ingested — 46 states by the end |
| 2026-10-10 | +13 | nationwide comparisons across all the states |
| 2026-10-11 | +penalty and page cases | the court's fine schedules and the licensing agency's own pages |
| 2026-10-14 | 202 | Spanish questions searched in English; five more nationwide topics |

Within that, the cases come from three places.

**The design document's list.** The first 33 are the questions the plan named
before the box existed: *do i need an account*, *can i use it on my laptop
too*, *is this the real dmv test*, *what does it cost*, *cuánto cuesta*. Their
expectations are the app's own facts — the device limit is 5, so the laptop
answer must contain `5` and lead with `yes`.

**Ingesting a state.** When a state's vehicle code was fetched and cut into
subsections, a few cases were written for it in the same PR. The method, as
the cases show it: pick a fact a learner would actually ask about and that
the state's code states as a number — the hydrant distance, the permit age,
the under-21 blood-alcohol limit, the texting fine — read the figure off the
section, and write the case with that figure in `contains` and the section in
`citesLaw`. The expected answer therefore comes from the statute, never from
what the model said: the model is graded against the source, and the
citation check keeps it from being right by accident with the wrong law.
Coverage is deliberately thin per state — one to eighteen cases, two in the
middle — because every case is a paid model call on every run; the aim was a
few hard, specific facts per state rather than many easy ones.

**A failure.** When a real question was answered badly, or a run showed a
miss, the fix came with a case that would have caught it. `notContains` is
how a case remembers a wrong answer: Florida's hydrant case refuses `10 feet`
and `20 feet` because an answer once said one of them. The `contains`
alternatives were added the same way, after a right answer was marked wrong
for saying "D.C." where the case wanted "District of Columbia" — the fix was
to the case, not the model.

So the set is a golden set in the usual sense — the expected values were
checked against the source by a person before they went in — but each case
pins only the facts that matter, so a reworded answer that is still right
still passes.

## The harness

`scripts/learner-ask-eval.ts` does, for each case:

1. **Builds the real pipeline.** It calls `answerLearner`, the same function
   the worker runs in production, with real retrieval — the state's published
   laws built from the committed corpus, the vector index and the reranker
   over Cloudflare's REST API, the rephraser, the fine schedules, the agency
   pages. The only thing swapped in is the model client, which goes to the live
   model with a real key. `--store` reads the laws from the production table
   instead of the corpus, and `--no-rerank` runs without the reranker so a PR
   can show both scores.

2. **Takes what the learner would have seen.** The answer when the worker's
   checks pass; an empty string when they refused it. A right answer the
   grounding check would have refused on the wire is a miss here too, because
   nobody would have read it.

3. **Scores it.** `misses()` compares the shown answer and its citations with
   the case's `expect` block, check by check, and the register check holds
   every road-law answer to the box's length rule — two sentences, three for a
   "what happens if", and no law's name or number in the prose. Each failed
   check becomes a reason in words.

4. **Prints a row** of a markdown table: number, language and state, the
   question, the scope the model chose, the answer with its citations, and
   either `ok` or the reasons. The last line is `N of 202 right`. The table is
   what goes in the pull request, so a reviewer reads the answers, not a score.

5. **Exits non-zero on any miss**, so a prompt change that broke a case cannot
   be called "about the same".

Because every case costs a model call, the harness refuses to run with no
arguments: `--state XX` runs one state's cases while iterating, and `--all`
runs the whole set once, for the PR. By default the calls go up as one
Message Batch at half the price and come back in minutes; `--live` sends them
one at a time, as the worker does, when you need the answer now.

```sh
ANTHROPIC_API_KEY=… npm run ask:eval:learner -- --state MD    # iterate
ANTHROPIC_API_KEY=… npm run ask:eval:learner -- --all         # before the PR
```

## What it is not

- **Not deterministic, and not in `npm test`.** A run can differ from the last
  one by a case or two; the table says which, and a reviewer decides whether
  that is the change or the model.
- **Not a routing test.** Whether the challenge fires on turn one, whether the
  ceiling holds, whether a turn is claimed before the model is asked — the
  worker suite proves those with a scripted model, deterministically.
- **Not complete.** Forty-six states at a median of two cases each is a
  sample, not coverage. A question nobody has asked yet is not in the set until
  it is answered badly and somebody adds it.

## Adding a case

Write the question the way a learner would; choose the state; read the fact
off the source — the manual page or the code section — and put the figure in
`contains` and the reference in `cites`, `citesLaw` or `citesId`. Run the
state's cases, read the row, and if the model is right and the case says
otherwise, fix the case. Then `--all`, and the table in the PR.

The partner page's box has its own pair, `scripts/ask-eval.ts` and
`scripts/ask-eval.json`, built the same way, with `ask-eval-baseline.json`
holding the last accepted run to diff against.
