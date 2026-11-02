import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import type { Instalment } from '../domain/schedule'
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
  /** A debt the lender says already exists, which the borrower will confirm after joining. */
  existingDebt: { amountCents: Cents; lentOn: IsoDate; reason: string | null } | null
}

/** A debt from before Kinvo, attached to an invite (ADR-0012). */
export interface ExistingDebtInput {
  amountCents: Cents
  lentOn: IsoDate
  reason: string
  instalments: readonly Instalment[]
  lateTerms: string
  conditions: string
}

export interface AcceptedInvite {
  relationshipId: string
  /** Set when the invite carried an existing debt for the borrower to confirm. */
  existingDebtLoanId: string | null
}

/** Builds the link a lender shares. The token is only available at creation time. */
export function inviteUrl(token: string): string {
  return new URL(`/invite/${token}`, window.location.origin).toString()
}

export async function createInvite(note: string, existingDebt?: ExistingDebtInput): Promise<CreatedInvite> {
  const { data, error } = await supabase().rpc('create_invite', {
    p_note: note || null,
    p_existing_debt: existingDebt
      ? {
          amount_cents: existingDebt.amountCents,
          lent_on: existingDebt.lentOn,
          reason: existingDebt.reason.trim() || null,
          instalments: existingDebt.instalments.map((i) => ({ due_on: i.dueOn, amount_cents: i.amountCents })),
          late_terms: existingDebt.lateTerms.trim(),
          conditions: existingDebt.conditions.trim(),
        }
      : null,
  })
  const row = data?.[0]
  if (error || !row) throw toAppError(error)
  return { id: row.invite_id, url: inviteUrl(row.token), expiresAt: row.expires_at }
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase().rpc('preview_invite', { p_token: token })
  const row = data?.[0]
  if (error || !row) throw toAppError(error)
  return {
    status: row.status,
    lenderName: row.lender_name,
    existingDebt:
      row.debt_amount_cents !== null && row.debt_lent_on !== null
        ? { amountCents: toCents(row.debt_amount_cents), lentOn: row.debt_lent_on, reason: row.debt_reason }
        : null,
  }
}

/** Accepts an invite, and finds the existing debt it created, if any. */
export async function acceptInvite(token: string): Promise<AcceptedInvite> {
  const { data: relationshipId, error } = await supabase().rpc('accept_invite', { p_token: token })
  if (error || !relationshipId) throw toAppError(error)

  const { data: debt, error: debtError } = await supabase()
    .from('loans')
    .select('id')
    .eq('relationship_id', relationshipId)
    .eq('kind', 'existing_debt')
    .eq('status', 'negotiating')
    .order('created_at', { ascending: false })
    .limit(1)
  if (debtError) throw toAppError(debtError)
  return { relationshipId, existingDebtLoanId: debt[0]?.id ?? null }
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
