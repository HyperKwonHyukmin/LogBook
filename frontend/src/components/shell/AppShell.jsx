import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import SideNav from './SideNav.jsx';
import TopBar from './TopBar.jsx';
import { DisconnectedBanner, useStorageStatus } from './ConnectionStatus.jsx';

export default function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const storage = useStorageStatus();
  return (
    <div className="flex h-full flex-col">
      <TopBar user={user} onLogout={async () => { await logout(); navigate('/login'); }} />
      <DisconnectedBanner storage={storage} />
      <div className="flex min-h-0 flex-1">
        <SideNav isAdmin={isAdmin} storage={storage} />
        <main className="min-w-0 flex-1 overflow-auto"><Outlet context={{ storage }} /></main>
      </div>
    </div>
  );
}
