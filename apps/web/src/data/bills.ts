/**
 * Splitting a bill you paid (ADR-0020). Each person gets their own debt for
 * their share; the receipt is copied into each one so only that pair sees it.
 */
import type { IsoDate } from '../domain/dates'
import type { Cents } from '../domain/money'
import { toAppError } from './errors'
import { uploadReceipt } from './images'
import { supabase } from './supabase'

export interface BillShare {
  relationshipId: string
  amountCents: Cents
}

export interface NewSplitBill {
  description: string
  totalCents: Cents
  paidOn: IsoDate
  dueOn: IsoDate
  shares: BillShare[]
  /** The cleaned receipt image, if one was added. */
  receipt: Blob | null
}

/** Creates the shares, then attaches the receipt to each. Returns the new debts' ids. */
export async function createSplitBill(input: NewSplitBill): Promise<string[]> {
  const { data, error } = await supabase().rpc('create_split_bill', {
    p_description: input.description.trim(),
    p_total_cents: input.totalCents,
    p_paid_on: input.paidOn,
    p_due_on: input.dueOn,
    p_shares: input.shares.map((s) => ({ relationship_id: s.relationshipId, amount_cents: s.amountCents })),
  })
  if (error) throw toAppError(error)
  const ids = data
  const receipt = input.receipt
  if (receipt) {
    await Promise.all(
      ids.map(async (loanId) => {
        const path = await uploadReceipt(loanId, receipt)
        const attached = await supabase().rpc('attach_bill_receipt', { p_loan_id: loanId, p_receipt_path: path })
        if (attached.error) throw toAppError(attached.error)
      }),
    )
  }
  return ids
}
