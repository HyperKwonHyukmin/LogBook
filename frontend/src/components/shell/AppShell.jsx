import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ToastProvider } from '../ui/Toast.jsx';
import SideNav from './SideNav.jsx';
import TopBar from './TopBar.jsx';
import { DisconnectedBanner, useStorageStatus } from './ConnectionStatus.jsx';
import GlobalDrop from './GlobalDrop.jsx';
import { UploadProvider } from '../inbox/UploadProvider.jsx';
import { ErrorBoundary, RecoveryPanel } from '../ui/ErrorBoundary.jsx';
import { WorkbenchPickBanner } from '../workbench/WorkbenchSend.jsx';
import { CompareBar, CompareBasketProvider } from '../compare/CompareBasket.jsx';
import { FavoritesProvider } from '../favorites/Favorites.jsx';
import usePrefsSync from '../../lib/usePrefsSync.js';
import { flushPrefs, resetPrefs } from '../../lib/prefs.js';

/**
 * 네이비 크롬(상단 바 + 사이드 내비, 한 면) 안에 흰 작업면 한 장을 끼운 구성. 비교 바구니(07)는 셸 전체에서 하나.
 * 올리기 저장소(UploadProvider)도 셸에 하나 — 화면을 옮겨도 올리기가 이어지고 GlobalDrop 이 진행률을 띄운다.
 * 작업면은 오류 경계로 감싼다 — 한 화면이 터져도 크롬(내비·상단 바)은 살아 있고, 다른 주소로 가면 경계가 풀린다.
 */
export default function AppShell() {
  const { user, isAdmin, canWrite, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const storage = useStorageStatus();
  usePrefsSync(user?.employee_id); // 10 — 사용자 설정(미리보기 폭 등)을 서버에서 받아 온다
  async function onLogout() {
    await flushPrefs();   // 보내지 못한 설정 변경을 먼저 보낸다(토큰이 지워지기 전에)
    resetPrefs();
    await logout();
    navigate('/login');
  }
  return (
    <ToastProvider>
      <UploadProvider>
        <FavoritesProvider>
          <CompareBasketProvider>
            {/* 13 — Guest 는 끌어 놓아도 올리지 않고 이유만 알린다 */}
            <GlobalDrop storage={storage} readOnly={!canWrite} />
            <div className="flex h-full flex-col bg-navy-900">
              <TopBar user={user} onLogout={onLogout} />
              <DisconnectedBanner storage={storage} />
              {/* 18 — WorkBench 가 연 창의 선택 모드 띠(GMU 작업 N · Truss 에 보낼 BDF 고르기) */}
              <WorkbenchPickBanner />
              <div className="flex min-h-0 flex-1">
                <SideNav isAdmin={isAdmin} storage={storage} />
                <main className="min-w-0 flex-1 overflow-auto rounded-tl-xl bg-n-0">
                  <ErrorBoundary resetKey={location.pathname + location.search}
                                 fallback={(error, reset) => (
                                   <RecoveryPanel error={error} onRetry={reset} showDetail={isAdmin || import.meta.env.DEV} />
                                 )}>
                    <Outlet context={{ storage }} />
                  </ErrorBoundary>
                </main>
              </div>
            </div>
            {/* 비교 바구니 띠(07) — 토스트 자리 위에 뜬다 */}
            <CompareBar />
          </CompareBasketProvider>
        </FavoritesProvider>
      </UploadProvider>
    </ToastProvider>
  );
}
