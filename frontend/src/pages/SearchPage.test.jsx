import { render, screen, waitFor, within } from '@testing-library/react';
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
  expect(within(screen.getByRole('listbox', { name: '검색 결과' })).getByRole('option', { selected: true })).toHaveTextContent('초안 자료');
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
    expect(within(screen.getByRole('listbox', { name: '검색 결과' })).getByRole('option', { selected: true })).toHaveTextContent('초안 자료');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    await userEvent.keyboard('{Home}');
    expect(within(screen.getByRole('listbox', { name: '검색 결과' })).getByRole('option', { selected: true })).toHaveTextContent('계류 구조 검토');
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

test('적용된 필터 칩으로 필터를 하나씩 해제한다', async () => {
  mockApi({
    'GET /api/search?q=a&hull=9999&limit=50&offset=0': { ...RES, hull_suggestion: null },
    'GET /api/search?q=a&limit=50&offset=0': { ...RES, hull_suggestion: null },
  });
  renderAt('/?q=a&hull=9999');
  await userEvent.click(await screen.findByRole('button', { name: '호선 9999 필터 해제' }));
  expect(screen.getByTestId('loc').textContent).toBe('/?q=a');
});

test('고른 결과는 선택 표시되고, Esc 로 미리보기를 닫는다', async () => {
  mockApi({ 'GET /api/search?q=a&limit=50&offset=0': RES, 'GET /api/entries/E000001': ENTRY,
            'GET /api/files/11/text': { state: null, summary: null, chunks: [] } });
  renderAt('/?q=a');
  const row = (await screen.findByText('계류 구조 검토')).closest('[role="option"]');
  await userEvent.click(row);
  expect(row).toHaveAttribute('aria-selected', 'true');
  expect(row).toHaveClass('bg-brand-subtle');
  await screen.findByRole('complementary', { name: '미리보기' });
  screen.getByRole('listbox', { name: '검색 결과' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: '미리보기' })).toBeNull();
});

test('검색 오류에서 다시 시도하면 같은 검색을 다시 보낸다', async () => {
  let n = 0;
  const fetch = mockApi({ 'GET /api/search?q=a&limit=50&offset=0': () => (++n === 1 ? { __status: 500, detail: 'x' } : { ...RES, hull_suggestion: null }) });
  renderAt('/?q=a');
  expect(await screen.findByRole('alert')).toHaveTextContent('검색하지 못했습니다');
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(calls(fetch).filter((c) => c === 'GET /api/search?q=a&limit=50&offset=0')).toHaveLength(2);
});

test('파일 보기의 모델 행에는 변환된 것만 썸네일을 보인다', async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
  const model = { ...FILE_RES.items[0], kind: 'model' };
  const res = { ...FILE_RES, items: [...FILE_RES.items,
    { ...model, file_id: 12, name: 'm.bdf', rel_path: 'model/m.bdf', model_state: 'done', model_key: 'k12' },
    // 다시 변환 대기 중이지만 이전 결과가 있다
    { ...model, file_id: 13, name: 'old.bdf', rel_path: 'old.bdf', model_state: 'queued', model_key: 'k13' },
    // 아직 한 번도 변환되지 않았다 — 썸네일 요청을 하지 않는다
    { ...model, file_id: 14, name: 'new.bdf', rel_path: 'new.bdf', model_state: 'queued', model_key: null }] };
  const fetch = mockApi({ 'GET /api/search?unit=file&limit=50&offset=0': res,
            'GET /api/files/12/thumb.png': { __blob: new Blob(['png']) },
            'GET /api/files/13/thumb.png': { __blob: new Blob(['png']) } });
  renderAt('/?unit=file');
  const row = (name) => screen.getByText(name).closest('[role="option"]');
  await screen.findByText('m.bdf');
  // 썸네일은 장식(이름이 바로 옆에 있다) — alt="" 라 역할로 찾지 않는다.
  await waitFor(() => expect(row('m.bdf').querySelector('img')).toHaveAttribute('src', 'blob:thumb'));
  expect(row('m.bdf').querySelector('img')).toHaveAttribute('alt', '');
  await waitFor(() => expect(row('old.bdf').querySelector('img')).toBeTruthy());
  expect(row('new.bdf').querySelector('img')).toBeNull();
  expect(row('r.pptx').querySelector('img')).toBeNull();
  expect(calls(fetch)).not.toContain('GET /api/files/14/thumb.png');
});

