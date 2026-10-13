import { parseEvent, readGeo, recordEvent } from './analytics'
import type { MailSender } from './mail'
import { alertIfReady } from './ready'

export interface EventDeps {
  /** What the ready alert is sent with. */
  sendMail: MailSender
  /**
   * Run something after the response, the way `ctx.waitUntil` does.
   *
   * Injected so a test can hold the promise and prove what it did, and so the
   * sink never awaits the alert: a slow or refused send must not cost a beacon,
   * because the browser that sent it is not listening and cannot retry.
   */
  defer: (work: Promise<unknown>) => void
  now: () => number
}

/**
 * The event sink.
 *
 * 204 with no body, always, whatever happened -- a bad payload, a full disk, a
 * name we have never heard of. The browser sent this with `sendBeacon` and is
 * not listening; an error here would be a status nobody reads describing a
 * problem nobody can fix, and the app must behave identically either way.
 *
 * Moved out of index.ts when it grew its first side effect beyond the write:
 * the ready alert. It is deferred and its failure is swallowed here, after the
 * row is written -- the alert is best-effort and the event is the record, so
 * the order and the catch are the whole of that promise.
 */
export async function handleEvent(
  request: Request,
  db: D1Database,
  cors: HeadersInit,
  deps: EventDeps,
): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: cors })
  let row = null
  try {
    // Read as text and parse here: beacons are sent as text/plain to stay a
    // simple CORS request, so the type header says nothing about the body.
    row = parseEvent(JSON.parse(await request.text()) as unknown)
  } catch {
    // Not JSON, or not one of our events. Silently, and deliberately: this is a
    // public endpoint, and logging every probe is how a log becomes a target.
  }
  if (row === null) return noContent
  const at = deps.now()
  try {
    // The geo is read from the request, never from the body parsed above: see
    // readGeo. Taken here, at the edge, because it is a fact about the
    // connection that is gone by the time anything else runs.
    await recordEvent(db, row, readGeo(request), at)
  } catch (error) {
    // A write we could not make is worth knowing about; it is still not the
    // browser's problem, so the answer is the same 204.
    console.error('event dropped', error)
    return noContent
  }
  deps.defer(
    alertIfReady(db, row, at, { sendMail: deps.sendMail }).catch((error: unknown) => {
      console.error('ready alert not sent', error)
    }),
  )
  return noContent
}
