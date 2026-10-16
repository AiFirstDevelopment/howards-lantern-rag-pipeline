import { describe, expect, it } from 'vitest'
import { chooseTopics, haikuTopicsFor, NATIONWIDE_FAMILY_TOPICS, type NationwideTopic, type TopicsClient } from '../../worker/src/law-topics'

// A chooser that names a family but no topic has still said what the question
// is about. Before the fallback, "which state has the harshest first-offense
// DUI penalties" came back `{ topics: [], family: 'dui' }` in two runs of six,
// and an empty list sent the question to the index path, which searches every
// state's laws for the words and cannot compare the family's figures at all.
const TOPICS: NationwideTopic[] = [
  { id: 'park-hydrant', question: 'How far from a fire hydrant must you park?', title: 'Fire hydrants' },
  { id: 'bac-adult', question: 'What is the legal blood alcohol limit for adult drivers?', title: 'Blood alcohol limit for adults', family: 'dui' },
  { id: 'implied-consent', question: 'What happens if you refuse a breath test?', title: 'Refusing a test', family: 'dui' },
  { id: 'dui-first-fine', question: 'What is the fine for a first DUI?', title: 'Fine for a first DUI', family: 'dui' },
  { id: 'dui-first-jail', question: 'How long is the jail term for a first DUI?', title: 'Jail for a first DUI', family: 'dui' },
  { id: 'dui-interlock', question: 'When is an ignition interlock required after a DUI?', title: 'Ignition interlock', family: 'dui' },
  { id: 'left-on-red', question: 'When may you turn left on red?', title: 'Left on red' },
]

describe('a chooser that names a family and no topic', () => {
  it('answers the family’s own topics, the ones sharing the learner’s words first, instead of the index path', async () => {
    const chosen = await chooseTopics('which state has the harshest first-offense DUI penalties', TOPICS, async () => ({ topics: [], family: 'dui' }))
    expect(chosen.family).toBe('dui')
    expect(chosen.topics).toHaveLength(NATIONWIDE_FAMILY_TOPICS)
    for (const id of chosen.topics) expect(TOPICS.find((topic) => topic.id === id)?.family).toBe('dui')
    // "first" and "DUI" are in the fine's and the jail term's questions; the limit's and the refusal's share nothing.
    expect(chosen.topics.slice(0, 2).sort()).toEqual(['dui-first-fine', 'dui-first-jail'])
  })

  it('still believes a chooser that names no family and no topic, which is what sends a question no topic covers to every state’s laws', async () => {
    const chosen = await chooseTopics('how old must a child be to ride in the front seat', TOPICS, async () => ({ topics: [] }))
    expect(chosen.topics).toEqual([])
    expect(chosen.family).toBeNull()
  })
})

/** A client that answers every call with `reply` and keeps the system prompt it was sent. */
function answering(reply: string, systems: string[] = []): TopicsClient {
  return {
    messages: { create: async (body: { system: string }) => (systems.push(body.system), { content: [{ type: 'text', text: reply }] }) },
  } as unknown as TopicsClient
}

/**
 * The topic chooser read a topic's question as the whole of what it answers,
 * so a chip asking for a figure inside the subject was refused with "no
 * topic" before the model was asked, and never stored: "how much must you
 * slow down passing a stopped emergency vehicle" (move-over) in both
 * languages, "how long after sunset must your headlights be on" and the
 * wipers chip (headlights-when), the U-turn sight distance (u-turn), and the
 * Spanish curb chip, whose "acera" Haiku did not read as the curb.
 */
describe('Haiku as the topic chooser', () => {
  it('is told that a figure inside a topic’s subject is that topic, with the refused chips as its examples', async () => {
    const systems: string[] = []
    await haikuTopicsFor(undefined, answering('{"topics":["move-over"],"family":""}', systems))!('How much must you slow down when passing a stopped emergency vehicle, state by state?', TOPICS)
    expect(systems[0]).toContain('A question about one figure or condition inside a topic\'s subject is that topic too, though the topic\'s question names the subject and not the figure')
    expect(systems[0]).toContain('"how much must you slow down passing a stopped emergency vehicle" is move-over')
    expect(systems[0]).toContain('"how long after sunset must your headlights be on" and "which states make you turn on your headlights when your wipers are on" are headlights-when')
    expect(systems[0]).toContain('"how far away must oncoming drivers see you before a U-turn" is u-turn')
  })

  it('is told the Spanish words for a topic’s subject, so a Spanish chip reaches the topic its English twin does', async () => {
    const systems: string[] = []
    await haikuTopicsFor(undefined, answering('{"topics":["park-curb"],"family":""}', systems))!('¿Qué estado permite estacionar más lejos de la acera?', TOPICS)
    expect(systems[0]).toContain('"acera" or "bordillo" is the curb, "limpiaparabrisas" the wipers, "vehículo de emergencia detenido" the stopped emergency vehicle')
  })
})
