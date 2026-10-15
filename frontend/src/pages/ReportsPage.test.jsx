import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import ReportsPage, { ReportSearchRedirect } from './ReportsPage.jsx';
import ViewerPage from './ViewerPage.jsx';
import { mockApi } from '../test/mockApi.js';

vi.mock('../components/preview/FilePreview.jsx', () => ({ default: ({ file }) => <div>미리보기: {file.name}</div> }));
vi.mock('../components/compare/CompareBasket.jsx', () => ({ CompareToggle: () => null }));
vi.mock('../components/workbench/WorkbenchSend.jsx', () => ({ SendToWorkbenchButton: () => null }));
const report = { file_id: 11, name: '독립연구.pdf', entry_id: 'E000001', entry_title: '독립 연구',
  scope: 'unclassified', project: null, document_type: '', hulls: [], model_count: 0, snippets: [], posted_at: '2026-10-12T10:00:00' };
// 23 — 문서 분류 목록·빠른 구분 묶음은 서버가 목록 응답으로 내려준다(프런트에 사본 없음)
const OPTIONS = ['해석 보고서', '연구 보고서', '시험 보고서', '기술 검토', '발표자료', '회의자료', '계산서', '지침', '기타'];
const GROUPS = [
  { key: 'report', label: '보고서', values: ['해석 보고서', '연구 보고서', '시험 보고서', '기술 검토', '지침'] },
  { key: 'presentation', label: '발표자료', values: ['발표자료', '회의자료'] },
  { key: 'other', label: '기타', values: ['계산서', '기타', '__none__'] },
];
const list = { total: 1, items: [report], projects: [{ name: '크레인 연구', count: 1 }], no_project: 1,
  scopes: { unclassified: 1, project: 1 }, document_types: {}, document_type_options: OPTIONS, document_type_groups: GROUPS };
// 21 — 소속·프로젝트는 자료 값(파생)이라 읽기만 한다. 보고서별로 저장하는 것은 문서 분류·모델 연결뿐
const catalog = { file_id: 11, entry_id: 'E000001', entry_title: '독립 연구', scope: 'unclassified', project: null,
  hulls: [], no_hull: false, document_type: '', version: 0, related_models: [], can_edit: true };
const entry = { entry_id: 'E000001', title: '독립 연구', files: [{ id: 11, name: report.name, kind: 'report' }] };
const setup = (map = {}, path = '/reports') => {
  const fetch = mockApi({
    'GET /api/reports?limit=50&offset=0': list,
    'GET /api/reports/11/catalog': catalog,
    'GET /api/entries/E000001': entry,
    'GET /api/reports/index-status': { total: 1, ready: 1, embedding_available: false, index_available: true },
    ...map,
  });
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/reports" element={<ReportsPage />} />
    <Route path="/report-search" element={<ReportSearchRedirect />} /><Route path="/v/:fileId" element={<ViewerPage />} /></Routes></MemoryRouter>);
  return fetch;
};

test('문서만 있는 독립 자료를 표시하고 모델 없이 바로 미리본다', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  expect(await screen.findByText('미리보기: 독립연구.pdf')).toBeInTheDocument();
  expect(screen.getByText(/등록된 관련 모델이 없습니다/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '독립 연구' })).toHaveAttribute('href', '/e/E000001?file=11');
});

test('자료 소속·프로젝트는 자료 값에서 보이고 바꾸기는 자료 상세로 보낸다', async () => {
  const user = userEvent.setup();
  setup({ 'GET /api/reports/11/catalog': { ...catalog, scope: 'project', project: '크레인 연구' } });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  expect(await screen.findByText('독립 프로젝트 · 크레인 연구')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '자료 상세에서 변경' })).toHaveAttribute('href', '/e/E000001?file=11');
  await user.click(screen.getByRole('button', { name: '문서 분류·모델 연결' }));
  expect(screen.queryByLabelText('프로젝트명')).not.toBeInTheDocument();
});

test('문서 분류를 보고서(문서) API 로 저장하고 자료(PATCH)를 건드리지 않는다', async () => {
  const user = userEvent.setup();
  const fetch = setup({ 'PUT /api/reports/11/catalog': { ...catalog, document_type: '연구 보고서', version: 1 } });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  await user.click(await screen.findByRole('button', { name: '문서 분류·모델 연결' }));
  await user.selectOptions(screen.getAllByLabelText('문서 분류')[1], '연구 보고서');
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('문서 분류와 모델 연결을 저장했습니다.')).toBeInTheDocument();
  const call = fetch.mock.calls.find(([url, init]) => url === '/api/reports/11/catalog' && init.method === 'PUT');
  expect(JSON.parse(call[1].body)).toEqual({ version: 0, document_type: '연구 보고서', model_ids: [] });
  expect(fetch.mock.calls.some(([, init]) => init.method === 'PATCH')).toBe(false);
});

