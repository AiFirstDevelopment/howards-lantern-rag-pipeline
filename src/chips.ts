import type { AskAnswer } from './ask'
import { shuffle } from './shuffle'

/**
 * The chips under the nationwide box (docs/plans/trusted-by-date.md,
 * decisions 15 and 17): questions answered once by `npm run chips:build`,
 * checked by tests/unit/chips.test.ts, and published by the corpus plugin.
 *
 * Fetched rather than bundled. Each stored answer carries every citation the
 * live answer would, quotes and all, and two languages of fifty of them run to
 * hundreds of kilobytes -- a weight every learner would download for a row
 * only the Nationwide tick shows.
 */
export const CHIPS_PATH = '/ask-laws/chips.json'

/**
 * One state's chips (docs/plans/what-happens-if.md, phase 4, decision 24):
 * twelve questions a teenager types, answered for that state by
 * `npm run chips:build -- --states XX`. A file a state, so a phone downloads
 * only the state it is answering for.
 */
export function stateChipsPath(code: string): string {
  return `/ask-laws/chips/${code}.json`
}

/** storage.ts's prefix: the ids this browser has tapped, so a fact is not offered twice before the rest. */
export const CHIPS_TAPPED_KEY = 'teach-and-test/v1/chips-tapped'

/**
 * The same list for one state's chips. Keyed by the state, because every
 * state's pool has the same twelve ids: one list for all of them would mark
 * Texas's curfew answer read because the learner had tapped Maryland's.
 */
export function stateChipsTappedKey(code: string): string {
  return `${CHIPS_TAPPED_KEY}/${code}`
}

/** At most this many at once: a row of three fits a phone; more is a wall of buttons above the answer. */
export const CHIPS_SHOWN = 3

/** One stored answer as Pages publishes it. */
export interface StoredChip {
  id: string
  lang: string
  question: string
  answer: string
  sources: NonNullable<AskAnswer['citations']>
  absent: string[]
  asOf: string
}

const loaded = new Map<string, Promise<StoredChip[]>>()

/**
 * The published answers at `url` (the nationwide file unless a state's is
 * named), fetched once a page load. A failure is an empty row, not an error:
 * the chips are a shortcut, and the box above them still asks.
 */
export function loadChips(url: string = CHIPS_PATH): Promise<StoredChip[]> {
  if (!loaded.has(url)) {
    loaded.set(
      url,
      fetch(url)
        .then((response) => (response.ok ? (response.json() as Promise<StoredChip[]>) : []))
        .catch(() => []),
    )
  }
  return loaded.get(url)!
}

/** The ids tapped on this browser under `key`; empty when storage cannot be read. */
export function tappedChips(key: string = CHIPS_TAPPED_KEY): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * One more chip tapped. When that makes every chip in the pool tapped, the
 * list is cleared, so the next load offers the whole pool again rather than
 * nothing at all.
 */
export function recordChipTap(id: string, pool: readonly string[], key: string = CHIPS_TAPPED_KEY): void {
  const tapped = new Set([...tappedChips(key), id])
  try {
    if (pool.every((each) => tapped.has(each))) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify([...tapped]))
  } catch {
    // Private mode or a full store: a chip may be offered again, which is all.
  }
}

/**
 * Three of the pool at random, none of them one this browser has tapped. The
 * tapped ids are shared by both languages, so one language's pool can be
 * spent while the list still holds the other's untapped ids: then the whole
 * pool is offered again rather than an empty row.
 */
export function drawChips(pool: readonly StoredChip[], tapped: readonly string[]): StoredChip[] {
  const untapped = pool.filter((chip) => !tapped.includes(chip.id))
  return shuffle(untapped.length === 0 ? pool : untapped).slice(0, CHIPS_SHOWN)
}

/**
 * The row after a tap: the tapped chip's place taken by one this browser has
 * not tapped and the row does not already show, and the row topped up to
 * CHIPS_SHOWN the same way, with the other chips left where they were. A
 * tapped chip used to leave a gap nothing filled, so three taps emptied the
 * row until the next page load -- and a device that had tapped most of the
 * pool lost the row on its first tap. When every chip has been tapped the
 * tapped list is already cleared (recordChipTap), and the row refills from
 * the whole pool less the chip just tapped; when the pool is spent but for
 * the chips on the row, nothing is drawn and the row shortens, so a tapped
 * chip is still never offered again before the rest.
 */
export function refillChips(shown: readonly StoredChip[], tappedId: string, pool: readonly StoredChip[], tapped: readonly string[]): StoredChip[] {
  const kept = shown.filter((chip) => chip.id !== tappedId)
  const onRow = new Set(kept.map((chip) => chip.id))
  const fresh = shuffle(pool.filter((chip) => chip.id !== tappedId && !onRow.has(chip.id) && !tapped.includes(chip.id))).slice(0, CHIPS_SHOWN - kept.length)
  const at = shown.findIndex((chip) => chip.id === tappedId)
  kept.splice(at < 0 ? kept.length : at, 0, ...fresh)
  return kept
}

/** A stored answer in the shape a live one arrives in, so the box draws it the same way. */
export function chipAnswer(chip: StoredChip): AskAnswer {
  return {
    id: 'answer',
    answer: chip.answer,
    citations: chip.sources,
    ...(chip.absent.length === 0 ? {} : { absent: chip.absent }),
  }
}
