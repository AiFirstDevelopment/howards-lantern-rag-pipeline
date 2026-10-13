/**
 * Rows written into the registry by hand, each with the words it rests on:
 * a schedule a statute prints in prose (Florida's § 318.18, "(3)(b) … $25 …"),
 * a schedule whose layout no adapter reads, and a `local` state's range from
 * its code ("a fine not to exceed $200", Texas § 521.025(c)). Nothing is
 * parsed, so the check is the whole of the adapter's worth: every quote is
 * looked for in the page fetched today, and a row whose words the page no
 * longer says is not written -- a registry typed in October must not go on
 * quoting a fine the legislature changed in March.
 */
import type { Candidate, Format, PenaltySource } from '../source'

export const statuteList: Format = {
  urls: (source) => [...new Set([source.url, ...(source.rows ?? []).map((row) => row.url ?? source.url)])],
  rows(_pages, source: PenaltySource): Candidate[] {
    return (source.rows ?? []).map((row) => ({
      section: row.section,
      code: row.code,
      offence: row.offence,
      fine_text: row.fine,
      fine_min_cents: row.min ?? null,
      fine_max_cents: row.max ?? null,
      points: row.points ?? null,
      appear: row.appear,
      quote: row.quote,
      url: row.url ?? source.url,
      ...(row.title === undefined ? {} : { title: row.title }),
    }))
  },
}
