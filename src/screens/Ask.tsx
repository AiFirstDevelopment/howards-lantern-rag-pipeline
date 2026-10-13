import { useEffect, useMemo, useRef, useState } from 'react'
import { askLearners, claimQuestions, fetchQuestionBalance, fetchQuestionHistory, startQuestionsCheckout } from '../api'
import { fromHistory, rebuildable, withoutDeleted, type Deleted } from '../ask-thread'
import type { AskThreadEntry } from '../ask'
import { record } from '../analytics'
import { CHIPS_PATH, CHIPS_TAPPED_KEY, chipAnswer, drawChips, loadChips, recordChipTap, refillChips, stateChipsPath, stateChipsTappedKey, tappedChips, type StoredChip } from '../chips'
import { ASK_WEEKLY_LIMITS, asksLeft, daysUntilReset, recordAsk, type AskKind } from '../ask-quota'
import type { StateOption } from '../data/laws'
import { feedbackConfigured } from '../feedback'
import AskBox from '../components/AskBox'
import BuyQuestions from '../components/BuyQuestions'
import Button from '../components/Button'
import Screen from '../components/Screen'
import StatePicker from '../components/StatePicker'
import { useLanguage, useStrings } from '../language'
import { CHANGES_PAGE } from '../method-page'
import { NATIONWIDE } from '../topics'
import { TOKENS_PER_QUESTION, type Pack } from '../pricing'
import { clearAskPending, loadAskDeleted, loadAskEarlierShown, loadAskThread, markSpendConfirmed, readAskPending, saveAskDeleted, saveAskEarlierShown, saveAskPending, saveAskThread, saveQuestionCode, spendConfirmed, storedQuestionCode, type AskPending } from '../storage'
import { uuid } from '../uuid'

interface AskProps {
  onBack: () => void
  /** The state being studied: road law is answered from its manual and no other. */
  stateCode: string | null
  /** The states on offer, for the line naming the one answered for and for the picker. */
  states: readonly StateOption[]
  /** Makes `code` the state answered for, and the one the front page's picker holds. */
  onChooseState: (code: string) => void
  /** Arrived from the entry on a front page, which looks like this input: the input is focused. */
  focusInput?: boolean
  /** Opens the card a road-law answer cited, where the pass has reached it; null where it has not. */
  card: (id: string) => (() => void) | null
  /**
   * Arrived from a comparison page (`/drivers/laws/`, or one topic's): the page
   * opens with Nationwide ticked, and with that topic's question in the input
   * where there is one. Null on every other open, when the box starts unticked.
   */
  nationwide?: { question: string } | null
  /**
   * A state's laws from its published corpus, for rebuilding the sources line
   * of an answer read back from the code's history. Absent, those answers
   * come back without one.
   */
  lawsFor?: (code: string) => Promise<readonly { id: string; citations?: readonly { source: string; location: string }[] }[]>
}

/**
 * The learner's ask box, as a page (docs/plans/learner-ask.md, decision 9).
 *
 * A page rather than a floating bubble: on a phone the screen is the modal, Back
 * closes it like every other overlay, and a fixed bubble in the corner would sit
 * on the hub's two buttons at 375px. The label promises no person -- no avatar,
 * no "online" -- and the notice says, in the learner's language, that a model
 * writes the answers from a description of the app and can be wrong.
 *
 * The box is the partner page's box. What differs is the route it sends to and
 * the words it is given: `labels` so a Spanish learner meets a Spanish
 * placeholder, and `lang` and the state code on the wire so the worker picks the
 * right book and can point a road-law refusal at the right state's page.
 */
