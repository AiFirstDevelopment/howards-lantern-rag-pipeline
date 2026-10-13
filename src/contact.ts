/**
 * What the contact route answers with, in one place because two bundles read
 * it. Kept in step with worker/src/contact.ts, which enforces the limit.
 */
export interface ContactAnswer {
  sent?: boolean
  error?: string
  /** Why it was refused: the address or message, the challenge, or the mail itself. */
  reason?: 'invalid' | 'challenge' | 'send'
  /** The support address, on every refusal, as the way out. */
  contact?: string
}

export const MESSAGE_LIMIT = 2000
