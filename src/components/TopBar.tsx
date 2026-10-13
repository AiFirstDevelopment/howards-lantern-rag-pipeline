import { useStrings } from '../language'
import ProgressBar from './ProgressBar'
import LevelMeter from './LevelMeter'
import CourseToggle, { type CourseToggleProps } from './CourseToggle'

export interface TopBarProps {
  /**
   * The bar, and the four fields that travel together to draw it.
   *
   * Optional, because a bar means one thing: a position in something finite
   * that the learner is meant to finish. The study pass, a test, a checkpoint
   * and the restudy walk are all that; the hub, the results, the offer and the
   * receipt are not, and giving them a bar was a defect rather than a
   * decoration. It reported mastery over the whole question pool, so a learner
   * holding every level was shown a bar sixteen percent full, against a
   * denominator they had never been told about, that shrinks on its own as
   * mastery lapses. See the note on `status` in App.tsx.
   *
   * `max` is what decides it: absent, and the row is not drawn at all.
   */
  /** What the bar is measuring on this screen, e.g. "concepts". */
  label?: string
  /** The number shown beside the bar — 1-based for a position, absolute for a total. */
  count?: number
  /** How full the bar is; separate from `count` so a 1-based position still starts empty. */
  value?: number
  max?: number
  /** Null where the screen body shows the level itself, so it is never drawn twice. */
  level: number | null
  /** Names the rule wherever the sockets appear, e.g. "1 of 2 in a row". */
  caption?: string
  /**
   * A second bar under the first, on a screen that reports two scopes at once.
   *
   * The same `ProgressBar`, drawn identically on purpose. Two bars styled
   * differently would say they measure different kinds of thing; these measure
   * the same thing -- laws of this state taught, out of laws to teach -- at
   * two scopes, and the labels are what tells them apart. Without the label it
   * reads as a contradiction: at a checkpoint the section bar is full green,
   * because a checkpoint IS a finished section, while this one is a sliver.
   *
   * It is a button, and has to look like one, because it is how the section
   * map is opened. A bare track reads as an indicator and nobody presses it.
   */
  second?: {
    label: string
    count: number
    max: number
    onOpen: () => void
  }
  /**
   * The other course, offered from the chrome of every pass screen -- or
   * absent, which hides it.
   *
   * Present exactly when the reducer would accept the switch (`canTakeCourse`,
   * asked by the shell), so it is absent rather than disabled mid-test, on a
   * walk and on a result. It sat only in Settings until 2026-09-24, where an
   * unpaid learner on the first card had no sign the course existed; it is
   * here because the first card is where the choice is worth making.
   *
   * Both courses, full width and bordered like the pass bar, because it is
   * pressed: a label beside a section heading reads as more heading.
   */
  course?: Omit<CourseToggleProps, 'testId'>
  /**
   * Stepping back and forth over material already covered. Absent on every
   * screen that is not a walk through the pass, which is why the arrows are
   * optional rather than disabled: a screen with nothing to step through
   * should not show a control at all.
   */
  onPrevious?: () => void
  onNext?: () => void
  canPrevious?: boolean
  canNext?: boolean
}

/**
 * One step back or forward through the pass.
 *
 * Disabled rather than hidden at the ends, because a control that disappears
 * at the first card and reappears at the second moves the bar under the
 * learner's thumb between one card and the next.
 */
function Step({
  direction,
  onClick,
  enabled,
}: {
  direction: 'previous' | 'next'
  onClick: () => void
  enabled: boolean
}) {
  const t = useStrings()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      data-testid={`step-${direction}`}
      aria-label={direction === 'previous' ? t.chrome.previousConcept : t.chrome.nextConcept}
      className="-my-2 shrink-0 rounded-full px-2 py-2 text-lg font-black text-muted transition-opacity disabled:opacity-25"
    >
      {direction === 'previous' ? '‹' : '›'}
    </button>
  )
}

/**
 * The single header every screen past the state list carries: one bar for
 * whatever is advancing here, and the certification sockets. Merged from what
 * were two separate headers, which on the study screen showed the same number
 * twice.
 */
export default function TopBar({
  label,
  count,
  value,
  max,
  level,
  caption,
  second,
  course,
  onPrevious,
  onNext,
  canPrevious = false,
  canNext = false,
}: TopBarProps) {
  const t = useStrings()
  return (
    <header>
      <div className="flex items-end justify-between gap-3">
        <span
          data-testid="status-label"
          className="text-[11px] font-extrabold uppercase tracking-widest text-muted"
        >
          {label ?? ''}
        </span>
        {level !== null && (
          <span className="flex flex-col items-end gap-1">
            {/* Named, so the sockets on the study screen mean something. */}
            {/* The rule, on every screen: levels come from runs back to back. */}
            <span
              data-testid="level-caption"
              className="text-[11px] font-extrabold uppercase tracking-widest text-muted"
            >
              {caption ?? (level > 0 ? t.levels[level - 1].name : t.levels[0].name)}
            </span>
            <LevelMeter level={level} testId="status-level" />
          </span>
        )}
      </div>
      {course !== undefined && (
        <div className="mt-2">
          <CourseToggle {...course} testId="chrome-course" />
        </div>
      )}
      {max !== undefined && (
        <div className="mt-2 flex items-center gap-2">
          {onPrevious !== undefined && (
            <Step direction="previous" onClick={onPrevious} enabled={canPrevious} />
          )}
          <ProgressBar value={value ?? 0} max={max} />
          {onNext !== undefined && <Step direction="next" onClick={onNext} enabled={canNext} />}
          <span
            data-testid="progress-counter"
            className="shrink-0 text-sm font-bold tabular-nums text-muted"
          >
            {t.chrome.of(count, max)}
          </span>
        </div>
      )}
      {second !== undefined && (
        <button
          type="button"
          data-testid="pass-progress"
          onClick={second.onOpen}
          aria-label={t.chrome.openMap(second.label, second.count, second.max)}
          className="mt-2 flex w-full items-center gap-2 rounded-2xl border-2 border-line bg-paper px-3 py-2 text-left active:translate-y-px"
        >
          <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-widest text-muted">
            {second.label}
          </span>
          <ProgressBar value={second.count} max={second.max} />
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted">
            {t.chrome.of(second.count, second.max)}
          </span>
          <span aria-hidden className="shrink-0 text-lg font-black text-muted">
            ›
          </span>
        </button>
      )}
    </header>
  )
}
