import { createBrowserRouter, Link, RouterProvider } from 'react-router'
import { AuthCallbackPage } from './features/auth/AuthCallbackPage'
import { AuthProvider } from './features/auth/AuthProvider'
import { RequireAuth } from './features/auth/RequireAuth'
import { SignInPage } from './features/auth/SignInPage'
import { AcceptInvitePage } from './features/invites/AcceptInvitePage'
import { HomePage } from './features/people/HomePage'
import { AppLayout } from './features/shell/AppLayout'
import { Card } from './shared/ui'

const router = createBrowserRouter([
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  {
    // Everything below requires a signed-in user.
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'invite/:token', element: <AcceptInvitePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
])

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4">
      <Card className="space-y-2">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <Link to="/" className="text-sm font-medium text-brand underline">
          Go home
        </Link>
      </Card>
    </main>
  )
}
