import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { BASKET_KEY } from '../../lib/compareBasket.js';
import { mockApi } from '../../test/mockApi.js';
import ModelPreview from '../preview/ModelPreview.jsx';
import ResultList from '../search/ResultList.jsx';
import { ToastProvider } from '../ui/Toast.jsx';
import { ViewerEngineContext } from '../viewer/ViewerEngineContext.js';
import ViewerPage from '../../pages/ViewerPage.jsx';
import { CompareBar, CompareBasketProvider, CompareToggle } from './CompareBasket.jsx';

function Shell({ children, at = '/' }) {
  return (
    <ViewerEngineContext.Provider value={async () => ({ setModel() {}, dispose() {} })}>
      <MemoryRouter initialEntries={[at]}>
        <ToastProvider>
          <CompareBasketProvider>
            {children}
            <CompareBar />
          </CompareBasketProvider>
        </ToastProvider>
      </MemoryRouter>
    </ViewerEngineContext.Provider>
  );
}

const bar = () => screen.queryByRole('region', { name: '비교 바구니' });

test('담기 → 띠(칩·개수·비교 열기) → 빼기 · 비우기, 이 브라우저에 저장', async () => {
  const user = userEvent.setup();
  render(
    <Shell>
      <CompareToggle file={{ id: 12, name: 'rev1.bdf', hull: '9999' }} />
      <CompareToggle file={{ id: 34, name: 'rev2.bdf', hull: '9999' }} />
    </Shell>,
  );
  expect(bar()).toBeNull();
  const [a, b] = screen.getAllByRole('button', { name: '비교에 담기' });
  await user.click(a);
  await user.click(b);
  const region = bar();
  expect(within(region).getByText('2/4')).toBeInTheDocument();
  expect(within(region).getByText('rev1.bdf')).toBeInTheDocument();
  expect(within(region).getAllByText('9999')).toHaveLength(2);
  expect(within(region).getByRole('link', { name: '비교 열기' })).toHaveAttribute('href', '/compare?ids=12,34');
  expect(JSON.parse(localStorage.getItem(BASKET_KEY)).map((x) => x.id)).toEqual([12, 34]);
  // 담긴 모델의 단추는 '비교에서 빼기'
  expect(screen.getAllByRole('button', { name: '비교에서 빼기' })).toHaveLength(2);

  await user.click(within(region).getByRole('button', { name: 'rev1.bdf 빼기' }));
  expect(within(bar()).getByText('1/4')).toBeInTheDocument();
  await user.click(within(bar()).getByRole('button', { name: '비우기' }));
  expect(bar()).toBeNull();
  expect(localStorage.getItem(BASKET_KEY)).toBeNull();
});

test('다섯 번째는 담지 않고 알린다', async () => {
  const user = userEvent.setup();
  localStorage.setItem(BASKET_KEY, JSON.stringify([1, 2, 3, 4].map((id) => ({ id, name: `m${id}.bdf`, hull: '' }))));
  render(<Shell><CompareToggle file={{ id: 5, name: 'm5.bdf' }} /></Shell>);
  expect(within(bar()).getByText('4/4')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '비교에 담기' }));
  expect(await screen.findByText('최대 4개까지 비교할 수 있습니다')).toBeInTheDocument();
  expect(within(bar()).getByText('4/4')).toBeInTheDocument();
  expect(within(bar()).queryByText('m5.bdf')).toBeNull();
});

test('저장소가 막혀도 메모리로 동작한다', async () => {
  const user = userEvent.setup();
  const denied = () => { throw new Error('denied'); };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
  try {
    render(<Shell><CompareToggle file={{ id: 9, name: 'x.bdf' }} /></Shell>);
    await user.click(screen.getByRole('button', { name: '비교에 담기' }));
    expect(within(bar()).getByText('x.bdf')).toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

test('비교 화면에서는 띠를 띄우지 않는다(화면 자체가 바구니)', () => {
  localStorage.setItem(BASKET_KEY, JSON.stringify([{ id: 1, name: 'a.bdf', hull: '' }]));
  render(<Shell at="/compare?ids=1"><div /></Shell>);
  expect(bar()).toBeNull();
});

test('담기 단추 ① 검색 결과의 모델 파일 — 행 선택과 섞이지 않는다', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const items = [
    { file_id: 7, entry_id: 'E1', name: 'main.bdf', kind: 'model', hulls: ['9001'], entry_title: 't', rel_path: 'main.bdf' },
    { file_id: 8, entry_id: 'E1', name: 'r.pdf', kind: 'report', hulls: ['9001'], entry_title: 't', rel_path: 'r.pdf' },
  ];
  render(<Shell><ResultList unit="file" items={items} onSelect={onSelect} onOpen={() => {}} /></Shell>);
  const buttons = screen.getAllByRole('button', { name: '비교에 담기' });
  expect(buttons).toHaveLength(1);
  await user.click(buttons[0]);
  expect(onSelect).not.toHaveBeenCalled();
  expect(within(bar()).getByText('main.bdf')).toBeInTheDocument();
  expect(within(bar()).getByText('9001')).toBeInTheDocument();
});

test('담기 단추 ② 자료 미리보기(모델) — 변환 대기 중에도', async () => {
  const user = userEvent.setup();
  mockApi({ 'GET /api/files/7/model': { state: 'queued', has_lbm: false } });
  render(<Shell><ModelPreview file={{ id: 7, name: 'm.bdf', kind: 'model' }} hull="9002" /></Shell>);
  await user.click(await screen.findByRole('button', { name: '비교에 담기' }));
  expect(within(bar()).getByText('m.bdf')).toBeInTheDocument();
  expect(within(bar()).getByText('9002')).toBeInTheDocument();
});

test('담기 단추 ③ 전체 화면 뷰어 머리줄', async () => {
  const user = userEvent.setup();
  mockApi({
    'GET /api/files/7': { id: 7, name: 'main.bdf', rel_path: 'main.bdf', kind: 'model', size: 1, entry_id: 'E1', entry_title: 't',
                          entry_status: 'confirmed', drm_encrypted: false },
    'GET /api/files/7/model': { state: 'include', has_lbm: false },
  });
  render(<Shell at="/v/7"><Routes><Route path="/v/:fileId" element={<ViewerPage />} /></Routes></Shell>);
  await user.click(await screen.findByRole('button', { name: '비교에 담기' }));
  expect(screen.getByRole('button', { name: '비교에서 빼기' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(bar()).getByText('main.bdf')).toBeInTheDocument();
});
