import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { NotFound } from '@/components/feedback/not-found'
import { RouteError } from '@/components/feedback/route-error'
import { AppShell } from '@/components/layout/app-shell'
import { RootLayout } from '@/components/layout/root-layout'
import { PublicOnly, RequireAuth } from '@/features/auth/route-guards'
import { WorkspaceProvider } from '@/features/workspaces/workspace-provider'

const LoginPage = lazy(() => import('@/features/auth/login-page'))
const SignupPage = lazy(() => import('@/features/auth/signup-page'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/forgot-password-page'))
const ResetPasswordPage = lazy(() => import('@/features/auth/reset-password-page'))

const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'))
const ContactsPage = lazy(() => import('@/features/contacts/contacts-page'))
const CampaignsPage = lazy(() => import('@/features/campaigns/campaigns-page'))
const CampaignEditorPage = lazy(() => import('@/features/campaigns/campaign-editor-page'))
const UnsubscribePage = lazy(() => import('@/features/unsubscribe/unsubscribe-page'))
const SequencesPage = lazy(() => import('@/features/sequences/sequences-page'))
const TemplatesPage = lazy(() => import('@/features/templates/templates-page'))
const AiWriterPage = lazy(() => import('@/features/ai-writer/ai-writer-page'))
const SenderDomainsPage = lazy(() => import('@/features/sender-domains/sender-domains-page'))
const ReportsPage = lazy(() => import('@/features/analytics/reports-page'))
const SettingsPage = lazy(() => import('@/features/settings/settings-page'))

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      // Public auth pages (signed-in users are redirected into the app)
      {
        element: <PublicOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignupPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Opened from the recovery email; handles its own session check
      { path: 'reset-password', element: <ResetPasswordPage /> },
      // Public, no sign-in: linked from every marketing email
      { path: 'unsubscribe', element: <UnsubscribePage /> },

      // Authenticated app
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: (
              <WorkspaceProvider>
                <AppShell />
              </WorkspaceProvider>
            ),
            children: [
              {
                errorElement: <RouteError />,
                children: [
                  { index: true, element: <DashboardPage /> },
                  { path: 'contacts', element: <ContactsPage /> },
                  { path: 'campaigns', element: <CampaignsPage /> },
                  { path: 'campaigns/:id', element: <CampaignEditorPage /> },
                  { path: 'sequences', element: <SequencesPage /> },
                  { path: 'templates', element: <TemplatesPage /> },
                  { path: 'ai-writer', element: <AiWriterPage /> },
                  { path: 'sender-domains', element: <SenderDomainsPage /> },
                  { path: 'reports', element: <ReportsPage /> },
                  { path: 'settings', element: <SettingsPage /> },
                  { path: '*', element: <NotFound /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
])
