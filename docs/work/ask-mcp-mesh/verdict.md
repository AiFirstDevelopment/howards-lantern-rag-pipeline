# Verdict: ask-mcp-mesh

- **Slug:** ask-mcp-mesh
- **Branch:** feature/ask-mcp-mesh
- **Outcome:** ready with follow-ups
- **Reviewed at:** `aec11293cfd613781f86c9ae2bbca7581daa6caa` (six lenses, 31 findings, 2 blockers)
- **Adjudicated at:** `aa135ac`
- **Suite:** green — 1111 unit, 621 workerd, 522 e2e, whole `npm test` on the
  commit being merged with a clean tree.

## What needs a human

### Three acceptance criteria are not met as written

- **AC14 — partly.** `payout_status` returns the real blockers and names the
  specific ones rather than reciting the six conditions, which is the substance
  of the criterion. But "the amount short of the floor" is not stated: the
  blocker says *"under the $50 threshold; rolls to the next run"* — the floor,
  not the shortfall — and the figures reach the screen as `payableCents: 2000`,
  a raw field name and a cent integer. See escalation 2.
- **AC16 — "on the next request" is not true.** The edit *is* written to R2 as a
  new version, *is* served with no deploy, and the previous version *is*
  recoverable in one action. But a fine server holds a good read for
  `KB_CACHE_SECONDS = 30` and a save does not invalidate it, so on a warm
  isolate the operator can be shown the old text for up to half a minute. The
  window is now pinned by a test that fails if it grows, and the editor's own
  notice and the runbook both say "within 30 seconds" instead of "on the next
  request". The criterion is met within 30 seconds and not on the next request.
- **AC22 — the plumbing is met and verified; the last clause is not verified.**
  `npm run mesh:dev` now brings all eight workers up on a machine with no
  Cloudflare credentials, seeds a local R2 from the committed markdown, applies
  the schema, and a question posted at the local partner screen is answered
  **through the mesh** — I confirmed the response carried the `unavailable` list
  that only the mesh path produces. What I could not confirm is a *written*
  answer: without `ANTHROPIC_API_KEY` the coarse server names no tools and
  degrades, exactly as documented. See escalation 7.

### Eight escalations

**1. An entry added or renamed through the editor never reaches an asker.**
`answerThroughMesh` re-checks each returned id with `entryFor`, which resolves
against `worker/src/knowledge-base.json` — compiled at build time. A new entry
saved through /admin passes the write gate, is written to R2, is served by the
fine server and is dropped at the last hop; the asker gets the contact address
for a question that now has a written answer. The same happens if an operator
fixes a typo in an existing `## ` heading.

I did not remove the check. It is the second, independent no on the audience
split, in the worker that knows who is asking from a session rather than from a
claim, and the reviewer's suggestion — trust the `audience` field the mesh
itself reported — makes the two checks the same check. I made the drop
attributable instead: it is now logged, naming the id and the audience.

