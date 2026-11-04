import { createBrowserRouter, RouterProvider } from 'react-router'
import { AccountPage } from './features/account/AccountPage'
import { SplitBillPage } from './features/bills/SplitBillPage'
import { BillDuePage, BillPage, NewBillPage } from './features/households/BillPages'
import { HouseholdPage } from './features/households/HouseholdPage'
import { HouseholdSettingsPage, SettlePage } from './features/households/HouseholdSettings'
import { HouseholdInvitePage, HouseholdsPage, NewHouseholdPage } from './features/households/HouseholdsPage'
import { NewRepeatingPage } from './features/repeating/NewRepeatingPage'
import { RepeatingPage } from './features/repeating/RepeatingPage'
import { AuthCallbackPage } from './features/auth/AuthCallbackPage'
import { AuthProvider } from './features/auth/AuthProvider'
import { EmailConfirmPage } from './features/auth/EmailConfirmPage'
import { RequireAuth } from './features/auth/RequireAuth'
import { SignInPage } from './features/auth/SignInPage'
import { AcceptInvitePage } from './features/invites/AcceptInvitePage'
import { HomePage } from './features/dashboard/HomePage'
import { ChangeSchedulePage } from './features/loans/ChangeSchedulePage'
import { LoanDetailPage } from './features/loans/LoanDetailPage'
import {
  AcceptLoanPage,
  ChangeTermsPage,
  FundsSentPage,
  RecordPaymentPage,
  RemoveLoanPage,
} from './features/loans/LoanStepPages'
import { LoansPage } from './features/loans/LoansPage'
import { NewLoanPage } from './features/loans/NewLoanPage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { PeoplePage } from './features/people/PeoplePage'
import { PersonPage } from './features/people/PersonPage'
import { RemindersPage } from './features/people/RemindersPage'
import { AppLayout } from './features/shell/AppLayout'
import { RouteErrorScreen } from './shared/ErrorScreens'

const router = createBrowserRouter([
  {
    // Shared error page for every route, including unknown URLs (404).
    errorElement: <RouteErrorScreen />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/auth/confirm', element: <EmailConfirmPage /> },
      {
        // Everything below requires a signed-in user.
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'invite/:token', element: <AcceptInvitePage /> },
              { path: 'loans', element: <LoansPage /> },
              { path: 'loans/new', element: <NewLoanPage /> },
              { path: 'people', element: <PeoplePage /> },
              { path: 'notifications', element: <NotificationsPage /> },
              { path: 'account', element: <AccountPage /> },
              { path: 'loans/:id', element: <LoanDetailPage /> },
              { path: 'loans/:id/accept', element: <AcceptLoanPage /> },
              { path: 'loans/:id/change', element: <ChangeTermsPage /> },
              { path: 'loans/:id/sent', element: <FundsSentPage /> },
              { path: 'loans/:id/pay', element: <RecordPaymentPage /> },
              { path: 'loans/:id/remove', element: <RemoveLoanPage /> },
              { path: 'loans/:id/schedule', element: <ChangeSchedulePage /> },
              { path: 'people/:relationshipId', element: <PersonPage /> },
              { path: 'bills/new', element: <SplitBillPage /> },
              { path: 'households', element: <HouseholdsPage /> },
              { path: 'households/new', element: <NewHouseholdPage /> },
              { path: 'households/:id', element: <HouseholdPage /> },
              { path: 'households/:id/settings', element: <HouseholdSettingsPage /> },
              { path: 'households/:id/bills/new', element: <NewBillPage /> },
              { path: 'households/:id/bills/due/:occurrenceId', element: <BillDuePage /> },
              { path: 'households/:id/bills/:billId', element: <BillPage /> },
              { path: 'households/:id/settle/:userId', element: <SettlePage /> },
              { path: 'household-invite/:token', element: <HouseholdInvitePage /> },
              { path: 'repeating/new', element: <NewRepeatingPage /> },
              { path: 'repeating/:id', element: <RepeatingPage /> },
              { path: 'people/:relationshipId/reminders', element: <RemindersPage /> },
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
