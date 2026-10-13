import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeChunksOf, handLawsOf, readCoverage } from '../../scripts/statutes/laws'
import { DIFF_LINES, GIVE_UP_AFTER, affectedVerdicts, refresh, reportFile, unifiedDiff, type Reader, type Report } from '../../scripts/statutes/refresh'

/**
 * `npm run statutes:refresh` (docs/plans/trusted-by-date.md, decision 10),
 * driven against a state of its own in a temporary root and a reader that
 * stands in for the legislature's site. The three ways it can fail are all
 * silent: a change it does not see, a site that was down reported as a law
 * that did not move, and a committed source rewritten under a date that says
 * a person checked it.
 */
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

const COMMITTED: Record<string, string> = {
  // The amendment below changes 25 to 35: one character for one, the same
  // length, so only the text's hash can tell the two apart.
  'zz-1-101': '§ 1-101.\n(a) A person may not drive faster than 25 miles an hour in a school zone.\n(b) This applies on school days.\n',
  'zz-1-102': '§ 1-102.\nA driver shall stop for a school bus.\n',
  'zz-1-103': '§ 1-103.\nA driver shall yield to a pedestrian in a crosswalk.\n',
}

function stateRoot(files: Record<string, string> = COMMITTED): string {
  const root = mkdtempSync(path.join(tmpdir(), 'statute-refresh-'))
  const dir = path.join(root, 'resource/statutes/sources/ZZ')
  mkdirSync(dir, { recursive: true })
  const sources = {
    official: 'https://zz.example.test/',
    name: 'the ZZ Code',
    titles: [{ id: 'zz-1', name: 'Title 1', why: 'the rules of the road' }],
    files: Object.fromEntries(
      Object.entries(files).map(([file, text]) => [
        file,
        {
          url: `https://zz.example.test/${file}`,
          retrieved: '2026-10-01',
          sha256: hash(text),
          section: file.slice(3),
          cite: `ZZ Code § ${file.slice(3)}`,
          heading: `Section ${file.slice(3)}`,
        },
      ]),
    ),
  }
  writeFileSync(path.join(dir, 'SOURCES.json'), JSON.stringify(sources, null, 2) + '\n')
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, `${file}.txt`), text)
  return root
}

/** The site today: each section's text, or an error where the page could not be had. */
function site(today: Record<string, string | Error>): Reader & { asked: string[] } {
  const asked: string[] = []
  const read = (async (_code, listing) => {
    asked.push(listing.file)
    const text = today[listing.file]
    if (text instanceof Error) throw text
    if (text === undefined) throw new Error(`the stub has no page for ${listing.file}`)
    return text
  }) as Reader & { asked: string[] }
  read.asked = asked
  return read
}

const AMENDED = COMMITTED['zz-1-101'].replace('25 miles', '35 miles')

/** Every file under a directory, by relative path, as bytes. */
function snapshot(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const full = path.join(dir, name)
    try {
      out.set(name, readFileSync(full))
    } catch {
      // a directory
    }
  }
  return out
}

