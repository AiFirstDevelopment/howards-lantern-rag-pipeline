import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256, siteOf, statesWithSources } from '../../scripts/statutes/fetch'
import { codeChunksOf, handLawsOf, readSources, sourcesFile } from '../../scripts/statutes/laws'
import { bodyLines } from '../../worker/src/code-chunks'

/**
 * The statute corpus, held to its sources (docs/plans/statute-corpus.md,
 * docs/plans/vehicle-code.md).
 *
 * The ask box shows a statute's quote under an answer as the state's own law.
 * A quote that is not in the section it names is a sentence this site made up
 * and attributed to a legislature, so every one is found here, verbatim, in the
 * committed copy of that section -- Maryland's hand-written laws and every
 * chunk of every state's code alike -- and every copy is held to the hash
 * recorded when it was fetched, so an edit to a source to make a quote fit is
 * as red as the quote that did not.
 *
 * Every test is named `XX: …`, so `-t " XX: "` runs one state's and nothing else. Not
 * `^XX:`: vitest matches the whole name, describe block first, so an anchored
 * filter runs nothing and exits 0 -- a per-state check that is green on no test.
 */
const ROOT = process.cwd()
const DIR = path.join(ROOT, 'resource/statutes')

const topics = new Set(
  (JSON.parse(readFileSync(path.join(DIR, 'topics.json'), 'utf8')) as { id: string }[]).map((topic) => topic.id),
)
const states = [
  ...new Set([
    ...readdirSync(DIR)
      .filter((name) => /^[A-Z]{2}\.json$/.test(name))
      .map((name) => name.slice(0, 2)),
    ...statesWithSources(ROOT),
  ]),
].sort()
const sites = new Map(await Promise.all(states.map(async (code) => [code, await siteOf(code)] as const)))

const normalised = (text: string) => text.replace(/\s+/g, ' ').trim()
const CITATION = /^(.+?) — '([\s\S]+)'$/
const textOf = (code: string, file: string) => readFileSync(path.join(DIR, 'sources', code, `${file}.txt`), 'utf8')

/**
 * The failure this guards: a title that came back as menus, a licence notice
 * or an empty reader, with every hash faithfully recorded over it. Not a
 * length floor of 200, which the plan proposed and Maryland refuted -- 72 of
 * its definitions are one real sentence under 200 characters ("“Pedestrian”
 * means an individual afoot.", 39) -- but what navigation lacks: a body
 * of some length that ends a sentence, and text of its own rather than the
 * same page served under every section's address.
 */
const BODY_FLOOR = 20

/** How many sections may share one text before it reads as a page served for all of them: the larger of a floor and a share of the state's sections. */
const SHARED_TEXT_FLOOR = 25
const SHARED_TEXT_SHARE = 0.05
// "]" too: North Dakota closes a figure on its metric equivalent, "twenty
// thousand pounds [9071.84 kilograms]." -- a sentence the guard read as none.
const SENTENCE = /[A-Za-z0-9)”"'\]][.;:]["”’)]*\s*$/

/**
 * Sections whose official text ends without a full stop, each read and found
 * whole. Named one by one rather than loosening the rule, which is what tells
 * a fetched navigation page from law: New Jersey's § 39:3-54.22 ends "…for
 * issuance of the permit" in the Legislature's own file.
 */
const UNTERMINATED = new Set(['NJ 39-3-54.22'])

