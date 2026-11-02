/**
 * In-app notifications (M6). The database writes them (from audit events and
 * the daily reminder job); the app only reads them and marks them read.
 */
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string
  linkPath: string
  createdAt: string
  readAt: string | null
}

/** Newest first. Older ones stay in the database; 50 is plenty for a family app. */
export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase()
    .from('notifications')
    .select('id, kind, title, body, link_path, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toAppError(error)
  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    linkPath: row.link_path,
    createdAt: row.created_at,
    readAt: row.read_at,
  }))
}

export async function countUnread(): Promise<number> {
  const { count, error } = await supabase()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw toAppError(error)
  return count ?? 0
}

/** Marks the given notifications read, or all of them when no ids are given. */
export async function markRead(ids?: string[]): Promise<void> {
  const { error } = await supabase().rpc('mark_notifications_read', {
    p_ids: ids ?? null,
  })
  if (error) throw toAppError(error)
}

/** Deletes the given alerts, or all of them. The loan records themselves are untouched. */
export async function clearNotifications(ids?: string[]): Promise<void> {
  const { error } = await supabase().rpc('clear_notifications', { p_ids: ids ?? null })
  if (error) throw toAppError(error)
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date like "4 Nov". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Pacific/Auckland',
  })
}
