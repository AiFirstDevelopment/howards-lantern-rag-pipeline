#!/usr/bin/env tsx
/**
 * The monthly check that the law the site quotes is still the law
 * (docs/plans/trusted-by-date.md, decision 10): `statutes:check` with a memory.
 *
 *   npm run statutes:refresh           every state with sources
 *   npm run statutes:refresh -- MD     one state (or several: -- MD VA)
 *
 * Every committed section is re-fetched with its state's own extractor, as
 * `statutes:check` does, and the result is written to
 * `resource/statutes/changes/<YYYY-MM-DD>.json`: per state, every section
 * checked, each one whose text moved (the hash before and after, and a unified
 * diff of at most forty lines), and each one that could not be fetched.
 * `/drivers/laws/changes/` is built from these files, so a report committed is
 * a report published at the next deploy.
 *
 * **It changes nothing it reports on.** The committed sources stay as they
 * are: applying a change is the state's existing route -- `statutes:fetch --
 * XX --refresh`, re-chunk, `laws:embed -- --push`, `laws:store -- --push XX`,
 * `statutes:judge` for a topic whose verdict law moved -- run by a person who
 * has read the diff. A refresh that rewrote a source would put a law nobody
 * read in front of learners under a date that says it was checked.
 *
 * **A fetch that fails is `unreachable`, never unchanged.** `statutes:check`
 * let an exception end the run; a report that swallowed one would publish
 * "0 changed" for a legislature whose site was down that day.
 *
 * One state at a time and one request a second, as fetch.ts does, through its
 * page cache: Colorado's title files are read once however many sections
 * anchor in them. Five failures in a row end a state's fetching -- a site that
 * is down is not asked the remaining eight hundred times with a backoff each --
 * and its remaining sections are reported unreachable, untried.
 *
 * **Then the fine schedules** (docs/plans/what-happens-if.md, decision 11):
 * every source in `resource/penalties/SOURCES.json` that has rows is fetched
 * again, its rows re-read and re-checked, and compared with the committed
 * `resource/penalties/<XX>.json`; `resource/penalties/changes/<YYYY-MM-DD>.json`
 * names each row whose figure, points or words moved, each added or gone,
 * and each source that could not be had -- `unreachable`, as for a statute.
 * Applying one is `npm run penalties:fetch -- XX` and its `--push`.
 *
 * **Then the states' own pages** (phase 3, decision 17): every page in
 * `resource/process/SOURCES.json` with committed passages is fetched again
 * and each passage looked for in it, as `process:fetch` checked it when it was
 * stored; `resource/process/changes/<YYYY-MM-DD>.json` names each family
 * whose page no longer says a committed passage (`changed`), each that still
 * says all of them (`unchanged`), and each page that could not be had
 * (`unreachable`). No model is asked: a refresh reports, and applying a
 * change is `npm run process:fetch -- XX` and its `--push`, by a person.
 *
 * **Then the state chips** (docs/plans/what-happens-if.md, phase 4, decision
 * 23): every state whose stored chip answers cite a row one of the three
 * reports says moved -- a section that changed, a schedule row that changed
 * or went, a page that no longer says a passage -- or a row the committed
 * files already hold differently, is named with the chips to re-ask, so the
 * person applying the change knows `npm run chips:build -- --states XX` is
 * part of it. tests/unit/state-chips.test.ts is red for the second kind until
 * it has run; the first kind is red from the moment the change is applied.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGES_DIR, readReports, reportFile, type Changed, type Report, type StateReport, type Unreachable } from './changes'
import { SOURCES_DIR, readSources, sectionPage, sha256, siteOf, statesWithSources } from './fetch'
import { codeChunksOf, handLawsOf, readCoverage } from './laws'
import type { Listing } from './site'
import { extract, liveReader as livePageReader, readRegistry, readState, savedReader, type PageReader } from '../penalties/fetch'
import type { PenaltyRow, Rejected } from '../penalties/source'
import { pageReader } from '../process/fetch'
import { PROCESS_FAMILIES, isPage, pageText, readProcessSources, readProcessState, verifiedPassages, type ProcessFamily } from '../process/source'
import { committedRows, readStateChips, readStoredStateChips, staleStateChips, type StoredStateChip } from '../state-chips'

export { CHANGES_DIR, readReports, reportFile }
export type { Changed, Report, StateReport, Unreachable }

/** A diff longer than this is cut, with a line saying how much was left out: the report is read, not applied. */
export const DIFF_LINES = 40

