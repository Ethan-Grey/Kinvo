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
  invalid_display_name: 'Enter your name as people know you, e.g. “Hana Grey”.',
  invalid_photo: 'That photo couldn’t be used. Please choose it again.',
  photo_not_uploaded: 'The photo didn’t finish uploading. Please try again.',
  invalid_setting: "That setting couldn't be saved. Please try again.",
  invite_not_found: 'This invite link isn’t valid. Check you copied the whole link.',
  invite_revoked: 'This invite was cancelled. Ask for a new link.',
  invite_used: 'This invite has already been used. Ask for a new link.',
  invite_expired: 'This invite has expired. Ask for a new link.',
  invite_own: 'This is your own invite. Send it to the person you want to lend to.',
  relationship_not_found: 'That connection no longer exists.',
  relationship_ended: 'You’re no longer connected with this person.',
  relationship_has_open_loans: 'Settle or cancel the open loans with this person first.',

  // Loans (M3)
  loan_not_found: 'That loan doesn’t exist, or you don’t have access to it.',
  invalid_principal: 'Enter an amount between $0.01 and $100,000.',
  invalid_charge: 'The charge must be between $0 and $100,000.',
  invalid_reason: 'Keep the reason under 500 characters.',
  invalid_schedule: 'Add between 1 and 52 repayments, each with a date and an amount.',
  schedule_date_in_past: 'Repayment dates can’t be in the past.',
  schedule_dates_not_increasing: 'Each repayment date must be after the one before it.',
  schedule_total_mismatch: 'The repayments must add up to the amount borrowed plus the charge.',
  loan_not_negotiating: 'These terms can no longer be changed.',
  terms_changed: 'The terms changed while you were looking. Check the latest version.',
  cannot_accept_own_terms: 'You proposed these terms. Wait for the other person to respond.',
  cannot_reject_own_terms: 'You proposed these terms. Withdraw them instead.',
  cannot_withdraw_their_terms: 'These are the other person’s terms. Reject them instead.',
  loan_not_cancellable: 'This loan can no longer be cancelled.',
  lender_only: 'Only the lender can do that.',
  receipt_required: 'Add a photo of the receipt or bank statement.',
  invalid_receipt: 'That receipt couldn’t be used. Please add it again.',
  receipt_not_uploaded: 'The receipt didn’t finish uploading. Please add it again.',
  charge_set_by_lender: 'Only the lender can set or change the charge.',
  loan_already_removed: 'This loan has already been removed.',
  loan_removed: 'This loan was removed by the lender.',
  reason_too_long: 'Keep the reason under 500 characters.',
  loan_not_agreed: 'This loan isn’t waiting for the money to be sent.',
  invalid_sent_date: 'The date sent can’t be in the future.',
  invalid_payment_method: 'Choose how the money was sent.',
  invalid_reference: 'Keep the reference under 100 characters.',

  // Repayments (M4)
  loan_not_active: 'Payments can only be recorded while the loan is active.',
  invalid_amount: 'Enter an amount greater than $0.',
  invalid_received_date: 'The payment date can’t be in the future.',
  received_before_funds_sent: 'The payment date can’t be before the money was lent.',
  invalid_notes: 'Keep notes under 500 characters.',
  amount_exceeds_outstanding: 'That’s more than is still owed on this loan.',
  duplicate_repayment: 'That payment was just recorded. Check the list before adding it again.',
  repayment_not_found: 'That payment no longer exists.',
  repayment_not_pending: 'That payment has already been dealt with.',
  repayment_not_confirmed: 'Only confirmed payments can be reversed.',
  reason_required: 'Add a short reason (up to 500 characters).',
  loan_closed: 'This loan is closed, so its payments can’t be changed.',
  nothing_outstanding: 'Nothing is owed on this loan.',

  // Existing debts
  invalid_existing_debt: 'Check the existing debt details and try again.',
  invalid_lent_date: 'The date the money was lent can’t be in the future.',

  // Reminders
  invalid_reminder_message: 'Write a message for the reminder (up to 200 characters).',
  reminder_in_past: 'Pick a date and time that hasn’t passed yet.',
  reminder_not_found: 'That reminder has already finished or been cancelled.',
  too_many_reminders: 'You can have up to 20 reminders for one person. Cancel one first.',
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
