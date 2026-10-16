import type Anthropic from '@anthropic-ai/sdk'

/**
 * The tokens one model call spent, as the API counted them
 * (docs/plans/eval-lifecycle-build.md, decision 4). Measured rather than
 * estimated: a day's cost read off a guess at the prompt's length is a figure
 * nobody can check.
 *
 * `input` is every input token the call was billed for -- fresh, written to
 * the cache and read from it -- because the learner box's book is a cached
 * prefix, and `input_tokens` alone counts a few hundred tokens for a prompt of
 * thousands. The price of each kind is the cost script's business; the count
 * is this one's.
 */
export interface Usage {
  input: number
  output: number
}

/** A call's usage from the SDK's message, or nothing when the message carries none (a test's stub). */
export function usageOf(response: Pick<Anthropic.Message, 'usage'> | { usage?: undefined }): Usage | undefined {
  const usage = response.usage
  if (usage === undefined || usage === null) return undefined
  return {
    input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  }
}

/**
 * `error` with the call's usage on it, for a reply that came back and could
 * not be read: the call was billed though nothing came of it, and a turn whose
 * reranker named laws it was not given still cost its tokens.
 */
export function carryingUsage(error: unknown, response: Pick<Anthropic.Message, 'usage'>): unknown {
  const usage = usageOf(response)
  if (usage !== undefined && typeof error === 'object' && error !== null) Object.assign(error, { usage })
  return error
}

/** The usage a thrown error carries (`carryingUsage`), if any. */
export function usageCarried(error: unknown): Usage | undefined {
  const usage = typeof error === 'object' && error !== null ? (error as { usage?: unknown }).usage : undefined
  return typeof usage === 'object' && usage !== null && typeof (usage as Usage).input === 'number' ? (usage as Usage) : undefined
}

/** A running sum of the calls one question made. */
export class Meter {
  input = 0
  output = 0
  add(usage: Usage | undefined): void {
    if (usage === undefined) return
    this.input += usage.input
    this.output += usage.output
  }
  get usage(): Usage {
    return { input: this.input, output: this.output }
  }
}