test('명시적 연결과 같은 자료의 모델을 구분하고 3D 보기로 이동한다', async () => {
  const user = userEvent.setup();
  setup({ 'GET /api/reports/11/catalog': { ...catalog, can_edit: false, related_models: [
    { file_id: 22, name: '사용모델.bdf', relation: 'explicit' },
    { file_id: 23, name: '동봉모델.bdf', relation: 'same_entry' },
  ] } });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  expect(await screen.findByText('문서에 사용한 모델')).toBeInTheDocument();
  expect(screen.getByText('같은 자료의 모델')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '사용모델.bdf' })).toHaveAttribute('href', '/v/22');
  expect(screen.queryByRole('button', { name: '문서 분류·모델 연결' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '자료 상세에서 변경' })).not.toBeInTheDocument();
});

test('문서만(관련 모델 없음) 필터는 서버에 보내고 검색 상태는 주소에 유지한다', async () => {
  const user = userEvent.setup();
  const fetch = setup({ 'GET /api/reports?model=no&limit=50&offset=0': list });
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  await user.selectOptions(screen.getByLabelText('관련 모델'), 'no');
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('/reports?model=no'))).toBe(true));
});

test('프로젝트는 여러 개를 고를 수 있고(또는) 주소에 되풀이해 보낸다', async () => {
  const user = userEvent.setup();
  const two = { ...list, projects: [{ name: '크레인 연구', count: 1 }, { name: '풍하중 연구', count: 2 }] };
  const fetch = setup({
    'GET /api/reports?limit=50&offset=0': two,
    'GET /api/reports?project=%ED%81%AC%EB%A0%88%EC%9D%B8+%EC%97%B0%EA%B5%AC&limit=50&offset=0': two,
    'GET /api/reports?project=%ED%81%AC%EB%A0%88%EC%9D%B8+%EC%97%B0%EA%B5%AC&project=%ED%92%8D%ED%95%98%EC%A4%91+%EC%97%B0%EA%B5%AC&limit=50&offset=0': two,
  });
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  await user.selectOptions(screen.getByRole('combobox', { name: '프로젝트' }), '크레인 연구');
  await screen.findByRole('button', { name: '프로젝트 크레인 연구 거르기 해제' });
  await user.selectOptions(screen.getByRole('combobox', { name: '프로젝트' }), '풍하중 연구');
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('project=%ED%81%AC%EB%A0%88%EC%9D%B8+%EC%97%B0%EA%B5%AC&project=%ED%92%8D'))).toBe(true));
  await user.click(screen.getByRole('button', { name: '프로젝트 크레인 연구 거르기 해제' }));
  expect(screen.queryByRole('button', { name: '프로젝트 크레인 연구 거르기 해제' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '프로젝트 풍하중 연구 거르기 해제' })).toBeInTheDocument();
});

test('접근 불가 문서는 빈 미리보기 대신 오류와 재시도를 표시한다', async () => {
  setup({ 'GET /api/reports/99/catalog': { __status: 404, detail: 'report_not_found' } }, '/reports?file=99');
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('문서를 찾을 수 없습니다.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument();
});

test('다른 자료의 모델을 검색하여 선택한 파일 ID를 연결한다', async () => {
  const user = userEvent.setup();
  const model = { file_id: 22, name: 'crane.bdf', entry_id: 'E000002' };
  const fetch = setup({
    'GET /api/search?unit=file&kind=model&q=crane&limit=50': { items: [model] },
    'PUT /api/reports/11/catalog': { ...catalog, version: 1, related_models: [{ ...model, relation: 'explicit' }] },
  });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  await user.click(await screen.findByRole('button', { name: '문서 분류·모델 연결' }));
  await user.type(screen.getByRole('textbox', { name: '연결할 모델 검색' }), 'crane');
  await user.click(screen.getByRole('button', { name: '모델 찾기' }));
  await user.click(await screen.findByRole('button', { name: '연결', exact: true }));
  await user.click(screen.getByRole('button', { name: '저장', exact: true }));
  expect(await screen.findByText('문서에 사용한 모델')).toBeInTheDocument();
  const call = fetch.mock.calls.find(([url, init]) => url === '/api/reports/11/catalog' && init.method === 'PUT');
  expect(JSON.parse(call[1].body).model_ids).toEqual([22]);
});

test('실제 모델 뷰어를 닫으면 문서 검색 조건과 선택 파일을 유지한다', async () => {
  const user = userEvent.setup();
  setup({
    'GET /api/reports?model=yes&limit=50&offset=0': { ...list, items: [{ ...report, model_count: 1 }] },
    'GET /api/reports/11/catalog': { ...catalog, related_models: [{ file_id: 22, name: 'crane.bdf', relation: 'explicit' }] },
    'GET /api/files/22': { id: 22, name: 'crane.bdf', kind: 'model', entry_id: 'E000002' },
    'GET /api/files/22/model': { state: 'queued', has_lbm: false },
  }, '/reports?model=yes&file=11');
  await user.click(await screen.findByRole('link', { name: 'crane.bdf' }));
  await screen.findByRole('heading', { name: 'crane.bdf' });
  await user.click(screen.getByRole('button', { name: '닫기', exact: true }));
  expect(await screen.findByText('미리보기: 독립연구.pdf')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '관련 모델' })).toHaveValue('yes');
  expect(screen.getByRole('button', { name: /독립연구.pdf/ })).toHaveAttribute('aria-pressed', 'true');
});

