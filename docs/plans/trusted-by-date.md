# Trusted by date: what "hardest" means, as-of dates, the method on a page, the monthly diff, and the data

2026-10-10: phase 1 is live (#780, deploy/20261010-1516); phase 2 is live
(#782, deploy/20261010-1655); phase 3 is live (#783, deploy/20261010-1818);
phase 4 is live (#786, deploy/20261010-2013); **phase 5 is this PR** (branch
`trusted-by-date-5`): decisions 20–27, criteria 24–31 with 27a and 27b,
guards 23–29 with 28a and 28b. The live Price ids come from the worker secret
`STRIPE_TOKEN_PRICES`, not from `resource/stripe-prices.json` and test-mode
twins (no test key was available; decisions 26 and guard 29 are built that
way and the PR says so).

branch: trusted-by-date
slug: trusted-by-date

Written 2026-10-10. Joel's brief: he has little time, is building a YouTube
channel as an audience and a consulting moat, and wants the nationwide tool
to be "legitimately valuable" rather than a demo. His first pick from the
options put to him was the topics: today "which state is hardest on drunk
driving" is answered as the lowest blood-alcohol limit, because the two
blood-alcohol limits are the only drunk-driving topics the site has judged.
The rest of the brief is what makes an answer citable by someone who was not
there when it was built: the date it is true as of, the method it was made
by, a monthly check that it is still true, and the data behind every
comparison in a form a journalist can take away.

Five PRs, in this order, each through the implement skill. Phases 4 and 5
were added the same evening after Joel used Nationwide: it is fun, driver's
ed teachers will use it for facts in class, and the weekly limit (#774, made
weekly the same evening) must
not stop them; and a learner who wants more questions than the day allows
should be able to buy them, at a price that is profitable by the standards
software businesses hold themselves to. **Phase 1** is
the topics, because it is the one Joel asked for and it rides entirely on the
machinery Nationwide built (#769, #771): a new topic is verdicts in
`coverage.json`, and the topic file, the comparison page and the nationwide
answer follow. **Phase 2** is the dates, the method page and the downloads:
no schema, no new service. **Phase 3** is the monthly diff and the mailing
list: one script, one page, one table.

## What the last three days decided for this plan

1. **Verdicts are the asset.** Every comparison page row, every topic file
   entry and every exact nationwide answer is a verdict in `coverage.json`:
   one law per state per topic, held by `tests/unit/statute-coverage.test.ts`
   to the 24-law pool retrieval returns for the topic question. New topics
   are new verdicts, written the way `/add-code` wrote the first 1,785, and
   then everything downstream exists without a line of UI.
2. **The model is told what it is handed, in words.** The topic chooser
   picks at most two topics; "hardest on drunk driving" spans six. The cap
   exists because three topics is 15,000 tokens. A family of topics is the
   case the cap did not anticipate, and it is bounded: four topics of one
   family is about 200 laws, 20,000 tokens, 12 cents.
3. **A date is already recorded for every statute and for no manual.**
   `resource/statutes/sources/XX/SOURCES.json` records `retrieved` per
   section file; the corpus metadata describes the manual in prose with no
   date. The as-of date for a code chunk is a lookup; for a manual law it has
   to be made, and the honest way is the date the corpus file last changed.
4. **The check that the law is still the law already exists and is run by
   nobody.** `npm run statutes:check` re-fetches every source and reports
   the ones that changed. It has no schedule, no record and no page. The
   monthly diff is that command with a memory and a reader.
5. **Everything shown is measured, and none of the measurements are on the
   site.** 41 to 49 of 51 states on one question, 121 of 122 on the eval,
   the mutation tables: they live in PR bodies and `docs/plans`. The method
   page is where they go.

## Intent

A visitor who ticks Nationwide and asks *which state is hardest on drunk
driving* reads a comparison across the limits, the first-offence fine, jail
and suspension, the interlock rule, the lookback and the aggravated
threshold, each figure cited to its state, with the states that say nothing
named. Under every answer and on every comparison page is the date each law
was true as of, and a link to a page that says, with the real numbers, how
the answer was made and checked. Each comparison page offers its data as a
CSV. Once a month a script re-fetches every statute the site quotes, records
what changed, and a page lists it; a reader can leave an address to be told.
Nothing a learner sees in the state box changes.

## What is already true, so nobody re-derives it

- `resource/statutes/topics.json`: 35 `{ id, question, title }`.
  `resource/statutes/coverage.json`: 51 × 35 verdicts `{ from, law?, reason? }`.
  `scripts/statutes/laws.ts`: `topicLaws(root)`, `lawsOf`, `topicsOf`,
  `readCoverage`. `vite.config.ts` `corpus()` emits `/ask-laws/topics.json`
  and `/ask-laws/topics/<topic>.json`; `seo/pages.ts` builds
  `/drivers/laws/` and `/drivers/laws/<topic>/` from `topicLaws`;
  `tests/unit/statute-coverage.test.ts` holds every verdict to the pool and
  every topic file to its verdicts; `tests/unit/seo.test.ts` holds the pages.
- `worker/src/law-topics.ts`: Haiku chooses at most `NATIONWIDE_TOPICS = 2`
  from the list, words as the fallback; `worker/src/learner-ask.ts`:
  `NATIONWIDE_LAWS = 110`, the `nationwide` rule, `withLaws` labelling by
  state, the two grounded counts. Phase 2 of Nationwide (#771) answers a
  question no topic covers from each state's two nearest laws; the row's
  `model` says `nationwide:topic` or `nationwide:index`.
- `/add-code`'s verdict route (`.claude/skills/add-code/SKILL.md`): a
  subagent per state read the pool for each topic question and wrote the
  verdict, then `statutes:rerank -- XX` reported how many verdicts reach the
  model's three. `scripts/statutes/rerank.ts` retrieves the pool exactly as
  the box does, with the rephraser and the live index.
- `resource/statutes/sources/XX/SOURCES.json`: per section file `{ url,
  retrieved, sha256, cite, heading }` under `official`. `scripts/statutes/
  fetch.ts`: `statutes:fetch -- XX [--refresh]` and `statutes:check`, which
  re-fetches every source with the state's pinned extractor and reports any
  whose text differs. Chunks carry their source file name
  (`AskLaw`-side: `source` on the hand-written laws; code chunks are cut
  from the file named in `SOURCES.json` — `worker/src/code-chunks.ts`).
- The manuals are PDFs at `src/assets/drivers-manuals/XX.pdf`; corpus
  metadata `sourceManual` is prose; `git log -1 --format=%cs -- <file>`
  gives a corpus file's last change date at build.
- `worker/src/mail.ts`: the worker sends mail through the `SEND_EMAIL`
  binding or Resend (`MailConfig`); the contact form and the partner notices
  use it. `worker/schema.sql` is applied to the production D1 by hand before
  a worker that needs it deploys (`CREATE TABLE IF NOT EXISTS` is safe);
  `leads`, `partner_questions` and `learner_questions` are the table shapes
  to copy. Turnstile verifies a token once (`worker/src/turnstile.ts`).
- `seo/prerender.ts` writes every page from `buildPages`, plus `_headers`
  and `_redirects` are committed files Pages serves; `functions/paths.ts`
  canonicalises paths (`laws` stays lower case, #769).
- `scripts/learner-ask-eval.json`: 130 cases; `--state US` runs the
  nationwide ones; `-- --store` reads law texts from the production table.
- Measured 2026-10-10: a two-topic nationwide answer costs about 6 cents
  (Opus 5.5 at $4 / $20 per million tokens; the book is cached); the
  51-namespace fan-out 2.2–2.9 s.

## Decisions — flip any in the PR

**Phase 1 — the topics "hardest" means.**

1. **Eight topics, six of them a family.** Added to `topics.json` with
   `family: 'dui'` on the six:
   - `dui-first-fine` — What is the fine for a first drunk-driving conviction?
   - `dui-first-jail` — How long can you be jailed for a first drunk-driving conviction?
   - `dui-first-suspension` — How long is your licence suspended for a first drunk-driving conviction?
   - `dui-interlock` — When must you install an ignition interlock after a drunk-driving conviction?
   - `dui-high-bac` — At what blood alcohol level do drunk-driving penalties increase?
   - `dui-lookback` — For how many years does a prior drunk-driving conviction count against you?
   - `points-suspension` — How many points on your licence lead to a suspension?
   - `texting-fine` — What is the fine for texting while driving?
   Each with a `title` of at most 45 characters. `bac-adult`, `bac-under-21`,
   `implied-consent` and `open-container` join the `dui` family. The
   questions are phrased in the law's words, as the existing 35 are, because
   the offline pool is retrieved by the question alone.
2. **The verdicts are written by a script and read by a person.**
   `scripts/statutes/judge.ts`, `npm run statutes:judge -- XX|all --topic
   <id>…`: for each state and topic with no verdict yet, retrieve the
   offline 24-law pool (`retrieve(laws, question, CANDIDATE_LAWS)`, the pool
   the unit test holds verdicts to) and, beside it, the pool the box would
   read live (the rephraser's searches and the index, `poolSize`); ask
   Claude Sonnet 5.5 at effort `medium`, with a JSON schema, for the one
   law in the **offline** pool that states the rule, or `none` with a
   reason — the live pool is listed by id only, so the prompt carries one
   pool's text, not two (Joel, 2026-10-10: cut the API spend; the first
   judging pass on Opus at `high` with both pools' text was about $17);
   when the law that answers is in the live pool only, write `none` with the
   reason `only with the index: <id>` so the PR can list those and the
   question can be reworded. The eval runs `--state US` while iterating and
   the whole fixture once, with `--all`, before the PR. Write the verdict into `coverage.json`. Never overwrite an
   existing verdict. The implement skill's verifier reads twenty verdicts
   chosen at random against the statute text and reports each as right,
   wrong or arguable; a wrong one is fixed by hand in the fix round and
   counted in the PR. Cost: 51 × 8 = 408 judgments, each about 10,000
   tokens in, about $20.
3. **A family lifts the cap.** `topics.json` entries may carry `family`;
   the chooser's rules list the families and say a question about a family
   as a whole ("strictest drunk driving laws", "DUI penalties") names the
   family; `{ topics, family? }`. A named family, or chosen topics all of one
   family, allows `NATIONWIDE_FAMILY_TOPICS = 4` topics; the chooser orders
   them by relevance and the first four are read. `NATIONWIDE_LAWS` becomes
   220 when a family is read. Mixed topics keep the cap of two. The
   `nationwide` rule gains one sentence: *when the laws given cover several
   rules on one subject, compare on each and say which state is strictest
   overall, naming the rule that decides it.*
4. **Everything downstream is automatic**, and the plan says so to keep the
   builder from rebuilding it: the eight topic files, the eight comparison
   pages and their sitemap entries, the `/drivers/laws/` list, the CSV (phase
   2) and the absent-state lines come from the existing functions. The
   `/add-code` skill judges every topic in `topics.json`, so a new state gets
   these too.
5. **The eval** gains three `state: 'US'` cases written from the judged data,
   not from expectation: *which state has the harshest first-offense DUI
   penalties* (family; answered; contains a state the fine or jail verdicts
   put first — the builder names it from the data), *how long is your
   license suspended for a first DUI in most states* (contains the modal
   figure), *which states require an ignition interlock after a first DUI*
   (contains at least three state names the verdicts support). Phase 1's
   drunk-driving case (`Utah`, `0.05`) must still pass with the family read.

**Phase 2 — as of, the method, the data.**

6. **Every law carries the date it was true as of.** `AskLaw.asOf: string`
   (ISO date). A code chunk's is its source file's `retrieved` in
   `SOURCES.json`; a hand-written statute law's the same, by its `source`;
   a manual law's is the corpus file's last change date, recorded at build
   by `git log` into `resource/corpus-dates.json` `{ XX: 'YYYY-MM-DD' }`
   (committed, so the build is reproducible without git; a unit test holds
   it to `git log` when git is present and warns when it is not). The field
   rides the published state files, the topic files and the wire:
   `citations[].asOf`.
7. **Shown, not explained.** Under a citation the box appends *as of 6 Oct
   2026* (`ask-citation-asof`), in the learner's language. A comparison page
   gets an *As of* column, and a line under the heading: *Statutes fetched
   between 4 and 9 October 2026; manuals as committed.* A state law page the
   same line. The method page says what the date means.
8. **The method page, `/how-it-works/`.** Prerendered and indexable, built
   from `resource/methodology.md` (prose, hand-written in this PR, in the
   repository's register) plus numbers computed at build: states, laws,
   code chunks, topics, verdicts by kind, the as-of range, and the eval and
   measurement results **as they appear in the committed
   `resource/measurements.json`** `{ date, name, value, source: 'PR #767' }`,
   written by hand from the PR bodies this once and appended to by later
   PRs — so the page never states a number nobody can trace. Sections: what
   the box reads (the hashed, verbatim corpus), how a law is found (both
   searches, the rephraser, the reranker), how an answer is checked (the
   grounding of every figure, the refusals), what nationwide does (topics
   and the loop), what is measured (the table), what it does not do (no
   regulations, no case law, no local ordinances, a snapshot between
   refreshes). Title *How the answers are made — Pass the Test*. Linked from
   the ask page's notice (*how answers are checked*), from `/drivers/laws/`,
   from every comparison page's as-of line, and from the footer. No
   structured data.
9. **The data, as CSV.** `/drivers/laws/<topic>.csv` per topic, built by
   `corpus()` beside the topic file from `topicLaws`: columns `state,
   state_name, kind, law, citation, source_url, as_of`, RFC 4180 quoting,
   UTF-8 with no BOM, `_headers` serving `text/csv; charset=utf-8` for that
   path. A link on each comparison page (*Download this comparison as CSV*,
   `topic-csv`) and on the index (*every comparison as CSV*). A unit test
   parses each CSV back and holds it to the topic file, including a law
   with a quote and a comma in it. Free, no form: a journalist copies a
   link; the list (phase 3) is offered beside it, not in front of it.

**Phase 3 — the monthly diff, and the list.**

10. **`npm run statutes:refresh`** (`scripts/statutes/refresh.ts`): for
    every state with sources (or `-- XX`), re-fetch every section the way
    `statutes:check` does, and write
    `resource/statutes/changes/<YYYY-MM-DD>.json`: `{ ran, states: { XX: {
    checked, changed: [{ file, cite, heading, before, after, diff }] } } }`
    where `before`/`after` are hashes and `diff` is a unified diff capped at
    forty lines. The committed sources are **not** changed: applying a
    change is the state's existing route (`statutes:fetch -- XX --refresh`,
    re-chunk, `laws:embed -- --push`, `laws:store -- --push XX`,
    `statutes:judge` for the topics whose verdict law changed), run by a
    person who has read the diff. A fetch that fails is recorded as
    `unreachable`, never as unchanged. One state at a time, politely, as
    `fetch.ts` already does.
11. **`/refresh-codes`**, a skill: run the refresh, commit the report, open
    the PR with the summary (states checked, sections changed, unreachable),
    and list the verdict laws affected. Nothing else. The deploy of the
    report is what puts it on the page.
12. **`/drivers/laws/changes/`**: prerendered from every report, newest
    first: date, state, section heading, the cite linked to the official
    source, and a line *N sections checked, M changed, K unreachable*.
    Title *What changed in state driving law — Pass the Test*. Linked from
    the comparison index and the method page. A report with no changes is a
    line, not a page section. The sitemap lists it.
13. **The list.** `POST /api/subscribe` `{ email, turnstile, lang }`:
    Turnstile verified once, the address validated and lower-cased, a row
    in `subscribers (id, email UNIQUE, lang, created_at, confirmed_at,
    unsubscribed_at, token)`, and a confirmation mail through `mail.ts`
    with `/api/subscribe/confirm?token=`; `GET …/confirm` sets
    `confirmed_at` and shows a page; `GET …/unsubscribe?token=` sets
    `unsubscribed_at`. The form (`subscribe-form`) sits on the comparison
    index, every comparison page and the changes page: *Monthly: what
    changed in state driving law.* The privacy page gains the paragraph that
    says what is kept and how to leave. `npm run subscribers` prints the
    confirmed addresses for a send; the sending is a person with a mail
    client this year (non-goal: a mailer). Schema change: the table is
    created on the production D1 by hand before the worker deploys, as
    `laws` was.
14. **Deploy order.** Phase 1: Pages first is harmless but the order stays
    worker then Pages; the eight new topic files 404 on the old Pages for
    the minutes between, and the worker refuses `no-laws` for them. Phase 2:
    worker then Pages. Phase 3: the `subscribers` table and `ALTER TABLE laws
    ADD COLUMN as_of TEXT` by hand, then `npm run laws:store -- --push --all`
    (`--all`: the committed manifest already records a local push), then the
    worker, then Pages.

**Phase 4 — the chips.**

15. **A curated pool of nationwide questions, answered once and served from
    a file.** `resource/chips.json`: forty to sixty questions written as
    facts in question form ("Which state lets you turn left on red onto a
    one-way street?", "Where is littering from a car a four-hundred-dollar
    fine?"), each with an `id`, the `topics` or `family` it rides on, and
    `lang` (English; Spanish chips are the same ids with Spanish text,
    answered in Spanish). `npm run chips:build` sends each through the real
    nationwide pipeline — the rephraser, the chooser, the topic files, Opus,
    `checkLawAnswer` — and writes `resource/chips-answers.json`: `{ id,
    lang, answer, sources, absent, asOf, model }` per chip, plus the
    corpus hash it was built against. A chip the checker refuses is not
    written and is named in the script's output. About sixty questions at
    six cents is four dollars a build; the build re-runs when the pool or
    the corpus changes, and `/add-code` gets it as a step.
16. **A stored answer is checked harder than a live one, because it can
    be.** `tests/unit/chips.test.ts`: every stored answer's cited ids are
    verdict laws of the chip's topics; every figure in it is stated by a
    cited law's text (the live checker's rule, re-run offline); **every state
    named in the text is a state whose law is cited** — the rule the live
    checker cannot apply and the gap Opus once fell through (Nebraska, in
    Spanish); the corpus hash matches the published laws, so a corpus change
    without a rebuild is red. Nobody reads them by hand; a chip that fails is
    the one Joel looks at.
17. **Three chips under the box in nationwide mode, different each load.**
    Drawn at random from the pool less the ids this browser has tapped
    (`teach-and-test/v1/chips-tapped`, a list; cleared when every chip has
    been tapped). A tap shows the stored answer in the thread, rendered
    exactly as a live answer — citations by state, the absent line, the
    as-of — and does **not** count against the week's limit or call the
    worker. `data-testid="ask-chip"`, `ask-chip-answer` on the thread entry.
    The box's own examples stay for the state mode.
18. **A tap is counted, not logged.** `chip_tapped { id }` joins the
    analytics vocabulary (`EVENT_NAMES`, the unit test that holds the app's
    list to the worker's), so the stats say which facts people like; the
    question log is not written, because nothing was asked of the model.
19. **The same file is a page.** `/drivers/laws/facts/` lists every chip
    with its stored answer and citations, as the comparison pages do, for
    search and for the videos; linked from `/drivers/laws/`. No structured
    data.

**Phase 5 — tokens for more questions.**

20. **A token is a state question; a nationwide question is five.** The
    measured costs (2026-10-10): a state question about 1.5 cents, a
    nationwide one 6 to 8; the ratio is the token ratio. The week's free
    allowance (#774) stays exactly as it is; tokens are drawn only when it is
    spent, and only when the learner chooses to spend them.
21. **A one-dollar minimum, priced to a 70 percent gross margin after
    fees at the worst case.** Joel, 2026-10-10: the smallest purchase is
    **$1**. Software and AI services run 70 to 80 percent gross margins;
    this plan holds the lower bound *of what is left after Stripe's fee*,
    because at a dollar the fixed 30 cents is a third of the price and the
    margin has to be stated on the 67 cents that remain. `src/pricing.ts`
    carries the measured cost per question kind with its measurement date,
    Stripe's fee (2.9 percent plus 30 cents), the margin floor, and the
    packs; `tests/unit/pricing.test.ts` computes each pack's margin on its
    net at the worst-case mix (every token spent on the costlier kind) and
    is red under 70 percent, so a cost or price change that makes a pack
    unprofitable cannot ship. Starting packs, which the test recomputes
    rather than trusts: **$1 for 12 tokens** (worst case 18 cents of model
    cost on 67 cents net, 73 percent), **$5 for 75 tokens** (1.13 on 4.55,
    75 percent), **$10 for 160 tokens** (2.40 on 9.41, 74 percent), and
    **$25 for 420 tokens** (6.30 on 23.98, 74 percent) — the classroom pack
    (Joel, 2026-10-10: the buyers are schools and driver's-ed teachers as
    much as learners). The dollar pack is the door; the larger ones are
    where the fee stops mattering, and the pop-up says so in one line. Tokens do not expire; a
    pack is refundable while unused through the existing refund mailbox,
    and the Terms say so.
22. **A question code, not an account — recovered the way the paid test
    is.** Checkout (Stripe, the existing `startCheckout` shape and webhook)
    issues a random code, shown once with the receipt exactly as the recovery
    code is and sent in the same receipt mail, kept in `teach-and-test/v1/
    question-code`, and typed on another device (*I have a code*, beside *I
    already paid*) to carry the balance over — a teacher at the classroom
    machine and at home is one code. The worker holds `question_credits
    (code PRIMARY KEY, bought, spent, created_at, stripe_session)`, debited
    server-side; the browser's count is never trusted for paid questions.
23. **The code is written with every question it pays for.** Joel,
    2026-10-10: he wants to analyse what buyers ask, and the privacy rule
    that keeps purchase ids and behaviour apart (docs/observability.md) is
    not to be applied here — "this is not a dating website". So
    `learner_questions` gains `credit_code TEXT` (null on a free question),
    `npm run questions -- --code <code>` prints a code's questions and
    outcomes, and docs/observability.md gains the paragraph that says the
    token code is the one id deliberately joined to behaviour, and why. The
    Terms and the privacy page say a paid question is kept with its code.
24. **The wire.** `/api/ask` gains `spend?: string` (the code); the worker
    debits before asking, refunds the token if the model fails or the
    answer is refused (`no-laws`, `unreachable`), never for `not-covered`
    (the model worked), and answers with `tokens: { left }`. A code with no
    balance answers `402` with the body the box shows as the limit modal.
    `/api/questions/checkout`, `/api/questions/balance?code=`, and the
    webhook's new price ids. The site ceiling `LEARNER_DAILY_QUESTIONS`
    excludes paid questions, which have their own bound: the balance.
25. **The pop-up, in place; the return, to the same place.** Joel: when a
    learner needs to buy, a pop-up offers it and explains the costs, and
    they are not taken out of what they were doing until they click to pay;
    afterwards they come right back. So:
    - The limit modal (#774) becomes the purchase pop-up (`buy-questions`):
      its first line is still *that's the limit for this week*; under it, what a
      token is (*a question about one state; a nationwide question is
      five*), the four packs with their prices and what each buys, one
      sentence on why the dollar pack buys fewer per dollar, one line that
      a teacher or a school can share one code across a classroom's
      devices, and one button per pack that goes to Stripe Checkout. The
      words address whoever is at the keyboard — a learner, a teacher, a
      school office — never "your test" or "your state". *Not now* closes it. Nothing
      else on the page changes: the thread, the Nationwide tick and the
      question in the input all stay. The same pop-up opens from *Buy more
      questions* under the balance line at any time.
    - **Before leaving for Stripe**, the box writes the pending question,
      the Nationwide tick and the thread's conversation id to
      `teach-and-test/v1/ask-pending`; the Checkout session's `success_url`
      is the ask page with the session id (`/#ask?session=…`), the
      `cancel_url` the ask page plain.
    - **On return**, the page reads the session id, asks the worker
      (`/api/questions/claim?session=`) for the code the webhook issued
      (polling a few seconds if the webhook has not landed), stores the
      code, shows the balance line (`ask-balance`, live since #774's
      weekly change: *7 state · 2 nationwide questions left this week*, which
      phase 5 extends with *· 12 tokens* and makes tappable to buy), restores the pending question into the input with the
      tick as it was, and says *Your tokens are ready — tap Ask to send
      that question.* It is not sent on its own: a question sent while the
      learner is still looking for the page is a token spent unseen. A
      cancelled checkout restores the question and says nothing else.
    - When the week's allowance is spent and tokens remain, the box asks
      *Spend a token?* once per session (`ask-spend-confirm`), then spends
      without asking; when both are gone, the pop-up. *I have a code* on
      the pop-up restores a balance on another device, beside *I already
      paid* on the price screen, as the recovery code is.
    - English and Spanish; the FAQ, the Terms, the privacy page and the
      refund page gain their paragraphs, and the FAQ's says in so many words
      that schools and teachers may buy a pack and share its code with a
      class, that Stripe's receipt carries the business name for expensing,
      and that an unused pack is refundable.
26. **Stripe.** Two Prices, created by Joel in the live dashboard (names,
    amounts and the recurring-off setting in the PR body) — creating live
    prices is a step outside the repository; the builder creates the
    test-mode twins through the API with the test key and the e2e mocks
    Stripe at the network edge as the paywall tests do.
27. **Deploy order.** `question_credits` and the `credit_code` column by
    hand on the production D1 (SQLite has no `ADD COLUMN IF NOT EXISTS`; the
    statement is in the PR), the live Price ids as worker secrets, then the
    worker, then Pages.

## The change

### Phase 1
- `resource/statutes/topics.json`: eight topics, `family` on ten.
- `scripts/statutes/judge.ts`, `package.json` script `statutes:judge`.
- `resource/statutes/coverage.json`: 408 new verdicts.
- `worker/src/law-topics.ts`: families in the rules and the answer;
  `NATIONWIDE_FAMILY_TOPICS`. `worker/src/learner-ask.ts`: the cap by
  family, the rule's sentence, `NATIONWIDE_LAWS` by family.
- `scripts/learner-ask-eval.json`: three cases. `tests/unit/
  statute-coverage.test.ts`: every family topic's family is known; a
  topic's title fits. E2E in `learner-ask-law.spec.ts`: the family cap.

### Phase 2
- `worker/src/law-retrieval.ts` (`AskLaw.asOf`), `scripts/statutes/laws.ts`
  (`asOf` from `SOURCES.json` and `resource/corpus-dates.json`),
  `scripts/corpus-dates.ts` (`npm run corpus:dates`), the Vite plugin.
- `worker/src/learner-ask.ts` (`citations[].asOf`), `src/ask.ts`,
  `src/components/AskBox.tsx` (`ask-citation-asof`), `src/strings.ts`.
- `seo/pages.ts`: the as-of column and line, `methodPage`, the CSV links;
  `seo/prerender.ts`: the CSV files, `resource/methodology.md`,
  `resource/measurements.json`; `_headers`; `functions/paths.ts` if
  `how-it-works` needs reserving.
- Tests: unit for dates, CSV round-trip, the method page's numbers against
  the corpus and `measurements.json`; e2e for the as-of line in the box and
  the served pages.

### Phase 3
- `scripts/statutes/refresh.ts`, `resource/statutes/changes/`,
  `.claude/skills/refresh-codes/SKILL.md`.
- `seo/pages.ts` `changesPage`; `worker/schema.sql` `subscribers`;
  `worker/src/subscribe.ts`; `worker/src/index.ts` routes; `src/components/
  SubscribeForm.tsx` (or prerendered HTML form posting to the worker, since
  the comparison pages are prerendered and the app mounts over them — the
  builder decides and says which); `scripts/subscribers.ts`; the privacy
  page.

### Phase 4
- `resource/chips.json`, `resource/chips-answers.json`, `scripts/chips-build.ts`
  (`npm run chips:build`), `tests/unit/chips.test.ts`.
- `src/components/AskBox.tsx` or `src/screens/Ask.tsx`: the chips row in
  nationwide mode, the tapped list, the stored answer in the thread;
  `src/strings.ts`; `src/analytics.ts` and `worker/src/analytics.ts`
  (`chip_tapped`).
- `seo/pages.ts`: `factsPage`; `.claude/skills/add-code/SKILL.md`: the
  rebuild step.

### Phase 5
- `src/pricing.ts`, `tests/unit/pricing.test.ts`.
- `worker/schema.sql` (`question_credits`, `learner_questions.credit_code`),
  `worker/src/questions.ts`, `scripts/questions.ts` (`npm run questions`),
  `docs/observability.md`,
  (checkout, balance, debit and refund), `worker/src/learner-api.ts` and
  `learner-ask.ts` (`spend`, `paid`, `tokens`), the Stripe webhook's new
  prices, `worker/src/index.ts` routes.
- `src/screens/Ask.tsx`, `src/components/BuyQuestions.tsx`, the limit
  modal, `src/api.ts`, `src/storage.ts` (the code), `src/strings.ts`, the
  FAQ, Terms, privacy and refund pages.
- E2E with Stripe and the worker mocked at the edge, the paywall tests'
  shape; worker tests for the debit, the refund and the unjoined row.

## Acceptance criteria

**Phase 1.**
1. `topics.json` has the eight topics with titles of at most 45
   characters; the ten DUI topics carry `family: 'dui'`.
2. `coverage.json` has a verdict for every state on each new topic; every
   non-`none` names a law in its state's offline 24-law pool for the topic
   question; every `none` carries a reason; the PR lists the `only with the
   index` ones.
3. `npm run statutes:judge -- MD --topic dui-first-fine` on a state that
   already has the verdict changes nothing and says so.
4. Ticked Nationwide, *which state is hardest on drunk driving* reads up to
   four DUI-family topics' laws (at most 220), the model was given no other
   topic, and the answer names a state with its figures, cited per state.
5. A question matching two topics of different families reads two.
6. The eight comparison pages, their CSV links (phase 2), their sitemap
   entries and their topic files exist with no change to the page code; a
   nationwide question on `texting-fine` answers from the verdicts.
7. The three new eval cases pass; the phase-1 Nationwide cases still pass;
   the whole eval is no worse (both scores in the PR).
8. The verifier's twenty-verdict reading is in the PR with each verdict's
   result.

**Phase 2.**
9. Every published law carries `asOf`; a code chunk's equals its source's
   `retrieved`; a manual law's equals `corpus-dates.json` for its state;
   the unit test holds both.
10. Under a road-law citation in the box, *as of <date>* in the learner's
    language, from the wire, not computed in the browser.
11. Each comparison page and state law page shows the as-of column and the
    range line; the CSV for a topic parses back to exactly the topic file
    with `as_of` filled.
12. `/how-it-works/` is served with the title, the computed numbers equal to
    the corpus, and every measurement on it present in
    `measurements.json`; the ask page's notice, `/drivers/laws/`, every
    comparison page and the footer link it; the sitemap lists it.
13. `/drivers/laws/bac-adult.csv` is served as `text/csv`.

**Phase 3.**
14. `npm run statutes:refresh -- MD` writes a dated report naming every
    section checked; a source whose text changed is listed with its diff; a
    source that cannot be fetched is `unreachable`; the committed sources
    are unchanged.
15. `/drivers/laws/changes/` lists every report's changes newest first,
    linked to the official source; the sitemap lists it.
16. Posting a valid email with a good token creates an unconfirmed row and
    sends one mail; the confirm link confirms once; the unsubscribe link
    unsubscribes; a bad token, a malformed address or a repeat creates
    nothing and says so; `npm run subscribers` lists confirmed addresses
    only.
17. The privacy page says what the list keeps and how to leave.

**Phase 4.**
18. `npm run chips:build` answers every chip in `chips.json` through the
    nationwide pipeline and writes the answers file; a chip the checker
    refuses is absent from the file and named in the output.
19. Every stored answer passes the offline checks: cited ids are verdict
    laws of its topics, every figure is in a cited law, every state named is
    a cited state, the corpus hash matches.
20. In nationwide mode the box shows three chips; reloading shows a
    different three; a tapped chip is not shown again on this browser until
    every chip has been tapped.
21. Tapping a chip shows its stored answer in the thread with citations by
    state and the absent line, sends nothing to the worker, and does not
    count against the week's nationwide limit.
22. `chip_tapped` is sent with the chip's id and nothing else; no
    `learner_questions` row is written.
23. `/drivers/laws/facts/` is served with every chip and its answer, and
    is linked from `/drivers/laws/` and the sitemap.

**Phase 5.**
24. `tests/unit/pricing.test.ts` computes each pack's gross margin at its
    worst-case mix from the committed costs and fees and passes at or above
    70 percent; lowering a price or raising a cost below it is red.
25. With the week's allowance spent and a code holding tokens, a state
    question spends one token and a nationwide question five, after one
    confirmation per session; the balance shown updates; the worker's
    `question_credits` row shows the debit.
26. A refused `no-laws` or `unreachable` question is refunded; a
    `not-covered` one is not.
27. A code with no balance, or no code, gets the purchase pop-up on the
    very question that hit the limit: the limit line, what a token is, the
    four packs with the prices from `pricing.ts`, the classroom line, a
    button each; closing it leaves the thread, the tick and the question
    exactly as they were; no sentence on it says "your state" or "your
    test".
27a. Tapping a pack goes to Stripe Checkout (mocked); returning with the
    session id shows the code and the balance line, puts the question back
    in the input with the tick as it was, and does not send it; a cancelled
    checkout restores the question and shows no pop-up.
27b. `tests/unit/pricing.test.ts` holds the dollar pack to at least 70
    percent on its net after Stripe's fee, and every pack's price is at
    least $1.
28. *I have a code* restores a balance on another browser.
29. Every paid question's `learner_questions` row carries the code it was
    paid with; a free question's row carries none; `npm run questions --
    --code <code>` lists a code's questions with their outcomes.
30. The free path is unchanged: with no code, the week's limits and the
    modal behave exactly as in #774, and a paid question does not count
    against `LEARNER_DAILY_QUESTIONS`.
31. The FAQ, Terms, privacy and refund pages say what a token is, what it
    costs, that tokens do not expire, and that an unused pack is refundable.

## How this fails silently

**Phase 1.**
1. **A verdict outside the offline pool.** Unit (existing
   `statute-coverage`). Mutation: point `dui-first-fine` for MD at a law
   outside its 24 → red.
2. **The family cap ignored.** E2E: a stub chooser naming four DUI topics →
   four topics' laws given, under 220; naming two topics of different
   families → two. Mutation: read every named topic regardless → red on the
   mixed case's count.
3. **An existing verdict overwritten.** Unit on the judge's writer: a
   state with a verdict is skipped and reported. Mutation: write regardless
   → red.
4. **A family topic with an unknown family.** Unit: every `family` value is
   one of the declared families. Mutation: misspell one → red.
5. **The eval's state name invented.** The three cases' `contains` were
   written from the verdicts; the PR shows the derivation.

**Phase 2.**
6. **A date that lies.** Unit: a chunk's `asOf` equals its source's
   `retrieved`. Mutation: stamp today's date on every law → red.
7. **A manual date from nowhere.** Unit: every state in
   `corpus-dates.json` has a date, and when git is present it equals `git
   log`. Mutation: edit one date → red.
8. **As-of computed in the browser.** E2E: the stubbed worker sends
   `asOf: '2026-10-06'` and the box shows 6 Oct 2026. Mutation: render
   today's date → red.
9. **A CSV that does not round-trip.** Unit: parse each CSV; a law with a
   comma and a quote survives. Mutation: skip quoting → red on that law.
10. **A number on the method page nobody can trace.** Unit: every figure in
    the rendered page's measurements section is in `measurements.json`.
    Mutation: write a literal in the template → red.
11. **The method page's counts stale.** Unit: states, laws and topics on
    the page equal the corpus. Mutation: hard-code 50 → red.

**Phase 3.**
12. **A change missed.** Unit on the refresh with a stub fetcher: a source
    returning different text is listed with before and after hashes.
    Mutation: compare lengths, not hashes → red on a same-length edit.
13. **Unreachable read as unchanged.** Unit: a fetcher that throws yields
    `unreachable`, not an empty `changed`. Mutation: catch and continue → red.
14. **The refresh rewriting sources.** Unit: after a refresh with a changed
    stub, the sources directory is byte-identical. Mutation: write the new
    text → red.
15. **A row without a mail, or a mail without a row.** Worker (workerd):
    the subscribe handler with a stub mailer; the stub records one send per
    new row; a repeat address sends nothing. Mutation: send before the
    insert succeeds → red on the repeat case.
16. **Confirm twice.** Worker: the second confirm is a no-op and says so.
    Mutation: set `confirmed_at` again → red.
17. **Turnstile skipped.** Worker: a bad token creates no row. Mutation:
    skip verification → red.

**Phase 4.**
18. **A stored answer that names a state it did not cite.** Unit: a fixture
    answer naming Nebraska with no Nebraska law cited is red. Mutation:
    drop the state-name rule → green → red on the fixture assertion.
19. **A chip served from a stale corpus.** Unit: the answers file's corpus
    hash equals the published laws'. Mutation: change one law without a
    rebuild → red.
20. **A chip that calls the worker.** E2E: tapping a chip sends no request
    to `/api/ask` and the day's count is unchanged (the fourth tap after
    three live questions is still a chip answer). Mutation: route the tap
    through `send` → red on the request count.
21. **The same chips every load.** E2E: ten reloads with a seeded pool of
    nine show more than one distinct triple. Mutation: take the first three
    → red.
22. **A tapped chip shown again.** E2E: tap one, reload until the pool
    cycles → it is absent until the tapped list resets. Mutation: never
    write the tapped list → red.

**Phase 5.**
23. **A pack sold at a loss.** Unit (pricing): mutation: cut the 150-pack
    to $2.99 → red at its margin.
24. **The browser trusted for paid questions.** Worker: a request claiming
    `spend` with a code of zero balance is `402` and the model is not
    called. Mutation: debit after asking → red on the model's call count.
25. **A paid question without its code, or a free one with one.** Worker:
    the row for a paid question carries the code; the row for a free
    question carries null. Mutation: write the code on every row → red on
    the free case; drop it → red on the paid case.
26. **A token kept on a failed answer.** Worker: `no-laws` refunds, the
    balance is back. Mutation: skip the refund → red.
27. **A token refunded on a real refusal.** Worker: `not-covered` does not
    refund. Mutation: refund every refusal → red.
28. **The free path changed.** E2E (#774's four tests) unchanged and green;
    mutation: count paid questions against the day → red on the eleventh.
28a. **A question lost to the checkout.** E2E: type a question, hit the
    limit, tap a pack, return with a session id → the input holds the
    question, the tick is as it was, nothing was sent. Mutation: do not
    write `ask-pending` before leaving → red on the input.
28b. **A question sent on return without a tap.** E2E: on return the
    stubbed worker receives nothing until Ask is tapped. Mutation: send the
    pending question on return → red on the request count.
29. **A price on the sheet that is not the Price's.** E2E: the sheet's
    prices equal `pricing.ts`; unit: `pricing.ts` amounts equal the Stripe
    Price amounts recorded in `resource/stripe-prices.json` by the
    test-mode creation. Mutation: edit one amount → red.

## Non-goals

- A paid tier, an API, or any metering; outreach of any kind.
- Re-judging the existing 35 topics' verdicts, or changing their questions.
- Applying a refreshed source automatically: the refresh reports, a person
  applies through the existing route.
- A mailing engine, templates, or sending from the worker on a schedule;
  the list is a table and a script.
- Spanish comparison pages, a Spanish method page, or Spanish CSVs (the
  box's as-of line is translated).
- Changing the state box's retrieval, pool, reranker, rephraser, or any
  per-state behaviour beyond the citation's date.
- Structured data on the new pages.
- Dating the manuals by their printed edition (a later pass may read the
  PDFs; the corpus change date is what is true today).
- Phase 4: chips in state mode; a chip answered live; a chip that is not a
  nationwide question; more than three at a time.
- Phase 5: subscriptions; an account or sign-in; tokens for anything but
  questions; selling tokens through the partner program; a price below
  $1; sending a question on the learner's behalf after a purchase.
