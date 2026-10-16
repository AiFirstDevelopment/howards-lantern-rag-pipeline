import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { statesOf } from '../../scripts/law-vectors'
import type { Store } from '../../scripts/laws-store'
import { fetchState, pushState, type Picker, storedEntry } from '../../scripts/process/fetch'
import {
  MAX_PASSAGES,
  PROCESS_FAMILIES,
  PROCESS_FAMILY_IDS,
  isPage,
  pageText,
  processLawsOf,
  readProcessSources,
  readProcessState,
  verifiedPassages,
  type ProcessSources,
  type StateProcess,
} from '../../scripts/process/source'
import { refreshProcessState } from '../../scripts/statutes/refresh'
import { lawsOf, publishedLawsOf, topicsOf } from '../../scripts/statutes/laws'
import { CANDIDATE_LAWS } from '../../worker/src/law-rerank'
import { retrieve } from '../../worker/src/law-retrieval'

/**
 * The states' own pages (docs/plans/what-happens-if.md, phase 3): the
 * registry that names them, the fetch that keeps a page's passages only where
 * the page says them, and the monthly check that they still do. Everything
 * here runs on fixture pages and a scripted picker; the live fetch is
 * `npm run process:fetch`, and its run is in the pull request.
 */
const ROOT = process.cwd()

