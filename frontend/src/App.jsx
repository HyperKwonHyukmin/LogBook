import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './components/shell/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import EntryPage from './pages/EntryPage.jsx';
import HullPage from './pages/HullPage.jsx';
import HullsPage from './pages/HullsPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import RecentComparesPage from './pages/RecentComparesPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ReportsPage, { ReportSearchRedirect } from './pages/ReportsPage.jsx';
import TagsPage from './pages/TagsPage.jsx';
import TrashPage from './pages/TrashPage.jsx';
import CleanupPage from './pages/admin/CleanupPage.jsx';
import OpsPage from './pages/admin/OpsPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import VocabPage from './pages/admin/VocabPage.jsx';
import WbRulesPage from './pages/admin/WbRulesPage.jsx';
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
            <Route path="reports" element={<ReportsPage />} />
            {/* 22 — 예전 '보고서 본문 검색' 메뉴. 보고서 화면으로 합쳤다(질의를 그대로 들고 옮겨 간다) */}
            <Route path="report-search" element={<ReportSearchRedirect />} />
            <Route path="hulls" element={<HullsPage />} />
            <Route path="h/:hullNo" element={<HullPage />} />
            <Route path="e/:entryId" element={<EntryPage />} />
            <Route path="v/:fileId" element={<ViewerPage />} />
            <Route path="compare" element={<Suspense fallback={null}><ComparePage /></Suspense>} />
            {/* 11 — 최근 비교(사용자별) */}
            <Route path="compares" element={<RecentComparesPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="browse" element={<BrowsePage />} />
            {/* 09 — '태그' 메뉴는 '분류'(속성별 값)로 바뀌었다. 옛 주소는 분류의 태그 탭으로, 자유 태그 동의어는 하위 화면 */}
            <Route path="tags" element={<Navigate to="/browse?by=tag" replace />} />
            <Route path="tags/manage" element={<TagsPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="log" element={<AuditLogPage />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="admin/users" element={<UsersPage />} />
              <Route path="admin/ops" element={<OpsPage />} />
              <Route path="admin/vocab" element={<VocabPage />} />
              <Route path="admin/wb-targets" element={<WbRulesPage />} />
              <Route path="admin/cleanup" element={<CleanupPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
