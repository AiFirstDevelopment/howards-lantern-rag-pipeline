/**
 * The eval's model calls as one Message Batch, at half the price.
 *
 * Each case runs the worker's own `answerLearner`, with an asker that parks the
 * request instead of sending it. When every case has parked its request or
 * finished without one, the parked requests go up as one batch, and each case
 * resumes with its own result. The work before the model -- the rephraser, the
 * index, the reranker, the chooser -- stays live and is gated to a few cases at
 * a time, because three concurrent callers once made the REST embedding
 * endpoint answer null for everyone.
 *
 * Why: the whole eval is 130 live Opus calls, about ten dollars, and on
 * 2026-10-10 it was run five times in a day between a session and two
 * builders. A batch is the same request (`learnerRequestFor`, the worker's
 * own) and the same reading of the answer (`learnerReplyFrom`), billed at
 * half, with the cases no longer waiting on one another.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { learnerReplyFrom, learnerRequestFor, type LearnerAskRequest, type LearnerReply } from '../worker/src/learner-ask'

export type BatchClient = Pick<Anthropic['messages']['batches'], 'create' | 'retrieve' | 'results'>

interface Parked {
  id: string
  request: LearnerAskRequest
  resolve: (reply: LearnerReply) => void
}

export class BatchedAsks {
  private readonly parked: Parked[] = []
  private readonly waiting: (() => void)[] = []
  private readonly whenSettled: (() => void)[] = []
  private running = 0
  private settled = 0

  constructor(
    private readonly client: BatchClient,
    /** How many cases do their pre-model work at once. */
    private readonly width = 3,
    private readonly pollMs = 10_000,
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  /**
   * Runs one case. `work` gets an asker that parks the request and resolves
   * with the batch's result for it; the case holds one of `width` slots until
   * it parks or finishes, so the slots gate the live work and not the wait.
   */
  async run<T>(id: string, work: (ask: (request: LearnerAskRequest) => Promise<LearnerReply>) => Promise<T>): Promise<T> {
    await this.slot()
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.running -= 1
      this.settled += 1
      this.waiting.shift()?.()
      for (const wake of this.whenSettled.splice(0)) wake()
    }
    const ask = (request: LearnerAskRequest) =>
      new Promise<LearnerReply>((resolve) => {
        this.parked.push({ id, request, resolve })
        release()
      })
    try {
      return await work(ask)
    } finally {
      release()
    }
  }

  private async slot(): Promise<void> {
    while (this.running >= this.width) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running += 1
  }

  /** Resolves when `total` cases have each parked a request or finished without one. */
  async whenParked(total: number): Promise<void> {
    while (this.settled < total) await new Promise<void>((resolve) => this.whenSettled.push(resolve))
  }

  /** How many requests are parked, waiting for the batch. */
  get size(): number {
    return this.parked.length
  }

  /**
   * Sends every parked request as one batch, waits for it to end, and resumes
   * each case with its own result -- matched by id, because the batch returns
   * results in any order. A case whose result errored, expired or never came
   * back resumes as `unreachable`, which is what the live asker says when the
   * model could not be reached.
   */
  async submit(): Promise<{ id: string; sent: number; succeeded: number }> {
    const parked = this.parked.splice(0)
    if (parked.length === 0) return { id: '', sent: 0, succeeded: 0 }
    const batch = await this.client.create({
      requests: parked.map((each) => ({ custom_id: each.id, params: learnerRequestFor(each.request) })),
    })
    this.log(`batch ${batch.id}: ${parked.length} requests sent`)
    for (;;) {
      const state = await this.client.retrieve(batch.id)
      if (state.processing_status === 'ended') break
      this.log(`batch ${batch.id}: ${state.request_counts.processing} still processing`)
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
    const byId = new Map(parked.map((each) => [each.id, each]))
    let succeeded = 0
    for await (const item of await this.client.results(batch.id)) {
      const each = byId.get(item.custom_id)
      if (each === undefined) continue
      byId.delete(item.custom_id)
      if (item.result.type !== 'succeeded') {
        each.resolve({ kind: 'failed', model: 'unreachable' })
        continue
      }
      succeeded += 1
      try {
        each.resolve(learnerReplyFrom(item.result.message))
      } catch {
        each.resolve({ kind: 'failed', model: 'unreachable' })
      }
    }
    for (const each of byId.values()) each.resolve({ kind: 'failed', model: 'unreachable' })
    return { id: batch.id, sent: parked.length, succeeded }
  }
}
