/**
 * Loans: reading them, and every action in the negotiation (M3).
 *
 * Rows from the database are converted into the shapes the screens use here,
 * so components never deal with snake_case columns or raw cents as numbers.
 */
import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import type { Instalment } from '../domain/schedule'
import type {
  InstalmentRow,
  LoanKind,
  LoanStatus,
  LoanTermsRow,
  PaymentMethod,
  TermAcceptanceRow,
} from './database.types'
import { toAppError } from './errors'
import { listBalances, type LoanBalance } from './repayments'
import { supabase } from './supabase'

export type Role = 'lender' | 'borrower'

export interface TermsVersion {
  id: string
  version: number
  proposedBy: string
  principalCents: Cents
  chargeCents: Cents
  totalCents: Cents
  lateTerms: string
  conditions: string
  message: string | null
  termsHash: string
  createdAt: string
  instalments: Instalment[]
  acceptances: { userId: string; acceptedAt: string }[]
}

export interface LoanDetail {
  id: string
  relationshipId: string
  status: LoanStatus
  kind: LoanKind
  /** For an existing debt: when the money was originally lent, before Kinvo. */
  originallyLentOn: IsoDate | null
  role: Role
  lenderId: string
  borrowerId: string
  lenderName: string
  borrowerName: string
  reason: string | null
  createdAt: string
  agreedAt: string | null
  fundsSentAt: string | null
  fundsSentOn: IsoDate | null
  fundsMethod: PaymentMethod | null
  fundsReference: string | null
  /** The latest proposal. */
  currentTerms: TermsVersion
  /** Every proposal, newest first. */
  history: TermsVersion[]
}

export interface LoanSummary {
  id: string
  relationshipId: string
  status: LoanStatus
  kind: LoanKind
  role: Role
  otherPersonName: string
  principalCents: Cents
  totalCents: Cents
  firstDueOn: IsoDate | null
  /** Repayment figures, once the loan has been funded. */
  balance: LoanBalance | null
  /** True when the next step is the current user's. */
  awaitingMe: boolean
  createdAt: string
}

/** What a proposal contains, as entered in the terms form. */
export interface TermsInput {
  principalCents: Cents
  chargeCents: Cents
  instalments: readonly Instalment[]
  lateTerms: string
  conditions: string
  message: string
}

const LOAN_WITH_NAMES = `*,
  lender:profiles!loans_lender_id_fkey ( display_name ),
  borrower:profiles!loans_borrower_id_fkey ( display_name )` as const

/** Whether the next step is this user's: answering a proposal, or sending the money. */
export function isAwaitingUser(status: LoanStatus, role: Role, currentProposerId: string | null, userId: string) {
  if (status === 'negotiating') return currentProposerId !== null && currentProposerId !== userId
  if (status === 'agreed') return role === 'lender'
  return false
}

export async function listLoans(userId: string): Promise<LoanSummary[]> {
  const { data: loans, error } = await supabase()
    .from('loans')
    .select(LOAN_WITH_NAMES)
    .neq('status', 'removed')
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)

  const termsIds = loans.map((l) => l.current_terms_id).filter((id): id is string => id !== null)
  const [terms, instalments, balances] = await Promise.all([
    fetchTerms(termsIds),
    fetchInstalments(termsIds),
    listBalances(),
  ])

  return loans.map((loan) => {
    const current = terms.find((t) => t.id === loan.current_terms_id)
    const firstDue = instalments.filter((i) => i.terms_id === loan.current_terms_id).sort(bySequence)[0]
    const role: Role = loan.lender_id === userId ? 'lender' : 'borrower'
    const principal = current?.principal_cents ?? 0
    return {
      id: loan.id,
      relationshipId: loan.relationship_id,
      status: loan.status,
      kind: loan.kind,
      role,
      otherPersonName: role === 'lender' ? loan.borrower.display_name : loan.lender.display_name,
      principalCents: toCents(principal),
      totalCents: toCents(principal + (current?.charge_cents ?? 0)),
      firstDueOn: firstDue?.due_on ?? null,
      balance: balances.get(loan.id) ?? null,
      awaitingMe: isAwaitingUser(loan.status, role, current?.proposed_by ?? null, userId),
      createdAt: loan.created_at,
    }
  })
}

export async function getLoan(loanId: string, userId: string): Promise<LoanDetail> {
  const { data: loan, error } = await supabase().from('loans').select(LOAN_WITH_NAMES).eq('id', loanId).single()
  if (error) throw toAppError({ ...error, message: error.code === 'PGRST116' ? 'loan_not_found' : error.message })
  if (loan.status === 'removed') throw toAppError({ message: 'loan_removed' })

  const { data: termsRows, error: termsError } = await supabase()
    .from('loan_terms')
    .select('*')
    .eq('loan_id', loanId)
    .order('version', { ascending: false })
  if (termsError) throw toAppError(termsError)

  const ids = termsRows.map((t) => t.id)
  const [instalments, acceptances] = await Promise.all([fetchInstalments(ids), fetchAcceptances(ids)])
  const history = termsRows.map((row) => toTermsVersion(row, instalments, acceptances))
  const currentTerms = history.find((t) => t.id === loan.current_terms_id) ?? history[0]
  if (!currentTerms) throw toAppError({ message: 'loan_not_found' })

  return {
    id: loan.id,
    relationshipId: loan.relationship_id,
    status: loan.status,
    kind: loan.kind,
    originallyLentOn: loan.originally_lent_on,
    role: loan.lender_id === userId ? 'lender' : 'borrower',
    lenderId: loan.lender_id,
    borrowerId: loan.borrower_id,
    lenderName: loan.lender.display_name,
    borrowerName: loan.borrower.display_name,
    reason: loan.reason,
    createdAt: loan.created_at,
    agreedAt: loan.agreed_at,
    fundsSentAt: loan.funds_sent_at,
    fundsSentOn: loan.funds_sent_on,
    fundsMethod: loan.funds_method,
    fundsReference: loan.funds_reference,
    currentTerms,
    history,
  }
}

