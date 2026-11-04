/**
 * TypeScript types for the Supabase database.
 *
 * Mirrors supabase/migrations. Regenerate from a running database with:
 *   npm run db:types
 * and review the diff. Until the first regeneration this file is maintained by hand.
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          email: string
          can_lend: boolean
          created_at: string
          email_notifications: boolean
          name_confirmed: boolean
          avatar_path: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      lender_invites: {
        Row: {
          id: string
          lender_id: string
          token_hash: string
          note: string | null
          expires_at: string
          accepted_by: string | null
          accepted_at: string | null
          revoked_at: string | null
          created_at: string
          existing_debt: Json | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      lending_relationships: {
        Row: {
          id: string
          lender_id: string
          borrower_id: string
          invite_id: string | null
          created_at: string
          ended_at: string | null
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'lending_relationships_lender_id_fkey'
            columns: ['lender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lending_relationships_borrower_id_fkey'
            columns: ['borrower_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      audit_events: {
        Row: {
          id: number
          actor_id: string | null
          relationship_id: string | null
          loan_id: string | null
          event_type: string
          payload: Json
          occurred_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      loans: {
        Row: {
          repeating_debt_id: string | null
          id: string
          relationship_id: string
          lender_id: string
          borrower_id: string
          created_by: string
          status: LoanStatus
          reason: string | null
          current_terms_id: string | null
          agreed_at: string | null
          funds_sent_at: string | null
          funds_sent_on: string | null
          funds_method: PaymentMethod | null
          funds_reference: string | null
          written_off_cents: number | null
          removed_reason: string | null
          funds_receipt_path: string | null
          kind: LoanKind
          originally_lent_on: string | null
          closed_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'loans_lender_id_fkey'
            columns: ['lender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'loans_borrower_id_fkey'
            columns: ['borrower_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      loan_terms: {
        Row: {
          id: string
          loan_id: string
          version: number
          proposed_by: string
          principal_cents: number
          charge_cents: number
          late_terms: string
          conditions: string
          message: string | null
          terms_hash: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      instalments: {
        Row: {
          id: string
          terms_id: string
          sequence: number
          due_on: string
          amount_cents: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      repayments: {
        Row: {
          id: string
          loan_id: string
          amount_cents: number
          received_on: string
          method: PaymentMethod
          reference: string | null
          notes: string | null
          status: RepaymentStatus
          submitted_by: string
          created_at: string
          confirmed_at: string | null
          disputed_at: string | null
          dispute_reason: string | null
          reversed_at: string | null
          reversal_reason: string | null
          receipt_path: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          recipient_id: string
          kind: string
          loan_id: string | null
          title: string
          body: string
          link_path: string
          dedupe_key: string
          created_at: string
          read_at: string | null
          email_status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
          email_attempts: number
          email_sent_at: string | null
          email_last_error: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      reminder_settings: {
        Row: {
          relationship_id: string
          late_every_days: number | null
          late_hour: number
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      reminder_rules: {
        Row: {
          id: string
          relationship_id: string
          days_from_due: number
          send_hour: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      repeating_debts: {
        Row: {
          id: string
          relationship_id: string
          created_by: string
          description: string
          amount_cents: number
          frequency: RepeatFrequency
          first_on: string
          end_on: string | null
          status: RepeatingStatus
          created_count: number
          next_on: string | null
          accepted_at: string | null
          stopped_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      households: {
        Row: {
          id: string
          name: string
          has_shared_account: boolean
          shared_account_name: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: 'owner' | 'member'
          share_bp: number | null
          joined_at: string
          left_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_invites: {
        Row: {
          id: string
          household_id: string
          created_by: string
          expires_at: string
          accepted_by: string | null
          accepted_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_topups: {
        Row: {
          id: string
          household_id: string
          member_id: string
          amount_cents: number
          frequency: RepeatFrequency
          first_on: string
          created_count: number
          next_on: string | null
          active: boolean
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_bills: {
        Row: {
          id: string
          household_id: string
          name: string
          category: BillCategory
          amount_type: 'fixed' | 'varies'
          amount_cents: number | null
          frequency: RepeatFrequency
          first_due_on: string
          created_count: number
          next_due_on: string | null
          method: BillMethod
          payer_id: string | null
          split: Json | null
          active: boolean
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_bill_occurrences: {
        Row: {
          id: string
          bill_id: string
          household_id: string
          sequence: number
          due_on: string
          method: BillMethod
          payer_id: string | null
          amount_cents: number | null
          status: 'needs_amount' | 'open' | 'done' | 'skipped'
          receipt_path: string | null
          entered_by: string | null
          entered_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_bill_shares: {
        Row: {
          occurrence_id: string
          user_id: string
          amount_cents: number
          paid_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shared_account_entries: {
        Row: {
          id: string
          household_id: string
          kind: 'opening' | 'topup' | 'bill' | 'expense' | 'withdrawal' | 'adjustment'
          amount_cents: number
          member_id: string | null
          topup_id: string | null
          occurrence_id: string | null
          note: string | null
          occurred_on: string
          created_by: string | null
          created_at: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_tab_entries: {
        Row: {
          id: string
          household_id: string
          owed_to: string
          owed_by: string
          amount_cents: number
          source: 'bill' | 'settle'
          occurrence_id: string | null
          note: string | null
          receipt_path: string | null
          created_by: string | null
          created_at: string
          voided_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      custom_reminders: {
        Row: {
          id: string
          relationship_id: string
          loan_id: string | null
          created_by: string
          message: string
          first_on: string
          send_hour: number
          repeat: ReminderRepeat
          sent_count: number
          next_at: string | null
          last_sent_at: string | null
          cancelled_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      term_acceptances: {
        Row: {
          id: string
          terms_id: string
          accepted_by: string
          terms_hash: string
          accepted_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      create_household: {
        Args: { p_name: string; p_has_shared_account?: boolean; p_shared_account_name?: string | null; p_opening_balance_cents?: number | null }
        Returns: string
      }
      update_household: {
        Args: { p_household_id: string; p_name: string; p_has_shared_account: boolean; p_shared_account_name?: string | null }
        Returns: undefined
      }
      create_household_invite: {
        Args: { p_household_id: string }
        Returns: string
      }
      preview_household_invite: {
        Args: { p_token: string }
        Returns: { status: string; household_name: string | null; invited_by: string | null }[]
      }
      accept_household_invite: {
        Args: { p_token: string }
        Returns: string
      }
      leave_household: {
        Args: { p_household_id: string; p_user_id?: string | null }
        Returns: undefined
      }
      set_household_shares: {
        Args: { p_household_id: string; p_shares: Json }
        Returns: undefined
      }
      check_shared_balance: {
        Args: { p_household_id: string; p_actual_cents: number }
        Returns: undefined
      }
      add_shared_entry: {
        Args: { p_household_id: string; p_kind: 'topup' | 'withdrawal'; p_amount_cents: number; p_on?: string | null; p_note?: string | null }
        Returns: string
      }
      void_shared_entry: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      create_topup: {
        Args: { p_household_id: string; p_amount_cents: number; p_frequency: RepeatFrequency; p_first_on: string }
        Returns: string
      }
      stop_topup: {
        Args: { p_topup_id: string }
        Returns: undefined
      }
      create_bill: {
        Args: {
          p_household_id: string
          p_name: string
          p_category: BillCategory
          p_amount_type: 'fixed' | 'varies'
          p_amount_cents: number | null
          p_frequency: RepeatFrequency
          p_first_due_on: string
          p_method: BillMethod
          p_payer_id?: string | null
          p_split?: Json | null
        }
        Returns: string
      }
      change_bill: {
        Args: {
          p_bill_id: string
          p_name: string
          p_category: BillCategory
          p_amount_type: 'fixed' | 'varies'
          p_amount_cents: number | null
          p_method: BillMethod
          p_payer_id?: string | null
          p_split?: Json | null
        }
        Returns: undefined
      }
      stop_bill: {
        Args: { p_bill_id: string }
        Returns: undefined
      }
      enter_bill_amount: {
        Args: { p_occurrence_id: string; p_amount_cents: number; p_receipt_path?: string | null }
        Returns: undefined
      }
      pay_own_share: {
        Args: { p_occurrence_id: string }
        Returns: undefined
      }
      skip_bill_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: undefined
      }
      change_occurrence_payment: {
        Args: { p_occurrence_id: string; p_method: BillMethod; p_payer_id?: string | null }
        Returns: undefined
      }
      settle_up: {
        Args: { p_household_id: string; p_to_user: string; p_amount_cents: number; p_note?: string | null; p_receipt_path?: string | null }
        Returns: string
      }
      void_settlement: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      create_split_bill: {
        Args: { p_description: string; p_total_cents: number; p_paid_on: string; p_due_on: string; p_shares: Json }
        Returns: string[]
      }
      attach_bill_receipt: {
        Args: { p_loan_id: string; p_receipt_path: string }
        Returns: undefined
      }
      propose_repeating_debt: {
        Args: {
          p_relationship_id: string
          p_description: string
          p_amount_cents: number
          p_frequency: RepeatFrequency
          p_first_on: string
          p_end_on?: string | null
        }
        Returns: string
      }
      respond_repeating_debt: {
        Args: { p_id: string; p_accept: boolean }
        Returns: undefined
      }
      change_repeating_amount: {
        Args: { p_id: string; p_amount_cents: number }
        Returns: undefined
      }
      set_repeating_status: {
        Args: { p_id: string; p_status: 'active' | 'paused' | 'stopped' }
        Returns: undefined
      }
      reschedule_loan: {
        Args: { p_loan_id: string; p_expected_terms_id: string; p_instalments: Json; p_note?: string | null }
        Returns: string
      }
      save_reminder_settings: {
        Args: { p_relationship_id: string; p_rules: Json; p_late_every_days?: number | null; p_late_hour?: number }
        Returns: undefined
      }
      create_custom_reminder: {
        Args: {
          p_relationship_id: string
          p_message: string
          p_first_on: string
          p_send_hour: number
          p_repeat?: ReminderRepeat
          p_loan_id?: string | null
        }
        Returns: string
      }
      cancel_custom_reminder: {
        Args: { p_reminder_id: string }
        Returns: undefined
      }
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null }
        Returns: undefined
      }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      set_avatar: {
        Args: { p_path: string | null }
        Returns: undefined
      }
      remove_loan: {
        Args: { p_loan_id: string; p_reason?: string | null }
        Returns: undefined
      }
      clear_notifications: {
        Args: { p_ids?: string[] | null }
        Returns: undefined
      }
      set_email_notifications: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      export_my_data: {
        Args: Record<string, never>
        Returns: Json
      }
      mark_notifications_read: {
        Args: { p_ids?: string[] | null }
        Returns: undefined
      }
      set_display_name: {
        Args: { p_display_name: string }
        Returns: undefined
      }
      create_invite: {
        Args: { p_note?: string | null; p_existing_debt?: Json | null }
        Returns: { invite_id: string; token: string; expires_at: string }[]
      }
      preview_invite: {
        Args: { p_token: string }
        Returns: {
          lender_name: string | null
          expires_at: string | null
          status: InviteStatus
          debt_amount_cents: number | null
          debt_lent_on: string | null
          debt_reason: string | null
        }[]
      }
      accept_invite: {
        Args: { p_token: string }
        Returns: string
      }
      revoke_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      end_relationship: {
        Args: { p_relationship_id: string }
        Returns: undefined
      }
      create_loan: {
        Args: TermsArgs & { p_relationship_id: string; p_reason?: string | null }
        Returns: string
      }
      counter_offer: {
        Args: TermsArgs & { p_loan_id: string; p_expected_terms_id: string }
        Returns: string
      }
      accept_terms: {
        Args: { p_loan_id: string; p_terms_id: string; p_terms_hash: string }
        Returns: undefined
      }
      reject_terms: {
        Args: { p_loan_id: string; p_note?: string | null }
        Returns: undefined
      }
      withdraw_loan: {
        Args: { p_loan_id: string; p_note?: string | null }
        Returns: undefined
      }
      confirm_funds_sent: {
        Args: {
          p_loan_id: string
          p_sent_on: string
          p_method: PaymentMethod
          p_reference?: string | null
          p_receipt_path?: string | null
        }
        Returns: undefined
      }
      get_instalment_progress: {
        Args: { p_loan_id: string }
        Returns: {
          instalment_id: string
          sequence: number
          due_on: string
          amount_cents: number
          paid_cents: number
          paid_charge_cents: number
          paid_principal_cents: number
          paid_on: string | null
          status: InstalmentStatus
        }[]
      }
      list_loan_balances: {
        Args: Record<string, never>
        Returns: {
          loan_id: string
          total_cents: number
          paid_cents: number
          written_off_cents: number
          outstanding_cents: number
          next_due_on: string | null
          next_due_cents: number | null
          overdue_cents: number
          overdue_count: number
        }[]
      }
      record_repayment: {
        Args: {
          p_loan_id: string
          p_amount_cents: number
          p_received_on: string
          p_method: PaymentMethod
          p_reference?: string | null
          p_notes?: string | null
          p_receipt_path?: string | null
        }
        Returns: string
      }
      confirm_repayment: {
        Args: { p_repayment_id: string }
        Returns: undefined
      }
      dispute_repayment: {
        Args: { p_repayment_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_repayment: {
        Args: { p_repayment_id: string; p_reason: string }
        Returns: undefined
      }
      forgive_remaining: {
        Args: { p_loan_id: string; p_note?: string | null }
        Returns: number
      }
      get_dashboard_summary: {
        Args: Record<string, never>
        Returns: {
          lending_owed_cents: number
          lending_overdue_cents: number
          lending_overdue_count: number
          lending_total_lent_cents: number
          lending_active_count: number
          charges_received_cents: number
          tax_year_start: string
          borrowing_owed_cents: number
          borrowing_overdue_cents: number
          borrowing_overdue_count: number
          borrowing_next_due_on: string | null
          borrowing_next_due_cents: number | null
          borrowing_active_count: number
          replies_needed: number
          funds_to_send: number
          claims_to_confirm: number
          claims_disputed: number
        }[]
      }
      list_upcoming_instalments: {
        Args: { p_limit?: number }
        Returns: {
          loan_id: string
          role: 'lender' | 'borrower'
          other_person_name: string
          sequence: number
          due_on: string
          remaining_cents: number
          status: 'due' | 'overdue'
        }[]
      }
      list_borrower_records: {
        Args: Record<string, never>
        Returns: {
          relationship_id: string
          borrower_id: string
          borrower_name: string
          connected_since: string
          ended_at: string | null
          loans_funded: number
          loans_open: number
          total_borrowed_cents: number
          total_repaid_cents: number
          owed_cents: number
          overdue_cents: number
          instalments_assessed: number
          instalments_on_time: number
          instalments_late: number
          average_days_late: number | null
        }[]
      }
    }
    Enums: {
      repayment_status: RepaymentStatus
      loan_status: LoanStatus
      payment_method: PaymentMethod
      reminder_repeat: ReminderRepeat
    }
    CompositeTypes: Record<never, never>
  }
}

/** Shared arguments of create_loan and counter_offer. Amounts are cents. */
type TermsArgs = {
  p_principal_cents: number
  p_charge_cents: number
  p_instalments: Json
  p_late_terms?: string
  p_conditions?: string
  p_message?: string | null
}

