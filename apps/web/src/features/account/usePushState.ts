import { useEffect, useState } from 'react'
import { pushState, type PushState } from '../../data/push'

export const EXPLAIN_PUSH: Record<Exclude<PushState, 'on' | 'off'>, string> = {
  unconfigured: 'Phone notifications aren’t set up for Kinvo yet.',
  'needs-install':
    'On iPhone, add Kinvo to your Home Screen first: tap Share, then “Add to Home Screen”. Open Kinvo from there and turn this on.',
  unsupported: 'This browser can’t show notifications. Try Safari on iPhone (from the Home Screen) or Chrome.',
  blocked: 'Notifications are blocked for Kinvo. Turn them on in your phone’s Settings → Notifications → Kinvo.',
}

/** Whether this device gets pop-up notifications, and a way to change it. */
export function usePushState() {
  const [state, setState] = useState<PushState | null>(null)
  useEffect(() => {
    let cancelled = false
    pushState().then(
      (s) => !cancelled && setState(s),
      () => !cancelled && setState('unsupported'),
    )
    return () => {
      cancelled = true
    }
  }, [])
  return [state, setState] as const
}
