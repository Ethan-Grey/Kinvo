import type { Profile } from './database.types'
import { toAppError } from './errors'
import { supabase } from './supabase'

export interface Connection {
  relationshipId: string
  personId: string
  personName: string
  personPhoto: string | null
  since: string
}

export interface People {
  /** People who lend to me. */
  lenders: Connection[]
  /** People I lend to. */
  borrowers: Connection[]
}

export async function getMyProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase().from('profiles').select('*').eq('id', userId).single()
  if (error) throw toAppError(error)
  return data
}

/** Active relationships, split by which side of them the user is on. */
export async function listPeople(userId: string): Promise<People> {
  const { data, error } = await supabase()
    .from('lending_relationships')
    .select(
      `id, created_at, lender_id, borrower_id,
       lender:profiles!lending_relationships_lender_id_fkey ( display_name, avatar_path ),
       borrower:profiles!lending_relationships_borrower_id_fkey ( display_name, avatar_path )`,
    )
    .is('ended_at', null)
    .order('created_at')
  if (error) throw toAppError(error)

  const people: People = { lenders: [], borrowers: [] }
  for (const row of data) {
    if (row.borrower_id === userId) {
      people.lenders.push({
        relationshipId: row.id,
        personId: row.lender_id,
        personName: row.lender.display_name,
        personPhoto: row.lender.avatar_path,
        since: row.created_at,
      })
    } else {
      people.borrowers.push({
        relationshipId: row.id,
        personId: row.borrower_id,
        personName: row.borrower.display_name,
        personPhoto: row.borrower.avatar_path,
        since: row.created_at,
      })
    }
  }
  return people
}

export async function endRelationship(relationshipId: string): Promise<void> {
  const { error } = await supabase().rpc('end_relationship', { p_relationship_id: relationshipId })
  if (error) throw toAppError(error)
}
