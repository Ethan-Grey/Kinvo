/**
 * Reminders the lender controls for one borrower (ADR-0018): when the
 * automatic ones go out, which are sent, and custom messages.
 */
import type { IsoDate } from '../domain/dates'
import type { ReminderRepeat } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

/** One reminder: a day relative to the due date (-1 = day before, 0 = on the day, 2 = two days late) and an hour. */
export interface ReminderTime {
  daysFromDue: number
  /** Hour of the day in NZ time, 0–23. */
  sendHour: number
}

export interface ReminderSettings {
  times: ReminderTime[]
  /** Keep reminding every this many days while a payment is late, after the last reminder. Null = don't. */
  lateEveryDays: number | null
  lateHour: number
}

export const MAX_REMINDER_TIMES = 10

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  times: [
    { daysFromDue: -1, sendHour: 9 },
    { daysFromDue: 0, sendHour: 9 },
    { daysFromDue: 1, sendHour: 9 },
  ],
  lateEveryDays: 7,
  lateHour: 9,
}

export interface CustomReminder {
  id: string
  loanId: string | null
  message: string
  firstOn: IsoDate
  sendHour: number
  repeat: ReminderRepeat
  sentCount: number
  /** When the next one goes out (ISO timestamp); null once finished or cancelled. */
  nextAt: string | null
  cancelledAt: string | null
}

export interface NewCustomReminder {
  message: string
  firstOn: IsoDate
  sendHour: number
  repeat: ReminderRepeat
  loanId: string | null
}

export async function getReminderSettings(relationshipId: string): Promise<ReminderSettings> {
  const [settings, rules] = await Promise.all([
    supabase().from('reminder_settings').select('*').eq('relationship_id', relationshipId).maybeSingle(),
    supabase().from('reminder_rules').select('*').eq('relationship_id', relationshipId),
  ])
  if (settings.error) throw toAppError(settings.error)
  if (rules.error) throw toAppError(rules.error)
  if (!settings.data) return DEFAULT_REMINDER_SETTINGS
  return {
    times: sortTimes(rules.data.map((r) => ({ daysFromDue: r.days_from_due, sendHour: r.send_hour }))),
    lateEveryDays: settings.data.late_every_days,
    lateHour: settings.data.late_hour,
  }
}

export async function saveReminderSettings(relationshipId: string, settings: ReminderSettings): Promise<void> {
  const { error } = await supabase().rpc('save_reminder_settings', {
    p_relationship_id: relationshipId,
    p_rules: sortTimes(settings.times).map((t) => ({ days_from_due: t.daysFromDue, send_hour: t.sendHour })),
    p_late_every_days: settings.lateEveryDays,
    p_late_hour: settings.lateHour,
  })
  if (error) throw toAppError(error)
}

/** Earliest first: by day, then by hour. */
export function sortTimes(times: readonly ReminderTime[]): ReminderTime[] {
  return [...times].sort((a, b) => a.daysFromDue - b.daysFromDue || a.sendHour - b.sendHour)
}

/** "3 days before", "Day before", "On the day", "Day after", "2 days after". */
export function describeDay(daysFromDue: number): string {
  if (daysFromDue === 0) return 'On the day'
  if (daysFromDue === -1) return 'Day before'
  if (daysFromDue === 1) return 'Day after'
  return daysFromDue < 0 ? `${-daysFromDue} days before` : `${daysFromDue} days after`
}

/** Upcoming custom reminders for one borrower, soonest first. */
export async function listCustomReminders(relationshipId: string): Promise<CustomReminder[]> {
  const { data, error } = await supabase()
    .from('custom_reminders')
    .select('*')
    .eq('relationship_id', relationshipId)
    .not('next_at', 'is', null)
    .order('next_at', { ascending: true })
  if (error) throw toAppError(error)
  return data.map((row) => ({
    id: row.id,
    loanId: row.loan_id,
    message: row.message,
    firstOn: row.first_on,
    sendHour: row.send_hour,
    repeat: row.repeat,
    sentCount: row.sent_count,
    nextAt: row.next_at,
    cancelledAt: row.cancelled_at,
  }))
}

export async function createCustomReminder(relationshipId: string, input: NewCustomReminder): Promise<void> {
  const { error } = await supabase().rpc('create_custom_reminder', {
    p_relationship_id: relationshipId,
    p_message: input.message.trim(),
    p_first_on: input.firstOn,
    p_send_hour: input.sendHour,
    p_repeat: input.repeat,
    p_loan_id: input.loanId,
  })
  if (error) throw toAppError(error)
}

export async function cancelCustomReminder(id: string): Promise<void> {
  const { error } = await supabase().rpc('cancel_custom_reminder', { p_reminder_id: id })
  if (error) throw toAppError(error)
}

/** "9am", "12pm", "6pm". */
export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${suffix}`
}

export const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  never: 'Just once',
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every fortnight',
  monthly: 'Every month',
}
