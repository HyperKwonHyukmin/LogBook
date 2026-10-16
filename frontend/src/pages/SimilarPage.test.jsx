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
  const list = await screen.findByRole('listbox', { name: '비슷한 선례' });
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

test('기준이 없으면 안내만', async () => {
  renderPage('/similar');
  expect(await screen.findByText('아직 기준 BDF 가 없습니다')).toBeInTheDocument();
});

test('볼 수 없는 기준이면 오류 문구', async () => {
  renderPage('/similar?file=1', { 'GET /api/similar?file_id=1': { __status: 404, detail: 'similar_base_not_found' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('기준 BDF 를 찾지 못했습니다');
});
