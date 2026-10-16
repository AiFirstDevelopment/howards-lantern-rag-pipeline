import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANIFEST_FILE, TABLE, fingerprint, lawsOf, readManifest, run, sectionOf, statesOf, type Store } from '../../scripts/laws-store'
import { EVAL_TIMEOUT_MS, FIXTURE_FILE, figuresOf, harnessEval, withFigures, type Spawn, type StateEval } from '../../scripts/push-eval'
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
    // --no-eval: this test is about what is written to the table; the eval a
    // push ends with is the describe block below.
    expect(await run(root, ['--push', '--no-eval'], { manifestFile: file, store, log: () => {} })).toBe(0)
    expect(asked).toEqual(['DC'])
    const inserts = written.filter((sql) => sql.startsWith('INSERT'))
    expect(inserts).toEqual(storeStatements('DC', lawsOf(root, 'DC')))
    expect(written.filter((sql) => sql.startsWith('DELETE'))).toEqual([`DELETE FROM laws WHERE state = 'DC' AND id IN ('DC-gone')`])
    expect(readFileSync(file, 'utf8')).toBe(committed)
  })
})

/**
 * The retrieval eval a push ends with (docs/plans/eval-lifecycle-build.md,
 * decision 35, criterion 33, guard 23). The manifest is where somebody reads
 * how well a state retrieves after its corpus moved, so the failure worth a
 * test is a figure that is not a measurement: a recall of 1.0 for a state
 * with nothing to score reads as the best state in the file, and a push that
 * kept the last corpus's figures beside the new hash vouches for a corpus
 * nobody measured.
 */
