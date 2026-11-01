import type { InviteStatus, LenderInvite } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface CreatedInvite {
  id: string
  url: string
  expiresAt: string
}

export interface InvitePreview {
  status: InviteStatus
  lenderName: string | null
}

/** Builds the link a lender shares. The token is only available at creation time. */
export function inviteUrl(token: string): string {
  return new URL(`/invite/${token}`, window.location.origin).toString()
}

export async function createInvite(note: string): Promise<CreatedInvite> {
  const { data, error } = await supabase().rpc('create_invite', { p_note: note || null })
  const row = data?.[0]
  if (error || !row) throw toAppError(error)
  return { id: row.invite_id, url: inviteUrl(row.token), expiresAt: row.expires_at }
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase().rpc('preview_invite', { p_token: token })
  const row = data?.[0]
  if (error || !row) throw toAppError(error)
  return { status: row.status, lenderName: row.lender_name }
}

/** Accepts an invite. Returns the new relationship's id. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase().rpc('accept_invite', { p_token: token })
  if (error || !data) throw toAppError(error)
  return data
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase().rpc('revoke_invite', { p_invite_id: inviteId })
  if (error) throw toAppError(error)
}

/** Invites the current lender has created that are still usable. */
export async function listOpenInvites(): Promise<LenderInvite[]> {
  const { data, error } = await supabase()
    .from('lender_invites')
    .select('*')
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return data
}
