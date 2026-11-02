/**
 * Account settings (M7): your name, the email switch, and "Download my data".
 * All changes go through database functions, which check and log them.
 */
import { toAppError } from './errors'
import { supabase } from './supabase'

export async function setDisplayName(name: string): Promise<void> {
  const { error } = await supabase().rpc('set_display_name', { p_display_name: name })
  if (error) throw toAppError(error)
}

export async function setEmailNotifications(enabled: boolean): Promise<void> {
  const { error } = await supabase().rpc('set_email_notifications', { p_enabled: enabled })
  if (error) throw toAppError(error)
}

/** Everything Kinvo holds that involves you, as readable JSON text. */
export async function exportMyData(): Promise<string> {
  const { data, error } = await supabase().rpc('export_my_data')
  if (error) throw toAppError(error)
  return JSON.stringify(data, null, 2)
}

/** e.g. kinvo-data-2026-11-02.json, dated in NZ time. */
export function exportFileName(now: Date = new Date()): string {
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  return `kinvo-data-${date}.json`
}
