/**
 * What a state's own pages are, what was kept from them, and the one check
 * every passage passes before it is stored (docs/plans/what-happens-if.md,
 * phase 3, decisions 14 and 15). Apart from fetch.ts so the laws reader, the
 * monthly refresh and the tests read the same types without the network or
 * the model.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AskLaw } from '../../worker/src/law-retrieval'
import { PROCESS_FAMILIES, PROCESS_FAMILY_IDS, processId, type ProcessFamily } from '../../worker/src/process-families'

export { PROCESS_FAMILIES, PROCESS_FAMILY_IDS, type ProcessFamily }

export const SOURCES_FILE = 'resource/process/SOURCES.json'
export const PROCESS_DIR = 'resource/process'

/** At most this many passages a family: the model is given the page's rule, not the page. */
export const MAX_PASSAGES = 5

/** One family's page: the licensing agency's or the state court's own, and nothing else. */
export interface ProcessPage {
  url: string
  /** The page's own title, as it prints it: the citation names it. */
  title: string
  agency: string
  /** The day the discovery pass found the page and saw the rule in what a script fetches. */
  retrieved: string
}

/** A family no official page was found for in the discovery pass, and what was looked at. */
export interface NoPage {
  none: string
}

export type ProcessSources = Record<string, Record<ProcessFamily, ProcessPage | NoPage>>

export function isPage(entry: ProcessPage | NoPage | undefined): entry is ProcessPage {
  return entry !== undefined && 'url' in entry
}

/** What was kept from one family's page: the passages that state its rule, each a substring of the page as fetched. */
export interface FamilyPassages {
  url: string
  title: string
  agency: string
  /** The day the page was fetched and the passages checked against it. */
  as_of: string
  /** The sha256 of the page's text as checked, so a reader can tell which version the passages came from. */
  page: string
  passages: string[]
}

/** A state's committed passages, as `resource/process/<XX>.json` holds them. */
export interface StateProcess {
  state: string
  families: Partial<Record<ProcessFamily, FamilyPassages>>
}

export function readProcessSources(root: string): ProcessSources {
  const file = path.join(root, SOURCES_FILE)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProcessSources) : {}
}

export function processFile(root: string, code: string): string {
  return path.join(root, PROCESS_DIR, `${code}.json`)
}

export function readProcessState(root: string, code: string): StateProcess | null {
  const file = processFile(root, code)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StateProcess) : null
}

/**
 * The citation a passage is shown under: the agency, the page's title and the
 * passage itself, in the statute's shape, so the box draws it as it draws a
 * section -- "Not in your manual — <agency> — <title>: '<passage>'" -- and
 * the checker grounds a figure on the passage's own words.
 */
export function processCitation(page: Pick<FamilyPassages, 'agency' | 'title'>, passage: string): string {
  return `${page.agency} — ${page.title} — '${passage}'`
}

/**
 * A state's committed passages as laws, family by family in the families'
 * order, each `XX-R-<family>-<n>` of kind `process`, under the family's
 * question and dated by the day its page was checked. What scripts/statutes/
 * laws.ts adds to the state's file, so Pages publishes, the index embeds and
 * the push stores the same rows.
 */
export function processLawsOf(root: string, code: string): AskLaw[] {
  const state = readProcessState(root, code)
  if (state === null) return []
  return PROCESS_FAMILIES.flatMap((family) => {
    const kept = state.families[family.id]
    if (kept === undefined) return []
    return kept.passages.map((passage, index) => ({
      id: processId(code, family.id, index + 1),
      law: passage,
      question: family.question,
      concept: family.id,
      citation: processCitation(kept, passage),
      kind: 'process' as const,
      asOf: kept.as_of,
    }))
  })
}

/**
 * A Next.js page's own words where it keeps them: the strings of its
 * `__NEXT_DATA__` script, as markup appended to the page, so the script is
 * dropped as every script is and its words are read like the page's.
 * Minnesota's "Class D driver's license for new driver under age 18" carries
 * only its accordion headings in the markup; "You will be charged an
 * additional $10 retest fee after two failed tests" is in that script alone,
 * and the page stored nothing for test-and-retake.
 */
