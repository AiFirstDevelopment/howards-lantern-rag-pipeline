import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANIFEST_FILE, TABLE, fingerprint, lawsOf, readManifest, run, sectionOf, statesOf, type Store } from '../../scripts/laws-store'
import { STORE_STATEMENT_BYTES, storeStatements } from '../../worker/src/law-nationwide'

/**
 * The `laws` table is filled from the corpus by hand (`npm run laws:store --
 * --push`), so it can fall behind it silently -- and unlike the index, which
 * can only rank a stale law, the store is where a nationwide answer's words
 * come from: a law reworded and deployed without a push is quoted on screen as
 * it used to read (docs/plans/nationwide.md, decision 5). This is where that
 * becomes red: every published state's laws must hash to what the manifest
 * says was written.
 */
describe('the laws store', () => {
  const root = process.cwd()
  const manifest = readManifest(path.join(root, MANIFEST_FILE))

  it('was written to the table the worker reads', () => {
    expect(manifest.table).toBe(TABLE)
  })

  for (const code of statesOf(root)) {
    it(`${code}: holds the laws Pages publishes, as they are now (else run npm run laws:store -- --push ${code})`, () => {
      const laws = lawsOf(root, code)
      expect(manifest.states[code]?.sha256).toBe(fingerprint(code, laws))
      expect(manifest.states[code]?.laws).toBe(laws.length)
    })
  }
})

/**
 * The command as a person runs it (criterion 20): a report changes nothing,
 * and a push writes exactly the states that differ, deletes their rows the
 * corpus no longer holds, and records them. A push that rewrote the manifest
 * for a state it never wrote would turn the test above green over a stale
 * table, which is the one thing the manifest exists to prevent.
 */
describe('npm run laws:store', () => {
  const root = process.cwd()
  const committed = readFileSync(path.join(root, MANIFEST_FILE), 'utf8')
  function staleManifest(): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'laws-store-test-')), 'laws-store.json')
    const edited = JSON.parse(committed) as { states: Record<string, { sha256: string }> }
    edited.states.DC.sha256 = 'a law changed since this was pushed'
    writeFileSync(file, JSON.stringify(edited, null, 2) + '\n')
    return file
  }

  it('reports the states whose laws differ from the manifest, and writes nothing anywhere', async () => {
    const file = staleManifest()
    const before = readFileSync(file, 'utf8')
    const lines: string[] = []
    const touched: string[] = []
    const store = (): Store => ({
      run: async (statements) => void touched.push(...statements),
      ids: async () => [],
    })
    expect(await run(root, [], { manifestFile: file, store, log: (line) => lines.push(line) })).toBe(1)
    expect(lines[0]).toBe('1 state(s) to store: DC')
    expect(touched).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('pushes only the states that differ, deletes the rows their corpus dropped, and rewrites the manifest to match', async () => {
    const file = staleManifest()
    const written: string[] = []
    const asked: string[] = []
    const store = (): Store => ({
      run: async (statements) => void written.push(...statements),
      // One row the corpus still holds and one it has dropped.
      ids: async (state) => (asked.push(state), [lawsOf(root, 'DC')[0].id, 'DC-gone']),
    })
    expect(await run(root, ['--push'], { manifestFile: file, store, log: () => {} })).toBe(0)
    expect(asked).toEqual(['DC'])
    const inserts = written.filter((sql) => sql.startsWith('INSERT'))
    expect(inserts).toEqual(storeStatements('DC', lawsOf(root, 'DC')))
    expect(written.filter((sql) => sql.startsWith('DELETE'))).toEqual([`DELETE FROM laws WHERE state = 'DC' AND id IN ('DC-gone')`])
    expect(readFileSync(file, 'utf8')).toBe(committed)
  })
})

/**
 * D1 refuses a statement over 100,000 bytes. Massachusetts holds the longest
 * single law in the corpus (c.90 §7, 22.7 KB), so its statements are the ones
 * that would cross the limit first; every one stays under it, and the
 * statements write every law once, in order.
 */
