/**
 * My money (ADR-0024): your own bills, pay and balance, plus what's already
 * in Kinvo that you'll pay before pay day. Private to you.
 */
import type { IsoDate } from '../domain/dates'
import { todayInNZ } from '../domain/dates'
import { buildPlan, datesBetween, type Commitment, type Frequency, type Plan } from '../domain/moneyPlan'
import { toCents, type Cents } from '../domain/money'
import { listUpcomingInstalments } from './dashboard'
import type { PersonalBillCategory, RepeatFrequency } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface PersonalBill {
  id: string
  name: string
  category: PersonalBillCategory
  amountType: 'fixed' | 'varies'
  amountCents: Cents
  frequency: Frequency
  firstDueOn: IsoDate
}

export interface MyMoney {
  pay: { amountCents: number; frequency: RepeatFrequency; nextPayOn: IsoDate } | null
  balance: { cents: number; on: IsoDate } | null
  bills: PersonalBill[]
  topups: {
    householdName: string
    amountCents: number
    frequency: RepeatFrequency
    firstOn: IsoDate
    nextOn: IsoDate
  }[]
  loanPayments: { otherPersonName: string; dueOn: IsoDate; remainingCents: number; loanId: string }[]
  householdShares: { billName: string; dueOn: IsoDate; amountCents: number }[]
}

export const PERSONAL_CATEGORY_LABELS: Record<PersonalBillCategory, string> = {
  rent: 'Rent',
  power: 'Power',
  internet: 'Internet',
  water: 'Water',
  phone: 'Phone',
  insurance: 'Insurance',
  subscriptions: 'Subscriptions',
  car: 'Car',
  health: 'Health',
  savings: 'Savings',
  bills: 'Bills',
  other: 'Other',
}

export const PERSONAL_FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Every week',
  fortnightly: 'Every fortnight',
  monthly: 'Every month',
  yearly: 'Every year',
}

export async function getMyMoney(userId: string): Promise<MyMoney> {
  const [settings, bills, topups, shares, upcoming] = await Promise.all([
    supabase().from('my_money').select('*').eq('user_id', userId).maybeSingle(),
    supabase().from('personal_bills').select('*').eq('user_id', userId).eq('active', true).order('first_due_on'),
    supabase()
      .from('household_topups')
      .select('amount_cents, frequency, first_on, next_on, household:households ( name )')
      .eq('member_id', userId)
      .eq('active', true),
    supabase()
      .from('household_bill_shares')
      .select(
        'amount_cents, paid_at, occurrence:household_bill_occurrences ( due_on, status, bill:household_bills ( name ) )',
      )
      .eq('user_id', userId)
      .is('paid_at', null),
    listUpcomingInstalments(50),
  ])
  for (const r of [settings, bills, topups, shares]) if (r.error) throw toAppError(r.error)
  const s = settings.data
  return {
    pay:
      s?.pay_amount_cents && s.pay_frequency && s.next_pay_on
        ? { amountCents: s.pay_amount_cents, frequency: s.pay_frequency, nextPayOn: s.next_pay_on }
        : null,
    balance:
      s?.balance_cents !== null && s?.balance_cents !== undefined && s.balance_on
        ? { cents: s.balance_cents, on: s.balance_on }
        : null,
    bills: (bills.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      amountType: b.amount_type,
      amountCents: toCents(b.amount_cents),
      frequency: b.frequency,
      firstDueOn: b.first_due_on,
    })),
    topups: (
      (topups.data ?? []) as unknown as {
        amount_cents: number
        frequency: RepeatFrequency
        first_on: string
        next_on: string | null
        household: { name: string } | null
      }[]
    )
      .filter((t) => t.next_on)
      .map((t) => ({
        householdName: t.household?.name ?? 'Household',
        amountCents: t.amount_cents,
        frequency: t.frequency,
        firstOn: t.first_on,
        nextOn: t.next_on as string,
      })),
    loanPayments: upcoming
      .filter((u) => u.role === 'borrower')
      .map((u) => ({
        otherPersonName: u.otherPersonName,
        dueOn: u.dueOn,
        remainingCents: u.remainingCents,
        loanId: u.loanId,
      })),
    householdShares: (
      (shares.data ?? []) as unknown as {
        amount_cents: number
        occurrence: { due_on: string; status: string; bill: { name: string } | null } | null
      }[]
    )
      .filter((x) => x.occurrence && x.occurrence.status !== 'skipped')
      .map((x) => ({
        billName: x.occurrence?.bill?.name ?? 'Household bill',
        dueOn: x.occurrence?.due_on as string,
        amountCents: x.amount_cents,
      })),
  }
}

/** Everything you'll pay in (after, before], from your bills and the rest of Kinvo. */
export function commitmentsFrom(m: MyMoney) {
  return (today: IsoDate, after: IsoDate, before: IsoDate): Commitment[] => [
    ...m.bills.flatMap((b) =>
      datesBetween(b.firstDueOn, b.frequency, after, before).map((dueOn) => ({
        label: b.amountType === 'varies' ? `${b.name} (about)` : b.name,
        dueOn,
        cents: b.amountCents,
        kind: 'bill' as const,
      })),
    ),
    ...m.topups.flatMap((t) =>
      datesBetween(t.firstOn, t.frequency, after, before).map((dueOn) => ({
        label: `Top-up: ${t.householdName}`,
        dueOn,
        cents: t.amountCents,
        kind: 'topup' as const,
      })),
    ),
    // Loan payments and household shares still unpaid; overdue ones always count.
    ...m.loanPayments.map((l) => ({
      label: `Pay back ${l.otherPersonName}`,
      dueOn: l.dueOn,
      cents: l.remainingCents,
      kind: 'loan' as const,
      overdue: l.dueOn <= today,
    })),
    ...m.householdShares.map((s) => ({
      label: `Your share: ${s.billName}`,
      dueOn: s.dueOn,
      cents: s.amountCents,
      kind: 'share' as const,
      overdue: s.dueOn <= today,
    })),
  ]
}

export async function savePersonalBill(
  id: string | null,
  input: Omit<PersonalBill, 'id' | 'amountCents'> & { amountCents: number },
): Promise<void> {
  const { error } = await supabase().rpc('save_personal_bill', {
    p_id: id,
    p_name: input.name.trim(),
    p_category: input.category,
    p_amount_type: input.amountType,
    p_amount_cents: input.amountCents,
    p_frequency: input.frequency,
    p_first_due_on: input.firstDueOn,
  })
  if (error) throw toAppError(error)
}

export async function stopPersonalBill(id: string): Promise<void> {
  const { error } = await supabase().rpc('stop_personal_bill', { p_id: id })
  if (error) throw toAppError(error)
}

export async function savePay(amountCents: number, frequency: RepeatFrequency, nextPayOn: IsoDate): Promise<void> {
  const { error } = await supabase().rpc('save_pay', {
    p_amount_cents: amountCents,
    p_frequency: frequency,
    p_next_pay_on: nextPayOn,
  })
  if (error) throw toAppError(error)
}

export async function setMyBalance(cents: number): Promise<void> {
  const { error } = await supabase().rpc('set_my_balance', { p_balance_cents: cents })
  if (error) throw toAppError(error)
}

/** The plan for today from what's saved, or null until pay is set up. */
export function planFor(m: MyMoney): Plan | null {
  return buildPlan({ today: todayInNZ(), pay: m.pay, balance: m.balance, commitments: commitmentsFrom(m) })
}
