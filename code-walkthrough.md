# Code walkthrough: the ask box, one hop at a time

A reading guide to the RAG pipeline in this repository, written as a sequence of
hops that follow one question from the browser to the model and back, then the
offline work that builds what the hops read. Each hop names the files and lines
to open, shows the code itself, says what to notice, and ends with a question
to check yourself with. Read the hops in order; each assumes the ones before it.

Line numbers were taken on 2026-10-14 against commit `7728a29`; the merge of
PR #1 touched no source file, so they still hold. The README's own map is the
companion to this: it says why each stage exists, this says where to look and
what to see.

**How to use it.** The code is quoted inline, verbatim, under a link that names
the file and lines it came from; tap the link to see the whole file around it.
Snippets are dedented, and a `// …` marks lines left out. The "Check" question
has an answer somewhere in the code you just read. A session log at the bottom
records which hops have been walked.

---

## Part 1: the request path

One question, with a state chosen, through eight hops.

### Hop 1: the browser sends the question

**Where:** the screen, [src/screens/Ask.tsx](src/screens/Ask.tsx), draws the
nationwide box, the state line and the `AskBox`, and gives the box two callbacks,
`beforeSend` and `send`. The box, [src/components/AskBox.tsx](src/components/AskBox.tsx),
owns the form and the conversation id. [src/api.ts:270](src/api.ts#L270) puts the
request on the wire.

Read it in the order a tap travels: the HTML, the form's submit, the box's
`submit` function, the screen's two callbacks, then the one-line API call.

**The HTML the learner sees.** The checkbox sets `nationwide`; the line under it
names the state answered for, or offers the picker.

[src/screens/Ask.tsx:143-171](src/screens/Ask.tsx#L143-L171)
```tsx
<label className="mt-2 flex items-center gap-2 text-sm font-extrabold">
  <input
    type="checkbox"
    data-testid="ask-nationwide"
    checked={nationwide}
    onChange={(event) => setNationwide(event.target.checked)}
    className="h-5 w-5 accent-sky"
  />
  {t.ask.nationwide}
</label>

<p className="mt-2 text-sm font-bold text-muted" data-testid="ask-state">
  {nationwide ? (
    // No Change control: the state is not what is being answered for.
    t.ask.answeringNationwide
  ) : (
    <>
      {stateName === null ? t.ask.noState : t.ask.answeringFor(stateName)}{' '}
      <button
        type="button"
        data-testid="ask-change-state"
        onClick={() => setChoosing({ question: null })}
        className="font-extrabold text-sky underline underline-offset-2"
      >
        {stateName === null ? t.ask.labels.chooseState : t.ask.change}
      </button>
    </>
  )}
</p>
```

The form itself is the box's. Submitting it calls `submit(question)`; the input
is capped at `MAX_QUESTION_CHARS`, the same constant the worker enforces.

[src/components/AskBox.tsx:545-581](src/components/AskBox.tsx#L545-L581)
```tsx
<form
  className="mt-3 flex flex-col gap-2"
  data-testid="ask-form"
  onSubmit={(event) => {
    event.preventDefault()
    void submit(question)
  }}
>
  {balance}
  <label className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
    {labels.label}
    <input
      data-testid="ask-input"
      value={question}
      maxLength={MAX_QUESTION_CHARS}
      onChange={(event) => {
        setQuestion(event.target.value)
        onDraft?.(event.target.value)
      }}
      placeholder={labels.placeholder}
      autoFocus={autoFocus}
      className="mt-2 min-h-12 w-full rounded-2xl border-2 border-line bg-paper px-4 text-base font-bold normal-case tracking-normal"
    />
  </label>
  <button
    type="submit"
    data-testid="ask-submit"
    disabled={pending || question.trim().length === 0}
    className="min-h-12 rounded-2xl border-2 border-line bg-ink px-4 font-extrabold text-paper disabled:opacity-40"
  >
    {pending ? labels.asking : labels.button}
  </button>
  {waitingForChallenge && (
    <p className="text-sm font-bold text-muted" data-testid="ask-waiting">
      {labels.waiting}
    </p>
  )}
```

**The box's `submit`.** Two things it owns are set up above it: one conversation
id per box instance, and the Turnstile challenge.

[src/components/AskBox.tsx:310](src/components/AskBox.tsx#L310)
```ts
const [conversation] = useState(() => continued ?? uuid())
```

[src/components/AskBox.tsx:336](src/components/AskBox.tsx#L336)
```ts
const { challenge, waiting: waitingForChallenge } = useTurnstile(siteKey, WIDGET_ID)
```

Then the function the form calls. Every path out of it is here: the gate
(`beforeSend`) refusing, the worker unreachable, a code that could not pay, a
refusal asking for a state, and an answer.

[src/components/AskBox.tsx:355-401](src/components/AskBox.tsx#L355-L401)
```ts
async function submit(asked: string, chosen = false): Promise<void> {
  const trimmed = asked.trim()
  if (trimmed.length === 0 || pending) return
  if (beforeSend !== undefined && !(await beforeSend())) return
  setPending(true)
  setTrouble(null)
  // The question that was waiting on a state shows as being asked the moment
  // the state is chosen: with nothing on screen until the answer arrived, the
  // choice read as not having been taken.
  const askedAt = new Date().toISOString()
  if (chosen) setThread((before) => appended(before, { question: trimmed, answer: null, state: scope, askedAt, conversation }))
  const settle = (answer: AskAnswer | null) =>
    setThread((before) => {
      const rest = chosen ? before.slice(0, -1) : before
      return answer === null ? rest : appended(rest, { question: trimmed, answer, state: scope, askedAt, conversation })
    })
  // The tap is not lost while the challenge is still coming: it waits for it.
  const answer = await send({ conversation, question: trimmed, turnstile: await challenge() })
  setPending(false)
  if (answer === null) {
    // The worker could not be reached, which is not the same as having no
    // answer -- so it says so rather than showing somebody a no-match that
    // would have been an answer a minute ago.
    setTrouble(labels.trouble)
    settle(null)
    return
  }
  if (answer.buy === true) {
    // The code could not pay: nothing was asked, and the page has opened the
    // purchase pop-up over a question that stays in the input, exactly as
    // the week's limit leaves it. Not an answer, so nothing joins the thread.
    settle(null)
    return
  }
  if (answer.chooseState === true && onChooseState !== undefined) {
    // The picker opens on the refusal itself, and the refusal is not kept: a
    // "pick your state first" card with a link was one more tap between the
    // learner and an answer that only needed a state. The question stays in
    // the input, so cancelling the picker loses nothing.
    settle(null)
    onChooseState(trimmed)
    return
  }
  settle(answer)
  setQuestion('')
  onDraft?.('')
}
```

**The screen's two callbacks.** `beforeSend` is the gate: the week's free
questions, else a code that can pay (after one confirmation a visit), else the
purchase pop-up and no send.

[src/screens/Ask.tsx:192-217](src/screens/Ask.tsx#L192-L217)
```tsx
<AskBox
  conversation={conversation}
  onDraft={(question) => {
    draft.current = question
  }}
  beforeSend={async () => {
    const kind: AskKind = nationwide ? 'nationwide' : 'state'
    paying.current = false
    if (asksLeft(kind) > 0) return true
    // The week is spent. A code that can pay is used -- after one "Spend
    // a token?" a visit -- and the worker decides whether it really can;
    // a balance not yet read is tried rather than refused.
    const cost = TOKENS_PER_QUESTION[kind]
    if (tokens.code !== null && (tokens.left === null || tokens.left >= cost)) {
      if (!spendConfirmed()) {
        const yes = await new Promise<boolean>((resolve) => setConfirming({ cost, resolve }))
        setConfirming(null)
        if (!yes) return false
        markSpendConfirmed()
      }
      paying.current = true
      return true
    }
    setBuying({ limit: kind })
    return false
  }}
```

`send` counts the question (free ones only), picks the state, and calls
`askLearners`. What comes back may carry the code's new balance or a `buy`.

[src/screens/Ask.tsx:218-243](src/screens/Ask.tsx#L218-L243)
```tsx
send={async (input) => {
  const kind: AskKind = nationwide ? 'nationwide' : 'state'
  const paid = paying.current && tokens.code !== null
  paying.current = false
  // Counted when sent, not when typed: a question the gate stopped
  // above, or one waiting on a state, has cost nothing yet. A paid
  // question is not counted against the week at all; the worker
  // debits it from the code.
  if (!paid) {
    recordAsk(kind)
    setSpent((count) => count + 1)
  }
  const answer = await askLearners({
    ...input,
    lang,
    state: nationwide ? NATIONWIDE : stateCode,
    ...(paid ? { spend: tokens.code ?? '' } : {}),
    // On every question, free ones too: the row is kept under the
    // code, so the code's other devices can read it back.
    ...(tokens.code !== null ? { code: tokens.code } : {}),
  })
  if (answer?.tokens !== undefined) tokens.setLeft(answer.tokens.left)
  // The code could not pay after all -- another device on the same
  // code spent it first. The pop-up, over the question still in the input.
  if (answer?.buy === true) setBuying({ limit: kind })
  return answer
}}
```

**The wire.** `askLearners` is one line over `post`, and `post` answers `null`
for anything it could not parse, which is what the box's `trouble` branch reads.

[src/api.ts:270-282](src/api.ts#L270-L282)
```ts
export async function askLearners(input: {
  conversation: string
  question: string
  turnstile: string
  lang: 'en' | 'es'
  state: string | null
  /** A question code, only when this question is to be paid for with it. */
  spend?: string
  /** The question code this browser holds, on every question: the row is kept under it. */
  code?: string
}): Promise<AskAnswer | null> {
  return await post<AskAnswer>('/api/ask', input)
}
```

[src/api.ts:57-69](src/api.ts#L57-L69)
```ts
async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!apiConfigured()) return null
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as T
  } catch {
    return null
  }
}
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

[src/topics.ts:12-13](src/topics.ts#L12-L13)
```ts
/** What a ticked Nationwide box sends as the state; worker/src/learner-ask.ts `NATIONWIDE` reads it. */
export const NATIONWIDE = 'US'
```

**Notice.**

- One field, `state`, decides the whole path on the worker. `null` is an
  app-only question, `US` is nationwide, anything else is one state's road law.
  `NATIONWIDE` is `'US'` on purpose so a worker deployed before the feature
  treats it as an unknown state and refuses safely.
- The browser sends no law text and gets none back as prose. The response type
  [AskAnswer](src/ask.ts#L10) carries `answer`, then `citations` as
  `{ id, location, kind, asOf }` the browser renders itself. The model's words
  and the citation under them come from two different places by design.
- Free questions are counted client-side before the send
  ([src/ask-quota.ts](src/ask-quota.ts)). Paid ones are debited by the worker only.
- `submit` never throws to the form: the four ways a send can end are each a
  branch, and only the last one clears the input.
- The browser and the worker are separate builds, so shared values are
  duplicated and cross-referenced in comments rather than imported:
  `NATIONWIDE`, `NUMBER_WORDS`, `TOKENS_PER_QUESTION`.

**Check:** what does the worker receive when no state is chosen and nationwide is
not ticked?

### Hop 2: the Pages Function proxies to the worker

**Where:** [functions/api/[[path]].ts:40](functions/api/[[path]].ts#L40), and
before it [functions/_middleware.ts:39](functions/_middleware.ts#L39).

The site is served by Cloudflare Pages. A request to `/api/*` on the site's own
origin is caught by this function and re-fetched against the worker's address.

[functions/api/[[path]].ts:38-75](functions/api/[[path]].ts#L38-L75)
```ts
const DEFAULT_ORIGIN = 'https://learners-permit-api.joelstevick.workers.dev'

export const onRequest: PagesFunction<Env> = async (context) => {
  const incoming = new URL(context.request.url)
  const origin = (context.env.API_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, '')
  const target = `${origin}${incoming.pathname}${incoming.search}`

  // The method, the body and the content type all carry through unchanged --
  // the beacons are text/plain and the feedback is JSON, and the worker tells
  // them apart the same way it always has.
  //
  // The headers do not carry through unchanged, and that is the one thing this
  // hop has to add. Re-fetching the worker makes *us* the client, so the `cf`
  // it reads is our edge and not the visitor; `withVisitorGeo` copies the
  // visitor's own country, region, town, postcode, zone and network onto the
  // request before it leaves. See ../edge-geo.ts for the ten days of geo
  // columns that recorded Cloudflare because this was missing.
  const response = await fetch(target, {
    method: context.request.method,
    headers: withVisitorGeo(
      context.request.headers,
      context.request.cf as unknown as Record<string, unknown> | undefined,
    ),
    body: context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : context.request.body,
    // Required by workerd when a body is a stream rather than a buffer.
    duplex: 'half',
  } as RequestInit)

  // Returned as-is apart from being made mutable. The CORS headers the worker
  // attaches are simply unused now: a same-origin request does not consult them.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
```

[functions/edge-geo.ts:70-86](functions/edge-geo.ts#L70-L86)
```ts
export function withVisitorGeo(
  requestHeaders: Headers,
  cf: Record<string, unknown> | undefined,
): Headers {
  const headers = new Headers(requestHeaders)

  headers.set(VISITOR_EDGE_HEADER, '1')
  for (const field of VISITOR_GEO_FIELDS) {
    headers.delete(field.header)
    const value = cf?.[field.cf]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    headers.set(field.header, encodeURIComponent(trimmed))
  }
  return headers
}
```

The middleware runs first on every request.

[functions/_middleware.ts:39-65](functions/_middleware.ts#L39-L65)
```ts
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const destination = redirectTo(url, context.env.CANONICAL_HOSTS ?? context.env.CANONICAL_HOST)
  if (destination !== null) return Response.redirect(destination, 302)

  /**
   * `308`, permanently, and the difference from the `302` above is the point.
   *
   * That one carries a product decision -- which of our names runs the app --
   * and was revisited the same afternoon it was made, which is why it must stay
   * takeable-back. This one carries a spelling. `/drivers/md` and `/drivers/MD/`
   * are not two decisions, they are one page and a way of typing it, and
   * Cloudflare Pages already answers the un-slashed form with a 308 of its own.
   *
   * What makes permanent safe here is that no URL this site publishes is ever
   * redirected: every canonical tag, every sitemap entry and every internal
   * link already names the target spelling. Only a path somebody typed or
   * mis-cased reaches this line, so a browser that caches the answer forever
   * has cached something we would never have wanted to change.
   */
  const spelled = canonicalPath(url.pathname)
  if (spelled !== null) {
    return Response.redirect(`${url.origin}${spelled}${url.search}`, 308)
  }

  return await context.next()
}
```

**Notice.**

- The file's header comment ([:1-24](functions/api/[[path]].ts#L1-L24)) says
  why this hop exists: Safari classified `pages.dev` to `workers.dev` as a
  cross-site tracking shape and silently dropped the requests. Same origin
  means no CORS preflight and nothing to classify.
- The worker still attaches CORS headers. On this path they are unused.
- `302` versus `308` is a deliberate pair: a product decision that can be
  revisited gets the temporary code, a spelling gets the permanent one.

**Check:** why is the body passed as a stream with `duplex: 'half'` instead of
being read first?

### Hop 3: the worker routes and wires the pipeline

**Where:** [worker/src/index.ts:278-296](worker/src/index.ts#L278-L296), then
[index.ts:1159-1180](worker/src/index.ts#L1159-L1180) for `lawsFromPages` and
`listFromPages`.

The route is one `if` on `/api/ask` and `POST`. Everything the pipeline will
need is assembled right there as a bag of functions, the `LearnerDeps` object.

[worker/src/index.ts:278-296](worker/src/index.ts#L278-L296)
```ts
if (url.pathname === '/api/ask' && request.method === 'POST') {
  return await handleLearnersAsk(request, env.DB, cors, {
    askLearner: learnerAskerFor(env.ANTHROPIC_API_KEY),
    lawsFor: lawsFromPages,
    nearLaws: nearLawsFor(env.AI, env.LAWS),
    rerank: firstOf(haikuRerankFor(env.ANTHROPIC_API_KEY), rerankFor(env.AI)),
    rephrase: haikuRephraseFor(env.ANTHROPIC_API_KEY),
    topics: () => listFromPages<NationwideTopic>(topicsPath()),
    topicLawsFor: (topic) => listFromPages<StateLaw>(topicPath(topic)),
    topicsFor: haikuTopicsFor(env.ANTHROPIC_API_KEY),
    nearLawsNationwide: nearLawsNationwide(env.AI, env.LAWS),
    lawsById: lawsByIdFor(env.DB),
    lawsBySection: lawsBySectionFor(env.DB),
    penaltiesFor: penaltiesForDb(env.DB),
    processRowsFor: processRowsForDb(env.DB),
    verifyTurnstile: turnstileFor(env.TURNSTILE_SECRET),
    now: () => Math.floor(Date.now() / 1000),
    contact: env.SUPPORT_EMAIL,
  })
```

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

`firstOf` is the reranker's fallback chain.

[worker/src/law-rerank.ts:139-152](worker/src/law-rerank.ts#L139-L152)
```ts
/** The first reranker that answers: Haiku, then the cross-encoder; the caller falls back past both. */
export function firstOf(...rerankers: (Rerank | undefined)[]): Rerank | undefined {
  const present = rerankers.filter((rerank): rerank is Rerank => rerank !== undefined)
  if (present.length === 0) return undefined
  return async (question, texts) => {
    let last: unknown
    for (const rerank of present) {
      try {
        return await rerank(question, texts)
      } catch (error) {
        console.error('learner ask: a reranker did not answer', error)
        last = error
      }
    }
    // …
```

The state's laws come from the site's own published file, not from D1.

[worker/src/index.ts:1159-1180](worker/src/index.ts#L1159-L1180)
```ts
async function lawsFromPages(code: string): Promise<AskLaw[]> {
  return listFromPages<AskLaw>(lawsPath(code))
}

/**
 * Any list Pages publishes for the box: a state's laws, or the nationwide
 * topics and a topic's every-state file (law-topics.ts). One reader, so the
 * topic files get the same cache rule as the state files -- the reason for it
 * below applies to them on the deploy that first publishes them.
 */
async function listFromPages<T>(at: string): Promise<T[]> {
  // Only a 200 is cached: a 404 cached for an hour would keep road law
  // answering `no-laws` long after the Pages deploy that publishes the file --
  // the worker ships first, so that window opens on every deploy.
  const response = await fetch(`${LAWS_ORIGIN}${at}`, {
    cf: { cacheTtlByStatus: { '200': 3600, '300-599': 0 }, cacheEverything: true },
  })
  if (!response.ok) throw new Error(`${at} answered ${response.status}`)
  const list: unknown = await response.json()
  if (!Array.isArray(list)) throw new Error(`${at} is not a list`)
  return list as T[]
}
```

**Notice.**

- Every factory returns `undefined` when its binding or key is missing, and the
  pipeline treats an absent function as "this stage does not exist". That is the
  whole degradation story: the box with no Vectorize binding is the box as it
  was before Vectorize existed.
- `firstOf` tries Haiku and falls to the cross-encoder on a throw. The caller
  falls past both.
- `listFromPages` fetches `https://howardslantern.com/ask-laws/MD.json` with
  the edge cache set to one hour for a `200` and zero for anything else.
- The worker reads the site's own published static file for the words it
  shows. D1's `laws` table is used only for lookups by id and by section.

**Check:** what does the box do if `ANTHROPIC_API_KEY` is set but the `AI`
binding is not?

### Hop 4: the handler guards the door

**Where:** [worker/src/learner-api.ts:203-292](worker/src/learner-api.ts#L203-L292)
is `handleLearnersAsk`; the helpers it calls are above it in the same file.

The whole handler first, then each helper in the order it is called.

[worker/src/learner-api.ts:203-292](worker/src/learner-api.ts#L203-L292)
```ts
export async function handleLearnersAsk(
  request: Request,
  db: D1Database,
  cors: HeadersInit,
  deps: LearnerDeps,
): Promise<Response> {
  const body = await readJson<AskBody>(request)
  const read = readAsk(body)
  if ('error' in read) return json({ error: read.error, contact: deps.contact }, 400, cors)
  // Scrubbed here, once, so neither the model nor the row ever sees what was
  // removed. `scrub` is the feedback box's redaction -- codes, ids, query
  // strings -- plus the email address; the phone number is this box's own
  // addition, because the notice above it promises one.
  const asked: Asked = { ...read, question: withoutPhones(scrub(read.question)) }

  const history = await turnsOf(db, asked.conversation)
  const turn = history.length + 1
  if (turn > MAX_TURNS) {
    return json(
      { error: `a conversation runs to ${MAX_TURNS} questions`, contact: deps.contact },
      400,
      cors,
    )
  }

  const now = deps.now()
  // What this question costs, when it is paid for: a nationwide one reads
  // every state's law and costs five (src/pricing.ts).
  const cost = asked.state === NATIONWIDE ? TOKENS_PER_QUESTION.nationwide : TOKENS_PER_QUESTION.state
  if (asked.credit !== null) {
    // Looked at before the challenge, for the reason the ceiling is: a code
    // that cannot pay should not spend the visitor's Turnstile token too. Not
    // the debit -- that is below, after the challenge, in one statement.
    const left = asked.credit === '' ? null : await balanceOf(db, asked.credit)
    if (left === null || left < cost) return noTokens(cors, deps.contact)
  } else if (await pastCeiling(db, now)) {
    // Before the challenge, for the reason partner-api.ts gives: a Turnstile
    // token is redeemed once, and spending it on a request the ceiling was going
    // to refuse strands the visitor for the day.
    return json({ id: 'no-match', contact: deps.contact, handOff: missedTwice(history) }, 200, cors)
  }

  if (turn === 1) {
    const passed = await deps.verifyTurnstile(
      typeof body?.turnstile === 'string' ? body.turnstile : '',
      request.headers.get('CF-Connecting-IP'),
    )
    if (!passed) {
      return json({ error: 'that did not look like a person', contact: deps.contact }, 400, cors)
    }
  }

  // Debited before the model is asked (decision 24): the balance looked at
  // above can have been spent since by another device on the same code, and
  // only this conditional UPDATE decides.
  const credit = asked.credit
  let left: number | null = null
  if (credit !== null) {
    left = await debit(db, credit, cost)
    if (left === null) return noTokens(cors, deps.contact)
  }
  const giveBack = async () => {
    if (credit !== null) left = (await refund(db, credit, cost)) ?? left
  }

  // The paying code, or the held one when it is a code that exists.
  const keptUnder = credit ?? (asked.held !== null && (await balanceOf(db, asked.held)) !== null ? asked.held : null)
  const claimed = await claimTurn(db, asked, turn, now, keptUnder)
  if (claimed === null) {
    await giveBack()
    return json({ id: 'no-match', contact: deps.contact, handOff: missedTwice(history), ...tokens(left) }, 200, cors)
  }

  let answered: Awaited<ReturnType<typeof answerLearner>>
  try {
    answered = await answerLearner(asked, history, deps)
  } catch (error) {
    // A throw here is a 500 from index.ts, and a token kept for it is a token
    // taken for nothing.
    await giveBack()
    throw error
  }
  const { body: reply, outcome } = answered
  if (REFUNDED.has(outcome.model)) await giveBack()
  await db
    .prepare('UPDATE learner_questions SET answer = ?, scope = ?, sources = ?, model = ? WHERE id = ?')
    .bind(outcome.answer, outcome.scope, JSON.stringify(outcome.sources), outcome.model, claimed)
    .run()
  return json({ ...reply, ...tokens(left) }, 200, cors)
}
```

**1. Validate the body.**

[worker/src/learner-api.ts:105-119](worker/src/learner-api.ts#L105-L119)
```ts
function readAsk(body: AskBody | null): Asked | { error: string } {
  const conversation = typeof body?.conversation === 'string' ? body.conversation : ''
  if (!CONVERSATION_ID.test(conversation)) return { error: 'a conversation id is required' }
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (question.length === 0) return { error: 'a question is required' }
  if (question.length > MAX_QUESTION_CHARS) {
    return { error: `a question can be at most ${MAX_QUESTION_CHARS} characters` }
  }
  const state = typeof body?.state === 'string' && STATE.test(body.state) ? body.state : null
  // A `spend` that is no code at all is still a request to pay, and is
  // answered as a code with nothing on it -- never quietly as a free question,
  // which would count against a browser that meant to use its tokens.
  const credit = body?.spend === undefined ? null : (normalizeQuestionCode(body.spend) ?? '')
  return { conversation, question, lang: body?.lang === 'es' ? 'es' : 'en', state, credit, held: normalizeQuestionCode(body?.code) }
}
```

[worker/src/ask.ts:80-84](worker/src/ask.ts#L80-L84)
```ts
/** Long enough for a real question, short enough not to be a way to send prose. */
export const MAX_QUESTION_CHARS = 500

/** A conversation, not a correspondence. */
export const MAX_TURNS = 10
```

**2. Scrub once.** Nothing after this line sees the original.

[worker/src/validate.ts:125-127](worker/src/validate.ts#L125-L127)
```ts
export function scrub(text: string): string {
  return redact(text).replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>')
}
```

[worker/src/learner-api.ts:303-305](worker/src/learner-api.ts#L303-L305)
```ts
function withoutPhones(text: string): string {
  return text.replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '<phone>')
}
```

**3. Read the thread.** Oldest first; what was shown, not what the model wrote.

[worker/src/learner-api.ts:135-149](worker/src/learner-api.ts#L135-L149)
```ts
async function turnsOf(db: D1Database, conversation: string): Promise<LearnerTurn[]> {
  const rows = await db
    .prepare(
      `SELECT question, scope, answer, sources FROM learner_questions
        WHERE conversation = ? ORDER BY turn`,
    )
    .bind(conversation)
    .all<{ question: string; scope: string | null; answer: string | null; sources: string | null }>()
  return (rows.results ?? []).map((row) => ({
    question: row.question,
    scope: row.scope as Scope | null,
    answer: row.answer ?? '',
    sources: row.sources === null ? [] : (JSON.parse(row.sources) as string[]),
  }))
}
```

**4. The cost, the balance or the ceiling.**

[src/pricing.ts:31-32](src/pricing.ts#L31-L32)
```ts
/** A token is one state question; a nationwide question reads every state, and costs five. */
export const TOKENS_PER_QUESTION = { state: 1, nationwide: 5 } as const
```

[worker/src/learner-api.ts:159-165](worker/src/learner-api.ts#L159-L165)
```ts
async function pastCeiling(db: D1Database, now: number): Promise<boolean> {
  const today = await db
    .prepare('SELECT COUNT(*) AS c FROM learner_questions WHERE asked_at > ? AND paid = 0')
    .bind(now - 86_400)
    .first<{ c: number }>()
  return (today?.c ?? 0) >= LEARNER_DAILY_QUESTIONS
}
```

`LEARNER_DAILY_QUESTIONS` is 300 ([learner-ask.ts:48](worker/src/learner-ask.ts#L48)).

**5. Turnstile on turn one only.** In the handler above.

**6. Debit in one conditional `UPDATE`.**

[worker/src/questions.ts:145-155](worker/src/questions.ts#L145-L155)
```ts
export async function debit(db: D1Database, code: string, tokens: number): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE question_credits SET spent = spent + ?
        WHERE code = ? AND bought - spent >= ?
        RETURNING bought - spent AS left`,
    )
    .bind(tokens, code, tokens)
    .first<{ left: number }>()
  return row === null ? null : row.left
}
```

**7. Claim the turn.** The purge runs on the write path; the row goes in with
`model = 'asking'`, and the `UNIQUE (conversation, turn)` in the schema is what
makes a double-submit fail here.

[worker/src/learner-api.ts:179-201](worker/src/learner-api.ts#L179-L201)
```ts
await db
  .prepare('DELETE FROM learner_questions WHERE asked_at < ?')
  .bind(now - QUESTION_RETENTION_SECONDS)
  .run()
try {
  const written = await db
    .prepare(
      `INSERT INTO learner_questions
         (conversation, turn, asked_at, lang, state, question, answer, scope, sources, model, credit_code, paid)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'asking', ?, ?)`,
    )
    // The code with every question its holder asks, free ones too (Joel,
    // 2026-10-12): the code's history is what a second device that holds it
    // shows. Only a code that exists, and only the asking browser's own --
    // a row under a code nobody bought would be a history nobody can read.
    .bind(asked.conversation, turn, now, asked.lang, asked.state, asked.question, keptUnder, asked.credit === null ? 0 : 1)
    .run()
  return Number(written.meta.last_row_id)
} catch (error) {
  console.error('learner ask: this turn is already claimed', error)
  return null
}
```

**8. Answer** (hops 5 to 7). **9. Refund or not**, then record what was shown.

[worker/src/learner-api.ts:121-127](worker/src/learner-api.ts#L121-L127)
```ts
/**
 * Whether a paid question's token goes back: when the model never answered,
 * or the laws it needed could not be read -- the learner got nothing for a
 * reason that was ours. Never for `not-covered` or a checker's refusal: the
 * model was asked and worked, and "the law does not say" is an answer.
 */
const REFUNDED = new Set(['unavailable', 'unreachable', 'unparsed', 'refused', 'road-law:no-laws'])
```

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

**Where:** [worker/src/learner-ask.ts:1200-1252](worker/src/learner-ask.ts#L1200-L1252),
the first half of `answerLearner`. Follow each call into its module.

[worker/src/learner-ask.ts:1200-1252](worker/src/learner-ask.ts#L1200-L1252)
```ts
export async function answerLearner(
  asked: { lang: Lang; state: string | null; question: string },
  history: LearnerTurn[],
  pipeline: LearnerPipeline,
): Promise<{ body: LearnerBody; outcome: LearnerOutcome; path?: NationwidePath }> {
  // Before any state's file is asked for: there is no `/ask-laws/US.json`, and
  // asking for one would refuse every nationwide question as `no-laws`.
  if (asked.state === NATIONWIDE) return answerNationwide(asked, history, pipeline)
  let laws: AskLaw[] | null | 'failed' = null
  if (asked.state !== null) {
    try {
      laws = await pipeline.lawsFor(asked.state)
    } catch (error) {
      console.error(`learner ask: could not read the laws for ${asked.state}`, error)
      laws = 'failed'
    }
  }
  let near: string[] = []
  if (Array.isArray(laws) && asked.state !== null && pipeline.nearLaws !== undefined) {
    try {
      near = await pipeline.nearLaws(asked.state, asked.question)
    } catch (error) {
      console.error(`learner ask: the vector index did not answer for ${asked.state}`, error)
    }
  }
  // The question in the law's words, each search ranked by the index too: by
  // words alone the rewrite put Texas's 70 mph law 20th, which fused to 35th.
  let searches: Search[] = []
  let family: ProcessFamily | undefined
  if (Array.isArray(laws) && asked.state !== null && pipeline.rephrase !== undefined) {
    try {
      const state = asked.state
      const worded = await pipeline.rephrase(asked.question)
      family = worded.family
      searches = await Promise.all(
        worded.map(async (search) => ({ search, near: await (pipeline.nearLaws?.(state, search) ?? Promise.resolve([])).catch(() => []) })),
      )
    } catch (error) {
      console.error('learner ask: the rephraser did not answer', error)
    }
  }
  const fallback = Array.isArray(laws) ? retrieve(laws, asked.question, RETRIEVED_LAWS, near, searches) : []
  const retrieval = Array.isArray(laws) && pipeline.rerank !== undefined ? retrieve(laws, asked.question, poolSize(searches), near, searches) : []
  const pool = Array.isArray(laws) && asked.state !== null && pipeline.rerank !== undefined ? await withFamily(retrieval, asked.state, family, pipeline.processRowsFor) : retrieval
  const chosen = familyBeside(await chooseLaws(pool, fallback, asked.question, pipeline.rerank), pool, family, [asked.question, ...searches.map((each) => each.search)])
  const sectioned = Array.isArray(laws) && asked.state !== null ? await wholeSections(chosen, laws, asked.state, pipeline.lawsBySection) : chosen
  const retrieved = pagesLast(Array.isArray(laws) && asked.state !== null ? await withPenalties(sectioned, asked.state, pipeline.penaltiesFor, chosen) : sectioned)
  const reply = await pipeline.askLearner({
    lang: asked.lang,
    question: asked.question,
    history,
    laws: laws === null ? null : retrieved,
  })
```

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

**Meaning: the vector index.** Embed the question, ask the state's namespace.

[worker/src/law-vectors.ts:62-69](worker/src/law-vectors.ts#L62-L69)
```ts
export function nearLawsFor(ai: Ai | undefined, index: VectorizeIndex | undefined): NearLaws | undefined {
  if (ai === undefined || index === undefined) return undefined
  return async (code, question) => {
    const embedded = (await ai.run(EMBEDDING_MODEL, { text: [question] })) as { data: number[][] }
    const found = await index.query(embedded.data[0], { topK: NEAR_LAWS, namespace: code })
    return found.matches.filter((match) => match.score >= NEAR_ENOUGH).map((match) => match.id)
  }
}
```

[worker/src/law-vectors.ts:28-42](worker/src/law-vectors.ts#L28-L42)
```ts
/**
 * Below this a neighbour is not a match, only the nearest thing there was.
 *
 * Set for recall, not precision. Measured on the live index on 2026-10-05: the
 * law that answers scored 0.56-0.79 -- "fireplug" 0.654, a school bus 0.776,
 * and Spanish against English as low as 0.564 ("¿puedo girar a la derecha con
 * la luz roja?" to Ohio's right-on-red law). The nearest law to an unrelated
 * question scored 0.36-0.58: "the speed limit on the moon" 0.575, "reset my
 * progress" 0.48, "the Super Bowl" 0.365. The bands overlap, and a cutoff of
 * 0.6 lost the Spanish law to keep the moon out. That is the wrong way round:
 * a law that does not answer the question costs a few tokens and is declined
 * by the model, with `checkLawAnswer` behind it; a law that does answer and is
 * cut here is a learner told their manual does not say.
 */
export const NEAR_ENOUGH = 0.5
```

**Rephrase: the question in the code's words.** Haiku, a five-second timeout,
a JSON schema of `{ searches, family }`.

[worker/src/law-rephrase.ts:96-106](worker/src/law-rephrase.ts#L96-L106)
```ts
export function haikuRephraseFor(apiKey: string | undefined, client?: RephraseClient): Rephrase | undefined {
  if (client === undefined && (apiKey === undefined || apiKey.length === 0)) return undefined
  const anthropic = client ?? new Anthropic({ apiKey, timeout: REPHRASE_TIMEOUT_MS, maxRetries: 0 })
  return async (question) => {
    const response = await anthropic.messages.create({
      model: REPHRASE_MODEL,
      max_tokens: 128,
      system: REPHRASE_RULES,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: question }],
    })
    // …
```

The prompt it is given ([law-rephrase.ts:40-50](worker/src/law-rephrase.ts#L40-L50)):

> A learner driver asked a question about their state's road law.
> Write one or two short searches, in the words a state's vehicle code and driver manual use for the same thing, that would find the law that answers it.
> Use the law's names for things: "maximum speed limit" for the highest limit, "instruction permit" or "learner's permit" for a permit, "financial responsibility" or "liability insurance" for insurance, "implied consent" for a breath test; a code never says "texting": a search for it says "electronic message or text message", because some codes use one and some the other, and "wireless communication device" or "handheld telephone" for a phone.
> Keep the kind of figure asked about (feet, miles per hour, days, years, dollars) but never a figure.
> When the question asks what happens, what if, will I, do I have to, or how much, write two searches: one for the duty, as a code states what a driver must or may not do ("have in possession", "display on demand"), and one for its penalty or defence in the words a code uses for them ("fine", "offense", "defense to prosecution", "produces in court", "points", "suspend").
> Not having your license with you ("I don't have it on me", "no llevo mi licencia") is the duty to have it in your possession and display it on demand, not driving without a license, which is a different offence: search for the duty to carry it.
> Each search is at most eight words. Return no searches if the question is not about road law.
> Also name the one family of process question it is, if it is one of these, or "none":
> *(the six families from process-families.ts, each with what it covers)*
> A rule of the road (where to park, how fast, who goes first) is "none", even when a permit holder asks it.
> "ticket-procedure" is only a ticket the learner already has. It is not the penalty or the fine for an offence, and not a question about being pulled over, stopped or caught doing something ("what happens if I get pulled over without my license", "how much is the ticket for texting"): those are "none".

**Words: BM25 and fusion.** `words` tokenises; `retrieve` fuses the word
ranking, the vector ranking, and each search's two rankings by reciprocal rank.

[worker/src/law-retrieval.ts:113-126](worker/src/law-retrieval.ts#L113-L126)
```ts
// Words that say nothing about which law is meant. "park" and "far" stay: in a
// question about road law they are the whole question.
const STOP = new Set(
  'a an and are as at be by can could do does for from how i if in is it its me my of on or should so that the their them there this to was what when where which who why will with would you your'.split(
    ' ',
  ),
)

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !STOP.has(word))
    // "hydrants" must find "hydrant"; "bus" must not become "bu".
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}
```

[worker/src/law-retrieval.ts:148-173](worker/src/law-retrieval.ts#L148-L173)
```ts
export function retrieve(laws: AskLaw[], question: string, limit = RETRIEVED_LAWS, near: string[] = [], searches: Search[] = []): AskLaw[] {
  const byId = new Map(laws.map((law) => [law.id, law]))
  // Only ids the published file holds: a vector left behind for a law since
  // removed is dropped here, never shown.
  const meant = near.filter((id) => byId.has(id))
  if (meant.length === 0 && searches.length === 0) return bm25(laws, question, limit)
  const fused = new Map<string, number>()
  const add = (ids: string[]) =>
    ids.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
  add(bm25(laws, question, limit * 2).map((law) => law.id))
  add(meant)
  // Each search is two rankings of its own, by its words and by its meaning:
  // "maximum speed limit" finds what "highest posted speed limit" does not,
  // and Texas's 70 mph law went from 124th by the question's words to the pool.
  for (const { search, near: nearer } of searches) {
    add(bm25(laws, search, limit * 2).map((law) => law.id))
    add(nearer.filter((id) => byId.has(id)))
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id) as AskLaw)
}

/** The usual constant for reciprocal-rank fusion: it keeps one list's first place from swamping the other's. */
const RRF_K = 60
```

[worker/src/law-retrieval.ts:233-257](worker/src/law-retrieval.ts#L233-L257)
```ts
function bm25(laws: AskLaw[], question: string, limit: number): AskLaw[] {
  if (laws.length === 0) return []
  const { docs, average, frequency, size } = indexOf(laws)
  const asked = [...new Set(words(question).flatMap((word) => spelledAs(word, frequency)))]
  if (asked.length === 0) return []
  const k1 = 1.2
  const b = 0.75
  return docs
    .map((doc, index) => {
      let score = 0
      for (const word of asked) {
        const n = frequency.get(word)
        if (n === undefined) continue
        const tf = doc.counts.get(word) ?? 0
        if (tf === 0) continue
        const idf = Math.log(1 + (size - n + 0.5) / (n + 0.5))
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / average))
      }
      return { law: laws[index], score }
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.law)
}
```

[worker/src/law-retrieval.ts:282-291](worker/src/law-retrieval.ts#L282-L291)
```ts
function spelledAs(word: string, vocabulary: Map<string, number>): string[] {
  if (vocabulary.has(word)) return [word]
  if (word.length < 4) return []
  const found: string[] = []
  for (const known of vocabulary.keys()) {
    if (known.length >= 4 && word.includes(known)) found.push(known)
    else if (word.length >= 5 && Math.abs(known.length - word.length) <= 1 && oneEditApart(word, known)) found.push(known)
  }
  return found
}
```

Process rows are not ranked by words; they reach the pool by family key or by
meaning.

[worker/src/law-retrieval.ts:212-214](worker/src/law-retrieval.ts#L212-L214)
```ts
function ranked(law: AskLaw): boolean {
  return law.kind !== 'process'
}
```

**Family: the DMV page rows by key.**

[worker/src/learner-ask.ts:1140-1157](worker/src/learner-ask.ts#L1140-L1157)
```ts
export async function withFamily(
  pool: AskLaw[],
  state: string,
  family: ProcessFamily | undefined,
  processRowsFor: ProcessRowsFor | undefined,
): Promise<AskLaw[]> {
  if (family === undefined || processRowsFor === undefined) return pool
  let rows: StateLaw[]
  try {
    rows = await processRowsFor(state, family)
  } catch (error) {
    console.error(`learner ask: could not read ${state}'s ${family} page rows`, error)
    return pool
  }
  const seen = new Set(pool.map((law) => law.id))
  const added = rows.filter((row) => !seen.has(row.id)).map(({ state: _state, ...law }) => law)
  return [...pool, ...added]
}
```

**Rerank: three laws from the pool.**

[worker/src/law-rerank.ts:41-70](worker/src/law-rerank.ts#L41-L70)
```ts
const HAIKU_RANKS = 5
// …
export const CANDIDATE_LAWS = 24
// …
export const SEARCHED_CANDIDATE_LAWS = 32
// …
export const ANSWER_LAWS = 3
```

[worker/src/law-rerank.ts:174-220](worker/src/law-rerank.ts#L174-L220)
```ts
export async function chooseLaws(
  pool: AskLaw[],
  fallback: AskLaw[],
  question: string,
  rerank?: Rerank,
): Promise<AskLaw[]> {
  if (rerank === undefined || pool.length === 0) return fallback
  try {
    const scores = await rerank(question, pool.map(embeddingText))
    if (scores.length !== pool.length) throw new Error(`${scores.length} scores for ${pool.length} laws`)
    const ranked = pool.map((law, index) => ({ law, score: scores[index] })).sort((a, b) => b.score - a.score)
    // A row of the state's own page the reranker puts among its first is
    // given beside the three, never in place of one (docs/plans/what-happens-
    // if.md, phase 3): Maryland's "how much is the ticket if I'm driving
    // without my license" named the ticket family, the court's "take one of
    // four actions within 30 days" took a place, § 16-112 lost its own, and
    // with it went the schedule's $50 -- the box answered nothing (eval,
    // 2026-10-11). A pool with no page rows is chosen exactly as before.
    const page = (law: AskLaw) => law.kind === 'process'
    const pages = ranked.slice(0, ANSWER_LAWS).filter(({ law }) => page(law)).map(({ law }) => law)
    const chosen = ranked.filter(({ law }) => !page(law)).slice(0, ANSWER_LAWS).map(({ law }) => law)
    const first = pool.find((law) => !page(law))
    // Retrieval's own first choice keeps a place. Left to itself the reranker
    // gave California's adult blood-alcohol question three under-21 limits and
    // dropped the 0.08% law retrieval ranked first. Measured over nine states'
    // 280 verdicts: 80% reach the model without this, 86% with it, and the
    // reranker's reach on rules only the code states (6 of 11) is unchanged.
    //
    // Both protections cover the cross-encoder's misses, and stand only for
    // it -- a reranker that scores every law. Haiku names the laws that answer
    // and leaves the rest out (-Infinity); putting retrieval's first or the
    // manual's best back over its third choice undid the choice, and Nevada's
    // side-window tint answer lost § 484D.440(3)(a) to it.
    if (scores.every(Number.isFinite)) {
      if (first !== undefined && !chosen.some((law) => law.id === first.id)) chosen[chosen.length - 1] = first
      // The manual is a law with no kind: a state's own page (`process`) is
      // not the manual, and counted as one it would hold the place the
      // manual's own rule was kept for.
      const manual = ranked.find(({ law }) => law.kind === undefined)?.law
      if (manual !== undefined && !chosen.some((law) => law.kind === undefined)) chosen[chosen.length - 1] = manual
    }
    return [...chosen, ...pages]
  } catch (error) {
    console.error('learner ask: the reranker did not answer', error)
    return fallback
  }
}
```

**Family beside.** The named family's best row, when the reranker chose none.

[worker/src/learner-ask.ts:1169-1177](worker/src/learner-ask.ts#L1169-L1177)
```ts
export function familyBeside(chosen: AskLaw[], pool: AskLaw[], family: ProcessFamily | undefined, texts: string[]): AskLaw[] {
  if (family === undefined) return chosen
  const rows = pool.filter((law) => law.kind === 'process' && law.concept === family)
  if (rows.length === 0 || chosen.some((law) => rows.includes(law))) return chosen
  const asked = new Set(texts.flatMap(words))
  const shared = (law: AskLaw) => new Set(words(law.law).filter((word) => asked.has(word))).size
  const best = rows.reduce((top, law) => (shared(law) > shared(top) ? law : top), rows[0])
  return [...chosen, best]
}
```

**Notice.**

- The rephraser's header comment ([law-rephrase.ts:1-28](worker/src/law-rephrase.ts#L1-L28))
  is the clearest statement of why it exists: "highest posted speed limit"
  ranked Texas's 70 mph law 25th; "maximum speed limit on a highway in miles
  per hour" ranked it 1st.
- The vector index returns ids only, and `retrieve` drops any id the file does
  not hold. A stale index can rank badly but cannot put wrong text on screen.
- `NEAR_ENOUGH = 0.5` is set for recall. The comment above it gives the
  measured score bands and why the cutoff sits inside the overlap.
- The pool widens from 24 to 32 when searches were fused, because fusion moves
  laws out as well as in ([law-rerank.ts:46-58](worker/src/law-rerank.ts#L46-L58)).
- Two protections in `chooseLaws` apply only to the cross-encoder. The comment
  at [:196-206](worker/src/law-rerank.ts#L196-L206) says why they are switched
  off for Haiku.

**Check:** the fallback and the pool are both produced by `retrieve`. Why is the
fallback not simply the pool's first eight?

### Hop 6: widening gives the model whole sections, the fine, and the page

**Where:** the three lines at the end of hop 5's snippet
([learner-ask.ts:1246-1248](worker/src/learner-ask.ts#L1246-L1248)) call
`wholeSections` ([:1021](worker/src/learner-ask.ts#L1021)),
`withPenalties` ([:1080](worker/src/learner-ask.ts#L1080)) and `pagesLast`
([:1186](worker/src/learner-ask.ts#L1186)). The D1 lookups are in
[law-nationwide.ts](worker/src/law-nationwide.ts).

`sectionOf` is the key to all of it: it turns a statute citation into its
section by stripping the subsection, so `§ 521.025(c)(1)` and `§ 521.025(d)`
both key to `Tex. Transp. Code § 521.025`.

[worker/src/law-nationwide.ts:230-239](worker/src/law-nationwide.ts#L230-L239)
```ts
export function sectionOf(law: Pick<AskLaw, 'kind' | 'citation'>): string | null {
  if (law.kind !== 'statute' || law.citation === null) return null
  const quoted = law.citation.indexOf(' — ')
  const reference = quoted < 0 ? law.citation : law.citation.slice(0, quoted)
  const section = reference
    .replace(/,\s*subd\..*$/, '')
    .replace(/(?:\s*[–-]?\s*\([^()]*\))+[\s–-]*$/, '')
    .trim()
  return section === '' ? null : section
}
```

**Whole sections.** The table says which ids share a section; the words come
from the state's file by id.

[worker/src/learner-ask.ts:1021-1055](worker/src/learner-ask.ts#L1021-L1055)
```ts
export async function wholeSections(
  chosen: AskLaw[],
  file: AskLaw[],
  state: string,
  lawsBySection: LawsBySection | undefined,
): Promise<AskLaw[]> {
  const sections = [...new Set(chosen.map(sectionOf).filter((section): section is string => section !== null))]
  if (lawsBySection === undefined || sections.length === 0) return chosen
  let rows: StateLaw[]
  try {
    rows = await lawsBySection(state, sections)
  } catch (error) {
    console.error(`learner ask: could not read the sections of ${state}'s chosen laws`, error)
    return chosen
  }
  const byId = new Map(file.map((law) => [law.id, law]))
  const given = [...chosen]
  const seen = new Set(chosen.map((law) => law.id))
  let chars = 0
  for (const section of sections) {
    let count = chosen.filter((law) => sectionOf(law) === section).length
    for (const row of rows) {
      if (given.length >= GIVEN_LAWS) return given
      if (count >= SECTION_LAWS) break
      const law = byId.get(row.id)
      if (row.state !== state || law === undefined || seen.has(law.id) || sectionOf(law) !== section) continue
      if (chars + law.law.length > SECTION_CHARS) continue
      given.push(law)
      seen.add(law.id)
      count += 1
      chars += law.law.length
    }
  }
  return given
}
```

[worker/src/law-nationwide.ts:176-190](worker/src/law-nationwide.ts#L176-L190)
```ts
export function lawsBySectionFor(db: D1Database | undefined): LawsBySection | undefined {
  if (db === undefined) return undefined
  return async (state, sections) => {
    if (sections.length === 0) return []
    const rows = await db
      .prepare(
        `SELECT id, state, kind, law, question, concept, citation, as_of FROM laws
          WHERE state = ? AND section IN (SELECT value FROM json_each(?))
          ORDER BY rowid`,
      )
      .bind(state, JSON.stringify(sections))
      .all<LawRow>()
    return (rows.results ?? []).map(lawOf)
  }
}
```

**The fine schedule.** Rows for the subsections the question matched go first,
each section's rows after that section's last law, and a row for a section not
given goes last rather than hidden.

[worker/src/learner-ask.ts:1096-1127](worker/src/learner-ask.ts#L1096-L1127)
```ts
// The rows for the subsections the question matched come first, then the
// section's others in the schedule's order: Maryland's § 21-1003 is thirty
// parking rows, and in schedule order the cap stopped at (i), so the
// hydrant's (m) -- the one the learner asked about -- was never given.
// Matched means chosen, not given: the whole section is given, and ranking
// by every subsection in it is schedule order again.
const references = chosen.filter((law) => sectionOf(law) !== null).map((law) => referenceOf(law.citation ?? ''))
const named = (row: (typeof rows)[number]) => {
  const own = `${row.section}${row.code.includes('(') ? row.code.slice(row.code.indexOf('(')) : ''}`
  return references.some((reference) => reference.startsWith(own) || own.startsWith(reference))
}
const ordered = [...rows.filter(named), ...rows.filter((row) => !named(row))]
const after = new Map<string, AskLaw[]>()
const last: AskLaw[] = []
const counted = new Map<string, number>()
let total = 0
for (const row of ordered) {
  if (row.state !== state || total >= GIVEN_PENALTIES) continue
  if ((counted.get(row.section) ?? 0) >= SECTION_PENALTIES) continue
  counted.set(row.section, (counted.get(row.section) ?? 0) + 1)
  total += 1
  if (sections.includes(row.section)) after.set(row.section, [...(after.get(row.section) ?? []), penaltyLaw(row)])
  else last.push(penaltyLaw(row))
}
const lastOf = new Map(given.map((law, index) => [sectionOf(law), index]))
const out: AskLaw[] = []
given.forEach((law, index) => {
  out.push(law)
  for (const [section, laws] of after) if (lastOf.get(section) === index) out.push(...laws)
})
return [...out, ...last]
```

[worker/src/law-nationwide.ts:298-312](worker/src/law-nationwide.ts#L298-L312)
```ts
export function penaltiesForDb(db: D1Database | undefined): PenaltiesFor | undefined {
  if (db === undefined) return undefined
  return async (state, sections) => {
    if (sections.length === 0) return []
    const rows = await db
      .prepare(
        `SELECT ${PENALTY_COLUMNS} FROM penalties
          WHERE state = ? AND section IN (SELECT value FROM json_each(?))
          ORDER BY rowid`,
      )
      .bind(state, JSON.stringify(sections))
      .all<PenaltyRow>()
    return rows.results ?? []
  }
}
```

A penalty row becomes a law: one sentence stating the figure, whether it is
payable without court, and the points, with the schedule's own line as its
citation.

[worker/src/penalty-law.ts:86-96](worker/src/penalty-law.ts#L86-L96)
```ts
export function penaltyLaw(row: PenaltyRow): AskLaw {
  return {
    id: row.id,
    law: penaltySentence(row),
    question: '',
    concept: row.offence,
    citation: `${row.source_title} — '${row.quote}'`,
    kind: 'penalty',
    asOf: row.as_of,
  }
}
```

**Pages last.**

[worker/src/learner-ask.ts:1186-1188](worker/src/learner-ask.ts#L1186-L1188)
```ts
export function pagesLast(laws: AskLaw[]): AskLaw[] {
  return [...laws.filter((law) => law.kind !== 'process'), ...laws.filter((law) => law.kind === 'process')]
}
```

| stage | lookup | cap |
|---|---|---|
| `wholeSections` | `lawsBySection(state, sections)` on the `laws` table, ordered as the code prints | 12 rows a section, 40 in all, 24,000 characters of neighbours |
| `withPenalties` | `penaltiesFor(state, sections)` on the `penalties` table | 8 rows a section, 16 in all |
| `pagesLast` | none | process rows move to the end |

**Notice.**

- The chosen laws always stay first, in the order chosen. Neighbours come
  after, so the matched subsection is never pushed down by its section.
- The table says only which ids are in a section. The words come from the
  state's published file by id, the same file the chosen laws came from. An id
  the file does not hold is dropped.
- A schedule row for a section that was not given is placed last rather than
  hidden, so a lookup that matched too much is visible in the prompt.

**Check:** why does a manual law contribute nothing to `wholeSections`?

### Hop 7: the model answers and the checker decides

**Where:** `learnerRequestFor` ([learner-ask.ts:277](worker/src/learner-ask.ts#L277)),
`withLaws` ([:518](worker/src/learner-ask.ts#L518)),
`learnerReplyFrom` ([:314](worker/src/learner-ask.ts#L314)),
the second half of `answerLearner` ([:1254](worker/src/learner-ask.ts#L1254)),
`checkLawAnswer` ([:743](worker/src/learner-ask.ts#L743)),
`figuresIn` ([:605](worker/src/learner-ask.ts#L605)).

**The request.**

[worker/src/learner-ask.ts:38](worker/src/learner-ask.ts#L38)
```ts
export const LEARNER_ASK_MODEL = 'claude-opus-5-5'
```

[worker/src/learner-ask.ts:277-307](worker/src/learner-ask.ts#L277-L307)
```ts
export function learnerRequestFor({ lang, question, history, laws, nationwide }: LearnerAskRequest): Anthropic.MessageCreateParamsNonStreaming {
  const prompt = learnerPrompt(lang, nationwide !== undefined)
  return {
    model: LEARNER_ASK_MODEL,
    max_tokens: 1024,
    system: [
      { type: 'text', text: prompt.rules },
      // The book is the stable prefix and the conversation goes after it,
      // so a follow-up reads the cache rather than rebuilding it.
      { type: 'text', text: prompt.sources, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      // Three sentences from a book is not a reasoning task.
      effort: 'low',
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    messages: [
      // Replayed as they were logged: the assistant's turn is what the
      // learner was shown, not what the model first wrote, so a refused
      // turn is a refused turn in the thread too.
      ...history.flatMap((turn): Anthropic.MessageParam[] => [
        { role: 'user', content: turn.question },
        {
          role: 'assistant',
          content: JSON.stringify({ scope: turn.scope ?? 'other', answer: turn.answer, sources: turn.sources }),
        },
      ]),
      { role: 'user', content: withLaws(question, laws, nationwide) },
    ],
  }
}
```

The road-law rule, the sixth of `RULES` ([learner-ask.ts:128-141](worker/src/learner-ask.ts#L128-L141)),
as the model reads it:

> Road law is answered only from the laws of the learner’s own state given with the question, never from memory or another state. Write for a sixteen-year-old who asked a friend who knows: plain words, "you", each figure once, and no law’s name or number in the sentences (the app shows them underneath). Short sentences, and never more of them than the sentence limits here allow: each under about 20 words, with at most two figures in a sentence; cut words rather than add a sentence, and leave out what was not asked rather than go over the limit. The cost (the fine, points, whether you go to court) goes in a sentence of its own after the rule, followed only by the way out where a law given states one. Give the cost only when the question asks what happens, what it costs or how you can get in trouble: a question about the rule itself (how far, how fast, when) is answered with the rule alone. Never join two rules with “and Maryland law also says” or the like: give each rule a short clause of its own. For example, a Maryland learner who asks how they can get in trouble using their high beams is answered: “Dim your high beams within 500 feet of an oncoming car, or 300 feet behind one. Otherwise it’s a $60 ticket, no points, no court.” Answer in the shape of the question with the law’s own figure, in at most two sentences, and put the ids of the laws you used (for example "FL-399") in "sources". When the question asks what happens, what if, will I, do I have to, or how much (in Spanish, qué pasa, y si, me van a, tengo que, cuánto), answer in at most three sentences in the order things happen: what the officer or the court does, then what it costs (the fine, points, whether you must go to court), then the way out, only if a law given states one. For example, a Texas learner who asks what happens if they are pulled over without their license is answered: “You can get a ticket with a fine of up to $200. If you bring your valid license to court, the charge is dropped.” A section’s other subsections are given with the one that matched, so a penalty or a defence in the same section is visible: use them. The learner’s words will not be the law’s: a law that sets a maximum speed answers a question about the highest posted limit, a law on an instruction permit answers one about a learner’s permit. When a law given states the rule the learner is asking about, answer from it with its figure and say what the law calls the thing, rather than nothing. When a law given states the duty the learner asks about and none states its penalty, answer the duty in one sentence and stop: never write that the laws given do not state something. If no law given touches the question, or no laws are given, leave "answer" empty and "sources" empty: the app says so itself. Some laws are marked as the state’s law rather than its manual: prefer the manual where it states the rule, use the state’s law for what the manual does not state or when the learner asks for the law as written, and when you answer from it say so in words, as “Maryland law” for a Maryland learner. Write figures in digits. The app shows the manual’s page or the law’s section under your answer, so do not write page or section numbers.

**The laws in the user turn.** Each labelled by kind, so the model knows what
it is reading; the schedule and page lines added only when such a row is present.

[worker/src/learner-ask.ts:518-537](worker/src/learner-ask.ts#L518-L537)
```ts
export function withLaws(question: string, laws: AskLaw[] | null, nationwide?: NationwideLaws): string {
  if (nationwide !== undefined) return withStatesLaws(question, nationwide)
  if (laws === null) return `${question}\n\n(No state is chosen, so no laws are given.)`
  if (laws.length === 0) return `${question}\n\n(No law in the learner’s state’s manual was found for this question.)`
  const listed = laws.map((law) =>
    law.kind === 'statute'
      ? `[${law.id}] (the state's law, not the manual${heading(law)}) ${law.law} (${referenceOf(law.citation ?? '')})`
      : law.kind === 'penalty'
        ? `[${law.id}] (the court's fine schedule) ${law.law} (${referenceOf(law.citation ?? '')})`
        : law.kind === 'process'
          ? `[${law.id}] (the state's own page) ${law.law} (${pageOf(law.citation)})`
          : `[${law.id}] ${law.law}${law.citation === null ? '' : ` (manual: ${referenceOf(law.citation)})`}`,
  )
  const lines = [
    ...(laws.some((law) => law.kind === 'penalty') ? [PENALTY_LINE] : []),
    ...(laws.some((law) => law.kind === 'process') ? [PROCESS_LINE] : []),
  ]
  return `${question}\n\nLaws from the learner’s state’s manual retrieved for this question:\n${listed.join('\n')}${lines.map((line) => `\n\n${line}`).join('')}`
}
```

[worker/src/learner-ask.ts:496-509](worker/src/learner-ask.ts#L496-L509)
```ts
export const PENALTY_LINE =
  'A law marked as the court’s fine schedule is what a driver actually pays for breaking the state’s law listed just above it: its figure, whether it can be paid without going to court, and its points where it gives them. Use it for what it costs. Where it says the court sets the fine, give its range and say the court decides; never give one figure from the range as the fine.'
// …
export const PROCESS_LINE =
  'A law marked as the state’s own page is what the state’s licensing agency or court says about how its process works. Prefer it for process — how soon you can take a test again, how long you hold a permit, what insurance you must carry, what to do with a ticket and how many days you have. Never answer a rule of the road (where to park, how fast, who goes first) from it when the manual or the state’s law given states the rule: answer from those.'
```

**The reply.** A refusal stop, unparseable JSON, or a shape that does not
match, each a named failure.

[worker/src/learner-ask.ts:314-330](worker/src/learner-ask.ts#L314-L330)
```ts
export function learnerReplyFrom(response: Anthropic.Message): LearnerReply {
  if (response.stop_reason === 'refusal') return { kind: 'failed', model: 'refused' }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const parsed = JSON.parse(text) as { scope?: unknown; answer?: unknown; sources?: unknown }
  if (
    typeof parsed.scope !== 'string' ||
    !(SCOPES as readonly string[]).includes(parsed.scope) ||
    typeof parsed.answer !== 'string' ||
    !Array.isArray(parsed.sources)
  ) {
    return { kind: 'failed', model: 'unparsed' }
  }
  return {
    kind: 'reply',
    // …
```

**The decision.** The second half of `answerLearner`: a road-law reply goes
through the checker, and either becomes the body with citations or a
`no-match` with the worker's own line.

[worker/src/learner-ask.ts:1254-1278](worker/src/learner-ask.ts#L1254-L1278)
```ts
if (reply.kind === 'reply' && reply.scope === 'road-law') {
  const checked = checkLawAnswer(reply, asked.lang, laws, retrieved, asked.question)
  if (checked.ok) {
    return {
      body: {
        id: 'answer',
        answer: checked.answer,
        citations: checked.laws.map((law) => ({
          id: law.id,
          location: law.citation as string,
          ...(law.kind === undefined ? {} : { kind: law.kind }),
          ...(law.asOf === undefined ? {} : { asOf: law.asOf }),
        })),
      },
      outcome: { answer: checked.answer, scope: 'road-law', sources: checked.laws.map((law) => law.id), model: reply.model },
    }
  }
  return {
    // No `contact` and no hand-off: a road-law reply is the one sentence.
    body: { id: 'no-match', ...lawPointerFor(checked.reason, asked.lang) },
    outcome: { answer: '', scope: 'road-law', sources: reply.sources, model: `road-law:${checked.reason}` },
  }
}
return answerFromBook(reply, asked.lang, history, pipeline.contact, asked.question)
```

**The checker.** Its body; the signature with its parameter notes is at
[:743-764](worker/src/learner-ask.ts#L743-L764).

[worker/src/learner-ask.ts:765-798](worker/src/learner-ask.ts#L765-L798)
```ts
if (laws === null) return { ok: false, reason: 'no-state' }
if (laws === 'failed') return { ok: false, reason: 'no-laws' }
const answer = reply.answer.trim()
const ids = [...new Set(reply.sources)]
if (answer.length === 0 || ids.length === 0) return { ok: false, reason: 'not-covered' }
const cited = ids.map((id) => retrieved.find((law) => law.id === id) ?? null)
if (cited.some((law) => law === null || law.citation === null)) return { ok: false, reason: 'uncited' }
const sources = cited as AskLaw[]
const pages = new Set(sources.flatMap((law) => citedPages(law.citation)))
if (pagesNamedIn(answer).some((page) => !pages.has(page))) return { ok: false, reason: 'uncited' }
// Grounded on the rule and the manual's quoted words, not on the page
// reference in front of them: "p.66" must not ground "66 feet".
const grounded = new Set<string>()
for (const law of sources) {
  // The words after the reference: a page ("p.66 (printed) — '…'") or a
  // section ("Md. Code, Transp. § 21-1003(m) — '…'") grounds no figure.
  const citation = law.citation as string
  // A page row's citation is "<agency> — <title> — '<passage>'", and a
  // title can carry figures its passage does not state -- Washington's
  // "ages 16 to 17" would ground a "16" -- so it grounds on the passage alone.
  const from = law.kind === 'process' && citation.includes(" — '") ? citation.indexOf(" — '") : citation.indexOf(' — ')
  const quoted = from >= 0 ? citation.slice(from) : citation
  for (const number of figuresIn(`${law.law}\n${quoted}`, 'en')) grounded.add(number)
  for (const number of ordinalsIn(`${law.law}\n${quoted}`)) grounded.add(number)
  for (const number of spelledOnesIn(`${law.law}\n${quoted}`)) grounded.add(number)
}
for (const number of figuresIn(question, lang)) grounded.add(number)
for (const count of nationwide?.counts ?? []) grounded.add(String(count))
for (const number of figuresIn(answer, lang)) {
  if (!grounded.has(number)) return { ok: false, reason: 'ungrounded' }
}
if (answer.length > (nationwide?.maxChars ?? MAX_ANSWER_CHARS)) return { ok: false, reason: 'overlong' }
return { ok: true, answer, laws: sources }
```

| reason | test |
|---|---|
| `no-state` | no state was chosen |
| `no-laws` | the state's file could not be read |
| `not-covered` | empty answer or no sources |
| `uncited` | a source id not in the retrieved set, or a cited law with no citation, or a page named in prose that no cited law is on |
| `ungrounded` | a figure in the answer that no cited law states |
| `overlong` | more than 600 characters (`MAX_ANSWER_CHARS`, [:45](worker/src/learner-ask.ts#L45)) |

[worker/src/learner-ask.ts:605-615](worker/src/learner-ask.ts#L605-L615)
```ts
export function figuresIn(text: string, lang: Lang): Set<string> {
  // "1,000" is one figure, not 1 and 000: New York's crash report law spells
  // "one thousand dollars", and the correct "$1,000" was refused as ungrounded.
  const normalised = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/\b0(\.\d)/g, '$1')
  const found = numbersIn(normalised, lang)
  for (const word of normalised.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const value = LARGER_WORDS[lang][word]
    if (value !== undefined) found.add(String(value))
    else if (lang === 'es' && word.startsWith('veinti')) found.add('20')
  }
  if (lang === 'en') for (const value of compounds(normalised)) found.add(String(value))
  // …
```

**The refusal lines** are the worker's, not the model's.

[worker/src/learner-ask.ts:805-827](worker/src/learner-ask.ts#L805-L827)
```ts
export function lawPointerFor(
  reason: LawRefusal,
  lang: Lang,
): { pointer: string; pointerHref: string | null; chooseState?: true } {
  const lines: Record<Lang, Record<'no-state' | 'not-covered' | 'refused', string>> = {
    en: {
      'no-state': 'Pick your state first: I answer road law only from your own state’s manual.',
      'not-covered': 'Your state’s manual doesn’t say, as far as I can find, so I won’t guess about road law.',
      refused: 'I can’t answer that from your state’s manual in a way I can check, so I won’t guess about road law.',
    },
    es: {
      'no-state': 'Primero elija su estado: respondo sobre las leyes de tránsito solo con el manual de su estado.',
      'not-covered': 'El manual de su estado no lo dice, hasta donde puedo encontrar, así que no voy a adivinar.',
      refused: 'No puedo responder eso con el manual de su estado de una forma que pueda comprobar, así que no voy a adivinar.',
    },
  }
  // One sentence and nothing under it: no state-page link and no contact line
  // (Joel, 2026-10-05: "just answer the question in prose"). The learner asked
  // about the road, and an address to write to is not an answer to that.
  if (reason === 'no-state') return { pointer: lines[lang]['no-state'], pointerHref: null, chooseState: true }
  const line = reason === 'not-covered' ? 'not-covered' : 'refused'
  return { pointer: lines[lang][line], pointerHref: null }
}
```

**Notice.**

- The check grounds on the citation's quoted words, never on the reference in
  front of them: "p.66" must not ground "66 feet".
- A nationwide answer is allowed two extra kinds of figure: the count of states
  with a law and the count without. Nothing else.
- Every refusal has a name, and the names are chosen so a day's log reads as a
  diagnosis: a run of `ungrounded` is a prompt problem, a run of `scope:road-law`
  is learners in the wrong box.
- The rules' comments record the measured failures that shaped each sentence,
  with dates. Read [:111-127](worker/src/learner-ask.ts#L111-L127) for the
  high-beam answer that set the register.

**Check:** the model is told not to write page numbers. Why does the checker
still look for them?

### Hop 8: the browser draws the answer

**Where:** `answerLearner` returns `LearnerBody` ([learner-ask.ts:860](worker/src/learner-ask.ts#L860));
the handler serialises it; [src/components/AskBox.tsx:708-818](src/components/AskBox.tsx#L708-L818)
renders it; [src/sources-line.ts:27](src/sources-line.ts#L27) folds the citations.

[worker/src/learner-ask.ts:860-871](worker/src/learner-ask.ts#L860-L871)
```ts
export interface LearnerBody {
  id: 'answer' | 'no-match'
  answer?: string
  sources?: { id: string; title: string; page: string | null }[]
  /**
   * A road-law answer's citations, verbatim: the manual's, which the app
   * renders as the cards do, or a statute's, which it labels as not the manual.
   * `asOf` is the date the law was true as of, from the published file
   * (docs/plans/trusted-by-date.md, decision 7) -- sent rather than left to
   * the browser, whose only date is today's.
   */
  citations?: { id: string; location: string; kind?: 'statute' | 'penalty' | 'process'; state?: string; asOf?: string }[]
```

The box's `submit` (hop 1) already routed `buy` and `chooseState`. What is left
reaches the answer component.

[src/components/AskBox.tsx:708-711](src/components/AskBox.tsx#L708-L711)
```ts
const citations = answer.citations ?? []
const line = sourcesLine(citations)
const shown = unfolded ? citations : citations.slice(0, SHOWN_CITATIONS)
const folded = new Set(citations.slice(shown.length).map((citation) => citation.state ?? citation.id)).size
```

[src/components/AskBox.tsx:787-818](src/components/AskBox.tsx#L787-L818)
```tsx
<div className="mt-2" data-testid="ask-answer">
  <Prose text={answer.answer} />
  {line !== null && (
    <p className="mt-2 text-xs font-bold text-muted" data-testid="ask-sources-line">
      {(labels.sourcesLine ?? ENGLISH.sourcesLine)(
        line.kind === 'states'
          ? (labels.statesSources ?? ENGLISH.statesSources)(line.states)
          : line.documents
              .map((document) =>
                document.kind === 'manual'
                  ? (labels.manualSource ?? ENGLISH.manualSource)(stateName, pagesText(document.pages))
                  : document.name,
              )
              .join(' · '),
      )}
      {line.asOf !== null && (
        <>
          {' · '}
          <span data-testid="ask-sources-asof">{(labels.asOf ?? ENGLISH.asOf)(line.asOf)}</span>
        </>
      )}{' '}
      <button
        type="button"
        data-testid="ask-sources-open"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="font-extrabold text-sky underline underline-offset-2"
      >
        {open ? labels.hideLaw ?? ENGLISH.hideLaw : labels.showLaw ?? ENGLISH.showLaw}
      </button>
    </p>
  )}
```

`sourcesLine` turns the citations into one line: the manual once with its
pages, a code section once however many subsections were cited, a schedule once
by its title. The date shown is the earliest `asOf`, and only when every
citation has one.

[src/sources-line.ts:27-62](src/sources-line.ts#L27-L62)
```ts
export function sourcesLine(citations: readonly Citation[]): SourcesLine | null {
  if (citations.length === 0) return null
  // One date, the earliest, and only when every row has one: a line that
  // dated four rows and silently not the fifth would claim a check of the
  // fifth that nobody made (docs/plans/trusted-by-date.md, decision 7).
  const dates = citations.map((citation) => citation.asOf)
  const asOf = dates.every((date): date is string => date !== undefined) ? [...dates].sort()[0] : null
  // A nationwide answer cites eight states' laws; naming eight manuals and
  // codes on one line is the paragraph list again, so it names the states.
  if (citations.some((citation) => citation.state !== undefined)) {
    const states = [...new Set(citations.flatMap((citation) => (citation.state === undefined ? [] : [citation.state])))]
    return { kind: 'states', states, asOf }
  }
  const documents: SourceDocument[] = []
  const laws = new Set<string>()
  let manual: { kind: 'manual'; pages: string[] } | null = null
  for (const citation of citations) {
    if (citation.kind === undefined) {
      if (manual === null) {
        manual = { kind: 'manual', pages: [] }
        documents.push(manual)
      }
      const page = manualReference({ source: 'manual:', location: citation.location }).page
      for (const each of page === null ? [] : page.replace(/^pp?\./i, '').split(',')) {
        if (each !== '' && !manual.pages.includes(each)) manual.pages.push(each)
      }
      continue
    }
    const name = documentOf(citation)
    if (laws.has(name)) continue
    laws.add(name)
    documents.push({ kind: 'law', name })
  }
  manual?.pages.sort((left, right) => parseInt(left, 10) - parseInt(right, 10))
  return { kind: 'documents', documents, asOf }
}
```

`documentOf` repeats `sectionOf`'s stripping rule from hop 6, in the browser's
own build.

[src/sources-line.ts:71-88](src/sources-line.ts#L71-L88)
```ts
function documentOf(citation: Citation): string {
  const quoted = citation.location.indexOf(' — ')
  const reference = quoted < 0 ? citation.location : citation.location.slice(0, quoted)
  if (citation.kind !== 'statute') {
    // Everything before the quoted words names the document: a state's own
    // page is "<agency> — <title> — '<passage>'", and six states' schedule
    // titles hold a dash of their own ("The 2026 Florida Statutes — 318.18
    // Amount of penalties."), which a cut at the first dash shortened to
    // "The 2026 Florida Statutes" and Connecticut's to "CHART A".
    const split = /^(.+?) — ['‘][\s\S]+['’]$/.exec(citation.location)
    return split === null ? reference : split[1]
  }
  const section = reference
    .replace(/,\s*subd\..*$/, '')
    .replace(/(?:\s*[–-]?\s*\([^()]*\))+[\s–-]*$/, '')
    .trim()
  return section === '' ? reference : section
}
```

The manual's page and quote are read by the same parser the study cards use.

[src/citation.ts:46-62](src/citation.ts#L46-L62)
```ts
export function manualReference(citation: Citation): ManualReference {
  const raw = citation.location.trim()
  const page = PAGE.exec(raw)?.[1].replace(/\s+/g, '') ?? null
  // …
  const rest = page === null ? raw : raw.slice(PAGE.exec(raw)![0].length)
  const quote = QUOTE.exec(rest)
  return { page, quote: quote?.[1].trim() ?? null, raw }
}
```

**Notice.**

- `location` is the corpus's own citation string, verbatim. The browser parses
  it with `manualReference`, the same function the study cards use, so the box
  and the cards can never cite differently.
- The refusal lines are the worker's, not the model's, and none contains a
  figure.
- The full citation paragraphs are one tap away, behind `ask-sources-open`.

**Check:** which field tells the browser to open the state picker, and which
hop set it?

### Branch: nationwide

**Where:** `answerNationwide` ([learner-ask.ts:1299](worker/src/learner-ask.ts#L1299)),
`chooseTopics` ([law-topics.ts:159](worker/src/law-topics.ts#L159)),
`nearestInEveryState` ([learner-ask.ts:1417](worker/src/learner-ask.ts#L1417)),
`nearLawsNationwideWith` ([law-nationwide.ts:89](worker/src/law-nationwide.ts#L89)).

Taken before any state file is fetched, when `state === 'US'`. No retrieval, no
reranker.

[worker/src/learner-ask.ts:1299-1332](worker/src/learner-ask.ts#L1299-L1332)
```ts
async function answerNationwide(
  asked: { lang: Lang; question: string },
  history: LearnerTurn[],
  pipeline: LearnerPipeline,
): Promise<{ body: LearnerBody; outcome: LearnerOutcome; path: NationwidePath }> {
  let given: NationwideLaws | 'failed'
  let path: NationwidePath = 'topic'
  try {
    if (pipeline.topics === undefined || pipeline.topicLawsFor === undefined) throw new Error('no topic files')
    const { topics: topicsFor, topicLawsFor, nearLawsNationwide, lawsById } = pipeline
    const topics = await topicsFor()
    const { topics: chosen } = await chooseTopics(asked.question, topics, pipeline.topicsFor)
    if (chosen.length === 0 && nearLawsNationwide !== undefined && lawsById !== undefined) {
      path = 'index'
      given = await nearestInEveryState(asked.question, nearLawsNationwide, lawsById, pipeline.rephrase)
    } else {
      given = {
        topics: await Promise.all(
          chosen.map(async (id) => {
            const laws = await topicLawsFor(id)
            const present = new Set(laws.map((law) => law.state))
            return {
              question: topics.find((topic) => topic.id === id)!.question,
              laws,
              absent: Object.keys(STATE_NAMES).filter((code) => !present.has(code)).sort(),
            }
          }),
        ),
      }
    }
  } catch (error) {
    console.error(`learner ask: could not read the nationwide laws (${path})`, error)
    given = 'failed'
  }
```

[worker/src/learner-ask.ts:1333-1360](worker/src/learner-ask.ts#L1333-L1360)
```ts
  const laws = given === 'failed' ? [] : given.topics.flatMap((topic) => topic.laws)
  const reply = await pipeline.askLearner({
    lang: asked.lang,
    question: asked.question,
    history,
    laws,
    nationwide: given === 'failed' ? { topics: [] } : given,
  })
  if (reply.kind !== 'reply' || reply.scope !== 'road-law') return { ...answerFromBook(reply, asked.lang, history, pipeline.contact), path }

  const refused = (reason: LawRefusal) => ({
    body: { id: 'no-match' as const, ...nationwidePointerFor(reason, asked.lang) },
    outcome: { answer: '', scope: 'road-law' as const, sources: reply.sources, model: `road-law:${reason}` },
    path,
  })
  if (given === 'failed') return refused('no-laws')
  if (given.topics.length === 0) return refused('no-topic')
  // No state had a law near the question: whatever the model wrote, it wrote
  // from nothing, and the honest line is that no state's law says.
  if (laws.length === 0) return refused('not-covered')
  const { absent, counts } = nationwideGrounds(given.topics)
  const checked = checkLawAnswer(reply, asked.lang, laws, laws, asked.question, { counts, maxChars: NATIONWIDE_ANSWER_CHARS })
  if (!checked.ok) return refused(checked.reason)
  return {
    body: {
      id: 'answer',
      answer: checked.answer,
      citations: nationwideCitations(checked.laws, laws),
      // …
```

**1. Topics.** Haiku matches the question to at most two topics, or four of one
family; absent or failing, the topics' own questions are searched by words.

[worker/src/law-topics.ts:159-177](worker/src/law-topics.ts#L159-L177)
```ts
export async function chooseTopics(
  question: string,
  topics: readonly NationwideTopic[],
  chooser: ChooseTopics | undefined,
): Promise<{ topics: string[]; family: string | null }> {
  let chosen: TopicChoice
  try {
    if (chooser === undefined) throw new Error('no topic chooser')
    const answered = await chooser(question, topics)
    chosen = Array.isArray(answered) ? { topics: answered } : answered
  } catch (error) {
    if (chooser !== undefined) console.error('learner ask: the topic chooser did not answer', error)
    chosen = { topics: topicsByWords(question, topics) }
  }
  const familyOf = new Map(topics.map((topic) => [topic.id, topic.family]))
  let ids = [...new Set(chosen.topics)].filter((id) => familyOf.has(id))
  // A family nobody declared is no family: "drunk" from the chooser must not lift the cap.
  const named = chosen.family !== undefined && Object.hasOwn(TOPIC_FAMILIES, chosen.family) ? chosen.family : null
  if (named !== null) ids = ids.filter((id) => familyOf.get(id) === named)
  // …
```

**2. Verdicts.** For each topic, every state's verdict law is read from
`/ask-laws/topics/<topic>.json`; the verdicts were chosen by hand in
[resource/statutes/coverage.json](resource/statutes/coverage.json). The states
with no law are named to the model, and under the answer, from the worker's own
list.

**3. The index, only when no topic matches.** Every one of the 51 namespaces is
queried separately; each state keeps its best two; the words are read from D1
by id.

[worker/src/law-nationwide.ts:89-118](worker/src/law-nationwide.ts#L89-L118)
```ts
export function nearLawsNationwideWith(
  embed: (texts: string[]) => Promise<number[][]>,
  query: (vector: number[], state: string) => Promise<{ id: string; score: number }[]>,
): NearLawsNationwide {
  return async (question, searches) => {
    const texts = [question, ...searches]
    // One embedding call for all of them: the model pads each text to the
    // longest, and three short texts cost what one does.
    const vectors = await embed(texts)
    if (vectors.length !== texts.length) throw new Error(`asked to embed ${texts.length} texts, given ${vectors.length} vectors`)
    const found = await Promise.all(
      Object.keys(STATE_NAMES).flatMap((state) =>
        vectors.map(async (vector) => (await query(vector, state)).map((match) => ({ state, id: match.id, score: match.score }))),
      ),
    )
    // A state's own page is not its rule: "how soon can I retake" across the
    // states is not a comparison the plan builds, and a retake page near a
    // question would take one of the state's two places from its law.
    return bestPerState(found.flat().filter((hit) => !isProcessId(hit.id)))
  }
}

/** The deployed loop: the AI binding embeds, the Vectorize binding answers each namespace. */
export function nearLawsNationwide(ai: Ai | undefined, index: VectorizeIndex | undefined): NearLawsNationwide | undefined {
  if (ai === undefined || index === undefined) return undefined
  return nearLawsNationwideWith(
    async (texts) => ((await ai.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] }).data,
    async (vector, state) => (await index.query(vector, { topK: NEAR_LAWS, namespace: state })).matches,
  )
}
```

[worker/src/learner-ask.ts:1417-1454](worker/src/learner-ask.ts#L1417-L1454)
```ts
async function nearestInEveryState(
  question: string,
  near: NearLawsNationwide,
  lawsById: LawsById,
  rephrase: Rephrase | undefined,
): Promise<NationwideLaws> {
  let searches: string[] = []
  if (rephrase !== undefined) {
    try {
      searches = await rephrase(question)
    } catch (error) {
      console.error('learner ask: the rephraser did not answer', error)
    }
  }
  const hits = await near(question, searches)
  const ids = Object.values(hits).flat()
  const stored = new Map((ids.length === 0 ? [] : await lawsById(ids)).map((law) => [law.id, law]))
  if (ids.length > 0 && stored.size === 0) {
    throw new Error(`the laws table holds none of the ${ids.length} laws the index found: has laws:store been pushed?`)
  }
  const laws = Object.keys(hits)
    .sort()
    .flatMap((state) =>
      hits[state].flatMap((id) => {
        const law = stored.get(id)
        if (law === undefined) {
          console.warn(`learner ask: the index holds ${id} and the laws table does not; a vector left behind, dropped`)
          return []
        }
        if (law.state !== state) throw new Error(`the laws table holds ${id} under ${law.state}, not ${state}`)
        return [law]
      }),
    )
  const present = new Set(laws.map((law) => law.state))
  return {
    topics: [{ question, laws, absent: Object.keys(STATE_NAMES).filter((code) => !present.has(code)).sort(), nearest: true }],
  }
}
```

**4. The seventh rule**, appended to the prompt only on this path
([learner-ask.ts:152-153](worker/src/learner-ask.ts#L152-L153)):

> Nationwide. When the laws given are labelled by state, the learner asked across all the states, and this replaces the rule above about the learner’s own state and two sentences. The laws given are, for each state, what its manual or code says on the question, and the states with nothing are named. A state’s law may not answer: use only the laws that do. Compare across them: name the state or states the question asks for, each with its own figure, and say in a phrase how the rest stand — “most states”, or one of the counts given with the laws. Never count states yourself: “40 states set 0.08” is a number no law states, and the app refuses it. Mention no state whose law is not given. At most five sentences, written for a sixteen-year-old: plain words, "you", and no law’s name or number in the sentences. Short sentences, never more of them than five: each under about 20 words, with at most two figures in a sentence, cutting words rather than adding a sentence; a cost (a fine, points, whether you go to court) only when the question asks about one, in a sentence of its own; never join two rules with “and Utah law also says” or the like. Figures in digits, and every law you drew on in "sources" — at least one law for every figure you write, the one “most states” share included, or the app refuses the figure as one nobody cited. When the laws given come in several blocks, one for each question on one subject, compare on each and say which state is strictest overall, naming the rule that decides it.

**Notice.**

- A single search over every state's laws at once would return the five
  states that phrase it like the question. That is why the per-state loop
  exists, and why the topic path is preferred over it.
- The nationwide rule is appended only on this path, so a state question's
  prompt is byte-for-byte what the eval measured.
- `nearestInEveryState` refuses as `no-laws` when the table holds none of the
  ids, and drops a single missing id.

**Check:** what stops the model from writing "40 states set 0.08"?

---

## Part 2: the offline corpus

What the hops read was built, checked and published before any question
arrived. Each step is one script and the resource it writes; the README's table
gives the `npm run` names.

### Step A: fetch the vehicle code

**Where:** [scripts/statutes/fetch.ts](scripts/statutes/fetch.ts),
[scripts/statutes/site.ts](scripts/statutes/site.ts),
[resource/statutes/sources/MD/](resource/statutes/sources/MD/).

One text file per section, with the address, the date and a hash beside it in
`SOURCES.json`. A section already present at its recorded hash is skipped, so
a run that dies can be rerun.

[scripts/statutes/fetch.ts:166-174](scripts/statutes/fetch.ts#L166-L174)
```ts
for (const [index, listing] of listings.entries()) {
  const file = path.join(root, SOURCES_DIR, code, `${listing.file}.txt`)
  const recorded = sources.files[listing.file]
  if (!refresh && recorded !== undefined && existsSync(file) && sha256(readFileSync(file, 'utf8')) === recorded.sha256) {
    // The listing may have learnt a catchline since; the text has not moved.
    sources.files[listing.file] = { ...recorded, section: listing.section, cite: listing.cite, heading: listing.heading }
    skipped += 1
    continue
  }
```

[scripts/statutes/fetch.ts:191-200](scripts/statutes/fetch.ts#L191-L200)
```ts
writeFileSync(file, text)
const entry: SourceFile = {
  url: listing.url,
  retrieved: today,
  sha256: sha256(text),
  section: listing.section,
  cite: listing.cite,
  heading: listing.heading,
  ...(pdf === undefined ? {} : { pdfSha256: pdf }),
  ...(isRepealed(text, listing.section) ? { repealed: true } : {}),
```

Maryland has 820 files. The monthly `refresh.ts` re-fetches and diffs.

### Step B: cut sections into subsections

**Where:** [worker/src/code-chunks.ts](worker/src/code-chunks.ts), `chunkSection`
at [:268](worker/src/code-chunks.ts#L268).

[worker/src/code-chunks.ts:17-18](worker/src/code-chunks.ts#L17-L18)
```ts
/** Roughly a paragraph: long enough for a whole rule, short enough that eight are a page. */
export const CHUNK_CHARS = 900
```

A section splits at its top-level labels, `(a)` or `(1)`; the grouping loop is
the heart of it.

[worker/src/code-chunks.ts:300-324](worker/src/code-chunks.ts#L300-L324)
```ts
const plain = lines.findIndex((line) => labelOf(line) !== null)
const letteredAt = lines.findIndex((line) => labelOf(line, true) !== null)
const lettered = letteredAt >= 0 && labelOf(lines[letteredAt], true)?.kind === 'lower-dot' && (plain < 0 || letteredAt < plain)
const first = lettered ? letteredAt : plain
const opening = first < 0 ? null : labelOf(lines[first], lettered)
// A section that opens on "I." opens on a roman numeral: a lettered one opens on "A.".
const top = opening?.kind === 'upper-dot' && opening.text === 'I' ? asRoman(opening) : opening
const groups: { label: string | null; lines: string[] }[] = []
if (top === null || top.value < 0) {
  groups.push({ label: null, lines })
} else {
  if (first > 0) groups.push({ label: null, lines: lines.slice(0, first) })
  let current = top.value
  let group = { label: top.text, lines: [lines[first]] }
  for (let index = first + 1; index < lines.length; index += 1) {
    if (continues(lines, index, top.kind, current)) {
      groups.push(group)
      const label = inRun(labelOf(lines[index], lettered), top.kind)!
      if (label.value > current) current = label.value
      group = { label: label.text, lines: [] }
    }
    group.lines.push(lines[index])
  }
  groups.push(group)
}
```

A subsection longer than 900 characters splits again at line boundaries. Every
chunk is lines of the committed source joined with a space, so a test can find
it verbatim. The module is pure and shared by the publisher, the embedder, the
eval and the e2e harness.

### Step C: build the state's retrieval file

**Where:** [scripts/statutes/laws.ts](scripts/statutes/laws.ts), run by the
`corpus` Vite plugin at [vite.config.ts:248](vite.config.ts#L248);
`retrievalFile` at [law-retrieval.ts:99](worker/src/law-retrieval.ts#L99).

[worker/src/law-retrieval.ts:99-101](worker/src/law-retrieval.ts#L99-L101)
```ts
export function retrievalFile(corpus: { laws: CorpusLaw[] }, statutes: StatuteLaw[] | null): AskLaw[] {
  return [...askLaws(corpus), ...(statutes === null ? [] : askStatutes(statutes))]
}
```

[scripts/statutes/laws.ts:123-141](scripts/statutes/laws.ts#L123-L141)
```ts
export function lawsOf(root: string, code: string): AskLaw[] {
  const corpus = JSON.parse(readFileSync(path.join(root, 'resource/corpus/drivers', `${code}.json`), 'utf8'))
  const statutes = [...(handLawsOf(root, code) ?? []), ...codeChunksOf(root, code)]
  const superseded = supersededOf(root)
  const fetched = readSources(root, code)?.files ?? {}
  const sourceOf = new Map(statutes.map((law) => [law.id, law.source]))
  const manual = readManualSources(root)[code]?.retrieved
  return retrievalFile(corpus, statutes.length === 0 ? null : statutes)
    .filter((law) => superseded[law.id] === undefined)
    .map((law) => {
      if (law.kind === 'statute') {
        const retrieved = fetched[sourceOf.get(law.id) ?? '']?.retrieved
        if (retrieved === undefined) throw new Error(`${law.id}: its source ${sourceOf.get(law.id)} has no retrieved date in ${sourcesFile(code)}`)
        return { ...law, asOf: retrieved }
      }
      if (manual === undefined) throw new Error(`${code} has no manual with a retrieved date in ${MANUAL_SOURCES_FILE}`)
      return { ...law, asOf: manual }
    })
}
```

[scripts/statutes/laws.ts:155-157](scripts/statutes/laws.ts#L155-L157)
```ts
export function publishedLawsOf(root: string, code: string): AskLaw[] {
  return [...lawsOf(root, code), ...processLawsOf(root, code)]
}
```

[vite.config.ts:259-272](vite.config.ts#L259-L272)
```ts
generateBundle() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
  const published = new Map<string, AskLaw[]>()
  for (const product of manifest.products) {
    if (product.id !== 'drivers') continue
    for (const state of product.states) {
      // The state's code, where it has been sourced, after the manual: Maryland's
      // hand-written laws and the chunked sections (docs/plans/vehicle-code.md);
      // then its own pages' passages (docs/plans/what-happens-if.md, phase 3).
      const laws = publishedLawsOf(process.cwd(), state.code)
      published.set(state.code, laws)
      this.emitFile({ type: 'asset', fileName: lawsPath(state.code).slice(1), source: JSON.stringify(laws) })
    }
  }
```

The manual's laws from [resource/corpus/drivers/MD.json](resource/corpus/drivers/MD.json)
(216 laws, each with a card question and a `manual:` citation), Maryland's
fifteen hand-written statutes from [resource/statutes/MD.json](resource/statutes/MD.json),
every code chunk, and the state's page rows, in one list, each with its `asOf`
date. Published at `/ask-laws/MD.json`. Hop 3 reads it.

### Step D: store every law in D1

**Where:** [scripts/laws-store.ts](scripts/laws-store.ts), `storeStatements` at
[law-nationwide.ts:263](worker/src/law-nationwide.ts#L263),
[worker/schema.sql](worker/schema.sql), manifest [resource/laws-store.json](resource/laws-store.json).

[worker/schema.sql:1064-1072](worker/schema.sql#L1064-L1072)
```sql
CREATE TABLE IF NOT EXISTS laws (
  id       TEXT PRIMARY KEY,                        -- the law's id, "MD-C-21-902-a"
  state    TEXT NOT NULL,                           -- its state's code
  kind     TEXT,                                    -- 'statute', or NULL for the manual's
  law      TEXT NOT NULL,
  question TEXT NOT NULL,
  concept  TEXT NOT NULL,
  citation TEXT
);
```

[worker/schema.sql:1084-1099](worker/schema.sql#L1084-L1099)
```sql
ALTER TABLE laws ADD COLUMN as_of TEXT;
-- …
ALTER TABLE laws ADD COLUMN section TEXT;
CREATE INDEX IF NOT EXISTS idx_laws_state_section ON laws(state, section);
```

[worker/src/law-nationwide.ts:263-275](worker/src/law-nationwide.ts#L263-L275)
```ts
export function storeStatements(state: string, laws: readonly AskLaw[], maxBytes = STORE_STATEMENT_BYTES): string[] {
  const head = 'INSERT OR REPLACE INTO laws (id, state, kind, law, question, concept, citation, as_of, section) VALUES '
  const out: string[] = []
  let rows: string[] = []
  let size = head.length
  for (const law of laws) {
    const row = `(${[law.id, state, law.kind ?? null, law.law, law.question, law.concept, law.citation, law.asOf ?? null, sectionOf(law)].map(literal).join(', ')})`
    const bytes = new TextEncoder().encode(row).length + 2
    if (rows.length > 0 && size + bytes > maxBytes) {
      out.push(head + rows.join(', '))
      rows = []
      size = head.length
    }
    // …
```

[scripts/laws-store.ts:109-114](scripts/laws-store.ts#L109-L114)
```ts
async function pushState(store: Store, state: string, laws: AskLaw[]): Promise<void> {
  await store.run(storeStatements(state, laws))
  const now = new Set(laws.map((law) => law.id))
  const gone = (await store.ids(state)).filter((id) => !now.has(id))
  await store.run(deleteStatements(state, gone))
}
```

Literal `INSERT` statements of up to 90,000 bytes because D1 allows at most 100
bound parameters. Hop 6 reads it by section, the nationwide branch by id.

### Step E: embed every law in Vectorize

**Where:** [scripts/law-vectors.ts](scripts/law-vectors.ts), `embeddingText` at
[law-vectors.ts:54](worker/src/law-vectors.ts#L54), manifest
[resource/law-vectors.json](resource/law-vectors.json).

[worker/src/law-vectors.ts:20](worker/src/law-vectors.ts#L20)
```ts
export const EMBEDDING_MODEL = '@cf/baai/bge-m3'
```

[worker/src/law-vectors.ts:54-57](worker/src/law-vectors.ts#L54-L57)
```ts
export function embeddingText(law: Pick<AskLaw, 'id' | 'law' | 'question' | 'concept'>): string {
  const heading = isCodeChunk(law.id) && law.concept !== '' ? `${law.concept}: ` : ''
  return `${heading}${law.law} ${law.question}`.trim()
}
```

[scripts/law-vectors.ts:133-148](scripts/law-vectors.ts#L133-L148)
```ts
async function push(root: string, code: string, auth: string, kind?: string): Promise<number> {
  const laws = lawsOf(root, code).filter((law) => kind === undefined || law.kind === kind)
  for (const batch of batches(laws)) {
    const embedded = (await api(
      auth,
      `ai/run/${EMBEDDING_MODEL}`,
      JSON.stringify({ text: batch.map(embeddingText) }),
      'application/json',
    )) as { data: number[][] }
    const ndjson = batch
      .map((law, index) => JSON.stringify({ id: law.id, namespace: code, values: embedded.data[index] }))
      .join('\n')
    await api(auth, `vectorize/v2/indexes/${LAWS_INDEX}/upsert`, ndjson, 'application/x-ndjson')
  }
  return laws.length
}
```

1024 dimensions, cosine, one namespace per state. The text embedded is the
section heading, the rule and the card question, the same text the reranker
scores. The script never deletes a vector, which is why hop 5 and the
nationwide branch drop ids the file or table does not hold.

### Step F: the court's fine schedule

**Where:** [scripts/penalties/](scripts/penalties/),
[resource/penalties/SOURCES.json](resource/penalties/SOURCES.json),
[resource/penalties/MD.json](resource/penalties/MD.json) (1,408 rows).

[worker/schema.sql:1121-1131](worker/schema.sql#L1121-L1131)
```sql
CREATE TABLE IF NOT EXISTS penalties (
  id             TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL,
  section        TEXT NOT NULL,
  code           TEXT NOT NULL,
  offence        TEXT NOT NULL,
  fine_text      TEXT NOT NULL,
  fine_min_cents INTEGER,
  fine_max_cents INTEGER,
  points         INTEGER,
  appear         TEXT NOT NULL CHECK (appear IN ('payable', 'must-appear', 'court-sets')),
```

Each row keys to a section the way `sectionOf` does, with the figure, whether
it is payable without court, the points, and the schedule's own line as the
quote. A row is kept only when its quote is a substring of the page fetched
today (`verified`, [scripts/penalties/source.ts:161](scripts/penalties/source.ts#L161)).
Hop 6 joins them.

### Step G: the state's own pages

**Where:** [scripts/process/](scripts/process/),
[worker/src/process-families.ts](worker/src/process-families.ts),
[resource/process/MD.json](resource/process/MD.json).

[worker/src/process-families.ts:14-45](worker/src/process-families.ts#L14-L45)
```ts
export const PROCESS_FAMILIES = [
  {
    id: 'gdl-rules',
    question: 'What am I not allowed to do with my permit or provisional license?',
    covers: 'the passenger limit, night-time hours and phone ban for a learner’s permit or provisional license holder',
  },
  {
    id: 'provisional-sanctions',
    question: 'What happens to my provisional license if I get a ticket or have a crash?',
    covers: 'what a conviction, points or a crash does to a permit or provisional license: suspension, a longer provisional period, a required course',
  },
  {
    id: 'test-and-retake',
    question: 'If I fail my driving test, how soon can I take it again?',
    covers: 'how soon a failed knowledge or road test can be taken again, how many tries, and what a retake costs',
  },
  {
    id: 'permit-holding',
    question: 'How long do I have to hold my permit before I can take the road test?',
    covers: 'how long a learner’s permit is held before the road test, and the supervised driving hours required',
  },
  {
    id: 'insurance-minimums',
    question: 'What car insurance do I need to drive?',
    covers: 'the minimum liability insurance a driver must carry, and whose policy covers a learner',
  },
  {
    id: 'ticket-procedure',
    question: 'What do I do after I get a traffic ticket?',
    covers: 'what a traffic citation means, how to pay or contest it, and how many days are allowed to respond',
  },
] as const
```

Haiku picks passages from the DMV's or court's page, and each is kept only if
it is a substring of the page as fetched.

[scripts/process/fetch.ts:222-224](scripts/process/fetch.ts#L222-L224)
```ts
const proposed = await (options.pick ?? haikuPicker(process.env.ANTHROPIC_API_KEY))(family, page, text)
const checked = verifiedPassages(family.id, proposed, text)
for (const each of checked.dropped) log(`NOT STORED ${code} ${each.family}: ${each.reason}: "${each.passage}"`)
```

[scripts/process/source.ts:219-233](scripts/process/source.ts#L219-L233)
```ts
export function verifiedPassages(
  family: ProcessFamily,
  proposed: readonly string[],
  page: string,
): { passages: string[]; dropped: DroppedPassage[] } {
  const text = pageText(page)
  const passages: string[] = []
  const dropped: DroppedPassage[] = []
  for (const each of proposed) {
    const passage = pageText(each)
    if (passage === '') continue
    if (!onThePage(passage, text)) dropped.push({ family, passage, reason: 'not in the fetched page' })
    else if (passage.length > MAX_PASSAGE_CHARS) dropped.push({ family, passage, reason: `longer than ${MAX_PASSAGE_CHARS} characters` })
    else if (passages.includes(passage)) continue
    else if (passages.length >= MAX_PASSAGES) dropped.push({ family, passage, reason: `past the first ${MAX_PASSAGES}` })
```

Stored in `laws` with `kind = 'process'` and the family as `concept`, id
`MD-R-<family>-<n>`, which is the key range `processRowsForDb` (hop 5) reads.

### Step H: pre-answered chips, the monthly refresh, the eval

**Where:** [scripts/chips-build.ts](scripts/chips-build.ts),
[scripts/state-chips-files.ts](scripts/state-chips-files.ts),
[scripts/statutes/refresh.ts](scripts/statutes/refresh.ts),
[scripts/learner-ask-eval.ts](scripts/learner-ask-eval.ts).

Chips run the same `answerLearner` offline and store the checked answer
([chips-build.ts:96](scripts/chips-build.ts#L96)). The refresh re-fetches every
section and reports changes. The eval runs 190 cases against the live model and
is kept out of the test suite because it costs money and is not deterministic.

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
| 2026-10-14 | — | code quoted inline under each reference; hop 1 reordered to start from the HTML |
