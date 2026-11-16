import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { FullScreenLoader } from '@/components/feedback/full-screen-loader'

export function RootLayout() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Outlet />
    </Suspense>
  )
}
