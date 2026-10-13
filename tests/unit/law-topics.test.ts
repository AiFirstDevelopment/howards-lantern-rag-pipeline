import { describe, expect, it } from 'vitest'
import { chooseTopics, NATIONWIDE_FAMILY_TOPICS, type NationwideTopic } from '../../worker/src/law-topics'

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
