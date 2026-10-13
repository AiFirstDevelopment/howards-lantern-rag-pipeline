#!/usr/bin/env node
/**
 * Generate the law -> concept map the worker answers rosters with.
 *
 * The worker has no corpus: it is a separate bundle from the app, and pulling
 * 1.2MB of law text into it to render one slug per row would be paid on every
 * cold start. So the one field the roster needs is extracted here.
 *
 * `tests/unit/law-concepts.test.ts` regenerates this and fails if it differs,
 * because a corpus that gains a law while this file does not leaves the roster
 * rendering a bare id -- which looks like data we do not have rather than a
 * build step somebody forgot.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export function buildIndex(root: string = process.cwd()): Record<string, string> {
  const corpus = path.join(root, 'resource/corpus')
  const index: Record<string, string> = {}
  for (const product of readdirSync(corpus)) {
    for (const file of readdirSync(path.join(corpus, product))) {
      if (!file.endsWith('.json')) continue
      const laws = JSON.parse(readFileSync(path.join(corpus, product, file), 'utf8'))
      const rows: { id?: string; concept?: string }[] = Array.isArray(laws)
        ? laws
        : (laws.laws ?? [])
      for (const law of rows) {
        if (law?.id && law?.concept) index[law.id] = law.concept
      }
    }
  }
  // Sorted so a regenerated file is byte-identical and a diff shows only the
  // laws that actually changed.
  return Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.join(process.cwd(), 'worker/src/law-concepts.json')
  writeFileSync(out, `${JSON.stringify(buildIndex(), null, 2)}\n`)
  console.log(`wrote ${out}`)
}
