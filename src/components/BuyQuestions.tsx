import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import { useStrings } from '../language'
import { PACKS, priceLabel, type Pack } from '../pricing'

interface BuyQuestionsProps {
  /**
   * The week's limit that opened it, as #774's modal said it: its title and
   * its one line. Null when the balance line was tapped, and then the pop-up
   * is an offer rather than a stop, under a title of its own.
   */
  limit: { title: string; body: string } | null
  /** A pack's button. Resolves only when the page did not leave for Checkout. */
  onBuy: (pack: Pack) => Promise<'unavailable' | 'trouble'>
  /** "I have a code": resolves with why not, or nothing when the code is on this device now. */
  onCode: (code: string) => Promise<'unknown' | 'trouble' | null>
  onClose: () => void
}

/**
 * The purchase pop-up (docs/plans/trusted-by-date.md, decision 25): #774's
 * limit modal, grown. Over the ask page and never instead of it -- the
 * thread, the Nationwide tick and the question in the input are all still
 * there underneath, and *Not now* closes it onto them. Only a pack's button
 * leaves the page, and the page writes down what it was holding first.
 *
 * Every price is read from src/pricing.ts, the file the margin test holds
 * and the worker credits by: a figure typed here could disagree with what
 * the webhook gives for the money, and nothing would notice until a buyer did.
 *
 * Keeps #774's test ids on the dialog, its body line and its close, because
 * the free path is unchanged and its tests read them.
 */
export default function BuyQuestions({ limit, onBuy, onCode, onClose }: BuyQuestionsProps) {
  const t = useStrings()
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<'unavailable' | 'trouble' | null>(null)
  const [typing, setTyping] = useState(false)
  const [code, setCode] = useState('')
  const [codeProblem, setCodeProblem] = useState<'unknown' | 'trouble' | null>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      data-testid="ask-limit-dialog"
      aria-labelledby="ask-limit-title"
      // Escape closes a dialog without asking React; this keeps the two agreeing.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="mx-auto mt-[8vh] w-[calc(100%-2rem)] max-w-md rounded-3xl border-2 border-line bg-paper p-5 text-ink backdrop:bg-ink/40"
    >
      <div data-testid="buy-questions">
        <h2 id="ask-limit-title" className="text-lg font-extrabold">
          {limit?.title ?? t.ask.buyTitle}
        </h2>
        {limit !== null && (
          <p className="mt-2 text-sm font-bold text-muted" data-testid="ask-limit-body">
            {limit.body}
          </p>
        )}
        <p className="mt-3 text-sm font-bold text-ink" data-testid="buy-token-is">
          {t.ask.tokenIs}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {PACKS.map((pack) => (
            <li key={pack.dollars}>
              <button
                type="button"
                data-testid="buy-pack"
                data-pack={pack.dollars}
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setProblem(null)
                  setProblem(await onBuy(pack))
                  setBusy(false)
                }}
                className="min-h-12 w-full rounded-2xl border-2 border-line bg-paper px-4 text-left font-extrabold disabled:opacity-40"
              >
                {t.ask.buyPack(pack.tokens, priceLabel(pack))}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-bold text-muted" data-testid="buy-dollar-pack">
          {t.ask.dollarPack}
        </p>
        <p className="mt-1 text-xs font-bold text-muted" data-testid="buy-classroom">
          {t.ask.classroom}
        </p>
        {problem !== null && (
          <p className="mt-3 text-sm font-extrabold text-danger" data-testid={problem === 'unavailable' ? 'buy-unavailable' : 'buy-trouble'}>
            {problem === 'unavailable' ? t.ask.notForSale : t.ask.checkoutTrouble}
          </p>
        )}

        {typing ? (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              setBusy(true)
              setCodeProblem(await onCode(code))
              setBusy(false)
            }}
          >
            <label className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
              {t.ask.codeLabel}
              <input
                data-testid="question-code-input"
                value={code}
                autoComplete="off"
                maxLength={40}
                onChange={(event) => setCode(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-2xl border-2 border-line bg-paper px-4 text-base font-bold normal-case tracking-normal"
              />
            </label>
            <button
              type="submit"
              data-testid="question-code-submit"
              disabled={busy || code.trim().length === 0}
              className="min-h-12 rounded-2xl border-2 border-line bg-ink px-4 font-extrabold text-paper disabled:opacity-40"
            >
              {t.ask.codeSubmit}
            </button>
            {codeProblem !== null && (
              <p className="text-sm font-extrabold text-danger" data-testid="question-code-error">
                {codeProblem === 'unknown' ? t.ask.codeUnknown : t.ask.codeTrouble}
              </p>
            )}
          </form>
        ) : (
          <button
            type="button"
            data-testid="buy-have-code"
            onClick={() => setTyping(true)}
            className="mt-4 text-sm font-extrabold text-sky underline underline-offset-2"
          >
            {t.ask.haveCode}
          </button>
        )}

        <div className="mt-4 flex justify-end">
          <Button data-testid="ask-limit-close" onClick={onClose}>
            {t.ask.notNow}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
