import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ToastProvider } from '../ui/Toast.jsx';
import SideNav from './SideNav.jsx';
import TopBar from './TopBar.jsx';
import { DisconnectedBanner, useStorageStatus } from './ConnectionStatus.jsx';

/** 크롬(n-50) 안에 흰 작업면 한 장을 끼운 구성. */
export default function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const storage = useStorageStatus();
  return (
    <ToastProvider>
      <div className="flex h-full flex-col bg-n-50">
        <TopBar user={user} onLogout={async () => { await logout(); navigate('/login'); }} />
        <DisconnectedBanner storage={storage} />
        <div className="flex min-h-0 flex-1">
          <SideNav isAdmin={isAdmin} storage={storage} />
          <main className="min-w-0 flex-1 overflow-auto rounded-tl-lg border-l border-t border-n-200 bg-n-0">
            <Outlet context={{ storage }} />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
