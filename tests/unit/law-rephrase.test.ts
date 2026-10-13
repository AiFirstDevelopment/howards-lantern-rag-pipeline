import { describe, expect, it } from 'vitest'
import { REPHRASE_MODEL, REPHRASE_RULES, REPHRASE_SEARCHES, haikuRephraseFor, type RephraseClient } from '../../worker/src/law-rephrase'
import { PROCESS_FAMILIES } from '../../worker/src/process-families'

/** A client that answers every call with `reply` and keeps what it was sent. */
function answering(reply: string, sent: unknown[] = []): RephraseClient {
  return {
    messages: { create: async (body: unknown) => (sent.push(body), { content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }) },
  } as unknown as RephraseClient
}

/**
 * Retrieval found nothing for "highest posted speed limit" because the law
 * says "maximum speed limit". The rephraser's searches are what retrieval runs
 * beside the question; a search it did not give, or one that is not a string,
 * would be searched for as if the learner had asked it.
 */
describe('Haiku as the rephraser', () => {
  it('returns the searches it is given, trimmed and capped, and asks for them with the question alone', async () => {
    const sent: unknown[] = []
    const searches = await haikuRephraseFor(undefined, answering('{"searches":["  maximum speed limit highway ","speed limit miles per hour","a third"]}', sent))!('what is the highest posted speed limit')
    expect(searches).toEqual(['maximum speed limit highway', 'speed limit miles per hour'])
    expect(searches.length).toBe(REPHRASE_SEARCHES)
    const body = sent[0] as { model: string; messages: { content: string }[] }
    expect(body.model).toBe(REPHRASE_MODEL)
    expect(body.messages).toEqual([{ role: 'user', content: 'what is the highest posted speed limit' }])
  })

  it('returns none for a question that is not road law, and throws on an answer it cannot read', async () => {
    expect(await haikuRephraseFor(undefined, answering('{"searches":[]}'))!('how much does the app cost')).toEqual([])
    await expect(haikuRephraseFor(undefined, answering('{"searches":[7]}'))!('q')).rejects.toThrow()
    await expect(haikuRephraseFor(undefined, answering('not json'))!('q')).rejects.toThrow()
  })

  // docs/plans/what-happens-if.md, decision 5: Texas's pool for "what happens
  // if I'm pulled over without my license" held no subsection of § 521.025,
  // because both searches were for the duty and none for what follows it.
  it('asks for a search for the penalty or defence beside the duty when the question asks what happens', async () => {
    const sent: unknown[] = []
    await haikuRephraseFor(undefined, answering('{"searches":[]}', sent))!('what happens if i drive without my license')
    expect((sent[0] as { system: string }).system).toBe(REPHRASE_RULES)
    expect(REPHRASE_RULES).toContain('When the question asks what happens, what if, will I, do I have to, or how much, write two searches: one for the duty, as a code states what a driver must or may not do')
    expect(REPHRASE_RULES).toContain('"defense to prosecution", "produces in court"')
  })

  // docs/plans/what-happens-if.md, phase 3, decision 16: "how soon can I
  // retake the test" is answered by the licensing agency's page, whose words
  // are not the learner's, so the rephraser names the family and the family's
  // rows are added by that name.
  it('names the process family it reads, from the six it is told what each covers, and none for a rule of the road', async () => {
    const sent: unknown[] = []
    const read = await haikuRephraseFor(undefined, answering('{"searches":["skills test re-examination waiting period"],"family":"test-and-retake"}', sent))!('how soon can i retake my road test')
    expect([...read]).toEqual(['skills test re-examination waiting period'])
    expect(read.family).toBe('test-and-retake')
    for (const family of PROCESS_FAMILIES) expect(REPHRASE_RULES).toContain(`- ${family.id}: ${family.covers}`)
    expect(REPHRASE_RULES).toContain('A rule of the road (where to park, how fast, who goes first) is "none"')
    expect((await haikuRephraseFor(undefined, answering('{"searches":["fire hydrant"],"family":"none"}'))!('how far from a hydrant')).family).toBeUndefined()
  })

  // A family the list does not hold would be looked up by a key no fetch
  // ever stored, and find nothing, silently.
  it('reads a family it was not offered as none', async () => {
    expect((await haikuRephraseFor(undefined, answering('{"searches":["retake"],"family":"retakes"}'))!('q')).family).toBeUndefined()
  })

  // #799: no state's code says "texting" -- Texas writes "electronic message",
  // Maryland "text message" -- and a search in the learner's word reached the
  // manual's one-line ban and never the section that holds the fine.
  it('searches for texting in the words the codes use for it, whatever word Haiku chose', async () => {
    const read = await haikuRephraseFor(undefined, answering('{"searches":["texting while driving fine","text message offense"],"family":"none"}'))!('what happens if i get caught texting')
    expect([...read]).toEqual(['electronic message text message while driving fine', 'text message offense'])
    const verb = await haikuRephraseFor(undefined, answering('{"searches":["text and drive penalty","texts while driving"],"family":"none"}'))!('what if i text and drive')
    expect([...verb]).toEqual(['electronic message text message and drive penalty', 'electronic message text message while driving'])
    expect(REPHRASE_RULES).toContain('a code never says "texting"')
  })

  // #799: "I don't have my license with me" read as "driving without a
  // license" searched for the unlicensed-driving offence, and Utah's and
  // Maryland's duty to carry it -- the section the fine schedule joins --
  // never reached the pool.
  it('tells Haiku that not having a license on you is the duty to carry it, not driving without one', () => {
    expect(REPHRASE_RULES).toContain('Not having your license with you ("I don\'t have it on me", "no llevo mi licencia") is the duty to have it in your possession and display it on demand, not driving without a license')
  })

  // #799: about one no-license question in four was read as ticket-procedure,
  // which put the court's "take one of four actions within 30 days" beside the
  // laws and sometimes cost Maryland's $50 answer. The family's description
  // is the page fetch's topic too (scripts/process/fetch.ts), so what it is
  // not is said here, in the rephraser's own words, and not in the family.
  it('tells Haiku that being pulled over or caught, and an offence\'s fine, are not ticket-procedure', () => {
    expect(REPHRASE_RULES).toContain('"ticket-procedure" is only a ticket the learner already has. It is not the penalty or the fine for an offence, and not a question about being pulled over, stopped or caught doing something')
  })

  it('is absent without a key, so retrieval runs on the question alone', () => {
    expect(haikuRephraseFor(undefined)).toBeUndefined()
    expect(haikuRephraseFor('')).toBeUndefined()
  })
})
