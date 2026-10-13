import { createContext, useContext } from 'react'

/**
 * How any screen opens the menu, without every screen carrying a prop for it.
 *
 * Ambient the same way `StatusContext` is, and for the same reason: the button
 * is drawn by the shell, on every screen, and no screen component should have
 * to know it exists.
 *
 * Null means do not draw it -- which is what the shell provides while an
 * overlay is already open. The privacy page does not need a way back to the
 * menu it was opened from; it has the same Back button every other page has.
 */
export interface MenuApi {
  open: () => void
  /**
   * Open the ask page directly.
   *
   * The second button in the chrome was the feedback form, put there because a
   * learner with something to say is looking at the screen that prompted it.
   * The ask box took its place the day it shipped: a question about how the
   * app works is the thing a learner has mid-card far more often than a
   * complaint, and the box can answer it there and then. Feedback stays one
   * tap inside the menu, on its front, and the ask page links to it.
   */
  ask: () => void
}

export const MenuContext = createContext<MenuApi | null>(null)

export function useMenu(): MenuApi | null {
  return useContext(MenuContext)
}
