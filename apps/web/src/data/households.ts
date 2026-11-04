/**
 * Households (ADR-0022): reading everything for one household, and every
 * action. Totals are added up in domain/household.ts.
 */
import type { IsoDate } from '../domain/dates'
import { toCents, type Cents } from '../domain/money'
import type { BillCategory, BillMethod, Json, RepeatFrequency } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface HouseholdMember {
  userId: string
  name: string
  photo: string | null
  role: 'owner' | 'member'
  shareBp: number | null
}

export interface Household {
  id: string
  name: string
  hasSharedAccount: boolean
  sharedAccountName: string | null
  members: HouseholdMember[]
}

export interface Topup {
  id: string
  memberId: string
  amountCents: Cents
  frequency: RepeatFrequency
  nextOn: IsoDate | null
}

export interface Bill {
  id: string
  name: string
  category: BillCategory
  amountType: 'fixed' | 'varies'
  amountCents: Cents | null
  frequency: RepeatFrequency
  nextDueOn: IsoDate | null
  method: BillMethod
  payerId: string | null
  split: { userId: string; shareBp: number }[] | null
}

export interface BillOccurrence {
  id: string
  billId: string
  dueOn: IsoDate
  method: BillMethod
  payerId: string | null
  amountCents: Cents | null
  status: 'needs_amount' | 'open' | 'done' | 'skipped'
  receiptPath: string | null
  shares: { userId: string; amountCents: Cents; paid: boolean }[]
}

export interface SharedEntryRow {
  id: string
  kind: 'opening' | 'topup' | 'bill' | 'expense' | 'withdrawal' | 'adjustment'
  amountCents: number
  memberId: string | null
  occurrenceId: string | null
  note: string | null
  occurredOn: IsoDate
  createdBy: string | null
  voided: boolean
}

export interface TabEntryRow {
  id: string
  owedTo: string
  owedBy: string
  amountCents: number
  source: 'bill' | 'settle'
  occurrenceId: string | null
  note: string | null
  createdBy: string | null
  createdAt: string
  voided: boolean
}

export interface HouseholdDetail extends Household {
  topups: Topup[]
  bills: Bill[]
  occurrences: BillOccurrence[]
  sharedEntries: SharedEntryRow[]
  tab: TabEntryRow[]
}

/** "You", their first name, or "Someone who left". */
export function memberName(h: Pick<Household, 'members'>, userId: string | null, me: string): string {
  if (!userId) return 'Someone'
  if (userId === me) return 'You'
  return h.members.find((m) => m.userId === userId)?.name.split(' ')[0] ?? 'Someone who left'
}

export const METHOD_LABELS: Record<BillMethod, string> = {
  shared_account: 'From the shared account',
  one_person: 'One person pays, others pay them back',
  each_own: 'Everyone pays their own share',
  covered: 'One person covers it',
}

export const CATEGORY_LABELS: Record<BillCategory, string> = {
  rent: 'Rent',
  power: 'Power',
  internet: 'Internet',
  water: 'Water',
  phone: 'Phone',
  insurance: 'Insurance',
  subscriptions: 'Subscriptions',
  bills: 'Bills',
  other: 'Other',
}

const MEMBERS =
  'members:household_members ( user_id, role, share_bp, left_at, profile:profiles!household_members_user_id_fkey ( display_name, avatar_path ) )'

interface HouseholdRow {
  id: string
  name: string
  has_shared_account: boolean
  shared_account_name: string | null
  members: {
    user_id: string
    role: 'owner' | 'member'
    share_bp: number | null
    left_at: string | null
    profile: { display_name: string; avatar_path: string | null } | null
  }[]
}

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    hasSharedAccount: row.has_shared_account,
    sharedAccountName: row.shared_account_name,
    members: row.members
      .filter((m) => m.left_at === null)
      .map((m) => ({
        userId: m.user_id,
        name: m.profile?.display_name ?? 'Someone',
        photo: m.profile?.avatar_path ?? null,
        role: m.role,
        shareBp: m.share_bp,
      })),
  }
}

/** Households you're in, with what's needed for a summary card. */
export async function listHouseholds(): Promise<
  (Household & { tab: TabEntryRow[]; sharedEntries: SharedEntryRow[] })[]
> {
  const { data, error } = await supabase().from('households').select(`*, ${MEMBERS}`).order('created_at')
  if (error) throw toAppError(error)
  const ids = data.map((h) => h.id)
  if (ids.length === 0) return []
  const [tab, shared] = await Promise.all([fetchTab(ids), fetchShared(ids)])
  return (data as unknown as HouseholdRow[]).map((row) => ({
    ...toHousehold(row),
    tab: tab.filter((t) => t.householdId === row.id),
    sharedEntries: shared.filter((s) => s.householdId === row.id),
  }))
}

