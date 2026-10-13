/**
 * How many questions one browser may ask the box in a week (Joel, 2026-10-10:
 * a day's allowance at first, made weekly the same evening).
 *
 * A nationwide question reads a hundred laws and costs about four times a
 * state question; the worker's own ceiling (`LEARNER_DAILY_QUESTIONS`) is for
 * the whole site, so one visitor could spend most of it. This is a courtesy
 * limit kept in the browser: the visitor who clears their storage clears it,
 * and the worker's ceiling is the one that holds. Counted per local calendar
 * week, Monday to Sunday, so "on Monday" in the modal means what the
 * visitor's clock says.
 *
 * Reads and writes are wrapped, because private browsing and a full store
 * throw, and a box that cannot count must still send: the worker decides.
 */
export const ASK_WEEKLY_LIMITS = { state: 10, nationwide: 3 } as const

export type AskKind = keyof typeof ASK_WEEKLY_LIMITS

/** storage.ts's `KEY_PREFIX`, so the count files with the rest of the app's keys. */
export const ASK_QUOTA_KEY = 'teach-and-test/v1/ask-quota'

interface Quota {
  week: string
  state: number
  nationwide: number
}

/** The local calendar week, named by its Monday as `YYYY-MM-DD`. */
export function localWeek(now = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay() counts from Sunday; a week here runs Monday to Sunday.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

function read(now?: Date): Quota {
  const blank: Quota = { week: localWeek(now), state: 0, nationwide: 0 }
  try {
    const raw = localStorage.getItem(ASK_QUOTA_KEY)
    if (raw === null) return blank
    const kept = JSON.parse(raw) as Partial<Quota>
    // A new week starts the count again; last week's numbers are not carried.
    if (kept.week !== blank.week) return blank
    return { week: blank.week, state: Number(kept.state) || 0, nationwide: Number(kept.nationwide) || 0 }
  } catch {
    return blank
  }
}

/**
 * Whole days until the week's count starts again -- next Monday, counted from
 * the start of today: 7 on a Monday, 1 on a Sunday. What the balance line
 * says beside the count, so "in 3 days" is the same Monday the pop-up names.
 */
export function daysUntilReset(now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return 7 - ((today.getDay() + 6) % 7)
}

/** How many questions of this kind the visitor may still send this week. */
export function asksLeft(kind: AskKind, now?: Date): number {
  return Math.max(0, ASK_WEEKLY_LIMITS[kind] - read(now)[kind])
}

/** One question of this kind was sent. */
export function recordAsk(kind: AskKind, now?: Date): void {
  const quota = read(now)
  quota[kind] += 1
  try {
    localStorage.setItem(ASK_QUOTA_KEY, JSON.stringify(quota))
  } catch {
    // Private mode or a full store: uncounted here, still counted by the worker.
  }
}
