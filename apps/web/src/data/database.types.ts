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
export type LoanKind = 'new' | 'existing_debt'
export type PaymentMethod = 'bank_transfer' | 'cash' | 'other'
export type RepaymentStatus = 'claimed' | 'confirmed' | 'disputed' | 'reversed'
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
