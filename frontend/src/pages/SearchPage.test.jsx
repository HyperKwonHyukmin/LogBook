import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import SearchPage from './SearchPage.jsx';

const ITEM = { entry_id: 'E000001', title: '계류 구조 검토', status: 'confirmed', analysis_type: 'Mooring',
  analysis_period: '2026-08', hulls: ['9999'], ship_types: [], zones: ['선수부'], tags: [], uploaded_by: 'A100001',
  confirmed_at: '2026-09-02T09:00:00', file_count: 2, kinds: ['model', 'report'], score: 110,
  matched: ['body', 'hull'], snippets: [{ file_id: 11, name: 'r.pptx', locator: 'slide:3', text: '선체 구조 강도 평가', highlights: [[6, 8]] }] };
const DRAFT = { ...ITEM, entry_id: 'E000002', title: '초안 자료', status: 'draft', snippets: [], matched: ['title'] };
const FACETS = { hull: [{ value: '9999', count: 1 }, { value: '9998', count: 3 }], ship_type: [], analysis_type: [],
  zone: [], year: [], uploaded_by: [{ value: 'A100001', label: '홍길동', count: 1 }], kind: [{ value: 'model', count: 1 }] };
const RES = { unit: 'entry', total: 2, items: [ITEM, DRAFT], facets: FACETS, hull_suggestion: { hull_no: '9999', known: true }, terms: ['9999', '강도'] };
const ENTRY = { entry_id: 'E000001', title: '계류 구조 검토', status: 'confirmed', hulls: [{ hull_no: '9999', ship_type: null, is_primary: true }],
  zones: [], tags: [], files: [{ id: 11, name: 'r.pptx', rel_path: 'r.pptx', kind: 'report', size: 10, extract: null }],
  vault_unc: '\\\\srv\\E000001', version: 1 };

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}{l.search}</span>; }

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<><SearchPage /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('주소로 검색하고 결과·발췌·필터 건수를 보인다', async () => {
  const fetch = mockApi({ 'GET /api/search?q=9999+%EA%B0%95%EB%8F%84&limit=50&offset=0': RES });
  renderAt('/?q=9999%20강도');
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.getByText('결과 2건')).toBeInTheDocument();
  expect(screen.getByText('강도').tagName).toBe('MARK');
  expect(screen.getByText('슬라이드 3')).toBeInTheDocument();
  expect(within(screen.getByText('초안 자료').closest('li')).getByText('미확정')).toBeInTheDocument();
  const hullFacet = screen.getByRole('group', { name: '호선' });
  expect(within(hullFacet).getByText('9998')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: '올린 사람' })).toHaveTextContent('홍길동');
  expect(calls(fetch)).toHaveLength(1);
});

test('필터를 누르면 주소에 들어가고, 호선 제안으로 좁힐 수 있다', async () => {
  mockApi({
    'GET /api/search?q=9999&limit=50&offset=0': { ...RES, hull_suggestion: { hull_no: '9999', known: true } },
    'GET /api/search?q=9999&hull=9999&limit=50&offset=0': { ...RES, hull_suggestion: null },
    'GET /api/search?q=9999&hull=9998&limit=50&offset=0': { ...RES, hull_suggestion: null },
  });
  renderAt('/?q=9999');
  await userEvent.click(await screen.findByRole('button', { name: /호선 9999 로 좁히기/ }));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=9999&hull=9999');
  await screen.findByText('결과 2건');
  await userEvent.click(within(screen.getByRole('group', { name: '호선' })).getByRole('button', { name: /9998/ }));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=9999&hull=9998');
});

