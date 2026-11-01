import { useState } from 'react'
import { Link, Outlet } from 'react-router'
import { signOut } from '../../data/auth'
import { Button, Logo } from '../../shared/ui'

/** Header and page frame for signed-in screens. */
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
          <Button variant="ghost" onClick={handleSignOut} busy={signingOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
