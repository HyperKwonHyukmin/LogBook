import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import App from '../../App.jsx';
import RootErrorPage from '../../pages/RootErrorPage.jsx';
import { WidgetBoundary } from './ErrorBoundary.jsx';
import { CHUNK_RELOAD_KEY } from '../../lib/chunkReload.js';
import { TOKEN_KEY } from '../../api/client.js';

// 그리기 오류 경계 — 영어 'Unexpected Application Error!' 대신 한국어 복구 화면, 셸(내비·상단 바)은 살린다

const USER = { employee_id: 'A100001', name: '김철수', level: 2, role: 'user' };

/** 셸이 부르는 API 는 무난히 답하고, 검색 응답만 깨진 모양(행 자리에 null)으로 준다. */
function stubShellApi(searchBody) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url);
    let body = {};
    if (path.startsWith('/api/auth/me')) body = USER;
    else if (path.startsWith('/api/system/health')) body = { storage: { reachable: true } };
    else if (path.startsWith('/api/search')) body = searchBody;
    else if (path.startsWith('/api/prefs')) body = {};
    else if (path.startsWith('/api/batches')) body = [];
    else body = { items: [], total: 0 };
    return { ok: true, status: 200, json: () => Promise.resolve(body) };
  }));
}

function renderApp(path) {
  // main.jsx 와 같은 데이터 라우터 + errorElement
  const router = createMemoryRouter([{ path: '*', element: <App />, errorElement: <RootErrorPage /> }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

let consoleError;
beforeEach(() => {
  // React 가 잡은 오류를 콘솔에 남긴다 — 의도한 오류라 조용히 둔다
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.clear();
});
afterEach(() => { consoleError.mockRestore(); });

test('검색 응답이 깨져 화면이 터져도 내비·상단 바는 남고 작업면에 복구 안내가 나온다. 다른 메뉴로 가면 풀린다', async () => {
  localStorage.setItem(TOKEN_KEY, 'tok');
  stubShellApi({ items: [null], total: 1, facets: null, groups: null });
  renderApp('/?q=9999');
  const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
  expect(alert).toHaveTextContent('이 화면을 표시하지 못했습니다');
  expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  expect(within(alert).getByRole('link', { name: '검색으로' })).toHaveAttribute('href', '/');
  expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  // 셸은 그대로 — 내비가 살아 있다
  const nav = screen.getByRole('link', { name: /정리 대기/ });
  await userEvent.click(nav);
  expect(screen.queryByText('이 화면을 표시하지 못했습니다')).toBeNull();
  expect(await screen.findByRole('heading', { name: '정리 대기' })).toBeInTheDocument();
});

test('셸 밖(최상위)에서 터지면 errorElement 의 한국어 화면 — 다시 시도·검색으로·접힌 기술 정보', async () => {
  function Boom() { throw new Error('boom at root'); }
  const router = createMemoryRouter([{ path: '*', element: <Boom />, errorElement: <RootErrorPage /> }]);
  render(<RouterProvider router={router} />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('이 화면을 표시하지 못했습니다');
  expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  expect(within(alert).getByRole('link', { name: '검색으로' })).toHaveAttribute('href', '/');
  const detail = within(alert).getByText('기술 정보').closest('details');
  expect(detail).not.toHaveAttribute('open');
  expect(detail).toHaveTextContent('boom at root');
  expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
});

function Flaky({ fail }) {
  if (fail.current) throw fail.current;
  return <p>뷰어 내용</p>;
}

test('무거운 조각이 터지면 그 자리에 한 줄 안내, [다시 시도]로 다시 그린다', async () => {
  const fail = { current: new Error('webgl lost') };
  render(<div><p>화면 나머지</p><WidgetBoundary what="3D 뷰어" tone="dark"><Flaky fail={fail} /></WidgetBoundary></div>);
  expect(screen.getByRole('alert')).toHaveTextContent('3D 뷰어 표시 중에 문제가 생겼습니다.');
  expect(screen.getByText('화면 나머지')).toBeInTheDocument();
  fail.current = null;
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(screen.getByText('뷰어 내용')).toBeInTheDocument();
});

test('사라진 묶음(재배포) 오류면 한 번 새로 고침하고, 방금 해 봤으면 [새로 고침] 안내만', async () => {
  const chunkError = new TypeError('Failed to fetch dynamically imported module: /assets/ComparePage-old.js');
  const first = render(<WidgetBoundary what="비교"><Flaky fail={{ current: chunkError }} /></WidgetBoundary>);
  expect(await screen.findByText('새 버전을 불러오는 중…')).toBeInTheDocument();
  expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
  first.unmount();

  // 새로 고침 뒤에도 또 실패 — 반복하지 않는다
  render(<WidgetBoundary what="비교"><Flaky fail={{ current: chunkError }} /></WidgetBoundary>);
  expect(await screen.findByText(/새 버전이 배포되었습니다/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '새로 고침' })).toBeInTheDocument();
});
