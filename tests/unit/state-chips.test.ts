import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStateChips, publishedStates, type StateBatch } from '../../scripts/state-chips-build'
import {
  STALE,
  STATE_CHIP_FAMILIES,
  STATE_CHIP_LANGS,
  STATE_CHIP_CONSEQUENCE_SENTENCES,
  STATE_CHIP_SENTENCES,
  checkStoredStateChip,
  citedRow,
  committedRows,
  poolProblems,
  readStateChips,
  readStoredStateChips,
  staleStateChips,
  type StateChip,
  type StoredStateChip,
} from '../../scripts/state-chips'
import { chipsToRebuild, logChipsToRebuild } from '../../scripts/statutes/refresh'
import { lawsBySectionFromCorpus, penaltiesFromFiles, processRowsFromFiles } from '../../scripts/live'
import { publishedLawsOf } from '../../scripts/statutes/laws'
import { sentencesIn } from '../../scripts/answer-register'
import type { AskLaw } from '../../worker/src/law-retrieval'
import type { LearnerAskRequest, LearnerReply } from '../../worker/src/learner-ask'

/**
 * The state chips (docs/plans/what-happens-if.md, phase 4): twelve questions a
 * teenager types, answered once for each state and shown free under the box
 * and on the state's facts page.
 *
 * Nobody reads the 1,224 stored answers before they are shown. Each is held
 * here to everything the live checker holds an answer to, re-run on the rows
 * the repository commits, and to what only a stored answer can be held to:
 * its sources are its own state's, its figures are in those sources and no
 * others, and those sources still say what they said when it was written. A
 * state that fails is the one a person rebuilds -- `npm run chips:build --
 * --states XX`, never an edit to the answer.
 */
const ROOT = process.cwd()
const pool = readStateChips(ROOT)
const STATES = publishedStates(ROOT)

describe('the pool', () => {
  // AC20.
  it('holds at least twelve questions, each in English and Spanish, each with a family', () => {
    expect(pool.length).toBeGreaterThanOrEqual(12)
    for (const chip of pool) {
      expect(STATE_CHIP_FAMILIES, chip.id).toContain(chip.family)
      for (const lang of STATE_CHIP_LANGS) expect(chip.question[lang]?.trim() ?? '', `${chip.id} (${lang})`).not.toBe('')
    }
    expect(poolProblems(pool)).toEqual([])
  })

  // AC20. A figure in the question is one the answer may say back with no law
  // stating it (checkLawAnswer grounds the learner's own words), and a state's
  // name asks Maryland's question of fifty other states.
  it('refuses a question with a figure in it or a state’s name, in either language', () => {
    const chip = (en: string, es: string): StateChip => ({ id: 'probe', family: 'rule', question: { en, es } })
    expect(poolProblems([...pool.slice(1), chip('Can I drive at 16?', '¿Puedo manejar?')])).toEqual(['probe (en): states a figure (16)'])
    expect(poolProblems([...pool.slice(1), chip('Can I drive?', '¿Puedo llevar a dos amigos?')])).toEqual(['probe (es): states a figure (2)'])
    expect(poolProblems([...pool.slice(1), chip('Can I turn right on red in Texas?', '¿Puedo girar?')])).toEqual(['probe (en): names TX'])
    expect(poolProblems([...pool.slice(1), chip('Can I drive?', '¿Puedo manejar en Nueva York?')])).toEqual(['probe (es): names NY'])
  })
})

describe('every stored state answer is one the box would show, from its own state’s rows', () => {
  for (const code of STATES) {
    const stored = readStoredStateChips(ROOT, code)
    if (stored.length === 0) continue
    const rows = committedRows(ROOT, code)
    for (const answer of stored) {
      // AC21: its own state's sources, every figure in them, two sentences
      // (three for a "what happens if"), no law's name -- everything but a row moving under it, which the
      // state's own test below names so a stale corpus reads as that.
      it(`${code} ${answer.id} (${answer.lang}): cites its state’s rows, grounds every figure in them, and reads in two sentences, three for a consequence`, () => {
        const chip = pool.find((each) => each.id === answer.id)
        expect(checkStoredStateChip(answer, chip, code, rows).filter((problem) => !problem.includes(STALE))).toEqual([])
      })
    }

    // AC24, guard 20. One test a state, so a row reworded or re-dated in
    // Maryland's committed files is red for Maryland and names the chip.
    it(`${code}: every stored answer was written from its rows as the committed files hold them today`, () => {
      expect(staleStateChips(code, stored, pool, rows), `run npm run chips:build -- --states ${code}`).toEqual([])
    })
  }

  it('stores each chip once per language, in a file named for its own state', () => {
    for (const code of STATES) {
      const stored = readStoredStateChips(ROOT, code)
      if (stored.length === 0) continue
      const file = JSON.parse(readFileSync(path.join(ROOT, 'resource/state-chips', `${code}.json`), 'utf8')) as { state: string }
      expect(file.state, code).toBe(code)
      const keys = stored.map((each) => `${each.id}/${each.lang}`)
      expect(new Set(keys).size, code).toBe(keys.length)
    }
  })
})

