import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { NotFound } from '@/components/feedback/not-found'
import { RouteError } from '@/components/feedback/route-error'
import { AppShell } from '@/components/layout/app-shell'

const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'))
const ContactsPage = lazy(() => import('@/features/contacts/contacts-page'))
const CampaignsPage = lazy(() => import('@/features/campaigns/campaigns-page'))
const SequencesPage = lazy(() => import('@/features/sequences/sequences-page'))
const TemplatesPage = lazy(() => import('@/features/templates/templates-page'))
const AiWriterPage = lazy(() => import('@/features/ai-writer/ai-writer-page'))
const SenderDomainsPage = lazy(() => import('@/features/sender-domains/sender-domains-page'))
const ReportsPage = lazy(() => import('@/features/analytics/reports-page'))
const SettingsPage = lazy(() => import('@/features/settings/settings-page'))

// Auth routes (/login, /signup, /reset-password) and the route guard arrive in Phase 1.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'contacts', element: <ContactsPage /> },
          { path: 'campaigns', element: <CampaignsPage /> },
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
])
