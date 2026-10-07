import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './components/shell/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import EntryPage from './pages/EntryPage.jsx';
import HullPage from './pages/HullPage.jsx';
import HullsPage from './pages/HullsPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import TagsPage from './pages/TagsPage.jsx';
import TrashPage from './pages/TrashPage.jsx';
import OpsPage from './pages/admin/OpsPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import VocabPage from './pages/admin/VocabPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

// 비교 화면(07)은 뷰어 상태·표 묶음이 커서 따로 묶는다.
const ComparePage = lazy(() => import('./pages/ComparePage.jsx'));

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<SearchPage />} />
            <Route path="hulls" element={<HullsPage />} />
            <Route path="h/:hullNo" element={<HullPage />} />
            <Route path="e/:entryId" element={<EntryPage />} />
            <Route path="v/:fileId" element={<ViewerPage />} />
            <Route path="compare" element={<Suspense fallback={null}><ComparePage /></Suspense>} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="log" element={<AuditLogPage />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="admin/users" element={<UsersPage />} />
              <Route path="admin/ops" element={<OpsPage />} />
              <Route path="admin/vocab" element={<VocabPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
