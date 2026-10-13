import { createContext, useContext, useSyncExternalStore } from 'react'
import { spanishConcept, spanishLaw, type Law } from './data/laws'
import { anySpanish, hasSpanish } from './products'
import { setStoredLanguage, storedLanguage } from './storage'
import { STRINGS, type Lang, type Strings } from './strings'

/**
 * Which language the app is in, and the one rule that decides it
 * (docs/plans/spanish-app.md, §3).
 *
 * Two things, kept apart on purpose. The **choice** is what the learner asked
 * for and is stored; the **language on show** is the choice where it can be
 * honoured and English where it cannot. A state with no Spanish pack shows
 * English with the switch disabled -- and leaves the choice alone, so going
 * back to a state that has one is Spanish again without anybody touching the
 * switch.
 */

let choice: Lang | null = null
const listeners = new Set<() => void>()

/** The stored choice, read once and then held, so every render agrees. */
export function languageChoice(): Lang {
  if (choice === null) choice = storedLanguage()
  return choice
}

/** Record a choice: stored, and every screen reading it re-rendered. */
export function chooseLanguage(lang: Lang): void {
  choice = lang
  setStoredLanguage(lang)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The stored choice, as React state. */
export function useLanguageChoice(): Lang {
  return useSyncExternalStore(subscribe, languageChoice, languageChoice)
}

/**
 * `?lang=es` or `?lang=en` on the address, stored before the first render.
 *
 * Before, not in an effect: the first screen somebody sees on a Spanish link
 * has to be Spanish, and an effect runs after the English one has been drawn.
 * src/main.tsx calls this ahead of `createRoot`.
 *
 * Ignored entirely while the build carries no pack. A link that stored `'es'`
 * in a browser with nothing to show it would be a choice waiting to surprise
 * somebody the day a pack lands -- and nothing about it would be visible until
 * then.
 */
export function captureLanguageParam(search: string, productId: string): void {
  if (!anySpanish(productId)) return
  const asked = new URLSearchParams(search).get('lang')
  if (asked === 'es' || asked === 'en') chooseLanguage(asked)
}

/**
 * What a screen can offer, given the state it is about.
 *
 * `offered` is whether the build has any pack at all -- the switch exists only
 * then. `available` is whether this screen's state has one: always, before a
 * state is chosen, and otherwise exactly when that state's pack is bundled.
 */
export interface LanguageScope {
  lang: Lang
  /** The state this screen is about, or null before one is chosen. */
  state: string | null
  offered: boolean
  available: boolean
  /** Asked for by the switch; resolves once any pack it needs has arrived. */
  choose: (lang: Lang) => void
}

export function languageScope(
  productId: string,
  state: string | null,
  chosen: Lang,
  choose: (lang: Lang) => void,
): LanguageScope {
  const offered = anySpanish(productId)
  const available = offered && (state === null || hasSpanish(productId, state))
  return { lang: available && chosen === 'es' ? 'es' : 'en', state, offered, available, choose }
}

export const LanguageContext = createContext<LanguageScope>({
  lang: 'en',
  state: null,
  offered: false,
  available: false,
  choose: () => {},
})

export function useLanguage(): LanguageScope {
  return useContext(LanguageContext)
}

/** The copy for the language on show. */
export function useStrings(): Strings {
  return STRINGS[useLanguage().lang]
}

/**
 * A law as it should be shown: the pack's text in Spanish, the corpus's in
 * English. The decisions -- which answer is right, what is asked next -- are
 * made on the English law the flow holds; this only changes what is read.
 */
export function useLaw(law: Law): Law {
  const { lang, state } = useLanguage()
  if (lang !== 'es' || state === null) return law
  return spanishLaw(state, law.id) ?? law
}

/** The same lookup, for a screen that shows a list of laws. */
export function useLawLookup(): (law: Law) => Law {
  const { lang, state } = useLanguage()
  return (law) => (lang !== 'es' || state === null ? law : (spanishLaw(state, law.id) ?? law))
}

/**
 * How a concept is named on screen: the pack's label in Spanish, the id with
 * its hyphens replaced in English (docs/plans/spanish-md.md, §9). Every surface
 * that draws a concept name reads this, so a Spanish card never shows
 * "right of way" over a Spanish law.
 */
export function useConceptLabel(): (concept: string) => string {
  const { lang, state } = useLanguage()
  const t = useStrings()
  return (concept) =>
    (lang === 'es' && state !== null ? spanishConcept(state, concept) : undefined) ??
    t.common.readable(concept)
}