/** Consecutive failures after which a state's site is taken to be down for this run. */
export const GIVE_UP_AFTER = 5

const CONTEXT = 3
const PAUSE_MS = 1000

/** What a section's page says today, as its extractor reads it. Throws when the page cannot be had. */
export type Reader = (code: string, listing: Listing) => Promise<string>

/**
 * A unified diff of two texts, line by line, with three lines of context, cut
 * to `DIFF_LINES`. The common head and tail are trimmed first, because a
 * statute's amendment is a clause, and what is left is matched by longest
 * common subsequence; a middle too long to match is shown as replaced whole,
 * which is still the truth, only less precise.
 */
export function unifiedDiff(before: string, after: string, label: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops: { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] = []
  for (let i = 0; i < head; i += 1) ops.push({ op: ' ', line: a[i], ai: i, bi: i })
  for (const each of middleOps(midA, midB)) {
    ops.push({ ...each, ai: head + each.ai, bi: head + each.bi })
  }
  for (let i = tail; i > 0; i -= 1) ops.push({ op: ' ', line: a[a.length - i], ai: a.length - i, bi: b.length - i })

  const lines = [`--- a/${label}`, `+++ b/${label}`]
  let index = 0
  while (index < ops.length) {
    while (index < ops.length && ops[index].op === ' ') index += 1
    if (index >= ops.length) break
    const start = Math.max(0, index - CONTEXT)
    let end = index
    // A hunk runs on while the next change is within two contexts of the last.
    for (let last = index; end < ops.length; end += 1) {
      if (ops[end].op !== ' ') last = end
      else if (end - last > CONTEXT * 2) break
    }
    let stop = end
    while (stop > start && ops[stop - 1].op === ' ') stop -= 1
    stop = Math.min(ops.length, stop + CONTEXT)
    const hunk = ops.slice(start, stop)
    const fromA = hunk.find((each) => each.op !== '+')
    const fromB = hunk.find((each) => each.op !== '-')
    const countA = hunk.filter((each) => each.op !== '+').length
    const countB = hunk.filter((each) => each.op !== '-').length
    lines.push(`@@ -${(fromA?.ai ?? hunk[0].ai) + (countA === 0 ? 0 : 1)},${countA} +${(fromB?.bi ?? hunk[0].bi) + (countB === 0 ? 0 : 1)},${countB} @@`)
    for (const each of hunk) lines.push(`${each.op}${each.line}`)
    index = stop
  }
  if (lines.length <= DIFF_LINES) return lines.join('\n')
  return [...lines.slice(0, DIFF_LINES - 1), `… ${lines.length - (DIFF_LINES - 1)} more lines`].join('\n')
}

/** The edit script for the part of two texts that differs; positions are within the slices. */
function middleOps(a: string[], b: string[]): { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] {
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((line, ai) => ({ op: '-' as const, line, ai, bi: 0 })),
      ...b.map((line, bi) => ({ op: '+' as const, line, ai: a.length, bi })),
    ]
  }
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const out: { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: ' ', line: a[i], ai: i, bi: j })
      i += 1
      j += 1
    } else if (j < b.length && (i >= a.length || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])) {
      out.push({ op: '+', line: b[j], ai: i, bi: j })
      j += 1
    } else {
      out.push({ op: '-', line: a[i], ai: i, bi: j })
      i += 1
    }
  }
  return out
}

/**
 * The deployed reader: the state's site module, through fetch.ts's page cache
 * and its retries, one request a second.
 */
export function liveReader(): Reader {
  const sites = new Map<string, Awaited<ReturnType<typeof siteOf>>>()
  return async (code, listing) => {
    if (!sites.has(code)) sites.set(code, await siteOf(code))
    const site = sites.get(code)
    if (site == null) throw new Error(`no site module at scripts/statutes/sites/${code}.ts`)
    const { page, cached } = sectionPage(site, listing)
    try {
      return site.extract((await page).body, listing)
    } finally {
      // Polite to the site, not to the cache, as fetch.ts is.
      if (!cached) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
    }
  }
}