export default function Ask({ onBack, stateCode, states, onChooseState, focusInput = false, card, nationwide: arrived = null, lawsFor }: AskProps) {
  const t = useStrings()
  const { lang } = useLanguage()
  // In the page's state, not stored: unticked on every other open, so a
  // learner's next question is answered for their own state unless they ask
  // otherwise, and the state they study is never touched by it
  // (docs/plans/nationwide.md, decision 11).
  // What the page held when its asker left for Stripe Checkout, read once on
  // the way back -- paid or cancelled -- so the question, the tick and the
  // conversation are exactly as they were (docs/plans/trusted-by-date.md,
  // decision 25). Read in an initializer, because the box's input takes its
  // first value on its first render; cleared in an effect below.
  const [pending] = useState<AskPending | null>(() => readAskPending())
  const [nationwide, setNationwide] = useState(pending?.nationwide ?? arrived !== null)
  const [conversation] = useState(() => pending?.conversation ?? uuid())
  // The thread this device kept: a reload, or a phone that dropped the tab,
  // emptied it, and the answer somebody came back for was gone with it.
  const [history] = useState(() => loadAskThread())
  // What this device's learner deleted, so the code's history read below does
  // not merge it back in folded on the next load.
  const [deleted, setDeleted] = useState<Deleted[]>(() => loadAskDeleted())
  // What is in the input, kept for the moment its asker leaves for Checkout.
  const draft = useRef(pending?.question ?? arrived?.question ?? '')
  // The purchase pop-up, while it is up: opened by the week's limit (with
  // which kind ran out) or by tapping the balance line (decision 25).
  const [buying, setBuying] = useState<{ limit: AskKind | null } | null>(null)
  const tokens = useTokens()
  // The code's questions from every device that holds it, read once the code
  // is here -- on load, or the moment "I have a code" restores it.
  const cloud = useCloudHistory(tokens.code, lawsFor)
  // Memoised: a fresh array on every render would re-run the box's merge on
  // every render, and each merge sets the thread, which is a render.
  const incoming = useMemo(() => withoutDeleted(cloud, deleted), [cloud, deleted])
  // "Spend a token?", while it waits for a reply.
  const [confirming, setConfirming] = useState<{ cost: number; resolve: (yes: boolean) => void } | null>(null)
  // Whether the question about to be sent is the one beforeSend decided to
  // pay for: a ref, because the gate and the send are two calls in one tap.
  const paying = useRef(false)
  // How many questions were sent from this page: the counter under the tick
  // reads the week's count from storage, and storage does not re-render.
  const [spent, setSpent] = useState(0)
  // The picker is open, and with the question that was answered "pick your
  // state first" when that is what opened it -- null from "Change".
  const [choosing, setChoosing] = useState<{ question: string | null } | null>(null)
  // That question, held until the state it was waiting for is the one being
  // answered for. Asked on the state code rather than on the tap: a learner
  // mid-course switches state through a corpus fetch, and a question sent
  // before it lands would be answered for the state they just left.
  const [waiting, setWaiting] = useState<{ question: string; code: string } | null>(null)
  const stateName = states.find((option) => option.code === stateCode)?.name ?? null
  // Which fact, and nothing else; no question row is written for a chip, so
  // this is the only trace a tap leaves (trusted-by-date.md, decision 18).
  const nationwideChips = useChips(nationwide ? CHIPS_PATH : null, CHIPS_TAPPED_KEY, lang, (id) => record('chip_tapped', { chip: id }))
  // A state's chips while it is the one answered for (what-happens-if.md,
  // decision 24), counted with the state under a name of its own: the twelve
  // ids are every state's, and `chip_tapped` refuses a state.
  const stateChips = useChips(
    !nationwide && stateCode !== null ? stateChipsPath(stateCode) : null,
    stateCode === null ? CHIPS_TAPPED_KEY : stateChipsTappedKey(stateCode),
    lang,
    (id) => {
      if (stateCode !== null) record('state_chip_tapped', { chip: id, state: stateCode })
    },
  )
  const chips = nationwide ? nationwideChips : stateChips
  return (
    <Screen siteFooter>
      <button
        type="button"
        data-testid="ask-back-top"
        onClick={onBack}
        className="self-start text-sm font-extrabold text-sky"
      >
        {t.common.backTop}
      </button>

      <h1 className="mt-4 text-2xl font-extrabold">{t.ask.title}</h1>

      {/* Road law is answered for one state, so the page says which -- a
          learner who chose nothing, or chose on another visit, cannot see it
          anywhere else here. */}
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

      {tokens.notice !== null && (
        <div className="mt-2 rounded-2xl border-2 border-sky-soft bg-paper p-3 text-sm font-bold text-ink" data-testid="ask-tokens">
          {tokens.notice === 'pending' ? (
            <p data-testid="ask-tokens-pending">{t.ask.tokensPending}</p>
          ) : tokens.notice === 'restored' ? (
            <p data-testid="ask-code-restored">{t.ask.codeRestored(tokens.code ?? '', tokens.left ?? 0)}</p>
          ) : (
            <>
              <p data-testid="ask-tokens-ready">
                {pending !== null && pending.question.trim() !== '' ? t.ask.tokensReady : t.ask.tokensReadyNoQuestion}
              </p>
              <p className="mt-1" data-testid="ask-question-code">
                {t.ask.questionCode(tokens.code ?? '')}
              </p>
            </>
          )}
        </div>
      )}

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
        initialQuestion={pending?.question ?? arrived?.question ?? ''}
        siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''}
        labels={{
          ...t.ask.labels,
          label: t.ask.ownQuestion,
          // The corpus cites the English manual; in Spanish the card says so,
          // and so does the box.
          inTheManual: lang === 'es' ? t.question.inTheEnglishManual : t.question.inTheManual,
        }}
        contactPage={{ href: '#contact', label: t.contact.page }}
        onChooseState={(question) => setChoosing({ question })}
        askNow={waiting !== null && waiting.code === stateCode ? waiting.question : null}
        onAskedNow={() => setWaiting(null)}
        autoFocus={focusInput}
        card={card}
        chips={chips.shown.map((chip) => ({ id: chip.id, question: chip.question, answer: chipAnswer(chip) }))}
        chipsKind={nationwide ? 'nationwide' : 'state'}
        chipsLabel={nationwide ? t.ask.chipsLabel : t.ask.stateChipsLabel(stateName ?? '')}
        chipFree={t.ask.chipFree}
        chipState={stateCode}
        onChip={chips.tap}
        stateName={nationwide ? null : stateName}
        scope={nationwide ? NATIONWIDE : stateCode}
        stateNameOf={(code) => states.find((option) => option.code === code)?.name ?? null}
        history={history}
        onHistory={saveAskThread}
        incoming={incoming}
        onDelete={(gone) =>
          setDeleted((before) => {
            const next = [...before, gone]
            saveAskDeleted(next)
            return next
          })
        }
        earlierShown={loadAskEarlierShown()}
        onEarlierShown={saveAskEarlierShown}
        // What is left of the week's questions and the code's tokens, where the
        // question is typed (Joel, 2026-10-13), in place of a label that said
        // in words what a question spends. Tappable since tokens exist: the
        // same pop-up a spent week opens (decision 25). The tokens join the
        // line only once this browser holds a code. Read on every render, so
        // it counts down the moment a question is sent.
        balance={
          <button
            type="button"
            className="self-start text-left text-xs font-bold text-muted underline decoration-dotted underline-offset-2"
            data-testid="ask-balance"
            data-spent={spent}
            onClick={() => setBuying({ limit: null })}
          >
            {t.ask.questionsLeft(
              asksLeft(nationwide ? 'nationwide' : 'state'),
              nationwide ? ASK_WEEKLY_LIMITS.nationwide : ASK_WEEKLY_LIMITS.state,
              daysUntilReset(),
              tokens.code !== null && tokens.left !== null ? tokens.left : null,
            )}
          </button>
        }
      />

      {/* Arrived from a comparison page, whose own HTML the app replaced with
          this box: the list it offered, one tap away (trusted-by-date.md,
          decision 13). A link to the changes page's form rather than a second
          form here, because the box above already draws a Turnstile widget and
          a second copy of Cloudflare's script on one screen would put the
          box's own challenge at risk on the path every question takes. */}
      {arrived !== null && (
        <p className="mt-6 text-sm font-bold text-muted" data-testid="ask-subscribe">
          {t.ask.subscribeOffer}{' '}
          <a href={`${CHANGES_PAGE}#subscribe`} data-testid="subscribe-link" className="text-sky underline underline-offset-2">
            {t.ask.subscribeLink}
          </a>
        </p>
      )}

      {choosing !== null && (
        <ChooseState
          states={states}
          value={stateCode ?? ''}
          title={t.ask.labels.chooseState}
          cancel={t.ask.cancel}
          onCancel={() => setChoosing(null)}
          onChoose={(code) => {
            const { question } = choosing
            setChoosing(null)
            if (question !== null) setWaiting({ question, code })
            if (code !== stateCode) onChooseState(code)
          }}
        />
      )}

      {buying !== null && (
        <BuyQuestions
          limit={
            buying.limit === null
              ? null
              : {
                  title: t.ask.limitTitle,
                  body: buying.limit === 'nationwide' ? t.ask.limitNationwide(ASK_WEEKLY_LIMITS.nationwide) : t.ask.limitState(ASK_WEEKLY_LIMITS.state),
                }
          }
          onBuy={async (pack: Pack) => {
            // Written down before anything leaves the page: the question in
            // the input, the tick and the thread, so the way back -- paid or
            // cancelled -- puts them where they were (guard 28a).
            saveAskPending({ question: draft.current, nationwide, conversation, at: Date.now() })
            const started = await startQuestionsCheckout({ pack: pack.dollars, lang, from: tokens.code, path: window.location.pathname })
            if (started === null || started === 'unavailable') {
              clearAskPending()
              return started === null ? 'trouble' : 'unavailable'
            }
            window.location.assign(started.checkoutUrl)
            // Never resolved into a message: the page is leaving.
            return new Promise<never>(() => {})
          }}
          onCode={async (typed) => {
            const found = await fetchQuestionBalance(typed)
            if (found === null) return 'trouble'
            if (found === 'unknown') return 'unknown'
            tokens.adopt(found.code, found.left, 'restored')
            setBuying(null)
            return null
          }}
          onClose={() => setBuying(null)}
        />
      )}

      {confirming !== null && (
        <SpendConfirm
          title={t.ask.spendTitle}
          body={t.ask.spendBody(confirming.cost, tokens.left ?? confirming.cost)}
          yes={t.ask.spendYes}
          no={t.ask.notNow}
          onAnswer={confirming.resolve}
        />
      )}

      {/* The form this button displaced from the chrome, one tap away for the
          learner who came here to report a card rather than to ask. */}
      {feedbackConfigured() && (
        <p className="mt-6 text-sm font-bold text-muted">
          <a href="#feedback" data-testid="ask-feedback-link" className="text-sky underline underline-offset-2">
            {t.ask.feedback}
          </a>
        </p>
      )}

      <footer className="pb-2 pt-8">
        <Button data-testid="ask-back" onClick={onBack}>
          {t.common.back}
        </Button>
      </footer>
    </Screen>
  )
}