export function nextData(raw: string): string {
  const found = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw)
  if (found === null) return ''
  let data: unknown
  try {
    data = JSON.parse(found[1])
  } catch {
    return ''
  }
  const words: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      // Words, not identifiers: a string with a space in it that is not a
      // URL, a class list or a path.
      if (/\s/.test(value) && !/^(?:https?:|\/)/.test(value) && /[a-z]{3,}/i.test(value)) words.push(value)
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(data)
  return words.length === 0 ? '' : `\n<div>${words.map((each) => `<p>${each}</p>`).join('\n')}</div>`
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', reg: '®', copy: '©',
}

/**
 * A page as the text its passages are checked against, and as the model is
 * shown it: an HTML page's scripts, styles, menus, header and footer dropped,
 * its tags dropped and its entities read; a PDF's text as pdftotext lays it
 * out; dot leaders taken out, curly quotes made straight and every run of
 * white space one space. Menus go
 * because a DMV page is mostly menu, and a passage chosen from "Pay a ticket
 * | Renew online | Retake a test" states no rule. Nothing else is forgiven:
 * not a digit, not a letter, not case. Its own function rather than the
 * fine schedules' (scripts/penalties/source.ts), which keeps menus: a
 * schedule has none, and that one is held to Maryland's PDF by its own tests.
 */
export function pageText(raw: string): string {
  const html = /<(?:html|body|div|p|table|main|section)\b/i.test(raw)
  const plain = html
    ? (raw + nextData(raw))
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|nav|header|footer|template)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) =>
          name[0] === '#'
            ? String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
            : (ENTITIES[name.toLowerCase()] ?? whole),
        )
    : raw
  // Curly quotes as straight ones: a page typeset "learner’s" and a passage
  // copied as "learner's" are the same words, and Haiku straightens them --
  // Maryland's "Hold a learner’s permit for at least 9 months" was dropped
  // for its apostrophe alone. A quote mark is never a figure.
  return plain
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s*\.{3,}\s*/g, ' ')
    .replace(/[\s\u00a0]+/g, ' ')
    // A tag closed just before a full stop ("nor can you request a
    // refund</a>.") leaves a space no reader sees, and DC's 30-day rule was
    // dropped for it: none before closing punctuation, in the page and in
    // the passage alike.
    .replace(/ ([.,;:!?)])/g, '$1')
    .trim()
}

/** A passage that was not stored, and why: printed by the fetch, so an invented quote is named rather than missing. */
export interface DroppedPassage {
  family: ProcessFamily
  passage: string
  reason: string
}

/** The longest passage kept: past this it is the page, not the rule. */
export const MAX_PASSAGE_CHARS = 700

/**
 * The passages that may be stored: each a substring of the page as fetched,
 * the passage read as `pageText` reads the page -- white space and curly
 * quotes aside, nothing forgiven, not a digit, not a letter, not case. A model asked to copy
 * a passage can paraphrase it, and "you must wait 10 days" stored under a
 * page that says 15 is a learner turned away at the counter on the
 * eleventh day, under the agency's own name. Whole words at both ends: "5
 * days before the re-test" is in a page that says "15 days before the
 * re-test" as letters, and not as words. Each passage once, at most
 * `MAX_PASSAGES`, and none longer than `MAX_PASSAGE_CHARS`.
 */
/** Whether `passage` is in `text`, starting and ending where a word does. */
function onThePage(passage: string, text: string): boolean {
  const word = /[\p{L}\p{N}]/u
  for (let at = text.indexOf(passage); at >= 0; at = text.indexOf(passage, at + 1)) {
    const before = at === 0 ? '' : text[at - 1]
    const after = text[at + passage.length] ?? ''
    if (!(word.test(passage[0]) && word.test(before)) && !(word.test(passage[passage.length - 1]) && word.test(after))) return true
  }
  return false
}

export function verifiedPassages(
  family: ProcessFamily,
  proposed: readonly string[],
  page: string,
): { passages: string[]; dropped: DroppedPassage[] } {
  const text = pageText(page)
  const passages: string[] = []
  const dropped: DroppedPassage[] = []
  for (const each of proposed) {
    const passage = pageText(each)
    if (passage === '') continue
    if (!onThePage(passage, text)) dropped.push({ family, passage, reason: 'not in the fetched page' })
    else if (passage.length > MAX_PASSAGE_CHARS) dropped.push({ family, passage, reason: `longer than ${MAX_PASSAGE_CHARS} characters` })
    else if (passages.includes(passage)) continue
    else if (passages.length >= MAX_PASSAGES) dropped.push({ family, passage, reason: `past the first ${MAX_PASSAGES}` })
    else passages.push(passage)
  }
  return { passages, dropped }
}
