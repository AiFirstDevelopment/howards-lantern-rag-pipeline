/**
 * A state's retrieval file from what the repository committed: the manual's
 * laws, Maryland's hand-written statutes, and the state's vehicle code cut into
 * subsections (docs/plans/vehicle-code.md, decision 2).
 *
 * The one reader of those files. The Vite plugin publishes what this returns,
 * the embed script embeds it, the eval and the e2e harness retrieve from it --
 * so the law the box quotes, the law the index ranks and the law a test drives
 * cannot be three different cuts of the same section.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chunkSection, type CodeChunk } from '../../worker/src/code-chunks'
import { retrievalFile, type AskLaw } from '../../worker/src/law-retrieval'
import type { StateLaw } from '../../worker/src/law-topics'
import { processLawsOf } from '../process/source'
import type { StateSources } from './site'

export const STATUTES_DIR = 'resource/statutes'
export const SOURCES_DIR = `${STATUTES_DIR}/sources`

export function sourcesFile(code: string): string {
  return `${SOURCES_DIR}/${code}/SOURCES.json`
}

export interface HandLaw {
  id: string
  topic: string
  law: string
  question: string
  citation: string
  source: string
}

export function readSources(root: string, code: string): StateSources | null {
  const file = path.join(root, sourcesFile(code))
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StateSources) : null
}

/** Maryland's fifteen, where a state has hand-written laws; null where it has none. */
export function handLawsOf(root: string, code: string): HandLaw[] | null {
  const file = path.join(root, STATUTES_DIR, `${code}.json`)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as HandLaw[]) : null
}

/** Every chunk of every committed section of the state's code, in SOURCES.json order. Repealed markers are not law. */
export function codeChunksOf(root: string, code: string): CodeChunk[] {
  const sources = readSources(root, code)
  if (sources === null) return []
  // An id is "<section>-<label>", so two sections can meet on one: New York's
  // § 1111(b)(f) and § 1111-b(f) were both NY-C-1111-b-f. The later one, in
  // the state's own file order, takes the next free number, as chunkSection
  // does for a duplicate inside one section.
  const taken = new Set<string>()
  return unique(taken, Object.entries(sources.files).flatMap(([file, source]) =>
    source.repealed === true
      ? []
      : chunkSection({
          code,
          file,
          section: source.section,
          cite: source.cite,
          heading: source.heading,
          text: readFileSync(path.join(root, SOURCES_DIR, code, `${file}.txt`), 'utf8'),
        }),
  ))
}

function unique(taken: Set<string>, chunks: CodeChunk[]): CodeChunk[] {
  return chunks.map((chunk) => {
    let id = chunk.id
    for (let n = 2; taken.has(id); n += 1) id = `${chunk.id}-${n}`
    taken.add(id)
    return id === chunk.id ? chunk : { ...chunk, id }
  })
}

export const SUPERSEDED_FILE = `${STATUTES_DIR}/superseded.json`

/** A manual law its state's own code contradicts: the chunk that does, and how. */
export interface Superseded {
  by: string
  why: string
}

/**
 * Manual laws the ask box does not answer from, because the state's code says
 * otherwise -- Vermont's manual gives 15 days to show proof of insurance, its
 * § 800(c) seven business days, and an answer quoting the manual would cost a
 * learner the deadline. Only a misstated limit or penalty is listed; a manual
 * line stricter than the law (25 feet where the law says 20) is kept. The
 * cards and exams still teach from the manual: this is the law box alone.
 */
export function supersededOf(root: string): Record<string, Superseded> {
  const file = path.join(root, SUPERSEDED_FILE)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Superseded>) : {}
}

export const MANUAL_SOURCES_FILE = 'src/assets/drivers-manuals/SOURCES.json'

/** What the manual fetch recorded for each state's PDF: where it came from, the day it was fetched, and the edition printed in it where one is. */
export interface ManualSource {
  source?: string
  retrieved?: string
  edition?: string
}

export function readManualSources(root: string): Record<string, ManualSource> {
  return JSON.parse(readFileSync(path.join(root, MANUAL_SOURCES_FILE), 'utf8')) as Record<string, ManualSource>
}

/**
 * What Pages publishes at /ask-laws/<CODE>.json, each law with the date it was
 * true as of (docs/plans/trusted-by-date.md, decision 6, as corrected in its
 * phase-2 PR): the day its source was fetched -- a statute's section by the
 * file it was cut from, a manual law's manual PDF by its state -- both read
 * from the repository's own fetch records, so the same word means the same
 * thing on every row. A law whose date cannot be found throws rather than
 * going out undated or dated today: a new state whose manual was never
 * recorded fails the build, naming the file, instead of telling a reader its
 * manual is as of the deploy.
 */
