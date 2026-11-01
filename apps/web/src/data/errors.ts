/**
 * Turns error codes into text a person can act on. Two sources:
 *   - database functions raise errors whose message is a stable key such as
 *     'invite_expired' (see the migration header);
 *   - Supabase Auth returns errors with a `code` such as 'otp_expired'.
 */
const MESSAGES: Record<string, string> = {
  // Supabase Auth
  email_address_invalid: 'Enter a valid email address.',
  email_address_not_authorized:
    'Kinvo can’t send email to that address yet. Ask the person who runs Kinvo to finish the email setup.',
  over_email_send_rate_limit: 'Too many sign-in emails have been sent recently. Wait a while, then try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  otp_expired: 'That code has expired or was already used. Request a new one.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',

  // Kinvo database functions
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

interface SupabaseErrorLike {
  message?: string
  code?: string
  status?: number
}

/** Converts whatever Supabase returned into an AppError. */
export function toAppError(error: SupabaseErrorLike | null | undefined): AppError {
  for (const key of [error?.code, error?.message]) {
    if (key && key in MESSAGES) return new AppError(key)
  }
  if (error?.status === 429) return new AppError('rate_limited')

  // Unknown errors show a generic message, but log the detail for debugging.
  if (error) console.error('Unhandled Supabase error', error)
  return new AppError('unknown')
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? FALLBACK
}
