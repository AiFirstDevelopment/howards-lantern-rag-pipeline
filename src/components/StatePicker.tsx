import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { StateOption } from '../data/laws'
import { useStrings } from '../language'

interface StatePickerProps {
  /** Every state on offer, in whatever order the manifest published them. */
  states: readonly StateOption[]
  /** The chosen state's code, or '' before anybody has chosen. */
  value: string
  onChange: (code: string) => void
  /** The id the screen's own `<label>` points at, so the label names this. */
  id: string
}

/** The listbox's id, referenced by `aria-controls` and by each option's id. */
const LIST_ID = 'state-options'

/**
 * Alphabetical by name, ascending, and by `localeCompare` rather than `<`.
 *
 * The picker used to render the manifest's order, which is publication order:
 * Maryland, Pennsylvania, Virginia, West Virginia, Ohio, Washington, New
 * Jersey, New York, Wisconsin. That reads as random to anybody who does not
 * know the release history, and every state added makes it read worse -- the
 * newest one lands at the bottom, so the list is sorted by a fact about us
 * rather than by anything a learner knows.
 *
 * Presentation only. `cardStateFor` still falls back to the *manifest's* first
 * offered state for the licence drawn before a choice, deliberately: that is a
 * statement about what we lead with rather than about what sorts first, and
 * tests/e2e/welcome.spec.ts pins it to `PUBLISHED_STATES[0]`.
 */
function alphabetical(states: readonly StateOption[]): StateOption[] {
  return [...states].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * Whether a state answers to what has been typed.
 *
 * Substring rather than prefix, and over the code as well as the name, because
 * the two things somebody types are part of the name ("jersey") and the postal
 * code they already know ("WI"). A prefix-only filter would hide New Jersey
 * from "jersey" and West Virginia from "virginia", and a filter that hides a
 * state somebody half-remembers is worse than no filter: the short list it
 * leaves behind looks complete.
 */
function matches(state: StateOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return state.name.toLowerCase().includes(needle) || state.code.toLowerCase().includes(needle)
}

/**
 * The state selector: a text box that filters a listbox as you type.
 *
 * It was a native `<select>`, which cannot hold a search field -- so with nine
 * states and fifty coming, finding yours meant scrolling a wheel on a phone.
 * This is the ARIA combobox pattern instead, where the closed control *is* the
 * search field, so the thing you type into sits at the top of the list it
 * filters.
 *
 * Two details are load-bearing rather than decorative:
 *
 * - Options commit on `mousedown`, with the default cancelled. A `click`
 *   handler alone loses the race against the input's `blur`, which closes the
 *   list -- so the option unmounts before its own click lands and tapping a
 *   state does nothing at all.
 * - The input shows the query while open and the chosen state's *name* while
 *   closed. What is stored and reported upward is always the code; a control
 *   that displayed "WI" would be showing the learner our key.
 *
 * Keeps `data-testid="state-selector"` and the `combobox` role the native
 * select had: `expectNoIdentityInputs` exempts that testid by exact string, and
 * every e2e helper finds this control by that role and its label.
 */
export default function StatePicker({ states, value, onChange, id }: StatePickerProps) {
  const [open, setOpen] = useState(false)
  const t = useStrings()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const sorted = useMemo(() => alphabetical(states), [states])
  const shown = useMemo(() => sorted.filter((state) => matches(state, query)), [sorted, query])
  const selectedName = sorted.find((state) => state.code === value)?.name ?? ''

  // Clamp rather than reset: typing narrows the list under the cursor, and an
  // active index left pointing past the end makes Enter commit nothing while
  // the list plainly shows a match.
  useEffect(() => {
    setActive((index) => (index < shown.length ? index : 0))
  }, [shown.length])

  // Keep the highlighted row on screen when it is reached by keyboard. Without
  // this the list scrolls nothing past its tenth row and the highlight appears
  // to stop moving.
  useEffect(() => {
    if (!open) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(state: StateOption): void {
    onChange(state.code)
    setOpen(false)
  }

  /**
   * Open the list, and clear whatever was typed into it last time.
   *
   * The reset lives here and nowhere else. It used to be repeated on every path
   * that closes the list, which sounds harmless and is not: with two mechanisms
   * clearing the same state, breaking either one leaves the other covering for
   * it, and the test that is supposed to guard "a half-typed search never shows
   * up as a selection" passes against both mutations. One place to clear it is
   * one place to break, which is what makes the guard mean something.
   */
  function openList(): void {
    if (open) return
    setQuery('')
    setActive(Math.max(0, sorted.findIndex((state) => state.code === value)))
    setOpen(true)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      if (shown.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (index + step + shown.length) % shown.length)
      return
    }
    if (event.key === 'Enter') {
      // Only while the list is offering something. Enter on a closed picker has
      // to reach the form and press Start, which is how somebody arriving on a
      // link that already named their state leaves this screen in one key.
      if (open && shown[active] !== undefined) {
        event.preventDefault()
        choose(shown[active])
      }
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      // Closes when focus leaves the control *and* its list. Testing
      // `relatedTarget` against the container is what lets focus move between
      // the input and the listbox without the list closing under it.
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
        }
      }}
    >
      <input
        id={id}
        data-testid="state-selector"
        role="combobox"
        type="text"
        // Off on all four: a state picker is not somewhere the browser should
        // be guessing, and iOS capitalising the first letter of a filter that
        // matches case-insensitively only makes the box look like it is
        // fighting whoever is typing.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={
          open && shown[active] !== undefined ? `${LIST_ID}-${shown[active].code}` : undefined
        }
        placeholder={t.picker.search}
        value={open ? query : selectedName}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={openList}
        onMouseDown={openList}
        onKeyDown={onKeyDown}
        className="mt-2 min-h-14 w-full rounded-2xl border-2 border-b-4 border-line bg-paper px-4 py-3 text-lg font-extrabold text-ink placeholder:font-extrabold placeholder:text-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-soft"
      />
      {open && (
        <ul
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label={t.picker.states}
          data-testid="state-options"
          className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border-2 border-line bg-paper py-1 shadow-lg"
        >
          {shown.map((state, index) => (
            <li
              key={state.code}
              id={`${LIST_ID}-${state.code}`}
              role="option"
              aria-selected={state.code === value}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(state)
              }}
              onMouseMove={() => setActive(index)}
              // The chosen state and the row under the cursor are different
              // things and are drawn differently, but neither is drawn with a
              // glyph in the row's text. A tick rendered as a character would
              // put "✓ Maryland" into the option's text content, and the specs
              // that assert the offered list -- published-states.spec.ts holds
              // it against the real manifest -- compare those strings to the
              // state names. `aria-selected` is what carries the selection to a
              // screen reader; the background carries it to everyone else.
              className={`cursor-pointer px-4 py-3 text-lg font-extrabold text-ink ${
                index === active ? 'bg-sky-soft' : state.code === value ? 'bg-brand-soft' : ''
              }`}
            >
              {state.name}
            </li>
          ))}
          {shown.length === 0 && (
            // Names the search that found nothing, so an empty list cannot be
            // mistaken for a build that shipped no states.
            <li data-testid="state-options-empty" className="px-4 py-3 text-sm font-bold text-muted">
              {t.picker.noMatch(query.trim())}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
