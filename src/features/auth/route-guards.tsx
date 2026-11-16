import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { FullScreenLoader } from '@/components/feedback/full-screen-loader'
import { useAuth } from './auth-context'
import { safeNextPath } from './safe-redirect'

/** Only signed-in users; others go to /login?next=<current path>. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Login/signup pages: signed-in users are sent into the app. */
export function PublicOnly() {
  const { session, loading, recovery } = useAuth()
  const [params] = useSearchParams()

  if (loading) return <FullScreenLoader />
  if (session && !recovery) return <Navigate to={safeNextPath(params.get('next'))} replace />
  return <Outlet />
}
