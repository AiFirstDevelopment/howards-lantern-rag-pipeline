/**
 * A random v4 UUID, used wherever this app needs to tell one browser from
 * another without knowing anything about the person using it.
 *
 * Shared by the two identifiers that exist -- the paywall's device id and the
 * analytics id -- so that neither is derived from the other and neither can
 * drift into being derived from something about the person. They call the same
 * generator; they never call each other.
 */
export function uuid(): string {
  // randomUUID needs a secure context; the fallback keeps http://localhost and
  // older browsers working rather than leaving them without an id at all.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