export type LoanStatus =
  'negotiating' | 'agreed' | 'active' | 'completed' | 'rejected' | 'withdrawn' | 'written_off' | 'removed'
export type LoanKind = 'new' | 'existing_debt' | 'bill' | 'repeating'
export type BillMethod = 'shared_account' | 'one_person' | 'each_own' | 'covered'
export type BillCategory =
  | 'rent'
  | 'power'
  | 'internet'
  | 'water'
  | 'phone'
  | 'insurance'
  | 'subscriptions'
  | 'bills'
  | 'other'
export type RepeatFrequency = 'weekly' | 'fortnightly' | 'monthly'
export type RepeatingStatus = 'proposed' | 'active' | 'paused' | 'stopped' | 'declined'
export type PaymentMethod = 'bank_transfer' | 'cash' | 'other'
export type RepaymentStatus = 'claimed' | 'confirmed' | 'disputed' | 'reversed'
export type ReminderRepeat = 'never' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
export type InstalmentStatus = 'paid' | 'due' | 'overdue'

export type InviteStatus = 'valid' | 'not_found' | 'revoked' | 'used' | 'expired' | 'own_invite'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type LenderInvite = Database['public']['Tables']['lender_invites']['Row']
export type LendingRelationship = Database['public']['Tables']['lending_relationships']['Row']
export type LoanRow = Database['public']['Tables']['loans']['Row']
export type LoanTermsRow = Database['public']['Tables']['loan_terms']['Row']
export type InstalmentRow = Database['public']['Tables']['instalments']['Row']
export type TermAcceptanceRow = Database['public']['Tables']['term_acceptances']['Row']
export type RepaymentRow = Database['public']['Tables']['repayments']['Row']
