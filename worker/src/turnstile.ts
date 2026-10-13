/**
 * Keeping robots off the one public form whose job is to send email.
 *
 * `POST /api/partner/apply` takes an address a stranger typed and mails it.
 * Without a challenge in front of it that is an open mail relay with extra
 * steps -- and the cost is not only ours: a suppression list fills with
 * addresses that never asked for anything, and the sending reputation the login
 * links depend on is spent on somebody else's spam.
 *
 * Injected, like the mail sender beside it, so the suite drives the real code
 * path with a verifier it controls and the worker can be deployed before a
 * Turnstile key exists.
 */

export type TurnstileVerifier = (token: string, ip: string | null) => Promise<boolean>

interface SiteVerifyResponse {
  success?: boolean
}

/**
 * The verifier the deployed worker uses.
 *
 * An unset secret refuses everything, which is the same stance
 * `verifyWebhookSignature` takes: a worker deployed before
 * `wrangler secret put` must not treat "nothing to check against" as "nothing
 * to check". The visible cost is that self-registration does not work until the
 * key is set, which is a configuration step somebody will notice; the invisible
 * cost of the other choice is a form anybody can drive.
 */
export function turnstileFor(secret: string | undefined): TurnstileVerifier {
  return async (token, ip) => {
    if (secret === undefined || secret.length === 0) {
      console.error('no TURNSTILE_SECRET: refusing every application')
      return false
    }
    if (token.length === 0 || token.length > 2048) return false
    try {
      const body = new URLSearchParams({ secret, response: token })
      if (ip !== null) body.set('remoteip', ip)
      const response = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        },
      )
      const payload = (await response.json()) as SiteVerifyResponse
      return payload.success === true
    } catch (error) {
      // A challenge we could not check is a challenge that did not pass. The
      // form stays shut rather than opening because Cloudflare was slow.
      console.error('turnstile verification failed', error)
      return false
    }
  }
}