export function lawsOf(root: string, code: string): AskLaw[] {
  const corpus = JSON.parse(readFileSync(path.join(root, 'resource/corpus/drivers', `${code}.json`), 'utf8'))
  const statutes = [...(handLawsOf(root, code) ?? []), ...codeChunksOf(root, code)]
  const superseded = supersededOf(root)
  const fetched = readSources(root, code)?.files ?? {}
  const sourceOf = new Map(statutes.map((law) => [law.id, law.source]))
  const manual = readManualSources(root)[code]?.retrieved
  return retrievalFile(corpus, statutes.length === 0 ? null : statutes)
    .filter((law) => superseded[law.id] === undefined)
    .map((law) => {
      if (law.kind === 'statute') {
        const retrieved = fetched[sourceOf.get(law.id) ?? '']?.retrieved
        if (retrieved === undefined) throw new Error(`${law.id}: its source ${sourceOf.get(law.id)} has no retrieved date in ${sourcesFile(code)}`)
        return { ...law, asOf: retrieved }
      }
      if (manual === undefined) throw new Error(`${code} has no manual with a retrieved date in ${MANUAL_SOURCES_FILE}`)
      return { ...law, asOf: manual }
    })
}

/**
 * What Pages publishes at /ask-laws/<CODE>.json, what the index embeds and
 * what the store holds: the manual's and the code's laws (`lawsOf`), then the
 * state's own pages (docs/plans/what-happens-if.md, phase 3) -- the passages
 * `npm run process:fetch` kept from the licensing agency's and the court's
 * pages, each dated by the day its page was checked. Apart from `lawsOf`
 * because a page is neither a manual nor a code: the verdicts, the topic
 * pages, the method page's counts and the dates the trust page vouches for
 * are about those two, and a retake page counted among the manual's laws, or
 * dated as though its manual had been fetched that day, would be wrong on
 * every one of them.
 */
export function publishedLawsOf(root: string, code: string): AskLaw[] {
  return [...lawsOf(root, code), ...processLawsOf(root, code)]
}

export interface Topic {
  id: string
  question: string
  /** The topic's search page name (docs/plans/nationwide.md, decision 13), at most 45 characters so its title fits. */
  title: string
  /**
   * The subject several topics answer together (docs/plans/trusted-by-date.md,
   * decision 3): "hardest on drunk driving" is six penalties and two limits,
   * and a nationwide question about the family reads up to four of them.
   */
  family?: string
}

export function topicsOf(root: string): Topic[] {
  return JSON.parse(readFileSync(path.join(root, STATUTES_DIR, 'topics.json'), 'utf8')) as Topic[]
}

/**
 * Where a topic's answer comes from, per state (docs/plans/vehicle-code.md,
 * decision 7): the manual, a hand-written statute, a chunk of the code, or
 * nothing -- with the reason, which for a state whose site could not be read
 * is `official site not fetchable: <what>`.
 */
export interface Verdict {
  from: 'manual' | 'statute' | 'code' | 'none'
  law?: string
  reason?: string
}

export type Coverage = Record<string, Record<string, Verdict>>

export const COVERAGE_FILE = `${STATUTES_DIR}/coverage.json`

export function readCoverage(root: string): Coverage {
  const file = path.join(root, COVERAGE_FILE)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Coverage) : {}
}

/**
 * Every state's verdict law for each topic (docs/plans/nationwide.md, decision
 * 1): what Pages publishes at `/ask-laws/topics/<topic>.json`, what the topic
 * pages tabulate, and what the eval and the e2e harness answer a nationwide
 * question from. Sorted by state code; a state whose verdict is `none` has no
 * entry; a topic no state has a law for has no entry at all, so no file. Each
 * law is exactly the one in its state's published file -- a comparison quoting
 * a law the state's own file no longer holds is the drift this is shaped to
 * make impossible, so a verdict naming a law that is not there throws.
 */
export function topicLawsFrom(
  topics: readonly Topic[],
  coverage: Coverage,
  lawsFor: (code: string) => AskLaw[],
): Map<string, StateLaw[]> {
  const out = new Map<string, StateLaw[]>()
  const states = Object.keys(coverage).sort()
  for (const topic of topics) {
    const laws = states.flatMap((code): StateLaw[] => {
      const verdict = coverage[code][topic.id]
      if (verdict === undefined || verdict.from === 'none') return []
      const law = lawsFor(code).find((each) => each.id === verdict.law)
      if (law === undefined) throw new Error(`${code} ${topic.id}: ${verdict.law} is not in the state's published laws`)
      return [{ state: code, ...law }]
    })
    if (laws.length > 0) out.set(topic.id, laws)
  }
  return out
}

/** `topicLawsFrom` over what the repository committed, each state's laws read once. */
export function topicLaws(root: string): Map<string, StateLaw[]> {
  const read = new Map<string, AskLaw[]>()
  return topicLawsFrom(topicsOf(root), readCoverage(root), (code) => {
    if (!read.has(code)) read.set(code, lawsOf(root, code))
    return read.get(code)!
  })
}
