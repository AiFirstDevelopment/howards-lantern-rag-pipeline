/**
 * The questions no section of a code answers, in six families
 * (docs/plans/what-happens-if.md, phase 3, decision 14): how soon a failed
 * test can be taken again, how long a permit is held, what a ticket means.
 * The code states duties and penalties; these are the licensing agency's and
 * the court's own process, written on their own pages, and a learner asks
 * them more than any rule of the road.
 *
 * One list, read by the rephraser (which names the family a question is in),
 * by the store lookup that adds a family's rows to the pool by key, and by
 * `npm run process:fetch` (which stores each family's passages under its
 * question) -- so the name the rephraser says is the name the rows carry.
 */
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

export type ProcessFamily = (typeof PROCESS_FAMILIES)[number]['id']

export const PROCESS_FAMILY_IDS: readonly ProcessFamily[] = PROCESS_FAMILIES.map((family) => family.id)

export function isProcessFamily(value: unknown): value is ProcessFamily {
  return typeof value === 'string' && (PROCESS_FAMILY_IDS as readonly string[]).includes(value)
}

/** A row of a state's own page: `XX-R-<family>-<n>`, the id `process:fetch` gives it. */
export function processId(state: string, family: ProcessFamily, n: number): string {
  return `${state}-R-${family}-${n}`
}

/**
 * Whether an id is a row of a state's own page rather than its manual or
 * code. The nationwide index path drops these before it keeps a state's best
 * two: a comparison of the states' rules quoting one state's retake page is
 * the plan's non-goal, and the page would have taken that state's slot.
 */
export function isProcessId(id: string): boolean {
  return /^[A-Z]{2}-R-/.test(id)
}
