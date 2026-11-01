/**
 * Database functions raise errors whose message is a stable key such as
 * 'invite_expired' (see the migration header). This turns those keys into
 * text a person can act on.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Your session has ended. Please sign in again.',
  lender_access_required: 'Your account doesn’t have lender access yet.',
  too_many_open_invites: 'You have 10 unused invites. Revoke one before creating another.',
  invalid_note: 'Keep the note under 80 characters.',
  invalid_display_name: 'Your name must be between 1 and 80 characters.',
  invite_not_found: 'This invite link isn’t valid. Check you copied the whole link.',
  invite_revoked: 'This invite was cancelled. Ask for a new link.',
  invite_used: 'This invite has already been used. Ask for a new link.',
  invite_expired: 'This invite has expired. Ask for a new link.',
  invite_own: 'This is your own invite. Send it to the person you want to lend to.',
  relationship_not_found: 'That connection no longer exists.',
}

const FALLBACK = 'Something went wrong. Please try again.'

/** A failure from the data layer, carrying a message safe to show users. */
export class AppError extends Error {
  readonly code: string

  constructor(code: string) {
    super(MESSAGES[code] ?? FALLBACK)
    this.name = 'AppError'
    this.code = code
  }
}

/** Converts whatever Supabase returned into an AppError. */
export function toAppError(error: { message?: string } | null | undefined): AppError {
  const key = error?.message ?? 'unknown'
  return new AppError(key in MESSAGES ? key : 'unknown')
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? FALLBACK
}
