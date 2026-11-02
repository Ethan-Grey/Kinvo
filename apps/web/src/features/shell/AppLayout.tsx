import { useEffect, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { BellIcon, HomeIcon, LoansIcon, UserIcon } from '../../shared/icons'
import { UnreadCountProvider } from '../notifications/UnreadCountProvider'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { LiveUpdates } from './LiveUpdates'
import { NameGate } from './NameGate'
import { pageTitle } from './pageTitle'
import { PullToRefresh } from './PullToRefresh'
import { QuickActionsButton } from './QuickActions'

/**
 * Page frame and bottom tab bar for signed-in screens. There's no top bar:
 * each screen starts with its own PageHeader, which leaves more room on phones.
 */
export function AppLayout() {
  usePageTitle()
  useScrollToTopOnNavigate()

  return (
    <LiveUpdates>
      <UnreadCountProvider>
        <PullToRefresh />
        <NameGate>
          <div className="min-h-svh">
            {/* First thing keyboard and screen reader users reach (WCAG 2.4.1). */}
            <a
              href="#main"
              className="sr-only z-30 rounded-xl bg-surface px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-2 focus:outline-brand-ink"
            >
              Skip to content
            </a>

            {/* Bottom padding keeps content clear of the tab bar and the iPhone home bar. */}
            <main
              id="main"
              tabIndex={-1}
              className="mx-auto max-w-2xl px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none"
            >
              <Outlet />
            </main>

            <TabBar />
          </div>
        </NameGate>
      </UnreadCountProvider>
    </LiveUpdates>
  )
}

function TabBar() {
  const { count } = useUnreadCount()
  const unread = count ?? 0

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 items-start">
        <Tab to="/" end label="Home" icon={<HomeIcon className="size-6" />} />
        <Tab to="/loans" label="Loans" icon={<LoansIcon className="size-6" />} />
        <div className="flex justify-center">
          <QuickActionsButton />
        </div>
        <Tab
          to="/notifications"
          label="Alerts"
          extra={unread > 0 ? <span className="sr-only">, {unread} unread</span> : null}
          icon={
            <span className="relative">
              <BellIcon className="size-6" />
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-2 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-on-danger tabular-nums"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
          }
        />
        <Tab to="/account" label="Account" icon={<UserIcon className="size-6" />} />
      </div>
    </nav>
  )
}

function Tab({
  to,
  label,
  extra,
  icon,
  end = false,
}: {
  to: string
  label: string
  /** Extra text for screen readers, e.g. the unread count. */
  extra?: ReactNode
  icon: ReactNode
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ' +
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ink ' +
        (isActive ? 'text-brand-ink' : 'text-ink-muted hover:text-ink')
      }
    >
      {icon}
      <span>
        {label}
        {extra}
      </span>
    </NavLink>
  )
}

function usePageTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = pageTitle(pathname)
  }, [pathname])
}

/** A new screen starts at the top, like a native app, unless it's jumping to a section. */
function useScrollToTopOnNavigate() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
}