/**
 * A row of chips (docs/plans/trusted-by-date.md, decision 17; what-happens-if.md,
 * decision 24): the file at `url` fetched the first time it is wanted, three
 * drawn at random from the learner's language less the ones tapped under
 * `key`, and drawn again only on a new page load, a new language or a new
 * file -- a row that reshuffled on every tick would move the chip somebody
 * was reaching for. A tap takes only the tapped chip off the row and puts
 * another untapped one in its place (refillChips): the row used to shrink
 * by one a tap and be empty after three, which read as the chips going away
 * for having been used. Null `url` is no row. Each file's draw is kept by
 * its own address, so ticking Nationwide and back gives the state's same
 * three, and changing the state gives that state's.
 */
function useChips(url: string | null, key: string, lang: string, counted: (id: string) => void): { shown: StoredChip[]; tap: (id: string) => void } {
  const [pools, setPools] = useState<Record<string, StoredChip[]>>({})
  const [drawn, setDrawn] = useState<Record<string, StoredChip[]>>({})
  useEffect(() => {
    if (url === null || pools[url] !== undefined) return
    let live = true
    void loadChips(url).then((loaded) => {
      if (live) setPools((before) => ({ ...before, [url]: loaded }))
    })
    return () => {
      live = false
    }
  }, [url, pools])
  const pool = url === null ? undefined : pools[url]
  const draw = url === null ? null : `${url}\u0000${lang}`
  useEffect(() => {
    if (pool === undefined || draw === null || drawn[draw] !== undefined) return
    setDrawn((before) => ({ ...before, [draw]: drawChips(pool.filter((chip) => chip.lang === lang), tappedChips(key)) }))
  }, [pool, draw, drawn, lang, key])
  const tap = (id: string) => {
    const ownLanguage = (pool ?? []).filter((chip) => chip.lang === lang)
    recordChipTap(id, ownLanguage.map((chip) => chip.id), key)
    counted(id)
    // Read after the tap is recorded: a pool just spent has an empty list.
    const tapped = tappedChips(key)
    if (draw !== null) setDrawn((before) => ({ ...before, [draw]: refillChips(before[draw] ?? [], id, ownLanguage, tapped) }))
  }
  return { shown: draw === null ? [] : (drawn[draw] ?? []), tap }
}

