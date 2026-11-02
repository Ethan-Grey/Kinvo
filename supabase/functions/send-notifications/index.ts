/**
 * send-notifications: emails pending notifications from the outbox.
 *
 * Called every 5 minutes by pg_cron (private.trigger_email_sender). Each run:
 *   1. claims up to 20 pending emails (claim_notification_emails uses
 *      SKIP LOCKED, so overlapping runs never send the same email twice);
 *   2. sends each through Gmail SMTP on port 465 (Supabase blocks 25 and 587);
 *   3. marks it sent, or returns it to the queue to retry (up to 5 attempts).
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   GMAIL_USER, GMAIL_APP_PASSWORD   the account the emails come from
 *   APP_URL                          e.g. https://kinvo-rust.vercel.app
 *   CRON_SECRET                      random string; the same value is stored in
 *                                    Vault as kinvo_send_key so pg_cron can call this
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import { buildEmail, hasSharedSecret } from '../_shared/email.ts'

interface ClaimedEmail {
  id: string
  email: string
  display_name: string
  title: string
  body: string
  link_path: string
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing secret ${name}`)
  return value
}

Deno.serve(async (request) => {
  if (!hasSharedSecret(request.headers.get('Authorization'), Deno.env.get('CRON_SECRET') ?? '')) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }
  try {
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })
    const gmailUser = requireEnv('GMAIL_USER')
    const appUrl = Deno.env.get('APP_URL') ?? 'https://kinvo-rust.vercel.app'

    const { data, error } = await supabase.rpc('claim_notification_emails', { p_limit: 20 })
    if (error) throw error
    const batch = (data ?? []) as ClaimedEmail[]
    if (batch.length === 0) return Response.json({ sent: 0, failed: 0 })

    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: requireEnv('GMAIL_APP_PASSWORD') },
    })

    let sent = 0
    let failed = 0
    for (const item of batch) {
      const message = buildEmail(
        { displayName: item.display_name, title: item.title, body: item.body, linkPath: item.link_path },
        appUrl,
      )
      try {
        await transport.sendMail({
          from: { name: 'Kinvo', address: gmailUser },
          to: item.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        })
        await supabase.rpc('finish_notification_email', { p_id: item.id, p_ok: true })
        sent++
      } catch (sendError) {
        failed++
        await supabase.rpc('finish_notification_email', {
          p_id: item.id,
          p_ok: false,
          p_error: sendError instanceof Error ? sendError.message : String(sendError),
        })
      }
    }

    return Response.json({ sent, failed })
  } catch (err) {
    console.error(err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