/** One state's sections against what their pages serve today. Reads the committed sources; writes nothing. */
export async function refreshState(root: string, code: string, read: Reader, log: (line: string) => void = () => {}): Promise<StateReport> {
  const sources = readSources(root, code)
  const report: StateReport = { checked: [], changed: [], unreachable: [] }
  if (sources === null) return report
  let failures = 0
  for (const [file, source] of Object.entries(sources.files)) {
    const listing: Listing = { file, url: source.url, section: source.section, cite: source.cite, heading: source.heading }
    report.checked.push(file)
    const where = { file, cite: source.cite, heading: source.heading, url: source.url }
    if (failures >= GIVE_UP_AFTER) {
      report.unreachable.push({ ...where, error: `not tried: the ${GIVE_UP_AFTER} sections before it could not be fetched` })
      continue
    }
    let text: string
    try {
      text = await read(code, listing)
      failures = 0
    } catch (error) {
      failures += 1
      report.unreachable.push({ ...where, error: error instanceof Error ? error.message : String(error) })
      log(`UNREACHABLE ${code} ${file}: ${source.url}`)
      continue
    }
    const after = sha256(text)
    if (after === source.sha256) continue
    const committed = path.join(root, SOURCES_DIR, code, `${file}.txt`)
    const before = existsSync(committed) ? readFileSync(committed, 'utf8') : ''
    report.changed.push({ ...where, before: source.sha256, after, diff: unifiedDiff(before, text, `${code}/${file}.txt`) })
    log(`CHANGED ${code} ${file}: ${source.url}`)
  }
  return report
}

/** A comparison whose verdict law was cut from a section that changed: the topics `statutes:judge` must look at again. */
export interface AffectedVerdict {
  state: string
  topic: string
  law: string
  file: string
}

/**
 * The verdicts a report touches: every topic whose verdict law -- a code
 * chunk or a hand-written statute law -- was taken from a section the report
 * lists as changed. What `/refresh-codes` puts in its PR, so the person
 * applying a change knows which comparisons and which nationwide answers
 * rest on the words that moved.
 */
export function affectedVerdicts(root: string, report: Report): AffectedVerdict[] {
  const coverage = readCoverage(root)
  const out: AffectedVerdict[] = []
  for (const [state, result] of Object.entries(report.states)) {
    if (result.changed.length === 0) continue
    const changed = new Set(result.changed.map((each) => each.file))
    const sectionOf = new Map([...(handLawsOf(root, state) ?? []), ...codeChunksOf(root, state)].map((law) => [law.id, law.source]))
    for (const [topic, verdict] of Object.entries(coverage[state] ?? {})) {
      const file = verdict.law === undefined ? undefined : sectionOf.get(verdict.law)
      if (file !== undefined && changed.has(file)) out.push({ state, topic, law: verdict.law!, file })
    }
  }
  return out
}

/**
 * One run: the named states (every state with sources when none is named),
 * written into today's report. A report already written today keeps the
 * states this run did not check, so one state a day -- the polite way to do
 * forty-six -- still makes one report per day.
 */
export async function refresh(
  root: string,
  codes: readonly string[],
  options: { read?: Reader; today?: string; log?: (line: string) => void } = {},
): Promise<Report> {
  const log = options.log ?? console.log
  const read = options.read ?? liveReader()
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const states = codes.length === 0 ? statesWithSources(root) : [...codes]
  for (const code of states) {
    if (readSources(root, code) === null) throw new Error(`${code} has no committed sources at ${SOURCES_DIR}/${code}/SOURCES.json`)
  }
  const file = reportFile(root, today)
  const report: Report = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Report) : { ran: today, states: {} }
  for (const code of states) {
    const state = await refreshState(root, code, read, log)
    report.states[code] = state
    // Written after every state, so a run that dies at the thirtieth keeps twenty-nine.
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ ran: today, states: sorted(report.states) }, null, 2) + '\n')
    log(`${code}: ${state.checked.length} checked, ${state.changed.length} changed, ${state.unreachable.length} unreachable`)
  }
  const all = Object.values(report.states)
  const count = (pick: (state: StateReport) => unknown[]) => all.reduce((sum, state) => sum + pick(state).length, 0)
  log(
    `${path.relative(root, file)}: ${all.length} state(s), ${count((state) => state.checked)} sections checked, ` +
      `${count((state) => state.changed)} changed, ${count((state) => state.unreachable)} unreachable`,
  )
  const written: Report = { ran: today, states: sorted(report.states) }
  const affected = affectedVerdicts(root, written)
  for (const each of affected) log(`VERDICT ${each.state} ${each.topic}: ${each.law} (from ${each.file})`)
  log(affected.length === 0 ? 'no verdict law was cut from a section that changed' : `${affected.length} verdict(s) rest on a section that changed`)
  return written
}

