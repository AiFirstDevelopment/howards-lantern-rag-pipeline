/**
 * A section of a state's vehicle code, cut into the pieces the ask box
 * retrieves (docs/plans/vehicle-code.md, decision 2).
 *
 * The unit is a subsection: the model reads at most eight laws, and eight whole
 * sections of a parking statute would be a chapter. A section splits at its
 * top-level labels -- `(a)`, `(b)` or `(1)`, `(2)`, whichever comes first in
 * it -- and a subsection longer than CHUNK_CHARS splits again at line
 * boundaries, preferring a nested label. Every piece is lines of the committed
 * source joined with a space, so tests/unit/statutes.test.ts finds each one
 * verbatim in its file, under the same whitespace rule as every quote.
 *
 * Pure, so the Vite plugin, the embed script, the eval and the e2e harness
 * all cut a state the same way.
 */

/** Roughly a paragraph: long enough for a whole rule, short enough that eight are a page. */
export const CHUNK_CHARS = 900

export interface CodeSection {
  /** The state: "MD". */
  code: string
  /** The committed file's name, without `.txt`. */
  file: string
  section: string
  /** "Md. Code, Transp. § 21-1003". */
  cite: string
  heading: string
  text: string
}

/** A chunk in the shape of a hand-written statute law, so it rides askStatutes unchanged. */
export interface CodeChunk {
  id: string
  topic: string
  concept: string
  law: string
  question: string
  citation: string
  source: string
}

type Kind = 'lower' | 'upper' | 'digit' | 'upper-dot' | 'digit-dot' | 'roman-dot' | 'lower-dot' | 'roman-lower'

// "(d–1)" is how Maryland writes a subsection inserted after (d): an en dash.
// North Carolina writes the same thing with no mark at all, "(a1)" after (a)
// and "(6a)" after (6); read as no label, § 20-11(a1) was cited as (a).
// South Dakota capitalises it, "(9A)" after (9): § 32-14-1(9A) was cited as (9).
// Texas hyphenates it, "(13-a)" after (13): its police-vehicle definition,
// § 541.201(13-a), rode inside the pole-trailer one and was cited as (13).
//
// Ohio's § 4511.01 runs its definitions past (ZZZ) to (MMMM); capped at three
// capitals, the thirteen after (ZZZ) were filed inside it and cited as (ZZZ).
const LABEL = /^\(([a-z]{1,4}|[A-Z]{1,4}|\d{1,3})((?:[-–.]\d+|(?<=\d)-[a-z]{1,2}|(?<=[a-z])\d{1,2}|(?<=\d)[a-zA-Z]{1,2})?)\)/

// "A." and "1." with no brackets, as Arizona numbers its subsections and
// paragraphs: "A. Except if necessary…", then "5. Within fifteen feet of a fire
// hydrant." Read as bracketed labels only, the chunker took Arizona's third
// level, "(a)", for its first, and cited § 28-873(A)(5) as § 28-873(b).
//
// "1-A." and "A-1." are Maine's inserted subsections and paragraphs, as "(d–1)"
// is Maryland's. Read as no label, § 2060(1-A) rode inside (1) and was cited
// as (1), its rule about bicyclists filed under right turns in general.
//
// "2-a." and "24-a." are New York's; read as no label, § 510(4-a) was cited as (4).
const DOTTED = /^([A-Z]|\d{1,3})((?:-(?:[A-Z]{1,2}|[a-z]{1,2}|\d{1,2}))?)\.\s/

// "I.", "II.", "I-a." -- New Hampshire numbers its paragraphs in roman. Read as
// the letter I and then as no label, every paragraph after I was filed under
// it: the hydrant rule, RSA 265:69, II(b), was cited as (I)(m).
const ROMAN = /^([IVXLC]{2,7})((?:-[a-z]{1,2})?)\.\s/
// "a.", "b." -- New Jersey's subsections. Read as no label, its hydrant rule,
// § 39:4-138(i), rode in another paragraph and was cited by it. Read only
// where a section opens on one: North Carolina, North Dakota and Missouri
// write "a." as a third level, and reading it there too re-cut ten states'
// chunks, Florida's § 316.0083(1)(a) among them cited as (1)(b).
const LOWER_DOTTED = /^([a-z])\1?((?:-\d{1,2}|\d{1,2})?)\.\s/

