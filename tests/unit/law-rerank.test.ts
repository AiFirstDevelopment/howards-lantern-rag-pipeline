import { describe, expect, it } from 'vitest'
import { HAIKU_RERANK_MODEL, RERANK_MODEL, firstOf, haikuRerankFor, rerankFor, type HaikuClient } from '../../worker/src/law-rerank'

/**
 * Workers AI answers a rerank best first, each result carrying the index of
 * the text it scored -- not in the order the texts were sent. A score put back
 * on the wrong law would give the model a law the reranker ranked last, and
 * nothing on screen would say so (docs/plans/rerank.md, guard 4).
 */
describe('the deployed reranker, as the worker calls it', () => {
  it('puts each score back on the text it was given for, whatever order the model answers in', async () => {
    const sent: unknown[] = []
    const ai = {
      run: async (model: string, input: unknown) => {
        sent.push({ model, input })
        return { response: [{ id: 2, score: 0.9 }, { id: 0, score: 0.5 }, { id: 1, score: 0.1 }] }
      },
    } as unknown as Ai
    const scores = await rerankFor(ai)!('how far from a hydrant?', ['a', 'b', 'c'])
    expect(scores).toEqual([0.5, 0.1, 0.9])
    expect(sent).toEqual([
      { model: RERANK_MODEL, input: { query: 'how far from a hydrant?', contexts: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], top_k: 3 } },
    ])
  })
})

/** A client that answers every call with `reply` and keeps what it was sent. */
function haikuAnswering(reply: string, sent: unknown[] = []): HaikuClient {
  return { messages: { create: async (body: unknown) => (sent.push(body), { content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }) } } as unknown as HaikuClient
}

/**
 * Haiku reads the question beside every candidate law and names the ones that
 * answer, best first. The cross-encoder scored each law by likeness alone and
 * gave Nevada's side-window tint question the windshield strip; Haiku's order
 * is what the model must get, and a law it leaves out must stay out.
 */
describe('Haiku as the reranker', () => {
  it('scores the laws it names in its order, leaves the rest unranked, and is shown every law numbered', async () => {
    const sent: unknown[] = []
    const scores = await haikuRerankFor(undefined, haikuAnswering('{"ranked":[2,0]}', sent))!('how dark can my side windows be?', ['windshield strip', 'rear window', 'side window: 35 percent'])
    expect(scores).toEqual([4, Number.NEGATIVE_INFINITY, 5])
    const body = sent[0] as { model: string; messages: { content: string }[] }
    expect(body.model).toBe(HAIKU_RERANK_MODEL)
    expect(body.messages[0].content).toContain('[2] side window: 35 percent')
  })

  it('refuses an answer naming a law it was not given, so the caller falls back', async () => {
    await expect(haikuRerankFor(undefined, haikuAnswering('{"ranked":[7]}'))!('q', ['a', 'b'])).rejects.toThrow()
    await expect(haikuRerankFor(undefined, haikuAnswering('not json'))!('q', ['a', 'b'])).rejects.toThrow()
  })

  it('falls back to the cross-encoder when Haiku does not answer, and is absent with neither', async () => {
    const down: HaikuClient = { messages: { create: async () => { throw new Error('overloaded') } } } as unknown as HaikuClient
    const ai = { run: async () => ({ response: [{ id: 0, score: 0.2 }, { id: 1, score: 0.8 }] }) } as unknown as Ai
    expect(await firstOf(haikuRerankFor(undefined, down), rerankFor(ai))!('q', ['a', 'b'])).toEqual([0.2, 0.8])
    expect(firstOf(haikuRerankFor(undefined), rerankFor(undefined))).toBeUndefined()
  })
  // The verifier's case (eval-lifecycle phase 1): Haiku naming a law it was
  // not given was billed, the cross-encoder answered instead, and the turn's
  // tokens left Haiku's out -- so a day's cost read low exactly on the turns
  // where something went wrong.
  it('carries what a Haiku call that could not be read spent onto the cross-encoder’s answer', async () => {
    const billed = {
      messages: {
        create: async () => ({ content: [{ type: 'text', text: '{"ranked":[7]}' }], stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 9 } }),
      },
    } as unknown as HaikuClient
    const ai = { run: async () => ({ response: [{ id: 0, score: 0.2 }, { id: 1, score: 0.8 }] }) } as unknown as Ai
    const scores = await firstOf(haikuRerankFor(undefined, billed), rerankFor(ai))!('q', ['a', 'b'])
    expect([...scores]).toEqual([0.2, 0.8])
    expect(scores.usage).toEqual({ input: 300, output: 9 })
  })
})
