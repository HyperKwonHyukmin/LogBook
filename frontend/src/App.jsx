import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './components/shell/AppShell.jsx';
import SectionTabs from './components/shell/SectionTabs.jsx';
import LoginPage from './pages/LoginPage.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import EntryPage from './pages/EntryPage.jsx';
import HullPage from './pages/HullPage.jsx';
import PersonPage from './pages/PersonPage.jsx';
import TargetsPage from './pages/TargetsPage.jsx';
import TargetPage from './pages/TargetPage.jsx';
import HullsPage from './pages/HullsPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import RecentComparesPage from './pages/RecentComparesPage.jsx';
import CommentsPage from './pages/CommentsPage.jsx';
import NotesPage from './pages/NotesPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ReportsPage, { ReportSearchRedirect } from './pages/ReportsPage.jsx';
import TagsPage from './pages/TagsPage.jsx';
import TrashPage from './pages/TrashPage.jsx';
import CleanupPage from './pages/admin/CleanupPage.jsx';
import EntryTablePage from './pages/admin/EntryTablePage.jsx';
import StatsPage from './pages/admin/StatsPage.jsx';
import OpsPage from './pages/admin/OpsPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import VocabPage from './pages/admin/VocabPage.jsx';
import WbRulesPage from './pages/admin/WbRulesPage.jsx';
import UpdatesPage from './pages/admin/UpdatesPage.jsx';
import UpdateNotesAdminPage from './pages/admin/UpdateNotesAdminPage.jsx';
import AuditLogPage from './pages/admin/AuditLogPage.jsx';
import UpdateNotesPage from './pages/UpdateNotesPage.jsx';
import ViewerPage from './pages/ViewerPage.jsx';

// 비교 화면(07)은 뷰어 상태·표 묶음이 커서 따로 묶는다.
const ComparePage = lazy(() => import('./pages/ComparePage.jsx'));
// 25 — 관계 지도는 d3(힘 배치·확대)를 쓰므로 따로 묶는다.
const GraphPage = lazy(() => import('./pages/GraphPage.jsx'));
// 26 갖춤 현황 · 27 선례 찾기 — 메뉴로만 들어오는 화면이라 따로 묶는다.
const CoveragePage = lazy(() => import('./pages/CoveragePage.jsx'));
const SimilarPage = lazy(() => import('./pages/SimilarPage.jsx'));
// 73 — 선박 지도(three.js 장면은 화면 안에서 다시 따로 받는다)
const ShipMapPage = lazy(() => import('./pages/ShipMapPage.jsx'));

const EXPLORE_TABS = [{ to: '/graph', label: '관계 지도' }, { to: '/coverage', label: '갖춤 현황' }, { to: '/ship-map', label: '선박 지도' }];
const ADMIN_TABS = [
  { to: '/admin/users', label: '사용자' }, { to: '/admin/ops', label: '운영' }, { to: '/admin/log', label: '활동 로그' },
  { to: '/admin/vocab', label: '분류 목록' }, { to: '/admin/wb-targets', label: 'WorkBench 연결 규칙' },
  { to: '/admin/stats', label: '자료 현황' }, { to: '/admin/entries', label: '자료 목록' },
  { to: '/admin/cleanup', label: '자료 정비' }, { to: '/admin/updates', label: '업데이트 이력' },
  { to: '/admin/update-notes', label: '업데이트 안내' },
];

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
            <Route path="targets" element={<TargetsPage />} />   {/* 69 — 업무별 모음 */}
            <Route path="t/:value" element={<TargetPage />} />
            <Route path="p/:personKey" element={<PersonPage />} />   {/* 67 — 담당자 프로필 카드 */}
            <Route path="v/:fileId" element={<ViewerPage />} />
            <Route path="compare" element={<Suspense fallback={null}><ComparePage /></Suspense>} />
            {/* 11 — 최근 비교(사용자별) */}
            <Route path="compares" element={<RecentComparesPage />} />
            {/* 63 — 새 의견(계정 메뉴) */}
            <Route path="comments" element={<CommentsPage />} />
            {/* 64 — 나의 메모(왼쪽 메뉴) */}
            <Route path="notes" element={<NotesPage />} />
            {/* 70 — 업데이트 안내(누구나 읽음, 주소가 공유 링크) */}
            <Route path="update-notes" element={<UpdateNotesPage />} />
            <Route path="update-notes/:noteId" element={<UpdateNotesPage />} />
            {/* 살펴보기 — 갖춤 현황·관계 지도를 메뉴 하나 아래 탭으로(2026-11-05) */}
            <Route element={<SectionTabs label="자료 현황" items={EXPLORE_TABS} />}>
              <Route path="coverage" element={<Suspense fallback={null}><CoveragePage /></Suspense>} />
              <Route path="graph" element={<Suspense fallback={null}><GraphPage /></Suspense>} />
              <Route path="ship-map" element={<Suspense fallback={null}><ShipMapPage /></Suspense>} />
            </Route>
            <Route path="similar" element={<Suspense fallback={null}><SimilarPage /></Suspense>} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="browse" element={<BrowsePage />} />
            {/* 09 — '태그' 메뉴는 '분류'(속성별 값)로 바뀌었다. 옛 주소는 분류의 태그 탭으로, 자유 태그 동의어는 하위 화면 */}
            <Route path="tags" element={<Navigate to="/browse?by=tag" replace />} />
            <Route path="tags/manage" element={<TagsPage />} />
            <Route path="trash" element={<TrashPage />} />
            {/* 2026-11-24 — 활동 로그는 관리 아래로(관리자만). 옛 주소 /log 는 넘긴다(관리자 아니면 검색으로) */}
            <Route path="log" element={<Navigate to="/admin/log" replace />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="admin" element={<Navigate to="/admin/users" replace />} />
              {/* 관리 6화면 — 사이드 메뉴 '관리' 하나 아래 탭으로(2026-11-05) */}
              <Route element={<SectionTabs label="관리" items={ADMIN_TABS} contained />}>
                <Route path="admin/users" element={<UsersPage />} />
                <Route path="admin/ops" element={<OpsPage />} />
                <Route path="admin/log" element={<AuditLogPage />} />
                <Route path="admin/vocab" element={<VocabPage />} />
                <Route path="admin/wb-targets" element={<WbRulesPage />} />
                <Route path="admin/stats" element={<StatsPage />} />   {/* 57 — 자료 현황 */}
                <Route path="admin/entries" element={<EntryTablePage />} />   {/* 57 — 자료 목록 */}
                <Route path="admin/cleanup" element={<CleanupPage />} />
                <Route path="admin/updates" element={<UpdatesPage />} />   {/* 46 — 업데이트 이력(옛 /updates 는 서버가 넘긴다) */}
                <Route path="admin/update-notes" element={<UpdateNotesAdminPage />} />   {/* 70 — 업데이트 안내와 공유 주소 */}
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