describe('the registry of the states’ own pages', () => {
  const registry = readProcessSources(ROOT)

  // Criterion 15: every state, every family, a page or an honest none.
  it('names an official page or none with a reason for every state and every family', () => {
    for (const code of statesOf(ROOT)) {
      const entry = registry[code]
      expect(entry, `${code} has no entry in resource/process/SOURCES.json`).toBeDefined()
      expect(Object.keys(entry).sort(), code).toEqual([...PROCESS_FAMILY_IDS].sort())
      for (const family of PROCESS_FAMILY_IDS) {
        const page = entry[family]
        if (isPage(page)) {
          expect(page.url, `${code} ${family}`).toMatch(/^https:\/\//)
          expect(page.title.trim(), `${code} ${family} has no title`).not.toBe('')
          expect(page.agency.trim(), `${code} ${family} has no agency`).not.toBe('')
          expect(page.retrieved, `${code} ${family}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        } else {
          expect(page.none.trim(), `${code} ${family} is none with no reason`).not.toBe('')
        }
      }
    }
  })

  // #796 left seventeen registered pages that stored nothing, and the family
  // lookup for each returned nothing without a word: a page is registered
  // because it states the rule, so one with no passage committed is a page
  // that needs replacing or a family that is none, said here.
  it('has passages committed for every page it registers, or the family is none', () => {
    const empty: string[] = []
    for (const code of statesOf(ROOT)) {
      const state = readProcessState(ROOT, code)
      for (const family of PROCESS_FAMILY_IDS) {
        if (isPage(registry[code][family]) && (state?.families[family]?.passages.length ?? 0) === 0) empty.push(`${code} ${family}`)
      }
    }
    expect(empty).toEqual([])
  })

  // Criterion 16 on what is committed: a family's passages come from the page
  // the registry names for it, at most five, dated, and published with the
  // state's file as rows of the state's own page.
  it('holds at most five passages a family, each from the registered page, dated, and published with the state’s laws', () => {
    for (const code of statesOf(ROOT)) {
      const state = readProcessState(ROOT, code)
      if (state === null) continue
      for (const [family, kept] of Object.entries(state.families)) {
        const page = registry[code][family as (typeof PROCESS_FAMILY_IDS)[number]]
        expect(isPage(page) && page.url, `${code} ${family} is committed from a page the registry does not name`).toBe(kept!.url)
        expect(kept!.passages.length, `${code} ${family}`).toBeGreaterThan(0)
        expect(kept!.passages.length, `${code} ${family}`).toBeLessThanOrEqual(MAX_PASSAGES)
        expect(kept!.as_of, `${code} ${family}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
      const published = publishedLawsOf(ROOT, code).filter((law) => law.kind === 'process')
      expect(published.map((law) => law.id), code).toEqual(processLawsOf(ROOT, code).map((law) => law.id))
    }
  })
})

/**
 * A page row is given by its family's key and found by meaning, never ranked
 * by words: each carries its family's question, and by words the rows filled
 * the reranker's pool for the topic questions they share words with --
 * Pennsylvania's and West Virginia's permit-holding verdicts, South
 * Carolina's curfew and Vermont's passenger limit fell out of it. These four
 * states' pools, for every topic question, are what they were without pages.
 */
describe('a state’s own pages and the pool ranked by words', () => {
  for (const code of ['PA', 'SC', 'VT', 'WV']) {
    it(`${code}: ranks the same laws by words for every topic question with its pages published as without them`, () => {
      const without = lawsOf(ROOT, code)
      const withPages = publishedLawsOf(ROOT, code)
      expect(withPages.length, `${code} has no page rows to test against`).toBeGreaterThan(without.length)
      for (const topic of topicsOf(ROOT)) {
        expect(retrieve(withPages, topic.question, CANDIDATE_LAWS).map((law) => law.id), topic.id).toEqual(retrieve(without, topic.question, CANDIDATE_LAWS).map((law) => law.id))
      }
    })
  }
})

/** A temporary repository root holding a registry, and the files the fetch writes. */
function rootWith(sources: ProcessSources, committed?: StateProcess): string {
  const root = mkdtempSync(path.join(tmpdir(), 'process-'))
  mkdirSync(path.join(root, 'resource/process'), { recursive: true })
  writeFileSync(path.join(root, 'resource/process/SOURCES.json'), JSON.stringify(sources))
  if (committed !== undefined) writeFileSync(path.join(root, `resource/process/${committed.state}.json`), JSON.stringify(committed))
  return root
}

const RETAKE_URL = 'https://mva.example.gov/skills-test'
const TICKET_URL = 'https://courts.example.gov/traffic'
const none = { none: 'no official page states it' }
const SOURCES: ProcessSources = {
  MD: {
    'gdl-rules': none,
    'provisional-sanctions': none,
    'test-and-retake': { url: RETAKE_URL, title: 'Driver Skills Test', agency: 'Maryland Motor Vehicle Administration', retrieved: '2026-10-11' },
    'permit-holding': none,
    'insurance-minimums': none,
    'ticket-procedure': { url: TICKET_URL, title: 'Traffic Citations', agency: 'District Court of Maryland', retrieved: '2026-10-11' },
  },
}
const RETAKE_PAGE = `<html><body><nav>Home | Renew | Retake a test</nav><main><h1>Driver Skills Test</h1>
<p>If you fail the skills test, you must wait 15 days before you may take it again.</p>
<p>A fee of $30&nbsp;is charged for each re-test.</p><p>Bring your learner's permit.</p></main><footer>Contact us</footer></body></html>`
const TICKET_PAGE = '<html><body><p>You must pay the fine or request a trial within 30 days of the date the citation was issued.</p></body></html>'

/** A picker that proposes `passages` for each family, and records which families it was asked about. */
function picker(passages: Record<string, string[]>): Picker & { asked: string[] } {
  const asked: string[] = []
  return Object.assign(async (family: (typeof PROCESS_FAMILIES)[number]) => (asked.push(family.id), passages[family.id] ?? []), { asked })
}

const reading = (pages: Record<string, string>) => async (url: string) => {
  if (pages[url] === undefined) throw new Error(`${url} answered 503`)
  return pages[url]
}

describe('a passage the page does not say is not stored', () => {
  // Guard 11: one figure moved is a different rule. A check that forgave case
  // and folded figures away would store "10 days" under a page that says 15.
  it('drops and names a passage whose figure or word differs from the page, and keeps the one the page says', () => {
    const { passages, dropped } = verifiedPassages(
      'test-and-retake',
      ['If you fail the skills test, you must wait 10 days before you may take it again.', 'If you fail the skills test, you must wait 15 days before you may take it again.', 'A fee of $30 is charged for each retest.'],
      RETAKE_PAGE,
    )
    expect(passages).toEqual(['If you fail the skills test, you must wait 15 days before you may take it again.'])
    expect(dropped).toEqual([
      { family: 'test-and-retake', passage: 'If you fail the skills test, you must wait 10 days before you may take it again.', reason: 'not in the fetched page' },
      { family: 'test-and-retake', passage: 'A fee of $30 is charged for each retest.', reason: 'not in the fetched page' },
    ])
  })

  it('forgives white space, markup and curly quotes, and nothing else', () => {
    expect(verifiedPassages('test-and-retake', ['A fee of $30 is charged\n  for each re-test.'], RETAKE_PAGE).passages).toEqual(['A fee of $30 is charged for each re-test.'])
    expect(verifiedPassages('test-and-retake', ["Bring your learner's permit."], RETAKE_PAGE.replace("learner's", 'learner’s')).passages).toEqual(["Bring your learner's permit."])
    expect(verifiedPassages('test-and-retake', ['a fee of $30 is charged for each re-test.'], RETAKE_PAGE).passages).toEqual([])
    expect(pageText(RETAKE_PAGE)).not.toContain('Renew')
  })

  // Minnesota's page carried its retest fee only in the Next.js data script,
  // which is dropped with every script: the family stored nothing.
  it('reads the words a Next.js page keeps in its data script, as the page’s own', () => {
    const page = `<html><body><main><h2>Phase I - Instruction permit</h2></main><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { body: '<ul><li>You will be charged an additional $10 retest fee after two failed tests.</li></ul>', path: '/divisions/dvs', className: 'accordion' } },
    })}</script></body></html>`
    expect(verifiedPassages('test-and-retake', ['You will be charged an additional $10 retest fee after two failed tests.'], page).passages).toHaveLength(1)
    expect(pageText(page)).not.toContain('/divisions/dvs')
  })

  // DC's "nor can you request a refund</a>." read as "refund ." and the
  // copied sentence was dropped for a space no reader sees.
  it('reads a sentence whose full stop follows a closing tag as the sentence', () => {
    const page = '<html><body><p>You cannot contest a ticket once you have paid the fine nor can you request a <a href="/refund">refund</a>.</p></body></html>'
    expect(verifiedPassages('ticket-procedure', ['You cannot contest a ticket once you have paid the fine nor can you request a refund.'], page).passages).toHaveLength(1)
  })

  // Verifier, 2026-10-11: as letters, "5 days" is in "15 days".
  it('drops a passage that begins or ends inside a word of the page', () => {
    expect(verifiedPassages('test-and-retake', ['5 days before you may take it again.', 'If you fail the skills test, you must wait 1'], RETAKE_PAGE).passages).toEqual([])
    expect(verifiedPassages('test-and-retake', ['you must wait 15 days'], RETAKE_PAGE).passages).toEqual(['you must wait 15 days'])
  })

  it('keeps at most five passages and each once', () => {
    const page = Array.from({ length: 7 }, (_, n) => `Rule number ${n + 1} applies.`).join(' ')
    const proposed = [...Array.from({ length: 7 }, (_, n) => `Rule number ${n + 1} applies.`), 'Rule number 1 applies.']
    const { passages, dropped } = verifiedPassages('gdl-rules', proposed, page)
    expect(passages).toHaveLength(MAX_PASSAGES)
    expect(dropped.map((each) => each.reason)).toEqual(['past the first 5', 'past the first 5'])
  })
})

describe('npm run process:fetch', () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
  const logged: string[] = []
  const log = (line: string) => logged.push(line)

  // Criterion 16: Maryland's pages, each family's passages checked against
  // its page, stored as rows of kind process with the page's citation and
  // the day it was read; a passage the page does not say dropped and named.
  it('stores each family’s passages that the page says, as dated process rows citing the page, and names the one it does not', async () => {
    const root = rootWith(SOURCES)
    roots.push(root)
    const pick = picker({
      'test-and-retake': ['If you fail the skills test, you must wait 15 days before you may take it again.', 'You must wait two weeks.'],
      'ticket-procedure': ['You must pay the fine or request a trial within 30 days of the date the citation was issued.'],
    })
    const { written, dropped } = await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE, [TICKET_URL]: TICKET_PAGE }), pick, today: '2026-10-11', log })
    expect(written).toBe(true)
    expect(dropped).toEqual([{ family: 'test-and-retake', passage: 'You must wait two weeks.', reason: 'not in the fetched page' }])
    expect(logged).toContain('NOT STORED MD test-and-retake: not in the fetched page: "You must wait two weeks."')
    expect(processLawsOf(root, 'MD')).toEqual([
      {
        id: 'MD-R-test-and-retake-1',
        law: 'If you fail the skills test, you must wait 15 days before you may take it again.',
        question: 'If I fail my driving test, how soon can I take it again?',
        concept: 'test-and-retake',
        citation: "Maryland Motor Vehicle Administration — Driver Skills Test — 'If you fail the skills test, you must wait 15 days before you may take it again.'",
        kind: 'process',
        asOf: '2026-10-11',
      },
      {
        id: 'MD-R-ticket-procedure-1',
        law: 'You must pay the fine or request a trial within 30 days of the date the citation was issued.',
        question: 'What do I do after I get a traffic ticket?',
        concept: 'ticket-procedure',
        citation: "District Court of Maryland — Traffic Citations — 'You must pay the fine or request a trial within 30 days of the date the citation was issued.'",
        kind: 'process',
        asOf: '2026-10-11',
      },
    ])
  })

  // The production push re-runs the fetch: a page that still says what was
  // reviewed must store exactly that, with no model asked and no new date.
  it('asks nothing and writes nothing again while the page still says every committed passage', async () => {
    const root = rootWith(SOURCES)
    roots.push(root)
    const read = reading({ [RETAKE_URL]: RETAKE_PAGE, [TICKET_URL]: TICKET_PAGE })
    await fetchState(root, 'MD', { read, pick: picker({ 'test-and-retake': ['A fee of $30 is charged for each re-test.'] }), today: '2026-10-11', log })
    const before = readFileSync(path.join(root, 'resource/process/MD.json'), 'utf8')
    const again = picker({ 'test-and-retake': ['Bring your learner\'s permit.'] })
    const { written } = await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE.replace('Contact us', 'Call us'), [TICKET_URL]: TICKET_PAGE }), pick: again, today: '2026-11-11', log })
    expect(written).toBe(false)
    expect(again.asked).toEqual(['ticket-procedure'])
    expect(readFileSync(path.join(root, 'resource/process/MD.json'), 'utf8')).toBe(before)
  })

  // Five pages changed their text within hours of #796 (a date, a nonce, a
  // counter) and a fetch keyed on the page's hash would re-ask the model each
  // time, storing new passages for a rule that never moved. The committed
  // passages are what is compared: while every one is still on the page,
  // they stand, the date and the page's recorded hash with them.
  it('keeps a page’s passages, asking nothing, when all that changed on it is a date and a nonce', async () => {
    const dated = (day: string, nonce: string) => RETAKE_PAGE.replace('<footer>', `<p>Page last updated ${day}.</p><input type="hidden" value="${nonce}"><footer>`)
    const root = rootWith(SOURCES)
    roots.push(root)
    await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: dated('October 11, 2026', 'a1b2'), [TICKET_URL]: TICKET_PAGE }), pick: picker({ 'test-and-retake': ['A fee of $30 is charged for each re-test.'], 'ticket-procedure': ['You must pay the fine or request a trial within 30 days of the date the citation was issued.'] }), today: '2026-10-11', log })
    const before = readFileSync(path.join(root, 'resource/process/MD.json'), 'utf8')
    const again = picker({ 'test-and-retake': ['Bring your learner\'s permit.'] })
    const { written } = await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: dated('October 12, 2026', 'z9y8'), [TICKET_URL]: TICKET_PAGE }), pick: again, today: '2026-10-12', log })
    expect(written).toBe(false)
    expect(again.asked).toEqual([])
    expect(readFileSync(path.join(root, 'resource/process/MD.json'), 'utf8')).toBe(before)
  })

  it('asks again and replaces a family’s passages when one of them is gone from its page', async () => {
    const committed: StateProcess = {
      state: 'MD',
      families: {
        'test-and-retake': { url: RETAKE_URL, title: 'Driver Skills Test', agency: 'Maryland Motor Vehicle Administration', as_of: '2026-10-11', page: 'x', passages: ['A fee of $30 is charged for each re-test.', 'You must wait 9 days.'] },
      },
    }
    const root = rootWith(SOURCES, committed)
    roots.push(root)
    const again = picker({ 'test-and-retake': ['If you fail the skills test, you must wait 15 days before you may take it again.'] })
    const { written } = await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE, [TICKET_URL]: TICKET_PAGE }), pick: again, today: '2026-11-11', log })
    expect(written).toBe(true)
    expect(again.asked).toContain('test-and-retake')
    expect(readProcessState(root, 'MD')!.families['test-and-retake']).toMatchObject({ as_of: '2026-11-11', passages: ['If you fail the skills test, you must wait 15 days before you may take it again.'] })
  })

  // As penalties:fetch refuses to empty a schedule: a page that moved and
  // reads as saying nothing must not delete the rows a learner is shown.
  it('writes nothing for the state when a page with committed passages gives none', async () => {
    const committed: StateProcess = {
      state: 'MD',
      families: { 'test-and-retake': { url: RETAKE_URL, title: 'Driver Skills Test', agency: 'Maryland Motor Vehicle Administration', as_of: '2026-10-11', page: 'x', passages: ['You must wait 9 days.'] } },
    }
    const root = rootWith(SOURCES, committed)
    roots.push(root)
    await expect(fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE, [TICKET_URL]: TICKET_PAGE }), pick: picker({}), today: '2026-11-11', log })).rejects.toThrow(
      'MD test-and-retake: the page gave no passages where 1 are committed; nothing written',
    )
    expect(readProcessState(root, 'MD')).toEqual(committed)
  })

  it('keeps a family’s committed passages when its page cannot be had, and names it unreachable', async () => {
    const committed: StateProcess = {
      state: 'MD',
      families: { 'ticket-procedure': { url: TICKET_URL, title: 'Traffic Citations', agency: 'District Court of Maryland', as_of: '2026-10-11', page: 'x', passages: ['You must pay the fine or request a trial within 30 days of the date the citation was issued.'] } },
    }
    const root = rootWith(SOURCES, committed)
    roots.push(root)
    const { unreachable, state } = await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE }), pick: picker({ 'test-and-retake': ['A fee of $30 is charged for each re-test.'] }), today: '2026-11-11', log })
    expect(unreachable).toEqual(['ticket-procedure'])
    expect(state.families['ticket-procedure']).toEqual(committed.families['ticket-procedure'])
  })

  // The push touches the state's page rows and nothing else: a delete that
  // matched every id the file does not hold would empty the state's code.
  it('pushes the state’s page rows and deletes only the page rows the file no longer holds', async () => {
    const root = rootWith(SOURCES)
    roots.push(root)
    await fetchState(root, 'MD', { read: reading({ [RETAKE_URL]: RETAKE_PAGE, [TICKET_URL]: TICKET_PAGE }), pick: picker({ 'test-and-retake': ['A fee of $30 is charged for each re-test.'] }), today: '2026-10-11', log })
    const ran: string[] = []
    const store: Store = { run: async (statements) => void ran.push(...statements), ids: async () => ['MD-C-16-112-b', 'MD-399', 'MD-R-test-and-retake-1', 'MD-R-test-and-retake-2', 'MD-R-gdl-rules-1'] }
    expect(await pushState(store, root, 'MD')).toBe(1)
    expect(ran[0]).toContain("'MD-R-test-and-retake-1', 'MD', 'process'")
    expect(ran.slice(1)).toEqual(["DELETE FROM laws WHERE state = 'MD' AND id IN ('MD-R-test-and-retake-2', 'MD-R-gdl-rules-1')"])
  })
})

