import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import RootErrorPage from './pages/RootErrorPage.jsx';
import { installChunkReloadHandler } from './lib/chunkReload.js';
import './index.css';

// 데이터 라우터(11) — 저장하지 않은 변경이 있을 때 앱 안 이동을 막는 useBlocker 가 데이터 라우터에서만 동작한다.
// 화면 경로는 그대로 App 의 <Routes> 가 맡는다(모든 주소를 App 하나로 넘긴다).
// errorElement — 셸까지 무너진 그리기 오류는 React Router 의 영어 기본 화면 대신 한국어 복구 화면으로.
const router = createBrowserRouter([{ path: '*', element: <App />, errorElement: <RootErrorPage /> }]);

// 재배포 뒤 열려 있던 탭이 사라진 묶음 파일을 부르면 한 번 새로 고침한다(lib/chunkReload.js).
installChunkReloadHandler();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
