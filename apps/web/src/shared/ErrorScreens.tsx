import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button, Card, Logo } from './ui'

function ErrorLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Logo className="size-10" />
      <Card className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </Card>
    </main>
  )
}

function ReloadButton() {
  return (
    <Button variant="secondary" onClick={() => window.location.reload()}>
      Reload
    </Button>
  )
}

/** Shown instead of the app when the deploy is missing its Supabase settings. */
export function ConfigErrorScreen() {
  return (
    <ErrorLayout title="Kinvo isn’t set up yet">
      <p className="text-sm text-ink-muted">
        This deployment was built without its database settings. If you run this app, add{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to the hosting
        environment, then rebuild. See <code>docs/setup.md</code>.
      </p>
    </ErrorLayout>
  )
}

/** Route-level error page, used by the router for errors while rendering a screen. */
export function RouteErrorScreen() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorLayout title="Page not found">
        <a href="/" className="text-sm font-medium text-brand underline">
          Go home
        </a>
      </ErrorLayout>
    )
  }
  console.error(error)
  return (
    <ErrorLayout title="Something went wrong">
      <p className="text-sm text-ink-muted">Reload the page to try again. Your data hasn’t been changed.</p>
      <ReloadButton />
    </ErrorLayout>
  )
}

interface BoundaryState {
  failed: boolean
}

/**
 * Last line of defence: catches any error that escapes the router so the user
 * sees a message instead of a blank white page.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorLayout title="Something went wrong">
          <p className="text-sm text-ink-muted">Reload the page to try again. Your data hasn’t been changed.</p>
          <ReloadButton />
        </ErrorLayout>
      )
    }
    return this.props.children
  }
}
