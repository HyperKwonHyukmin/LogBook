import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ToastProvider } from '../ui/Toast.jsx';
import SideNav from './SideNav.jsx';
import TopBar from './TopBar.jsx';
import { DisconnectedBanner, useStorageStatus } from './ConnectionStatus.jsx';
import GlobalDrop from './GlobalDrop.jsx';
import { CompareBar, CompareBasketProvider } from '../compare/CompareBasket.jsx';

/** 네이비 크롬(상단 바 + 사이드 내비, 한 면) 안에 흰 작업면 한 장을 끼운 구성. 비교 바구니(07)는 셸 전체에서 하나. */
export default function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const storage = useStorageStatus();
  return (
    <ToastProvider>
      <CompareBasketProvider>
        <GlobalDrop storage={storage} />
        <div className="flex h-full flex-col bg-navy-900">
          <TopBar user={user} onLogout={async () => { await logout(); navigate('/login'); }} />
          <DisconnectedBanner storage={storage} />
          <div className="flex min-h-0 flex-1">
            <SideNav isAdmin={isAdmin} storage={storage} />
            <main className="min-w-0 flex-1 overflow-auto rounded-tl-xl bg-n-0">
              <Outlet context={{ storage }} />
            </main>
          </div>
        </div>
        {/* 비교 바구니 띠(07) — 토스트 자리 위에 뜬다 */}
        <CompareBar />
      </CompareBasketProvider>
    </ToastProvider>
  );
}
