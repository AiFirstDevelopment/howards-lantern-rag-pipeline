import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTurnstile } from './turnstile'
import { MAX_QUESTION_CHARS, type AskAnswer, type AskLabels, type AskThreadEntry } from '../ask'
import { manualReference } from '../citation'
import { keptFor, mergeThread, type Deleted } from '../ask-thread'
import { pagesText, sourcesLine } from '../sources-line'
import { shortDate } from '../strings'
import { COMPARED_PAGE, NATIONWIDE } from '../topics'
import { uuid } from '../uuid'

/**
 * A box that answers a question about the partner program, and takes
 * follow-ups.
 *
 * One component for both audiences -- the public partner page and the portal --
 * because they show the same thing and differ only in which route answers and
 * whether a challenge is needed. The two routes are deliberately separate on
 * the worker (a merged handler is one bug away from serving account entries to
 * a stranger); the two *screens* are the same screen, and a second copy of this
 * would be a second place for the copy about what we keep to drift.
 *
 * **Nothing here is generated.** The worker answers with an entry id and that
 * entry's text, taken from worker/src/knowledge-base.md verbatim; this renders
 * it. There is no state in which this component composes a sentence about
 * money, which is the whole reason the feature is shaped this way.
 */
export interface AskBoxProps {
  send: (input: {
    conversation: string
    question: string
    turnstile: string
  }) => Promise<AskAnswer | null>
  /**
   * Asked before a question is sent. False keeps the question in the input and
   * sends nothing; the parent says why (the day's limit, src/ask-quota.ts).
   * A prop of its own rather than a `send` that answers null, because null
   * reads as the worker being unreachable and shows "that did not go through".
   * May answer later: the learner's page asks "Spend a token?" in a dialog
   * and sends, or does not, on the reply (docs/plans/trusted-by-date.md,
   * decision 25).
   */
  beforeSend?: () => boolean | Promise<boolean>
  /**
   * The conversation to continue, on the learner's page coming back from
   * Stripe Checkout: the thread's id was kept while its asker paid, so the
   * question they return to is a follow-up the worker can still read the
   * earlier turns for. Absent, the box starts a conversation of its own.
   */
  conversation?: string
  /** Told what the input holds as it changes, so the page can keep it while its asker is at Checkout. */
  onDraft?: (question: string) => void
  /**
   * Three questions people actually ask, as one-tap starting points. The ask
   * page passes none: each was typed into the box and counted against the
   * week, while styled as the free chips under it are, and read as a chip
   * that cost a question (Joel, 2026-10-12).
   */
  examples?: string[]
  /**
   * The line above the box saying what happens to a question, on the partner
   * and rep pages.
   *
   * Passed in rather than imported, because it is not the same sentence on the
   * two surfaces and the version that shipped on both said "nothing else about
   * you is recorded" over a route that records the asker's account id. The
   * learner's page passes nothing: its paragraph -- how answers are made, what
   * is kept -- was five lines nobody read above the thing they came to use
   * (Joel, 2026-10-13); the privacy page and the footer's "How it works" say
   * the same.
   */
  notice?: string
  /** A link after the notice. Nothing passes one today; the learner's page did. */
  noticeLink?: { href: string; label: string }
  /**
   * The Turnstile site key, on the surface that has no session.
   *
   * Absent -- the portal, and any build without a key -- draws no widget and
   * sends no token. The worker is what decides; a challenge that only exists in
   * the browser protects nothing.
   */
  siteKey?: string
  /**
   * The box's own words, in the language of the surface. Absent -- the two
   * partner pages -- the box reads as it always has, in English; the learner's
   * page passes `t.ask.labels` so a Spanish learner is not met by an English
   * placeholder above a Spanish answer (docs/plans/learner-ask.md, decision 10).
   */
  labels?: AskLabels
  /**
   * Where "write to us" goes on a surface that has a contact page: the
   * learner's. The partner pages pass nothing and keep the address as a
   * `mailto:`, which is what a school on a laptop expects.
   */
  contactPage?: { href: string; label: string }
  /** Focus the input on mount: the page was opened from something that looked like it. */
  autoFocus?: boolean
  /**
   * Opens the state picker, on the learner's page: a road-law question with no
   * state chosen is answered by choosing one, never generically. The partner
   * pages pass nothing; their worker never asks for it.
   */
  onChooseState?: (question: string) => void
  /**
   * A question to ask at once, without a tap: the one that was answered "pick
   * your state first", once the state is chosen. Asked once per value.
   */
  askNow?: string | null
  /** Called when `askNow` has been asked. */
  onAskedNow?: () => void
  /**
   * Opens the card teaching a cited law, on the learner's page: null where
   * there is no card or the pass has not reached it, and then no control is
   * drawn (docs/plans/ask-cards.md). The partner pages pass nothing.
   */
  card?: (id: string) => (() => void) | null
  /**
   * What the input holds when the box first draws: a topic's question, for a
   * visitor who arrived from that topic's search page. Not sent -- sending
   * costs a challenge and a model call for somebody who may only have wanted
   * to read (docs/plans/nationwide.md, decision 14).
   */
  initialQuestion?: string
  /**
   * Questions answered in advance, on the learner's page in nationwide mode
   * (docs/plans/trusted-by-date.md, decision 17). A tap puts the stored answer
   * in the thread as if it had just arrived, and sends nothing: not through
   * `beforeSend`, so it costs none of the week's questions, and not through
   * `send`, so the worker is never asked. The partner pages pass nothing.
   */
  chips?: { id: string; question: string; answer: AskAnswer }[]
  /** The words above the chips. */
  chipsLabel?: string
  /** The one muted word on every chip saying it is free, so the difference survives the heading scrolling off. */
  chipFree?: string
  /**
   * Whose chips these are: the nationwide row's (`ask-chip`), or one state's
   * (`ask-state-chip`, docs/plans/what-happens-if.md, decision 24). Two names,
   * because a state's twelve and the nationwide pool are different rows a
   * test -- and a learner -- must be able to tell apart.
   */
  chipsKind?: 'nationwide' | 'state'
  /**
   * The state a state chip's answer was for. When it changes the state's
   * stored answers leave the thread: Maryland's curfew answer under a box now
   * answering for Texas reads as Texas's.
   */
  chipState?: string | null
  /** Called with a chip's id when it is tapped, after its answer is in the thread. */
  onChip?: (id: string) => void
  /**
   * The state a road-law answer is for, on the learner's page, so the one
   * line under it can name "Maryland driver’s manual" rather than a manual.
   * Null in nationwide mode, where the line names the states instead.
   */
  stateName?: string | null
  /**
   * What a question asked now is answered for -- a state code, `US` for
   * nationwide -- kept beside it in the thread the learner's page stores.
   */
  scope?: string | null
  /**
   * A state's name from its code, for a kept answer asked for another state:
   * Maryland's pages under "Texas driver’s manual" would send a learner to
   * the wrong book. Absent, every answer is labelled with `stateName`.
   */
  stateNameOf?: (code: string) => string | null
  /**
   * The thread this device kept, on the learner's page: drawn folded, every
   * card, because nothing in it was just asked. The partner pages pass
   * nothing and keep nothing, as before.
   */
  history?: readonly AskThreadEntry[]
  /** Told the answered thread whenever it changes, so the page can keep it. */
  onHistory?: (thread: AskThreadEntry[]) => void
  /**
   * Exchanges from elsewhere -- the code's history, read back from the worker
   * -- merged into the thread folded wherever this device does not already
   * hold them (src/ask-thread.ts).
   */
  incoming?: readonly AskThreadEntry[]
  /** Told each exchange the learner deletes, so the page can keep the code's history from bringing it back. */
  onDelete?: (deleted: Deleted) => void
  /** Whether the exchanges under the newest start shown; told each change of it. */
  earlierShown?: boolean
  onEarlierShown?: (shown: boolean) => void
  /** Drawn above the input: on the learner's page, what is left to ask with. */
  balance?: ReactNode
}