// ---- 22 — 본문 검색(보고서 화면 안의 검색 방식) ----
const endpoint = (pairs) => 'GET /api/reports?' + new URLSearchParams(pairs);

test('키워드 일치와 의미 추천을 나누고 원문 위치·강조를 보인다', async () => {
  setup({ [endpoint([['q', '계류'], ['retrieval', 'hybrid'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]: {
    ...list, total: 2, keyword_total: 1, semantic_total: 1, semantic_available: true,
    items: [{ ...report, match_type: 'keyword', snippets: [{ locator: 'page:12', text: '계류 하중', highlights: [[0, 2]] }, { locator: 'sheet:강도:row:5', text: '응력 계산' }] },
      { ...report, file_id: 12, name: '검토.pptx', match_type: 'semantic', snippets: [{ locator: 'slide:3', text: '접안 장치 하중' }] }] } },
  '/reports?q=계류&retrieval=hybrid');
  expect(await screen.findByText(/키워드 일치/, { selector: 'p' })).toHaveTextContent('문서 2개 · 키워드 일치 1개 · 의미 추천 1개');
  expect(screen.getByText('12쪽')).toBeInTheDocument();
  expect(screen.getByText('시트 강도 · 5행')).toBeInTheDocument();
  expect(screen.getByText('슬라이드 3')).toBeInTheDocument();
  expect(screen.getByText('의미상 관련 추천')).toBeInTheDocument();
  expect(screen.getByText('계류', { selector: 'mark' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '의미 추천 포함' })).toBeChecked();
  expect(screen.getByRole('combobox', { name: '정렬' })).toHaveValue('relevance');
});

test('의미 추천 포함을 켜면 주소·요청에 retrieval=hybrid 가 붙는다', async () => {
  const user = userEvent.setup();
  const fetch = setup({ [endpoint([['q', '계류'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]: { ...list, keyword_total: 1 },
    [endpoint([['q', '계류'], ['retrieval', 'hybrid'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]: { ...list, keyword_total: 1, semantic_total: 0, semantic_available: true } },
  '/reports?q=계류');
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  await user.click(screen.getByRole('checkbox', { name: '의미 추천 포함' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('retrieval=hybrid'))).toBe(true));
});

test('의미 추천 서버 장애는 내부 오류 문구 없이 키워드 결과로 안내한다', async () => {
  setup({ [endpoint([['q', '계류'], ['retrieval', 'hybrid'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]:
    { ...list, keyword_total: 1, semantic_total: 0, semantic_available: false, semantic_error: 'SECRET backend path' } },
  '/reports?q=계류&retrieval=hybrid');
  expect(await screen.findByText(/의미 추천 서버를 사용할 수 없어/)).toBeInTheDocument();
  expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
});

test('색인 상태 띠: 완료·실패·일부 추출·갱신 대기와 의미 추천 준비 수, 행별 색인 상태', async () => {
  setup({
    'GET /api/reports/index-status': { total: 5, ready: 2, pending: 1, failed: 1, partial: 1, stale: 2, embedding_available: true, embedding_ready: 0, index_available: true },
    'GET /api/reports?limit=50&offset=0': { ...list, items: [{ ...report, index_state: 'failed' }] },
  });
  expect(await screen.findByText('의미 추천 준비 0 / 5개')).toBeInTheDocument();
  expect(screen.getByText('실패 1개')).toBeInTheDocument();
  expect(screen.getByText('일부 추출 1개')).toBeInTheDocument();
  expect(screen.getByText('갱신 대기 2개')).toBeInTheDocument();
  expect(screen.getByText('본문 색인: 실패')).toBeInTheDocument();
  expect(screen.getByText(/OCR 포함 본문 검색은 이 문서 화면에서/)).toBeInTheDocument();
});

test('색인을 쓸 수 없으면 목록은 그대로 두고 제한을 알린다', async () => {
  setup({ 'GET /api/reports/index-status': { __status: 500, detail: 'x' } });
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  expect(await screen.findByText(/본문 색인을 사용할 수 없어/)).toBeInTheDocument();
});

test('문구 조건과 반복 프로젝트 필터를 함께 보낸다', async () => {
  const fetch = setup({ [endpoint([['q', '계류 하중'], ['mode', 'phrase'], ['project', '크레인 연구'], ['project', '계류 연구'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]: list },
    '/reports?q=계류+하중&project=크레인+연구&project=계류+연구&mode=phrase');
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  expect(screen.getByRole('combobox', { name: '검색 조건' })).toHaveValue('phrase');
  expect(screen.getByRole('button', { name: '프로젝트 크레인 연구 거르기 해제' })).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/reports?') && new URLSearchParams(url.split('?')[1]).getAll('project').length === 2)).toBe(true);
});

test('근거 요약은 단추를 눌렀을 때만 선택 파일로 요청하고 근거 위치를 보인다', async () => {
  const user = userEvent.setup();
  const fetch = setup({ 'POST /api/reports/answer': { answer: '응력 검토 결과 [S1]', truncated: true,
    citations: [{ id: 'S1', file_id: 11, name: report.name, locator: 'page:2', text: '허용 응력 이내' }] } });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  const button = await screen.findByRole('button', { name: '이 문서 근거로 요약' });
  expect(fetch.mock.calls.some(([url]) => url === '/api/reports/answer')).toBe(false);
  await user.click(button);
  expect(await screen.findByText('응력 검토 결과 [S1]')).toBeInTheDocument();
  expect(screen.getByText('[S1] 독립연구.pdf · 2쪽')).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls.find(([url]) => url === '/api/reports/answer')[1].body).file_ids).toEqual([11]);
});

test('요약이 몰리면(429) 기다리라고 안내한다', async () => {
  const user = userEvent.setup();
  setup({ 'POST /api/reports/answer': { __status: 429, detail: 'rag_busy' } });
  await user.click(await screen.findByRole('button', { name: /독립연구.pdf/ }));
  await user.click(await screen.findByRole('button', { name: '이 문서 근거로 요약' }));
  expect(await screen.findByText(/다른 사용자의 요약이 진행 중/)).toBeInTheDocument();
});

test('옛 /report-search 주소는 질의를 들고 문서 화면으로 옮겨 온다', async () => {
  const fetch = setup({ [endpoint([['q', '계류'], ['retrieval', 'hybrid'], ['sort', 'relevance'], ['limit', '50'], ['offset', '0']])]:
    { ...list, keyword_total: 1, semantic_total: 0, semantic_available: true } }, '/report-search?q=계류&retrieval=hybrid');
  expect(await screen.findByRole('heading', { name: '문서' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: '문서 검색어' })).toHaveValue('계류');
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/reports?q='))).toBe(true));
});

test('색인 상태는 화면이 보일 때만 1분마다 묻는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  try {
    const fetch = setup();
    await screen.findByRole('button', { name: /독립연구.pdf/ });
    const count = () => fetch.mock.calls.filter(([url]) => url === '/api/reports/index-status').length;
    expect(count()).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(count()).toBe(2);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(180000);
    expect(count()).toBe(2);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(count()).toBe(3));
  } finally {
    visibility.mockRestore();
    vi.useRealTimers();
  }
});

// ---- 23 — 문서 분류 확장·발표 파일 자동 분류·빠른 구분 ----
const typeUrl = (types) => endpoint([...types.map((t) => ['document_type', t]), ['limit', '50'], ['offset', '0']]);
const counted = { ...list, document_types: { '해석 보고서': 3, 지침: 1, 발표자료: 4, 회의자료: 1, 계산서: 2, '': 5 } };

test('빠른 구분은 문서 분류 값을 묶어 주소에 남기고 묶음별 건수를 보인다', async () => {
  const user = userEvent.setup();
  const presentation = ['발표자료', '회의자료'];
  const fetch = setup({ 'GET /api/reports?limit=50&offset=0': counted, [typeUrl(presentation)]: counted,
    [typeUrl(['계산서', '기타', '__none__'])]: counted });
  const group = await screen.findByRole('group', { name: '문서 빠른 구분' });
  await waitFor(() => expect(within(group).getByRole('button', { name: /^전체/ })).toHaveTextContent('전체16'));
  expect(within(group).getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(group).getByRole('button', { name: /^보고서/ })).toHaveTextContent('보고서4');
  expect(within(group).getByRole('button', { name: /^발표자료/ })).toHaveTextContent('발표자료5');
  expect(within(group).getByRole('button', { name: /^기타/ })).toHaveTextContent('기타7');   // 계산서 2 + 미분류 5
  await user.click(within(group).getByRole('button', { name: /^발표자료/ }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/reports?' + new URLSearchParams(
    [['document_type', '발표자료'], ['document_type', '회의자료'], ['limit', '50'], ['offset', '0']]))).toBe(true));
  expect(within(group).getByRole('button', { name: /^발표자료/ })).toHaveAttribute('aria-pressed', 'true');
  // 같은 값이 문서 분류 거르기 칩으로도 보인다(하나를 빼면 빠른 구분은 풀린다)
  expect(screen.getByRole('button', { name: '문서 분류 회의자료 거르기 해제' })).toBeInTheDocument();
  await user.click(within(group).getByRole('button', { name: /^기타/ }));
  expect(await screen.findByRole('button', { name: '문서 분류 미분류 거르기 해제' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '문서 분류 회의자료 거르기 해제' })).not.toBeInTheDocument();
});

test('주소의 문서 분류 값으로 빠른 구분이 켜지고, 다른 조합이면 어느 묶음도 켜지지 않는다', async () => {
  setup({ [typeUrl(['계산서'])]: counted }, '/reports?document_type=계산서');
  const group = await screen.findByRole('group', { name: '문서 빠른 구분' });
  for (const name of [/^전체/, /^보고서/, /^발표자료/, /^기타/]) {
    expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
  }
  expect(screen.getByRole('button', { name: '문서 분류 계산서 거르기 해제' })).toBeInTheDocument();
});

test('문서 분류 거르기는 여러 값을 고를 수 있고 새 분류(발표자료·회의자료·계산서)가 서버 목록 순서대로 보인다', async () => {
  const user = userEvent.setup();
  const fetch = setup({ [typeUrl(['계산서'])]: list, [typeUrl(['계산서', '회의자료'])]: list });
  await screen.findByRole('button', { name: /독립연구.pdf/ });
  const select = screen.getByRole('combobox', { name: '문서 분류' });
  expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['', ...OPTIONS, '__none__']);
  await user.selectOptions(select, '계산서');
  await screen.findByRole('button', { name: '문서 분류 계산서 거르기 해제' });
  await user.selectOptions(screen.getByRole('combobox', { name: '문서 분류' }), '회의자료');
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/reports?' + new URLSearchParams(
    [['document_type', '계산서'], ['document_type', '회의자료'], ['limit', '50'], ['offset', '0']]))).toBe(true));
});

test('저장되지 않은 발표 파일은 발표자료(자동)로 보이고, 저장하면 그 값으로 확정한다', async () => {
  const user = userEvent.setup();
  const pptx = { ...report, file_id: 12, name: '중간발표.pptx', document_type: '발표자료', document_type_auto: true };
  const auto = { ...catalog, file_id: 12, document_type: '발표자료', document_type_auto: true };
  const fetch = setup({
    'GET /api/reports?limit=50&offset=0': { ...list, items: [pptx] },
    'GET /api/reports/12/catalog': auto,
    'GET /api/entries/E000001': { ...entry, files: [{ id: 12, name: pptx.name, kind: 'report' }] },
    'PUT /api/reports/12/catalog': { ...auto, document_type_auto: false, version: 1 },
  });
  const row = await screen.findByRole('button', { name: /중간발표.pptx/ });
  expect(within(row).getByText('자동')).toBeInTheDocument();
  await user.click(row);
  await user.click(await screen.findByRole('button', { name: '문서 분류·모델 연결' }));
  expect(screen.getAllByLabelText('문서 분류')[1]).toHaveValue('발표자료');
  expect(screen.getByText(/파일 형식\(.ppt·.pptx\)으로 미리 채운 값입니다/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('문서 분류와 모델 연결을 저장했습니다.')).toBeInTheDocument();
  const call = fetch.mock.calls.find(([url, init]) => url === '/api/reports/12/catalog' && init.method === 'PUT');
  expect(JSON.parse(call[1].body)).toEqual({ version: 0, document_type: '발표자료', model_ids: [] });
  expect(within(screen.getByRole('complementary', { name: '문서 미리보기' })).queryByText('자동')).not.toBeInTheDocument();
});
