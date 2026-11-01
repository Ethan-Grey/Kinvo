import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { signOut } from '../../data/auth'
import { ThemeToggle } from '../../shared/ThemeToggle'
import { Button, Logo } from '../../shared/ui'

/** Header, page frame and bottom tab bar for signed-in screens. */
export function AppLayout() {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="size-7" />
            Kinvo
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" onClick={handleSignOut} busy={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Bottom padding keeps content clear of the tab bar and the iPhone home bar. */}
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      <TabBar />
    </div>
  )
}

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-3">
        <Tab to="/" end label="Home" icon={<HomeIcon />} />
        <Tab to="/loans" label="Loans" icon={<LoansIcon />} />
        <Tab to="/people" label="People" icon={<PeopleIcon />} />
      </div>
    </nav>
  )
}

function Tab({ to, label, icon, end = false }: { to: string; label: string; icon: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ' +
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ink ' +
        (isActive ? 'text-brand-ink' : 'text-ink-muted hover:text-ink')
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  className: 'size-6',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}

function LoansIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
    </svg>
  )
}