const ROW = { ...ITEM, entry_id: 'E000005', title: '선미 구조 국부 강도', hulls: ['9002'], ship_types: ['벌크선'],
  zones: ['선미부'], analysis_type: 'FE 해석', analysis_period: '2026-01', tags: ['응력'], snippets: [],
  kind_counts: { model: 2, report: 1, drawing: 0, result: 0, other: 0 }, thumb: null };

test('결과 한 행 — 통제 값 줄·종류별 파일 수·태그 링크·해석 시기(08)', async () => {
  mockApi({ 'GET /api/search?limit=50&offset=0': { ...RES, terms: [], hull_suggestion: null, items: [ROW, { ...ROW, entry_id: 'E000006', analysis_period: null, tags: [] }] } });
  renderAt('/');
  const row = (await screen.findAllByText('선미 구조 국부 강도'))[0].closest('[role="option"]');
  expect(within(row).getByRole('link', { name: '9002' })).toBeInTheDocument();
  expect(within(row).getByText('선미부 · FE 해석 · 벌크선')).toBeInTheDocument();
  expect(within(row).getByLabelText('파일 BDF 2, 보고서 1, 도면 0, 결과 0')).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: '#응력' })).toHaveAttribute('href', '/?tag=%EC%9D%91%EB%A0%A5');
  expect(row).toHaveTextContent('해석 2026-01');
  expect(screen.getByText('해석 시기 미입력')).toBeInTheDocument();
});

test('호선 하나로 거른 검색이면 그 호선 칩은 행에서 뺀다', async () => {
  mockApi({ 'GET /api/search?hull=9002&limit=50&offset=0': { ...RES, terms: [], hull_suggestion: null, items: [ROW], applied_filters: { hull: '9002' } } });
  renderAt('/?hull=9002');
  const row = (await screen.findByText('선미 구조 국부 강도')).closest('[role="option"]');
  expect(within(row).queryByRole('link', { name: '9002' })).toBeNull();
});

test('정렬 — 기본은 검색어가 없으면 해석 시기, 바꾸면 주소에 담는다', async () => {
  mockApi({
    'GET /api/search?limit=50&offset=0': { ...RES, hull_suggestion: null },
    'GET /api/search?sort=recent&limit=50&offset=0': { ...RES, hull_suggestion: null },
  });
  renderAt('/');
  const sort = await screen.findByRole('combobox', { name: '정렬' });
  expect(sort).toHaveValue('period');
  await userEvent.selectOptions(sort, 'recent');
  expect(screen.getByTestId('loc').textContent).toBe('/?sort=recent');
  await userEvent.selectOptions(sort, 'period');
  expect(screen.getByTestId('loc').textContent).toBe('/');
});

test('해석 연도 필터의 시기 미상과 태그 필터 이름', async () => {
  mockApi({ 'GET /api/search?year=unknown&tag=%EC%9D%91%EB%A0%A5&limit=50&offset=0': { ...RES, hull_suggestion: null,
    facets: { ...FACETS, year: [{ value: '2026', count: 1 }, { value: 'unknown', count: 1 }], tag: [{ value: '응력', count: 1 }] } } });
  renderAt('/?year=unknown&tag=응력');
  expect(await screen.findByRole('button', { name: '해석 연도 시기 미상 필터 해제' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '태그 응력 필터 해제' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: '해석 연도' })).getByText('시기 미상')).toBeInTheDocument();
});
