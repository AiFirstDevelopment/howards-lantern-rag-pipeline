/**
 * The reports `npm run statutes:refresh` writes (docs/plans/trusted-by-date.md,
 * decision 10), and the one function that reads them back: the refresh
 * writes, `/drivers/laws/changes/` reads (seo/prerender.ts). Apart from
 * refresh.ts so the page build reads the reports without importing the fetch.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const CHANGES_DIR = 'resource/statutes/changes'

export interface Changed {
  file: string
  cite: string
  heading: string
  url: string
  /** The committed text's sha256, as SOURCES.json records it. */
  before: string
  /** The sha256 of what the extractor makes of the page today. */
  after: string
  diff: string
}

export interface Unreachable {
  file: string
  cite: string
  heading: string
  url: string
  error: string
}

export interface StateReport {
  /** Every section checked, by its committed file name: the report names them, so "nothing changed" is a list, not a belief. */
  checked: string[]
  changed: Changed[]
  unreachable: Unreachable[]
}

export interface Report {
  /** The day it ran, ISO; also the file's name. */
  ran: string
  states: Record<string, StateReport>
}

export function reportFile(root: string, day: string): string {
  return path.join(root, CHANGES_DIR, `${day}.json`)
}

/** Every committed report, newest first. */
export function readReports(root: string): Report[] {
  const dir = path.join(root, CHANGES_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Report)
    .sort((left, right) => right.ran.localeCompare(left.ran))
}