test('결과를 고르면 미리보기 패널이 열리고, Enter 로 상세로 간다', async () => {
  mockApi({ 'GET /api/search?q=a&limit=50&offset=0': RES, 'GET /api/entries/E000001': ENTRY,
            'GET /api/files/11/text': { state: null, summary: null, chunks: [] } });
  renderAt('/?q=a');
  // 제목은 상세로 가는 링크라, 항목의 링크 밖(행)을 눌러 고른다.
  await userEvent.click((await screen.findByText('계류 구조 검토')).closest('[role="option"]'));
  const panel = await screen.findByRole('complementary', { name: '미리보기' });
  expect(await within(panel).findByText('r.pptx')).toBeInTheDocument();
  const list = screen.getByRole('listbox', { name: '검색 결과' });
  list.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByTestId('loc').textContent).toBe('/e/E000001');
});

test('보기 단위와 미확정 포함을 바꾼다', async () => {
  mockApi({
    'GET /api/search?limit=50&offset=0': { ...RES, hull_suggestion: null },
    'GET /api/search?unit=file&limit=50&offset=0': { unit: 'file', total: 1, facets: FACETS, hull_suggestion: null, terms: [],
      items: [{ file_id: 11, name: 'r.pptx', rel_path: 'r.pptx', kind: 'report', size: 10, entry_id: 'E000001',
                entry_title: '계류 구조 검토', entry_status: 'confirmed', hulls: ['9999'], score: 0, matched: [], snippets: [] }] },
    'GET /api/search?unit=file&drafts=true&limit=50&offset=0': { unit: 'file', total: 0, items: [], facets: FACETS, hull_suggestion: null, terms: [] },
  });
  renderAt('/');
  await screen.findByText('결과 2건');
  await userEvent.click(screen.getByRole('radio', { name: '파일' }));
  expect(await screen.findByText('r.pptx')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: '미확정 포함' }));
  expect(await screen.findByText('찾는 자료가 없습니다')).toBeInTheDocument();
});

test('더 보기로 다음 쪽을 이어 붙인다', async () => {
  const page1 = { ...RES, total: 3, hull_suggestion: null };
  const page2 = { ...RES, total: 3, hull_suggestion: null, items: [{ ...ITEM, entry_id: 'E000003', title: '세 번째' }] };
  mockApi({ 'GET /api/search?limit=50&offset=0': page1, 'GET /api/search?limit=50&offset=2': page2 });
  renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
  expect(await screen.findByText('세 번째')).toBeInTheDocument();
  expect(screen.getByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
});

test('오류를 보인다', async () => {
  mockApi({ 'GET /api/search?limit=50&offset=0': { __status: 500, detail: 'x' } });
  renderAt('/');
  expect(await screen.findByRole('alert')).toHaveTextContent('검색하지 못했습니다');
});

const FILE_RES = { unit: 'file', total: 1, facets: FACETS, hull_suggestion: null, terms: [],
  items: [{ file_id: 11, name: 'r.pptx', rel_path: 'r.pptx', kind: 'report', size: 10, entry_id: 'E000001',
            entry_title: '계류 구조 검토', entry_status: 'confirmed', hulls: ['9999'], score: 0, matched: [], snippets: [] }] };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('↑/↓ 로 빠르게 옮겨도 미리보기는 멈춘 항목만 불러온다', async () => {
  const fetch = mockApi({ 'GET /api/search?q=a&limit=50&offset=0': RES,
    'GET /api/entries/E000002': { ...ENTRY, entry_id: 'E000002', title: '초안 자료', files: [] } });
  renderAt('/?q=a');
  const list = await screen.findByRole('listbox', { name: '검색 결과' });
  list.focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  // 목록의 강조는 바로 옮겨 간다.
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('초안 자료');
  await sleep(300);
  expect(calls(fetch)).toContain('GET /api/entries/E000002');
  expect(calls(fetch)).not.toContain('GET /api/entries/E000001');
  expect(await screen.findByRole('complementary', { name: '미리보기' })).toBeInTheDocument();
});

test('Home·End 로 처음·끝 항목을 고르고, 고른 항목을 화면 안으로 스크롤한다', async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  try {
    mockApi({ 'GET /api/search?q=a&limit=50&offset=0': RES });
    renderAt('/?q=a');
    const list = await screen.findByRole('listbox', { name: '검색 결과' });
    list.focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('초안 자료');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('계류 구조 검토');
  } finally {
    delete Element.prototype.scrollIntoView;
  }
});

