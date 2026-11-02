/**
 * Phone notifications (Web Push, ADR-0017). Works in Chrome and Firefox,
 * and on iPhone (iOS 16.4+) once Kinvo is added to the Home Screen.
 */
import { toAppError } from './errors'
import { supabase } from './supabase'

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState =
  | 'unconfigured' // the app has no push key yet (deployment setup)
  | 'needs-install' // iPhone/iPad in Safari: add to Home Screen first
  | 'unsupported'
  | 'blocked' // the person said no; only the system settings can change it
  | 'off'
  | 'on'

function isAppleMobile(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  )
}

export async function pushState(): Promise<PushState> {
  if (!PUBLIC_KEY) return 'unconfigured'
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isAppleMobile() && !isInstalled() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const registration = await readyWorker()
  if (!registration) return 'unsupported'
  const subscription = await registration.pushManager.getSubscription()
  return subscription && Notification.permission === 'granted' ? 'on' : 'off'
}

/** The service worker, or null if it isn't running (e.g. in development) after a few seconds. */
async function readyWorker(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Must be called from a tap: browsers only show the permission prompt then. */
export async function turnOnPush(): Promise<PushState> {
  if (!PUBLIC_KEY) return 'unconfigured'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }))
  const json = subscription.toJSON()
  const { error } = await supabase().rpc('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw toAppError(error)
  return 'on'
}

export async function turnOffPush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const { error } = await supabase().rpc('delete_push_subscription', { p_endpoint: subscription.endpoint })
    if (error) throw toAppError(error)
    await subscription.unsubscribe()
  }
  return 'off'
}

/** The number on the Home Screen icon (where supported). */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  void (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {})
}
