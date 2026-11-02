/**
 * Builds the email for one notification. Pure functions only (no network,
 * no Deno APIs) so they're easy to test with `deno test`.
 *
 * The wording itself is written by the database (private.notify_from_event
 * and private.queue_reminders), so email and the in-app list always match.
 */

export interface NotificationEmailInput {
  displayName: string
  title: string
  body: string
  linkPath: string
}

export interface EmailMessage {
  subject: string
  text: string
  html: string
}

/** Palette: Dark Amethyst text, Violet Twilight button (docs/design.md). */
const INK = '#2c0735'
const MUTED = '#5c5c5c'
const BUTTON = '#613dc1'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Joins the app URL and a path from the database, allowing only in-app paths. */
export function appLink(appUrl: string, linkPath: string): string {
  const path = linkPath.startsWith('/') && !linkPath.startsWith('//') ? linkPath : '/'
  return new URL(path, appUrl).toString()
}

export function buildEmail(input: NotificationEmailInput, appUrl: string): EmailMessage {
  const firstName = input.displayName.trim().split(/\s+/)[0] || 'there'
  const link = appLink(appUrl, input.linkPath)
  const accountLink = appLink(appUrl, '/account')
  const settingsNote = 'You get these emails because you use Kinvo. To stop them, switch off "Email me" in Account.'

  const text = [
    `Kia ora ${firstName},`,
    '',
    input.title,
    input.body,
    '',
    `Open Kinvo: ${link}`,
    '',
    settingsNote,
    accountLink,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')

  const html = `<!doctype html>
<html lang="en-NZ">
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:${INK};">
      <p style="margin:0 0 16px;">Kia ora ${escapeHtml(firstName)},</p>
      <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">${escapeHtml(input.title)}</h1>
      ${input.body ? `<p style="margin:0 0 24px;line-height:1.5;">${escapeHtml(input.body)}</p>` : ''}
      <a href="${escapeHtml(link)}" style="display:inline-block;background:${BUTTON};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px;">Open Kinvo</a>
      <p style="margin:32px 0 0;font-size:12px;color:${MUTED};">You get these emails because you use Kinvo. To stop them, switch off &quot;Email me&quot; in <a href="${escapeHtml(accountLink)}" style="color:${MUTED};">Account</a>.</p>
    </div>
  </body>
</html>`

  return { subject: input.title, text, html }
}

/**
 * True when the request's `Authorization: Bearer <secret>` matches. Compares
 * every character so the time taken doesn't reveal how much of a guess was right.
 */
export function hasSharedSecret(authorization: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`
  const given = authorization ?? ''
  if (!secret || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}
