import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom';
import { AuthProvider } from '../src/auth/AuthContext.jsx';
import { tokenStore } from '../src/api/client.js';
import GraphPage from '../src/pages/GraphPage.jsx';
import CoveragePage from '../src/pages/CoveragePage.jsx';
import SimilarPage from '../src/pages/SimilarPage.jsx';
import DemoShell, { DemoMissing } from './DemoShell.jsx';
import { installMockApi } from './mockApi.js';
import '../src/index.css';

// 파일 하나로 열리는 데모(file://) — 주소는 # 뒤(#/graph · #/coverage · #/similar)로 바꾼다.
installMockApi();
try { tokenStore.set('demo'); } catch { /* 저장소가 막혀도 화면은 그린다(AuthProvider 가 /auth/me 를 묻지 않을 뿐) */ }

const router = createHashRouter([{
  path: '/',
  element: <AuthProvider><Suspense fallback={null}><DemoShell /></Suspense></AuthProvider>,
  children: [
    { index: true, element: <Navigate to="/graph" replace /> },
    { path: 'graph', element: <GraphPage /> },
    { path: 'coverage', element: <CoveragePage /> },
    { path: 'similar', element: <SimilarPage /> },
    { path: '*', element: <DemoMissing /> },
  ],
}]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
