/**
 * A court's schedule row, and the law the model is given for it
 * (docs/plans/what-happens-if.md, phase 2). Its own module, importing
 * nothing that speaks D1: scripts/state-chips-files.ts turns committed rows
 * into the laws a stored state chip cites, and the Vite config and the
 * prerender read that file under a tsconfig without Workers types.
 * worker/src/law-nationwide.ts re-exports all of it.
 */
import type { AskLaw } from './law-retrieval'

/**
 * One row of a state's fine schedule, as `npm run penalties:fetch` writes it
 * into the `penalties` table (docs/plans/what-happens-if.md, phase 2, decision
 * 9). The code says what a driver must do and, at most, the range a fine may
 * fall in; what a learner actually pays, whether they can pay it without
 * going to court, and the points are the court's schedule -- Maryland's
 * DC-CR-090 says "16 112 c … $ 50.00 00" for not showing a license, a figure
 * no section of the Transportation Article states. `section` is the key the
 * `laws` table's statute rows carry (`sectionOf`), so the schedule joins the
 * section retrieval already found; `code` is the schedule's own reference,
 * "16-112(c)", which the id is made from.
 */
export interface PenaltyRow {
  id: string
  state: string
  section: string
  code: string
  offence: string
  fine_text: string
  fine_min_cents: number | null
  fine_max_cents: number | null
  points: number | null
  appear: 'payable' | 'must-appear' | 'court-sets'
  source_url: string
  source_title: string
  as_of: string
  quote: string
}

/** Cents as a learner reads a price: "$50", "$25.50", "$1,000". */
export function dollars(cents: number): string {
  const whole = Math.floor(cents / 100)
  const rest = cents % 100
  return `$${whole.toLocaleString('en-US')}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`
}

function pointsPhrase(points: number | null): string {
  if (points === null) return ''
  return points === 0 ? ', no points' : `, ${points} point${points === 1 ? '' : 's'}`
}

/**
 * The law a schedule row is given to the model as: one sentence a learner can
 * read, stating the figure, whether it can be paid without going to court and
 * the points. A row the court sets names the range and the words "set by the
 * court", never the low figure alone: "$25" for an offence a court may fine
 * $200 is a promise the schedule does not make. Points only where the row has
 * them -- a null says nothing, because "no points" from a source that does not
 * list points would be invented.
 */
export function penaltySentence(row: Pick<PenaltyRow, 'offence' | 'appear' | 'fine_text' | 'fine_min_cents' | 'fine_max_cents' | 'points'>): string {
  const points = pointsPhrase(row.points)
  const { fine_min_cents: min, fine_max_cents: max } = row
  if (row.appear === 'must-appear') return `${row.offence}: you must go to court, and the court sets the fine${points}.`
  if (row.appear === 'court-sets') {
    const range =
      min !== null && max !== null
        ? `within ${dollars(min)} to ${dollars(max)}`
        : max !== null
          ? `of up to ${dollars(max)}`
          : min !== null
            ? `of at least ${dollars(min)}`
            : 'in an amount the law leaves to it'
    return `${row.offence}: a fine set by the court ${range}${points}.`
  }
  const fine = min === null ? row.fine_text : max === null || max === min ? dollars(min) : `${dollars(min)} to ${dollars(max)}`
  return `${row.offence}: ${fine}, can be paid without going to court${points}.`
}

/**
 * A schedule row as a law the model is given and the checker grounds: the
 * sentence above, and a citation in the statute's shape, "<source> — '<the
 * schedule's own line>'", so the figure is grounded on the line it came from
 * and the box shows the schedule and its date beneath the answer.
 */
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
