import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCreditError, onlyWithIndex, unjudged, verdictOf, withVerdict } from '../../scripts/statutes/judge'
import { COVERAGE_FILE, readCoverage, topicsOf, type Coverage } from '../../scripts/statutes/laws'
import type { AskLaw } from '../../worker/src/law-retrieval'

/**
 * The judge writes verdicts into coverage.json, which every comparison page,
 * topic file and nationwide answer is built from (docs/plans/trusted-by-date.md,
 * decision 2). A verdict a person corrected by hand and a re-run silently put
 * back is a page changing under the reviewer who read it; a law reachable only
 * through the live index written as a verdict is a page the offline suite
 * cannot hold to anything.
 */
const ROOT = process.cwd()
const ORDER = topicsOf(ROOT).map((topic) => topic.id)
const law = (id: string): AskLaw => ({ id, law: `the law ${id}`, question: '', concept: '', citation: null })
const hash = () => createHash('sha256').update(readFileSync(path.join(ROOT, COVERAGE_FILE))).digest('hex')

describe('the judge writing coverage.json', () => {
  // Guard 3.
  it('leaves a verdict already written exactly as it was, and says nothing was written', () => {
    const coverage: Coverage = { MD: { 'dui-first-fine': { from: 'none', reason: 'corrected by hand' } } }
    const after = withVerdict(coverage, 'MD', 'dui-first-fine', { from: 'code', law: 'MD-C-27-101-k' }, ORDER)
    expect(after.written).toBe(false)
    expect(after.coverage.MD['dui-first-fine']).toEqual({ from: 'none', reason: 'corrected by hand' })
    expect(unjudged(coverage, ['MD'], ['dui-first-fine', 'dui-first-jail'])).toEqual([{ code: 'MD', topic: 'dui-first-jail' }])
  })

  it('adds a new verdict in topics.json order and keeps every other verdict of the state', () => {
    const coverage: Coverage = { AL: { 'park-hydrant': { from: 'manual', law: 'AL-142' }, 'texting-fine': { from: 'none', reason: 'no fine' } } }
    const after = withVerdict(coverage, 'AL', 'dui-first-fine', { from: 'manual', law: 'AL-179' }, ORDER)
    expect(after.written).toBe(true)
    expect(Object.keys(after.coverage.AL)).toEqual(['park-hydrant', 'dui-first-fine', 'texting-fine'])
    expect(after.coverage.AL['park-hydrant']).toEqual({ from: 'manual', law: 'AL-142' })
  })

  it('judges the states in alphabetical order, so a run cut short leaves a prefix a resume can name', () => {
    expect(unjudged({}, ['WY', 'AK', 'MD'], ['texting-fine']).map((each) => each.code)).toEqual(['AK', 'MD', 'WY'])
  })

  // Decision 2: the offline pool is what a verdict may name.
  it('writes a law only the live pool reaches as none, naming it, and a law of the offline pool as a verdict of its kind', () => {
    const offline = [law('AK-101'), law('AK-C-28.35.290-b-1')]
    const liveOnly = [law('AK-C-28.35.030-b-1')]
    expect(verdictOf({ law: 'AK-C-28.35.030-b-1', reason: 'states the fine' }, offline, liveOnly)).toEqual({
      from: 'none',
      reason: onlyWithIndex('AK-C-28.35.030-b-1'),
    })
    expect(verdictOf({ law: 'AK-C-28.35.290-b-1', reason: '' }, offline, liveOnly)).toEqual({ from: 'code', law: 'AK-C-28.35.290-b-1' })
    expect(verdictOf({ law: 'AK-101', reason: '' }, offline, liveOnly)).toEqual({ from: 'manual', law: 'AK-101' })
    expect(verdictOf({ law: 'none', reason: 'no law states a fine' }, offline, liveOnly)).toEqual({ from: 'none', reason: 'no law states a fine' })
  })

  it('stops on the API’s credit error rather than retrying it', () => {
    expect(isCreditError(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'))).toBe(true)
    expect(isCreditError(new Error('529 overloaded'))).toBe(false)
  })

  // AC3: run as a person runs it, with no key, so asking the model would fail loudly.
  it('says a judged state and topic is left as it is, asks no model, and changes nothing in coverage.json', () => {
    expect(readCoverage(ROOT).MD['dui-first-fine'], 'MD has a dui-first-fine verdict to leave alone').toBeDefined()
    const before = hash()
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    const out = execFileSync('npx', ['tsx', 'scripts/statutes/judge.ts', 'MD', '--topic', 'dui-first-fine'], { cwd: ROOT, env, encoding: 'utf8' })
    expect(out).toMatch(/^MD dui-first-fine: already judged \(\w+( \S+)?\), left as it is$/m)
    expect(out).toContain('nothing to judge')
    expect(hash()).toBe(before)
  })
})
