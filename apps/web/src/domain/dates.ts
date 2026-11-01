/**
 * Calendar dates as "YYYY-MM-DD" strings (NF-04).
 *
 * Due dates are days, not moments, so they're kept as plain strings and
 * calculated in UTC. That way time zones and daylight saving can never move a
 * due date to the day before.
 */
export type IsoDate = string

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/**
 * Adds calendar months, clamping to the end of shorter months:
 * 31 Jan + 1 month = 28 Feb (or 29 in a leap year).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = toUtc(date)
  const targetMonth = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const result = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1))
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return fromUtc(result)
}

/** Today's date in New Zealand, whatever the device's time zone. */
export function todayInNZ(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

const displayFormat = new Intl.DateTimeFormat('en-NZ', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "Mon 9 Nov 2026" */
export function formatDate(date: IsoDate): string {
  return displayFormat.format(toUtc(date))
}