/** Where the penalties pass writes its report: beside the rows it checks, apart from the statutes' published changes page. */
export const PENALTY_CHANGES_DIR = 'resource/penalties/changes'

/** A committed schedule row whose figure, points, appearance or words are not what the source says today. */
export interface PenaltyChanged {
  id: string
  section: string
  /** The row as committed, in a line a person reads: "$50.00, 0 points, payable". */
  before: string
  after: string
}

export interface PenaltyStateReport {
  /**
   * `unreachable` when the source could not be had -- never `unchanged`: a
   * court's site down on the day of the check is not a schedule that stayed
   * the same, and a report that said so would vouch for a fine nobody read.
   */
  status: 'changed' | 'unchanged' | 'unreachable'
  /** How many committed rows were compared. */
  checked: number
  changed: PenaltyChanged[]
  /** Ids the source holds today and the committed file does not. */
  added: string[]
  /** Ids the committed file holds and the source no longer does, or no longer says in the committed words. */
  removed: string[]
  /** Rows the source proposed whose quote is not in its text today. */
  notWritten: Rejected[]
  error?: string
}

export interface PenaltyReport {
  ran: string
  states: Record<string, PenaltyStateReport>
}

const summary = (row: PenaltyRow) => `${row.fine_text}, ${row.points === null ? 'no points listed' : `${row.points} points`}, ${row.appear} — '${row.quote}'`

/**
 * One state's committed schedule rows against what its source says today
 * (docs/plans/what-happens-if.md, decision 11). Reads the committed file;
 * writes nothing. Applying a change is `npm run penalties:fetch -- XX` and its
 * `--push`, run by a person who has read the report, as for a code.
 */
export async function refreshPenaltyState(root: string, code: string, read: PageReader, today: string): Promise<PenaltyStateReport> {
  const source = readRegistry(root)[code]
  const committed = readState(root, code)?.rows ?? []
  const report: PenaltyStateReport = { status: 'unchanged', checked: committed.length, changed: [], added: [], removed: [], notWritten: [] }
  let found: Awaited<ReturnType<typeof extract>>
  try {
    found = await extract(code, source, savedReader(root, source, read), today)
  } catch (error) {
    return { ...report, status: 'unreachable', error: error instanceof Error ? error.message : String(error) }
  }
  const before = new Map(committed.map((row) => [row.id, row]))
  const after = new Map(found.rows.map((row) => [row.id, row]))
  for (const [id, row] of before) {
    const now = after.get(id)
    if (now === undefined) report.removed.push(id)
    else if (summary(now) !== summary(row) || now.offence !== row.offence || now.section !== row.section) {
      report.changed.push({ id, section: row.section, before: summary(row), after: summary(now) })
    }
  }
  for (const id of after.keys()) if (!before.has(id)) report.added.push(id)
  report.notWritten = found.rejected
  if (report.changed.length + report.added.length + report.removed.length > 0) report.status = 'changed'
  return report
}

/**
 * The penalties pass of the monthly refresh: every registered source with
 * rows, re-fetched and compared with what is committed, written to
 * `resource/penalties/changes/<YYYY-MM-DD>.json`. A state named that has no
 * rows registered is skipped; one whose source throws is `unreachable`.
 */
