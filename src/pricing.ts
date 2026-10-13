/**
 * What a question costs us, what a token sells for, and the floor between them
 * (docs/plans/trusted-by-date.md, decisions 20 and 21).
 *
 * **A plain data module.** The pop-up reads the packs from here, the worker
 * reads them from here to decide how many tokens a paid session is worth, and
 * tests/unit/pricing.test.ts recomputes every pack's margin from the numbers
 * below. A price typed anywhere else is a second copy that the margin test
 * cannot see: the pop-up would then quote one figure while the webhook credited
 * another, and nothing would fail until a buyer wrote in.
 *
 * Imports nothing, so the worker can bundle it without dragging the app in.
 */

/**
 * What one question costs in model calls, as measured, with the date.
 *
 * A state question is the rephraser, the reranker and one Opus answer over
 * eight laws: about 1.5 cents. A nationwide question reads one or two topic
 * files of every state's verdict law: 6 to 8 cents, 7 taken here. The ratio
 * between them is the token ratio below. Remeasure when the model, its price
 * or the laws a nationwide question reads change, and change these with it --
 * the margin test is only as true as these two numbers.
 */
export const MEASURED_COST = {
  date: '2026-10-10',
  stateCents: 1.5,
  nationwideCents: 7,
} as const

/** A token is one state question; a nationwide question reads every state, and costs five. */
export const TOKENS_PER_QUESTION = { state: 1, nationwide: 5 } as const

export type QuestionKind = keyof typeof TOKENS_PER_QUESTION

/**
 * Stripe's fee on a US card: 2.9 percent plus 30 cents a charge. The fixed
 * part is a third of a one-dollar sale, which is why the margin is stated on
 * what is left after it rather than on the price.
 */
export const STRIPE_FEE = { percent: 2.9, fixedCents: 30 } as const

/**
 * The gross margin every pack must keep at its worst case, on its net after
 * the fee: the low end of what software and AI services hold themselves to.
 */
export const MARGIN_FLOOR = 0.7

/** Joel, 2026-10-10: nothing is sold for less than a dollar. */
export const MIN_PRICE_CENTS = 100

export interface Pack {
  /** Whole dollars: the key `STRIPE_TOKEN_PRICES` names each live Price under. */
  dollars: number
  cents: number
  tokens: number
}

/**
 * The four packs. The dollar pack is the door and buys fewer per dollar,
 * because the fixed fee is a third of it; the larger ones are where the fee
 * stops mattering. The twenty-five dollar pack is the classroom's.
 */
export const PACKS: readonly Pack[] = [
  { dollars: 1, cents: 100, tokens: 12 },
  { dollars: 5, cents: 500, tokens: 75 },
  { dollars: 10, cents: 1000, tokens: 160 },
  { dollars: 25, cents: 2500, tokens: 420 },
]

/** The pack sold at exactly this amount, or null: what a paid session is worth is decided by what was paid. */
export function packForAmount(cents: number | null | undefined): Pack | null {
  return PACKS.find((pack) => pack.cents === cents) ?? null
}

/** The pack named by its dollars, or null. */
export function packOf(dollars: unknown): Pack | null {
  return PACKS.find((pack) => pack.dollars === dollars) ?? null
}

/** A pack's price as a buyer reads it: $1, $25 -- whole dollars without cents. */
export function priceLabel(pack: Pack): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: pack.cents % 100 === 0 ? 0 : 2,
  }).format(pack.cents / 100)
}
