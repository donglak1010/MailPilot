import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'
import { ConfigError } from '@/components/feedback/config-error'
import { envResult } from '@/lib/env'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    {envResult.success ? (
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    ) : (
      <ConfigError />
    )}
  </StrictMode>,
)
