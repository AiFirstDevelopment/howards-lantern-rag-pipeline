import type { ReactNode } from 'react'
import { useStrings } from '../language'
import { useMenu } from '../menu'
import { usePlace } from '../place'
import { useReadAloud } from '../read-aloud'
import { brandedPartnerName } from '../referral'
import { currentSiteLabel } from '../site'
import { useStatus } from '../status'
import SiteFooter from './SiteFooter'
import TopBar from './TopBar'

interface ScreenProps {
  children: ReactNode
  /**
   * Spend a desktop's whole width, less its margins, rather than the phone
   * column. Only the front pages ask for it: on a wide screen they sat in a
   * strip down the middle with most of the window empty either side, while a
   * study card or a test question reads best at a line length a phone sets.
   */
  wide?: boolean
  /**
   * Draw the site footer -- Terms, Privacy, FAQ, About, Contact -- below
   * everything else. Only the screens where somebody is choosing or reading
   * ask for it; a learner mid-card does not need the terms, and the study
   * screen's footer is held to its two buttons (docs/plans/trust-signals.md).
   */
  siteFooter?: boolean
}

/**
 * The menu button: small, in the corner, and the only chrome this app has.
 *
 * A real button with a label, because an icon on its own is unreachable to a
 * screen reader and a div with an onClick is unreachable to everything but a
 * mouse. 44px square, which is the smallest a thumb can be asked to hit.
 */
