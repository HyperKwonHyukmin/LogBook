import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import NewsSettingsDialog from '../components/news/NewsSettingsDialog.jsx';
import ResultList from '../components/search/ResultList.jsx';
import { NEWS_EVENT, countText, markSeen } from './news.js';
import { invalidateVocab } from './vocab.js';

const entry = (id, o = {}) => ({ entry_id: id, title: `${id} 제목`, status: 'confirmed', hulls: [], zones: [], tags: [], kinds: [],
  kind_counts: { model: 0, model_view: 0, report: 1, drawing: 0, result: 0, other: 0 }, posted_at: '2026-11-25T09:00:00', ...o });

test('72 — 결과 행: 새 자료면 New 배지', () => {
  render(<MemoryRouter><ResultList unit="entry" onSelect={() => {}} onOpen={() => {}}
    items={[entry('E000301', { is_new: true }), entry('E000302')]} /></MemoryRouter>);
  expect(screen.getAllByTestId('new-badge')).toHaveLength(1);
  expect(screen.getByTestId('new-badge').closest('li')).toHaveTextContent('E000301');
});

test('72 — 열어 본 자료를 서버에 알리고 NEWS_EVENT 를 쏜다, 숫자는 99+ 까지', async () => {
  const fetch = mockApi({ 'POST /api/me/news/seen': { count: 0 } });
  const got = [];
  const on = (e) => got.push(e.detail);
  window.addEventListener(NEWS_EVENT, on);
  await markSeen('E000301');
  window.removeEventListener(NEWS_EVENT, on);
  expect(calls(fetch)).toContain('POST /api/me/news/seen');
  expect(got).toEqual([{ seen: 'E000301' }]);
  expect(countText(7)).toBe('7');
  expect(countText(120)).toBe('99+');
});

test('72 — 설정 창: 켜기, 관심 대상(묶음 아래 하위), 관심 선종을 저장한다', async () => {
  invalidateVocab('target');
  const fetch = mockApi({
    'GET /api/me/news': { enabled: true, count: 3, since: '2026-11-18T09:00:00', targets: [], ship_types: [] },
    'GET /api/vocab?kind=target': { terms: [
      { id: 1, value: '배관', active: true, parent: null, children: ['Manifold'] },
      { id: 2, value: 'Manifold', active: true, parent: '배관', children: [] },
      { id: 3, value: '기타', active: true, parent: null, children: [] }] },
    'GET /api/search/browse': { facets: { ship_type: [{ value: 'LNGC', count: 5 }, { value: 'VLCC', count: 2 }] } },
    'PUT /api/me/prefs': {},
  });
  const onClose = vi.fn();
  render(<NewsSettingsDialog onClose={onClose} />);
  const targets = await screen.findByRole('group', { name: '관심 대상' });
  expect(within(targets).queryByText('기타')).toBeNull();
  await userEvent.click(within(targets).getByRole('button', { name: /배관/ }));
  await userEvent.click(within(screen.getByRole('group', { name: '관심 선종' })).getByRole('button', { name: 'LNGC' }));
  await userEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const put = fetch.mock.calls.find(([u, i = {}]) => u === '/api/me/prefs' && i.method === 'PUT');
  expect(JSON.parse(put[1].body)).toEqual({ 'news.enabled': true, 'news.targets': ['배관'], 'news.shipTypes': ['LNGC'] });
});