export async function refreshPenalties(
  root: string,
  codes: readonly string[],
  options: { read?: PageReader; today?: string; log?: (line: string) => void } = {},
): Promise<PenaltyReport> {
  const log = options.log ?? console.log
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const registry = existsSync(path.join(root, 'resource/penalties/SOURCES.json')) ? readRegistry(root) : {}
  const states = Object.keys(registry).filter((code) => registry[code].format !== 'none' && (codes.length === 0 || codes.includes(code)))
  const file = path.join(root, PENALTY_CHANGES_DIR, `${today}.json`)
  const report: PenaltyReport = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PenaltyReport) : { ran: today, states: {} }
  if (states.length === 0) return report
  const read = options.read ?? livePageReader()
  for (const code of states) {
    const state = await refreshPenaltyState(root, code, read, today)
    report.states[code] = state
    for (const each of state.changed) log(`PENALTY CHANGED ${code} ${each.id}: ${each.before} -> ${each.after}`)
    for (const id of state.added) log(`PENALTY ADDED ${code} ${id}`)
    for (const id of state.removed) log(`PENALTY REMOVED ${code} ${id}`)
    if (state.status === 'unreachable') log(`PENALTY UNREACHABLE ${code}: ${state.error}`)
    log(`${code} penalties: ${state.status}, ${state.checked} rows checked, ${state.changed.length} changed, ${state.added.length} added, ${state.removed.length} removed`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ ran: today, states: Object.fromEntries(Object.entries(report.states).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`)
  }
  return report
}

/** Where the process pass writes its report: beside the passages it checks. */
export const PROCESS_CHANGES_DIR = 'resource/process/changes'

export interface ProcessFamilyReport {
  /**
   * `unreachable` when the page could not be had -- never `unchanged`: an
   * agency's site down on the day of the check is not a page that still says
   * what it said, and a report that said so would vouch for a wait nobody read.
   */
  status: 'changed' | 'unchanged' | 'unreachable'
  url: string
  /** How many committed passages were looked for. */
  checked: number
  /** The committed passages the page no longer says, word for word. */
  gone: string[]
  error?: string
}

export interface ProcessReport {
  ran: string
  states: Record<string, { status: 'changed' | 'unchanged' | 'unreachable'; families: Partial<Record<ProcessFamily, ProcessFamilyReport>> }>
}

/**
 * One state's committed passages against its pages today (decision 17):
 * each page fetched once, each passage looked for in it. Reads; writes
 * nothing. A state is `unreachable` if any page was, else `changed` if any
 * family's was, else `unchanged`.
 */
export async function refreshProcessState(root: string, code: string, read: PageReader): Promise<ProcessReport['states'][string]> {
  const entry = readProcessSources(root)[code] ?? {}
  const committed = readProcessState(root, code)
  const families: Partial<Record<ProcessFamily, ProcessFamilyReport>> = {}
  const texts = new Map<string, Promise<string>>()
  for (const family of PROCESS_FAMILIES) {
    const kept = committed?.families[family.id]
    const page = entry[family.id]
    if (kept === undefined || !isPage(page)) continue
    try {
      if (!texts.has(kept.url)) texts.set(kept.url, read(kept.url).then(pageText))
      const text = await texts.get(kept.url)!
      const gone = kept.passages.filter((passage) => verifiedPassages(family.id, [passage], text).passages.length === 0)
      families[family.id] = { status: gone.length === 0 ? 'unchanged' : 'changed', url: kept.url, checked: kept.passages.length, gone }
    } catch (error) {
      families[family.id] = { status: 'unreachable', url: kept.url, checked: kept.passages.length, gone: [], error: error instanceof Error ? error.message : String(error) }
    }
  }
  const statuses = Object.values(families).map((family) => family!.status)
  const status = statuses.includes('unreachable') ? 'unreachable' : statuses.includes('changed') ? 'changed' : 'unchanged'
  return { status, families }
}

/**
 * The process pass of the monthly refresh: every state with committed
 * passages, its pages re-fetched and its passages looked for, written to
 * `resource/process/changes/<YYYY-MM-DD>.json`.
 */
export async function refreshProcess(
  root: string,
  codes: readonly string[],
  options: { read?: PageReader; today?: string; log?: (line: string) => void } = {},
): Promise<ProcessReport> {
  const log = options.log ?? console.log
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const states = Object.keys(readProcessSources(root)).filter((code) => readProcessState(root, code) !== null && (codes.length === 0 || codes.includes(code)))
  const file = path.join(root, PROCESS_CHANGES_DIR, `${today}.json`)
  const report: ProcessReport = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProcessReport) : { ran: today, states: {} }
  if (states.length === 0) return report
  const read = options.read ?? pageReader()
  for (const code of states) {
    const state = await refreshProcessState(root, code, read)
    report.states[code] = state
    for (const [family, each] of Object.entries(state.families)) {
      if (each!.status === 'changed') for (const passage of each!.gone) log(`PAGE CHANGED ${code} ${family}: no longer says "${passage}"`)
      if (each!.status === 'unreachable') log(`PAGE UNREACHABLE ${code} ${family}: ${each!.error}`)
    }
    log(`${code} pages: ${state.status}, ${Object.keys(state.families).length} families checked`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ ran: today, states: Object.fromEntries(Object.entries(report.states).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`)
  }
  return report
}