describe('the statements that write a state', () => {
  it('keeps every statement under D1’s limit and writes every law once, in order', () => {
    const laws = lawsOf(process.cwd(), 'MA')
    const statements = storeStatements('MA', laws)
    for (const sql of statements) expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(STORE_STATEMENT_BYTES)
    const ids = statements.flatMap((sql) => [...sql.matchAll(/\('(MA-[^']*)', 'MA', /g)].map((match) => match[1]))
    expect(ids).toEqual(laws.map((law) => law.id))
  })
})

/**
 * The `as_of` column (docs/plans/trusted-by-date.md, phase 3): the index
 * path's citations are dated from it, so a push that left it out would put
 * every index-path citation back to undated -- and a fingerprint that did not
 * cover it would call that table current. Delaware's code laws and its manual
 * laws carry different dates, so both kinds are checked.
 */
describe('the date each law is stored with', () => {
  const root = process.cwd()

  it('writes every law’s as-of date into its row, a statute’s and a manual law’s alike', () => {
    const laws = lawsOf(root, 'DE')
    for (const law of [laws.find((each) => each.kind === 'statute')!, laws.find((each) => each.kind !== 'statute')!]) {
      expect(law.asOf, law.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const [sql] = storeStatements('DE', [law])
      expect(sql, law.id).toMatch(/^INSERT OR REPLACE INTO laws \(id, state, kind, law, question, concept, citation, as_of, section\) VALUES /)
      const section = sectionOf(law)
      expect(sql.endsWith(`, '${law.asOf}', ${section === null ? 'NULL' : `'${section}'`})`), law.id).toBe(true)
    }
  })

  it('counts a law re-dated and nothing else as a state to push again', () => {
    const laws = lawsOf(root, 'DC')
    const redated = laws.map((law, index) => (index === 0 ? { ...law, asOf: '1999-01-01' } : law))
    expect(fingerprint('DC', redated)).not.toBe(fingerprint('DC', laws))
  })
})

/**
 * The section a row is keyed by (docs/plans/what-happens-if.md, decision 1,
 * guard 1). The worker gives the model a chosen subsection's whole section by
 * this key, so a key that split one section in two would hand a learner
 * asking what happens without a license the duty in (a) and leave the fine in
 * (c)(1) and the defence in (d) behind -- with nothing red anywhere, because
 * the answer would simply be the old one. Each style is the citation's own,
 * as the five states the plan names write them.
 */
describe('the section each law is stored under', () => {
  const statute = (citation: string) => ({ kind: 'statute' as const, citation: `${citation} — 'the words'` })

  it('keys every subsection of a section alike, in each state’s citation style', () => {
    expect(sectionOf(statute('Md. Code, Transp. § 16-112(b)'))).toBe('Md. Code, Transp. § 16-112')
    expect(sectionOf(statute('Md. Code, Transp. § 16-112(c)'))).toBe('Md. Code, Transp. § 16-112')
    expect(sectionOf(statute('Tex. Transp. Code § 521.025(c)(1)'))).toBe('Tex. Transp. Code § 521.025')
    expect(sectionOf(statute('Tex. Transp. Code § 521.025(d)'))).toBe('Tex. Transp. Code § 521.025')
    expect(sectionOf(statute('75 Pa.C.S. § 1511(a)'))).toBe('75 Pa.C.S. § 1511')
    expect(sectionOf(statute('75 Pa.C.S. § 3316(d.1)'))).toBe('75 Pa.C.S. § 3316')
    expect(sectionOf(statute('Cal. Veh. Code § 12951(a)'))).toBe('Cal. Veh. Code § 12951')
    expect(sectionOf(statute('Fla. Stat. § 322.15(1)'))).toBe('Fla. Stat. § 322.15')
  })

  // The citation shapes the corpus holds beyond "a reference and its
  // parenthesised tail", each of which would otherwise be a section of one.
  it('keys a paragraph range, a dangling dash and a Minnesota subdivision to the section they are in', () => {
    expect(sectionOf(statute('Md. Code, Transp. § 21-1004(g)(1)–(5)'))).toBe('Md. Code, Transp. § 21-1004')
    expect(sectionOf(statute('Wis. Stat. § 340.01(24)(a)–'))).toBe('Wis. Stat. § 340.01')
    expect(sectionOf(statute('Minn. Stat. § 169.011, subd. 1a'))).toBe('Minn. Stat. § 169.011')
    expect(sectionOf(statute('K.S.A. 8-1,100'))).toBe('K.S.A. 8-1,100')
  })

  it('stores a manual law under no section, nor a statute with no citation', () => {
    expect(sectionOf({ citation: "p.30 (printed) — 'Always carry your license.'" })).toBeNull()
    expect(sectionOf({ kind: 'statute', citation: null })).toBeNull()
  })

  it('stores Texas’s whole § 521.025 under one key, from the corpus as published', () => {
    const keys = new Set(lawsOf(process.cwd(), 'TX').filter((law) => law.id.startsWith('TX-C-521.025-')).map(sectionOf))
    expect([...keys]).toEqual(['Tex. Transp. Code § 521.025'])
  })
})