const ROMAN_DIGITS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }

function romanValue(numeral: string): number {
  let total = 0
  for (let index = 0; index < numeral.length; index += 1) {
    const value = ROMAN_DIGITS[numeral[index]]
    total += value < (ROMAN_DIGITS[numeral[index + 1]] ?? 0) ? -value : value
  }
  return total
}

/**
 * A one-letter "I.", "V." or "X." read as a roman numeral: what it is when it
 * opens a section (letters start at "A.") or follows "IV." in one.
 */
function asRoman(label: Label): Label {
  const body = /^[IVXLC]/.exec(label.text)?.[0]
  return label.kind === 'upper-dot' && body !== undefined ? { kind: 'roman-dot', value: romanValue(body), text: label.text } : label
}

interface Label {
  kind: Kind
  /** The ordinal: a=1, b=2; 1=1. */
  value: number
  /** As written, without the parentheses: "b-1". */
  text: string
}

function labelOf(line: string, lettered = false): Label | null {
  const roman = ROMAN.exec(line) ?? /^(I)(-[a-z]{1,2})\.\s/.exec(line)
  if (roman !== null) return { kind: 'roman-dot', value: romanValue(roman[1]), text: roman[1] + roman[2] }
  const lower = lettered ? LOWER_DOTTED.exec(line) : null
  if (lower !== null) {
    const body = lower[0].slice(0, lower[0].indexOf(lower[2] + '.'))
    return { kind: 'lower-dot', value: (body.length - 1) * 26 + (body.charCodeAt(0) - 96), text: body + lower[2] }
  }
  const dotted = DOTTED.exec(line)
  if (dotted !== null) {
    const [, body, suffix] = dotted
    return /^\d+$/.test(body)
      ? { kind: 'digit-dot', value: Number(body), text: body + suffix }
      : { kind: 'upper-dot', value: body.charCodeAt(0) - 64, text: body + suffix }
  }
  const match = LABEL.exec(line)
  if (match === null) return null
  const [, body, suffix] = match
  if (/^\d+$/.test(body)) return { kind: 'digit', value: Number(body), text: body + suffix }
  // "aa" follows "z" in the codes that run out of letters.
  const value = (body.length - 1) * 26 + (body.toLowerCase().charCodeAt(0) - 96)
  // Wisconsin's "(am)", "(gm)", "(as)": inserted after (a), (g) -- not roman, not doubled.
  if (/^[a-z][a-z]$/.test(body) && body[0] !== body[1] && !/^[ivxlc]+$/.test(body)) return { kind: 'lower', value: body.charCodeAt(0) - 96, text: body + suffix }
  if (body.length > 1 && !/^(.)\1+$/.test(body)) return { kind: body === body.toLowerCase() ? 'lower' : 'upper', value: -1, text: body + suffix }
  return { kind: body === body.toLowerCase() ? 'lower' : 'upper', value, text: body + suffix }
}

/** A label inserted after another of its value: "(b-1)", "(d–1)", "(2.1)", "1-A", "(a1)", "(6a)". */
const INSERTED = /[-–.](\d+|[A-Z]{1,2}|[a-z]{1,2})$|^[a-z]+\d+$|^\d+[a-zA-Z]{1,2}$|^[a-z](?![ivxlc]$)[a-z]$/

/**
 * Whether a label may stand after a gap: a short jump, and never onto what
 * reads as a roman numeral or a doubled letter -- Maryland's "(ii)" and "(iii)"
 * under a lettered subsection, taken for a jump, re-cut 770 of its chunks.
 */
function jumpable(label: Label, current: number): boolean {
  if (label.value - current > 10) return false
  if ((label.kind === 'lower' || label.kind === 'upper') && (/^[ivxIVX]$/.test(label.text) || label.text.length > 1)) return false
  return true
}

/** Whether the next label of `kind` after `index` carries the run on from `value`, or none follows. */
function resumes(lines: string[], index: number, kind: Kind, value: number): boolean {
  for (const line of lines.slice(index + 1)) {
    const next = inRun(labelOf(line, kind === 'lower-dot'), kind)
    if (next === null || next.kind !== kind) continue
    return next.value === value || next.value === value + 1 || (next.value > value + 1 && next.value <= value + 5)
  }
  return true
}

