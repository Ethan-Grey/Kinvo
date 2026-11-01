/**
 * Home-screen figures and borrower track records (M5). All numbers are
 * calculated by the database from the same payment replay as loan pages.
 */
import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface DashboardSummary {
  lending: {
    owedCents: Cents
    overdueCents: Cents
    overdueCount: number
    totalLentCents: Cents
    activeCount: number
    chargesReceivedCents: Cents
    taxYearStart: IsoDate
  }
  borrowing: {
    owedCents: Cents
    overdueCents: Cents
    overdueCount: number
    nextDueOn: IsoDate | null
    nextDueCents: Cents | null
    activeCount: number
  }
  actions: {
    repliesNeeded: number
    fundsToSend: number
    claimsToConfirm: number
    claimsDisputed: number
  }
}

export interface UpcomingInstalment {
  loanId: string
  role: 'lender' | 'borrower'
  otherPersonName: string
  sequence: number
  dueOn: IsoDate
  remainingCents: Cents
  status: 'due' | 'overdue'
}

export interface BorrowerRecord {
  relationshipId: string
  borrowerId: string
  borrowerName: string
  connectedSince: string
  endedAt: string | null
  loansFunded: number
  loansOpen: number
  totalBorrowedCents: Cents
  totalRepaidCents: Cents
  owedCents: Cents
  overdueCents: Cents
  instalmentsAssessed: number
  instalmentsOnTime: number
  instalmentsLate: number
  averageDaysLate: number | null
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data, error } = await supabase().rpc('get_dashboard_summary')
  const row = data?.[0]
  if (error || !row) throw toAppError(error)
  return {
    lending: {
      owedCents: toCents(row.lending_owed_cents),
      overdueCents: toCents(row.lending_overdue_cents),
      overdueCount: row.lending_overdue_count,
      totalLentCents: toCents(row.lending_total_lent_cents),
      activeCount: row.lending_active_count,
      chargesReceivedCents: toCents(row.charges_received_cents),
      taxYearStart: row.tax_year_start,
    },
    borrowing: {
      owedCents: toCents(row.borrowing_owed_cents),
      overdueCents: toCents(row.borrowing_overdue_cents),
      overdueCount: row.borrowing_overdue_count,
      nextDueOn: row.borrowing_next_due_on,
      nextDueCents: row.borrowing_next_due_cents === null ? null : toCents(row.borrowing_next_due_cents),
      activeCount: row.borrowing_active_count,
    },
    actions: {
      repliesNeeded: row.replies_needed,
      fundsToSend: row.funds_to_send,
      claimsToConfirm: row.claims_to_confirm,
      claimsDisputed: row.claims_disputed,
    },
  }
}

export async function listUpcomingInstalments(limit = 10): Promise<UpcomingInstalment[]> {
  const { data, error } = await supabase().rpc('list_upcoming_instalments', { p_limit: limit })
  if (error) throw toAppError(error)
  return data.map((row) => ({
    loanId: row.loan_id,
    role: row.role,
    otherPersonName: row.other_person_name,
    sequence: row.sequence,
    dueOn: row.due_on,
    remainingCents: toCents(row.remaining_cents),
    status: row.status,
  }))
}

/** Lender only: one record per borrower. Borrowers get an empty list. */
export async function listBorrowerRecords(): Promise<BorrowerRecord[]> {
  const { data, error } = await supabase().rpc('list_borrower_records')
  if (error) throw toAppError(error)
  return data.map((row) => ({
    relationshipId: row.relationship_id,
    borrowerId: row.borrower_id,
    borrowerName: row.borrower_name,
    connectedSince: row.connected_since,
    endedAt: row.ended_at,
    loansFunded: row.loans_funded,
    loansOpen: row.loans_open,
    totalBorrowedCents: toCents(row.total_borrowed_cents),
    totalRepaidCents: toCents(row.total_repaid_cents),
    owedCents: toCents(row.owed_cents),
    overdueCents: toCents(row.overdue_cents),
    instalmentsAssessed: row.instalments_assessed,
    instalmentsOnTime: row.instalments_on_time,
    instalmentsLate: row.instalments_late,
    averageDaysLate: row.average_days_late === null ? null : Number(row.average_days_late),
  }))
}

/**
 * A track record as a plain sentence (numbers only, no labels):
 * "8 of 10 payments on time · 2 days late on average".
 */
export function describeTrackRecord(record: Pick<
  BorrowerRecord,
  'instalmentsAssessed' | 'instalmentsOnTime' | 'averageDaysLate'
>): string {
  if (record.instalmentsAssessed === 0) return 'No payments due yet'
  const onTime = `${record.instalmentsOnTime} of ${record.instalmentsAssessed} payment${record.instalmentsAssessed === 1 ? '' : 's'} on time`
  if (record.averageDaysLate === null) return onTime
  const days = record.averageDaysLate
  return `${onTime} · late ones ${days} day${days === 1 ? '' : 's'} late on average`
}
