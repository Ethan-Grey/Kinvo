import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthCallbackPage } from './features/auth/AuthCallbackPage'
import { AuthProvider } from './features/auth/AuthProvider'
import { RequireAuth } from './features/auth/RequireAuth'
import { SignInPage } from './features/auth/SignInPage'
import { AcceptInvitePage } from './features/invites/AcceptInvitePage'
import { HomePage } from './features/people/HomePage'
import { AppLayout } from './features/shell/AppLayout'
import { RouteErrorScreen } from './shared/ErrorScreens'

const router = createBrowserRouter([
  {
    // Shared error page for every route, including unknown URLs (404).
    errorElement: <RouteErrorScreen />,
    children: [
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
    ],
  },
])

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
