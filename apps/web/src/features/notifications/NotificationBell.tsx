import { NavLink } from 'react-router'
import { useUnreadCount } from './useUnreadCount'

/** Header bell linking to /notifications, with a badge for unread ones. */
export function NotificationBell() {
  const { count } = useUnreadCount()
  const unread = count ?? 0
  const label = unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`

  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        'relative inline-flex size-10 items-center justify-center rounded-xl transition-colors ' +
        'hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand-ink ' +
        (isActive ? 'text-brand-ink' : 'text-ink')
      }
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.5 6.5 2.5 7.5h-17C4.5 15.5 6 13.5 6 9z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] leading-4 font-semibold text-on-attention tabular-nums">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  )
}