function termsArgs(input: TermsInput) {
  return {
    p_principal_cents: input.principalCents,
    p_charge_cents: input.chargeCents,
    p_instalments: input.instalments.map((i) => ({ due_on: i.dueOn, amount_cents: i.amountCents })),
    p_late_terms: input.lateTerms.trim(),
    p_conditions: input.conditions.trim(),
    p_message: input.message.trim() || null,
  }
}

/** A borrower's request or a lender's offer. Returns the new loan's id. */
export async function createLoan(relationshipId: string, reason: string, input: TermsInput): Promise<string> {
  const { data, error } = await supabase().rpc('create_loan', {
    p_relationship_id: relationshipId,
    p_reason: reason.trim() || null,
    ...termsArgs(input),
  })
  if (error || !data) throw toAppError(error)
  return data
}

export async function counterOffer(loanId: string, expectedTermsId: string, input: TermsInput): Promise<void> {
  const { error } = await supabase().rpc('counter_offer', {
    p_loan_id: loanId,
    p_expected_terms_id: expectedTermsId,
    ...termsArgs(input),
  })
  if (error) throw toAppError(error)
}

/** Accepts the exact version the user was shown, identified by its fingerprint. */
export async function acceptTerms(loanId: string, terms: Pick<TermsVersion, 'id' | 'termsHash'>): Promise<void> {
  const { error } = await supabase().rpc('accept_terms', {
    p_loan_id: loanId,
    p_terms_id: terms.id,
    p_terms_hash: terms.termsHash,
  })
  if (error) throw toAppError(error)
}

export async function rejectTerms(loanId: string, note: string): Promise<void> {
  const { error } = await supabase().rpc('reject_terms', { p_loan_id: loanId, p_note: note.trim() || null })
  if (error) throw toAppError(error)
}

export async function withdrawLoan(loanId: string, note: string): Promise<void> {
  const { error } = await supabase().rpc('withdraw_loan', { p_loan_id: loanId, p_note: note.trim() || null })
  if (error) throw toAppError(error)
}

export async function confirmFundsSent(
  loanId: string,
  sentOn: IsoDate,
  method: PaymentMethod,
  reference: string,
): Promise<void> {
  const { error } = await supabase().rpc('confirm_funds_sent', {
    p_loan_id: loanId,
    p_sent_on: sentOn,
    p_method: method,
    p_reference: reference.trim() || null,
  })
  if (error) throw toAppError(error)
}

// -----------------------------------------------------------------------------

async function fetchTerms(ids: string[]): Promise<LoanTermsRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase().from('loan_terms').select('*').in('id', ids)
  if (error) throw toAppError(error)
  return data
}

async function fetchInstalments(termsIds: string[]): Promise<InstalmentRow[]> {
  if (termsIds.length === 0) return []
  const { data, error } = await supabase().from('instalments').select('*').in('terms_id', termsIds)
  if (error) throw toAppError(error)
  return data
}

async function fetchAcceptances(termsIds: string[]): Promise<TermAcceptanceRow[]> {
  if (termsIds.length === 0) return []
  const { data, error } = await supabase().from('term_acceptances').select('*').in('terms_id', termsIds)
  if (error) throw toAppError(error)
  return data
}

function bySequence(a: InstalmentRow, b: InstalmentRow) {
  return a.sequence - b.sequence
}

function toTermsVersion(
  row: LoanTermsRow,
  instalments: InstalmentRow[],
  acceptances: TermAcceptanceRow[],
): TermsVersion {
  return {
    id: row.id,
    version: row.version,
    proposedBy: row.proposed_by,
    principalCents: toCents(row.principal_cents),
    chargeCents: toCents(row.charge_cents),
    totalCents: toCents(row.principal_cents + row.charge_cents),
    lateTerms: row.late_terms,
    conditions: row.conditions,
    message: row.message,
    termsHash: row.terms_hash ?? '',
    createdAt: row.created_at,
    instalments: instalments
      .filter((i) => i.terms_id === row.id)
      .sort(bySequence)
      .map((i) => ({ dueOn: i.due_on, amountCents: toCents(i.amount_cents) })),
    acceptances: acceptances
      .filter((a) => a.terms_id === row.id)
      .map((a) => ({ userId: a.accepted_by, acceptedAt: a.accepted_at })),
  }
}

/**
 * Lender only: hide a loan that shouldn't be there (a test or a mistake).
 * It drops out of every list and total; the audit log keeps a note (ADR-0015).
 */
export async function removeLoan(loanId: string, reason: string): Promise<void> {
  const { error } = await supabase().rpc('remove_loan', { p_loan_id: loanId, p_reason: reason.trim() || null })
  if (error) throw toAppError(error)
}

/**
 * The charge a borrower's proposal must carry: the lender's latest rate
 * applied to the new amount (0 if the lender hasn't proposed a charge).
 * Mirrors private.required_borrower_charge in the database.
 */
export function borrowerCharge(loan: Pick<LoanDetail, 'history' | 'lenderId'> | null, principalCents: number): Cents {
  const lenderTerms = loan?.history
    .filter((t) => t.proposedBy === loan.lenderId)
    .sort((a, b) => b.version - a.version)[0]
  if (!lenderTerms || lenderTerms.principalCents === 0) return toCents(0)
  return toCents(Math.round((principalCents * lenderTerms.chargeCents) / lenderTerms.principalCents))
}