export async function getHousehold(id: string): Promise<HouseholdDetail> {
  const { data, error } = await supabase().from('households').select(`*, ${MEMBERS}`).eq('id', id).maybeSingle()
  if (error) throw toAppError(error)
  if (!data) throw toAppError({ message: 'household_not_found' })
  const [topups, bills, occurrences, shared, tab] = await Promise.all([
    supabase().from('household_topups').select('*').eq('household_id', id).eq('active', true),
    supabase().from('household_bills').select('*').eq('household_id', id).eq('active', true).order('created_at'),
    supabase()
      .from('household_bill_occurrences')
      .select('*, shares:household_bill_shares ( user_id, amount_cents, paid_at )')
      .eq('household_id', id)
      .order('due_on', { ascending: false })
      .limit(200),
    fetchShared([id]),
    fetchTab([id]),
  ])
  for (const r of [topups, bills, occurrences]) if (r.error) throw toAppError(r.error)
  return {
    ...toHousehold(data as unknown as HouseholdRow),
    topups: (topups.data ?? []).map((t) => ({
      id: t.id,
      memberId: t.member_id,
      amountCents: toCents(t.amount_cents),
      frequency: t.frequency,
      nextOn: t.next_on,
    })),
    bills: (bills.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      amountType: b.amount_type,
      amountCents: b.amount_cents === null ? null : toCents(b.amount_cents),
      frequency: b.frequency,
      nextDueOn: b.next_due_on,
      method: b.method,
      payerId: b.payer_id,
      split: Array.isArray(b.split)
        ? (b.split as { user_id: string; share_bp: number }[]).map((s) => ({ userId: s.user_id, shareBp: s.share_bp }))
        : null,
    })),
    occurrences: (
      (occurrences.data ?? []) as unknown as (Omit<BillOccurrence, 'shares'> & Record<string, unknown>)[]
    ).map((o) => {
      const row = o as unknown as {
        id: string
        bill_id: string
        due_on: string
        method: BillMethod
        payer_id: string | null
        amount_cents: number | null
        status: BillOccurrence['status']
        receipt_path: string | null
        shares: { user_id: string; amount_cents: number; paid_at: string | null }[]
      }
      return {
        id: row.id,
        billId: row.bill_id,
        dueOn: row.due_on,
        method: row.method,
        payerId: row.payer_id,
        amountCents: row.amount_cents === null ? null : toCents(row.amount_cents),
        status: row.status,
        receiptPath: row.receipt_path,
        shares: row.shares.map((s) => ({
          userId: s.user_id,
          amountCents: toCents(s.amount_cents),
          paid: s.paid_at !== null,
        })),
      }
    }),
    sharedEntries: shared,
    tab,
  }
}

async function fetchShared(ids: string[]): Promise<(SharedEntryRow & { householdId: string })[]> {
  const { data, error } = await supabase()
    .from('shared_account_entries')
    .select('*')
    .in('household_id', ids)
    .order('occurred_on', { ascending: false })
  if (error) throw toAppError(error)
  return data.map((e) => ({
    id: e.id,
    householdId: e.household_id,
    kind: e.kind,
    amountCents: e.amount_cents,
    memberId: e.member_id,
    occurrenceId: e.occurrence_id,
    note: e.note,
    occurredOn: e.occurred_on,
    createdBy: e.created_by,
    voided: e.voided_at !== null,
  }))
}

async function fetchTab(ids: string[]): Promise<(TabEntryRow & { householdId: string })[]> {
  const { data, error } = await supabase()
    .from('household_tab_entries')
    .select('*')
    .in('household_id', ids)
    .order('created_at', { ascending: false })
  if (error) throw toAppError(error)
  return data.map((t) => ({
    id: t.id,
    householdId: t.household_id,
    owedTo: t.owed_to,
    owedBy: t.owed_by,
    amountCents: t.amount_cents,
    source: t.source,
    occurrenceId: t.occurrence_id,
    note: t.note,
    createdBy: t.created_by,
    createdAt: t.created_at,
    voided: t.voided_at !== null,
  }))
}

async function call<T>(
  promise: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await promise
  if (error) throw toAppError(error)
  return data
}

export const createHousehold = (input: {
  name: string
  hasSharedAccount: boolean
  sharedAccountName: string | null
  openingBalanceCents: number | null
}) =>
  call(
    supabase().rpc('create_household', {
      p_name: input.name.trim(),
      p_has_shared_account: input.hasSharedAccount,
      p_shared_account_name: input.sharedAccountName,
      p_opening_balance_cents: input.openingBalanceCents,
    }),
  )

export const updateHousehold = (
  id: string,
  name: string,
  hasSharedAccount: boolean,
  sharedAccountName: string | null,
) =>
  call(
    supabase().rpc('update_household', {
      p_household_id: id,
      p_name: name.trim(),
      p_has_shared_account: hasSharedAccount,
      p_shared_account_name: sharedAccountName,
    }),
  )

export const createHouseholdInvite = (id: string) =>
  call(supabase().rpc('create_household_invite', { p_household_id: id }))

