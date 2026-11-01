import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { acceptInvite, previewInvite } from '../../data/invites'
import { messageFor } from '../../data/errors'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, Spinner } from '../../shared/ui'

/**
 * /invite/:token — shown after sign-in. Tells the borrower who invited them
 * and asks them to confirm before linking the accounts.
 */
export function AcceptInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [preview] = useAsync(() => previewInvite(token), token)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      await acceptInvite(token)
      navigate('/', { replace: true, state: { joined: true } })
    } catch (err) {
      setError((err as Error).message)
      setAccepting(false)
    }
  }

  if (preview.status === 'loading') return <Spinner label="Checking your invite…" />
  if (preview.status === 'error') return <Notice tone="error">{preview.error.message}</Notice>

  const { status, lenderName } = preview.data

  if (status !== 'valid') {
    const code = status === 'own_invite' ? 'invite_own' : status === 'not_found' ? 'invite_not_found' : `invite_${status}`
    return (
      <Card className="space-y-4">
        <Notice tone="error">{messageFor(code)}</Notice>
        <Link to="/" className="text-sm font-medium text-brand underline">
          Go to your dashboard
        </Link>
      </Card>
    )
  }

  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{lenderName} invited you to Kinvo</h1>
      <p className="text-sm text-ink-muted">
        Accepting lets you request loans from {lenderName} and see the loans between you. {lenderName}{' '}
        will see your name and email. Nobody else can see your records.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={handleAccept} busy={accepting} className="w-full">
        Accept invite
      </Button>
    </Card>
  )
}