describe('the monthly check of the states’ own pages', () => {
  const committed: StateProcess = {
    state: 'MD',
    families: {
      'test-and-retake': { url: RETAKE_URL, title: 'Driver Skills Test', agency: 'Maryland Motor Vehicle Administration', as_of: '2026-10-11', page: 'x', passages: ['If you fail the skills test, you must wait 15 days before you may take it again.'] },
      'ticket-procedure': { url: TICKET_URL, title: 'Traffic Citations', agency: 'District Court of Maryland', as_of: '2026-10-11', page: 'x', passages: ['You must pay the fine or request a trial within 30 days of the date the citation was issued.'] },
    },
  }

  it('reports a page that no longer says a committed passage as changed, naming the passage, and one that does as unchanged', async () => {
    const root = rootWith(SOURCES, committed)
    const report = await refreshProcessState(root, 'MD', reading({ [RETAKE_URL]: RETAKE_PAGE.replace('15 days', '10 days'), [TICKET_URL]: TICKET_PAGE }))
    rmSync(root, { recursive: true, force: true })
    expect(report.status).toBe('changed')
    expect(report.families['test-and-retake']).toMatchObject({ status: 'changed', gone: ['If you fail the skills test, you must wait 15 days before you may take it again.'] })
    expect(report.families['ticket-procedure']).toMatchObject({ status: 'unchanged', gone: [] })
  })

  // A court's site down on the day of the check is not a page that still
  // says what it said.
  it('reports a page that could not be fetched as unreachable, never as unchanged', async () => {
    const root = rootWith(SOURCES, committed)
    const report = await refreshProcessState(root, 'MD', reading({ [RETAKE_URL]: RETAKE_PAGE }))
    rmSync(root, { recursive: true, force: true })
    expect(report.families['ticket-procedure']).toMatchObject({ status: 'unreachable', error: `${TICKET_URL} answered 503` })
    expect(report.status).toBe('unreachable')
  })
})

describe('a page push keeps the state’s retrieval figures honest', () => {
  // process:fetch --push rewrote the entry as {laws, sha256} and dropped the
  // figures laws:store and laws:embed record beside the hash.
  it('keeps the figures while the hash is the one they were measured on', () => {
    expect(storedEntry({ laws: 10, sha256: 'a', evalRecall: 0.9, evalMrr: 0.8 }, 10, 'a')).toEqual({ laws: 10, sha256: 'a', evalRecall: 0.9, evalMrr: 0.8 })
  })

  it('nulls them when the pages moved the hash, never an old figure beside a new hash', () => {
    expect(storedEntry({ laws: 10, sha256: 'a', evalRecall: 0.9, evalMrr: 0.8 }, 12, 'b')).toEqual({ laws: 12, sha256: 'b', evalRecall: null, evalMrr: null })
  })

  it('adds no figures to a state that never had any', () => {
    expect(storedEntry({ laws: 10, sha256: 'a' }, 12, 'b')).toEqual({ laws: 12, sha256: 'b' })
  })
})
