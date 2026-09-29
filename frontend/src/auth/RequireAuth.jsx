import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

/** 로그인이 필요한 구간. adminOnly 면 관리자만. */
export default function RequireAuth({ adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