const ROMAN_AFTER: Record<string, string> = { h: 'i', u: 'v', w: 'x' }
const ROMAN_NEXT: Record<string, string> = { i: 'ii', v: 'vi', x: 'xi' }

/**
 * Whether the label at `index` continues the top-level sequence after `current`.
 * "(i)" after "(h)" is the ninth subsection only if the next label is not
 * "(ii)": otherwise it is a roman numeral under a nested "(1)".
 */
/** A label read in the run it belongs to: a lone "I." or "V." in a roman run, Wisconsin's "(L)" among lower-case letters. */
function inRun(read: Label | null, kind: Kind): Label | null {
  if (read === null) return null
  if (kind === 'roman-dot') return asRoman(read)
  if (kind === 'lower' && read.kind === 'upper' && read.text === 'L') return { kind: 'lower', value: 12, text: 'L' }
  return read
}

function continues(lines: string[], index: number, kind: Kind, current: number): boolean {
  const label = inRun(labelOf(lines[index], kind === 'lower-dot'), kind)
  if (label === null || label.kind !== kind) return false
  // "(b-1)" sits between (b) and (c) without moving the count, as "1-A." sits between 1. and 2.
  if (INSERTED.test(label.text)) return label.value >= current && (label.value === current || resumes(lines, index, kind, label.value))
  // A number repealed out of the text leaves a gap -- Maine's § 101 runs 38, 40;
  // Wisconsin's § 346.89 runs (1), (3) -- and holding out for the missing one
  // filed every later subsection under the one before it: the texting ban,
  // § 346.89(3)(a), was cited as (1). A jump is taken only when the run goes
  // on from it, so a list a level down that reuses the kind is not.
  if (label.value > current + 1) return jumpable(label, current) && resumes(lines, index, kind, label.value)
  if (label.value !== current + 1) return false
  if (kind === 'lower') {
    const previous = String.fromCharCode(96 + current)
    if (ROMAN_AFTER[previous] === label.text) {
      // A subsection that opens on its own paragraph, "(i) (1) Fines…", is the
      // ninth subsection: a roman item never begins with a numbered paragraph.
      // Otherwise it is roman only when the next label is the numeral after it
      // -- "(ii)" -- and not merely another "(i)" a level further down, which
      // is how Criminal Law § 10-110(j) was once swallowed into (h).
      if (/^\([a-z]+\)\s*\((\d+|[A-Z])\)/.test(lines[index])) return true
      const next = lines.slice(index + 1).map((line) => labelOf(line)).find((each) => each !== null)
      if (next !== undefined && next !== null && next.text === ROMAN_NEXT[label.text]) return false
    }
  }
  return true
}

/** The label written right after a line's own, as in "(b) (1) Notwithstanding…"; null when there is none. */
function inlineLabel(line: string): Label | null {
  const own = LABEL.exec(line) ?? ROMAN.exec(line) ?? DOTTED.exec(line) ?? LOWER_DOTTED.exec(line)
  return own === null ? null : labelOf(line.slice(own[0].length).trimStart())
}

/** A line above the law that is only the section's own heading: "§21–1003." -- a number that grounds no figure. */
function isHeader(line: string, section: string): boolean {
  const plain = (text: string) => text.replace(/[–—‑]/g, '-')
  // The number standing alone: North Carolina's § 20-18, whose one line cites
  // "G.S. 20-181", was read as its own heading and left with no law at all.
  const own = new RegExp(`(^|[^\\w.-])${plain(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\w)`)
  return line.length <= 160 && own.test(plain(line)) && labelOf(line) === null && !/\(\w{1,4}\)/.test(line)
}

const joined = (lines: string[]) => lines.join(' ')

/**
 * Lines into pieces. A subsection that fits is one piece. One that does not
 * is cut at every paragraph -- the first label of another kind than its own --
 * and any paragraph still over CHUNK_CHARS at line boundaries, as decision 2
 * of docs/plans/vehicle-code.md says. Cutting greedily to the cap instead put
 * Arizona's "5. Within fifteen feet of a fire hydrant." in an 836-character
 * piece with seven other places, and neither word nor meaning search reached
 * it for the hydrant question; alone, it ranks second.
 */
