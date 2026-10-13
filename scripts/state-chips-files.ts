/**
 * The state chips' files, read without a model client (docs/plans/what-happens-if.md,
 * phase 4): the pool, each state's stored answers, and the committed rows a
 * stored answer cites -- the state's published laws (manual, code and its own
 * pages) and its fine schedule.
 *
 * Its own module because the Vite config and the prerender read it, and
 * scripts/state-chips.ts brings the worker's prompt and the Anthropic SDK with
 * it. The box and the facts page are given citations built here from the
 * committed rows, not copied into the stored file, so neither can show a
 * citation the rows no longer hold.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { penaltyLaw, type PenaltyRow } from '../worker/src/penalty-law'
import type { AskLaw } from '../worker/src/law-retrieval'
import { publishedLawsOf } from './statutes/laws'

export const STATE_CHIPS_FILE = 'resource/state-chips.json'
export const STATE_CHIPS_DIR = 'resource/state-chips'

export type StateChipLang = 'en' | 'es'
export const STATE_CHIP_LANGS: readonly StateChipLang[] = ['en', 'es']

/** One question in the pool, asked of every state (decision 21). */
export interface StateChip {
  id: string
  /** One of phase 3's six process families, `consequence` for the "what happens if" shape, or `rule`. */
  family: string
  question: Record<StateChipLang, string>
}

/** What a stored answer remembers of a row it cited: when the row was true as of, and its words hashed. */
export interface CitedRow {
  asOf: string | null
  hash: string
}

/** One chip answered for one state in one language. */
export interface StoredStateChip {
  id: string
  lang: StateChipLang
  /** The chip's question when it was answered: a reworded chip is answered again. */
  question: string
  answer: string
  /** The ids it cites, in the order the live answer gave them. */
  sources: string[]
  /** Each cited id, as its row stood when the answer was written (decision 23). */
  cited: Record<string, CitedRow>
  /** The day it was answered. */
  asOf: string
  model: string
}

export interface StateChipsFile {
  state: string
  chips: StoredStateChip[]
}

export function readStateChips(root: string): StateChip[] {
  return JSON.parse(readFileSync(path.join(root, STATE_CHIPS_FILE), 'utf8')) as StateChip[]
}

export function stateChipsPath(root: string, code: string): string {
  return path.join(root, STATE_CHIPS_DIR, `${code}.json`)
}

/** A state's stored answers, or none when it has no file. */
export function readStoredStateChips(root: string, code: string): StoredStateChip[] {
  const file = stateChipsPath(root, code)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StateChipsFile).chips : []
}

/** The states with a stored-answers file, in code order. */
export function statesWithChips(root: string, codes: readonly string[]): string[] {
  return codes.filter((code) => readStoredStateChips(root, code).length > 0)
}

const ROWS = new Map<string, Map<string, AskLaw>>()

/**
 * Every row a state answer can cite, by id, from the committed files: the
 * published laws the box retrieves from (`publishedLawsOf`, which a whole
 * section's neighbours are also read from), and the fine schedule as the
 * worker turns each row into a law (`penaltyLaw`). Keyed by root and code, so
 * the suite's fixture roots never share a cache with the real one.
 */
export function committedRows(root: string, code: string): Map<string, AskLaw> {
  const key = `${root}\u0000${code}`
  if (!ROWS.has(key)) {
    const file = path.join(root, 'resource/penalties', `${code}.json`)
    const penalties = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { rows: PenaltyRow[] }).rows.map(penaltyLaw) : []
    ROWS.set(key, new Map([...publishedLawsOf(root, code), ...penalties].map((law) => [law.id, law])))
  }
  return ROWS.get(key)!
}

/**
 * A row's words hashed: the law the model was given and the citation its
 * figures are grounded on and the learner is shown. A row reworded under a
 * stored answer is an answer nobody checked against the words it now cites.
 */
export function rowHash(law: Pick<AskLaw, 'law' | 'citation'>): string {
  return createHash('sha256').update(JSON.stringify([law.law, law.citation])).digest('hex')
}

export function citedRow(law: AskLaw): CitedRow {
  return { asOf: law.asOf ?? null, hash: rowHash(law) }
}

/** One stored answer as the box draws it: the live answer's shape, citations built from the committed rows. */
export interface PublishedStateChip {
  id: string
  lang: StateChipLang
  question: string
  answer: string
  sources: { id: string; location: string; kind?: 'statute' | 'penalty' | 'process'; asOf?: string }[]
  absent: string[]
  asOf: string
}

/**
 * A state's stored answers as Pages publishes them at `/ask-laws/chips/<XX>.json`
 * and the facts page prints them, in the pool's order: each citation exactly as
 * a live answer's (`answerLearner`'s), from the row the committed files hold.
 * Throws on a cited id they do not hold, so a deploy cannot ship an answer
 * whose source has gone; tests/unit/state-chips.test.ts is red first.
 */
export function publishedStateChips(root: string, code: string): PublishedStateChip[] {
  const pool = readStateChips(root)
  const rows = committedRows(root, code)
  const order = (chip: StoredStateChip) => pool.findIndex((each) => each.id === chip.id) * STATE_CHIP_LANGS.length + STATE_CHIP_LANGS.indexOf(chip.lang)
  return readStoredStateChips(root, code)
    .filter((chip) => pool.some((each) => each.id === chip.id))
    .sort((left, right) => order(left) - order(right))
    .map((chip) => ({
      id: chip.id,
      lang: chip.lang,
      question: chip.question,
      answer: chip.answer,
      sources: chip.sources.map((id) => {
        const law = rows.get(id)
        if (law === undefined || law.citation === null) throw new Error(`${STATE_CHIPS_DIR}/${code}.json: ${chip.id} (${chip.lang}) cites ${id}, which the committed files do not hold: run npm run chips:build -- --states ${code}`)
        return { id, location: law.citation, ...(law.kind === undefined ? {} : { kind: law.kind }), ...(law.asOf === undefined ? {} : { asOf: law.asOf }) }
      }),
      absent: [],
      asOf: chip.asOf,
    }))
}
