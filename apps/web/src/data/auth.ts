import { toAppError } from './errors'
import { markSignedOutOnPurpose, rememberEmail } from './sessionStorage'
import { supabase } from './supabase'

const PENDING_NEXT_KEY = 'kinvo.pendingNext'

/** Where the Google sign-in sends the user back to, preserving their destination. */
function oauthCallbackUrl(next: string): string {
  const url = new URL('/auth/callback', window.location.origin)
  url.searchParams.set('next', next)
  return url.toString()
}

export async function signInWithGoogle(next: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: oauthCallbackUrl(next) },
  })
  if (error) throw toAppError(error)
}

/**
 * Emails a one-time sign-in code (and a fallback link). Creates the account on
 * first use.
 *
 * Codes are the primary method because they work everywhere. Links can't
 * reach an app installed on an iPhone home screen, which keeps its storage
 * separate from Safari.
 */
export async function sendSignInCode(email: string, next: string): Promise<void> {
  rememberPendingNext(next)
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: new URL('/auth/confirm', window.location.origin).toString() },
  })
  if (error) throw toAppError(error)
}

/** Signs in with the code from the email. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const { error } = await supabase().auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw toAppError(error)
  rememberEmail(email)
}

/** Signs in from the link in the email. Works in any browser, unlike a PKCE code. */
export async function verifyEmailLink(tokenHash: string): Promise<void> {
  const { error } = await supabase().auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  if (error) throw toAppError(error)
}

export async function signOut(): Promise<void> {
  markSignedOutOnPurpose()
  const { error } = await supabase().auth.signOut()
  if (error) throw toAppError(error)
}

/**
 * The email link can't carry the page the user was heading to (e.g. an
 * invite), so remember it in this browser. Opening the link elsewhere just
 * lands on the home page.
 */
function rememberPendingNext(next: string): void {
  try {
    localStorage.setItem(PENDING_NEXT_KEY, next)
  } catch {
    // Storage unavailable (private mode); fall back to the home page.
  }
}

export function takePendingNext(): string | null {
  try {
    const next = localStorage.getItem(PENDING_NEXT_KEY)
    localStorage.removeItem(PENDING_NEXT_KEY)
    return next
  } catch {
    return null
  }
}
