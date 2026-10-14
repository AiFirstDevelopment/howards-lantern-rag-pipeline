# Code walkthrough: the ask box, one hop at a time

A reading guide to the RAG pipeline in this repository, written as a sequence of
hops that follow one question from the browser to the model and back, then the
offline work that builds what the hops read. Each hop names the files and lines
to open, what happens there, what to notice, and a question to check yourself
with. Read the hops in order; each assumes the ones before it.

Line numbers were taken on 2026-10-14 against commit `7728a29`. The README's own
map is the companion to this: it says why each stage exists, this says where to
look and what to see.

**How to use it.** Open the file named in "Where", read the lines, then the
notes. The "Check" question has an answer somewhere in the lines you just read.
A session log at the bottom records which hops have been walked.

---

## Part 1: the request path

One question, with a state chosen, through eight hops.

### Hop 1: the browser sends the question

**Where:** [src/screens/Ask.tsx:218-243](src/screens/Ask.tsx#L218-L243) builds the call,
[src/api.ts:270](src/api.ts#L270) sends it.

The screen's `send` handler counts the question against the week (or marks it
paid), picks the state, and calls `askLearners`, which is one line:
`post('/api/ask', input)`.

```ts
const answer = await askLearners({
  ...input,                                   // conversation, question, turnstile
  lang,
  state: nationwide ? NATIONWIDE : stateCode, // 'US' when the box is ticked
  ...(paid ? { spend: tokens.code ?? '' } : {}),
  ...(tokens.code !== null ? { code: tokens.code } : {}),
})
```

The wire shape:

| field | what it is |
|---|---|
| `conversation` | a UUID per box instance, so the worker can replay the thread |
| `question` | the raw text, not yet scrubbed |
| `turnstile` | Cloudflare's bot-challenge token |
| `lang` | `en` or `es`, which picks the rule text the model gets |
| `state` | a two-letter code, `null`, or `US` |
| `spend` / `code` | a purchased question code, if any |

**Notice.**

- One field, `state`, decides the whole path on the worker. `null` is an
  app-only question, `US` is nationwide, anything else is one state's road law.
  `NATIONWIDE` is `'US'` on purpose ([src/topics.ts](src/topics.ts)) so a worker
  deployed before the feature treats it as an unknown state and refuses safely.
- The browser sends no law text and gets none back as prose. The response type
  [AskAnswer](src/ask.ts#L10) carries `answer`, then `citations` as
  `{ id, location, kind, asOf }` the browser renders itself. The model's words
  and the citation under them come from two different places by design.
- Free questions are counted client-side before the send
  ([src/ask-quota.ts](src/ask-quota.ts)). Paid ones are debited by the worker only.
- The browser and the worker are separate builds, so shared values are
  duplicated and cross-referenced in comments rather than imported:
  `NATIONWIDE`, `NUMBER_WORDS`, `TOKENS_PER_QUESTION`.

**Check:** what does the worker receive when no state is chosen and nationwide is
not ticked?

### Hop 2: the Pages Function proxies to the worker

**Where:** [functions/api/[[path]].ts:40](functions/api/[[path]].ts#L40), and
before it [functions/_middleware.ts:39](functions/_middleware.ts#L39).

The site is served by Cloudflare Pages. A request to `/api/*` on the site's own
origin is caught by this function and re-fetched against the worker's address
(`API_ORIGIN`, defaulting to a `workers.dev` host). Method, body and content
type pass through unchanged. The headers get one addition: `withVisitorGeo`
copies the visitor's own country and region onto the outgoing request, because
re-fetching makes the edge the client and the worker would otherwise see
Cloudflare's own geography.

The middleware runs first on every request: a `302` to the canonical host if
the site is reached by another name, a `308` to the canonical spelling of a
path, otherwise `context.next()`.

**Notice.**

- The header comment says why this hop exists: Safari classified
  `pages.dev` to `workers.dev` as a cross-site tracking shape and silently dropped
  the requests. Same origin means no CORS preflight and nothing to classify.
- The worker still attaches CORS headers. On this path they are unused.
- `302` versus `308` is a deliberate pair: a product decision that can be
  revisited gets the temporary code, a spelling gets the permanent one.

**Check:** why is the body passed as a stream with `duplex: 'half'` instead of
being read first?

### Hop 3: the worker routes and wires the pipeline

**Where:** [worker/src/index.ts:278-295](worker/src/index.ts#L278-L295), then
[index.ts:1159-1180](worker/src/index.ts#L1159-L1180) for `lawsFromPages` and
`listFromPages`.

The route is one `if` on `/api/ask` and `POST`. Everything the pipeline will
need is assembled right there as a bag of functions, the `LearnerDeps` object:

| field | factory | binding or key it needs |
|---|---|---|
| `askLearner` | `learnerAskerFor` | `ANTHROPIC_API_KEY` |
| `lawsFor` | `lawsFromPages` | none, fetches the site's own static file |
| `nearLaws` | `nearLawsFor` | `AI` and `LAWS` (Vectorize) |
| `rerank` | `firstOf(haikuRerankFor, rerankFor)` | the key, then `AI` |
| `rephrase` | `haikuRephraseFor` | the key |
| `topics`, `topicLawsFor` | `listFromPages` | none |
| `topicsFor` | `haikuTopicsFor` | the key |
| `nearLawsNationwide` | `nearLawsNationwide` | `AI` and `LAWS` |
| `lawsById`, `lawsBySection`, `penaltiesFor`, `processRowsFor` | `*ForDb` | `DB` (D1) |
| `verifyTurnstile` | `turnstileFor` | `TURNSTILE_SECRET` |

**Notice.**

- Every factory returns `undefined` when its binding or key is missing, and the
  pipeline treats an absent function as "this stage does not exist". That is the
  whole degradation story: the box with no Vectorize binding is the box as it
  was before Vectorize existed.
- `firstOf` ([law-rerank.ts:140](worker/src/law-rerank.ts#L140)) tries Haiku and
  falls to the cross-encoder on a throw. The caller falls past both.
- `listFromPages` fetches `https://howardslantern.com/ask-laws/MD.json` with
  the edge cache set to one hour for a `200` and zero for anything else. The
  comment says why: a cached `404` would keep refusing road law for an hour
  after the deploy that publishes the file.
- The worker reads the site's own published static file for the words it
  shows. D1's `laws` table is used only for lookups by id and by section.

**Check:** what does the box do if `ANTHROPIC_API_KEY` is set but the `AI`
binding is not?

### Hop 4: the handler guards the door

**Where:** [worker/src/learner-api.ts:203-290](worker/src/learner-api.ts#L203-L290)
is `handleLearnersAsk`; the helpers it calls are above it in the same file.

In order:

1. `readAsk` ([:105](worker/src/learner-api.ts#L105)) validates the body: a UUID
   conversation id, a non-empty question of at most 500 characters
   (`MAX_QUESTION_CHARS` in [ask.ts:81](worker/src/ask.ts#L81)), a state matching
   `/^[A-Z]{2}$/` or null, the language, and the question codes.
2. The question is scrubbed once: `scrub` ([validate.ts:125](worker/src/validate.ts#L125))
   removes codes, ids and e-mail addresses; `withoutPhones`
   ([:303](worker/src/learner-api.ts#L303)) removes phone numbers. Nothing after
   this line sees the original.
3. `turnsOf` ([:135](worker/src/learner-api.ts#L135)) reads the conversation's
   earlier rows from `learner_questions`, oldest first. A thread is capped at
   `MAX_TURNS = 10`.
4. The cost is set: a nationwide question costs more tokens than a state one
   ([src/pricing.ts](src/pricing.ts)). A paid question's balance is checked, or a
   free one is checked against the site's daily ceiling of 300 free questions
   (`pastCeiling`, [:159](worker/src/learner-api.ts#L159)).
5. Turnstile is verified on turn one only.
6. A paid question is debited in one conditional `UPDATE`, before the model is
   asked.
7. `claimTurn` ([:172](worker/src/learner-api.ts#L172)) purges rows older than
   180 days and inserts this turn with `model = 'asking'`.
8. `answerLearner` runs (hops 5 to 7).
9. If the outcome is in `REFUNDED` ([:127](worker/src/learner-api.ts#L127)), the
   token goes back. The row is then updated with what was shown and why.

**Notice.**

- The ceiling and the balance are checked before the Turnstile challenge
  because a Turnstile token is single-use. Spending it on a request that was
  going to be refused strands the visitor.
- The row records what the learner saw, not what the model wrote. The next
  turn replays that, so a refused turn is a refused turn in the thread too.
- `REFUNDED` draws a line: an outage is ours and refunds; "the law does not
  say" is an answer and does not.

**Check:** a paid question's balance is read at step 4 and debited at step 6.
What can happen between them, and which of the two decides?

### Hop 5: retrieval finds the candidate laws

**Where:** [worker/src/learner-ask.ts:1200-1246](worker/src/learner-ask.ts#L1200-L1246),
the first half of `answerLearner`. Follow each call into its module.

The sequence, for a state question:

| step | call | module and line | what it yields |
|---|---|---|---|
| fetch | `pipeline.lawsFor(state)` | [index.ts:1159](worker/src/index.ts#L1159) | the state's whole retrieval file, every law |
| meaning | `pipeline.nearLaws(state, question)` | [law-vectors.ts:62](worker/src/law-vectors.ts#L62) | up to 8 ids from Vectorize, scored at least 0.5 |
| rephrase | `pipeline.rephrase(question)` | [law-rephrase.ts:96](worker/src/law-rephrase.ts#L96) | one or two searches in the code's words, and a process family |
| meaning again | `nearLaws(state, search)` per search | same | ids for each search |
| fallback | `retrieve(laws, question, 8, near, searches)` | [law-retrieval.ts:148](worker/src/law-retrieval.ts#L148) | the eight laws the box used before the reranker existed |
| pool | `retrieve(laws, question, 24 or 32, near, searches)` | same | the wider pool the reranker reads |
| family | `withFamily(pool, state, family, processRowsFor)` | [learner-ask.ts:1140](worker/src/learner-ask.ts#L1140) | the DMV page rows for the named family, added by key |
| rerank | `chooseLaws(pool, fallback, question, rerank)` | [law-rerank.ts:174](worker/src/law-rerank.ts#L174) | three laws, plus any page rows Haiku put in its top three |
| family beside | `familyBeside(chosen, pool, family, texts)` | [learner-ask.ts:1169](worker/src/learner-ask.ts#L1169) | the family's best row, if the reranker chose none |

Inside `retrieve`:

- `words` ([:121](worker/src/law-retrieval.ts#L121)) lower-cases, drops stop
  words, and folds a plural `s`. "park" and "far" are kept on purpose.
- `bm25` ([:233](worker/src/law-retrieval.ts#L233)) scores each law's rule,
  card question and concept against the query's words, with `k1 = 1.2` and
  `b = 0.75`. `spelledAs` ([:282](worker/src/law-retrieval.ts#L282)) maps a word
  the laws don't use to one they do, by containment or one edit.
- The BM25 list, the vector list, and each search's two lists are fused by
  reciprocal rank with `k = 60` ([:173](worker/src/law-retrieval.ts#L173)). No
  raw scores are compared across lists.
- Process rows are not ranked by words (`ranked`,
  [:212](worker/src/law-retrieval.ts#L212)); they reach the pool by family key or
  by meaning.

Inside `chooseLaws`:

- Haiku gets the question and the pool, numbered, and names up to five that
  answer it, best first. The cross-encoder (`@cf/baai/bge-reranker-base`)
  scores every law on likeness. Three go forward (`ANSWER_LAWS`).
- Two protections apply only to the cross-encoder: retrieval's first choice
  keeps a place, and the manual's best keeps a place. The comment at
  [:200-215](worker/src/law-rerank.ts#L200-L215) says why they are switched off
  for Haiku.

**Notice.**

- The rephraser's header comment is the clearest statement of why it exists:
  "highest posted speed limit" ranked Texas's 70 mph law 25th; "maximum speed
  limit on a highway in miles per hour" ranked it 1st.
- The vector index returns ids only, and `retrieve` drops any id the file does
  not hold. A stale index can rank badly but cannot put wrong text on screen.
- `NEAR_ENOUGH = 0.5` is set for recall. The comment at
  [law-vectors.ts:28-41](worker/src/law-vectors.ts#L28-L41) gives the measured
  score bands and why the cutoff sits inside the overlap.
- The pool widens from 24 to 32 when searches were fused, because fusion moves
  laws out as well as in ([law-rerank.ts:46-58](worker/src/law-rerank.ts#L46-L58)).

**Check:** the fallback and the pool are both produced by `retrieve`. Why is the
fallback not simply the pool's first eight?

### Hop 6: widening gives the model whole sections, the fine, and the page

**Where:** [worker/src/learner-ask.ts:1246-1248](worker/src/learner-ask.ts#L1246-L1248),
calling `wholeSections` ([:1021](worker/src/learner-ask.ts#L1021)),
`withPenalties` ([:1080](worker/src/learner-ask.ts#L1080)) and `pagesLast`
([:1186](worker/src/learner-ask.ts#L1186)). The D1 lookups are in
[law-nationwide.ts](worker/src/law-nationwide.ts).

`sectionOf` ([law-nationwide.ts:230](worker/src/law-nationwide.ts#L230)) is the
key to all of it: it turns a statute citation into its section by stripping the
subsection, so `§ 521.025(c)(1)` and `§ 521.025(d)` both key to
`Tex. Transp. Code § 521.025`.

| stage | lookup | cap |
|---|---|---|
| `wholeSections` | `lawsBySection(state, sections)` on the `laws` table, ordered as the code prints | 12 rows a section, 40 in all, 24,000 characters of neighbours |
| `withPenalties` | `penaltiesFor(state, sections)` on the `penalties` table | 8 rows a section, 16 in all |
| `pagesLast` | none | process rows move to the end |

A penalty row becomes a law through `penaltyLaw`
([penalty-law.ts:86](worker/src/penalty-law.ts#L86)): one sentence stating the
figure, whether it is payable without court, and the points, with the schedule's
own line as its citation.

**Notice.**

- The chosen laws always stay first, in the order chosen. Neighbours come
  after, so the matched subsection is never pushed down by its section.
- The table says only which ids are in a section. The words come from the
  state's published file by id, the same file the chosen laws came from. An id
  the file does not hold is dropped.
- `withPenalties` orders the rows for the subsections the question matched
  first. The comment says why: Maryland's parking section has thirty rows and
  the hydrant's was beyond the cap in schedule order.
- A schedule row for a section that was not given is placed last rather than
  hidden, so a lookup that matched too much is visible in the prompt.

**Check:** why does a manual law contribute nothing to `wholeSections`?

### Hop 7: the model answers and the checker decides

**Where:** `learnerRequestFor` ([learner-ask.ts:277](worker/src/learner-ask.ts#L277)),
`withLaws` ([:518](worker/src/learner-ask.ts#L518)),
`learnerReplyFrom` ([:314](worker/src/learner-ask.ts#L314)),
`checkLawAnswer` ([:743](worker/src/learner-ask.ts#L743)),
`figuresIn` ([:605](worker/src/learner-ask.ts#L605)).

The request:

- Model `claude-opus-5-5`, `effort: 'low'`, a JSON schema for
  `{ scope, answer, sources }`.
- System prompt in two blocks: the rules ([`RULES`, :128](worker/src/learner-ask.ts#L128)),
  then the book about the app, marked for prompt caching.
- Messages: the thread replayed as logged, then the question with the laws
  appended by `withLaws`. The laws are in the user turn so the cached prefix
  stays stable.

`withLaws` labels each law by kind so the model knows what it is reading:
`(the state's law, not the manual, section: …)`, `(the court's fine schedule)`,
`(the state's own page)`, or a manual law with its page. `PENALTY_LINE` and
`PROCESS_LINE` are added only when a row of that kind is present.

The check, in order, each a reason written to the row:

| reason | test |
|---|---|
| `no-state` | no state was chosen |
| `no-laws` | the state's file could not be read |
| `not-covered` | empty answer or no sources |
| `uncited` | a source id not in the retrieved set, or a cited law with no citation, or a page named in prose that no cited law is on |
| `ungrounded` | a figure in the answer that no cited law states |
| `overlong` | more than 600 characters |

Grounding takes the figures of each cited law's rule and quoted words, plus
ordinals ("ninth birthday" is 9), plus "one" before a unit, plus the figures
the learner typed. The answer's figures are read by `figuresIn`, which handles
"1,000", ".08", spelled compounds like "five hundred", and drops the word "one".

**Notice.**

- The check grounds on the citation's quoted words, never on the reference in
  front of them: "p.66" must not ground "66 feet".
- A nationwide answer is allowed two extra kinds of figure: the count of states
  with a law and the count without. Nothing else.
- Every refusal has a name, and the names are chosen so a day's log reads as a
  diagnosis: a run of `ungrounded` is a prompt problem, a run of `scope:road-law`
  is learners in the wrong box.
- The rules' comments record the measured failures that shaped each sentence,
  with dates. Read [:107-127](worker/src/learner-ask.ts#L107-L127) for the
  high-beam answer that set the register.

**Check:** the model is told not to write page numbers. Why does the checker
still look for them?

### Hop 8: the browser draws the answer

**Where:** `answerLearner` returns `LearnerBody` ([learner-ask.ts:860](worker/src/learner-ask.ts#L860));
the handler serialises it; [src/components/AskBox.tsx:708-915](src/components/AskBox.tsx#L708-L915)
renders it; [src/sources-line.ts:27](src/sources-line.ts#L27) folds the citations.

The body on success is `{ id: 'answer', answer, citations: [{ id, location, kind, asOf }] }`.
On a refusal it is `{ id: 'no-match', pointer, pointerHref, chooseState? }`.

`sourcesLine` turns the citations into one line: the manual once with its
pages, a code section once however many subsections were cited, a schedule once
by its title. The full citation paragraphs are one tap away. The date shown is
the earliest `asOf`, and only when every citation has one.

**Notice.**

- `location` is the corpus's own citation string, verbatim. The browser parses
  it with `manualReference` ([src/citation.ts:46](src/citation.ts#L46)), the
  same function the study cards use, so the box and the cards can never cite
  differently.
- The refusal lines are the worker's, not the model's, and none contains a
  figure.
- `documentOf` in sources-line.ts repeats `sectionOf`'s stripping rule. The
  comment names the worker function it mirrors.

**Check:** which field tells the browser to open the state picker, and which
hop set it?

### Branch: nationwide

**Where:** `answerNationwide` ([learner-ask.ts:1299](worker/src/learner-ask.ts#L1299)),
`chooseTopics` ([law-topics.ts:159](worker/src/law-topics.ts#L159)),
`nearestInEveryState` ([learner-ask.ts:1417](worker/src/learner-ask.ts#L1417)),
`nearLawsNationwideWith` ([law-nationwide.ts:89](worker/src/law-nationwide.ts#L89)).

Taken before any state file is fetched, when `state === 'US'`. No retrieval, no
reranker:

1. Haiku matches the question to at most two of the topics in
   `/ask-laws/topics.json`, or four of one family (today only `dui`). Absent or
   failing, the topics' own questions are searched by words.
2. For each topic, every state's verdict law is read from
   `/ask-laws/topics/<topic>.json`. These verdicts were chosen by hand and are
   in [resource/statutes/coverage.json](resource/statutes/coverage.json).
3. The states with no law on a topic are named to the model, and under the
   answer, from the worker's own list.
4. Only when no topic matches: every one of the 51 Vectorize namespaces is
   queried separately, each state keeps its best two, and the words are read
   from D1 by id. A state with nothing above 0.5 is absent.

**Notice.**

- A single search over every state's laws at once would return the five
  states that phrase it like the question. That is why the per-state loop
  exists, and why the topic path is preferred over it.
- The nationwide rule is appended to the prompt only on this path, so a state
  question's prompt is byte-for-byte what the eval measured.
- `nearestInEveryState` refuses as `no-laws` when the table holds none of the
  ids, and drops a single missing id. The comment records the production
  incident that set this rule.

**Check:** what stops the model from writing "40 states set 0.08"?

---

## Part 2: the offline corpus

What the hops read was built, checked and published before any question
arrived. Each row is one script and the resource it writes; the README's table
gives the `npm run` names.

### Step A: fetch the vehicle code

**Where:** [scripts/statutes/fetch.ts](scripts/statutes/fetch.ts),
[scripts/statutes/site.ts](scripts/statutes/site.ts),
[resource/statutes/sources/MD/](resource/statutes/sources/MD/).

One text file per section, with the address, the date and a hash beside it in
`SOURCES.json`. Maryland has 820 files. The monthly `refresh.ts` re-fetches and
diffs.

### Step B: cut sections into subsections

**Where:** [worker/src/code-chunks.ts](worker/src/code-chunks.ts), `chunkSection`
at [:268](worker/src/code-chunks.ts#L268), `CHUNK_CHARS = 900` at [:18](worker/src/code-chunks.ts#L18).

A section splits at its top-level labels, `(a)` or `(1)`, and a subsection
longer than 900 characters splits again at line boundaries. Every chunk is
lines of the committed source joined with a space, so a test can find it
verbatim. The module is pure and shared by the publisher, the embedder, the
eval and the e2e harness. Its comments catalogue the labelling quirks of
several states' codes.

### Step C: build the state's retrieval file

**Where:** [scripts/statutes/laws.ts](scripts/statutes/laws.ts), run by the
`corpus` Vite plugin at [vite.config.ts:250](vite.config.ts#L250);
`retrievalFile` at [law-retrieval.ts:99](worker/src/law-retrieval.ts#L99).

The manual's laws from [resource/corpus/drivers/MD.json](resource/corpus/drivers/MD.json)
(216 laws, each with a card question and a `manual:` citation), Maryland's
fifteen hand-written statutes from [resource/statutes/MD.json](resource/statutes/MD.json),
and every code chunk, in one list, each with its `asOf` date. Published at
`/ask-laws/MD.json`. Hop 3 reads it.

### Step D: store every law in D1

**Where:** [scripts/laws-store.ts](scripts/laws-store.ts), `storeStatements` at
[law-nationwide.ts:263](worker/src/law-nationwide.ts#L263),
[worker/schema.sql](worker/schema.sql), manifest [resource/laws-store.json](resource/laws-store.json).

The `laws` table, keyed by id with a `(state, section)` index. Literal `INSERT`
statements of up to 90,000 bytes because D1 allows at most 100 bound
parameters. Hop 6 reads it by section, the nationwide branch by id.

### Step E: embed every law in Vectorize

**Where:** [scripts/law-vectors.ts](scripts/law-vectors.ts), `embeddingText` at
[law-vectors.ts:54](worker/src/law-vectors.ts#L54), manifest
[resource/law-vectors.json](resource/law-vectors.json).

`@cf/baai/bge-m3`, 1024 dimensions, cosine, one namespace per state. The text
embedded is the section heading, the rule and the card question. The script
never deletes a vector, which is why hop 5 and the nationwide branch drop ids
the file or table does not hold.

### Step F: the court's fine schedule

**Where:** [scripts/penalties/](scripts/penalties/),
[resource/penalties/SOURCES.json](resource/penalties/SOURCES.json),
[resource/penalties/MD.json](resource/penalties/MD.json) (1,408 rows).

Each row keys to a section the way `sectionOf` does, with the figure, whether
it is payable without court, the points, and the schedule's own line as the
quote. Hop 6 joins them.

### Step G: the state's own pages

**Where:** [scripts/process/](scripts/process/),
[worker/src/process-families.ts](worker/src/process-families.ts),
[resource/process/MD.json](resource/process/MD.json).

For each of six families (retakes, permit holding, insurance minimums, ticket
procedure, GDL rules, provisional sanctions), Haiku picks passages from the DMV's
or court's page and each is verified as a substring of the page. Stored in
`laws` with `kind = 'process'` and the family as `concept`, id `MD-R-<family>-<n>`.

### Step H: pre-answered chips, the monthly refresh, the eval

**Where:** [scripts/chips-build.ts](scripts/chips-build.ts),
[scripts/state-chips-files.ts](scripts/state-chips-files.ts),
[scripts/statutes/refresh.ts](scripts/statutes/refresh.ts),
[scripts/learner-ask-eval.ts](scripts/learner-ask-eval.ts).

Chips run the same pipeline offline and store the checked answer. The refresh
re-fetches every section and reports changes. The eval runs 190 cases against
the live model and is kept out of the test suite because it costs money and is
not deterministic.

**Notice, across Part 2.** The manifests are hashed and the unit tests recompute
them, so a corpus change deployed without a store or embed push is a red test.

---

## Part 3: the tests, and what each layer can catch

| layer | where | runs | catches |
|---|---|---|---|
| workerd | [worker/tests/learner-ask.test.ts](worker/tests/learner-ask.test.ts) | the handler with a scripted model, real D1 schema | the row, scrub, quota, refund, section and penalty joins |
| Playwright | [tests/e2e/learner-ask-law.spec.ts](tests/e2e/learner-ask-law.spec.ts) | the built app with `/api/ask` stubbed by running `answerLearner` in-process | retrieval and the checks, through the real screen |
| unit | [tests/unit/](tests/unit/) | pure functions over the committed corpus | chunking, every quote verbatim in its source, manifests, prompt rules by name |
| eval | `npm run ask:eval:learner` | the live model, by hand | the model's own behaviour |

The design documents in [docs/plans/](docs/plans/) each end with a section
"How this fails silently" that pairs a mutation with the test that goes red.
Read [learner-ask-law.md](docs/plans/learner-ask-law.md) first.

---

## Session log

| date | hops walked | notes |
|---|---|---|
| 2026-10-14 | orientation, hop 1 | `npm install` run so the editor resolves types |