export async function previewHouseholdInvite(
  token: string,
): Promise<{ status: string; householdName: string | null; invitedBy: string | null }> {
  const rows = await call(supabase().rpc('preview_household_invite', { p_token: token }))
  const row = rows?.[0]
  return {
    status: row?.status ?? 'not_found',
    householdName: row?.household_name ?? null,
    invitedBy: row?.invited_by ?? null,
  }
}

export const acceptHouseholdInvite = (token: string) =>
  call(supabase().rpc('accept_household_invite', { p_token: token }))

export const leaveHousehold = (id: string, userId?: string) =>
  call(supabase().rpc('leave_household', { p_household_id: id, p_user_id: userId ?? null }))

export const setHouseholdShares = (id: string, shares: { userId: string; shareBp: number }[] | null) =>
  call(
    supabase().rpc('set_household_shares', {
      p_household_id: id,
      p_shares: (shares ?? []).map((s) => ({ user_id: s.userId, share_bp: s.shareBp })) as unknown as Json,
    }),
  )

export const checkSharedBalance = (id: string, actualCents: number) =>
  call(supabase().rpc('check_shared_balance', { p_household_id: id, p_actual_cents: actualCents }))

export const addSharedEntry = (id: string, kind: 'topup' | 'withdrawal', amountCents: number, note: string) =>
  call(
    supabase().rpc('add_shared_entry', {
      p_household_id: id,
      p_kind: kind,
      p_amount_cents: amountCents,
      p_note: note.trim() || null,
    }),
  )

export const voidSharedEntry = (entryId: string) => call(supabase().rpc('void_shared_entry', { p_entry_id: entryId }))

export const createTopup = (id: string, amountCents: number, frequency: RepeatFrequency, firstOn: IsoDate) =>
  call(
    supabase().rpc('create_topup', {
      p_household_id: id,
      p_amount_cents: amountCents,
      p_frequency: frequency,
      p_first_on: firstOn,
    }),
  )

export const stopTopup = (topupId: string) => call(supabase().rpc('stop_topup', { p_topup_id: topupId }))

export interface BillInput {
  name: string
  category: BillCategory
  amountType: 'fixed' | 'varies'
  amountCents: number | null
  frequency: RepeatFrequency
  firstDueOn: IsoDate
  method: BillMethod
  payerId: string | null
  split: { userId: string; shareBp: number }[] | null
}

const splitArg = (split: BillInput['split']) =>
  split ? (split.map((s) => ({ user_id: s.userId, share_bp: s.shareBp })) as unknown as Json) : null

export const createBill = (householdId: string, input: BillInput) =>
  call(
    supabase().rpc('create_bill', {
      p_household_id: householdId,
      p_name: input.name.trim(),
      p_category: input.category,
      p_amount_type: input.amountType,
      p_amount_cents: input.amountCents,
      p_frequency: input.frequency,
      p_first_due_on: input.firstDueOn,
      p_method: input.method,
      p_payer_id: input.payerId,
      p_split: splitArg(input.split),
    }),
  )

export const changeBill = (billId: string, input: Omit<BillInput, 'frequency' | 'firstDueOn'>) =>
  call(
    supabase().rpc('change_bill', {
      p_bill_id: billId,
      p_name: input.name.trim(),
      p_category: input.category,
      p_amount_type: input.amountType,
      p_amount_cents: input.amountCents,
      p_method: input.method,
      p_payer_id: input.payerId,
      p_split: splitArg(input.split),
    }),
  )

export const stopBill = (billId: string) => call(supabase().rpc('stop_bill', { p_bill_id: billId }))

export const enterBillAmount = (occurrenceId: string, amountCents: number, receiptPath: string | null) =>
  call(
    supabase().rpc('enter_bill_amount', {
      p_occurrence_id: occurrenceId,
      p_amount_cents: amountCents,
      p_receipt_path: receiptPath,
    }),
  )

export const payOwnShare = (occurrenceId: string) =>
  call(supabase().rpc('pay_own_share', { p_occurrence_id: occurrenceId }))

export const skipOccurrence = (occurrenceId: string) =>
  call(supabase().rpc('skip_bill_occurrence', { p_occurrence_id: occurrenceId }))

export const changeOccurrencePayment = (occurrenceId: string, method: BillMethod, payerId: string | null) =>
  call(
    supabase().rpc('change_occurrence_payment', {
      p_occurrence_id: occurrenceId,
      p_method: method,
      p_payer_id: payerId,
    }),
  )

export const settleUp = (householdId: string, toUser: string, amountCents: number, note: string) =>
  call(
    supabase().rpc('settle_up', {
      p_household_id: householdId,
      p_to_user: toUser,
      p_amount_cents: amountCents,
      p_note: note.trim() || null,
    }),
  )

export const voidSettlement = (entryId: string) => call(supabase().rpc('void_settlement', { p_entry_id: entryId }))

/** Uploads a cleaned receipt into the household's folder and returns its path. */
export async function uploadHouseholdReceipt(householdId: string, jpeg: Blob): Promise<string> {
  const path = `${householdId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase().storage.from('household-receipts').upload(path, jpeg, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw toAppError({ message: error.message })
  return path
}
