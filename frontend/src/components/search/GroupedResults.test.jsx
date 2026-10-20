import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import GroupedResults from './GroupedResults.jsx';

// 20 — 호선별 묶기의 '공용'(호선 없음을 고른 자료) 묶음은 '호선 없음' 과 따로, 거르기 단추 없이 보인다.
// 결과 행: 공용 표시, '보완 필요'(빠진 필수 분류) 작은 표시.
const row = (id, title, extra = {}) => ({ entry_id: id, title, status: 'confirmed', analysis_type: null, posted_at: '2026-10-01T09:00:00',
  hulls: [], ship_types: [], zones: [], tags: [], uploaded_by: 'A100001', confirmed_at: null, file_count: 1,
  kinds: ['model'], kind_counts: { model: 1, report: 0, drawing: 0, result: 0, other: 0 }, score: 0, matched: [], snippets: [],
  favorite: false, ...extra });

test("공용 묶음 — 이름 '공용', 거르기 단추 없음, 행에 공용·보완 필요 표시", () => {
  const onFilter = vi.fn();
  render(
    <MemoryRouter>
      <GroupedResults by="hull" collapsed={new Set()} onToggle={() => {}} onMore={() => {}} onFilter={onFilter}
                      onSelect={() => {}} onOpen={() => {}} terms={[]} filters={{}} multiValued={0}
                      groups={[
                        { value: '3496', label: null, count: 1, items: [row('E000001', '3496 모델', { hulls: ['3496'] })] },
                        { value: '__shared__', label: '공용', count: 1, items: [row('E000002', '공용 모델', { no_hull: true, needs_fix: ['zone_or_target'] })] },
                        { value: null, label: null, count: 1, items: [row('E000003', '호선 모름')] },
                      ]} />
    </MemoryRouter>,
  );
  const groups = screen.getAllByRole('group');
  expect(within(groups[1]).getByTitle("'호선 없음(공용)' 을 고른 자료")).toHaveTextContent('공용');
  expect(within(groups[1]).queryByRole('button', { name: /거르기/ })).toBeNull();
  expect(within(groups[0]).getByRole('button', { name: '3496' })).toBeInTheDocument();
  expect(within(groups[1]).getByText('보완 필요 · 구역 또는 대상')).toBeInTheDocument();
  expect(within(groups[1]).getByTitle('호선 없음(공용)')).toHaveTextContent('공용');
  expect(within(groups[2]).getByText('호선 없음')).toBeInTheDocument();
});
