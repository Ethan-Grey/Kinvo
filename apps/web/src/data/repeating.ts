/**
 * Repeating debts, e.g. a share of the rent (ADR-0020). Agreed once; each one
 * is then created automatically as its own debt on its date.
 */
import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import type { RepeatFrequency, RepeatingStatus } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface RepeatingDebt {
  id: string
  relationshipId: string
  role: 'lender' | 'borrower'
  otherPersonName: string
  otherPersonPhoto: string | null
  description: string
  amountCents: Cents
  frequency: RepeatFrequency
  firstOn: IsoDate
  endOn: IsoDate | null
  status: RepeatingStatus
  nextOn: IsoDate | null
}

export interface NewRepeatingDebt {
  relationshipId: string
  description: string
  amountCents: Cents
  frequency: RepeatFrequency
  firstOn: IsoDate
  endOn: IsoDate | null
}

export const FREQUENCY_LABELS: Record<RepeatFrequency, string> = {
  weekly: 'Every week',
  fortnightly: 'Every fortnight',
  monthly: 'Every month',
}

export const REPEATING_STATUS_LABELS: Record<RepeatingStatus, string> = {
  proposed: 'Waiting to be accepted',
  active: 'Active',
  paused: 'Paused',
  stopped: 'Stopped',
  declined: 'Declined',
}

const SELECT = `*, relationship:lending_relationships!inner ( lender_id, borrower_id,
  lender:profiles!lending_relationships_lender_id_fkey ( display_name, avatar_path ),
  borrower:profiles!lending_relationships_borrower_id_fkey ( display_name, avatar_path ) )`

interface Row {
  id: string
  relationship_id: string
  description: string
  amount_cents: number
  frequency: RepeatFrequency
  first_on: string
  end_on: string | null
  status: RepeatingStatus
  next_on: string | null
  relationship: {
    lender_id: string
    borrower_id: string
    lender: { display_name: string; avatar_path: string | null }
    borrower: { display_name: string; avatar_path: string | null }
  }
}

function toRepeating(row: Row, userId: string): RepeatingDebt {
  const role = row.relationship.lender_id === userId ? 'lender' : 'borrower'
  const other = role === 'lender' ? row.relationship.borrower : row.relationship.lender
  return {
    id: row.id,
    relationshipId: row.relationship_id,
    role,
    otherPersonName: other.display_name,
    otherPersonPhoto: other.avatar_path,
    description: row.description,
    amountCents: toCents(row.amount_cents),
    frequency: row.frequency,
    firstOn: row.first_on,
    endOn: row.end_on,
    status: row.status,
    nextOn: row.next_on,
  }
}

/** Every repeating debt you're part of, newest first. */
export async function listRepeating(userId: string): Promise<RepeatingDebt[]> {
  const { data, error } = await supabase()
    .from('repeating_debts')
    .select(SELECT)
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return (data as unknown as Row[]).map((row) => toRepeating(row, userId))
}

export async function getRepeating(id: string, userId: string): Promise<RepeatingDebt> {
  const { data, error } = await supabase().from('repeating_debts').select(SELECT).eq('id', id).single()
  if (error) throw toAppError({ ...error, message: error.code === 'PGRST116' ? 'repeating_not_found' : error.message })
  return toRepeating(data as unknown as Row, userId)
}

export async function proposeRepeating(input: NewRepeatingDebt): Promise<string> {
  const { data, error } = await supabase().rpc('propose_repeating_debt', {
    p_relationship_id: input.relationshipId,
    p_description: input.description.trim(),
    p_amount_cents: input.amountCents,
    p_frequency: input.frequency,
    p_first_on: input.firstOn,
    p_end_on: input.endOn,
  })
  if (error) throw toAppError(error)
  return data
}

export async function respondRepeating(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase().rpc('respond_repeating_debt', { p_id: id, p_accept: accept })
  if (error) throw toAppError(error)
}

export async function changeRepeatingAmount(id: string, amountCents: Cents): Promise<void> {
  const { error } = await supabase().rpc('change_repeating_amount', { p_id: id, p_amount_cents: amountCents })
  if (error) throw toAppError(error)
}

export async function setRepeatingStatus(id: string, status: 'active' | 'paused' | 'stopped'): Promise<void> {
  const { error } = await supabase().rpc('set_repeating_status', { p_id: id, p_status: status })
  if (error) throw toAppError(error)
}

/** "$150.00 every week" */
export function describeRepeat(debt: Pick<RepeatingDebt, 'frequency'>): string {
  return FREQUENCY_LABELS[debt.frequency].toLowerCase()
}