/** A state whose stored chip answers rest on a row that moved: the chips to re-ask, as "<id> (<lang>)". */
export interface ChipsToRebuild {
  state: string
  chips: string[]
}

/**
 * The states whose chips the month's reports touch (decision 23): a stored
 * answer citing a law cut from a section that changed, a schedule row that
 * changed or was removed, or a row of a page that no longer says one of its
 * passages -- and any whose cited rows the committed files already hold
 * differently. Reads; writes nothing. `read` is the stored answers, from the
 * committed files unless the suite gives its own.
 */
export function chipsToRebuild(
  root: string,
  reports: { statutes?: Report; penalties?: PenaltyReport; process?: ProcessReport },
  read: (code: string) => StoredStateChip[] = (code) => readStoredStateChips(root, code),
): ChipsToRebuild[] {
  const pool = readStateChips(root)
  const states = new Set([
    ...Object.keys(reports.statutes?.states ?? {}),
    ...Object.keys(reports.penalties?.states ?? {}),
    ...Object.keys(reports.process?.states ?? {}),
  ])
  const out: ChipsToRebuild[] = []
  for (const code of [...states].sort()) {
    const stored = read(code)
    if (stored.length === 0) continue
    const statute = reports.statutes?.states[code]
    const changedFiles = new Set((statute?.changed ?? []).map((each) => each.file))
    const fromFile = changedFiles.size === 0 ? new Map<string, string>() : new Map([...(handLawsOf(root, code) ?? []), ...codeChunksOf(root, code)].map((law) => [law.id, law.source]))
    const penalty = reports.penalties?.states[code]
    const penaltyIds = new Set([...(penalty?.changed ?? []).map((each) => each.id), ...(penalty?.removed ?? [])])
    const pages = Object.entries(reports.process?.states[code]?.families ?? {}).filter(([, each]) => each?.status === 'changed').map(([family]) => `${code}-R-${family}-`)
    const moved = (id: string) => changedFiles.has(fromFile.get(id) ?? '') || penaltyIds.has(id) || pages.some((prefix) => id.startsWith(prefix))
    const chips = new Set([
      ...stored.filter((each) => each.sources.some(moved)).map((each) => `${each.id} (${each.lang})`),
      ...staleStateChips(code, stored, pool, committedRows(root, code)),
    ])
    if (chips.size > 0) out.push({ state: code, chips: [...chips] })
  }
  return out
}

/** The line a person reads in the run's output for each, and the one after them. */
export function logChipsToRebuild(rebuild: readonly ChipsToRebuild[], log: (line: string) => void = console.log): void {
  for (const each of rebuild) log(`STATE CHIPS ${each.state}: ${each.chips.join(', ')} -- rebuild with npm run chips:build -- --states ${each.state} once the change is applied`)
  log(rebuild.length === 0 ? 'no state chip rests on a row that moved' : `state chips to rebuild: ${rebuild.map((each) => each.state).join(', ')}`)
}

function sorted(states: Record<string, StateReport>): Record<string, StateReport> {
  return Object.fromEntries(Object.entries(states).sort(([left], [right]) => left.localeCompare(right)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const codes = process.argv.slice(2).filter((arg) => /^[A-Z]{2}$/.test(arg))
  // The statutes, then the fine schedules and the states' own pages
  // registered for the same states (every registered one when none is
  // named): one monthly run, three reports.
  const run = async () => {
    const statutes = await refresh(process.cwd(), codes)
    const penalties = await refreshPenalties(process.cwd(), codes)
    const pages = await refreshProcess(process.cwd(), codes)
    logChipsToRebuild(chipsToRebuild(process.cwd(), { statutes, penalties, process: pages }))
  }
  run()
    .then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error)
        process.exit(2)
      },
    )
}