/** Today's English, which the partner pages get by passing nothing. */
const ENGLISH: Required<AskLabels> = {
  label: 'Ask a question',
  placeholder: 'Type your question here',
  button: 'Ask',
  asking: 'Asking…',
  waiting: 'One moment — checking this is a person.',
  trouble: 'That did not go through. Try again in a moment.',
  noMatch: 'I do not have a written answer to that one.',
  handOff: 'That is two I could not answer, so this one is better asked of a person.',
  writeTo: 'Write to',
  reads: 'and a person reads it.',
  readMore: 'Read more',
  statePage: 'Your state’s page',
  chooseState: 'Choose your state',
  inTheManual: (page) => `In the manual, ${page}`,
  inTheLaw: (reference) => `Not in your manual — ${reference}`,
  card: 'See the card',
  comparePage: 'What the states can be compared on',
  absent: (names) => `No rule found in the manual or code of: ${names}`,
  moreStates: (count) => `Show ${count} more ${count === 1 ? 'state' : 'states'}`,
  asOf: (date) => `as of ${shortDate(date, 'en')}`,
  sourcesLine: (documents) => `Sources: ${documents}`,
  manualSource: (state, pages) => `${state === null ? 'The driver’s manual' : `${state} driver’s manual`}${pages === '' ? '' : ` ${pages}`}`,
  statesSources: (states) =>
    states.length === 1
      ? `${states[0]} law`
      : states.length <= 3
        ? `${states.slice(0, -1).join(', ')} and ${states[states.length - 1]} laws`
        : `${states[0]}, ${states[1]} and ${states.length - 2} more states’ laws`,
  showLaw: 'Show the law',
  hideLaw: 'Hide the law',
  showAnswer: 'Show the answer',
  hideAnswer: 'Hide the answer',
  deleteQuestion: 'Delete this question',
  showEarlier: (count) => `Show ${count} more`,
  showLess: 'Show less',
}

