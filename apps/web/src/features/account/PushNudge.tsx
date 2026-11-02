import { useState } from 'react'
import { turnOnPush } from '../../data/push'
import { BellIcon, CloseIcon } from '../../shared/icons'
import { Button, IconBubble, Notice } from '../../shared/ui'
import { EXPLAIN_PUSH, usePushState } from './usePushState'

const DISMISSED_KEY = 'kinvo.pushNudgeDismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A one-off card on Home asking to turn on phone notifications, until the
 * person does or closes it. The same setting lives in Account.
 */
export function PushNudge() {
  const [state, setState] = usePushState()
  const [dismissed, setDismissed] = useState(wasDismissed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed || (state !== 'off' && state !== 'needs-install')) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Private browsing: it'll just show again next time.
    }
    setDismissed(true)
  }

  async function turnOn() {
    setBusy(true)
    setError(null)
    try {
      setState(await turnOnPush())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-line p-4">
      <div className="flex items-start gap-3">
        <IconBubble>
          <BellIcon />
        </IconBubble>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold">Get a pop-up when it matters</h2>
          <p className="text-sm text-ink-muted">
            Know straight away when someone asks to borrow, pays you, or a payment is due.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          className="-m-1 flex size-10 items-center justify-center rounded-full text-ink-muted hover:text-ink"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>
      {state === 'off' ? (
        <Button className="w-full" busy={busy} onClick={turnOn}>
          Turn on notifications
        </Button>
      ) : (
        <Notice>{EXPLAIN_PUSH['needs-install']}</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}
