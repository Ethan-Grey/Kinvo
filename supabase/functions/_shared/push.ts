/**
 * What a phone notification carries. Pure functions only, so they're easy to
 * test with `deno test`. The service worker (apps/web/public/push-sw.js)
 * reads exactly these fields.
 */
import { appLink } from './email.ts'

export interface PushInput {
  id: string
  title: string
  body: string
  linkPath: string
  unread: number
}

export interface PushPayload {
  /** Groups repeats of the same alert, so a retry replaces rather than adds. */
  tag: string
  title: string
  body: string
  /** Absolute in-app URL to open when tapped. */
  url: string
  /** Number for the app icon badge. */
  badge: number
}

/** Push services cap payloads near 4 KB; keep well under once encrypted. */
const MAX_BODY = 300

export function buildPushPayload(input: PushInput, appUrl: string): PushPayload {
  const body = input.body.length > MAX_BODY ? `${input.body.slice(0, MAX_BODY - 1)}…` : input.body
  return {
    tag: input.id,
    title: input.title.slice(0, 120),
    body,
    url: appLink(appUrl, input.linkPath),
    badge: Math.max(0, Math.min(input.unread, 99)),
  }
}

/** Push services answer 404 or 410 when a device has gone for good. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410
}
