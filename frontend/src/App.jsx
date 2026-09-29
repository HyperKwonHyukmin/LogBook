import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './components/shell/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import TrashPage from './pages/TrashPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<PlaceholderPage kind="search" />} />
            <Route path="hulls" element={<PlaceholderPage kind="hulls" />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="tags" element={<PlaceholderPage kind="tags" />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="log" element={<AuditLogPage />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="admin/users" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