/**
 * How many citation lines a nationwide answer shows before folding the rest.
 * Six states' sources read as a list; forty-six read as the page, and the
 * answer above them scrolls off a phone.
 */
const SHOWN_CITATIONS = 6

/**
 * The id the Turnstile widget is drawn into.
 *
 * Deliberately not `turnstile`: an element with that id becomes
 * `window.turnstile` through named access on the window, and Cloudflare's
 * api.js reads exactly that name to decide whether it has already loaded --
 * which made the application form draw no widget at all and refuse every
 * applicant as a robot. See the same note in src/partners/Portal.tsx.
 */
const WIDGET_ID = 'ask-turnstile-widget'


interface Exchange {
  question: string
  /** Null while the question waiting on a state is asked for the one just chosen. */
  answer: AskAnswer | null
  /** A chip's stored answer, which nobody asked the worker for: `state` for one state's. */
  chip?: true | 'state'
  /** Drawn as the whole card; folded, it is one line holding the question. */
  open: boolean
  /** What it was answered for: a state code, `US`, or null. */
  state?: string | null
  askedAt?: string
  conversation?: string
  /** Kept from an earlier visit rather than asked in this one. */
  restored?: true
}

/**
 * The thread with one more exchange at its end, open, and every one before it
 * folded to its question: the history cards filled a phone screen (Joel,
 * 2026-10-12), so the answer just asked for is the only one drawn whole until
 * somebody taps an earlier one open again.
 */
function appended(before: Exchange[], exchange: Omit<Exchange, 'open'>): Exchange[] {
  return [...before.map((earlier) => (earlier.open ? { ...earlier, open: false } : earlier)), { ...exchange, open: true }]
}

