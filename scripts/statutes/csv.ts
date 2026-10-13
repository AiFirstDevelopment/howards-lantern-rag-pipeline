/**
 * Each comparison as a CSV a reader can take away (docs/plans/trusted-by-date.md,
 * decision 9): `/drivers/laws/<topic>.csv`, one row per state with a verdict
 * law, from `topicLaws` -- the function the topic files and the comparison
 * tables come from, so a spreadsheet cannot hold a law the page does not show.
 *
 * RFC 4180, by hand: a field holding a comma, a double quote or a line break is
 * quoted, its quotes doubled; rows end in CRLF; UTF-8 with no byte-order mark.
 * The laws are not tame -- Maryland's child-seat citation quotes "4'9\" or
 * taller", Idaho's and Kentucky's laws carry line breaks -- and an unquoted
 * field there shifts every column after it, in a file whose whole worth is that
 * the columns can be trusted.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { StateLaw } from '../../worker/src/law-topics'
import { codeChunksOf, handLawsOf, readManualSources, readSources, topicLaws } from './laws'

export const CSV_COLUMNS = ['state', 'state_name', 'kind', 'law', 'citation', 'source_url', 'as_of'] as const

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: readonly CsvRow[]): string {
  return [CSV_COLUMNS.join(','), ...rows.map((row) => CSV_COLUMNS.map((column) => csvField(row[column])).join(','))]
    .map((line) => `${line}\r\n`)
    .join('')
}

/** The reverse, for the tests that hold a file to its topic: quoted fields, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"'
        at += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' && text[at + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      at += 1
    } else field += char
  }
  if (field !== '' || row.length > 0) rows.push([...row, field])
  return rows
}

/**
 * Where a published law can be read at its source: a statute's section on the
 * state's own site (the URL its fetch recorded), a manual law's PDF where the
 * agency publishes it (src/assets/drivers-manuals/SOURCES.json). Empty where
 * neither is recorded, never a guess.
 */
export function sourceUrlsOf(root: string): (law: StateLaw) => string {
  const manuals = readManualSources(root)
  const statutes = new Map<string, Map<string, string>>()
  const statuteUrls = (code: string) => {
    if (!statutes.has(code)) {
      const files = readSources(root, code)?.files ?? {}
      const urls = new Map<string, string>()
      for (const law of [...(handLawsOf(root, code) ?? []), ...codeChunksOf(root, code)]) {
        const url = files[law.source]?.url
        if (url !== undefined) urls.set(law.id, url)
      }
      statutes.set(code, urls)
    }
    return statutes.get(code)!
  }
  return (law) => (law.kind === 'statute' ? statuteUrls(law.state).get(law.id) : manuals[law.state]?.source) ?? ''
}

/** One topic's rows, in the topic file's order (by state code). */
export function topicRows(laws: readonly StateLaw[], stateName: (code: string) => string, sourceUrl: (law: StateLaw) => string): CsvRow[] {
  return laws.map((law) => ({
    state: law.state,
    state_name: stateName(law.state),
    kind: law.kind === 'statute' ? 'statute' : 'manual',
    law: law.law,
    citation: law.citation ?? '',
    source_url: sourceUrl(law),
    as_of: law.asOf ?? '',
  }))
}

/**
 * Every topic's CSV, keyed by topic id: what the corpus plugin emits beside
 * the topic files, and what tests/unit/topic-csv.test.ts parses back. `laws`
 * is passed in where the caller already holds the topic laws -- the plugin
 * builds them from the very files it just emitted.
 */
export function topicCsvs(root: string, laws: ReadonlyMap<string, readonly StateLaw[]> = topicLaws(root)): Map<string, string> {
  const manifest = JSON.parse(readFileSync(path.join(root, 'resource/manifest.json'), 'utf8')) as {
    products: { id: string; states: { code: string; name: string }[] }[]
  }
  const names = new Map(manifest.products.filter((product) => product.id === 'drivers').flatMap((product) => product.states.map((state) => [state.code, state.name] as const)))
  const sourceUrl = sourceUrlsOf(root)
  const out = new Map<string, string>()
  for (const [topic, each] of laws) out.set(topic, toCsv(topicRows(each, (code) => names.get(code) ?? code, sourceUrl)))
  return out
}