describe('the eval a push ends with', () => {
  const root = process.cwd()
  const committed = readFileSync(path.join(root, MANIFEST_FILE), 'utf8')
  function staleManifest(figures?: { evalRecall: number | null; evalMrr: number | null }): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'laws-store-eval-')), 'laws-store.json')
    const edited = JSON.parse(committed) as { states: Record<string, { sha256: string }> }
    edited.states.DC = { ...edited.states.DC, sha256: 'a law changed since this was pushed', ...figures }
    writeFileSync(file, JSON.stringify(edited, null, 2) + '\n')
    return file
  }
  const store = (): Store => ({ run: async () => {}, ids: async () => [] })
  const dc = lawsOf(root, 'DC')
  const pushDC = async (args: string[], evaluate: (state: string) => StateEval, file: string) => {
    const lines: string[] = []
    const asked: string[] = []
    // `--all DC` pushes DC whatever the manifest says, without hashing every
    // other state to find it stale: that walk is seconds a test, and a file
    // that runs long in one worker is what timed the suite's RPC out before.
    const code = await run(root, ['--push', '--all', 'DC', ...args], {
      manifestFile: file,
      store,
      log: (line) => lines.push(line),
      evaluate: (state) => (asked.push(state), evaluate(state)),
    })
    return { code, lines, asked, entry: readManifest(file).states.DC }
  }

  it('writes the state’s recall and MRR beside the hash it just pushed', async () => {
    const pushed = await pushDC([], () => ({ evalRecall: 0.75, evalMrr: 0.412 }), staleManifest())
    expect(pushed.code).toBe(0)
    expect(pushed.asked).toEqual(['DC'])
    expect(pushed.entry).toEqual({ laws: dc.length, sha256: fingerprint('DC', dc), evalRecall: 0.75, evalMrr: 0.412 })
    expect(pushed.lines).toContain('DC: retrieval eval recall@pool 0.75, MRR 0.412')
  })

  it('writes null and says why when there was nothing to score, rather than keeping the last corpus’s figures', async () => {
    const pushed = await pushDC([], () => ({ evalRecall: null, evalMrr: null, why: 'no road-law case for DC' }), staleManifest({ evalRecall: 0.9, evalMrr: 0.8 }))
    expect(pushed.code).toBe(0)
    expect(pushed.entry.evalRecall).toBeNull()
    expect(pushed.entry.evalMrr).toBeNull()
    expect(pushed.lines).toContain('DC: eval not recorded (null) -- no road-law case for DC')
  })

  it('leaves the figures as they were with --no-eval, and runs no eval', async () => {
    const pushed = await pushDC(['--no-eval'], () => ({ evalRecall: 0, evalMrr: 0 }), staleManifest({ evalRecall: 0.9, evalMrr: 0.8 }))
    expect(pushed.asked).toEqual([])
    expect(pushed.entry.evalRecall).toBe(0.9)
    expect(pushed.entry.evalMrr).toBe(0.8)
  })

  it('keeps the push when the eval could not run: the rows are already in production, and an exit code would have somebody push again', async () => {
    const pushed = await pushDC([], () => ({ evalRecall: null, evalMrr: null, why: 'the retrieval eval could not run (exit 2)' }), staleManifest())
    expect(pushed.code).toBe(0)
    expect(pushed.entry.sha256).toBe(fingerprint('DC', dc))
    expect(pushed.entry.evalRecall).toBeNull()
  })

  it('scores a run that scored nothing as null, never as a perfect recall over no cases', () => {
    expect(figuresOf({ scored: 0, recallAtPool: null, mrr: null })).toEqual({ evalRecall: null, evalMrr: null, why: 'no case with a gold law to score' })
    expect(figuresOf({ scored: 4, recallAtPool: 0.75, mrr: 0.41234 })).toEqual({ evalRecall: 0.75, evalMrr: 0.412 })
  })

  it('keeps an absent figure absent under --no-eval, so a state never measured does not read as measured at null', () => {
    expect(withFigures({ laws: 1, sha256: 'x' }, undefined, 'skipped')).toEqual({ laws: 1, sha256: 'x' })
  })

  // The harness is never run by the suite (each run costs model calls); what
  // it decides before spawning one is what is tested here, over a fixture of
  // its own.
  describe('before the harness is asked', () => {
    const fixtureRoot = (cases: unknown[]) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'push-eval-root-'))
      mkdirSync(path.join(dir, path.dirname(FIXTURE_FILE)), { recursive: true })
      writeFileSync(path.join(dir, FIXTURE_FILE), JSON.stringify({ cases }))
      return dir
    }
    const roadLaw = (state: string, extra: object = {}) => ({ lang: 'en', state, question: `q ${state}`, expect: { scope: 'road-law' }, ...extra })
    const keyed = { ANTHROPIC_API_KEY: 'set' }

    it('writes null for a state with no road-law case, naming the fixture', () => {
      const dir = fixtureRoot([roadLaw('MD', { gold: ['MD-1'] }), roadLaw('DC', { retired: 'gone' }), roadLaw('DC', { holdout: true, gold: ['DC-1'] })])
      expect(harnessEval(dir, keyed)('DC')).toEqual({ evalRecall: null, evalMrr: null, why: `no road-law case for DC in ${FIXTURE_FILE}` })
    })

    it('writes null for a state whose cases have no gold law, since recall needs one', () => {
      const dir = fixtureRoot([roadLaw('DC'), roadLaw('DC')])
      expect(harnessEval(dir, keyed)('DC')).toEqual({ evalRecall: null, evalMrr: null, why: '2 case(s) for DC, none with a gold law to score' })
    })

    it('stops a harness that runs past its time and writes null saying so, so a stuck eval cannot hold a finished push open', () => {
      const dir = fixtureRoot([roadLaw('DC', { gold: ['DC-1'] })])
      const asked: number[] = []
      const timedOut: Spawn = (_command, _args, options) => {
        asked.push(options.timeout)
        return { status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
      }
      const result = harnessEval(dir, keyed, timedOut)('DC')
      expect(asked).toEqual([EVAL_TIMEOUT_MS])
      expect(result).toEqual({ evalRecall: null, evalMrr: null, why: 'the retrieval eval timed out after 45 minutes and was stopped' })
    })

    it('writes null without a model key rather than a figure for a pipeline with no rephraser', () => {
      const dir = fixtureRoot([roadLaw('DC', { gold: ['DC-1'] })])
      const result = harnessEval(dir, {})('DC')
      expect(result.evalRecall).toBeNull()
      expect(result.why).toMatch(/^ANTHROPIC_API_KEY is not set/)
    })
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
