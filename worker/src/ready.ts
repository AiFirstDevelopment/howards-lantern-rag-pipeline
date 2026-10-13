/**
 * The two alerts about a student on an invite: Green Light, when they pass
 * their first full practice test, and Prepared, when they are ready. The
 * school that made the invite is told about each, once.
 *
 * Two because a knowledge-test appointment is booked weeks ahead, so the day a
 * student is ready is too late to start looking for one: Green Light is when
 * to book the appointment, Prepared is when they are ready to sit it. Only
 * Prepared is a readiness claim -- the pass-or-refund guarantee rests on it
 * alone -- and neither alert replaces the other.
 *
 * A school owner who teaches all day does not open a portal to read a roster,
 * and the day a student is ready to book is the day they go looking for
 * whoever is nearest. This is the one message that reaches the school at that
 * moment. It is a convenience on top of the roster, not a replacement for it:
 * `level_earned` is a beacon, ad blockers drop beacons, and a dropped one means
 * no mail and a roster that shows the last thing that did arrive. The portal
 * caption says so, and the pitch promises the portal.
 *
 * Three properties, each held by a test in worker/tests/ready.test.ts:
 *
 * 1. **The partner comes from the code row.** The session's last-touch code is
 *    looked up the way `TOUCHES` attributes everything else, and the address is
 *    the invite's own partner's. Nothing in the event names a partner, and
 *    nothing here would read it if it did.
 * 2. **Once per invite, per level.** Each level has its own column --
 *    `green_light_notified_at`, `notified_at` -- claimed by an UPDATE that only
 *    matches while it is null, before the mail is handed over, so a replayed
 *    or duplicated beacon changes no row and sends nothing, and one level's
 *    claim can never swallow the other's.
 * 3. **The mail says the label, the state and the date.** See `readyEmail`
 *    and `greenLightEmail`.
 */

import { CERTIFIED_LEVEL, GREEN_LIGHT_LEVEL } from './levels'
import { greenLightEmail, readyEmail, type MailSender, type Message } from './mail'
import type { EventRow } from './analytics'
import { stateNameFor } from './states'

export interface ReadyDeps {
  sendMail: MailSender
}

/**
 * The levels that send a mail, the column each is claimed in, and what it says.
 *
 * The column name is interpolated into SQL, so it comes from this table and
 * never from anything a request carried. A level missing here sends nothing.
 */
const ALERTS: Readonly<
  Record<
    number,
    {
      column: string
      /**
       * A column that, once set, makes this alert pointless. The heads-up says
       * "book the appointment -- we will email you again when they are ready",
       * and a second browser on the same invite can pass its first test after
       * the student is already Prepared; sent then, it would promise a mail
       * that already came and advise booking for a day already here.
       */
      unlessSent: string | null
      compose: (label: string, state: string, date: string) => Message
    }
  >
> = {
  [GREEN_LIGHT_LEVEL]: {
    column: 'green_light_notified_at',
    unlessSent: 'notified_at',
    compose: greenLightEmail,
  },
  [CERTIFIED_LEVEL]: { column: 'notified_at', unlessSent: null, compose: readyEmail },
}

/** A day as the mail writes it: "September 25, 2026". Always UTC, as every clock here is. */
function longDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Send the alert for this event, if it is one; true when a mail went out.
 *
 * `at` is the event's own server time in milliseconds -- the same clock
 * `events.at` is written in -- so the last-touch lookup cannot see a referral
 * that arrived after the level did.
 */
export async function alertIfReady(
  db: D1Database,
  row: EventRow,
  at: number,
  deps: ReadyDeps,
): Promise<boolean> {
  if (row.name !== 'level_earned' || row.level === null) return false
  const alert = ALERTS[row.level]
  if (alert === undefined) return false

  // Last touch, as the commission and every learner screen attribute it: the
  // most recent code this browser arrived on before the level was earned.
  const touch = await db
    .prepare(
      `SELECT ref FROM events
        WHERE session = ? AND name = 'referral_seen' AND ref IS NOT NULL AND at <= ?
        ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .bind(row.session, at)
    .first<{ ref: string }>()
  if (touch === null) return false

  const invite = await db
    .prepare(
      `SELECT c.label AS label, p.email AS email
         FROM partner_codes c
         JOIN partners p ON p.id = c.partner_id
        WHERE c.code = ? AND c.kind = 'invite' AND c.status = 'active'
          AND c.label IS NOT NULL AND c.${alert.column} IS NULL
          ${alert.unlessSent === null ? '' : `AND c.${alert.unlessSent} IS NULL`}
          AND (c.expires_at IS NULL OR c.expires_at > ?)
          AND p.status = 'active'`,
    )
    .bind(touch.ref, Math.floor(at / 1000))
    .first<{ label: string; email: string }>()
  if (invite === null) return false

  // The claim, before the send. Two beacons racing both reach this line; only
  // one of them changes a row.
  const claimed = await db
    .prepare(
      `UPDATE partner_codes SET ${alert.column} = ?
        WHERE code = ? AND kind = 'invite' AND ${alert.column} IS NULL`,
    )
    .bind(Math.floor(at / 1000), touch.ref)
    .run()
  if (Number(claimed.meta.changes ?? 0) === 0) return false

  const stateName = stateNameFor(row.state) ?? 'state'
  return await deps.sendMail({
    ...alert.compose(invite.label, stateName, longDay(at)),
    to: invite.email,
  })
}
