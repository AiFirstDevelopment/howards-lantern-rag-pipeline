# Ask a question: a model that answers from a book about the app

branch: learner-ask
slug: learner-ask

Written 2026-10-01, after [trust-signals](trust-signals.md) shipped (#544) and
after the first ask-box plan was dropped (#543). That plan had the model pick
one of the FAQ's twelve written answers and show it; Joel's verdict was that a
model that routes is not the value he had in mind. The brief is now in three
sentences of his: **use AI to be conversational**; **answer yes or no, or with
statements scoped to the question**; **not simply find something in the FAQ --
a full knowledge base describing how the app works from the learner's
perspective, so the model has enough source to answer a range of questions.**
Run as `/implement ASK`. Every question the build could stop on is settled
under *Decisions*; the build takes them as given, declares any it has to bend,
and the PR is where one gets reversed.

## Intent

A learner types *can I use this on my laptop as well as my phone?* The FAQ has
no such question. The facts that answer it exist -- a recovery code on the
receipt, up to five devices -- but a router has nothing to route to, and a
visitor who meets *I do not have a written answer to that one* for a question
this ordinary concludes nobody is home. The value is an answer in the shape of
the question: **Yes. The recovery code on your receipt moves your purchase to
up to 5 devices, so pay on one and open it on the other.** Two sentences, the
first of which is the word they asked for, and nothing about refunds, levels
or Spanish, because they did not ask.

So the model writes. What stops that from becoming the thing this repository
has refused since the partner box was built -- a paraphrase that looks right
and is wrong, in writing, on our site -- is that it writes **from a book and
only from a book**, and the worker checks the answer against the book before
anybody sees it. The book is a new document, `worker/src/learner-knowledge-
base.md`, that describes the whole app as a learner meets it: the states, the
cards, the sections and their questions, the ten-question test, the full
tests and their shape, the three levels, retests, the free part and the wall,
paying without an account, the recovery code, the guarantee, Spanish, read
aloud, what is collected, who makes it. Every number in it is a placeholder
filled from the constant that enforces it, so the book cannot say 14 days
while the code says 21. The model is given the book, the conversation so far,
and five rules. It returns an answer, a scope and the sections it drew on; the
worker refuses the answer if the scope is not the app, if it cites nothing, if
it contains a number the cited sections do not, if it names a price, or if it
runs long. Only an answer that passes is shown.

Three things the box still never does, and the book is written so the model
has no material for them: **road law** (a sign, a speed, a fine, an age, a
state's requirement -- the cards cite the state's manual sentence by sentence,
and a paraphrase from memory is the one thing this product must never
produce), **a price** (it depends on the partner code and is shown before
checkout), and **a promise** (that you will pass, that a refund is approved,
that somebody will reply). Each is a named scope the worker turns into a
one-line pointer it writes itself.

## What is already true, so nobody re-derives it

- **The box exists.** `src/components/AskBox.tsx` (`ask-box`, `ask-notice`,
  `ask-input`, `ask-submit`, `ask-example`, `ask-waiting`, `ask-trouble`,
  `ask-answer`, `ask-no-match`, `ask-refused`, `ask-unavailable`,
  `ask-contact`, `ask-cite`): a question, one-tap examples, a thread
  (`conversation` id minted in the browser, `MAX_TURNS = 10`), the Turnstile
  widget drawn into `#ask-turnstile-widget` on the surface with no session,
  the bounded wait for the token, and two refusals that still hand over an
  address. Its English is in the component and it reads no language context.
  `Answer` renders `answer.answer` through `Prose` (paragraphs, numbered
  lists, inline bold); `AskAnswer` (`src/ask.ts`) is the wire shape both
  bundles read. The study app's *Become a partner* overlay mounts it
  (`src/screens/Partner.tsx`) with `send={askPartners}` (`src/api.ts:228`,
  `POST /api/partners/ask`) and `siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}`,
  so **the Turnstile site key is already in the learner bundle.**
- **The worker side is one handler and one function.** `handlePublicAsk(
  request, db, cors, deps, audience)` in `worker/src/partner-api.ts:452`:
  `readAsk` (id shape, non-empty, `MAX_QUESTION_CHARS = 500`), `turnsOf`,
  `tooManyTurns`, the daily ceiling checked **before** the challenge
  (`pastCeiling`, `PUBLIC_DAILY_QUESTIONS = 300`), `deps.verifyTurnstile` on
  turn one only, then `answerQuestion` (`:663`), which **claims the turn
  before asking the model** (`claimTurn`, the unique index on `(conversation,
  turn)`), deletes rows older than `QUESTION_RETENTION_SECONDS` (180 days) in
  the same write, calls `deps.ask`, writes `entry_id` and `model` on the row,
  and renders through `renderWritten`. The mesh (`deps.askMesh`, `ASK_VIA_MESH`)
  takes the partner audience; reps go to the direct router.
- **The router** (`worker/src/ask.ts`): `routerPrompt(audience)` lists the
  audience's entries, `idSchema` is an enum of their ids plus `NO_MATCH`, and
  `askerFor(apiKey)` calls `ASK_MODEL = 'claude-opus-5'` with
  `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`,
  the prompt as a cached prefix (`cache_control: { type: 'ephemeral' }`), and
  the history replayed as `{ id }` assistant turns. No key →
  `{ id: NO_MATCH, model: 'unavailable' }`; a failed call → `'unreachable'`;
  both answer 200 with the address. `Asker`, `AskRequest { audience,
  question, history: AskTurn[] }` and `AskChoice { id, model }` are the
  types the harness fakes (`worker/tests/rep-ask.test.ts`). `index.ts:878`
  builds `deps.ask = askerFor(env.ANTHROPIC_API_KEY)` beside
  `leadAssistFor(env.ANTHROPIC_API_KEY)`, which is the one place in the
  worker that already lets a model **write** (`#539`: the lead desk's
  find-by-description assistant says why it picked a lead).
- **The banks and their discipline.** `scripts/build-kb.ts` parses
  `worker/src/knowledge-base.md` and `rep-knowledge-base.md` (`SOURCES`) into
  JSON the worker imports; `npm run kb:build`; `tests/unit/knowledge-base.
  test.ts` holds the JSON to the markdown ("ships exactly what regenerating it
  now would write"), refuses a public entry with a `{placeholder}`, and pins
  the rep bank's numbers to `COOLDOWN_DAYS` and friends. `knowledge-base.md`'s
  own preamble is the register the new book inherits: *the code wins, not
  this file*; *no number that belongs to somebody's account*; *nothing here
  is advice*. `scripts/ask-eval.ts` + `ask-eval.json` measure routing against
  the live model by expected id; not part of `npm test`.
- **The scrubber.** `scrubComment` (`worker/src/validate.ts:139`, `redact`)
  is what the feedback box runs before storing free text from a learner
  (`worker/src/feedback.ts:116`): phone numbers, recovery codes and the like
  stripped, the email kept on purpose because a person reads feedback.
- **Storage and its disclosure.** `partner_questions` (`worker/schema.sql`):
  `partner_id` (NULL on the public route), `conversation`, `turn`,
  `asked_at`, `question`, `entry_id`, `model`. `PARTNER_QUESTIONS_NOTICE`
  (`src/legal.ts:231`) is the line above the public box and says *not from a
  machine making them up* -- true of that box, and **not a sentence this box
  may borrow**. `Privacy.tsx`'s `privacy-partner-questions` paragraph says
  what is kept for `PARTNER_QUESTION_RETENTION_DAYS` and that it is *"the
  only free text this app stores from anybody who has not signed up as a
  partner"* -- which this plan makes false and must change;
  `privacy-ask-provider` names `ASK_MODEL_PROVIDER = 'Anthropic'`.
  `tests/e2e/ask.spec.ts:372` holds the partner paragraph to its number.
- **The FAQ shipped** (`src/faq.ts`): twelve `FaqEntry { id, group,
  question, answer: FaqText }` in `FAQ.en` and `FAQ.es`, numbers pinned by
  `tests/unit/faq.test.ts` to `FREE_SECTIONS`, `REFUND_WINDOW_DAYS`,
  `DEVICE_LIMIT`, `READY_STREAK`; rendered at `/#faq` by `src/screens/Faq.tsx`
  with `faq-<id>` items. The footer (`src/components/SiteFooter.tsx`) has
  five links and `tests/e2e/site-footer.spec.ts:224` asserts exactly five
  and zero buttons. `MENU_PAGES` gained `'faq'` in both `src/analytics.ts`
  and `worker/src/analytics.ts`, held equal by `event-vocabulary.test.ts`.
- **The constants the book will quote**, each the thing that enforces it:
  `FREE_SECTIONS = 1`, `FREE_FULL_TESTS = 1` (`src/access.ts`);
  `READY_STREAK = 3`, `MASTERY_TARGET = 2`, `DIAGNOSTIC_QUESTIONS = 10`,
  `MASTERY_DECAY_DAYS = 10`, `RESTUDY_LIMIT = 5` (`src/exam.ts`);
  `HISTORY_RUNS = 5` (`src/flow.ts`); `DEVICE_LIMIT = 5`
  (`worker/src/purchases.ts`); `REFUND_WINDOW_DAYS = 21`
  (`worker/src/payouts.ts`); `MAX_TURNS`, `MAX_QUESTION_CHARS`,
  `QUESTION_RETENTION_SECONDS` (`worker/src/ask.ts`); `SUPPORT_EMAIL`,
  `REFUND_EMAIL` (`src/legal.ts`). **Per-state figures** -- question count,
  pass mark, time limit, how the paper is given -- live in each corpus's
  metadata, which the worker does not have; the landing page and *About the
  <state> test* already state them with the manual as source.
- **Traffic and cost.** ~1,300 visitors a month. The book will run to a few
  thousand tokens and is a cached prefix; a question is ~50 tokens in and
  ~100 out. At Claude Opus 5.5's rates ($4 / $20 per MTok, cache reads
  $0.20) a question costs about a third of a cent; `LEARNER_DAILY_QUESTIONS =
  300` caps a day at about a dollar in the worst case and nothing like it in
  practice.

## Decisions -- flip any of them in the PR if wrong

1. **The book: `worker/src/learner-knowledge-base.md`.** Prose in sections,
   each `## <id>` with a title line, written in the second person for a
   learner who has never opened the app -- what they will see, what each
   control does, what happens next -- in the plain register of the FAQ and
   the Terms. Each section opens with an HTML comment naming what it was
   written from (`<!-- source: src/access.ts, docs/plans/first-sitting.md -->`)
   so the verifier can check it against the code rather than against the
   author's memory, and may carry `<!-- page: #refund -->` naming the app page
   that binds. **No bare digit anywhere in the file**: every number is a
   `{placeholder}` from the table below, filled at build time. The sections,
   in the order a learner meets them, and the test pins that every one exists:
   - `what-this-is` -- practice for the permit test, written from the state's
     manual, not official, not affiliated; where this app and the handbook
     disagree the handbook is right.
   - `states` -- the first screen's picker; each state from its own manual;
     the state's page says the manual, the agency, the last-checked date,
     how many questions and the pass mark. **The book does not state any
     state's figures** (decision 3).
   - `the-first-screen` -- the ten-question test as the primary door, *or
     start studying* as the second; *Why this one*; *What this is*; the
     footer; the menu.
   - `studying` -- one law per card, the law and why it exists, *Quiz me*,
     a wrong answer repeats the card and cannot be skipped, answer order
     shuffled; a section opens on its questions and a right answer there
     tests you out of that card (`docs/plans/ask-first.md`); the checkpoint
     at a section's end; the pass bar and the section map; read aloud; the
     progress counter.
   - `short-and-full-course` -- the short course is one or two laws per
     topic, the full course every law; switching keeps everything; the
     tests cover the same pool either way (`docs/plans/course-toggle.md`).
   - `the-ten-question-test` -- `{diagnostic_questions}` questions from the
     whole pool, ungated, retakeable, how a retake draws, the row of scores
     (`{history_runs}` kept), walking out part-way.
   - `full-tests` -- shaped like the state's real paper; the timed switch
     where the state has a clock; scored in parts where the state scores in
     parts; a run can be started over from the menu.
   - `levels` -- Green Light after one pass, Cruise Control after two in a
     row, Prepared after `{ready_streak}` full tests passed in a row; a failed
     run never takes a level away; a missed-only retest neither builds nor
     breaks the streak; what each level means and does not (no promise you
     will pass).
   - `after-a-test` -- retest only what you missed; the restudy walk over the
     concepts behind the misses (at most `{restudy_limit}`); a question
     answered right `{mastery_target}` times stops being drawn until the
     rest are exhausted, and comes back after `{mastery_decay_days}` days.
   - `free-and-paid` -- the first `{free_sections_spelled}` section(s) of
     study cards and the ten-question test are free, no sign-up; the
     checkpoint that ends the free part is where the price is shown; after
     it, one payment for everything -- all the sections, unlimited full
     tests, retests, every level; **counts what is free, never what
     remains**; **no figure** -- the price is shown before checkout and
     depends on whether a school sent you.
   - `paying` -- Stripe handles the card and this app never sees it; no
     account; the receipt and the recovery code; the code is not emailed;
     up to `{device_limit}` devices; moving the purchase; a lost code →
     `{support_email}`; not a subscription, nothing to cancel.
   - `the-guarantee` -- reach Prepared, sit the real exam within
     `{refund_window_days}` days of paying and fail, send the result photo
     to `{refund_email}` with the code; refunded less the card fee; access
     ends when the refund is made; English only -- the language at checkout
     decides; the Request a refund page.
   - `spanish` -- the switch on the first screen and in Settings; which
     states have Spanish is shown on the picker; the cards and tests in
     Spanish; the Terms and the guarantee are English.
   - `settings-and-accessibility` -- timed tests on or off, motion on or off,
     read aloud, the short course, Home.
   - `starting-over` -- what *Start over* forgets and keeps (the purchase);
     *Start this test over*.
   - `your-data` -- anonymous counts of events, no account, no name; the
     feedback box and what it keeps; **this box**: the question (scrubbed),
     the answer, the language, `{retention_days}` days, no id; the model
     provider; the Privacy page lists every event.
   - `who-makes-this` -- the four people on About us; `{support_email}`;
     the feedback button.
   - `partners-and-schools` -- a driving school or instructor can send
     students their own link; the student studies under the school's name
     and pays less; Become a partner.
   - `asking-this-box` -- what it can answer (how the app works), what it
     cannot (road law → the cards and your state's page; a price → the
     checkout; a refund decision → `{refund_email}`), that it is a model
     writing from this description, that the pages it names are what bind.

   The placeholder table, each filled by the builder from the import named:
   `{free_sections}` / `{free_sections_spelled}` (`FREE_SECTIONS`, the
   spelled form the FAQ test derives), `{ready_streak}` (`READY_STREAK`),
   `{diagnostic_questions}`, `{mastery_target}`, `{mastery_decay_days}`,
   `{restudy_limit}` (`src/exam.ts`), `{history_runs}` (`src/flow.ts`),
   `{device_limit}` (`DEVICE_LIMIT`), `{refund_window_days}`
   (`REFUND_WINDOW_DAYS`), `{retention_days}` (`QUESTION_RETENTION_SECONDS /
   86_400`), `{max_turns}` (`MAX_TURNS`), `{support_email}`, `{refund_email}`
   (the production defaults in `src/legal.ts`; the worker has `SUPPORT_EMAIL`
   in its env already). **A placeholder with no filler, or a digit outside a
   placeholder, fails the unit suite.**
2. **The bank is the book plus the FAQ.** `scripts/build-learner-kb.ts`, run
   by `npm run kb:build` after `build-kb.ts`, writes
   `worker/src/learner-knowledge-base.json`: the book's sections as
   `{ id, title, page: string | null, text }` with placeholders filled, then
   the FAQ as `{ id: 'faq-<id>', lang, question, answer }` for both languages
   (answers flattened to plain text). The worker imports it as
   `LEARNER_BOOK` and `LEARNER_FAQ`. The Spanish FAQ entries are the model's
   Spanish-worded source for the commonest questions; **the book itself is
   English, and the model answers in the learner's language.** A Spanish
   book is a translation pass that would double the thing to keep true; the
   model translates well, the FAQ gives it the register, and the eval
   measures the result. Flip this if the eval's Spanish answers read badly.
3. **Per-state figures and road law stay out, by construction.** The book
   never states a question count, a pass mark, a time limit or a rule of
   the road, so the model has nothing in its source to answer those from,
   and the prompt names them as out of scope with a pointer. The client
   sends no facts the worker would have to trust (a `state` code is sent
   only so the pointer can say *your state's page* by name -- the worker
   looks the name up in nothing and uses the code only to build
   `/drivers/<CODE>/`). **The natural next plan** is grounding road-law
   answers on the corpus, whose every law already cites the manual -- that
   is a different source, a different scope and a different guard, and it is
   not this one.
4. **The model writes, structured.** `LEARNER_ASK_MODEL = 'claude-opus-5-5'`
   (the current default; the partner router stays on `ASK_MODEL`, untouched),
   `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`,
   adaptive thinking as the model's default, `max_tokens: 1024`. The schema:
   ```
   { scope: 'app' | 'road-law' | 'price' | 'promise' | 'other',
     answer: string,          // in the learner's language; empty unless scope is 'app'
     sources: string[] }      // section ids and faq ids the answer rests on
   ```
   `system` is two cached blocks: the rules, then the book and the FAQ for
   this language (`cache_control` on the last). The conversation is replayed
   as it was logged: the learner's scrubbed question, the assistant's turn
   as the JSON it returned (or, for a refused turn, the JSON the worker
   substituted), so a follow-up resolves. **No `fallbacks`.** A refusal from
   the model's own safeguards is answered like every other failure here --
   the honest line and the address -- and is worth reading in the log, not
   routing around; one code path, one thing to test.
5. **The five rules in the prompt**, and the test holds the prompt to each:
   1. *Answer the question that was asked and nothing else.* If it is a
      yes-or-no question, the first word is **Yes** or **No** (**Sí** or
      **No**). At most three sentences. Add nothing the learner did not ask
      about, however relevant; they can ask.
   2. *Every statement comes from the sections given.* Nothing from memory
      about this app, any other app, or the law. Name the sections you used.
      If the sections do not answer it, say so in one sentence and name the
      page or address that does -- do not guess.
   3. *Never write a number the sections do not contain*, and never a
      price, a date or a time: the price is shown at checkout.
   4. *Scope.* A rule of the road, a sign, a speed, a fine, an age, a
      document or a state's requirement is `road-law`. What it costs is
      `price`. Whether you will pass, whether a refund will be approved,
      whether somebody will write back is `promise`. Anything not about
      this app is `other`. For every scope but `app`, `answer` is empty.
   5. *Language.* Answer in the language the learner wrote in; the book is
      English and the answer is not a translation of it but an answer.
      Point to pages by the names the book uses.
6. **The worker's checks, in order, before anything is shown**, each writing
   its reason to the row's `model` column and answering with the worker's
   own line rather than the model's text:
   - scope ≠ `app` → `scope:<scope>`; the line is the worker's for that
     scope (`road-law`: *I can't answer road law -- the cards cite your
     state's manual, and your state's page has the test's numbers*, with a
     link to `/drivers/<CODE>/` when a code was sent; `price`: *the price is
     shown before checkout*; `promise`: the address; `other`: the no-match
     line).
   - `sources` empty, or any id not in the bank → `unsourced`.
   - any run of digits in `answer` that does not occur in the text of the
     cited sections → `ungrounded`. This is the guard that makes writing
     safe: the model may phrase, it may not invent a figure.
   - `answer` contains `$`, `€`, `USD`, or a digit followed by a currency
     word → `priced`.
   - `answer.length > MAX_ANSWER_CHARS` (600) → `overlong`.
   - otherwise → shown, `model: LEARNER_ASK_MODEL`.
   A refusal from the model (`stop_reason: 'refusal'`), an unparseable
   reply, an unreachable model and a missing key all land on the no-match
   line with the address, exactly as today (`refused` / `unparsed` /
   `unreachable` / `unavailable`).
7. **Its own route, table and ceiling.** `POST /api/ask` →
   `handleLearnersAsk`: the same shape as `handlePublicAsk` -- `readAsk`,
   turn, ceiling before challenge, challenge on turn one, claim before ask,
   retention in the write -- against **`learner_questions`** (`conversation,
   turn, asked_at, lang, state, question, answer, scope, sources, model`),
   never `partner_questions`: a learner's question must not appear in the
   partner box's log or count against its ceiling, and a NULL-column
   convention is how that would quietly happen. `LEARNER_DAILY_QUESTIONS =
   300`. Additive schema -- `CREATE TABLE IF NOT EXISTS` and the
   `(conversation, turn)` unique index and `asked_at` index -- applied to
   production D1 by hand before the worker, as the deploy skill's step 2
   requires. `turnsOf`, `pastCeiling`, `claimTurn` are parameterised by
   table or duplicated for the new one if that reads worse: the builder's
   call, declared.
8. **Scrubbed, all of it, before the model and before the row.** The
   question goes through `redact` and then an email strip. The feedback box
   keeps the email because a person replies; nobody replies here, so an
   email a fifteen-year-old typed into a chat box has nowhere to go but a
   table and a third party, and it goes to neither. The notice says so.
9. **The page and its doors.** Overlay `ask` at `/#ask`, titled *Ask a
   question*, on `Screen siteFooter` like every page, so Back closes it and
   the phone's screen is the modal. Reached from the footer -- the row
   becomes six links, *Terms · Privacy · FAQ · Ask · About · Contact*
   (`site-footer-ask`; trust-signals' "exactly five" re-pointed to six,
   declared) -- and from the FAQ page's first row under its heading
   (`faq-ask-link`, *Can't find it? Ask.*). No menu row. `MENU_PAGES` gains
   `'ask'` in both lists. The label promises no person: no avatar, no
   "online", no "we reply within".
10. **The box speaks the learner's language and renders text.** `AskBox`
    gains `labels` (placeholder, button, waiting, failure, no-match,
    two-misses) defaulting to today's English, and the learner page passes
    `t.ask.*`. The answer is `Prose` as now; beneath it, `ask-sources`: for
    each cited section with a `page`, a link *Read more: <page title>*, so
    the pages that bind are one tap from the answer. The partner pages pass
    nothing new and change nothing. `src/api.ts` gains `askLearners`.
11. **The notice and the privacy page tell the truth, which is a new
    truth.** The notice above the box, in the learner's language: *Answers
    are written by a model from a description of how this app works. It is
    told to answer only from that description, and we check every number it
    gives against it -- but it can still be wrong, and the pages it links to
    are what count. Road law is on the cards, not here. What you type is
    kept, without your name or any id, for {retention_days} days; phone
    numbers and email addresses are removed first.* `Privacy.tsx` gains
    `privacy-learner-questions` under *If you ask a question* saying the
    same, naming `ASK_MODEL_PROVIDER`; the partner paragraph's "only free
    text this app stores from anybody who has not signed up" becomes "one of
    two boxes whose text this app stores" and names the other.
12. **The eval measures writing, not routing.** `scripts/learner-ask-eval.
    json`: thirty-odd cases, each `{ lang, question, history?, expect: {
    scope, lead?: 'yes' | 'no', contains?: string[], notContains?: string[]
    } }` -- *do i need an account* (`no`, contains `recovery code`), *can i
    use it on my laptop too* (`yes`, contains `5`), *is this the real dmv
    test* (`no`), *what does it cost* (`price`), *will i pass if i get
    prepared* (`promise`), *can i turn right on red in maryland* and *how old
    do i have to be in texas* (`road-law`), *cuánto cuesta* (`price`),
    *¿necesito una cuenta?* (`no`, contains `código`), and three follow-ups
    (*and on a tablet?* after the laptop question). `scripts/learner-ask-
    eval.ts` runs them against the live model through the same `askLearner`
    function the worker uses, prints pass/fail per case and the answers, and
    is run by hand; its table goes in the PR body. Not part of `npm test`.
13. **No new analytics event** (`page_viewed: ask` is a value); **no change
    to the partner or rep boxes**, their banks, prompts, routes or tables;
    **no worker change beyond the route, the asker, the bank and the table.**

## The change

### 1. The book and the bank: `learner-knowledge-base.md`, `build-learner-kb.ts`, `package.json`

- The book as decision 1, every section, each with its `source` comment.
  Written from the code and the plans it names, not from recollection; where
  the author is unsure what a screen does, the answer is to open the screen
  (`npm run dev`), not to describe it from the README.
- `scripts/build-learner-kb.ts`: parse `## <id>` sections (title from the
  first line, `page` from its comment), fill placeholders from the imports in
  decision 1 (the FAQ test's spelled-number helper is lifted into a shared
  module so both use it), flatten `FAQ.en` / `FAQ.es` to plain text, write
  the JSON. Refuse to write if a placeholder is unknown or a digit is found
  outside a placeholder.
- `npm run kb:build` runs both builders.
- `tests/unit/learner-knowledge-base.test.ts`: the JSON is byte-equal to a
  fresh build; the markdown has no bare digit; every placeholder in the
  table is used at least once and no unknown one appears; the pinned section
  ids all exist in order; no section states a question count or pass mark
  (regex over `questions`/`pass mark` adjacent to a digit in the *built*
  text, which can only come from a placeholder, so the assertion is that no
  placeholder puts one there); every FAQ id appears for both languages.

### 2. The worker: `ask.ts` (or `learner-ask.ts`), `partner-api.ts`, `index.ts`, `schema.sql`

- `worker/src/learner-ask.ts`: `LEARNER_ASK_MODEL`, `MAX_ANSWER_CHARS`,
  `LEARNER_DAILY_QUESTIONS`, `learnerPrompt(lang)` (the five rules, then the
  book, then the FAQ for `lang`), `answerSchema`, `LearnerAsker` type
  (`{ lang, state, question, history: LearnerTurn[] } → { scope, answer,
  sources, model, stop }`), `learnerAskerFor(apiKey)` mirroring `askerFor`,
  and `checkAnswer(reply, bank)` implementing decision 6 as a pure function
  returning `{ ok: true, answer, sources } | { ok: false, reason, line }`.
- `partner-api.ts` (or a new `learner-api.ts`): `handleLearnersAsk` as
  decision 7; the scrub as decision 8; the row written with `answer`,
  `scope`, `sources` (JSON), `model`; the response
  `{ id: 'answer' | 'no-match', answer?, sources?: { id, title, page }[],
  contact?, handOff?, pointer?: string }`.
- `index.ts`: the route; `deps.askLearner = learnerAskerFor(env.ANTHROPIC_API_KEY)`.
- `schema.sql`: the table and indexes, additive, with the comment saying why
  it is not `partner_questions`.

### 3. The app: `AskBox.tsx`, `src/screens/Ask.tsx`, `App.tsx`, `SiteFooter.tsx`, `Faq.tsx`, `Privacy.tsx`, `strings.ts`, `analytics.ts`, `api.ts`, `legal.ts`

- `AskBox` labels as decision 10; `ask-sources`; the `pointer` line rendered
  on a scope refusal (`ask-pointer`) with its link.
- `Ask.tsx`: heading, the notice (`t.ask.notice(retentionDays)` with the
  constant), three examples from `t.ask.examples`, the box with `send=
  askLearners`, `lang` and the chosen state code from the app's state.
- `App.tsx`: overlay `'ask'`; `SiteFooter`: the sixth link; `Faq.tsx`: the
  door; `Privacy.tsx`: decision 11; `legal.ts`: `LEARNER_QUESTIONS_NOTICE`
  is **not** added there -- the notice is in `strings.ts` because it has a
  Spanish form; `ASK_MODEL_PROVIDER` is reused. `analytics.ts` and the
  worker's `MENU_PAGES` gain `'ask'`. README's `page_viewed` row names it.

### 4. The eval: `scripts/learner-ask-eval.json`, `scripts/learner-ask-eval.ts`, `package.json`

As decision 12; `npm run ask:eval:learner`.

### 5. Existing tests that change, and what each keeps

- `tests/e2e/site-footer.spec.ts:224` -- the footer has exactly **six**
  links, still zero buttons. Declared re-point; the button assertion is
  untouched. Guard 2 of trust-signals (each link opens its page) gains the
  `ask` row.
- `tests/e2e/ask.spec.ts:372` still holds the partner paragraph to its
  number; it gains nothing. The new paragraph has its own test.
- `tests/e2e/menu-page-views.spec.ts` gains nothing (no menu row); the
  `page_viewed: ask` guard is in the new spec.
- `worker/tests/*`: the unknown-route sweep, if it names `/api/ask`, gains it
  as a known route.
- Nothing is removed or weakened.

## Acceptance criteria

1. From the footer's *Ask* and from the FAQ page's *Can't find it?* row, a
   page at `/#ask` opens with a heading, a notice saying that a model writes
   the answers from a description of the app, that every number is checked
   against it, that it can be wrong, that road law is not answered here, and
   what is kept and for how many days; three one-tap examples; and the box
   -- all in Spanish when the app is in Spanish, including the box's labels.
2. A question about how the app works is answered by the model's own
   sentences, in the learner's language, shown with the titles of the
   sections it drew on and a link to each page they name; a yes-or-no
   question is answered with *Yes* or *No* (*Sí*/*No*) first; the answer is
   at most three sentences and contains nothing the question did not ask
   about (measured by the eval, and by the prompt test for the rules).
3. A question about a rule of the road, a sign, a fine, an age or a state's
   requirement is answered with the worker's road-law line and a link to the
   chosen state's page, never with the model's text; a question about the
   price with the worker's checkout line; a question asking for a promise
   with the address.
4. An answer from the model that cites no section, contains a number absent
   from the sections it cites, names a price, or exceeds `MAX_ANSWER_CHARS`
   is not shown; the learner sees the no-match line and the address, and the
   row records which check refused it.
5. The first question of a conversation requires a passed Turnstile
   challenge; a follow-up does not and is answered with the earlier turns in
   view (a follow-up that only makes sense given the previous question is
   answered as that question); a failed challenge is refused with the
   address; a conversation ends at `MAX_TURNS`; a question over
   `MAX_QUESTION_CHARS` is refused without asking the model.
6. Past `LEARNER_DAILY_QUESTIONS` in a day the box answers the ceiling line,
   asks the model nothing and writes no row; the partner and rep boxes'
   ceilings are unaffected by learner questions and vice versa.
7. Every learner question is written to `learner_questions` with its
   language, state, scrubbed question (phone numbers, codes **and emails**
   removed), the answer shown or the reason none was, and the sections
   cited, against no id of any kind; nothing is written to
   `partner_questions`; rows older than the retention window are gone the
   next time anyone asks.
8. With no model key, the model unreachable, an unparseable reply or a
   refusal, the box answers the no-match line with the address; the route
   answers 200.
9. `worker/src/learner-knowledge-base.json` is exactly what `npm run
   kb:build` writes from the book and `src/faq.ts`; the book contains no
   bare digit; every number in the built text comes from a named constant;
   every section in decision 1 exists; no section states a state's question
   count, pass mark or time limit; the FAQ is present in both languages.
10. The system prompt for Spanish contains the Spanish FAQ and not the
    English one, and the five rules; the prompt for either language contains
    no partner or rep entry's text.
11. The privacy page has a paragraph on learner questions naming the
    retention days, the scrub, the absence of ids, and the model provider,
    and saying the answers are written by a model from a description of the
    app; the partner paragraph no longer claims to be the only stored free
    text.
12. Opening the ask page sends one `page_viewed` with `page: 'ask'`; no new
    event name exists; the partner and rep boxes behave exactly as before
    (their tests pass unchanged).
13. `worker/schema.sql` changes only by the additive table and its indexes;
    the eval's table of thirty-odd cases is in the PR with every `scope`
    and every `lead` right and every `contains` present, or the misses named
    and the prompt change that answers them.

## How this fails silently, and what is written to catch it

Worker guards run in workerd against the local D1 with the harness's
`partnerDeps` (`verifyTurnstile: token === 'good-token'`) and a fake
`askLearner` that returns whatever the test says the model said; the point of
most of them is that **what the model says is not what the learner sees
unless it passes**. E2E guards stub `/api/ask` and the Turnstile script as
`ask.spec.ts` does.

1. **The model's text reaches the screen on a refused scope.** Worker: the
   fake returns `{ scope: 'road-law', answer: 'Turn right on red after a
   full stop', sources: ['studying'] }` → the response has no `answer`,
   `pointer` names the state's page, and the row's `model` is
   `scope:road-law`. Mutation: `checkAnswer` tests only `sources`. Red on the
   absent `answer`.
2. **An invented number is shown.** Worker: the fake returns `{ scope: 'app',
   answer: 'Up to 7 devices.', sources: ['paying'] }` with the bank saying 5
   → no `answer`, `model: 'ungrounded'`; the same reply with `'Up to 5
   devices.'` → shown. Mutation: the digit check reads the whole bank instead
   of the cited sections (7 appears nowhere, so make the mutation `return
   true` from the digit check). Red on the first case's `answer`.
3. **A price gets through.** Worker: `'It is $9.99.'` with `sources:
   ['free-and-paid']` → no `answer`, `model: 'priced'`. Mutation: drop the
   currency check. Red on `answer`.
4. **Nothing cited, something shown.** Worker: `{ scope: 'app', answer:
   'Yes.', sources: [] }` → no `answer`, `model: 'unsourced'`; `sources:
   ['join-offer']` (a partner id) → the same. Mutation: accept any non-empty
   `sources`. Red on the partner-id case.
5. **The Spanish learner gets the English bank.** Unit:
   `learnerPrompt('es')` contains `FAQ.es[0].question` and not
   `FAQ.en[0].question`; both prompts contain each of the five rules by a
   distinctive phrase; neither contains `ENTRIES[0].answer`'s first sentence.
   Mutation: `learnerPrompt` ignores `lang`. Red on the English question's
   presence.
6. **Learner rows land in the partner table, or count against its pool.**
   Worker: one learner question and one partner public question →
   `learner_questions` 1 row with `lang` and `answer`, `partner_questions`
   1 row; `LEARNER_DAILY_QUESTIONS` learner rows seeded → the learner box is
   at ceiling and the partner box still answers. Mutation: the learner
   handler writes to `partner_questions`. Red on the row counts.
7. **The scrub is skipped, or keeps the email.** Worker: a question
   containing a phone number and an email → the stored `question` has
   neither, and the fake asker's recorded request has neither. Mutation:
   pass `asked.question` raw to the asker. Red on the recorded request.
8. **The challenge is not asked, or is asked twice.** Worker: turn one with a
   bad token → refused with `contact`, no row; turn one with `good-token` →
   answered; turn two with no token → answered. Mutation: skip
   `verifyTurnstile` for the learner route. Red on the first refusal.
9. **The follow-up loses the thread.** Worker: two turns; the fake records
   `history` → on turn two it holds turn one's question and the answer that
   was shown (or the substituted JSON for a refused one). Mutation: pass
   `history: []`. Red on the recorded history.
10. **Retention is a promise again.** Worker: seed a learner row at `now −
    QUESTION_RETENTION_SECONDS − 1`, ask once → the old row is gone, the new
    one present. Mutation: drop the DELETE for the learner table. Red on the
    old row.
11. **The book drifts from the code, or types a number.** Unit: regenerate
    and compare bytes; scan the markdown for `\d` outside `{…}`; every
    placeholder resolves. Mutation: edit one digit into the markdown by
    hand (`three` → `3`). Red on the digit scan. Second mutation:
    `REFUND_WINDOW_DAYS = 14` → red on the byte equality (the JSON says 21).
12. **A section goes missing.** Unit: the pinned list of section ids is the
    book's, in order. Mutation: delete `the-guarantee`. Red on the list.
13. **E2E: the model's answer is what is drawn, with its sources.** Stub
    `/api/ask` → `{ id: 'answer', answer: 'Yes. The recovery code moves it.',
    sources: [{ id: 'paying', title: 'Paying', page: '#terms' }] }` →
    `ask-answer` has the text, `ask-sources` has a link to `#terms` titled
    *Paying*. Mutation: `ask-sources` not rendered. Red on the link.
14. **E2E: a scope refusal shows the pointer, not an answer.** Stub `{ id:
    'no-match', pointer: 'Road law is on the cards…', pointerHref:
    '/drivers/MD/', contact }` → `ask-pointer` visible with the link,
    `ask-answer` count 0. Mutation: render `pointer` inside `ask-answer`. Red
    on the count.
15. **E2E: the doors, and the footer still has no buttons.** `site-footer-ask`
    and `faq-ask-link` both land on the ask heading with `location.hash ===
    '#ask'`; the footer has six links and zero buttons. Mutation: the footer
    link's href `#faq`. Red on the hash.
16. **E2E: Spanish labels and notice.** With the app in Spanish, `/#ask`
    shows the Spanish heading, notice, placeholder and button, and no English
    label. Mutation: `Ask` passes no labels. Red on the placeholder.
17. **E2E: the privacy page says it.** `privacy-learner-questions` visible,
    contains the retention days, the provider and *written by a model*; the
    partner paragraph no longer contains *only free text*. Mutation: delete
    the new paragraph. Red on the testid.
18. **E2E: the view is counted and nothing new is sent.** Open `/#ask` → one
    `page_viewed` with `page: 'ask'`; every event name seen is in
    `EVENT_NAMES`. Mutation: `MENU_PAGES` without `'ask'`. Red on the beacon.

## Build order, inside the one PR

1. §1 the book, written first and read back against each `source` it
   names; the builder; guards 11–12.
2. §2 the worker: prompt, schema, asker, `checkAnswer`, route, table,
   ceiling, scrub, retention; guards 1–10.
3. §3 the page, the box's labels and sources, the two doors, the notice,
   the privacy paragraph, strings; guards 13–18; the footer guard re-pointed
   to six.
4. §4 the eval; run `npm run ask:eval:learner` by hand; fix the prompt until
   every scope and lead is right; put the table in the PR.
5. `npm test` once, on the final tree.

## Deploy order, for the deploy skill after the merge

1. **Schema first.** `git diff <last tag> HEAD -- worker/schema.sql` is the
   `learner_questions` table and its indexes; apply exactly those statements
   to production D1, then `SELECT COUNT(*) FROM learner_questions` → 0. The
   skill refuses to go on until this is done, and that is right.
2. Worker; then `curl -s -X POST https://howardslantern.com/api/ask -H
   'Content-Type: application/json' -d '{}'` answers **400** `a conversation
   id is required` -- a new route, which an old worker answers 404.
3. Pages; then `/#ask` on a phone: *do I need an account?* answers *No…*
   with *Read more*; *can I turn right on red?* answers the road-law line
   with the state's page; *what does it cost?* answers the checkout line.
   Read the three rows in `learner_questions` and nothing new in
   `partner_questions`.

## Non-goals

- **Road law, state requirements, fines, ages, documents, question counts,
  pass marks, time limits.** The cards and the state's page do those with
  the manual's sentence. Grounding the box on the corpus is the next plan,
  not a fallback in this one.
- **A price, a date, a promise.** Each is a scope with a worker-written line.
- **A Spanish book.** The model answers in Spanish from the English book and
  the Spanish FAQ; the eval decides whether that holds.
- **A person on the other end**: live chat, a reply queue, an "online"
  indicator. The address is the hand-off.
- **A floating bubble**, a badge, a proactive popup, a menu row.
- **Changing the partner or rep boxes** -- their model, prompt, banks,
  routes, tables or limits -- or the mesh.
- **An admin screen for learner questions.** `wrangler d1` for now; a view
  is its own plan once there are rows worth reading.
- **Storing any id with a question**: no device id, session, purchase id or
  IP. No email either, scrubbed or otherwise.
- **Server-side fallbacks on a model refusal.** One failure path, the
  honest one.
