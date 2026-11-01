/**
 * Money helpers. All amounts in Kinvo are whole NZD cents (ADR-0007).
 *
 * `Cents` is a "branded" number: at runtime it's a plain integer, but the
 * TypeScript compiler won't let you pass an ordinary number where `Cents`
 * is expected. That stops dollars and cents being mixed up by accident.
 * The only ways to create one are `toCents` and `parseDollars`.
 */
export type Cents = number & { readonly __brand: 'Cents' }

export const ZERO: Cents = 0 as Cents

/** Validates that a number is a whole, non-negative, safely representable cent amount. */
export function toCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Cents must be a safe integer, got ${value}`)
  }
  if (value < 0) {
    throw new RangeError(`Cents must not be negative, got ${value}`)
  }
  return value as Cents
}

export type ParseResult =
  | { ok: true; cents: Cents }
  | { ok: false; error: string }

// Optional "$", digits with optional thousands commas, optional 1–2 decimal places.
const DOLLAR_PATTERN = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses what a user typed (e.g. "200", "$1,250.5") into cents.
 *
 * Works on the text directly instead of calling parseFloat, so no
 * floating-point rounding can creep in.
 */
export function parseDollars(input: string): ParseResult {
  const trimmed = input.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Enter an amount.' }
  }
  if (trimmed.startsWith('-')) {
    return { ok: false, error: 'Amount can’t be negative.' }
  }

  const match = DOLLAR_PATTERN.exec(trimmed)
  const wholePart = match?.[1]
  if (wholePart === undefined) {
    return { ok: false, error: 'Enter an amount like 200 or 200.50.' }
  }

  const fractionPart = match?.[2] ?? ''
  const dollars = Number(wholePart.replaceAll(',', ''))
  const cents = Number(fractionPart.padEnd(2, '0'))
  const total = dollars * 100 + cents

  if (!Number.isSafeInteger(total)) {
    return { ok: false, error: 'That amount is too large.' }
  }
  return { ok: true, cents: total as Cents }
}

const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' })

/** Formats cents for display, e.g. 15000 → "$150.00". */
export function formatCents(amount: Cents): string {
  return nzd.format(amount / 100)
}

/** Adds cent amounts, refusing to overflow into unsafe integers. */
export function sumCents(amounts: readonly Cents[]): Cents {
  let total = 0
  for (const amount of amounts) {
    total += amount
  }
  return toCents(total)
}

/**
 * Splits `total` into parts proportional to `weights`, in whole cents.
 *
 * Each share is rounded down; any leftover cents go to the first part
 * (ADR-0004), so the parts always add up exactly to `total`.
 *
 * Example: splitting 10000 across weights [1, 1, 1] gives [3334, 3333, 3333].
 */
export function allocateProportionally(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.length === 0) {
    throw new RangeError('At least one weight is required.')
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('Weights must be finite and non-negative.')
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0)
  if (weightSum === 0) {
    throw new RangeError('Weights must not all be zero.')
  }

  const shares = weights.map((w) => Math.floor((total * w) / weightSum))
  const leftover = total - shares.reduce((sum, s) => sum + s, 0)
  const [first = 0, ...rest] = shares

  return [first + leftover, ...rest].map(toCents)
}