export default function AskBox({
  send,
  beforeSend,
  conversation: continued,
  onDraft,
  examples = [],
  notice,
  noticeLink,
  siteKey = '',
  labels = ENGLISH,
  contactPage,
  onChooseState,
  askNow = null,
  onAskedNow,
  autoFocus = false,
  card,
  initialQuestion = '',
  chips = [],
  chipsLabel,
  chipFree,
  chipsKind = 'nationwide',
  chipState = null,
  onChip,
  stateName = null,
  scope = null,
  stateNameOf,
  history,
  onHistory,
  incoming,
  onDelete,
  earlierShown: earlierShownAtFirst = true,
  onEarlierShown,
  balance,
}: AskBoxProps) {
  // One conversation per box. It is what the worker uses to read the earlier
  // turns back, which is what makes "what if I don't hit that?" resolvable.
  const [conversation] = useState(() => continued ?? uuid())
  // A state's chip answers kept from a visit to another state are left out,
  // for the same reason a change of state takes them away below -- but only
  // once the state is known: a state still on its way is not a different one
  // (keptFor, src/ask-thread.ts).
  const [thread, setThread] = useState<Exchange[]>(() =>
    keptFor(history ?? [], chipState).map((kept) => ({ ...kept, open: false, restored: true as const })),
  )
  // Every change of the thread handed to the page as it would be kept: an
  // exchange still waiting for its answer is not one yet.
  const keep = useRef(onHistory)
  keep.current = onHistory
  useEffect(() => {
    keep.current?.(
      thread.flatMap(({ question, answer, chip, state, askedAt, conversation: asked }) =>
        answer === null
          ? []
          : [{ question, answer, ...(chip === undefined ? {} : { chip }), state: state ?? null, askedAt: askedAt ?? new Date().toISOString(), ...(asked === undefined ? {} : { conversation: asked }) }],
      ),
    )
  }, [thread])
  const [earlierShown, setEarlierShown] = useState(earlierShownAtFirst)
  const [question, setQuestion] = useState(initialQuestion)
  const [pending, setPending] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const { challenge, waiting: waitingForChallenge } = useTurnstile(siteKey, WIDGET_ID)

  useEffect(() => {
    if (incoming === undefined || incoming.length === 0) return
    // Folded, and counted as kept rather than asked: nothing in it was just asked.
    setThread((before) => mergeThread(before, incoming, (entry) => ({ ...entry, open: false, restored: true as const })))
  }, [incoming])

  // A state's stored answers go with the state they were for; live answers
  // and the nationwide chips' stay, as they always have.
  const answeredFor = useRef(chipState)
  useEffect(() => {
    if (answeredFor.current === chipState) return
    answeredFor.current = chipState
    // The geo answer arriving after the first render passes through here too,
    // and must leave that state's own chip answers where they are.
    setThread((before) => keptFor(before, chipState))
  }, [chipState])

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

  // A ref rather than state: the effect below runs twice under StrictMode, and
  // the same question sent twice is two answers stacked in the thread.
  const askedNow = useRef<string | null>(null)
  useEffect(() => {
    if (askNow === null || askedNow.current === askNow) return
    askedNow.current = askNow
    void submit(askNow, true).then(() => onAskedNow?.())
  })

  return (
    <section className="mt-3" data-testid="ask-box">
      {(notice !== undefined || noticeLink !== undefined) && (
        <p className="text-sm font-bold text-muted" data-testid="ask-notice">
          {notice}
          {noticeLink !== undefined && (
            <>
              {' '}
              <a href={noticeLink.href} data-testid="ask-method-link" className="text-sky underline underline-offset-2">
                {noticeLink.label}
              </a>
            </>
          )}
        </p>
      )}

      {thread.length > 0 && (
        // Newest first (Joel, 2026-10-13): the thread grew downwards, so the
        // answer just asked for landed under every earlier question and a
        // returning learner scrolled past the oldest to find the latest.
        <ul className="mt-3 flex flex-col gap-3">
          {thread
            .map((exchange, index) => ({ exchange, index }))
            .reverse()
            .map(({ exchange, index }, shownAt) => (
            <li
              key={`${exchange.askedAt ?? ''}|${exchange.question}`}
              data-testid="ask-exchange"
              data-open={exchange.open ? 'true' : 'false'}
              hidden={shownAt > 0 && !earlierShown}
              className="rounded-2xl border-2 border-line bg-paper p-3"
            >
              <div data-testid={exchange.chip === true ? 'ask-chip-answer' : exchange.chip === 'state' ? 'ask-state-chip-answer' : undefined}>
                <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  data-testid="ask-exchange-toggle"
                  aria-expanded={exchange.open}
                  aria-label={exchange.open ? labels.hideAnswer ?? ENGLISH.hideAnswer : labels.showAnswer ?? ENGLISH.showAnswer}
                  onClick={() =>
                    setThread((before) => before.map((each, at) => (at === index ? { ...each, open: !each.open } : each)))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {/* One line while folded, ellipsis and all: a long question
                      wrapping to three lines would give back the screen the
                      fold was for. */}
                  <span
                    className={`min-w-0 flex-1 text-xs font-extrabold uppercase tracking-widest text-muted ${exchange.open ? '' : 'truncate'}`}
                  >
                    {exchange.question}
                  </span>
                  {!exchange.open && exchange.chip !== undefined && chipFree !== undefined && (
                    <span data-testid="ask-exchange-free" className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted">
                      {chipFree}
                    </span>
                  )}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className={`h-4 w-4 shrink-0 fill-current text-muted ${exchange.open ? 'rotate-180' : ''}`}
                  >
                    <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
                  </svg>
                </button>
                {/* Not on a question still being answered: its answer would
                    arrive and put it straight back. */}
                {exchange.answer !== null && (
                  <button
                    type="button"
                    data-testid="ask-exchange-delete"
                    aria-label={labels.deleteQuestion ?? ENGLISH.deleteQuestion}
                    onClick={() => {
                      setThread((before) => before.filter((_, at) => at !== index))
                      onDelete?.({
                        question: exchange.question,
                        ...(exchange.askedAt === undefined ? {} : { askedAt: exchange.askedAt }),
                        ...(exchange.conversation === undefined ? {} : { conversation: exchange.conversation }),
                      })
                    }}
                    className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                      <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4z" />
                    </svg>
                  </button>
                )}
                </div>
                {/* Hidden rather than unmounted, so a law somebody tapped open
                    under an earlier answer is still open when they come back to it. */}
                <div hidden={!exchange.open}>
                  {exchange.answer === null ? (
                    <p role="status" data-testid="ask-asking" className="mt-1 flex items-center gap-2 text-sm font-bold text-muted">
                      <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-sky" />
                      {labels.asking}
                    </p>
                  ) : (
                    <Answer
                      answer={exchange.answer}
                      labels={labels}
                      contactPage={contactPage}
                      onChooseState={onChooseState === undefined ? undefined : () => onChooseState(exchange.question)}
                      card={card}
                      stateName={
                        exchange.state === undefined || exchange.state === null || stateNameOf === undefined
                          ? stateName
                          : exchange.state === NATIONWIDE
                            ? null
                            : stateNameOf(exchange.state) ?? stateName
                      }
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {thread.length > 1 && (
        <button
          type="button"
          data-testid="ask-earlier-toggle"
          aria-expanded={earlierShown}
          onClick={() => {
            setEarlierShown(!earlierShown)
            onEarlierShown?.(!earlierShown)
          }}
          className="mt-2 text-sm font-bold text-sky underline underline-offset-2"
        >
          {earlierShown ? labels.showLess ?? ENGLISH.showLess : (labels.showEarlier ?? ENGLISH.showEarlier)(thread.length - 1)}
        </button>
      )}

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
        {trouble !== null && (
          <p className="text-sm font-extrabold text-danger" data-testid="ask-trouble">
            {trouble}
          </p>
        )}
        {/*
          Last, and below the button rather than above it.

          It shipped between the input and the Ask button, which put a
          third-party widget -- its own border, its own logo, a green tick
          reading as a completed step -- in the gap where somebody's eye travels
          from what they typed to the thing that sends it. A challenge is
          machinery, not part of the question, and breaking the type-then-press
          chain with it makes the button look like it belongs to the widget
          instead.

          The e2e holds the order by position rather than by DOM index, because
          what went wrong was visual and a reordering that still looked wrong
          would pass an index check.
        */}
        {siteKey.length > 0 && <div className="mt-1" id={WIDGET_ID} />}
      </form>

      {/*
        The examples survive anything that was not an answer. They used to
        disappear on the first exchange of any kind, so a visitor whose opening
        tap was refused -- a challenge that had not loaded, a cap -- lost the
        one-tap questions as well and had to retype by hand. A refusal is the
        state where they are most useful, not least.
      */}
      {/* Only an answer from this visit: a kept thread hid them for good from
          anybody who had ever asked once, on every visit after. */}
      {examples.length > 0 && !thread.some((exchange) => exchange.restored !== true && exchange.answer?.answer !== undefined) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {examples.map((example) => (
            <li key={example}>
              <button
                type="button"
                data-testid="ask-example"
                onClick={() => {
                  setQuestion(example)
                  void submit(example)
                }}
                className="rounded-2xl border-2 border-line bg-paper px-3 py-2 text-xs font-extrabold text-sky"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chips.length > 0 && (
        <div className="mt-4" data-testid={chipsKind === 'state' ? 'ask-state-chips' : 'ask-chips'}>
          {chipsLabel !== undefined && (
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted" data-testid="ask-chips-label">
              {chipsLabel}
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  data-testid={chipsKind === 'state' ? 'ask-state-chip' : 'ask-chip'}
                  data-chip={chip.id}
                  onClick={() => {
                    // Straight into the thread: never `submit`, whose gate
                    // counts the week's questions and whose `send` is the
                    // worker -- a stored answer needs neither.
                    setThread((before) => appended(before, {
                        question: chip.question,
                        answer: chip.answer,
                        chip: chipsKind === 'state' ? 'state' : true,
                        state: chipsKind === 'state' ? chipState : NATIONWIDE,
                        askedAt: new Date().toISOString(),
                        conversation,
                      }),
                    )
                    onChip?.(chip.id)
                  }}
                  className="rounded-2xl border-2 border-sky bg-paper px-3 py-2 text-left text-xs font-extrabold text-sky"
                >
                  {chip.question}
                  {chipFree !== undefined && (
                    <span data-testid="ask-chip-free" className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                      {chipFree}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * One answer, in whichever of its three shapes arrived.
 *
 * A refusal and a no-match both end in the same place -- an address a person
 * reads -- because every way this can fail is meant to land somebody on a
 * person rather than on an error.
 */
function Answer({
  answer,
  labels,
  contactPage,
  onChooseState,
  card,
  stateName,
}: {
  answer: AskAnswer
  labels: AskLabels
  contactPage?: { href: string; label: string }
  onChooseState?: () => void
  card?: (id: string) => (() => void) | null
  stateName: string | null
}) {
  const [unfolded, setUnfolded] = useState(false)
  // The law itself, folded under one line until asked for: Joel's high-beam
  // answer (2026-10-11) was two sentences above five quoted paragraphs, on a
  // phone, for a sixteen-year-old (src/sources-line.ts).
  const [open, setOpen] = useState(false)
  const citations = answer.citations ?? []
  const line = sourcesLine(citations)
  const shown = unfolded ? citations : citations.slice(0, SHOWN_CITATIONS)
  const folded = new Set(citations.slice(shown.length).map((citation) => citation.state ?? citation.id)).size
  if (answer.error !== undefined) {
    return (
      <div className="mt-2" data-testid="ask-refused">
        <p className="text-sm font-bold leading-snug">{answer.error}</p>
        {answer.contact !== undefined && (
          <Contact address={answer.contact} labels={labels} page={contactPage} />
        )}
      </div>
    )
  }
  if (answer.answer === undefined) {
    return (
      <div className="mt-2" data-testid="ask-no-match">
        {/*
          The worker's own line for a scope it declined -- road law, a price, a
          promise -- drawn here, in the no-match branch, and never inside
          ask-answer: it says where the answer actually is, and it is ours, not
          the model's (docs/plans/learner-ask.md, decision 6).
        */}
        {answer.pointer !== undefined && (
          <p className="text-sm font-bold leading-snug" data-testid="ask-pointer">
            {answer.pointer}
            {answer.pointerHref !== undefined && answer.pointerHref !== null && (
              <>
                {' '}
                <a
                  href={answer.pointerHref}
                  data-testid="ask-pointer-link"
                  className="text-sky underline underline-offset-2"
                >
                  {/* Named for where it goes: "Your state’s page" under a
                      refusal that is about every state would send somebody
                      looking for the wrong thing. */}
                  {answer.pointerHref === COMPARED_PAGE ? labels.comparePage ?? ENGLISH.comparePage : labels.statePage}
                </a>
              </>
            )}
          </p>
        )}
        {answer.chooseState === true && onChooseState !== undefined && (
          <button
            type="button"
            data-testid="ask-choose-state"
            onClick={onChooseState}
            className="mt-2 text-sm font-extrabold text-sky underline underline-offset-2"
          >
            {labels.chooseState ?? ENGLISH.chooseState}
          </button>
        )}
        {/* The hand-off still said after two misses, pointer or no pointer:
            two road-law questions in a row is somebody who needs a person,
            not a third pointer. */}
        {(answer.pointer === undefined || answer.handOff === true) && (
          <p className={`text-sm font-bold leading-snug ${answer.pointer === undefined ? '' : 'mt-2'}`}>
            {answer.handOff === true ? labels.handOff : labels.noMatch}
          </p>
        )}
        {/*
          Which answers could not be reached, said here too.

          The worker attaches `unavailable` to a no-match as deliberately as it
          does to an answer, and it used to be drawn only on the answer -- so a
          total mesh outage, where every fine server is unreachable and nothing
          comes back at all, told the asker the answer does not exist. That is
          the one case where the outage is invisible and the one where saying so
          matters most.
        */}
        <Unavailable domains={answer.unavailable} />
        {answer.contact !== undefined && (
          <Contact address={answer.contact} labels={labels} page={contactPage} />
        )}
      </div>
    )
  }
  return (
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
      {(line === null || open) && <Cite cite={answer.cite} url={answer.citeUrl} />}
      {/*
        Where the manual says it, under a road-law answer: rendered here from
        the corpus's own citation, never from the model's sentence, and in the
        card's words, so the page a learner checks is the page the card cites.
        Drawn only once the line above is tapped open.
      */}
      {open && shown.map((citation) => {
        // Asked per citation, on its own line: an answer citing two laws may
        // have a card for one and not the other.
        const openCard = card?.(citation.id) ?? null
        // Whose law it is, on a nationwide answer: eight states' citations
        // with nothing saying which is which would leave the learner to guess
        // that the 0.05 is Utah's.
        const whose = citation.state !== undefined && (
          <>
            <span data-testid="ask-citation-state">{citation.state}</span>
            {' — '}
          </>
        )
        // The date the law was true as of, as the worker sent it: the browser
        // knows only today, and a law dated today would claim a check nobody
        // made (docs/plans/trusted-by-date.md, decision 7).
        const asOf = citation.asOf !== undefined && (
          <span className="block font-semibold" data-testid="ask-citation-asof">
            {(labels.asOf ?? ENGLISH.asOf)(citation.asOf)}
          </span>
        )
        const seeCard = openCard !== null && (
          <>
            {' '}
            <button
              type="button"
              data-testid="ask-card"
              onClick={openCard}
              className="text-sky underline underline-offset-2"
            >
              {labels.card ?? ENGLISH.card}
            </button>
          </>
        )
        if (citation.kind === 'statute' || citation.kind === 'penalty' || citation.kind === 'process') {
          // The state's code, where the manual is silent: labelled so nobody
          // goes looking for it in the handbook (docs/plans/statute-corpus.md).
          // A court's fine schedule is in no manual either, and drawn the same
          // way -- the schedule's name, its own line, its date -- or it fell
          // to the manual's branch below and printed as an unlabelled string
          // (docs/plans/what-happens-if.md, phase 2). So is the state's own
          // page (phase 3): the agency and the page's title, its passage, the
          // day it was read.
          const split = /^(.+?) — '([\s\S]+)'$/.exec(citation.location)
          const inTheLaw = labels.inTheLaw ?? ENGLISH.inTheLaw
          return (
            <p key={citation.id} className="mt-2 text-xs font-bold text-muted" data-testid="ask-citation">
              {whose}
              {split === null ? (
                citation.location
              ) : (
                <>
                  <span data-testid="ask-citation-law">{inTheLaw(split[1])}</span>: <q>{split[2]}</q>
                </>
              )}
              {seeCard}
              {asOf}
            </p>
          )
        }
        const cited = manualReference({ source: 'manual:', location: citation.location })
        const inTheManual = labels.inTheManual ?? ENGLISH.inTheManual
        return (
          <p key={citation.id} className="mt-2 text-xs font-bold text-muted" data-testid="ask-citation">
            {whose}
            {cited.page !== null && <span data-testid="ask-citation-page">{inTheManual(cited.page)}</span>}
            {cited.page !== null && cited.quote !== null && ': '}
            {cited.quote === null && cited.page === null ? cited.raw : cited.quote !== null && <q>{cited.quote}</q>}
            {seeCard}
            {asOf}
          </p>
        )
      })}
      {open && folded > 0 && (
        <button
          type="button"
          data-testid="ask-citations-more"
          onClick={() => setUnfolded(true)}
          className="mt-2 text-xs font-extrabold text-sky underline underline-offset-2"
        >
          {(labels.moreStates ?? ENGLISH.moreStates)(folded)}
        </button>
      )}
      {/* The worker's list, never the model's: a comparison that left a state
          out without saying so would read as that state agreeing. */}
      {answer.absent !== undefined && answer.absent.length > 0 && (
        <p className="mt-2 text-xs font-bold text-muted" data-testid="ask-absent">
          {(labels.absent ?? ENGLISH.absent)(answer.absent.join(', '))}
        </p>
      )}
      {/*
        The pages the answer rests on, one tap away. A model's sentence about a
        refund is not what binds; the Request a refund page is, and this is how
        a learner gets from the one to the other without a menu.
      */}
      {answer.sources !== undefined && answer.sources.some((source) => source.page !== null) && (
        <p className="mt-2 text-xs font-bold text-muted" data-testid="ask-sources">
          {labels.readMore}:{' '}
          {answer.sources
            .filter((source) => source.page !== null)
            .map((source, index) => (
              <span key={source.id}>
                {index > 0 && ' · '}
                <a
                  href={source.page ?? undefined}
                  data-testid="ask-source-link"
                  className="text-sky underline underline-offset-2"
                >
                  {source.title}
                </a>
              </span>
            ))}
        </p>
      )}
      {/*
        The second written answer, when the question was two questions.

        Drawn as a further answer rather than merged into the first: they are
        two entries somebody wrote separately, and running them together would
        be composing -- the one thing this box is built never to do.
      */}
      {(answer.also ?? []).map((more) => (
        <div key={more.id} className="mt-3 border-t-2 border-line pt-3" data-testid="ask-also">
          <Prose text={more.answer} />
          <Cite cite={more.cite} url={more.citeUrl} />
        </div>
      ))}
      {(answer.figures ?? []).map((figure) => (
        <ul
          key={figure.tool}
          className="mt-3 flex flex-col gap-1 border-t-2 border-line pt-3"
          data-testid="ask-figures"
        >
          {figure.lines.map((line, index) => (
            <li key={index} className="text-sm font-bold leading-snug">
              {line}
            </li>
          ))}
        </ul>
      ))}
      {/*
        Said out loud rather than left as a gap. Half an answer that looks like
        a whole one is worse than a shorter answer that says which part is
        missing.
      */}
      <Unavailable domains={answer.unavailable} />
    </div>
  )
}

/** The domains that did not answer, wherever the answer landed. */
function Unavailable({ domains }: { domains?: string[] }) {
  if (domains === undefined || domains.length === 0) return null
  return (
    <p className="mt-3 text-xs font-bold text-muted" data-testid="ask-unavailable">
      I could not reach the {domains.join(' and ')} answers just now, so this may be incomplete.
    </p>
  )
}

function Cite({ cite, url }: { cite?: string | null; url?: string | null }) {
  if (cite === undefined || cite === null) return null
  return (
    <p className="mt-2 text-xs font-bold text-muted" data-testid="ask-cite">
      {url === undefined || url === null ? (
        plain(cite)
      ) : (
        <a href={url} data-testid="ask-cite-link" className="text-sky underline underline-offset-2">
          {plain(cite)}
        </a>
      )}
    </p>
  )
}

function Contact({
  address,
  labels,
  page,
}: {
  address: string
  labels: AskLabels
  page?: { href: string; label: string }
}) {
  // The page first, the address as text beside it: a learner on a phone taps
  // the page; one on a laptop can still copy the address.
  if (page !== undefined) {
    return (
      <p className="mt-2 text-sm font-bold" data-testid="ask-contact">
        <a href={page.href} data-testid="ask-contact-page" className="text-sky underline underline-offset-2">
          {page.label}
        </a>{' '}
        · {address}
      </p>
    )
  }
  return (
    <p className="mt-2 text-sm font-bold" data-testid="ask-contact">
      {labels.writeTo}{' '}
      <a href={`mailto:${address}`} className="text-sky underline underline-offset-2">
        {address}
      </a>{' '}
      {labels.reads}
    </p>
  )
}

/**
 * The answer as the document wrote it: paragraphs, and the numbered lists that
 * two of the entries are.
 *
 * The text is markdown because it is edited as markdown, and it is *served*
 * verbatim -- so this renders the little of it the entries actually use rather
 * than pulling in a parser. Anything it does not know about falls through as
 * text, which is the safe direction: a stray marker is ugly, and a renderer
 * that dropped a clause would be worse than ugly.
 */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/)
  return (
    <>
      {blocks.map((block, index) => {
        const items = block.split(/\n(?=\d+\. )/)
        if (/^\d+\. /.test(block) && items.length > 1) {
          return (
            <ol key={index} className="mt-2 flex list-decimal flex-col gap-1 pl-5">
              {items.map((item, itemIndex) => (
                <li key={itemIndex} className="text-sm font-bold leading-snug">
                  {inline(item.replace(/^\d+\.\s+/, ''))}
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={index} className={`${index === 0 ? '' : 'mt-2'} text-sm font-bold leading-snug`}>
            {inline(block)}
          </p>
        )
      })}
    </>
  )
}

/** `**bold**` and `` `code` ``, which is the whole of the inline markup used. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <b key={index}>{part.slice(2, -2)}</b>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <span key={index}>{part.slice(1, -1)}</span>
    }
    return <span key={index}>{part}</span>
  })
}

/** The same markers taken out of a one-line citation. */
function plain(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}
