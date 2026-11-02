/**
 * Reminders the lender controls for one borrower (ADR-0018): when the
 * automatic ones go out, which are sent, and custom messages.
 */
import type { IsoDate } from '../domain/dates'
import type { ReminderRepeat } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface ReminderSettings {
  /** Hour of the day in NZ time, 0–23. */
  sendHour: number
  dayBefore: boolean
  onTheDay: boolean
  whenOverdue: boolean
  overdueEveryDays: number
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  sendHour: 9,
  dayBefore: true,
  onTheDay: true,
  whenOverdue: true,
  overdueEveryDays: 7,
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
  const { data, error } = await supabase()
    .from('reminder_settings')
    .select('*')
    .eq('relationship_id', relationshipId)
    .maybeSingle()
  if (error) throw toAppError(error)
  if (!data) return DEFAULT_REMINDER_SETTINGS
  return {
    sendHour: data.send_hour,
    dayBefore: data.day_before,
    onTheDay: data.on_the_day,
    whenOverdue: data.when_overdue,
    overdueEveryDays: data.overdue_every_days,
  }
}

export async function saveReminderSettings(relationshipId: string, settings: ReminderSettings): Promise<void> {
  const { error } = await supabase().rpc('save_reminder_settings', {
    p_relationship_id: relationshipId,
    p_send_hour: settings.sendHour,
    p_day_before: settings.dayBefore,
    p_on_the_day: settings.onTheDay,
    p_when_overdue: settings.whenOverdue,
    p_overdue_every_days: settings.overdueEveryDays,
  })
  if (error) throw toAppError(error)
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
