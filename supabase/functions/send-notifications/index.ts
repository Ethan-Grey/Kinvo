/**
 * send-notifications: delivers pending notifications from the outbox.
 *
 * Called by the database as soon as notifications are written
 * (private.wake_sender), and every 5 minutes by pg_cron as a fallback. Each run:
 *   1. pushes new alerts to the recipient's phones (Web Push, ADR-0017);
 *   2. emails pending notifications through Gmail SMTP on port 465
 *      (Supabase blocks 25 and 587), retrying failures up to 5 times.
 * Claims use SKIP LOCKED, so overlapping runs never send anything twice.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   GMAIL_USER, GMAIL_APP_PASSWORD   the account the emails come from
 *   APP_URL                          e.g. https://kinvo-rust.vercel.app
 *   CRON_SECRET                      random string; the same value is stored in
 *                                    Vault as kinvo_send_key so the database can call this
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *                                    Web Push keys (docs/setup.md); pushes are
 *                                    skipped until they're set
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import webpush from 'npm:web-push@3.6.7'
import { buildEmail, hasSharedSecret } from '../_shared/email.ts'
import { buildPushPayload, isGone } from '../_shared/push.ts'

interface ClaimedEmail {
  id: string
  email: string
  display_name: string
  title: string
  body: string
  link_path: string
}

interface ClaimedPush {
  id: string
  title: string
  body: string
  link_path: string
  unread: number
  subscriptions: { endpoint: string; p256dh: string; auth: string }[]
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing secret ${name}`)
  return value
}

async function sendPushes(supabase: SupabaseClient, appUrl: string) {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) return { pushed: 0, skipped: 'not configured' }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const { data, error } = await supabase.rpc('claim_notification_pushes', { p_limit: 50 })
  if (error) throw error
  let pushed = 0
  for (const item of (data ?? []) as ClaimedPush[]) {
    const payload = JSON.stringify(
      buildPushPayload(
        { id: item.id, title: item.title, body: item.body, linkPath: item.link_path, unread: item.unread },
        appUrl,
      ),
    )
    const gone: string[] = []
    let delivered = false
    for (const sub of item.subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' },
        )
        delivered = true
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (isGone(status)) gone.push(sub.endpoint)
        else console.error('push failed', status, (err as Error).message)
      }
    }
    await supabase.rpc('finish_notification_push', { p_id: item.id, p_ok: delivered, p_gone: gone })
    if (delivered) pushed++
  }
  return { pushed }
}

async function sendEmails(supabase: SupabaseClient, appUrl: string) {
  const gmailUser = requireEnv('GMAIL_USER')
  const { data, error } = await supabase.rpc('claim_notification_emails', { p_limit: 20 })
  if (error) throw error
  const batch = (data ?? []) as ClaimedEmail[]
  if (batch.length === 0) return { sent: 0, failed: 0 }

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
  return { sent, failed }
}

Deno.serve(async (request) => {
  if (!hasSharedSecret(request.headers.get('Authorization'), Deno.env.get('CRON_SECRET') ?? '')) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }
  try {
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })
    const appUrl = Deno.env.get('APP_URL') ?? 'https://kinvo-rust.vercel.app'

    // Pushes first: they're what people see straight away.
    const push = await sendPushes(supabase, appUrl).catch((err) => ({ pushError: String(err) }))
    const email = await sendEmails(supabase, appUrl)
    return Response.json({ ...push, ...email })
  } catch (err) {
    console.error(err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
