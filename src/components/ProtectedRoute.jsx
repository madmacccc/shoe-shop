import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ allowedRoles = ['owner', 'staff'] }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        Loading secure workspace...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!allowedRoles.includes(profile?.role || 'staff')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-red-50 text-red-700">
        You do not have access to this section.
      </div>
    )
  }

  return <Outlet />
}