*Options:* (a) leave it, and treat "a new entry needs a deploy of
`knowledge-base.json`" as the documented rule; (b) keep the id list as the gate
but rebuild it from R2 at boot rather than at build; (c) replace the membership
test with an audience assertion and accept the loss of independence.
*Recommendation:* (a) until R2 becomes the only copy — which the plan's own
non-goals defer as a separate storage re-key that must ship alone. Decide
before the flag goes on, because the demo in the runbook ("save, and ask the
question again") only works for edits that change no id.

**2. How a live tool's figures reach a partner, before `ASK_VIA_MESH` goes on.**
`linesOf` in `worker/src/partner-api.ts` walks a tool result and emits
`` `${name}: ${value}` `` for every scalar, so a partner asking why they have
not been paid reads `pendingCents: 0`, `payableCents: 2000`, `paidCents: 0`,
`status: active`. Worse, an array of ledger rows is flattened key by key with
the `entries` key and every row boundary dropped: `commission_ledger` renders as
one undelimited list of up to a hundred lines.

None of this was executed by any test — the e2e fixture hand-wrote the exact
`lines` it then asserted. It is now pinned by three cases in
`worker/tests/mesh-ask.test.ts`, so it cannot change unnoticed, and the two code
comments claiming the figures reach the asker "in the words the query itself
produced" have been corrected: that is true of `payoutBlockers`' sentences and
false of every scalar. *Recommendation:* have each live tool return
display-ready lines the way `payoutBlockers` already does, rather than teaching
`linesOf` what a currency is. Not done here: it changes what three live tools
return and belongs with somebody who can look at the screen.

**3. PLAN DEFECT (builder) — the cron ban is a proxy guard.**
`tests/unit/partner-schema.test.ts` forbids *all* cron triggers on the partner
worker to prevent one specific thing (a scheduled job renewing partner codes).
The build worked around it by putting the re-validation in its own worker, which
is correct and leaves the existing assertion passing untouched. But the next
scheduled job hits the same wall. *Recommendation:* narrow that assertion to the
invariant its own docstring names. Not done here — it is another change's
invariant and touching it in this one would be exactly the weakening the rule
exists to prevent.

**4. PLAN DEFECT (builder) — `vitest-pool-workers` multi-worker harness.**
The plan assumed auxiliary workers could be registered through
`poolOptions.workers.miniflare.workers`; they can, but they need a pre-built
script, which would put an esbuild step between `mcp/fine/*/index.ts` and every
assertion about it. The build drove each Worker's own default export in-isolate
instead. Informational, and I agree with the call — but see below: it is exactly
why the coarse worker's boot failure escaped, and I added the guard that closes
that gap rather than changing the harness.

**5. PLAN DEFECT (builder) — S12's daily-ceiling premise is false in the built
design.** The plan said the ceiling had to move to the coarse server; with one
model call instead of two, the existing worker still sees every whole question
and the ceilings bound exactly what they always bounded. The coarse server
enforces `MAX_TOOL_CALLS` instead. Correct as built. *This has to be re-taken*
if the coarse server is ever given a public route of its own or a second model
call, and it will then need a store.

**6. AC4 and AC15 cannot both be taken at their word, and the build chose AC4.**
With exactly one model call there is no turn on which the model sees a tool
result, so AC15's permission to compose numbers is stated and never exercised.
This is the safer reading and the one the Intent asks for, but it is a real
narrowing of AC15's first sentence and it is a decision. *Recommendation:*
ratify it. The alternative is a second model call carrying tool results, which
fails AC4's counted test and puts a model between a partner and a sentence about
their money.

**7. `ANTHROPIC_API_KEY`, and the first question of a `mesh:dev` run.**
AC22's last clause needs the key. Separately, on the *first* question of a fresh
`mesh:dev` run, five of the six fine servers fail their R2 read with miniflare's
`internal error; reference = …` — six wrangler processes opening the same
`--persist-to` store at once — and recover on the second question, because the
store deliberately caches only good reads. Observed and reproduced. The demo's
first tap is therefore degraded. *Options:* warm the fine servers after startup,
give each its own persist directory, or leave it and ask twice.
*Recommendation:* leave it for now and say so in the demo notes; a retry inside
`knowledgeFor` would blunt AC3, which is the more valuable property.

**8. The eval baseline is empty and the account actions are untaken.**
`scripts/ask-eval-baseline.json` has `recordedAt: null`; recording it against
the **old** router before `ASK_VIA_MESH` is turned on is the only before-number
that will ever exist, and it is step 6 of the runbook. Steps 1–9 —
create the bucket, generate and install the key pair, seed the six objects,
deploy eight workers, **uncomment two bindings**, flip the flag — are all
account actions nothing in this repository can take.

### One thing whoever deploys must know

`worker/wrangler.toml` now has **two** commented-out blocks, not one: the
`COARSE` service binding and the `[[r2_buckets]] KB` block. Both name resources
that do not exist yet, the Workers API refuses a script bound to either, and
`wrangler deploy --dry-run` will not tell anybody because a dry run never
contacts the API. Uncommenting them is step 8. Until then the editor at /admin
answers 503 and logs `admin-kb: no KB bucket is bound`, which is the intended
inert state. `tests/unit/mesh-config.test.ts` goes red if either is uncommented,
so step 8 is a deliberate deletion of an assertion rather than a config that
quietly broke.

## The findings

Thirty-one findings across six lenses. **Every one held up on verification** —
I found none that was confidently wrong, which is worth saying plainly because
it is not the usual result. Seven were the same defect seen by two lenses, so
they describe 24 distinct problems. Twenty-two are fully fixed here; two are
fixed in part with the remainder escalated above. Four *suggested remedies* were
declined, with reasons, while their underlying observations were accepted.

### The two blockers, and why neither could have been found by reading

**The coarse aggregator could not start at all.**
`export const COARSE_AUDIENCE = 'ask-coarse'` on `mcp/coarse/index.ts` — the
Worker entry module. workerd requires every named export of an entrypoint to be
something it can construct, and refuses the whole service otherwise:

```
✘ [ERROR] service core:user:ask-coarse: Uncaught TypeError: Incorrect type for
  map entry 'COARSE_AUDIENCE': the provided value is not of type 'function or
  ExportedHandler'.
✘ [ERROR] The Workers runtime failed to start.
```

I reproduced this before fixing it and confirmed the fix by booting the worker.
With the flag on and the binding uncommented, `meshAskerFor` would have caught
the failed `coarse.fetch` and returned null, so **every partner question would
have landed on the contact address** — the mesh's own quiet-failure direction
hiding a worker that never existed. Nothing saw it because
`wrangler deploy --dry-run` bundles without booting the runtime (it exits clean,
"Total Upload: 1194.79 KiB") and every test imports the default export directly.

*Fixed:* the constant lives in `mcp/shared/auth.ts`, beside `TOKEN_ISSUER`,
where `worker/src/mint.ts` already took it from — the duplicate definition is
gone too. *Guarded:* `worker/tests/mesh-fine.test.ts` reads the export table of
all eight mesh entry modules and fails on any named export that is not a
function. Mutation-tested: adding a string export back turns it red.

**`npm run mesh:dev` came up with nothing working and announced success.**
Five separate defects, all confirmed, four of them silent:

| What | Effect |
|---|---|
| `--env-file` given a path relative to the repo root | wrangler resolves it against the config's own directory, finds nothing, **warns about nothing**, and the `[vars]` default stands — all eight workers ran with `MESH_PUBLIC_KEY=""` and refused every MCP call with a 401 naming nothing |
| No `--inspector-port` | eight processes spawned in one tick each probe for the same devtools port; seven die on `Address already in use` |
| `ASK_VIA_MESH=1` against `worker/wrangler.toml`, whose `COARSE` binding is commented out | the old single-worker path answered; the mesh was never consulted |
| No `VITE_API_BASE` | `apiConfigured()` false, so `askPartners` returned null before any request left the browser |
| `worker/schema.sql` never applied to the fresh persist directory | first question → `D1_ERROR: no such table: partner_questions` → HTTP 500 |
| The banner printed unconditionally | "The mesh is up" over seven dead workers |

I verified the `--env-file` behaviour directly: the same file by relative path
gives `env.MESH_PUBLIC_KEY ("")` with no warning, and by absolute path gives
`Using secrets defined in …` and `("(hidden)")`.

*Fixed:* absolute `--env-file`; an explicit `inspectorPort` per service; a
generated `worker/wrangler.mesh-dev.toml` (gitignored) carrying the `COARSE` and
`KB` bindings for the local run only, so the deployed config stays inert;
`VITE_API_BASE` and Cloudflare's published always-passes Turnstile test pair
passed to vite and the worker; `worker/schema.sql` applied beside the R2 seed;
and `waitForReady`, so the banner cannot claim a worker that has not said
"Ready on" itself. *Verified end to end:* eight workers ready, schema applied,
and `POST /api/partners/ask` answered through the mesh.

### The rest, by what they change

**Six answers no partner could reach** (correctness F1, and the security lens
independently). The fine servers read `read:own-money` to decide which entries a
caller may see, but `scopesForAudience` strips that scope from every domain with
no live tool. So an **active** partner asking `kb-account` — which has no live
tools — was served the public corpus: `account-session`, `account-suspended`
and the four `learners-*` figures, six entries they can read today on the same
route, came back as "I do not have a written answer to that one". Every
partner-audience entry in `joining` and `promotion` too. The one test that
looked like it covered this hand-signed a `kb-account` token carrying
`read:own-money`, which the exchange can never issue, so it passed over the bug.

*Fixed:* `read:partner` is its own scope, granted to every principal with a
session and carried to all six fine servers; `read:own-money` still goes to
`active` alone and still only to domains with live tools. Two decisions, two
scopes. *Guarded:* `mesh-fine.test.ts` now derives its partner token from
`scopesForAudience(scopesFor('active'))` rather than choosing a scope set by
hand, and `mesh-coarse.test.ts` drives the whole chain — mint, exchange, fine
server — for an active partner asking an account question. Both go red on the
old gate.

**`refund_check` read any purchase by recovery code** (security F1). The tool is
gated on `read:own-money` and passes `args.code` straight to `checkRefund`,
which selects `FROM purchases WHERE p.recovery_code = ?1` with no partner in the
query — it was written for the operator CLI, where the caller is staff. Any
active partner holding a code off a forwarded receipt or a support screenshot
could read another partner's sale: the amount, the date, whether it has been
refunded, and — through `refundConcerns` — whether that buyer ever reached
Certified. The only thing discouraging the call was a sentence in the coarse
system prompt, which is a model instruction standing in for an authorization
control. `mcp/fine/money/live.ts` states the invariant this breaks, ten lines
long, in the file next door.

*Fixed:* scoped to the caller's own codes, answering `{found: false}` otherwise —
the same answer an unknown code gets, so it does not become an oracle for which
recovery codes exist. *Guarded:* two cases in `mesh-coarse.test.ts`, one driving
partner B's code under partner A's token and one confirming a partner's own sale
still answers, so the refusal is the ownership check and not a broken fixture.

**A rule that named a defect it could not catch** (correctness F4). The write
gate's *"shows every agreement section an entry cites"* compared `served >
written`, which fires only when `citeFor` invents sections — the reverse of the
truncation the rule is named and documented for. An operator editing
`Agreement §13 and §14.` into `Agreement §13 and Agreement §14.` breaks
`citeFor`'s run at §13, and the gate allowed the save: a suspended partner would
be shown §13 alone over an answer §14 is half the authority for. This is
inherited from the pre-mesh test, where it was a check that never fired; the
change promotes it to a gate that waves the defect through.

*Fixed:* the rule counts the agreement's own run — accepting a repeated
"Agreement" between links — against what `citeFor` serves, so it catches the
truncation without false-positiving on `compare-not-mlm`, whose second section
belongs to a different document and must **not** be served. The mutation table
entry now exercises the truncation direction, and a new case asserts the
other-document direction stays clean. Both mutation-tested.

**A guard for missing diagrams that let seven of eleven vanish** (correctness
F5, test-quality F2). `expect(kinds).toContain(required.kind)` tested a
document-wide list, so a section could lose its diagram entirely as long as some
*other* section drew the same kind — five draw a flowchart, three a
sequenceDiagram. AC23 says the suite fails naming which. *Fixed:* the document is
sliced at each required heading and the diagram kind asserted inside that slice,
as one test per required diagram. Deleting §5's fence now fails with "the
section for the mint has no diagram at all".

**A total outage that read as "there is no answer"** (correctness F6). The
worker attaches `unavailable` to a no-match as deliberately as to an answer, and
`AskBox` drew it only on the answer — so when every fine server is unreachable
and nothing comes back, the asker was told their question has no written answer.
That is the one case where the outage is invisible and the one where saying so
matters most. *Fixed and e2e-guarded*, and it is not hypothetical: the first
question of a fresh `mesh:dev` run produces exactly this shape.

**The KB bucket binding would have broken the next deploy** (correctness F3).
`[[r2_buckets]] KB` was uncommented in `worker/wrangler.toml` against a bucket
that does not exist, ten lines below a comment explaining at length why the
`COARSE` service binding is commented out for the identical reason. *Fixed:*
commented out beside it, `KB` bound in `worker/vitest.config.ts` instead so the
suite still runs against a real local R2, the runbook step rewritten to cover
both, and a new assertion in `mesh-config.test.ts` that goes red if either is
uncommented.

**AC11's second refusal had no test** (test-quality F1). The "forged call to a
live tool" case went through the coarse server, where `byName` holds only tools
the fine servers declared — so the call was dropped before any fine server saw
it, resting on exactly the filter the sibling test already covers. AC11 forbids
that in as many words. *Fixed:* a case in `mesh-fine.test.ts` sends `tools/call`
for `payout_status` straight at kb-money with a kb-money-audienced token
carrying no `read:own-money`, and pins that no figure comes back. It goes red
when both the declaration filter and the in-handler backstop are removed. The
backstop's comment no longer claims to be independently reachable — it is a
guard against the day somebody registers the live tools unconditionally, and
says so.

**The cron and the write gate disagreed about what a valid corpus is**
(simplicity F2). No rule in `RULES` covers domain placement; the gate checks it
separately and the cron did not. A prefix moving in `kb/domains.ts` without a
`kb:push` misfiles every entry that moved — reachable by nobody, since the
server that answers its question does not hold it — and the nightly run reported
"entries still agree with the code". *Fixed:* the cron checks misfiling too,
guarded and mutation-tested. I did **not** take the suggested refactor of
sharing `readAll` between the two: the gate validates a *proposed* corpus with
one object replaced and the cron validates the stored one, and coupling them
through `admin-kb.ts` would pull the Access and CSRF surface into a scheduled
worker. Recorded as a follow-up.

**Smaller, all fixed:** the answer envelope written out three times in
`partner-api.ts`, now one `renderWritten` — the next fix to `citeFor` would
otherwise land on the first answer and be missed on the `also` half, on exactly
the cross-domain question the architecture exists for (simplicity F5); the demo
token hand-building a claim set `claimsFor` already produces, now routed through
it, so the shapes cannot diverge (spec F3, simplicity F6); ten comments and
config lines citing guards in `mcp/tests/`, a directory that does not exist,
repointed at the files that actually hold each property (correctness F7,
simplicity F3, test-quality F6); `MeshDeps.contact` and the `PARTNER_CONTACT`
var, plumbed through three files and read by nothing, deleted so the address has
one home (spec F2, simplicity F1); three exports with no consumer, deleted
(simplicity F4); the exchange answering through `cors` while its docstring said
"No CORS headers", now `{}` plus `Cache-Control: no-store` (security F2); the
30-second cache window pinned by an assertion naming the operator-facing promise
(spec F5, test-quality F4); an assertion on a recorder the production code had
no reference to — `expect(mesh.seen).toEqual([])` on a local that was never
passed in — now built through `meshAskerFor` so it can actually fail
(test-quality F5); and `figuresFrom`/`linesOf`, the only code deciding what a
partner reads about their own money, executed by no test at all, now driven by
three (test-quality F3).

### Suggested remedies declined, with reasons

- **Trust `written.audience` from the mesh instead of the compiled id list**
  (correctness F2). The second check exists because the mesh answer is not
  trusted about who may see it; taking the audience from the same hop removes
  the independence. Escalated instead, with the drop now logged.
- **Restate AC16 as "within 30 seconds"** (spec F5). A judge may not edit
  acceptance criteria. The runbook, the editor's notice and its e2e assertion
  were corrected instead, and AC16 is reported unmet as written.
- **Share `readAll` between the gate and the cron** (simplicity F2). See above.
- **Conclude AC14 is unmet because the shortfall is not stated** (spec F4). The
  criterion's own gloss is "names the specific ones … rather than reciting the
  six conditions", which `payoutBlockers` does. Recorded as partly met with the
  exact wording rather than as a failure.

## Every criterion, walked

| AC | | Note |
|---|---|---|
| AC1 | met | 72 entries, 23/13/11/7/6/12, none unclaimed, none contested — recomputed from the corpus, not read from the test |
| AC2 | met | and now true for `account`, `joining` and `promotion`, which it was not before |
| AC3 | met | verified live: `503 {"error":"kb-promotion: kb/promotion.md is missing","domain":"promotion","because":"missing"}`. The address itself comes from the worker one hop later, not from the coarse server — the dead `PARTNER_CONTACT` var that suggested otherwise is gone |
| AC4 | met | counted, fails at two |
| AC5 | met | workerd and e2e |
| AC6 | met | and now also when *every* domain is unavailable |
| AC7 | met | the SDK's own client over Streamable HTTP, and the aggregator now boots |
| AC8 | met | all eight configs read for JWK, PKCS8 and PEM private material |
| AC9 | met | replay at a sibling refused on `aud` |
| AC10 | met | re-asserted through the new scope split |
| AC11 | **now met** | was not: the second refusal had no test |
| AC12 | met | 25 cases, indistinguishabilities held |
| AC13 | met | the whole model request walked |
| AC14 | **partly** | blockers specific; figures rendered as `payableCents: 2000`; shortfall not stated |
| AC15 | met | with the recorded narrowing — escalation 6 |
| AC16 | **not as written** | within 30 seconds, not on the next request |
| AC17 | met | and materially stronger: the citation rule now catches truncation |
| AC18 | met | and now catches misfiling too |
| AC19 | met | workerd drives it; the behaviour lens could not forge an Access JWT |
| AC20 | met | `tests/e2e/ask.spec.ts` byte-untouched on this branch, confirmed by diff |
| AC21 | met | six e2e cases, network mocked at the edge |
| AC22 | **not fully verified** | eight workers up, mesh answering; the written answer needs a model key |
| AC23 | **now met** | was not: seven of eleven diagrams could vanish |
| AC24 | met | runbook strengthened: step 8 covers both bindings, the cache wording is honest |

## Non-goals, checked

All held. `worker/src/knowledge-base.md` is byte-untouched (confirmed by diff,
and `tests/unit/kb-partition.test.ts` says so in both directions). No new
domains, no reclassified entries. `ASK_MODEL` unchanged. `ask:eval` is not in
`npm test` and was not run. No Cloudflare resource created, nothing deployed —
and the two bindings that would have forced a deploy are now both commented out.
No production D1 writes. `knowledge-base.json` is still the compiled source and
still the seed.

## Follow-ups

- Share one corpus reader between `admin-kb.ts` and `kb-cron.ts` — the
  divergence that mattered is closed, the duplication is not.
- The first question of a `mesh:dev` run degrades: five of six fine servers fail
  their R2 read on first contention over the shared `--persist-to` store.
- `tests/unit/partner-schema.test.ts` bans all crons to prevent one; narrow it
  to the invariant its docstring names before the next scheduled job.
- `linesOf` flattens arrays of objects with no row boundary — pinned by test,
  behaviour unchanged, decision in escalation 2.
