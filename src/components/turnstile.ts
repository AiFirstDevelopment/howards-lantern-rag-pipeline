import { useEffect, useRef, useState } from 'react'

interface TurnstileApi {
  render(
    selector: string,
    options: {
      sitekey: string
      callback: (token: string) => void
      'error-callback'?: () => void
    },
  ): string | undefined
  /** Runs the challenge again in the same widget; the callback fires with a fresh token. */
  reset(widget?: string): void
}

/**
 * How long a tap waits for the challenge before going without one.
 *
 * Cloudflare's api.js is a third-party script and a form is tappable long
 * before it has a token -- measured at 1.9s on an unthrottled desktop and 5.0s
 * on a throttled connection. Submitting inside that window sent an empty token
 * and the worker, correctly, refused it: the designed first tap on the
 * recruitment path was answered "that did not look like a person".
 *
 * So a tap waits. **Bounded, and released early on any error**, because the
 * other half of this is worse: a script that never loads at all -- an
 * ad-blocker, a network that blocks Cloudflare's challenge host -- must not
 * leave somebody holding a form that can never be used. Past the deadline the
 * submission goes without a token and the worker decides, which means a
 * refusal carrying an address rather than a dead end.
 */
const CHALLENGE_WAIT_MS = 2_500

/**
 * The Turnstile widget, drawn into `#<widgetId>` on a surface with no session.
 *
 * Lifted out of the ask box the day the contact form needed the same thing,
 * so the wait, the give-up and the deadline exist once. `widgetId` must not be
 * `turnstile`: an element with that id becomes `window.turnstile` through
 * named access on the window, and Cloudflare's api.js reads exactly that name
 * to decide whether it has already loaded -- which made the partner
 * application draw no widget at all and refuse every applicant as a robot.
 *
 * An empty `siteKey` -- the portal, and any build without a key -- draws no
 * widget and resolves to an empty token at once. The worker is what decides; a
 * challenge that only exists in the browser protects nothing.
 */
export function useTurnstile(siteKey: string, widgetId: string): {
  /** The token, once the challenge has settled one way or the other. Never rejects. */
  challenge: () => Promise<string>
  /** The challenge is expected, and has neither produced a token nor given up. */
  waiting: boolean
  /**
   * Spend the token and ask for another. A Turnstile token is redeemed once at
   * siteverify, so a form that was refused -- or whose mail did not go -- and
   * says "try again" has to mean it: the retry with the same token is refused
   * as a robot every time, and the only way out was Back and reopen.
   */
  reset: () => void
} {
  const [token, setToken] = useState('')
  const [gaveUp, setGaveUp] = useState(false)
  // Refs because `challenge` reads them from inside an async loop; the
  // rendered line reads the state copies.
  const settled = useRef(siteKey.length === 0)
  const current = useRef('')
  const api = useRef<TurnstileApi | null>(null)
  const widget = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (siteKey.length === 0) return
    const give = (value: string) => {
      current.current = value
      settled.current = true
      setToken(value)
    }
    // A challenge that cannot run must not be a form that cannot be used.
    const giveUp = () => {
      settled.current = true
      setGaveUp(true)
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onerror = giveUp
    script.onload = () => {
      const loaded = (window as unknown as { turnstile?: TurnstileApi }).turnstile
      if (loaded === undefined) return giveUp()
      api.current = loaded
      widget.current = loaded.render(`#${widgetId}`, {
        sitekey: siteKey,
        callback: give,
        'error-callback': giveUp,
      })
    }
    document.head.append(script)
  }, [siteKey, widgetId])

  async function challenge(): Promise<string> {
    const deadline = Date.now() + CHALLENGE_WAIT_MS
    while (!settled.current && Date.now() < deadline) {
      await new Promise((resume) => setTimeout(resume, 50))
    }
    return current.current
  }

  function reset(): void {
    if (api.current === null) return
    current.current = ''
    settled.current = false
    setToken('')
    try {
      api.current.reset(widget.current)
    } catch {
      // A widget that cannot be reset is a challenge that cannot run; the next
      // tap goes without a token and the worker decides, as on first load.
      settled.current = true
      setGaveUp(true)
    }
  }

  return { challenge, waiting: siteKey.length > 0 && token.length === 0 && !gaveUp, reset }
}
