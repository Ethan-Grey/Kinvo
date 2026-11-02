/**
 * Repayments and balances (M4). Balances are always calculated by the
 * database (CA-08); this module only reads them and calls its functions.
 */
import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import type { InstalmentStatus, PaymentMethod, RepaymentRow, RepaymentStatus } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface InstalmentProgress {
  sequence: number
  dueOn: IsoDate
  amountCents: Cents
  paidCents: Cents
  remainingCents: Cents
  paidOn: IsoDate | null
  status: InstalmentStatus
}

export interface Repayment {
  id: string
  amountCents: Cents
  receivedOn: IsoDate
  method: PaymentMethod
  reference: string | null
  notes: string | null
  status: RepaymentStatus
  submittedBy: string
  createdAt: string
  disputeReason: string | null
  reversalReason: string | null
  /** Photo of the receipt or statement (older payments may have none). */
  receiptPath: string | null
}

export interface LoanBalance {
  totalCents: Cents
  paidCents: Cents
  writtenOffCents: Cents
  outstandingCents: Cents
  nextDueOn: IsoDate | null
  nextDueCents: Cents | null
  overdueCents: Cents
  overdueCount: number
}

export interface NewRepayment {
  amountCents: Cents
  receivedOn: IsoDate
  method: PaymentMethod
  reference: string
  notes: string
  receiptPath: string
}

export async function getInstalmentProgress(loanId: string): Promise<InstalmentProgress[]> {
  const { data, error } = await supabase().rpc('get_instalment_progress', { p_loan_id: loanId })
  if (error) throw toAppError(error)
  return data.map((row) => ({
    sequence: row.sequence,
    dueOn: row.due_on,
    amountCents: toCents(row.amount_cents),
    paidCents: toCents(row.paid_cents),
    remainingCents: toCents(row.amount_cents - row.paid_cents),
    paidOn: row.paid_on,
    status: row.status,
  }))
}

/** Balances for every funded loan the user is part of, keyed by loan id. */
export async function listBalances(): Promise<Map<string, LoanBalance>> {
  const { data, error } = await supabase().rpc('list_loan_balances')
  if (error) throw toAppError(error)
  return new Map(
    data.map((row) => [
      row.loan_id,
      {
        totalCents: toCents(row.total_cents),
        paidCents: toCents(row.paid_cents),
        writtenOffCents: toCents(row.written_off_cents),
        outstandingCents: toCents(row.outstanding_cents),
        nextDueOn: row.next_due_on,
        nextDueCents: row.next_due_cents === null ? null : toCents(row.next_due_cents),
        overdueCents: toCents(row.overdue_cents),
        overdueCount: row.overdue_count,
      },
    ]),
  )
}

export async function getBalance(loanId: string): Promise<LoanBalance | null> {
  return (await listBalances()).get(loanId) ?? null
}

/** Every payment on a loan, newest first, including claims and reversals. */
export async function listRepayments(loanId: string): Promise<Repayment[]> {
  const { data, error } = await supabase()
    .from('repayments')
    .select('*')
    .eq('loan_id', loanId)
    .order('received_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return data.map(toRepayment)
}

/** From the lender: confirmed immediately. From the borrower: a claim to confirm. */
export async function recordRepayment(loanId: string, input: NewRepayment): Promise<void> {
  const { error } = await supabase().rpc('record_repayment', {
    p_loan_id: loanId,
    p_amount_cents: input.amountCents,
    p_received_on: input.receivedOn,
    p_method: input.method,
    p_reference: input.reference.trim() || null,
    p_notes: input.notes.trim() || null,
    p_receipt_path: input.receiptPath,
  })
  if (error) throw toAppError(error)
}

export async function confirmRepayment(repaymentId: string): Promise<void> {
  const { error } = await supabase().rpc('confirm_repayment', { p_repayment_id: repaymentId })
  if (error) throw toAppError(error)
}

export async function disputeRepayment(repaymentId: string, reason: string): Promise<void> {
  const { error } = await supabase().rpc('dispute_repayment', { p_repayment_id: repaymentId, p_reason: reason })
  if (error) throw toAppError(error)
}

export async function reverseRepayment(repaymentId: string, reason: string): Promise<void> {
  const { error } = await supabase().rpc('reverse_repayment', { p_repayment_id: repaymentId, p_reason: reason })
  if (error) throw toAppError(error)
}

/** Writes off what's left. Returns the amount forgiven. */
export async function forgiveRemaining(loanId: string, note: string): Promise<Cents> {
  const { data, error } = await supabase().rpc('forgive_remaining', { p_loan_id: loanId, p_note: note.trim() || null })
  if (error || data === null) throw toAppError(error)
  return toCents(data)
}

function toRepayment(row: RepaymentRow): Repayment {
  return {
    id: row.id,
    amountCents: toCents(row.amount_cents),
    receivedOn: row.received_on,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
    disputeReason: row.dispute_reason,
    reversalReason: row.reversal_reason,
    receiptPath: row.receipt_path,
  }
}
