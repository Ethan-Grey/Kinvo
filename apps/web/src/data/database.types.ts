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
          event_type: string
          payload: Json
          occurred_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      set_display_name: {
        Args: { p_display_name: string }
        Returns: undefined
      }
      create_invite: {
        Args: { p_note?: string | null }
        Returns: { invite_id: string; token: string; expires_at: string }[]
      }
      preview_invite: {
        Args: { p_token: string }
        Returns: { lender_name: string | null; expires_at: string | null; status: InviteStatus }[]
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
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

export type InviteStatus = 'valid' | 'not_found' | 'revoked' | 'used' | 'expired' | 'own_invite'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type LenderInvite = Database['public']['Tables']['lender_invites']['Row']
export type LendingRelationship = Database['public']['Tables']['lending_relationships']['Row']
