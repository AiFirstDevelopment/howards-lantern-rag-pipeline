import { createContext, useContext } from 'react'
import type { TopBarProps } from './components/TopBar'

/**
 * What the shell's top bar shows from wherever the learner is. Ambient rather
 * than threaded, so screens that do not care about global progress never carry
 * props for it. Null on the state list, which has nothing to report yet.
 */
export type Status = TopBarProps

export const StatusContext = createContext<Status | null>(null)

export function useStatus(): Status | null {
  return useContext(StatusContext)
}
