import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let client: SupabaseClient<Database> | undefined

/**
 * True when the build has the Supabase settings it needs. Vite inlines these
 * at build time, so a deploy without them can never work until it's rebuilt.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
}

/**
 * The single Supabase client for the app, created on first use.
 *
 * Created lazily so that tests and builds don't need Supabase credentials.
 */
export function supabase(): SupabaseClient<Database> {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Copy .env.example to apps/web/.env.local and fill in ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
    )
  }

  client = createClient<Database>(url, key, {
    auth: {
      // PKCE is the secure flow for browser apps: the sign-in redirect carries a
      // one-time code instead of tokens in the URL.
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}