function pieces(lines: string[]): string[][] {
  const out: string[][] = []
  let current: string[] = []
  const over = joined(lines).length > CHUNK_CHARS
  const kinds = lines.map((line) => labelOf(line))
  const paragraph = kinds.slice(1).find((label) => label !== null && label.kind !== kinds[0]?.kind)?.kind
  for (const [index, line] of lines.entries()) {
    const opens = over && paragraph !== undefined && kinds[index]?.kind === paragraph
    if (current.length > 0 && (opens || joined([...current, line]).length > CHUNK_CHARS)) {
      out.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) out.push(current)
  return out
}

/** A page's own banner above the section: "Article - Transportation". */
const BANNER = /^Article\s+[-–—]\s+\S/

/** The lines a section's chunks cover, in order: everything but the banner and a heading-only line above the law. */
export function bodyLines(section: Pick<CodeSection, 'text' | 'section'>): string[] {
  const lines = section.text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  let start = 0
  // Never the last line: a section whose one line names its own number -- a
  // short title, a penalty -- is its law, not its heading.
  while (start < Math.min(lines.length - 1, 2) && (BANNER.test(lines[start]) || isHeader(lines[start], section.section))) start += 1
  return lines.slice(start)
}

/** Whether a law id is a chunk of a state's code rather than a manual law or a hand-written one. */
export function isCodeChunk(id: string): boolean {
  return /^[A-Z]{2}-C-/.test(id)
}

/** "ARTICLE III", "Article II Definitions", "Art. IV. PROCEDURE…": a compact's article heading. */
// Delaware prints "ARTICLE IIIReports of Conviction", no space: the numeral ends where a non-numeral begins.
const ARTICLE = /^(?:ARTICLE|Article|Art\.)\s+([IVX]+)(?=$|[^a-zIVX])/

export function chunkSection(section: CodeSection): CodeChunk[] {
  const lines = bodyLines(section)
  // A compact is one section holding Articles I to IX, each restarting at (1)
  // or (a): read as one run, Utah's Driver License Compact cited its Article
  // III(2)(a) as § 53-3-604(3)(a). Each article is chunked on its own and
  // cited by it, "§ 53-3-604, Art. III(2)(a)".
  const articles = lines.flatMap((line, index) => {
    const found = ARTICLE.exec(line)
    return found === null ? [] : [{ index, roman: found[1] }]
  })
  if (articles.length >= 2) {
    const part = (from: number, to: number) => lines.slice(from, to).join('\n')
    const before = articles[0].index > 0 ? chunkSection({ ...section, text: part(0, articles[0].index) }) : []
    return [
      ...before,
      ...articles.flatMap(({ index, roman }, n) =>
        chunkSection({ ...section, section: `${section.section} Art ${roman}`, cite: `${section.cite}, Art. ${roman}`, text: part(index, articles[n + 1]?.index ?? lines.length) }),
      ),
    ]
  }
  const idBase = `${section.code}-C-${section.section.replace(/[^A-Za-z0-9.]+/g, '-')}`
  const make = (suffix: string, reference: string, text: string): CodeChunk => ({
    // ASCII ids: "(d–1)" is cited as written but filed as d-1, the form a Vectorize id and a URL both keep.
    id: `${idBase}-${suffix.replace(/[^A-Za-z0-9.-]+/g, '-')}`,
    topic: '',
    concept: section.heading,
    law: text,
    question: '',
    citation: `${section.cite}${reference} — '${text}'`,
    source: section.file,
  })

  const plain = lines.findIndex((line) => labelOf(line) !== null)
  const letteredAt = lines.findIndex((line) => labelOf(line, true) !== null)
  const lettered = letteredAt >= 0 && labelOf(lines[letteredAt], true)?.kind === 'lower-dot' && (plain < 0 || letteredAt < plain)
  const first = lettered ? letteredAt : plain
  const opening = first < 0 ? null : labelOf(lines[first], lettered)
  // A section that opens on "I." opens on a roman numeral: a lettered one opens on "A.".
  const top = opening?.kind === 'upper-dot' && opening.text === 'I' ? asRoman(opening) : opening
  const groups: { label: string | null; lines: string[] }[] = []
  if (top === null || top.value < 0) {
    groups.push({ label: null, lines })
  } else {
    if (first > 0) groups.push({ label: null, lines: lines.slice(0, first) })
    let current = top.value
    let group = { label: top.text, lines: [lines[first]] }
    for (let index = first + 1; index < lines.length; index += 1) {
      if (continues(lines, index, top.kind, current)) {
        groups.push(group)
        const label = inRun(labelOf(lines[index], lettered), top.kind)!
        if (label.value > current) current = label.value
        group = { label: label.text, lines: [] }
      }
      group.lines.push(lines[index])
    }
    groups.push(group)
  }

  const chunks: CodeChunk[] = []
  let paragraph = 0
  for (const group of groups) {
    // The paragraph level of this subsection -- the first label in it of
    // another kind than its own ("1." under "A.", "(1)" under "(j)") -- and,
    // for every line, the paragraph open at it. A piece is cited by the
    // paragraphs it spans, including the one already open where it begins: a
    // piece opening on "(a)" under paragraph 3 and running through paragraph
    // 10 is (A)(3)–(10), not "(A)(a)–(b)" -- Arizona's hydrant rule, (A)(5),
    // sat in exactly that piece.
    // The paragraph a line opens: its own label, or for the subsection's first
    // line, the label after it -- Maryland writes "(b) (1) Notwithstanding…",
    // and missing that (1) left every later paragraph out of sequence.
    const ownKind = labelOf(group.lines[0])?.kind
    // Inside a lettered subsection, a lower-case "(i)", "(ii)" is a roman
    // paragraph, not another letter: Wyoming nests (a), (i), (A), and read as
    // letters its hydrant rule, § 31-5-504(a)(ii)(B), was cited (a)(M).
    const roman = (label: Label | null): Label | null =>
      ownKind === 'lower' && label !== null && label.kind === 'lower' && /^[ivx]+$/.test(label.text) ? { kind: 'roman-lower', value: romanValue(label.text.toUpperCase()), text: label.text } : label
    const labels = group.lines.map((line, index) => roman(index === 0 ? inlineLabel(line) : labelOf(line)))
    const childKind = labels.find((label) => label !== null && label.kind !== ownKind)?.kind
    // Only the next paragraph in sequence moves it: Maryland reuses "(1)" a
    // level further down, and counting that one cited § 21-1004(g)(3)–(2).
    const open: (string | null)[] = []
    let value = 0
    for (const label of labels) {
      const next = label !== null && label.kind === childKind && (label.value === value + 1 || (label.value > value + 1 && jumpable(label, value)))
      // "(2.1)" after "(2)" is its own paragraph, as "(b-1)" is its own
      // subsection: cited as (2), Pennsylvania's junior licence passenger limit,
      // § 1503(c)(2.1), was filed under the paragraph before it.
      const inserted = label !== null && label.kind === childKind && label.value === value && INSERTED.test(label.text)
      if (next) value = label.value
      open.push(next || inserted ? label!.text : (open.at(-1) ?? null))
    }
    let offset = 0
    for (const [n, piece] of pieces(group.lines).entries()) {
      const start = offset
      offset += piece.length
      const text = joined(piece)
      if (group.label === null) {
        paragraph += 1
        chunks.push(make(`p${paragraph}`, '', text))
        continue
      }
      const nested = n === 0 ? null : labelOf(piece[0])
      const suffix = n === 0 ? group.label : nested === null ? `${group.label}-p${n + 1}` : `${group.label}-${nested.text}`
      const first = open[start]
      const last = open[offset - 1]
      const reference =
        n === 0 || first === null
          ? `(${group.label})`
          : first === last
            ? `(${group.label})(${first})`
            : `(${group.label})(${first})–(${last})`
      chunks.push(make(suffix, reference, text))
    }
  }
  // Two pieces of one subsection can begin at the same nested label; the second
  // keeps its place in the id -- skipping any id another chunk already has.
  // The District's § 50-2206.55 has both a paragraph (a)(1), filed a-1, and a
  // subsection "(a-1)"; renamed a-1-2, the second collided with (a-1)(2).
  const taken = new Set(chunks.map((chunk) => chunk.id))
  const seen = new Set<string>()
  return chunks.map((chunk) => {
    if (!seen.has(chunk.id)) {
      seen.add(chunk.id)
      return chunk
    }
    let count = 2
    while (taken.has(`${chunk.id}-${count}`)) count += 1
    const id = `${chunk.id}-${count}`
    taken.add(id)
    seen.add(id)
    return { ...chunk, id }
  })
}
