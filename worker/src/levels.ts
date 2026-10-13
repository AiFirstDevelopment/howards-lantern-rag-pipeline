/**
 * The two levels a school is emailed about, as the worker reads `level_earned`.
 *
 * `src/exam.ts` defines the levels: Green Light is the first (one full test
 * passed) and Prepared the last (three in a row). The worker cannot import the
 * app, so it holds the numbers, and tests/unit/ready-level.test.ts holds these
 * copies to the names in `LEVELS` there. A level added or reordered in the app
 * without these moving would mail a school the wrong news on the wrong day,
 * with nothing failing to say so.
 */
export const GREEN_LIGHT_LEVEL = 1
export const CERTIFIED_LEVEL = 3