test('동의어로 넣은 구역 필터는 서버가 정리한 대표 값에 강조되고, 누르면 해제된다', async () => {
  mockApi({
    'GET /api/search?zone=FWD&limit=50&offset=0': { ...RES, hull_suggestion: null, applied_filters: { zone: '선수부' },
      facets: { ...FACETS, zone: [{ value: '선수부', count: 2 }, { value: '선미부', count: 1 }] } },
    'GET /api/search?limit=50&offset=0': { ...RES, hull_suggestion: null },
  });
  renderAt('/?zone=FWD');
  const zone = await screen.findByRole('group', { name: '구역' });
  const root = await within(zone).findByRole('button', { name: /선수부/ });
  expect(root).toHaveAttribute('aria-pressed', 'true');
  expect(within(zone).queryByText('FWD')).toBeNull();
  await userEvent.click(root);
  expect(screen.getByTestId('loc').textContent).toBe('/');
});

test('더 보기로 붙일 때 이미 있는 항목은 거듭 넣지 않는다', async () => {
  const page1 = { ...RES, total: 3, hull_suggestion: null };
  const page2 = { ...RES, total: 3, hull_suggestion: null, items: [ITEM, { ...ITEM, entry_id: 'E000003', title: '세 번째' }] };
  mockApi({ 'GET /api/search?limit=50&offset=0': page1, 'GET /api/search?limit=50&offset=2': page2 });
  renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
  expect(await screen.findByText('세 번째')).toBeInTheDocument();
  expect(screen.getAllByText('계류 구조 검토')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
});

test('다른 호선 필터가 걸려 있으면 제안 호선으로 바꾸기를 보인다', async () => {
  mockApi({
    'GET /api/search?q=9999&hull=9998&limit=50&offset=0': RES,
    'GET /api/search?q=9999&hull=9999&limit=50&offset=0': { ...RES },
  });
  renderAt('/?q=9999&hull=9998');
  await userEvent.click(await screen.findByRole('button', { name: /호선 9999 로 바꾸기/ }));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=9999&hull=9999');
  await screen.findByText('결과 2건');
  expect(screen.queryByRole('button', { name: /호선 9999 로/ })).toBeNull();
});

test('파일 결과는 Enter·상세 링크 모두 그 파일을 고른 상세로 간다', async () => {
  mockApi({ 'GET /api/search?unit=file&limit=50&offset=0': FILE_RES, 'GET /api/entries/E000001': ENTRY,
            'GET /api/files/11/text': { state: null, summary: null, chunks: [] } });
  renderAt('/?unit=file');
  await userEvent.click((await screen.findByText('r.pptx')).closest('[role="option"]'));
  const panel = await screen.findByRole('complementary', { name: '미리보기' });
  await within(panel).findByText('계류 구조 검토');
  expect(within(panel).getByRole('link', { name: /상세/ })).toHaveAttribute('href', '/e/E000001?file=11');
  screen.getByRole('listbox', { name: '검색 결과' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByTestId('loc').textContent).toBe('/e/E000001?file=11');
});

test('미리보기가 열리면 좁은 화면용 필터 버튼으로 필터를 펼친다', async () => {
  mockApi({ 'GET /api/search?q=a&limit=50&offset=0': RES, 'GET /api/entries/E000001': ENTRY,
            'GET /api/files/11/text': { state: null, summary: null, chunks: [] } });
  renderAt('/?q=a');
  expect(screen.queryByRole('button', { name: '필터' })).toBeNull();
  await userEvent.click((await screen.findByText('계류 구조 검토')).closest('[role="option"]'));
  await userEvent.click(await screen.findByRole('button', { name: '필터' }));
  const drawer = screen.getByRole('dialog', { name: '필터' });
  expect(within(drawer).getByRole('group', { name: '호선' })).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: '필터 닫기' }));
  expect(screen.queryByRole('dialog', { name: '필터' })).toBeNull();
});
