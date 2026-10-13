import { createContext, useContext } from 'react'

/**
 * Which state's material is on screen, named for the header to show.
 *
 * The other half of what src/site.ts says. That one answers "which of our names
 * did you come in through", because the two are separate origins with separate
 * progress; this answers "whose rules am I being taught", because the app now
 * has a way back to the state list and a learner who takes it needs to be able
 * to tell, at a glance and from any screen, which state they ended up in.
 *
 * Ambient the same way `StatusContext` and `MenuContext` are, and for the same
 * reason: it is drawn by the shell, and no screen component should have to
 * carry a prop for a header it does not draw.
 *
 * Null means say nothing -- before a state is chosen, and on the state list
 * itself, where naming the state above a picker already set to it would be the
 * same answer twice.
 */
export const PlaceContext = createContext<string | null>(null)

export function usePlace(): string | null {
  return useContext(PlaceContext)
}