describe('the statute corpus', () => {
  it('has at least one state, so a broken directory listing cannot pass vacuously', () => {
    expect(states).toContain('MD')
  })

  for (const code of states) {
    const hand = handLawsOf(ROOT, code) ?? []
    const sources = readSources(ROOT, code)

    if (hand.length > 0) {
      it(`${code}: quotes every hand-written law verbatim from the committed section it names`, () => {
        for (const law of hand) {
          const cited = CITATION.exec(law.citation)
          expect(cited, `${law.id} citation is not "<reference> — '<quote>'"`).not.toBeNull()
          expect(normalised(textOf(code, law.source)), `${law.id} quote is not in ${law.source}`).toContain(normalised(cited![2]))
        }
      })

      it(`${code}: hand-written ids are the state's and every topic is on the list`, () => {
        for (const law of hand) {
          expect(law.id).toMatch(new RegExp(`^${code}-S\\d{2,}$`))
          expect(topics.has(law.topic), `${law.id} topic ${law.topic}`).toBe(true)
          expect(sources?.files[law.source], `${law.source} is not in ${sourcesFile(code)}`).toBeDefined()
        }
      })
    }

    if (sources === null) continue

    it(`${code}: every committed section is the text its recorded hash was taken of, from the state's official site`, () => {
      const site = sites.get(code)
      expect(site, `${code} has sources but no scripts/statutes/sites/${code}.ts`).not.toBeNull()
      expect(sources.official).toBe(site!.official)
      for (const [file, source] of Object.entries(sources.files)) {
        expect(existsSync(path.join(DIR, 'sources', code, `${file}.txt`)), `${code} ${file}.txt is missing`).toBe(true)
        expect(sha256(textOf(code, file)), `${code} ${file} differs from what was fetched`).toBe(source.sha256)
        expect(source.url.startsWith(site!.official), `${file} is not from ${code}'s official source`).toBe(true)
      }
    })

    it(`${code}: every title its site module names has sections committed`, () => {
      const files = Object.keys(sources.files)
      expect(sources.titles.map((title) => title.id)).toEqual(sites.get(code)!.titles.map((title) => title.id))
      for (const title of sources.titles) {
        expect(files.filter((file) => file.startsWith(`${title.id}-`)).length, `${code} ${title.id} has no sections`).toBeGreaterThan(0)
      }
    })

    it(`${code}: every committed section is a law, not a page of navigation, unless it is marked repealed`, () => {
      const shared = new Map<string, string[]>()
      for (const [file, source] of Object.entries(sources.files)) {
        if (source.repealed === true) continue
        const body = bodyLines({ text: textOf(code, file), section: source.section }).join('\n')
        expect(body.length, `${code} ${file} has ${body.length} characters of body: navigation, not law?`).toBeGreaterThanOrEqual(BODY_FLOOR)
        // A section may end on a table of figures (Transp. § 22-302, brake
        // performance); then a full section that opens on a sentence is law.
        const sentenced = SENTENCE.test(body) || (body.length >= 200 && SENTENCE.test(body.split('\n')[0])) || UNTERMINATED.has(`${code} ${file}`)
        expect(sentenced, `${code} ${file} does not end on a sentence: navigation, not law?`).toBe(true)
        shared.set(body, [...(shared.get(body) ?? []), file])
      }
      // One page served for many sections is a title fetched as navigation.
      // A few sections sharing their text is not: Indiana enacts "A person who
      // violates this chapter commits a Class C infraction." in twenty
      // chapters, and failing on any repeat dropped real law -- the parking
      // chapter's penalty, § 9-21-16-9, among it.
      const limit = Math.max(SHARED_TEXT_FLOOR, Math.ceil(Object.keys(sources.files).length * SHARED_TEXT_SHARE))
      for (const [body, files] of shared) {
        expect(files.length, `${code}: ${files.length} sections share one text (${files.slice(0, 3).join(', ')}…): navigation, not law? "${body.slice(0, 60)}"`).toBeLessThanOrEqual(limit)
      }
    })

    it(`${code}: quotes every chunk of its code verbatim from the committed section`, () => {
      const chunks = codeChunksOf(ROOT, code)
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) {
        const cited = CITATION.exec(chunk.citation)
        expect(cited, `${chunk.id} citation is not "<reference> — '<quote>'"`).not.toBeNull()
        expect(cited![2], `${chunk.id} quotes other words than it retrieves by`).toBe(chunk.law)
        expect(normalised(textOf(code, chunk.source)), `${chunk.id} is not in ${chunk.source}`).toContain(normalised(chunk.law))
      }
    })

    it(`${code}: every law id in the state's retrieval file is the state's and unique`, () => {
      const ids = [...hand.map((law) => law.id), ...codeChunksOf(ROOT, code).map((chunk) => chunk.id)]
      expect(ids.length - new Set(ids).size, 'duplicate ids').toBe(0)
      for (const id of ids) expect(id.startsWith(`${code}-`), id).toBe(true)
    })
  }
})
