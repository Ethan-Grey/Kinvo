import { useState } from 'react'
import { turnOffPush, turnOnPush } from '../../data/push'
import { BellIcon } from '../../shared/icons'
import { Button, Card, IconBubble, Notice } from '../../shared/ui'
import { EXPLAIN_PUSH, usePushState } from './usePushState'

/**
 * Account card: "Notify this phone". Pop-up notifications like a message,
 * for loan requests, payments and due dates (ADR-0017). Per device, because
 * each phone or computer has to say yes for itself.
 */
export function PhoneNotificationsCard() {
  const [state, setState] = usePushState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(on: boolean) {
    setBusy(true)
    setError(null)
    try {
      setState(await (on ? turnOnPush() : turnOffPush()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (state === null) return null

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <IconBubble>
          <BellIcon />
        </IconBubble>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Notify this phone</h2>
          <p className="text-sm text-ink-muted">
            {state === 'on'
              ? 'On. Requests, payments and due dates pop up here, even when Kinvo is closed.'
              : 'Pop-up alerts for requests, payments and due dates, even when Kinvo is closed.'}
          </p>
        </div>
      </div>
      {state === 'on' || state === 'off' ? (
        <Button
          variant={state === 'on' ? 'secondary' : 'primary'}
          className="w-full"
          busy={busy}
          onClick={() => change(state === 'off')}
        >
          {state === 'on' ? 'Turn off on this phone' : 'Turn on notifications'}
        </Button>
      ) : (
        <Notice>{EXPLAIN_PUSH[state]}</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  )
}