/**
 * The state picker, over the ask page rather than instead of it.
 *
 * It used to send the learner to the front page to choose, which closed this
 * page and threw away the answer they were reading; the question then had to be
 * found again behind the ask button. A native `<dialog>` opened with
 * `showModal` brings the focus trap, Escape and the backdrop with it.
 */
function ChooseState({
  states,
  value,
  title,
  cancel,
  onCancel,
  onChoose,
}: {
  states: readonly StateOption[]
  value: string
  title: string
  cancel: string
  onCancel: () => void
  onChoose: (code: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      data-testid="ask-state-dialog"
      aria-labelledby="ask-state-title"
      // Escape closes a dialog without asking React; this is what keeps the
      // two agreeing that it is closed.
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      // Visible overflow, or the dialog clips the state list it opens; placed
      // high so the list has the rest of the screen to drop into.
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-md overflow-visible rounded-3xl border-2 border-line bg-paper p-5 text-ink backdrop:bg-ink/40"
    >
      {/* Cancel beside the title, above the picker: below it, the state list
          that drops open on focus covered it, and a picker that opens on its
          own had no way out but Escape, which a phone does not have. */}
      <div className="flex items-baseline justify-between gap-3">
        <label
          id="ask-state-title"
          htmlFor="ask-state-selector"
          className="text-xs font-extrabold uppercase tracking-wide text-muted"
        >
          {title}
        </label>
        <button
          type="button"
          data-testid="ask-state-cancel"
          onClick={onCancel}
          className="text-sm font-extrabold text-sky underline underline-offset-2"
        >
          {cancel}
        </button>
      </div>
      <StatePicker id="ask-state-selector" states={states} value={value} onChange={onChoose} />
    </dialog>
  )
}

/**
 * "Spend a token?" (docs/plans/trusted-by-date.md, decision 25): asked once a
 * visit, the first time a question would be paid for, so a learner who did
 * not notice the week had run out is never charged without a tap. The same
 * native `<dialog>` as the state picker, for the same focus trap and Escape.
 */
function SpendConfirm({ title, body, yes, no, onAnswer }: { title: string; body: string; yes: string; no: string; onAnswer: (yes: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      data-testid="ask-spend-confirm"
      aria-labelledby="ask-spend-title"
      onCancel={(event) => {
        event.preventDefault()
        onAnswer(false)
      }}
      className="mx-auto mt-[20vh] w-[calc(100%-2rem)] max-w-md rounded-3xl border-2 border-line bg-paper p-5 text-ink backdrop:bg-ink/40"
    >
      <h2 id="ask-spend-title" className="text-lg font-extrabold">
        {title}
      </h2>
      <p className="mt-2 text-sm font-bold text-muted">{body}</p>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" data-testid="ask-spend-no" onClick={() => onAnswer(false)} className="text-sm font-extrabold text-sky underline underline-offset-2">
          {no}
        </button>
        <Button data-testid="ask-spend-yes" onClick={() => onAnswer(true)}>
          {yes}
        </Button>
      </div>
    </dialog>
  )
}

/** The thread a code holds on the worker, with each one-state road-law answer's sources line rebuilt from that state's corpus. */
function useCloudHistory(code: string | null, lawsFor: AskProps['lawsFor']): AskThreadEntry[] {
  const [entries, setEntries] = useState<AskThreadEntry[]>([])
  useEffect(() => {
    if (code === null) return
    let live = true
    void (async () => {
      const rows = await fetchQuestionHistory(code)
      if (!live || rows === null || rows === 'unknown') return
      const states = [...new Set(rows.filter(rebuildable).map((row) => row.state as string))]
      const located = new Map<string, Map<string, string>>()
      for (const state of states) {
        try {
          const laws = (await lawsFor?.(state)) ?? []
          located.set(
            state,
            new Map(laws.flatMap((law) => {
              const manual = law.citations?.find((citation) => citation.source.startsWith('manual:'))
              return manual === undefined ? [] : [[law.id, manual.location] as const]
            })),
          )
        } catch {
          // A corpus that will not load costs its answers their line, not the history.
        }
      }
      if (live) setEntries(fromHistory(rows, (state, id) => located.get(state)?.get(id) ?? null))
    })()
    return () => {
      live = false
    }
  }, [code, lawsFor])
  return entries
}

/**
 * The question code this browser holds and what it has left, and the way
 * back from Stripe Checkout.
 *
 * On a load carrying `?session=`, the code that session paid for is claimed
 * -- asked again for a few seconds while the webhook lands -- stored, and
 * said; the session is then taken back out of the address, and only then, so
 * a claim that did not land can be asked again by reloading. **The question restored beside it is not sent**
 * (guard 28b): a question sent while its asker is still finding the page is
 * a token spent unseen. Otherwise a held code's balance is read once, so the
 * line under the tick is the worker's figure rather than a remembered one.
 */
function useTokens(): {
  code: string | null
  left: number | null
  notice: 'ready' | 'pending' | 'restored' | null
  setLeft: (left: number) => void
  adopt: (code: string, left: number, notice: 'ready' | 'restored') => void
} {
  const [code, setCode] = useState<string | null>(() => storedQuestionCode())
  const [left, setLeft] = useState<number | null>(null)
  const [notice, setNotice] = useState<'ready' | 'pending' | 'restored' | null>(null)
  const adopt = (found: string, balance: number, said: 'ready' | 'restored') => {
    saveQuestionCode(found)
    setCode(found)
    setLeft(balance)
    setNotice(said)
  }
  useEffect(() => {
    // Read once and dropped, whichever way the asker came back.
    clearAskPending()
    let live = true
    const params = new URLSearchParams(window.location.search)
    const session = params.get('session')
    async function settle() {
      if (session !== null) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const claimed = await claimQuestions(session)
          if (!live) return
          if (claimed !== null && claimed !== 'pending') {
            adopt(claimed.code, claimed.left, 'ready')
            // Only now: a session taken out of the address before the claim
            // landed leaves "reload in a minute" with nothing to reload.
            params.delete('session')
            const rest = params.toString()
            window.history.replaceState(null, '', `${window.location.pathname}${rest === '' ? '' : `?${rest}`}${window.location.hash}`)
            return
          }
          if (claimed === null) break
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
        if (live) setNotice('pending')
        return
      }
      const held = storedQuestionCode()
      if (held === null) return
      const found = await fetchQuestionBalance(held)
      if (live && found !== null && found !== 'unknown') setLeft(found.left)
    }
    void settle()
    return () => {
      live = false
    }
  }, [])
  return { code, left, notice, setLeft, adopt }
}
