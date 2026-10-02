import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import { ViewerEngineContext } from '../components/viewer/ViewerEngineContext.js';
import ViewerPage from './ViewerPage.jsx';

const META = { id: 7, name: 'main.bdf', rel_path: 'model/main.bdf', kind: 'model', size: 10,
  entry_id: 'E000003', entry_title: '계류 검토', entry_status: 'confirmed', drm_encrypted: false };

function renderAt(map) {
  const fetch = mockApi(map);
  render(
    <ViewerEngineContext.Provider value={async () => ({ setModel() {}, dispose() {} })}>
      <MemoryRouter initialEntries={['/v/7']}><Routes><Route path="/v/:fileId" element={<ViewerPage />} /></Routes></MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
  return fetch;
}

test('파일 이름과 소속 자료 링크', async () => {
  renderAt({
    'GET /api/files/7': META,
    'GET /api/files/7/model': { state: 'done', has_lbm: true, key: 'k' },
    'GET /api/files/7/model.lbm': { __status: 404, detail: 'model_not_ready' },
  });
  expect(await screen.findByRole('heading', { name: 'main.bdf' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /E000003/ })).toHaveAttribute('href', '/e/E000003?file=7');
});

test('모델이 아닌 파일', async () => {
  renderAt({ 'GET /api/files/7': { id: 7, name: 'r.pdf', rel_path: 'r.pdf', kind: 'report', size: 1,
                                    entry_id: 'E1', entry_title: 't', entry_status: 'confirmed' } });
  expect(await screen.findByText('3D 로 볼 수 있는 모델 파일이 아닙니다')).toBeInTheDocument();
});

test('볼 수 없는 변환 상태는 미리보기와 같은 안내를 보이고 뷰어를 띄우지 않는다', async () => {
  const fetch = renderAt({ 'GET /api/files/7': META, 'GET /api/files/7/model': { state: 'include', has_lbm: false } });
  expect(await screen.findByText(/다른 BDF 가 INCLUDE/)).toBeInTheDocument();
  expect(calls(fetch)).not.toContain('GET /api/files/7/model.lbm');
});

test('실패 원문은 툴팁으로만', async () => {
  renderAt({ 'GET /api/files/7': META, 'GET /api/files/7/model': { state: 'failed', error: 'KeyError: 3', has_lbm: false } });
  expect(await screen.findByText('3D 로 바꾸지 못했습니다. 관리자에게 알려 주세요.')).toHaveAttribute('title', 'KeyError: 3');
});

test('DRM 파일은 막는다', async () => {
  const fetch = renderAt({ 'GET /api/files/7': { ...META, drm_encrypted: true } });
  expect(await screen.findByText(/DRM 암호화 파일이라/)).toBeInTheDocument();
  expect(calls(fetch)).not.toContain('GET /api/files/7/model.lbm');
});