/**
 * Fixtures built from Maryland's committed rows, so each is the shape a
 * stored answer actually takes and the row it cites is one the box gives.
 */
const MD_ROWS = committedRows(ROOT, 'MD')
const hydrantChip = pool.find((chip) => chip.id === 'hydrant-park')!
const noLicenseChip = pool.find((chip) => chip.id === 'no-license')!

function fixture(chip: StateChip, answer: string, sources: string[], rows: ReadonlyMap<string, AskLaw> = MD_ROWS, lang: 'en' | 'es' = 'en'): StoredStateChip {
  const cited: StoredStateChip['cited'] = {}
  for (const id of sources) {
    const law = rows.get(id) ?? committedRows(ROOT, id.slice(0, 2)).get(id)
    if (law !== undefined) cited[id] = citedRow(law)
  }
  return { id: chip.id, lang, question: chip.question[lang], answer, sources, cited, asOf: '2026-10-11', model: 'claude-opus-5-5' }
}

describe('a stored answer from another state’s law', () => {
  // Guard 15. Given only Maryland's rows the live checker would never see a
  // Texas id; a stored file can hold one if a build ever mixed its states up.
  // Mutation: drop the prefix check -> the planted TX- id passes.
  it('is refused for citing a Texas row in Maryland’s file', () => {
    const texas = [...committedRows(ROOT, 'TX').values()].find((law) => /fire hydrant/i.test(law.law) && /15 feet/.test(law.law))!
    const planted = fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant.', [texas.id])
    expect(checkStoredStateChip(planted, hydrantChip, 'MD', MD_ROWS)).toEqual([`cites ${texas.id}, not MD's`])
    expect(checkStoredStateChip(fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant.', ['MD-S01']), hydrantChip, 'MD', MD_ROWS)).toEqual([])
  })
})

describe('a figure its own sources do not hold', () => {
  // Guard 16. Maryland's schedule says $50 for not showing a license; a $75
  // stated by other Maryland rows is still not this row's. Mutation: ground
  // the figures against every row of the state instead of the cited ones.
  it('is refused when the cited schedule row says $50 and the answer says $75', () => {
    expect([...MD_ROWS.values()].some((law) => /\$75\b/.test(`${law.law} ${law.citation}`)), 'the corpus states 75 somewhere').toBe(true)
    const wrong = fixture(noLicenseChip, 'You’ll get a $75 ticket you can pay by mail.', ['MD-P-16-112-c'])
    expect(checkStoredStateChip(wrong, noLicenseChip, 'MD', MD_ROWS)).toEqual(['the live checker refuses it on its own sources: ungrounded'])
    const right = fixture(noLicenseChip, 'You’ll get a $50 ticket you can pay without going to court, with no points.', ['MD-P-16-112-c'])
    expect(checkStoredStateChip(right, noLicenseChip, 'MD', MD_ROWS)).toEqual([])
  })

  it('is refused for a third sentence (a fourth for a “what happens if”), a law’s name in the prose, or another state’s name', () => {
    // "Can I use my phone at a red light?" is not of the consequence shape;
    // the hydrant question is ("do I have to"), as the box's register reads it.
    const phoneChip = pool.find((chip) => chip.id === 'phone-red-light')!
    const three = fixture(phoneChip, 'No. Put it down. Wait for green.', ['MD-141'])
    expect(checkStoredStateChip(three, phoneChip, 'MD', MD_ROWS)).toEqual([`3 sentences, at most ${STATE_CHIP_SENTENCES}`])
    const consequence = fixture(noLicenseChip, 'The officer can ticket you. It is $50. You can pay it without going to court.', ['MD-P-16-112-c'])
    expect(checkStoredStateChip(consequence, noLicenseChip, 'MD', MD_ROWS), 'three for the consequence shape, as the box allows').toEqual([])
    const four = fixture(noLicenseChip, 'The officer can ticket you. It is $50. There are no points. You can pay it without going to court.', ['MD-P-16-112-c'])
    expect(checkStoredStateChip(four, noLicenseChip, 'MD', MD_ROWS)).toEqual([`4 sentences, at most ${STATE_CHIP_CONSEQUENCE_SENTENCES}`])
    const named = fixture(hydrantChip, 'Under the Transportation Article, park at least 15 feet from a fire hydrant.', ['MD-S01'])
    expect(checkStoredStateChip(named, hydrantChip, 'MD', MD_ROWS)).toEqual(['names a law or a page in the sentences'])
    const other = fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant, as in Virginia.', ['MD-S01'])
    expect(checkStoredStateChip(other, hydrantChip, 'MD', MD_ROWS)).toEqual(['names VA, not MD'])
  })
})

describe('a stored answer whose cited row has moved', () => {
  const stored = [fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant.', ['MD-S01'])]
  const texasHydrant = [...committedRows(ROOT, 'TX').values()].find((law) => /fire hydrant/i.test(law.law) && /15 feet/.test(law.law))!
  const texasStored = [fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant.', [texasHydrant.id], committedRows(ROOT, 'TX'))]

  // Guard 20, AC24. Mutation: compare the ids only, not the row's words.
  it('names the chip when the row’s words change in the committed files, and only that state', () => {
    const moved = new Map(MD_ROWS)
    const row = moved.get('MD-S01')!
    moved.set('MD-S01', { ...row, law: row.law.replace('15 feet', '10 feet') })
    expect(staleStateChips('MD', stored, pool, moved)).toEqual(['hydrant-park (en)'])
    expect(staleStateChips('MD', stored, pool, MD_ROWS)).toEqual([])
    expect(staleStateChips('TX', texasStored, pool, committedRows(ROOT, 'TX'))).toEqual([])
  })

  it('names the chip when the row is re-dated, or gone', () => {
    const redated = new Map(MD_ROWS)
    redated.set('MD-S01', { ...MD_ROWS.get('MD-S01')!, asOf: '2099-01-01' })
    expect(staleStateChips('MD', stored, pool, redated)).toEqual(['hydrant-park (en)'])
    const gone = new Map(MD_ROWS)
    gone.delete('MD-S01')
    expect(staleStateChips('MD', stored, pool, gone)).toEqual(['hydrant-park (en)'])
  })
})

describe('the monthly refresh', () => {
  const noLicense = fixture(noLicenseChip, 'You’ll get a $50 ticket you can pay without going to court, with no points.', ['MD-P-16-112-c'])
  const hydrant = fixture(hydrantChip, 'Park at least 15 feet from a fire hydrant.', ['MD-S01'])
  const read = (code: string) => (code === 'MD' ? [noLicense, hydrant] : [])

  // AC24: the report names the state whose chips rest on a schedule row that
  // changed at its source, and the chip, before anyone has applied it.
  it('names a state whose stored chip cites a schedule row the report says changed, and not a state it does not touch', () => {
    const penalties = {
      ran: '2026-11-01',
      states: {
        MD: { status: 'changed' as const, checked: 1, changed: [{ id: 'MD-P-16-112-c', section: 'Md. Code, Transp. § 16-112', before: '$50.00', after: '$70.00' }], added: [], removed: [], notWritten: [] },
        TX: { status: 'unchanged' as const, checked: 1, changed: [], added: [], removed: [], notWritten: [] },
      },
    }
    const rebuild = chipsToRebuild(ROOT, { penalties }, read)
    expect(rebuild).toEqual([{ state: 'MD', chips: ['no-license (en)'] }])
    const lines: string[] = []
    logChipsToRebuild(rebuild, (line) => lines.push(line))
    expect(lines[0]).toBe('STATE CHIPS MD: no-license (en) -- rebuild with npm run chips:build -- --states MD once the change is applied')
    expect(chipsToRebuild(ROOT, { penalties: { ran: '2026-11-01', states: { MD: { ...penalties.states.TX } } } }, read)).toEqual([])
  })
})

/**
 * The build, with the model scripted: the state pipeline exactly as the box
 * runs it on Maryland's committed files, Opus replaced by a function. What
 * it writes, what it refuses and says, and that a second run asks nothing.
 */
describe('npm run chips:build -- --states MD, the model scripted', () => {
  /** The batch, answered at once by `reply`, counting what it was asked. */
  function scripted(reply: (request: LearnerAskRequest) => LearnerReply): { batch: () => StateBatch; asked: () => number } {
    let asked = 0
    return {
      asked: () => asked,
      batch: () => ({
        run: (_id, work) =>
          work(async (request) => {
            asked += 1
            return reply(request)
          }),
        whenParked: async () => {},
        submit: async () => ({ id: 'msgbatch_stub', sent: asked, succeeded: asked }),
      }),
    }
  }

  // Hydrant: a right answer from the row given. Phone at a red light: right
  // figures, three sentences, which only the stored check refuses. Texting:
  // a figure no row given states, which the live checker refuses. The rest:
  // nothing said, as a model that found no law says it.
  const model = scripted((request) => {
    const hydrant = (request.laws ?? []).find((law) => /fire hydrant/.test(law.law) && /15 feet/.test(law.law))
    if (request.question === hydrantChip.question.en && hydrant !== undefined) {
      return { kind: 'reply', scope: 'road-law', answer: 'Park at least 15 feet from a fire hydrant.', sources: [hydrant.id], model: 'claude-opus-5-5' }
    }
    const first = request.laws?.[0]
    if (request.question === 'Can I use my phone at a red light?' && first !== undefined) {
      return { kind: 'reply', scope: 'road-law', answer: 'No. Put it down. Wait for green.', sources: [first.id], model: 'claude-opus-5-5' }
    }
    if (request.question === 'What happens if I get caught texting while driving?' && first !== undefined) {
      return { kind: 'reply', scope: 'road-law', answer: 'It is a $9,999 fine.', sources: [first.id], model: 'claude-opus-5-5' }
    }
    return { kind: 'reply', scope: 'road-law', answer: '', sources: [], model: 'claude-opus-5-5' }
  })
  const out = mkdtempSync(path.join(tmpdir(), 'state-chips-'))
  const lines: string[] = []
  const files = new Map<string, AskLaw[]>()
  const options = {
    root: ROOT,
    out,
    codes: ['MD'],
    today: '2026-10-11',
    batch: model.batch,
    log: (line: string) => lines.push(line),
    pipeline: {
      lawsFor: async (code: string) => {
        if (!files.has(code)) files.set(code, publishedLawsOf(ROOT, code))
        return files.get(code)!
      },
      lawsBySection: lawsBySectionFromCorpus(ROOT),
      penaltiesFor: penaltiesFromFiles(ROOT),
      processRowsFor: processRowsFromFiles(ROOT),
      contact: 'support@example.test',
    },
  }

  // AC21.
  it('writes MD.json with every chip that passes, each in two sentences at most and grounded in its rows, and names each refusal with its reason', async () => {
    const first = await buildStateChips(options)
    expect(first.asked).toBe(pool.length * 2)
    expect(first.written).toEqual(['resource/state-chips/MD.json'])
    const stored = readStoredStateChips(out, 'MD')
    expect(stored.map((each) => `${each.id} (${each.lang})`)).toEqual(['hydrant-park (en)'])
    for (const each of stored) {
      expect(sentencesIn(each.answer)).toBeLessThanOrEqual(STATE_CHIP_SENTENCES)
      expect(each.sources.every((id) => id.startsWith('MD-'))).toBe(true)
      expect(checkStoredStateChip(each, hydrantChip, 'MD', MD_ROWS)).toEqual([])
    }
    expect(first.refused).toHaveLength(pool.length * 2 - 1)
    expect(lines).toContain('REFUSED MD phone-red-light (en): 3 sentences, at most 2 (wrote: No. Put it down. Wait for green.)')
    expect(lines).toContain('REFUSED MD caught-texting (en): the live checker refused it: road-law:ungrounded (wrote: It is a $9,999 fine.)')
    expect(lines.some((line) => line.startsWith('REFUSED MD hydrant-park (es): the live checker refused it: '))).toBe(true)
    expect(lines).toContain('MD: 1 stored, 23 refused')
  })

  // AC21: run again with nothing changed it writes nothing. The refused
  // chips are asked again -- they are missing -- and the kept one is not.
  it('keeps the stored answer and writes nothing when run again with nothing changed', async () => {
    const before = readFileSync(path.join(out, 'resource/state-chips/MD.json'), 'utf8')
    const asked = model.asked()
    const again = await buildStateChips(options)
    expect(again.asked).toBe(pool.length * 2 - 1)
    expect(model.asked() - asked).toBe(pool.length * 2 - 1)
    expect(again.written).toEqual([])
    expect(readFileSync(path.join(out, 'resource/state-chips/MD.json'), 'utf8')).toBe(before)
    expect(lines).toContain('nothing written: no stored answer changed')
  })
})
