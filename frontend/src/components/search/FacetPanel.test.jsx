import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import FacetPanel, { matchesFilter } from './FacetPanel.jsx';

// 19 — 합성 값(가상 호선 9xxx). 호선 12개 = 칸 안 찾기가 생기는 수(8개 초과)
const HULLS = Array.from({ length: 12 }, (_, i) => ({ value: String(9100 + i), count: 20 - i }));
HULLS[11].label = 'LNGC';
const FACETS = {
  hull: HULLS,
  zone: [{ value: '선미부', count: 3, aliases: ['Aft Body'] }, { value: '선수부', count: 2 }],
  tag: [], ship_type: [], uploaded_by: [], kind: [],
};

function renderPanel(filters = {}, applied) {
  const onChange = vi.fn();
  render(<MemoryRouter><FacetPanel facets={FACETS} filters={filters} applied={applied} onChange={onChange} /></MemoryRouter>);
  return onChange;
}

test('값이 많은 칸에만 칸 안 찾기가 있고, 값·라벨·동의어로 찾는다(공백·대소문자 무시)', async () => {
  renderPanel();
  const hull = screen.getByRole('group', { name: '호선' });
  expect(within(hull).getAllByRole('button', { name: /^91\d\d/ })).toHaveLength(8);
  expect(screen.queryByRole('searchbox', { name: '구역 값 찾기' })).toBeNull();   // 2개뿐
  const find = within(hull).getByRole('searchbox', { name: '호선 값 찾기' });
  await userEvent.type(find, '911');
  expect(within(hull).getAllByRole('button', { name: /^91\d\d/ }).map((b) => b.textContent.slice(0, 4)))
    .toEqual(['9110', '9111']);
  await userEvent.clear(find);
  await userEvent.type(find, 'lng c');                  // 라벨(선종), 공백·대소문자 무시
  expect(within(hull).getAllByRole('button', { name: /^91\d\d/ })).toHaveLength(1);
  await userEvent.clear(find);
  await userEvent.type(find, 'zzz');
  expect(within(hull).getByText('맞는 값이 없습니다')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(find).toHaveValue('');
});

test('여러 값을 켤 수 있고, 고른 값은 찾기·더 보기와 무관하게 늘 위에 보인다', async () => {
  const onChange = renderPanel({ hull: ['9111', '9100'] });
  const hull = screen.getByRole('group', { name: '호선' });
  expect(hull).toHaveTextContent('2개 중 하나');
  const pressed = within(hull).getAllByRole('button', { pressed: true });
  expect(pressed.map((b) => b.textContent.slice(0, 4))).toEqual(['9111', '9100']);
  // 찾는 값과 맞지 않아도 고른 값은 남는다
  await userEvent.type(within(hull).getByRole('searchbox'), '9105');
  expect(within(hull).getAllByRole('button', { pressed: true })).toHaveLength(2);
  await userEvent.click(within(hull).getByRole('button', { name: /^9105/ }));
  expect(onChange).toHaveBeenLastCalledWith('hull', '9105');
  await userEvent.click(pressed[0]);
  expect(onChange).toHaveBeenLastCalledWith('hull', '9111');   // 켜진 값을 누르면 그 값만 끈다
});

test('더 보기는 고른 값을 뺀 나머지 수를 보이고, 0건인 고른 값도 해제할 수 있다', async () => {
  renderPanel({ hull: ['9999'] });
  const hull = screen.getByRole('group', { name: '호선' });
  expect(within(hull).getByRole('button', { name: /^9999/, pressed: true })).toBeInTheDocument();
  await userEvent.click(within(hull).getByRole('button', { name: '더 보기 5' }));   // 12 - (8 - 1)
  expect(within(hull).getAllByRole('button', { pressed: false }).filter((b) => /^91/.test(b.textContent))).toHaveLength(12);
});

test('서버가 정리한 대표 값(applied)으로 강조한다 — 동의어 주소', () => {
  renderPanel({ zone: ['Aft Body'] }, { zone: ['선미부'] });
  const zone = screen.getByRole('group', { name: '구역' });
  expect(within(zone).getByRole('button', { name: /선미부/ })).toHaveAttribute('aria-pressed', 'true');
});

test('matchesFilter — 값·라벨·동의어', () => {
  expect(matchesFilter('zone', FACETS.zone[0], 'aft body')).toBe(true);
  expect(matchesFilter('hull', HULLS[11], 'lngc')).toBe(true);
  expect(matchesFilter('zone', FACETS.zone[1], 'aft')).toBe(false);
});

test('48 — 칸마다 [값 전체 보기] 가 분류 화면의 그 속성 탭으로 간다', () => {
  renderPanel();
  expect(within(screen.getByRole('group', { name: '구역' })).getByRole('link', { name: '값 전체 보기' }))
    .toHaveAttribute('href', '/browse?by=zone');
  expect(within(screen.getByRole('group', { name: '호선' })).getByRole('link', { name: '값 전체 보기' }))
    .toHaveAttribute('href', '/browse?by=hull');
});
