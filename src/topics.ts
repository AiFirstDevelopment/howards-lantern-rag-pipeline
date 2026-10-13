import topics from '../resource/statutes/topics.json'

/**
 * The topics every state's law has been compared on (docs/plans/nationwide.md),
 * for the one thing the app does with them: a search visitor who lands on
 * `/drivers/laws/<topic>/` arrives with that topic's question already in the
 * box. Bundled rather than fetched, because the question has to be in the input
 * when the page opens, and 35 short lines cost less than the request.
 */
export const TOPICS: readonly { id: string; question: string; title: string }[] = topics

/** What a ticked Nationwide box sends as the state; worker/src/learner-ask.ts `NATIONWIDE` reads it. */
export const NATIONWIDE = 'US'

/** The page listing every topic; the worker's no-topic refusal links it (`COMPARED_PAGE` there). */
export const COMPARED_PAGE = '/drivers/laws/'

export function topicQuestion(id: string): string | null {
  return TOPICS.find((topic) => topic.id === id)?.question ?? null
}