function MenuButton({ onClick }: { onClick: () => void }) {
  const t = useStrings()
  return (
    <button
      type="button"
      aria-label={t.chrome.menu}
      data-testid="menu-trigger"
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-line bg-paper text-muted active:translate-y-px"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor">
        <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/**
 * The way to ask a question, from whatever screen prompted it.
 *
 * Beside the menu button rather than only behind it: a learner wondering
 * mid-card whether they need an account, or what happens if they fail, should
 * not have to find a footer or a drawer to ask. It was the feedback button
 * until the ask box shipped; feedback is on the front of the menu, and the ask
 * page links to it for a bad card.
 *
 * **It says what it is.** It shipped as a bare speech bubble with the words in
 * an `aria-label`, and the first person to see it on a phone asked where "Ask
 * a question" had gone -- a bubble beside a hamburger reads as chat, feedback
 * or nothing in particular. So the words are on the button. On the narrowest
 * phones only "Ask" fits beside the state's name; from 360px the whole phrase
 * does. The accessible name is the whole phrase at every width.
 */
function AskButton({ onClick }: { onClick: () => void }) {
  const t = useStrings()
  return (
    <button
      type="button"
      aria-label={t.ask.title}
      data-testid="ask-trigger"
      onClick={onClick}
      // The speech toggle's "on" colours, so it is the one coloured control in
      // the row: grey, it read as chrome nobody needed (docs/plans/vehicle-code.md).
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border-2 border-brand bg-brand-soft px-3 text-xs font-extrabold text-brand-dark active:translate-y-px"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor">
        <path
          d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      </svg>
      <span data-testid="ask-trigger-label" className="whitespace-nowrap">
        {t.ask.short}
        <span className="hidden min-[360px]:inline">{t.ask.rest}</span>
      </span>
    </button>
  )
}

/**
 * The read-aloud switch.
 *
 * A standing decision -- read everything from here on -- which is why it is up
 * here in the chrome rather than beside the words. The replay button is the
 * other half and lives in the body, next to what it repeats.
 *
 * `aria-pressed` rather than a label that changes, so its state is unambiguous
 * to anyone reading it through assistive tech -- who is also, deliberately, the
 * person least likely to want it: it defaults off, and a screen reader user
 * meets it only as a control they can ignore.
 *
 * It takes the empty left column of the header grid. That column exists to
 * balance the menu button so the site name centers in the row, and it is
 * already exactly a button wide, so this costs no height and moves nothing.
 */
function SpeechToggle({
  on,
  onToggle,
  disabled = false,
}: {
  on: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  const t = useStrings()
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      aria-label={t.chrome.readAloud}
      data-testid="speech-toggle"
      onClick={onToggle}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 active:translate-y-px disabled:opacity-40 ${
        on ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-paper text-muted'
      }`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor">
        <path
          d="M4 9v6h4l5 4V5L8 9H4z"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* The waves are the only thing that changes with the state, so the
            icon reads as on or off at a glance rather than by its color
            alone -- which is the same reason the border changes too. */}
        {on && (
          <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeWidth="2.2" strokeLinecap="round" />
        )}
      </svg>
    </button>
  )
}

/**
 * Single-column page shell: mobile-first, capped width on larger screens.
 *
 * Four things in the header, each with its own rule.
 *
 * The state being studied is the line a learner actually reads, so it is the
 * larger of the two. It exists because the state list is reachable again: a
 * learner who goes back and picks somewhere else has no other way to confirm
 * they landed where they meant to, and a wrong state is not visible in the
 * material -- most of the cards read the same in all four. Absent on the state
 * list, where the picker below is already the answer, and on the overlays,
 * where it is chrome like the rest of it. See src/place.ts.
 *
 * The site name is on every screen, including the overlays, because it is the
 * one cue that explains something otherwise inexplicable: the app runs under
 * two names, each its own origin, so two people can be looking at the same app
 * with entirely different progress. Null on localhost and on previews, where a
 * label would be noise or a lie. It drops to a caption under the state name
 * rather than off the screen: it is read when somebody is confused about their
 * progress, which is rarely, and the state is read at a glance, which is
 * always. Two lines of that size still fit the row the menu button already
 * sets, so the whole thing costs no height at all.
 *
 * The progress bar is absent wherever there is no progress to report -- the
 * state list, and every overlay.
 *
 * The menu button is absent only while an overlay is open, and is present on
 * the state list on purpose: somebody deciding whether to use this at all
 * should be able to read the privacy page before picking a state.
 *
 * The name shares the menu button's row rather than taking one of its own,
 * which on the state list costs no height at all -- that row is otherwise
 * empty on the left, and that screen has the least room to give.
 */
export default function Screen({ children, wide = false, siteFooter = false }: ScreenProps) {
  const status = useStatus()
  const menu = useMenu()
  const speech = useReadAloud()
  const t = useStrings()
  // The one call every screen's header is drawn from, which is why one
  // substitution point covers the whole app: a learner sent by a partner who
  // asked to be named sees that name wherever ours would have been. Read from
  // this browser's stored referral rather than from a request, so it is right on
  // the first paint instead of flipping once a quote comes back.
  const site = currentSiteLabel(brandedPartnerName())
  const place = usePlace()
  const header = site !== null || place !== null || status !== null || menu !== null
  const ask = menu?.ask ?? null
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-5 ${
        wide ? 'lg:max-w-none lg:px-12' : ''
      }`}
    >
      {header && (
        <div
          // Tighter where the chrome is one row rather than two. The 20px is
          // the gap under a header that ends in a progress bar; an overlay's
          // header is a single line of text, and 20px under it is a hole. The
          // 8px this returns goes to the overlays, which are the longest
          // screens in the app -- see tests/e2e/feedback.spec.ts.
          className={`${status !== null ? 'mb-5' : 'mb-3'} flex flex-col gap-2`}
        >
          {(site !== null || place !== null || menu !== null) && (
            // Three columns: the controls on either side take the width they
            // need, and the name gets what is left, centered in it.
            //
            // Centering the name across the whole row and floating the buttons
            // over it was tried and is wrong: at 375px the long name clears
            // the button by 13px, and at 320px it runs 34px underneath it.
            // Padding cannot fix that, because padding is a guess about how
            // wide the text will be. A grid cannot overlap: on a screen too
            // narrow to hold the name, it ellipses instead, which is the right
            // failure.
            //
            // The outer columns used to be equal, so the name sat at the exact
            // center of the row. That was given up the day the ask button got
            // its words: a labelled button on the right is wider than the
            // speech toggle on the left, and mirroring it would cost the name
            // the room it needs on a phone. A name a few pixels left of center
            // reads as centered; a name truncated to make room for an empty
            // column does not.
            <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              {speech !== null && (speech.available || speech.blocked) ? (
                <SpeechToggle on={speech.on} onToggle={speech.toggle} disabled={speech.blocked} />
              ) : (
                <span aria-hidden />
              )}
              {site !== null || place !== null ? (
                <span className="flex min-w-0 flex-col items-center leading-tight">
                  {place !== null && (
                    <span
                      data-testid="state-name"
                      className="max-w-full truncate text-sm font-extrabold tracking-tight text-ink sm:text-base"
                    >
                      {place}
                    </span>
                  )}
                  {site !== null && (
                    <span
                      data-testid="site-name"
                      className={
                        place === null
                          ? 'max-w-full truncate text-sm font-extrabold tracking-tight text-ink sm:text-base'
                          : // Not uppercased. The capitals in HowardsLantern.com
                            // are a deliberate rendering of a name browsers only
                            // ever store in lower case, and a CSS transform here
                            // would throw away the one thing that makes it read
                            // as a name rather than as a hostname.
                            'max-w-full truncate text-[11px] font-bold tracking-tight text-muted'
                      }
                    >
                      {site}
                    </span>
                  )}
                </span>
              ) : (
                <span aria-hidden />
              )}
              {menu !== null ? (
                <span className="flex justify-end gap-1">
                  {ask !== null && <AskButton onClick={ask} />}
                  <MenuButton onClick={menu.open} />
                </span>
              ) : (
                <span aria-hidden />
              )}
            </div>
          )}
          {speech?.blocked === true && (
            <p data-testid="speech-unavailable" className="text-xs font-bold text-muted">
              {t.chrome.speechUnavailable}
            </p>
          )}
          {status !== null && <TopBar {...status} />}
        </div>
      )}
      {children}
      {siteFooter && <SiteFooter />}
    </div>
  )
}