describe('npm run statutes:refresh -- XX', () => {
  // AC14: a dated report naming every section checked.
  it('writes a report under today’s date naming every section it checked', async () => {
    const root = stateRoot()
    await refresh(root, ['ZZ'], { read: site({ ...COMMITTED }), today: '2026-11-01', log: () => {} })
    const report = JSON.parse(readFileSync(reportFile(root, '2026-11-01'), 'utf8')) as Report
    expect(report.ran).toBe('2026-11-01')
    expect(report.states.ZZ.checked).toEqual(['zz-1-101', 'zz-1-102', 'zz-1-103'])
    expect(report.states.ZZ.changed).toEqual([])
    expect(report.states.ZZ.unreachable).toEqual([])
  })

  // Guard 12, and AC14's diff.
  it('lists a section whose text changed by one character of the same length, with both hashes and the diff', async () => {
    const root = stateRoot()
    const report = await refresh(root, ['ZZ'], { read: site({ ...COMMITTED, 'zz-1-101': AMENDED }), today: '2026-11-01', log: () => {} })
    expect(AMENDED.length).toBe(COMMITTED['zz-1-101'].length)
    const [changed, ...others] = report.states.ZZ.changed
    expect(others).toEqual([])
    expect(changed).toMatchObject({
      file: 'zz-1-101',
      cite: 'ZZ Code § 1-101',
      heading: 'Section 1-101',
      url: 'https://zz.example.test/zz-1-101',
      before: hash(COMMITTED['zz-1-101']),
      after: hash(AMENDED),
    })
    expect(changed.diff.split('\n')).toEqual([
      '--- a/ZZ/zz-1-101.txt',
      '+++ b/ZZ/zz-1-101.txt',
      '@@ -1,4 +1,4 @@',
      ' § 1-101.',
      '-(a) A person may not drive faster than 25 miles an hour in a school zone.',
      '+(a) A person may not drive faster than 35 miles an hour in a school zone.',
      ' (b) This applies on school days.',
      ' ',
    ])
  })

  // Guard 13.
  it('reports a section whose page cannot be fetched as unreachable, never as unchanged', async () => {
    const root = stateRoot()
    const report = await refresh(root, ['ZZ'], {
      read: site({ ...COMMITTED, 'zz-1-102': new Error('https://zz.example.test/zz-1-102 answered 503') }),
      today: '2026-11-01',
      log: () => {},
    })
    expect(report.states.ZZ.unreachable).toEqual([
      {
        file: 'zz-1-102',
        cite: 'ZZ Code § 1-102',
        heading: 'Section 1-102',
        url: 'https://zz.example.test/zz-1-102',
        error: 'https://zz.example.test/zz-1-102 answered 503',
      },
    ])
    expect(report.states.ZZ.changed).toEqual([])
    expect(report.states.ZZ.checked).toContain('zz-1-102')
  })

  // Guard 14.
  it('leaves every committed source byte for byte as it was, though a section changed', async () => {
    const root = stateRoot()
    const sources = path.join(root, 'resource/statutes/sources')
    const before = snapshot(sources)
    const report = await refresh(root, ['ZZ'], { read: site({ ...COMMITTED, 'zz-1-101': AMENDED }), today: '2026-11-01', log: () => {} })
    expect(report.states.ZZ.changed).toHaveLength(1)
    expect(snapshot(sources)).toEqual(before)
  })

  it('stops asking a site after five failures in a row and reports the rest unreachable, untried', async () => {
    const files = Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`zz-2-${100 + n}`, `§ 2-${100 + n}.\nA rule.\n`]))
    const root = stateRoot(files)
    const read = site(Object.fromEntries(Object.keys(files).map((file) => [file, new Error('connection refused')])))
    const report = await refresh(root, ['ZZ'], { read, today: '2026-11-01', log: () => {} })
    expect(read.asked).toHaveLength(GIVE_UP_AFTER)
    expect(report.states.ZZ.unreachable).toHaveLength(8)
    expect(report.states.ZZ.unreachable.at(-1)?.error).toBe(`not tried: the ${GIVE_UP_AFTER} sections before it could not be fetched`)
  })

  it('keeps the states an earlier run wrote the same day, so one state a day still makes one report', async () => {
    const root = stateRoot()
    const file = reportFile(root, '2026-11-01')
    mkdirSync(path.dirname(file), { recursive: true })
    const earlier: Report = { ran: '2026-11-01', states: { AA: { checked: ['aa-1'], changed: [], unreachable: [] } } }
    writeFileSync(file, JSON.stringify(earlier))
    await refresh(root, ['ZZ'], { read: site({ ...COMMITTED }), today: '2026-11-01', log: () => {} })
    const report = JSON.parse(readFileSync(file, 'utf8')) as Report
    expect(Object.keys(report.states)).toEqual(['AA', 'ZZ'])
  })
})

describe('the diff in a report', () => {
  it('is cut to forty lines, the last saying how many more there were', () => {
    const before = Array.from({ length: 60 }, (_, n) => `line ${n}`).join('\n')
    const after = Array.from({ length: 60 }, (_, n) => `line ${n} amended`).join('\n')
    const lines = unifiedDiff(before, after, 'ZZ/zz.txt').split('\n')
    expect(lines).toHaveLength(DIFF_LINES)
    expect(lines.at(-1)).toBe(`… ${2 + 1 + 120 - (DIFF_LINES - 1)} more lines`)
  })

  it('shows two edits far apart as two hunks, each with three lines of context', () => {
    const before = Array.from({ length: 20 }, (_, n) => `line ${n}`)
    const after = [...before]
    after[2] = 'line 2 amended'
    after[15] = 'line 15 amended'
    const lines = unifiedDiff(before.join('\n'), after.join('\n'), 'ZZ/zz.txt').split('\n')
    expect(lines.filter((line) => line.startsWith('@@'))).toEqual(['@@ -1,6 +1,6 @@', '@@ -13,7 +13,7 @@'])
  })
})

/**
 * What `/refresh-codes` lists in its PR: the comparisons resting on words that
 * moved. Read against Maryland's real verdicts and chunks, because the link
 * from a verdict law to its section is the chunk's recorded file, and a
 * fixture would only prove the fixture.
 */
describe('the verdicts a report touches', () => {
  const root = process.cwd()
  const coverage = readCoverage(root).MD
  const chunks = new Map(codeChunksOf(root, 'MD').map((chunk) => [chunk.id, chunk.source]))
  const [topic, verdict] = Object.entries(coverage).find(([, each]) => each.from === 'code' && chunks.has(each.law ?? ''))!
  const file = chunks.get(verdict.law!)!
  const reportOf = (changedFile: string): Report => ({
    ran: '2026-11-01',
    states: { MD: { checked: [changedFile], changed: [{ file: changedFile, cite: '', heading: '', url: '', before: '', after: '', diff: '' }], unreachable: [] } },
  })

  it('names every topic whose verdict law was cut from a section that changed', () => {
    expect(affectedVerdicts(root, reportOf(file))).toContainEqual({ state: 'MD', topic, law: verdict.law, file })
  })

  it('names none for a section no verdict law was cut from', () => {
    // Maryland's hand-written laws are cut from sections too (MD-S01 from § 21-1003).
    const hand = new Map((handLawsOf(root, 'MD') ?? []).map((law) => [law.id, law.source]))
    const verdictFiles = new Set(Object.values(coverage).map((each) => chunks.get(each.law ?? '') ?? hand.get(each.law ?? '')))
    const untouched = [...new Set(chunks.values())].find((each) => !verdictFiles.has(each))!
    expect(affectedVerdicts(root, reportOf(untouched))).toEqual([])
  })
})

