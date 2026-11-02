import { useEffect } from 'react'
import { Link } from 'react-router'
import { listNotifications, markRead, timeAgo, type AppNotification } from '../../data/notifications'
import { useAsync } from '../../shared/useAsync'
import { Card, Notice, Spinner } from '../../shared/ui'
import { useUnreadCount } from './useUnreadCount'

/**
 * Everything Kinvo has told you, newest first. Opening the page marks them
 * read; unread ones keep their highlight until you leave.
 */
export function NotificationsPage() {
  const [state] = useAsync(() => listNotifications())
  const { refresh } = useUnreadCount()

  const hasUnread = state.status === 'success' && state.data.some((n) => n.readAt === null)
  useEffect(() => {
    if (!hasUnread) return
    // Best effort: if this fails they simply stay unread for next time.
    markRead().then(refresh, () => {})
  }, [hasUnread, refresh])

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      {state.status === 'loading' && <Spinner label="Loading…" />}
      {state.status === 'error' && <Notice tone="error">{state.error.message}</Notice>}
      {state.status === 'success' &&
        (state.data.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">
              Nothing yet. You'll hear here (and by email) about loan requests, payments and due dates.
            </p>
          </Card>
        ) : (
          <Card>
            <ul className="-my-3 divide-y divide-line">
              {state.data.map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))}
            </ul>
          </Card>
        ))}
    </div>
  )
}

function NotificationRow({ notification: n }: { notification: AppNotification }) {
  const unread = n.readAt === null
  return (
    <li>
      <Link to={n.linkPath} className="flex gap-3 py-3 hover:opacity-80">
        <span
          aria-hidden
          className={'mt-1.5 size-2 shrink-0 rounded-full ' + (unread ? 'bg-brand' : 'bg-transparent')}
        />
        <div className="min-w-0 flex-1">
          <p className={unread ? 'font-semibold' : 'font-medium'}>
            {unread && <span className="sr-only">Unread: </span>}
            {n.title}
          </p>
          {n.body && <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
          </p>
        </div>
      </Link>
    </li>
  )
}
