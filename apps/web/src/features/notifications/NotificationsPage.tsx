import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  clearNotifications,
  listNotifications,
  markRead,
  timeAgo,
  type AppNotification,
} from '../../data/notifications'
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  DocumentIcon,
  HandIcon,
  HeartIcon,
  HomeIcon,
  PaymentIcon,
  RepeatIcon,
  SendIcon,
  SplitIcon,
} from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Button, EmptyState, IconBubble, Notice, PageHeader, PageSkeleton } from '../../shared/ui'
import { useUnreadCount } from './useUnreadCount'

type Tone = 'brand' | 'soft' | 'attention' | 'positive' | 'danger' | 'neutral'

/** What each kind of notification looks like: an icon and a colour that says how urgent it is. */
const KINDS: Record<string, { icon: ReactNode; tone: Tone }> = {
  loan_requested: { icon: <HandIcon />, tone: 'attention' },
  loan_offered: { icon: <DocumentIcon />, tone: 'attention' },
  counter_offer: { icon: <DocumentIcon />, tone: 'attention' },
  terms_accepted: { icon: <CheckIcon />, tone: 'brand' },
  existing_debt_confirmed: { icon: <CheckIcon />, tone: 'brand' },
  loan_declined: { icon: <DocumentIcon />, tone: 'neutral' },
  loan_cancelled: { icon: <DocumentIcon />, tone: 'neutral' },
  funds_sent: { icon: <SendIcon />, tone: 'brand' },
  payment_claimed: { icon: <PaymentIcon />, tone: 'attention' },
  payment_confirmed: { icon: <CheckIcon />, tone: 'positive' },
  payment_recorded: { icon: <PaymentIcon />, tone: 'positive' },
  payment_disputed: { icon: <AlertIcon />, tone: 'danger' },
  payment_reversed: { icon: <AlertIcon />, tone: 'neutral' },
  loan_completed: { icon: <HeartIcon />, tone: 'positive' },
  loan_forgiven: { icon: <HeartIcon />, tone: 'positive' },
  due_tomorrow: { icon: <ClockIcon />, tone: 'soft' },
  due_today: { icon: <ClockIcon />, tone: 'attention' },
  overdue: { icon: <AlertIcon />, tone: 'danger' },
  borrower_overdue: { icon: <AlertIcon />, tone: 'danger' },
  loan_rescheduled: { icon: <ClockIcon />, tone: 'attention' },
  payment_moved: { icon: <AlertIcon />, tone: 'danger' },
  custom_reminder: { icon: <BellIcon />, tone: 'soft' },
  bill_shared: { icon: <SplitIcon />, tone: 'attention' },
  bill_accepted: { icon: <CheckIcon />, tone: 'brand' },
  repeating_proposed: { icon: <RepeatIcon />, tone: 'attention' },
  repeating_accepted: { icon: <CheckIcon />, tone: 'brand' },
  repeating_declined: { icon: <RepeatIcon />, tone: 'neutral' },
  repeating_changed: { icon: <RepeatIcon />, tone: 'attention' },
  repeating_created: { icon: <RepeatIcon />, tone: 'soft' },
  repeating_paused: { icon: <RepeatIcon />, tone: 'neutral' },
  repeating_active: { icon: <RepeatIcon />, tone: 'neutral' },
  repeating_stopped: { icon: <RepeatIcon />, tone: 'neutral' },
  household_joined: { icon: <HomeIcon />, tone: 'brand' },
  household_bill_amount: { icon: <DocumentIcon />, tone: 'attention' },
  household_share_due: { icon: <ClockIcon />, tone: 'attention' },
  household_settled: { icon: <CheckIcon />, tone: 'positive' },
  shared_account_short: { icon: <AlertIcon />, tone: 'danger' },
}

const FALLBACK = { icon: <BellIcon />, tone: 'soft' as Tone }

const nzDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' })

/** "Today", "Yesterday" or "Earlier", by New Zealand date. */
function dayGroup(iso: string, now: Date = new Date()): 'Today' | 'Yesterday' | 'Earlier' {
  const day = nzDay.format(new Date(iso))
  if (day === nzDay.format(now)) return 'Today'
  if (day === nzDay.format(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return 'Earlier'
}

/**
 * Everything Kinvo has told you, newest first, grouped by day. Opening the
 * page marks them read; unread ones keep their highlight until you leave.
 */
export function NotificationsPage() {
  const [state, reload] = useAsync(() => listNotifications())
  const [clearing, setClearing] = useState(false)

  async function handleClear() {
    if (!window.confirm('Clear all alerts? What’s owed and paid isn’t affected.')) return
    setClearing(true)
    try {
      await clearNotifications()
      reload()
    } finally {
      setClearing(false)
    }
  }
  const { refresh } = useUnreadCount()

  const hasUnread = state.status === 'success' && state.data.some((n) => n.readAt === null)
  useEffect(() => {
    if (!hasUnread) return
    // Best effort: if this fails they simply stay unread for next time.
    markRead().then(refresh, () => {})
  }, [hasUnread, refresh])

  if (state.status === 'loading') return <PageSkeleton label="Loading alerts" />
  if (state.status === 'error') return <Notice tone="error">{state.error.message}</Notice>

  const groups = new Map<string, AppNotification[]>()
  for (const n of state.data) {
    const key = dayGroup(n.createdAt)
    groups.set(key, [...(groups.get(key) ?? []), n])
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        action={
          state.data.length > 0 && (
            <Button variant="ghost" className="min-h-10 px-3" busy={clearing} onClick={handleClear}>
              Clear all
            </Button>
          )
        }
      />
      {state.data.length === 0 ? (
        <EmptyState icon={<BellIcon className="size-6" />} title="You’re all caught up">
          Requests, payments and due-date reminders will appear here, and by email.
        </EmptyState>
      ) : (
        [...groups.entries()].map(([day, items]) => (
          <section key={day} className="space-y-2">
            <h2 className="text-sm font-semibold text-ink-muted">{day}</h2>
            <ul className="space-y-2">
              {items.map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function NotificationRow({ notification: n }: { notification: AppNotification }) {
  const unread = n.readAt === null
  const look = KINDS[n.kind] ?? FALLBACK
  return (
    <li>
      <Link
        to={n.linkPath}
        className={
          'flex gap-3 rounded-3xl border p-3 transition hover:border-brand-ink active:scale-[0.99] ' +
          (unread ? 'border-brand' : 'border-line')
        }
      >
        <IconBubble tone={look.tone}>{look.icon}</IconBubble>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={unread ? 'font-semibold' : 'font-medium'}>
              {unread && <span className="sr-only">Unread: </span>}
              {n.title}
            </p>
            <time dateTime={n.createdAt} className="shrink-0 pt-0.5 text-xs text-ink-muted">
              {timeAgo(n.createdAt)}
            </time>
          </div>
          {n.body && <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>}
        </div>
      </Link>
    </li>
  )
}
