import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import FacetPanel, { matchesFilter } from './FacetPanel.jsx';

// 19 — 합성 값(가상 호선 9xxx). 호선 20개 = 격자 12칸을 넘어 칸 안 찾기·더 보기가 생기는 수.
// 서버는 건수 순으로 준다(9119 가 가장 많음) — 화면은 번호 순이어야 한다(2026-11-06)
const HULLS = Array.from({ length: 20 }, (_, i) => ({ value: String(9100 + i), count: i + 1 })).reverse();
HULLS.find((h) => h.value === '9100').label = 'LNGC';
const FACETS = {
  hull: HULLS,
  zone: [{ value: '선미부', count: 3, aliases: ['Aft Body'] }, { value: '선수부', count: 2 }],
  tag: [{ value: '1TK', count: 2 }, { value: 'M02', count: 1 }],
  ship_type: [], uploaded_by: [{ value: 'A100001', label: '홍길동', count: 5 }], kind: [],
};

function renderPanel(filters = {}, applied, total) {
  const onChange = vi.fn();
  render(<MemoryRouter><FacetPanel facets={FACETS} filters={filters} applied={applied} onChange={onChange} total={total} /></MemoryRouter>);
  return onChange;
}
const hullValues = (hull) => within(hull).getAllByRole('button', { name: /^91\d\d/ }).map((b) => b.textContent.slice(0, 4));

test('호선은 건수가 아니라 번호 순으로 12칸 격자에 보인다', () => {
  renderPanel();
  const hull = screen.getByRole('group', { name: '호선' });
  expect(hullValues(hull)).toEqual(Array.from({ length: 12 }, (_, i) => String(9100 + i)));
  expect(within(hull).getByRole('list')).toHaveClass('grid-cols-3');
});

test('값이 많은 칸에만 칸 안 찾기가 있고, 값·라벨·동의어로 찾는다(공백·대소문자 무시)', async () => {
  renderPanel();
  const hull = screen.getByRole('group', { name: '호선' });
  expect(screen.queryByRole('searchbox', { name: '구역 값 찾기' })).toBeNull();   // 2개뿐
  const find = within(hull).getByRole('searchbox', { name: '호선 값 찾기' });
  await userEvent.type(find, '9115');
  expect(hullValues(hull)).toEqual(['9115']);
  await userEvent.clear(find);
  await userEvent.type(find, 'lng c');                  // 라벨(선종), 공백·대소문자 무시
  expect(hullValues(hull)).toEqual(['9100']);
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
  await userEvent.click(within(hull).getByRole('button', { name: '더 보기 9' }));   // 20 - (12 - 1)
  expect(within(hull).getAllByRole('button', { pressed: false }).filter((b) => /^91/.test(b.textContent))).toHaveLength(20);
});

test('호선 밖의 칸은 찾기 칸을 [더 보기] 로 펼쳤을 때만 보인다', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ value: `대상${i}`, count: 10 - i }));
  render(<MemoryRouter><FacetPanel facets={{ target: many }} filters={{}} onChange={vi.fn()} /></MemoryRouter>);
  const target = screen.getByRole('group', { name: '대상' });
  expect(within(target).queryByRole('searchbox')).toBeNull();
  await userEvent.click(within(target).getByRole('button', { name: '더 보기 2' }));
  expect(within(target).getByRole('searchbox', { name: '대상 값 찾기' })).toBeInTheDocument();
});

test('자주 쓰지 않는 칸은 접혀 있고, 펼친 상태를 기억한다', async () => {
  renderPanel();
  const tag = screen.getByRole('group', { name: '태그' });
  const head = within(tag).getByRole('button', { name: /태그/ });
  expect(head).toHaveAttribute('aria-expanded', 'false');
  expect(head).toHaveTextContent('2');                       // 접혀도 값 수는 보인다
  expect(within(tag).queryByRole('button', { name: /1TK/ })).toBeNull();
  await userEvent.click(head);
  expect(within(tag).getByRole('button', { name: /1TK/ })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('logbook_facet_open'))).toEqual({ tag: true });
  // 호선은 처음부터 펼침 — 접으면 기억한다
  await userEvent.click(within(screen.getByRole('group', { name: '호선' })).getByRole('button', { name: /^호선/ }));
  expect(within(screen.getByRole('group', { name: '호선' })).queryByRole('list')).toBeNull();
  expect(JSON.parse(localStorage.getItem('logbook_facet_open'))).toEqual({ tag: true, hull: false });
});

test('고른 값이 있는 칸은 접혀 있던 칸이라도 펼쳐 둔다', () => {
  localStorage.setItem('logbook_facet_open', JSON.stringify({ tag: false }));
  renderPanel({ tag: ['M02'] });
  const tag = screen.getByRole('group', { name: '태그' });
  expect(within(tag).getByRole('button', { name: /M02/, pressed: true })).toBeInTheDocument();
});

test('값이 하나뿐이고 모든 결과가 그 값인 칸은 숨긴다(거를 힘이 없음)', () => {
  renderPanel({}, undefined, 5);   // 작성자 홍길동 5건 = 결과 5건
  expect(screen.queryByRole('group', { name: '작성자' })).toBeNull();
  expect(screen.getByRole('group', { name: '구역' })).toBeInTheDocument();
});

test('서버가 정리한 대표 값(applied)으로 강조한다 — 동의어 주소', () => {
  renderPanel({ zone: ['Aft Body'] }, { zone: ['선미부'] });
  const zone = screen.getByRole('group', { name: '구역' });
  expect(within(zone).getByRole('button', { name: /선미부/ })).toHaveAttribute('aria-pressed', 'true');
});

test('matchesFilter — 값·라벨·동의어', () => {
  expect(matchesFilter('zone', FACETS.zone[0], 'aft body')).toBe(true);
  expect(matchesFilter('hull', HULLS.find((h) => h.value === '9100'), 'lngc')).toBe(true);
  expect(matchesFilter('zone', FACETS.zone[1], 'aft')).toBe(false);
});

test('48 — 칸마다 [값 전체 보기] 가 분류 화면의 그 속성 탭으로 간다', () => {
  renderPanel();
  expect(within(screen.getByRole('group', { name: '구역' })).getByRole('link', { name: '값 전체 보기' }))
    .toHaveAttribute('href', '/browse?by=zone');
  expect(within(screen.getByRole('group', { name: '호선' })).getByRole('link', { name: '값 전체 보기' }))
    .toHaveAttribute('href', '/browse?by=hull');
});
