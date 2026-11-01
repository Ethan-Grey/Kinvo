import { toAppError } from './errors'
import { supabase } from './supabase'

/** Where the sign-in provider sends the user back to, preserving their destination. */
function callbackUrl(next: string): string {
  const url = new URL('/auth/callback', window.location.origin)
  url.searchParams.set('next', next)
  return url.toString()
}

export async function signInWithGoogle(next: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(next) },
  })
  if (error) throw toAppError(error)
}

/** Emails a one-time sign-in link. Creates the account on first use. */
export async function sendMagicLink(email: string, next: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(next) },
  })
  if (error) throw toAppError(error)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut()
  if (error) throw toAppError(error)
}
