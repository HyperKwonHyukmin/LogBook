import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import SimilarPage from './SimilarPage.jsx';

vi.mock('../components/viewer/ModelThumb.jsx', () => ({ default: () => <span data-testid="thumb" /> }));

const item = (id, o) => ({ file_id: id, file_name: `m${id}.bdf`, model_key: 'k', entry_id: `E00000${id}`, title: `선례 ${id}`,
  atype: 'Truss', zones: ['정반'], hulls: ['9002'], reports: 1, solve: 'pass', uploaded_by: 'M1', uploader_name: '김해석',
  confirmed_at: '2026-08', dims: [22, 8, 1.5], elems: 900, mix: [0.95, 0, 0.05, 0], sections: ['L 100x100x10'], sol: '101', ...o });
const score = (total, shape = false) => ({ total, shape, raw: { size: 0.9, scale: 0.8, mix: 0.95, sec: 0.5, tag: 1 }, same_sections: ['L 100x100x10'] });
const DATA = {
  base: { name: 'base.bdf', file_id: 1, model_key: 'k', entry_id: 'E000001', zone: '정반', atype: 'Truss', dims: [22, 8, 1.5],
    elems: 900, mix: [0.95, 0, 0.05, 0], sections: ['L 100x100x10'], sol: '101', has_signature: true, missing_includes: null },
  candidates: 3,
  results: [
    { lead: item(2), score: score(0.97, true), best: 0.97, member_total: 2, members: [{ ...item(2), total: 0.97 }, { ...item(3, { hulls: ['9003'], solve: 'fail' }), total: 0.97 }] },
    { lead: item(4, { solve: 'fail', reports: 0, title: '실패 선례' }), score: score(0.6), best: 0.6, member_total: 1, members: [{ ...item(4), total: 0.6 }] },
  ],
};

function renderPage(path = '/similar?file=1', map = {}) {
  mockApi({ 'GET /api/similar?file_id=1': DATA, 'GET /api/vocab?kind=zone': { terms: [{ value: '정반' }, { value: '블록' }] },
    'GET /api/vocab?kind=atype': { terms: [{ value: 'Truss' }] }, ...map });
  render(<MemoryRouter initialEntries={[path]}><SimilarPage /></MemoryRouter>);
}

test('같은 설계를 한 줄로 묶고 같은 점·다른 점을 보인다', async () => {
  renderPage();
  const list = await screen.findByRole('listbox', { name: '찾은 선례' });
  const first = within(list).getAllByRole('option')[0];
  expect(within(first).getByText('같은 설계 2개 자료')).toBeInTheDocument();
  expect(within(first).getByText('형상 같음(같은 설계)')).toBeInTheDocument();
  expect(within(first).getByText('거의 같음')).toBeInTheDocument();
  await userEvent.click(within(first).getByRole('button', { name: '같은 설계 자료 2개 모두 보기' }));
  expect(within(first).getByRole('link', { name: '선례 3' })).toHaveAttribute('href', '/e/E000003');
  expect(within(list).getByText(/이 선례는 해석 검증에 실패했습니다/)).toBeInTheDocument();
  const detail = screen.getByRole('complementary', { name: '선례 상세' });
  expect(within(detail).getByRole('link', { name: '나란히 비교' })).toHaveAttribute('href', '/compare?ids=1,2');
});

const SEARCH = (items) => ({ total: items.length, items });
const hit = (id, o) => ({ file_id: id, name: `m${id}.bdf`, kind: 'model', entry_id: `E00000${id}`, entry_title: `3515 · Unit · 모델 ${id}`,
  entry_status: 'confirmed', hulls: ['3515'], model_state: 'done', model_key: 'k', posted_at: '2026-10-01T09:00:00', ...o });

test('기준이 없으면 LogBook 고르기 칸이 열리고, 고르면 그 BDF 가 기준이 된다', async () => {
  renderPage('/similar', {
    'GET /api/search?unit=file&kind=model&q=&limit=30&sort=recent': SEARCH([hit(1), hit(9, { model_state: 'queued' })]),
  });
  const list = await screen.findByRole('listbox', { name: '기준으로 고를 BDF' });
  const opts = await within(list).findAllByRole('option');
  expect(opts[0]).toHaveTextContent('Unit · 모델 1');            // 제목 머리의 호선은 칩으로만
  expect(opts[1]).toHaveAttribute('aria-disabled', 'true');
  expect(opts[1]).toHaveTextContent('변환 중');
  await userEvent.click(opts[0]);
  expect(await screen.findByText('같은 설계 2개 자료')).toBeInTheDocument();   // ?file=1 로 비교
});

test('검색어로 찾고 키보드로 고른다', async () => {
  renderPage('/similar', {
    'GET /api/search?unit=file&kind=model&q=&limit=30&sort=recent': SEARCH([hit(5)]),
    'GET /api/search?unit=file&kind=model&q=3515&limit=30': SEARCH([hit(1)]),
  });
  const box = await screen.findByRole('searchbox', { name: '기준 BDF 찾기' });
  await userEvent.type(box, '3515');
  expect(await screen.findByText('찾은 BDF 1개', { exact: false })).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('같은 설계 2개 자료')).toBeInTheDocument();
});

test('볼 수 없는 기준이면 오류 문구', async () => {
  renderPage('/similar?file=1', { 'GET /api/similar?file_id=1': { __status: 404, detail: 'similar_base_not_found' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('기준 BDF 를 찾지 못했습니다');
});
