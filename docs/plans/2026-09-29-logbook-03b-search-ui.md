# Logbook 03b — 검색·호선·Entry 상세·태그 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 03a API 위에 화면을 만든다.
- 검색(홈): 입력 즉시 결과, 필터 건수, 오른쪽 미리보기 패널
- 호선 목록·호선 화면: 통계, 월별 타임라인
- Entry 상세: 인라인 수정, 파일 트리, PDF·PPTX·XLSX 미리보기, 경로 복사, 변경 이력, 파일 추가
- 태그 화면: 동의어 묶기·풀기

**Architecture:**
- 검색 상태는 **주소(`/?q=…&hull=…`)가 원본**이다. 그래서 메신저로 공유하면 같은 결과가 열린다(설계 §6.1 고정 링크).
  - 상단 바 검색창은 입력 200ms 뒤 주소를 바꾼다. 검색 화면은 주소가 바뀔 때마다 `/api/search` 를 부른다. 늦게 온 옛 응답은 버린다.
- 미리보기와 내려받기는 `POST /api/files/{id}/link` 로 받은 10분짜리 주소를 쓴다.
  - PDF 는 그 주소(`inline=1`)를 `<iframe>` 에 넣어 크롬 내장 뷰어로 본다. pdf.js 를 추가하지 않는다.
  - PPTX·DOCX 는 추출된 본문(`/text`)을, XLSX 는 `/sheet` 표를 보여 준다.
- 사내 서버는 `http://`(보안 컨텍스트 아님)라 `navigator.clipboard` 가 없다. 경로 복사는 `textarea + execCommand('copy')` 로 대체한다.

**Tech Stack:** React 19 · react-router 7 · Tailwind v4 · lucide-react · Vitest 5 + Testing Library

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md` §6.1(화면·주소), §6.2(검색·필터 건수·4자리 호선 제안·보기 단위·Ctrl+K), §6.3(미리보기·경로 복사), §6.4(디자인), §5.6(기존 Entry 에 추가), §8(수정은 누구나·휴지통)

**API 모양:** `docs/plans/2026-09-29-logbook-03a-search-backend.md`
- 검색 응답: `{unit,total,items,facets,hull_suggestion,terms}`
- Entry 상세: `files[].extract`, `tags`, `vault_unc`
- `/entries/{id}/history`
- `/hulls`, `/hulls/{no}`: `{stats,timeline,drafts}`
- `/tags`
- `/files/{id}/link|text|sheet`

---

## 공통 규칙 (모든 태스크)

- 프런트 명령은 `C:\Coding\Logbook\frontend` 에서 실행한다. 테스트는 `npx vitest run <파일>`, 전체는 `npm test`, 빌드는 `npm run build` 다.
- **git 명령 금지**, **`backend\.env` 열기 금지**(어떤 방법으로도).
- 색은 `index.css` 토큰만 쓴다: `brand` `brand-dark` `brand-tint` `brand-ring` `ok` `wait` `err` `canvas` `line` `viewer`. 그 밖에는 zinc 계열만 쓴다. 파일 종류 배지는 기존 `KindBadge` 를 쓴다.
- 숫자·ID·경로는 `font-mono`, 본문 14px, 목록 13px, 모서리 `rounded-md`/`rounded-lg`.
- 아이콘만 있는 버튼에는 `aria-label` 을 단다. 상태는 색 + 글자로 겹쳐 표시한다(미확정 = `text-wait` + "미확정").
- 화면 문구·주석은 한국어로 쓴다. API 오류는 `errorText(err, 대체문구)` 로 보인다.
- 테스트의 fetch 가짜는 Task 1 의 `src/test/mockApi.js` 를 쓴다. 새로 만드는 테스트만 쓰고, 기존 테스트는 그대로 둔다.
- 실제 호선·기밀 자료 금지. 가상 호선 `9999`·`9998`.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `frontend/src/test/mockApi.js` (새) | 테스트용 fetch 가짜(`METHOD 경로` → 응답) |
| `frontend/src/lib/labels.js` (수정) | 새 오류·감사 동작·필터·추출 상태 라벨, `formatDateTime` |
| `frontend/src/lib/search.js` (새) | 주소 ↔ 검색 상태, API 질의, 위치 라벨, 강조 조각 |
| `frontend/src/lib/files.js` (새) | 내려받기 링크·내려받기·UNC 경로·복사 |
| `frontend/src/lib/tree.js` (새) | rel_path → 폴더 트리 |
| `frontend/src/lib/useEntry.js` (새) | Entry 불러오기·순차 저장(version) 훅 |
| `frontend/src/components/ui/Highlight.jsx` (새) | 발췌문 강조 |
| `frontend/src/components/ui/InlineText.jsx` (새) | 눌러서 고치는 글자 칸 |
| `frontend/src/components/preview/SummaryCard.jsx` (새) | 요약 카드 |
| `frontend/src/components/preview/FilePreview.jsx` (새) | 형식별 미리보기 + 내려받기·경로 복사 |
| `frontend/src/components/search/FacetPanel.jsx` (새) | 필터와 건수 |
| `frontend/src/components/search/ResultList.jsx` (새) | Entry/파일 결과 목록 |
| `frontend/src/components/search/EntryPreviewPanel.jsx` (새) | 오른쪽 미리보기 패널 |
| `frontend/src/components/shell/TopBar.jsx` (수정) | 입력 즉시 주소 반영, 주소 → 입력칸 동기화 |
| `frontend/src/components/inbox/UploadZone.jsx` (수정) | `targetEntryId` 받기 |
| `frontend/src/pages/SearchPage.jsx` (새) | `/` |
| `frontend/src/pages/EntryPage.jsx` (새) | `/e/:entryId` |
| `frontend/src/pages/HullsPage.jsx`·`HullPage.jsx` (새) | `/hulls`, `/h/:hullNo` |
| `frontend/src/pages/TagsPage.jsx` (새) | `/tags` |
| `frontend/src/App.jsx` (수정) | 라우트, PlaceholderPage 제거 |
| `frontend/src/components/shell/SideNav.jsx` (수정) | `/h/…` 에서도 '호선' 활성 |

---

### Task 1: 공용 도구 — 테스트 가짜, 라벨, 검색·파일·트리 함수

**Files:**
- Create: `frontend/src/test/mockApi.js`, `frontend/src/lib/search.js`, `frontend/src/lib/files.js`, `frontend/src/lib/tree.js`
- Modify: `frontend/src/lib/labels.js`
- Test: `frontend/src/lib/search.test.js`, `frontend/src/lib/files.test.js`, `frontend/src/lib/tree.test.js`, `frontend/src/lib/labels.test.js`(추가)

- [ ] **Step 1: 테스트 가짜 작성**

`frontend/src/test/mockApi.js`:

```js
import { vi } from 'vitest';

/**
 * fetch 가짜. map 의 열쇠는 `METHOD /api/경로?질의` (질의 포함 전체 주소).
 * 값: 객체·배열(200 JSON) | { __status, detail }(오류) | (init) => 값(동적) | Promise.
 * 등록되지 않은 요청은 실패시켜 테스트가 놓친 호출을 드러낸다.
 */
export function mockApi(map) {
  const fn = vi.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    let r = map[key];
    if (typeof r === 'function') r = await r(init);
    if (r === undefined) throw new Error(`unmocked ${key}`);
    if (r && r.__status) {
      return { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) };
    }
    return { ok: true, status: 200, json: () => Promise.resolve(r) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const calls = (fn) => fn.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
```

- [ ] **Step 2: 실패하는 테스트 작성**

`frontend/src/lib/search.test.js`:

```js
import { apiQuery, highlightParts, locatorLabel, readSearch, writeSearch } from './search.js';

test('주소 ↔ 검색 상태', () => {
  const s = readSearch(new URLSearchParams('q=9999%20강도&hull=9999&unit=file&drafts=1&bogus=x'));
  expect(s).toEqual({ q: '9999 강도', unit: 'file', drafts: true, filters: { hull: '9999' } });
  expect(writeSearch(s).toString()).toBe('q=9999+%EA%B0%95%EB%8F%84&unit=file&drafts=1&hull=9999');
  expect(readSearch(new URLSearchParams(''))).toEqual({ q: '', unit: 'entry', drafts: false, filters: {} });
});

test('API 질의는 drafts=true 와 쪽 정보를 붙인다', () => {
  const s = { q: 'a', unit: 'entry', drafts: true, filters: { zone: '선수부' } };
  expect(apiQuery(s, { offset: 50 })).toBe('/search?q=a&drafts=true&zone=%EC%84%A0%EC%88%98%EB%B6%80&limit=50&offset=50');
});

test('위치 라벨', () => {
  expect(locatorLabel('page:3')).toBe('3쪽');
  expect(locatorLabel('slide:5')).toBe('슬라이드 5');
  expect(locatorLabel('notes:5')).toBe('슬라이드 5 노트');
  expect(locatorLabel('sheet:응력:A')).toBe('시트 응력:A');
  expect(locatorLabel('body')).toBe('본문');
});

test('강조 조각 — 위치는 서버(파이썬) 글자 수 기준', () => {
  expect(highlightParts('구조 강도 평가', [[3, 5]])).toEqual([
    { text: '구조 ', hit: false }, { text: '강도', hit: true }, { text: ' 평가', hit: false }]);
  // 이모지(서로게이트 쌍)가 앞에 있어도 파이썬 글자 위치로 자른다
  expect(highlightParts('😀강도', [[1, 3]])).toEqual([{ text: '😀', hit: false }, { text: '강도', hit: true }]);
  expect(highlightParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
});
```

`frontend/src/lib/files.test.js`:

```js
import { vi } from 'vitest';
import { mockApi } from '../test/mockApi.js';
import { copyText, fileLink, uncPath } from './files.js';

test('UNC 경로를 만든다', () => {
  expect(uncPath('\\\\srv\\999_LogBook\\10_Vault\\2026\\E000001', 'a/b c.pdf'))
    .toBe('\\\\srv\\999_LogBook\\10_Vault\\2026\\E000001\\files\\a\\b c.pdf');
  expect(uncPath(null, 'a.pdf')).toBe('');
});

test('내려받기 링크를 받는다', async () => {
  mockApi({ 'POST /api/files/7/link?inline=true': { url: '/api/files/7/content?t=x&inline=1' } });
  expect(await fileLink(7, { inline: true })).toBe('/api/files/7/content?t=x&inline=1');
});

test('clipboard 가 없으면 execCommand 로 복사한다', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
  document.execCommand = vi.fn(() => true);
  expect(await copyText('\\\\srv\\a')).toBe(true);
  expect(document.execCommand).toHaveBeenCalledWith('copy');
});
```

`frontend/src/lib/tree.test.js`:

```js
import { buildTree } from './tree.js';

test('rel_path 를 폴더 트리로 — 폴더 먼저, 이름순', () => {
  const files = [{ id: 1, rel_path: 'b.pdf' }, { id: 2, rel_path: 'model/m.bdf' }, { id: 3, rel_path: 'model/inc/x.bdf' },
                 { id: 4, rel_path: 'a.pdf' }];
  const t = buildTree(files);
  expect(t.map((n) => n.name)).toEqual(['model', 'a.pdf', 'b.pdf']);
  expect(t[0].children.map((n) => n.name)).toEqual(['inc', 'm.bdf']);
  expect(t[0].children[0].children[0].file.id).toBe(3);
  expect(t[0].path).toBe('model');
});
```

`frontend/src/lib/labels.test.js` 끝에 추가:

```js
import { formatDateTime } from './labels.js';

test('03 오류·동작 라벨과 날짜 표시', () => {
  expect(errorText({ detail: 'link_invalid' })).toMatch('링크');
  expect(errorText({ detail: 'hull_not_found' })).toMatch('호선');
  expect(ACTION_LABELS.TAG_ALIAS).toBe('동의어 묶기');
  expect(formatDateTime('2026-09-29T12:33:05')).toBe('2026-09-29 12:33');
  expect(formatDateTime(null)).toBe('—');
});
```

(파일 머리의 import 에 `ACTION_LABELS`·`errorText` 가 이미 없으면 함께 import 한다.)

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib`
Expected: FAIL — `search.js`·`files.js`·`tree.js` 없음, `formatDateTime` 없음

- [ ] **Step 4: 구현**

`frontend/src/lib/search.js`:

```js
/** 검색 상태는 주소가 원본이다(메신저로 공유하면 같은 결과가 열린다 — 설계 §6.1). */
export const FILTER_KEYS = ['hull', 'ship_type', 'analysis_type', 'zone', 'year', 'uploaded_by', 'kind'];

export function readSearch(params) {
  const filters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  return { q: params.get('q') || '', unit: params.get('unit') === 'file' ? 'file' : 'entry',
           drafts: params.get('drafts') === '1', filters };
}

export function writeSearch({ q = '', unit = 'entry', drafts = false, filters = {} }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (unit === 'file') p.set('unit', 'file');
  if (drafts) p.set('drafts', '1');
  for (const k of FILTER_KEYS) if (filters[k]) p.set(k, filters[k]);
  return p;
}

export function apiQuery(state, { limit = 50, offset = 0 } = {}) {
  const p = writeSearch(state);
  if (p.has('drafts')) p.set('drafts', 'true');
  p.set('limit', String(limit));
  p.set('offset', String(offset));
  return `/search?${p}`;
}

export function locatorLabel(loc) {
  if (loc === 'body') return '본문';
  const i = loc.indexOf(':');
  const kind = i < 0 ? loc : loc.slice(0, i);
  const rest = i < 0 ? '' : loc.slice(i + 1);
  switch (kind) {
    case 'page': return `${rest}쪽`;
    case 'slide': return `슬라이드 ${rest}`;
    case 'notes': return `슬라이드 ${rest} 노트`;
    case 'sheet': return `시트 ${rest}`;
    default: return loc;
  }
}

/** 서버 강조 위치는 파이썬 글자(코드 포인트) 기준이라 Array.from 으로 자른다(UTF-16 과 다름). */
export function highlightParts(text, highlights = []) {
  const chars = Array.from(text);
  const parts = [];
  let pos = 0;
  for (const [a, b] of highlights) {
    if (a > pos) parts.push({ text: chars.slice(pos, a).join(''), hit: false });
    parts.push({ text: chars.slice(a, b).join(''), hit: true });
    pos = b;
  }
  if (pos < chars.length) parts.push({ text: chars.slice(pos).join(''), hit: false });
  return parts;
}
```

`frontend/src/lib/files.js`:

```js
import { api } from '../api/client.js';

/** 10분짜리 내려받기 주소(iframe·a 는 Authorization 헤더를 못 붙여서 토큰 주소를 쓴다). */
export async function fileLink(fileId, { inline = false } = {}) {
  const { url } = await api(`/files/${fileId}/link${inline ? '?inline=true' : ''}`, { method: 'POST' });
  return url;
}

export async function downloadFile(file) {
  const url = await fileLink(file.id);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function uncPath(vaultUnc, relPath) {
  return vaultUnc ? `${vaultUnc}\\files\\${relPath.replaceAll('/', '\\')}` : '';
}

/** 사내 서버는 http 라 navigator.clipboard 가 없다(보안 컨텍스트 아님) — execCommand 로 대신한다. */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래로 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}
```

`frontend/src/lib/tree.js`:

```js
/** 파일 목록(rel_path) → 폴더 트리. 폴더 먼저, 같은 층은 이름순. */
export function buildTree(files) {
  const root = { children: new Map() };
  for (const f of files) {
    const parts = f.rel_path.split('/');
    let node = root;
    parts.slice(0, -1).forEach((part, i) => {
      if (!node.children.has(`d:${part}`)) {
        node.children.set(`d:${part}`, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map() });
      }
      node = node.children.get(`d:${part}`);
    });
    node.children.set(`f:${f.id}`, { name: parts[parts.length - 1], path: f.rel_path, file: f });
  }
  const finish = (node) => [...node.children.values()]
    .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name, 'ko'))
    .map((n) => (n.file ? n : { ...n, children: finish(n) }));
  return finish(root);
}
```

`frontend/src/lib/labels.js` 를 수정한다.

`ACTION_LABELS` 에 더한다:

```js
  TAG_ALIAS: '동의어 묶기', TAG_UNALIAS: '동의어 풀기', HULL_UPDATE: '호선 정보 수정',
```

`ERROR_LABELS` 에 더한다:

```js
  link_invalid: '내려받기 링크가 만료됐습니다. 다시 눌러 주세요.',
  file_not_found: '파일을 찾을 수 없습니다.',
  file_missing: '공유 폴더에서 파일을 찾을 수 없습니다.',
  not_sheet: '엑셀 파일이 아닙니다.',
  too_large: '파일이 너무 커서 미리 볼 수 없습니다. 내려받아 열어 주세요.',
  unreadable: '파일을 열 수 없습니다(손상 또는 지원하지 않는 형식).',
  kind_mismatch: '같은 종류의 태그끼리만 묶을 수 있습니다.',
  same_tag: '자기 자신이나 자기 동의어에는 묶을 수 없습니다.',
  hull_not_found: '등록된 호선이 아닙니다.',
  invalid_hull: '호선은 숫자 4자리입니다.',
  entry_not_found: '자료를 찾을 수 없습니다.',
```

끝에 추가:

```js
export const FACET_LABELS = { hull: '호선', ship_type: '선종', analysis_type: '해석 종류', zone: '구역',
  year: '연도', uploaded_by: '올린 사람', kind: '파일 종류' };

export const EXTRACT_LABELS = {
  queued: '본문 추출 대기 중', failed: '본문을 읽지 못했습니다',
  drm: 'DRM 암호화 파일이라 본문을 읽지 못했습니다', too_large: '파일이 커서 본문을 색인하지 않았습니다',
};

export const MATCH_LABELS = { entry_id: 'Entry 번호', hull: '호선', title: '제목', tag: '태그',
  analysis_type: '해석 종류', description: '설명', file: '파일명', body: '본문' };

export function formatDateTime(iso) {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib`
Expected: PASS

- [ ] **Step 6: 커밋(사람)** — `feat: 03b 검색·파일·트리 도구와 라벨`

---

### Task 2: 미리보기 부품 — 강조, 요약 카드, 파일 미리보기

**Files:**
- Create: `frontend/src/components/ui/Highlight.jsx`, `frontend/src/components/preview/SummaryCard.jsx`, `frontend/src/components/preview/FilePreview.jsx`
- Test: `frontend/src/components/preview/FilePreview.test.jsx`

`FilePreview({ file, vaultUnc })` 의 동작:
- **위쪽 줄**: KindBadge, 파일명, 크기, [내려받기], [경로 복사](vaultUnc 가 있을 때). 복사하면 "경로를 복사했습니다" 를 `role=status` 로 알린다.
- **추출 상태 안내**: `file.extract` 가 skipped/queued/failed 면 `EXTRACT_LABELS` 문구를 보인다. skipped 는 error 코드(drm·too_large)로 문구를 고른다.
- **요약 카드**: `extract.summary` 가 있으면 `SummaryCard` 를 보인다.
- **형식별 본문**:
  - `.pdf`: `fileLink(id, {inline:true})` 로 받은 주소를 `<iframe title="PDF 미리보기">` 에 넣는다(높이 70vh).
  - `.pptx`: `/files/{id}/text` 의 `slide:i`·`notes:i` 조각을 슬라이드별 카드로 보인다(제목 = `summary.slide_titles[i-1]` 또는 "슬라이드 i", 노트는 회색 작은 글씨).
  - `.docx`: `/text` 의 본문을 `whitespace-pre-wrap` 으로 보인다.
  - `.xlsx`·`.xlsm`: `/files/{id}/sheet?name=` 결과를 시트 탭 + 표로 보인다(첫 행 굵게, `truncated` 면 "앞 200행만 표시").
  - 그 밖: "이 형식은 미리보기를 지원하지 않습니다. 내려받아 열어 주세요."
- 파일이 바뀌면 이전 요청 결과를 버린다(요청 번호 ref).

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/components/preview/FilePreview.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { calls, mockApi } from '../../test/mockApi.js';
import FilePreview from './FilePreview.jsx';

const base = { size: 2048, kind: 'report', rel_path: 'x', extract: null };

test('PDF 는 inline 링크를 iframe 으로 보인다', async () => {
  mockApi({ 'POST /api/files/1/link?inline=true': { url: '/api/files/1/content?t=a&inline=1' } });
  render(<FilePreview file={{ ...base, id: 1, name: 'r.pdf' }} />);
  const frame = await screen.findByTitle('PDF 미리보기');
  expect(frame).toHaveAttribute('src', '/api/files/1/content?t=a&inline=1');
});

test('PPTX 는 슬라이드별 제목·본문·노트와 요약 카드를 보인다', async () => {
  const summary = { unit: 'slide', count: 2, title: '계류 검토', author: '홍길동', created: '2026-09-01',
    headings: ['표지', '결론'], cover: '표지 글', slide_titles: ['표지', ''] };
  mockApi({ 'GET /api/files/2/text': { state: 'done', summary, chunks: [
    { locator: 'slide:1', text: '9999 계류' }, { locator: 'notes:1', text: '노트 글' }, { locator: 'slide:2', text: '결론 본문' }] } });
  render(<FilePreview file={{ ...base, id: 2, name: 'r.pptx', extract: { state: 'done', summary } }} />);
  expect(await screen.findByText('9999 계류')).toBeInTheDocument();
  expect(screen.getByText('노트 글')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '슬라이드 2' })).toBeInTheDocument();
  expect(screen.getByText('슬라이드 2장')).toBeInTheDocument();
  expect(screen.getByText('홍길동')).toBeInTheDocument();
});

test('XLSX 는 시트 탭을 바꿔 표를 보인다', async () => {
  const fetch = mockApi({
    'GET /api/files/3/sheet': { sheets: ['응력', '요약'], name: '응력', rows: [['부재', 'MPa'], ['L100', '12']], truncated: true },
    'GET /api/files/3/sheet?name=%EC%9A%94%EC%95%BD': { sheets: ['응력', '요약'], name: '요약', rows: [['OK']], truncated: false },
  });
  render(<FilePreview file={{ ...base, id: 3, name: 's.xlsx' }} />);
  expect(await screen.findByText('L100')).toBeInTheDocument();
  expect(screen.getByText(/앞 200행만/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '요약' }));
  expect(await screen.findByText('OK')).toBeInTheDocument();
  expect(calls(fetch)).toContain('GET /api/files/3/sheet?name=%EC%9A%94%EC%95%BD');
});

test('DRM 으로 건너뛴 파일은 사유를 보이고, 지원 안 하는 형식은 안내한다', async () => {
  mockApi({});
  const { rerender } = render(<FilePreview file={{ ...base, id: 4, name: 'r.docx', extract: { state: 'skipped', error: 'drm' } }} />);
  expect(screen.getByText(/DRM 암호화 파일이라/)).toBeInTheDocument();
  rerender(<FilePreview file={{ ...base, id: 5, name: 'm.bdf', kind: 'model' }} />);
  expect(screen.getByText(/미리보기를 지원하지 않습니다/)).toBeInTheDocument();
});

test('경로 복사', async () => {
  mockApi({});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
  render(<FilePreview file={{ ...base, id: 6, name: 'm.bdf', kind: 'model', rel_path: 'a/m.bdf' }} vaultUnc="\\\\srv\\E1" />);
  await userEvent.click(screen.getByRole('button', { name: '경로 복사' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('\\\\srv\\E1\\files\\a\\m.bdf');
  expect(await screen.findByRole('status')).toHaveTextContent('경로를 복사했습니다');
});

test('내려받기 버튼은 링크를 받아 연다', async () => {
  const fetch = mockApi({ 'POST /api/files/7/link': { url: '/api/files/7/content?t=z' } });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<FilePreview file={{ ...base, id: 7, name: 'm.bdf', kind: 'model' }} />);
  await userEvent.click(screen.getByRole('button', { name: '내려받기' }));
  expect(calls(fetch)).toContain('POST /api/files/7/link');
  expect(click).toHaveBeenCalled();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/preview`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/components/ui/Highlight.jsx`:

```jsx
import { highlightParts } from '../../lib/search.js';

/** 발췌문 강조 — 서버가 준 글자 위치로 칠한다(HTML 을 받지 않아 안전하다). */
export default function Highlight({ text, highlights }) {
  return (
    <>
      {highlightParts(text, highlights).map((p, i) => (p.hit
        ? <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-zinc-900">{p.text}</mark>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}
```

`frontend/src/components/preview/SummaryCard.jsx`:

```jsx
const UNIT = { page: (n) => `${n}쪽`, slide: (n) => `슬라이드 ${n}장`, sheet: (n) => `시트 ${n}개`, paragraph: (n) => `문단 ${n}개` };

/** 규칙 기반 요약 카드(설계 §5.2) — 제목, 쪽·슬라이드 수, 작성자·작성일, 목차, 표지 글. */
export default function SummaryCard({ summary }) {
  if (!summary) return null;
  const count = UNIT[summary.unit]?.(summary.count);
  return (
    <section aria-label="요약" className="rounded-lg border border-line bg-white p-4 text-[13px]">
      <h3 className="text-sm font-semibold text-zinc-900">{summary.title || '제목 없음'}</h3>
      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        {count && <div><dt className="sr-only">분량</dt><dd>{count}</dd></div>}
        {summary.author && <div className="flex gap-1"><dt>작성</dt><dd>{summary.author}</dd></div>}
        {summary.created && <div className="flex gap-1"><dt>작성일</dt><dd className="font-mono">{summary.created}</dd></div>}
        {summary.truncated && <div><dd className="text-wait">본문이 길어 앞부분만 색인됨</dd></div>}
      </dl>
      {summary.headings?.length > 0 && (
        <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-zinc-700">
          {summary.headings.slice(0, 12).map((h, i) => <li key={i} className="truncate">{h}</li>)}
          {summary.headings.length > 12 && <li className="list-none text-zinc-500">외 {summary.headings.length - 12}개</li>}
        </ol>
      )}
      {summary.cover && <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-500">{summary.cover}</p>}
    </section>
  );
}
```

`frontend/src/components/preview/FilePreview.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { api } from '../../api/client.js';
import { copyText, downloadFile, fileLink, uncPath } from '../../lib/files.js';
import { EXTRACT_LABELS, errorText, formatBytes } from '../../lib/labels.js';
import Button from '../ui/Button.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import SummaryCard from './SummaryCard.jsx';

const extOf = (name) => name.slice(name.lastIndexOf('.')).toLowerCase();

function extractNotice(x) {
  if (!x || x.state === 'done') return '';
  if (x.state === 'skipped') return EXTRACT_LABELS[x.error] || '';
  return EXTRACT_LABELS[x.state] || '';
}

/** 요청 번호로 늦게 온 옛 응답을 버리는 비동기 불러오기. */
function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  const idRef = useRef(0);
  useEffect(() => {
    const id = ++idRef.current;
    setState({ data: null, error: '' });
    load().then((data) => { if (id === idRef.current) setState({ data, error: '' }); })
      .catch((err) => { if (id === idRef.current) setState({ data: null, error: errorText(err, '미리보기를 불러오지 못했습니다.') }); });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function PdfView({ file }) {
  const { data: url, error } = useLoad(() => fileLink(file.id, { inline: true }), [file.id]);
  if (error) return <p role="alert" className="text-[13px] text-err">{error}</p>;
  if (!url) return <div className="h-[70vh] animate-pulse rounded-lg bg-zinc-100" />;
  return <iframe title="PDF 미리보기" src={url} className="h-[70vh] w-full rounded-lg border border-line bg-white" />;
}

function SlidesView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <p role="alert" className="text-[13px] text-err">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-zinc-100" />;
  const titles = data.summary?.slide_titles || [];
  const slides = new Map();
  for (const c of data.chunks) {
    const [kind, n] = c.locator.split(':');
    if (kind !== 'slide' && kind !== 'notes') continue;
    const s = slides.get(n) || { n, body: '', notes: '' };
    if (kind === 'slide') s.body = c.text; else s.notes = c.text;
    slides.set(n, s);
  }
  if (slides.size === 0) return <p className="text-[13px] text-zinc-500">추출된 슬라이드 본문이 없습니다.</p>;
  return (
    <ol className="space-y-2">
      {[...slides.values()].map((s) => (
        <li key={s.n} className="rounded-lg border border-line bg-white p-3 text-[13px]">
          <h4 className="mb-1 text-xs font-semibold text-zinc-500">
            <span className="mr-2 font-mono">{s.n}</span>{titles[Number(s.n) - 1] || `슬라이드 ${s.n}`}
          </h4>
          <p className="whitespace-pre-wrap text-zinc-800">{s.body}</p>
          {s.notes && <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs text-zinc-500">{s.notes}</p>}
        </li>
      ))}
    </ol>
  );
}

function TextView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <p role="alert" className="text-[13px] text-err">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-zinc-100" />;
  const text = data.chunks.map((c) => c.text).join('\n\n');
  return text ? <div className="whitespace-pre-wrap rounded-lg border border-line bg-white p-4 text-[13px] text-zinc-800">{text}</div>
    : <p className="text-[13px] text-zinc-500">추출된 본문이 없습니다.</p>;
}

function SheetView({ file }) {
  const [name, setName] = useState(null);
  const { data, error } = useLoad(
    () => api(`/files/${file.id}/sheet${name ? `?name=${encodeURIComponent(name)}` : ''}`), [file.id, name]);
  useEffect(() => { setName(null); }, [file.id]);
  if (error) return <p role="alert" className="text-[13px] text-err">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-zinc-100" />;
  return (
    <div>
      <div role="tablist" aria-label="시트" className="mb-2 flex flex-wrap gap-1">
        {data.sheets.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={s === data.name} onClick={() => setName(s)}
                  className={`h-7 rounded-md px-2.5 text-xs ${s === data.name ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-600 hover:bg-zinc-100'}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-white">
        <table className="border-collapse font-mono text-xs">
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className={i === 0 ? 'bg-zinc-50 font-semibold' : ''}>
                <th scope="row" className="sticky left-0 border-b border-r border-line bg-zinc-50 px-2 text-right font-normal text-zinc-400">{i + 1}</th>
                {row.map((v, j) => <td key={j} className="max-w-60 truncate border-b border-r border-line px-2 py-1">{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="mt-1 text-xs text-zinc-500">앞 200행만 표시합니다. 전체는 내려받아 열어 주세요.</p>}
    </div>
  );
}

const VIEWS = { '.pdf': PdfView, '.pptx': SlidesView, '.docx': TextView, '.xlsx': SheetView, '.xlsm': SheetView };

export default function FilePreview({ file, vaultUnc }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setStatus(''); setError(''); }, [file.id]);
  const ext = extOf(file.name);
  const notice = extractNotice(file.extract);
  const blocked = file.extract?.state === 'skipped' && file.extract?.error === 'drm';
  const View = !blocked && VIEWS[ext];
  const path = uncPath(vaultUnc, file.rel_path);

  async function onDownload() {
    setError('');
    try { await downloadFile(file); } catch (err) { setError(errorText(err, '내려받지 못했습니다.')); }
  }
  async function onCopy() {
    setStatus((await copyText(path)) ? '경로를 복사했습니다.' : '복사하지 못했습니다. 경로를 직접 선택해 주세요.');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <KindBadge kind={file.kind} name={file.name} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={file.rel_path}>{file.name}</span>
        <span className="font-mono text-xs text-zinc-500">{formatBytes(file.size)}</span>
        <Button variant="secondary" size="sm" onClick={onDownload}><Download size={13} aria-hidden="true" />내려받기</Button>
        {path && <Button variant="secondary" size="sm" onClick={onCopy} title={path}><Copy size={13} aria-hidden="true" />경로 복사</Button>}
      </div>
      {status && <p role="status" className="text-xs text-ok">{status}</p>}
      {error && <p role="alert" className="text-xs text-err">{error}</p>}
      {notice && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-wait">{notice}</p>}
      <SummaryCard summary={file.extract?.summary} />
      {View ? <View file={file} /> : (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-zinc-500">
          이 형식은 미리보기를 지원하지 않습니다. 내려받아 열어 주세요.
        </p>
      )}
    </div>
  );
}
```

(PPTX 테스트의 `'슬라이드 2'` 제목은 `slide_titles[1]` 이 빈 문자열이라 대체 문구가 나오는 경우다. `<h4>` 는 번호 `<span>` 을 포함하므로, 접근 이름이 `2 슬라이드 2` 가 되어 테스트가 실패할 수 있다. 그러면 번호 span 에 `aria-hidden="true"` 를 단다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/preview`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03b 파일 미리보기·요약 카드`

---

### Task 3: 검색 화면 — 상단 바 연동, 필터, 결과, 미리보기 패널

**Files:**
- Create: `frontend/src/components/search/FacetPanel.jsx`, `frontend/src/components/search/ResultList.jsx`, `frontend/src/components/search/EntryPreviewPanel.jsx`, `frontend/src/pages/SearchPage.jsx`
- Modify: `frontend/src/components/shell/TopBar.jsx`
- Test: `frontend/src/pages/SearchPage.test.jsx`, `frontend/src/components/shell/TopBar.test.jsx`(추가)

화면 규칙(설계 §6.2):
- **배치**: 왼쪽 필터(240px), 가운데 결과, 오른쪽 미리보기 패널(420px, 결과를 고르면 열린다).
- **머리줄**: "결과 N건", 보기 단위 토글(Entry / 파일), "미확정 포함" 체크.
- **호선 제안**: `hull_suggestion` 이 있으면 "호선 9999 로 좁히기" 버튼을 띄운다. 모르는 호선이면 "(등록 안 된 번호)" 를 붙인다. 누르면 `hull` 필터가 들어간다.
- **필터**: 차원마다 건수 많은 순으로 8개를 보이고 [더 보기]로 나머지를 연다. 고른 값은 강조하고 [×]로 해제한다. `uploaded_by` 는 이름(label)으로, `kind` 는 `KIND_LABELS` 로 보인다.
- **결과 항목(Entry)**
  - Entry 번호(mono), 미확정이면 "미확정" 배지(`text-wait`), 제목, 호선 칩(`/h/…` 링크), 해석 종류, 구역, 파일 종류 배지, 확정일을 보인다.
  - "일치: 제목·본문"(`MATCH_LABELS`) 과 발췌문(위치 라벨 + 강조)도 보인다.
  - 한 번 누르면 미리보기 패널이 열리고, 제목 링크는 `/e/…` 로 간다.
- **결과 항목(파일)**: KindBadge, 파일명, Entry 번호·제목, 호선, 발췌문을 보인다. 누르면 패널에 그 파일의 Entry 가 열리고 그 파일이 선택된다.
- **키보드**: 결과 목록에서 ↑/↓ 로 고르고, Enter 로 상세를 연다.
- **페이지**: 50건씩 보이고 [더 보기]로 다음 쪽을 이어 붙인다.
- **로딩·오류**: 불러오는 중에는 스켈레톤을 보인다. 결과가 없으면 "찾는 자료가 없습니다" 와 함께 검색어·필터를 줄여 보라고 안내한다.
- **상단 바**
  - 입력하면 200ms 뒤 `/?q=…` 로 이동한다. 이미 `/` 면 다른 필터를 유지한 채 `replace` 로 바꾼다.
  - Enter 는 즉시 반영한다.
  - 주소의 `q` 가 바뀌면(뒤로 가기·링크) 입력칸을 맞춘다. 입력 중인 앞뒤 공백은 지우지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/components/shell/TopBar.test.jsx` 끝에 추가:

```jsx
test('입력하면 잠시 뒤 검색 주소로 바뀌고, 필터는 유지한다', async () => {
  render(
    <MemoryRouter initialEntries={['/?hull=9999']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText('검색어'), '강도 ');
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.getByTestId('loc').textContent).toBe('/?hull=9999&q=%EA%B0%95%EB%8F%84');
  expect(screen.getByLabelText('검색어')).toHaveValue('강도 ');
});

test('주소의 q 를 입력칸에 채운다', () => {
  render(
    <MemoryRouter initialEntries={['/?q=9999']}>
      <TopBar user={{ name: '김철수', employee_id: 'A100001' }} onLogout={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText('검색어')).toHaveValue('9999');
});
```

`frontend/src/pages/SearchPage.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  await userEvent.click(await screen.findByText('계류 구조 검토'));
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/pages/SearchPage.test.jsx src/components/shell/TopBar.test.jsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`frontend/src/components/shell/TopBar.jsx` 에서 `useNavigate` import 옆에 `useLocation`, `useSearchParams` 를 더하고, 컴포넌트 안을 다음과 같이 바꾼다. 로고·버튼 JSX 는 그대로 두고, input 의 `onChange` 만 바꾼다:

```jsx
  const location = useLocation();
  const [params] = useSearchParams();
  const timerRef = useRef(null);
  const onHome = location.pathname === '/';
  const urlQ = onHome ? params.get('q') || '' : null;

  // 주소의 q 가 바뀌면(뒤로 가기·링크 공유) 입력칸을 맞춘다. 입력 중인 앞뒤 공백은 지우지 않는다.
  useEffect(() => {
    if (urlQ !== null) setQ((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  function go(value, { replace }) {
    const p = new URLSearchParams(onHome ? location.search : '');
    const query = value.trim();
    if (query) p.set('q', query); else p.delete('q');
    const search = p.toString();
    navigate(search ? `/?${search}` : '/', { replace });
  }

  function onChange(e) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!onHome && !value.trim()) return;
      go(value, { replace: onHome });
    }, 200);
  }

  function onSubmit(e) {
    e.preventDefault();
    clearTimeout(timerRef.current);
    if (!q.trim()) return;
    go(q, { replace: false });
  }
```

input 은 `onChange={onChange}` 로 바꾼다. 기존 테스트("빈 검색어는 제출해도 이동하지 않는다" 등)는 그대로 통과해야 한다.

`frontend/src/components/search/FacetPanel.jsx`:

```jsx
import { useState } from 'react';
import { X } from 'lucide-react';
import { FILTER_KEYS } from '../../lib/search.js';
import { FACET_LABELS, KIND_LABELS } from '../../lib/labels.js';

const SHOW = 8;

function valueLabel(key, f) {
  if (key === 'kind') return KIND_LABELS[f.value] || f.value;
  if (key === 'uploaded_by') return f.label || f.value;
  return f.value;
}

function Facet({ name, items, selected, onPick }) {
  const [open, setOpen] = useState(false);
  if (!items.length && !selected) return null;
  const shown = open ? items : items.slice(0, SHOW);
  return (
    <div role="group" aria-label={FACET_LABELS[name]} className="border-b border-line py-3">
      <h3 className="mb-1.5 px-1 text-xs font-semibold text-zinc-500">{FACET_LABELS[name]}</h3>
      <ul className="space-y-0.5">
        {shown.map((f) => {
          const on = selected === f.value;
          return (
            <li key={f.value}>
              <button type="button" onClick={() => onPick(on ? null : f.value)} aria-pressed={on}
                      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${on ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-700 hover:bg-zinc-100'}`}>
                <span className={`min-w-0 flex-1 truncate ${name === 'hull' || name === 'year' ? 'font-mono' : ''}`}>{valueLabel(name, f)}</span>
                {on ? <X size={13} aria-label="해제" /> : <span className="font-mono text-xs tabular-nums text-zinc-500">{f.count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > SHOW && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 px-2 text-xs text-brand hover:underline">
          {open ? '접기' : `더 보기 (${items.length - SHOW})`}
        </button>
      )}
    </div>
  );
}

/** 필터와 건수(설계 §6.2). 건수는 서버가 "자기 필터만 뺀" 조건으로 센다. */
export default function FacetPanel({ facets, filters, onChange }) {
  return (
    <aside aria-label="필터" className="w-60 shrink-0 overflow-auto border-r border-line bg-white px-3">
      {FILTER_KEYS.map((k) => (
        <Facet key={k} name={k} items={facets?.[k] || []} selected={filters[k]} onPick={(v) => onChange(k, v)} />
      ))}
    </aside>
  );
}
```

`frontend/src/components/search/ResultList.jsx`:

```jsx
import { Link } from 'react-router-dom';
import Highlight from '../ui/Highlight.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { MATCH_LABELS, formatDateTime } from '../../lib/labels.js';
import { locatorLabel } from '../../lib/search.js';

function Snippets({ snippets }) {
  if (!snippets?.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {snippets.map((s, i) => (
        <li key={i} className="text-xs leading-relaxed text-zinc-600">
          <span className="mr-1.5 rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-500">{s.name} · {locatorLabel(s.locator)}</span>
          <Highlight text={s.text} highlights={s.highlights} />
        </li>
      ))}
    </ul>
  );
}

function HullChips({ hulls }) {
  return hulls.map((h) => (
    <Link key={h} to={`/h/${h}`} onClick={(e) => e.stopPropagation()}
          className="rounded bg-brand-tint px-1.5 font-mono text-xs font-semibold text-brand hover:underline">{h}</Link>
  ));
}

function EntryRow({ item }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-500">{item.entry_id}</span>
        {item.status === 'draft' && <span className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-wait">미확정</span>}
        <Link to={`/e/${item.entry_id}`} onClick={(e) => e.stopPropagation()}
              className="min-w-0 truncate text-sm font-semibold text-zinc-900 hover:text-brand hover:underline">{item.title}</Link>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
        <HullChips hulls={item.hulls} />
        {item.analysis_type && <span>{item.analysis_type}</span>}
        {item.zones.length > 0 && <span className="text-zinc-500">· {item.zones.join(', ')}</span>}
        <span className="flex gap-1">{item.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
        <span className="ml-auto font-mono text-zinc-500">{item.analysis_period || formatDateTime(item.confirmed_at).slice(0, 10)}</span>
      </div>
      {item.matched.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">일치: {item.matched.map((m) => MATCH_LABELS[m] || m).join('·')}</p>
      )}
      <Snippets snippets={item.snippets} />
    </>
  );
}

function FileRow({ item }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <KindBadge kind={item.kind} name={item.name} />
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-900" title={item.rel_path}>{item.name}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
        <HullChips hulls={item.hulls} />
        <span className="font-mono text-zinc-500">{item.entry_id}</span>
        <span className="truncate">{item.entry_title}</span>
        {item.entry_status === 'draft' && <span className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-wait">미확정</span>}
      </div>
      <Snippets snippets={item.snippets} />
    </>
  );
}

export const itemKey = (item) => (item.file_id ? `f${item.file_id}` : item.entry_id);

/** 결과 목록 — ↑/↓ 로 고르고 Enter 로 연다(onOpen). */
export default function ResultList({ unit, items, selectedKey, onSelect, onOpen }) {
  function onKeyDown(e) {
    const i = items.findIndex((it) => itemKey(it) === selectedKey);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      if (items[next]) onSelect(items[next]);
    } else if (e.key === 'Enter') {
      const it = items[i >= 0 ? i : 0];
      if (it) onOpen(it);
    }
  }
  return (
    <ul role="listbox" aria-label="검색 결과" tabIndex={0} onKeyDown={onKeyDown}
        className="divide-y divide-line rounded-lg border border-line bg-white outline-none focus-visible:ring-3 focus-visible:ring-brand-ring">
      {items.map((it) => {
        const key = itemKey(it);
        const on = key === selectedKey;
        return (
          <li key={key} role="option" aria-selected={on} onClick={() => onSelect(it)}
              className={`cursor-pointer px-4 py-3 ${on ? 'bg-brand-tint/60' : 'hover:bg-zinc-50'}`}>
            {unit === 'file' ? <FileRow item={it} /> : <EntryRow item={it} />}
          </li>
        );
      })}
    </ul>
  );
}
```

`frontend/src/components/search/EntryPreviewPanel.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import FilePreview from '../preview/FilePreview.jsx';
import KindBadge from '../ui/KindBadge.jsx';

/** 오른쪽 미리보기 패널(설계 §6.4 "떠나지 않고 본다"). 파일을 고르면 그 파일을 미리 본다. */
export default function EntryPreviewPanel({ entryId, fileId, onClose }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(fileId || null);
  const idRef = useRef(0);

  useEffect(() => {
    const id = ++idRef.current;
    setEntry(null); setError('');
    api(`/entries/${entryId}`).then((e) => { if (id === idRef.current) setEntry(e); })
      .catch((err) => { if (id === idRef.current) setError(errorText(err, '자료를 불러오지 못했습니다.')); });
  }, [entryId]);
  useEffect(() => { setPicked(fileId || null); }, [entryId, fileId]);

  const file = entry?.files.find((f) => f.id === picked) || entry?.files.find((f) => f.kind === 'report') || entry?.files[0];

  return (
    <aside aria-label="미리보기" className="flex w-[420px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <span className="font-mono text-xs text-zinc-500">{entryId}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry?.title}</span>
        <Link to={`/e/${entryId}`} className="inline-flex items-center gap-0.5 text-xs text-brand hover:underline">
          상세<ArrowUpRight size={13} aria-hidden="true" />
        </Link>
        <button type="button" onClick={onClose} aria-label="미리보기 닫기" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><X size={16} /></button>
      </div>
      {error && <p role="alert" className="p-4 text-[13px] text-err">{error}</p>}
      {!entry && !error && <div className="m-4 h-40 animate-pulse rounded-lg bg-zinc-200/60" />}
      {entry && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ul className="mb-3 space-y-0.5">
            {entry.files.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => setPicked(f.id)}
                        className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${f.id === file?.id ? 'bg-brand-tint font-semibold text-brand' : 'hover:bg-white'}`}>
                  <KindBadge kind={f.kind} name={f.name} /><span className="truncate">{f.rel_path}</span>
                </button>
              </li>
            ))}
          </ul>
          {file && <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} />}
        </div>
      )}
    </aside>
  );
}
```

`frontend/src/pages/SearchPage.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { api } from '../api/client.js';
import FacetPanel from '../components/search/FacetPanel.jsx';
import EntryPreviewPanel from '../components/search/EntryPreviewPanel.jsx';
import ResultList, { itemKey } from '../components/search/ResultList.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText } from '../lib/labels.js';
import { apiQuery, readSearch, writeSearch } from '../lib/search.js';

const PAGE = 50;

/** 검색(홈) — 주소가 검색 상태의 원본이다(설계 §6.1·§6.2). */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const key = params.toString();
  const state = useMemo(() => readSearch(new URLSearchParams(key)), [key]);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true); setError(''); setSelected(null);
    api(apiQuery(state, { limit: PAGE, offset: 0 }))
      .then((r) => { if (id === reqRef.current) setRes(r); })
      .catch((err) => { if (id === reqRef.current) { setRes(null); setError(errorText(err, '검색하지 못했습니다.')); } })
      .finally(() => { if (id === reqRef.current) setLoading(false); });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(patch) {
    setParams(writeSearch({ ...state, ...patch }));
  }
  function setFilter(k, v) {
    const filters = { ...state.filters };
    if (v) filters[k] = v; else delete filters[k];
    update({ filters });
  }
  async function loadMore() {
    const id = reqRef.current;
    setMore(true);
    try {
      const r = await api(apiQuery(state, { limit: PAGE, offset: res.items.length }));
      if (id === reqRef.current) setRes((cur) => ({ ...cur, items: [...cur.items, ...r.items], total: r.total }));
    } catch (err) {
      setError(errorText(err, '검색하지 못했습니다.'));
    } finally { setMore(false); }
  }
  const open = (it) => navigate(`/e/${it.entry_id}`);
  const sug = res?.hull_suggestion;

  return (
    <div className="flex h-full min-h-0">
      <FacetPanel facets={res?.facets} filters={state.filters} onChange={setFilter} />
      <section className="min-w-0 flex-1 overflow-auto p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-800">{res ? `결과 ${res.total}건` : '검색'}</h1>
          <div role="radiogroup" aria-label="보기 단위" className="flex rounded-md border border-line bg-white p-0.5 text-xs">
            {[['entry', 'Entry'], ['file', '파일']].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={state.unit === v} onClick={() => update({ unit: v })}
                      className={`h-6 rounded px-2.5 ${state.unit === v ? 'bg-brand text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-700">
            <input type="checkbox" checked={state.drafts} onChange={(e) => update({ drafts: e.target.checked })} className="accent-brand" />
            미확정 포함
          </label>
          {sug && (
            <Button variant="secondary" size="sm" onClick={() => setFilter('hull', sug.hull_no)}>
              호선 <span className="font-mono">{sug.hull_no}</span> 로 좁히기{!sug.known && ' (등록 안 된 번호)'}
            </Button>
          )}
        </div>
        {error && <p role="alert" className="mb-3 text-[13px] text-err">{error}</p>}
        {loading && !res && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-200/60" />)}</div>}
        {res && res.items.length === 0 && !loading && (
          <EmptyState icon={SearchX} title="찾는 자료가 없습니다">검색어를 줄이거나 필터를 해제해 보세요. 띄어 쓴 낱말은 모두 맞아야 합니다.</EmptyState>
        )}
        {res && res.items.length > 0 && (
          <div className={loading ? 'opacity-60' : ''}>
            <ResultList unit={res.unit} items={res.items} selectedKey={selected && itemKey(selected)}
                        onSelect={setSelected} onOpen={open} />
            {res.items.length < res.total && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" onClick={loadMore} disabled={more}>더 보기</Button>
              </div>
            )}
          </div>
        )}
      </section>
      {selected && (
        <EntryPreviewPanel entryId={selected.entry_id} fileId={selected.file_id} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
```

(Enter 테스트는 아무것도 고르지 않은 상태에서 첫 항목을 연다. 테스트는 먼저 항목을 눌러 패널을 연 뒤 Enter 를 누르므로 고른 항목 E000001 이 열린다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/pages/SearchPage.test.jsx src/components/shell/TopBar.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03b 검색 화면·필터·미리보기 패널`

---

### Task 4: Entry 상세 화면

**Files:**
- Create: `frontend/src/lib/useEntry.js`, `frontend/src/components/ui/InlineText.jsx`, `frontend/src/pages/EntryPage.jsx`
- Modify: `frontend/src/components/inbox/UploadZone.jsx` (`targetEntryId` prop → `uploadBatch(items, { onProgress, targetEntryId })`)
- Test: `frontend/src/pages/EntryPage.test.jsx`

화면 규칙(설계 §6.1 `/e/{entryId}`, §8):
- **머리말**
  - Entry 번호(mono), 상태 배지(확정 = `text-ok` "확정" / 미확정 = `text-wait` "미확정" / 휴지통 = `text-err` "휴지통"), 제목을 보인다.
  - 이어서 호선 칩, 구역, 태그, 해석 종류, 해석 시기, 설명, 올린 사람·확정자·확정일을 보인다.
- **수정 권한**
  - **확정 Entry 는 누구나 고친다**(설계 §8).
    - 글자 칸(제목·해석 종류·해석 시기·설명)은 `InlineText` 로 고친다: 누르면 입력칸이 되고, Enter·blur 에서 저장하고, Escape 로 취소한다.
    - 호선·구역·태그는 `ChipInput`(kind `hull`/`zone`/`tag`) 으로 고치고, 바꾸는 즉시 저장한다.
  - 미확정·휴지통은 읽기 전용이다. 미확정이면 "정리 대기에서 고치고 확정합니다" 를 `/inbox` 링크로 보인다.
- **저장**
  - `useEntry` 가 저장을 한 줄로 세우고 응답의 `version` 으로 다음 저장을 보낸다.
  - `version_conflict` 면 최신으로 다시 불러오고 안내한다.
- **본문**
  - 왼쪽(320px): 파일 트리(폴더 접기·펴기, 파일 누르면 선택)와 변경 이력.
  - 오른쪽: 고른 파일의 `FilePreview`. 처음에는 첫 보고서를, 없으면 첫 파일을 고른다.
- **변경 이력**
  - `/entries/{id}/history` 를 보인다: 시각(mono), 이름(없으면 사번), 동작 라벨.
  - `ENTRY_UPDATE` 는 바뀐 칸을 "제목: a → b" 처럼 보인다. 칸 이름: title 제목, analysis_type 해석 종류, analysis_period 해석 시기, description 설명, hulls 호선, zones 구역, tags 태그. 배열은 쉼표로 잇는다.
- **동작**(확정 Entry 만)
  - [파일 추가]를 누르면 `UploadZone targetEntryId` 가 펼쳐진다. 다 올리면 "올렸습니다. 정리 대기에서 확정하면 이 자료에 추가됩니다." 를 `/inbox` 링크와 함께 보인다.
  - [휴지통으로]는 confirm 후 `DELETE /entries/{id}` 하고 `/trash` 로 간다.
- 없는 Entry 면 EmptyState "자료를 찾을 수 없습니다" 를 보인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/pages/EntryPage.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { calls, mockApi } from '../test/mockApi.js';

vi.mock('../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn(() => Promise.resolve({ key: 'K' })) }));
import EntryPage from './EntryPage.jsx';

const FILES = [
  { id: 1, name: 'm.bdf', rel_path: 'model/m.bdf', kind: 'model', size: 100, extract: null },
  { id: 2, name: 'r.pdf', rel_path: 'r.pdf', kind: 'report', size: 200, extract: { state: 'done', error: null, summary: null } },
];
const ENTRY = { entry_id: 'E000001', status: 'confirmed', title: '계류 구조 검토', analysis_type: 'Mooring',
  analysis_period: '2026-08', description: null, version: 3, hulls: [{ hull_no: '9999', ship_type: 'LNGC', is_primary: true }],
  zones: ['선수부'], tags: [], uploaded_by: 'A100001', confirmed_by: 'A100001', confirmed_at: '2026-09-02T09:00:00',
  files: FILES, vault_unc: '\\\\srv\\E000001' };
const HISTORY = [{ at: '2026-09-03T10:00:00', employee_id: 'A100002', name: '김해석', action: 'ENTRY_UPDATE',
  before: { title: '옛 제목', zones: [] }, after: { title: '계류 구조 검토', zones: ['선수부'] } }];

function Probe() { const l = useLocation(); return <span data-testid="loc">{l.pathname}</span>; }

function renderPage(map) {
  const fetch = mockApi({
    'GET /api/entries/E000001/history': HISTORY,
    'POST /api/files/2/link?inline=true': { url: '/api/files/2/content?t=a&inline=1' },
    ...map,
  });
  render(
    <AuthContext.Provider value={{ user: { employee_id: 'A100009', name: '다른 사람' }, isAdmin: false }}>
      <MemoryRouter initialEntries={['/e/E000001']}>
        <Routes>
          <Route path="/e/:entryId" element={<EntryPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return fetch;
}

test('머리말·파일 트리·첫 보고서 미리보기·변경 이력', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  expect(await screen.findByText('계류 구조 검토')).toBeInTheDocument();
  expect(screen.getByText('확정')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '9999' })).toHaveAttribute('href', '/h/9999');
  expect(await screen.findByTitle('PDF 미리보기')).toBeInTheDocument();
  const tree = screen.getByRole('tree', { name: '파일' });
  expect(within(tree).getByText('model')).toBeInTheDocument();
  const hist = screen.getByRole('list', { name: '변경 이력' });
  expect(await within(hist).findByText('김해석')).toBeInTheDocument();
  expect(within(hist).getByText('제목: 옛 제목 → 계류 구조 검토')).toBeInTheDocument();
  expect(within(hist).getByText('구역: (없음) → 선수부')).toBeInTheDocument();
});

test('확정 자료는 다른 사람도 제목을 고친다 — version 을 싣는다', async () => {
  const fetch = renderPage({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => ({ ...ENTRY, ...JSON.parse(init.body), version: 4 }),
  });
  await userEvent.click(await screen.findByRole('button', { name: '제목 고치기' }));
  const input = screen.getByRole('textbox', { name: '제목' });
  await userEvent.clear(input);
  await userEvent.type(input, '새 제목{Enter}');
  expect(await screen.findByText('새 제목')).toBeInTheDocument();
  const patch = fetch.mock.calls.find(([u, i]) => i?.method === 'PATCH');
  expect(JSON.parse(patch[1].body)).toEqual({ title: '새 제목', version: 3 });
});

test('버전 충돌이면 다시 불러오고 안내한다', async () => {
  let n = 0;
  renderPage({
    'GET /api/entries/E000001': () => (++n === 1 ? ENTRY : { ...ENTRY, title: '남이 고친 제목', version: 5 }),
    'PATCH /api/entries/E000001': { __status: 409, detail: 'version_conflict' },
  });
  await userEvent.click(await screen.findByRole('button', { name: '제목 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '제목' }), 'x{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사람이 먼저 고쳤습니다');
  expect(await screen.findByText('남이 고친 제목')).toBeInTheDocument();
});

test('미확정 자료는 읽기 전용이고 정리 대기로 안내한다', async () => {
  renderPage({ 'GET /api/entries/E000001': { ...ENTRY, status: 'draft', vault_unc: null } });
  expect(await screen.findByText('미확정')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '제목 고치기' })).toBeNull();
  expect(screen.getByRole('link', { name: /정리 대기/ })).toHaveAttribute('href', '/inbox');
  expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
});

test('파일을 고르면 미리보기가 바뀐다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('treeitem', { name: /m\.bdf/ }));
  expect(await screen.findByText(/미리보기를 지원하지 않습니다/)).toBeInTheDocument();
});

test('휴지통으로 보내면 휴지통 화면으로 간다', async () => {
  const fetch = renderPage({ 'GET /api/entries/E000001': ENTRY, 'DELETE /api/entries/E000001': { ...ENTRY, status: 'trashed' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await userEvent.click(await screen.findByRole('button', { name: '휴지통으로' }));
  expect(await screen.findByTestId('loc')).toHaveTextContent('/trash');
  expect(calls(fetch)).toContain('DELETE /api/entries/E000001');
});

test('파일 추가 영역을 연다', async () => {
  renderPage({ 'GET /api/entries/E000001': ENTRY });
  await userEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  expect(screen.getByText(/정리 대기에서 확정하면 이 자료에 추가됩니다/)).toBeInTheDocument();
});

test('없는 자료', async () => {
  renderPage({ 'GET /api/entries/E000001': { __status: 404, detail: 'entry_not_found' } });
  expect(await screen.findByText('자료를 찾을 수 없습니다')).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/pages/EntryPage.test.jsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`frontend/src/lib/useEntry.js`:

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { errorText } from './labels.js';

/** Entry 불러오기 + 순차 저장. 저장은 한 줄로 세우고 응답의 version 으로 다음 저장을 보낸다. */
export function useEntry(entryId) {
  const [entry, setEntry] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState('');
  const versionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const reqRef = useRef(0);

  const apply = useCallback((e) => { versionRef.current = e.version; setEntry(e); setStatus('ready'); return e; }, []);

  const load = useCallback(() => {
    const id = ++reqRef.current;
    return api(`/entries/${entryId}`).then((e) => (id === reqRef.current ? apply(e) : e));
  }, [entryId, apply]);

  useEffect(() => {
    setEntry(null); setStatus('loading'); setError('');
    load().catch((err) => {
      if (err.status === 404) setStatus('missing');
      else { setStatus('error'); setError(errorText(err, '자료를 불러오지 못했습니다.')); }
    });
  }, [load]);

  const save = useCallback((patch) => {
    const run = queueRef.current.then(async () => {
      try {
        apply(await api(`/entries/${entryId}`, { method: 'PATCH', body: { ...patch, version: versionRef.current } }));
        setError('');
        return true;
      } catch (err) {
        setError(errorText(err, '저장하지 못했습니다.'));
        if (err.detail === 'version_conflict') await load().catch(() => {});
        return false;
      }
    });
    queueRef.current = run;
    return run;
  }, [entryId, apply, load]);

  return { entry, status, error, setError, save, reload: load };
}
```

`frontend/src/components/ui/InlineText.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/** 눌러서 고치는 글자 칸(설계 §6.4 — Notion 식 인라인 편집). Enter·blur 저장, Escape 취소. */
export default function InlineText({ label, value, onSave, multiline = false, placeholder = '—', className = '',
                                     validate, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (!editing) setText(value || ''); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  async function commit() {
    const next = text.trim();
    if (next === (value || '').trim()) { setEditing(false); return; }
    const bad = validate?.(next);
    if (bad) { setErr(bad); return; }
    setErr('');
    setEditing(false);
    await onSave(next);
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { setText(value || ''); setErr(''); setEditing(false); }
    if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); commit(); }
  }

  if (!editing) {
    return (
      <span className={`group inline-flex items-center gap-1 ${className}`}>
        <span className={value ? '' : 'text-zinc-400'}>{value || placeholder}</span>
        {!disabled && (
          <button type="button" aria-label={`${label} 고치기`} onClick={() => setEditing(true)}
                  className="rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-brand focus:opacity-100 group-hover:opacity-100">
            <Pencil size={13} />
          </button>
        )}
      </span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <span className="inline-flex flex-col">
      <Tag ref={ref} aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
           rows={multiline ? 3 : undefined}
           className={`rounded-md border border-brand bg-white px-2 py-1 text-zinc-900 outline-none ring-3 ring-brand-ring ${className}`} />
      {err && <span role="alert" className="mt-0.5 text-xs text-err">{err}</span>}
    </span>
  );
}
```

`frontend/src/components/inbox/UploadZone.jsx` — 시그니처를 `export default function UploadZone({ onUploaded, disabled = false, targetEntryId })` 로 바꾸고, `uploadBatch(items, { onProgress: setProgress })` 를 `uploadBatch(items, { onProgress: setProgress, targetEntryId })` 로 바꾼다.

`frontend/src/pages/EntryPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileQuestion, Folder, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client.js';
import FilePreview from '../components/preview/FilePreview.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import Button from '../components/ui/Button.jsx';
import ChipInput from '../components/ui/ChipInput.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { ACTION_LABELS, errorText, formatDateTime } from '../lib/labels.js';
import { buildTree } from '../lib/tree.js';
import { useEntry } from '../lib/useEntry.js';

const STATUS = { confirmed: ['확정', 'text-ok'], draft: ['미확정', 'text-wait'], trashed: ['휴지통', 'text-err'] };
const FIELD_LABELS = { title: '제목', analysis_type: '해석 종류', analysis_period: '해석 시기', description: '설명',
  hulls: '호선', zones: '구역', tags: '태그' };
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';
const periodRule = (v) => (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? '해석 시기는 YYYY-MM 형식입니다.' : '');
const show = (v) => (Array.isArray(v) ? v.join(', ') : v) || '(없음)';

function changes(before, after) {
  if (!before || !after) return [];
  return Object.keys(FIELD_LABELS)
    .filter((k) => k in after && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => `${FIELD_LABELS[k]}: ${show(before[k])} → ${show(after[k])}`);
}

function TreeNodes({ nodes, selectedId, onPick, depth = 0 }) {
  const [closed, setClosed] = useState({});
  return nodes.map((n) => (n.file ? (
    <li key={n.path} role="treeitem" aria-selected={n.file.id === selectedId} aria-label={n.name}
        onClick={() => onPick(n.file.id)} style={{ paddingLeft: depth * 14 + 8 }}
        className={`flex h-7 cursor-pointer items-center gap-2 rounded-md pr-2 text-[13px] ${n.file.id === selectedId ? 'bg-brand-tint font-semibold text-brand' : 'hover:bg-zinc-100'}`}>
      <KindBadge kind={n.file.kind} name={n.name} /><span className="truncate">{n.name}</span>
    </li>
  ) : (
    <li key={n.path} role="treeitem" aria-expanded={!closed[n.path]}>
      <button type="button" onClick={() => setClosed({ ...closed, [n.path]: !closed[n.path] })} style={{ paddingLeft: depth * 14 + 4 }}
              className="flex h-7 w-full items-center gap-1 rounded-md text-left text-[13px] text-zinc-700 hover:bg-zinc-100">
        {closed[n.path] ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        <Folder size={14} className="text-zinc-400" aria-hidden="true" />{n.name}
      </button>
      {!closed[n.path] && <ul role="group"><TreeNodes nodes={n.children} selectedId={selectedId} onPick={onPick} depth={depth + 1} /></ul>}
    </li>
  )));
}

function History({ entryId, version }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api(`/entries/${entryId}/history`).then(setRows).catch(() => setRows([])); }, [entryId, version]);
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold text-zinc-500">변경 이력</h2>
      <ul aria-label="변경 이력" className="space-y-2 text-xs">
        {rows?.length === 0 && <li className="text-zinc-500">기록이 없습니다.</li>}
        {rows?.map((r, i) => (
          <li key={i} className="border-l-2 border-line pl-2.5">
            <div className="flex gap-2 text-zinc-500">
              <span className="font-mono">{formatDateTime(r.at)}</span><span>{r.name || r.employee_id || '시스템'}</span>
            </div>
            <div className="font-medium text-zinc-800">{ACTION_LABELS[r.action] || r.action}</div>
            {changes(r.before, r.after).map((c) => <div key={c} className="text-zinc-600">{c}</div>)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Entry 상세(설계 §6.1 `/e/{entryId}`) — 인라인 수정 머리말, 파일 트리, 미리보기, 변경 이력. */
export default function EntryPage() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const { entry, status, error, setError, save } = useEntry(entryId);
  const [picked, setPicked] = useState(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { setPicked(null); setAdding(false); setNotice(''); }, [entryId]);

  if (status === 'missing') return <EmptyState icon={FileQuestion} title="자료를 찾을 수 없습니다">주소의 Entry 번호를 확인해 주세요.</EmptyState>;
  if (!entry) {
    return error ? <p role="alert" className="p-6 text-[13px] text-err">{error}</p>
      : <div className="m-6 h-40 animate-pulse rounded-lg bg-zinc-200/60" />;
  }

  const editable = entry.status === 'confirmed';
  const [statusLabel, statusCls] = STATUS[entry.status] || [entry.status, ''];
  const file = entry.files.find((f) => f.id === picked) || entry.files.find((f) => f.kind === 'report') || entry.files[0];
  const field = (name, props = {}) => (
    <InlineText label={FIELD_LABELS[name]} value={entry[name]} disabled={!editable}
                onSave={(v) => save({ [name]: v || null })} {...props} />
  );

  async function onTrash() {
    if (!window.confirm(`${entry.entry_id} ‘${entry.title}’ 을 휴지통으로 보낼까요? 휴지통에서 복원할 수 있습니다.`)) return;
    try {
      await api(`/entries/${entry.entry_id}`, { method: 'DELETE' });
      navigate('/trash');
    } catch (err) { setError(errorText(err, '휴지통으로 보내지 못했습니다.')); }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-zinc-500">{entry.entry_id}</span>
          <span className={`font-semibold ${statusCls}`}>● {statusLabel}</span>
          <div className="flex-1" />
          {editable && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setAdding(!adding)}><Upload size={13} aria-hidden="true" />파일 추가</Button>
              <Button variant="danger" size="sm" onClick={onTrash}><Trash2 size={13} aria-hidden="true" />휴지통으로</Button>
            </>
          )}
        </div>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {field('title', { validate: (v) => (!v ? '제목을 입력해 주세요.' : '') })}
        </h1>
        {entry.status === 'draft' && (
          <p className="mt-2 text-[13px] text-wait">미확정 자료는 <Link to="/inbox" className="font-semibold underline">정리 대기에서 고치고 확정합니다</Link>.</p>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] text-err">{error}</p>}
        <dl className="mt-4 grid grid-cols-[88px_1fr] gap-x-4 gap-y-2 text-[13px] md:grid-cols-[88px_1fr_88px_1fr]">
          <dt className="text-zinc-500">호선</dt>
          <dd>
            {editable ? <ChipInput label="호선" kind="hull" values={entry.hulls.map((h) => h.hull_no)} validate={hullRule}
                                   onChange={(v) => save({ hulls: v })} />
              : <span className="flex gap-1">{entry.hulls.map((h) => h.hull_no).join(', ') || '—'}</span>}
            <span className="mt-1 flex flex-wrap gap-1">
              {entry.hulls.map((h) => (
                <Link key={h.hull_no} to={`/h/${h.hull_no}`} className="rounded bg-brand-tint px-1.5 font-mono text-xs font-semibold text-brand hover:underline">{h.hull_no}</Link>
              ))}
            </span>
          </dd>
          <dt className="text-zinc-500">구역</dt>
          <dd>{editable ? <ChipInput label="구역" kind="zone" values={entry.zones} onChange={(v) => save({ zones: v })} /> : entry.zones.join(', ') || '—'}</dd>
          <dt className="text-zinc-500">해석 종류</dt><dd>{field('analysis_type')}</dd>
          <dt className="text-zinc-500">해석 시기</dt><dd className="font-mono">{field('analysis_period', { validate: periodRule, placeholder: 'YYYY-MM' })}</dd>
          <dt className="text-zinc-500">태그</dt>
          <dd>{editable ? <ChipInput label="태그" kind="tag" values={entry.tags} onChange={(v) => save({ tags: v })} /> : entry.tags.join(', ') || '—'}</dd>
          <dt className="text-zinc-500">올린 사람</dt>
          <dd className="font-mono text-xs text-zinc-600">{entry.uploaded_by || '—'} · 확정 {entry.confirmed_by || '—'} {formatDateTime(entry.confirmed_at)}</dd>
          <dt className="text-zinc-500">설명</dt>
          <dd className="md:col-span-3">{field('description', { multiline: true, placeholder: '설명 없음' })}</dd>
        </dl>
        {adding && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs text-zinc-600">여기 올린 파일은 정리 대기에서 확정하면 이 자료에 추가됩니다.</p>
            <UploadZone targetEntryId={entry.entry_id}
                        onUploaded={() => setNotice('올렸습니다. 정리 대기에서 확정하면 이 자료에 추가됩니다.')} />
            {notice && <p role="status" className="mt-2 text-xs text-ok">{notice} <Link to="/inbox" className="underline">정리 대기로</Link></p>}
          </div>
        )}
      </header>

      <div className="mt-5 flex gap-5">
        <div className="w-80 shrink-0">
          <h2 className="mb-2 text-xs font-semibold text-zinc-500">파일 {entry.files.length}개</h2>
          <ul role="tree" aria-label="파일" className="rounded-lg border border-line bg-white p-1.5">
            <TreeNodes nodes={buildTree(entry.files)} selectedId={file?.id} onPick={setPicked} />
          </ul>
          <History entryId={entry.entry_id} version={entry.version} />
        </div>
        <div className="min-w-0 flex-1">
          {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} />
            : <p className="text-[13px] text-zinc-500">파일이 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
```

(`UploadZone` 의 `onUploaded` 호출 시점과 인자는 02b 구현을 따른다. "파일 추가" 테스트는 안내 문구만 확인한다. `TreeNodes` 가 `useState` 를 쓰는데 재귀 컴포넌트라 층마다 상태가 따로 있다. 이는 의도된 동작이다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/pages/EntryPage.test.jsx src/components/inbox`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03b Entry 상세 화면`

---

### Task 5: 호선 목록·호선 화면

**Files:**
- Create: `frontend/src/pages/HullsPage.jsx`, `frontend/src/pages/HullPage.jsx`
- Test: `frontend/src/pages/HullPage.test.jsx`

규칙:
- **`/hulls`**
  - 호선 번호 앞자리로 거르는 입력칸이 있다(200ms 뒤 `/hulls?q=`).
  - 표 열: 호선(링크, mono) · 선종 · 자료 수 · 최근 확정일.
  - 비면 "아직 확정된 자료가 없습니다".
- **`/h/:hullNo`**
  - 머리말: 호선 번호(큰 mono). 선종·메모는 `InlineText` 로 고친다(누구나). `PATCH /hulls/{no}` 하고 응답으로 갱신한다.
  - 머리말에 [이 호선 자료 검색] 링크(`/?hull=9999`)와, 미확정이 있으면 "미확정 N건" 을 둔다.
  - 통계 타일 4개: 자료, 파일, 해석 종류 수, 참여자 수.
  - 월별 타임라인(가운데): 월 제목(mono) 아래 그 달 자료 행. 행 내용은 Entry 번호 · 제목 링크 · 해석 종류 · 구역 · 파일 종류 배지다.
  - 오른쪽 열: 구역 분포(가로 막대, 최대값 대비 폭), 해석 종류 분포(가로 막대), 참여자(이름 · 건수).
  - 없는 호선이면 EmptyState "등록된 호선이 아닙니다".

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/pages/HullPage.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import HullPage from './HullPage.jsx';
import HullsPage from './HullsPage.jsx';

const HULL = { hull_no: '9999', ship_type: null, memo: null, drafts: 1,
  stats: { entries: 2, files: 3, kinds: { report: 2, model: 1 },
           analysis_types: [{ value: 'Mooring', count: 1 }, { value: 'Strength', count: 1 }],
           zones: [{ value: '선수부', count: 1 }], people: [{ employee_id: 'A100002', name: '김해석', count: 1 }] },
  timeline: [
    { month: '2026-09', entries: [{ entry_id: 'E000002', title: '갑판 강도', analysis_type: 'Strength', zones: [], uploaded_by: 'A100002', confirmed_at: '2026-09-05T00:00:00', kinds: ['report'] }] },
    { month: '2026-08', entries: [{ entry_id: 'E000001', title: '계류 검토', analysis_type: 'Mooring', zones: ['선수부'], uploaded_by: 'A100001', confirmed_at: '2026-09-02T00:00:00', kinds: ['model', 'report'] }] },
  ] };

function renderAt(url, map) {
  mockApi(map);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/h/:hullNo" element={<HullPage />} /><Route path="/hulls" element={<HullsPage />} /></Routes>
    </MemoryRouter>,
  );
}

test('호선 화면 — 통계·타임라인·분포', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL });
  expect(await screen.findByRole('heading', { name: /9999/ })).toBeInTheDocument();
  expect(screen.getByText('미확정 1건')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '이 호선 자료 검색' })).toHaveAttribute('href', '/?hull=9999');
  const tl = screen.getByRole('list', { name: '월별 타임라인' });
  const months = within(tl).getAllByRole('heading').map((h) => h.textContent);
  expect(months).toEqual(['2026-09', '2026-08']);
  expect(within(tl).getByRole('link', { name: '계류 검토' })).toHaveAttribute('href', '/e/E000001');
  expect(screen.getByRole('region', { name: '구역 분포' })).toHaveTextContent('선수부');
  expect(screen.getByRole('region', { name: '참여자' })).toHaveTextContent('김해석');
});

test('선종을 고친다', async () => {
  renderAt('/h/9999', { 'GET /api/hulls/9999': HULL,
    'PATCH /api/hulls/9999': (init) => ({ hull_no: '9999', memo: null, ...JSON.parse(init.body) }) });
  await userEvent.click(await screen.findByRole('button', { name: '선종 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '선종' }), 'LNGC{Enter}');
  expect(await screen.findByText('LNGC')).toBeInTheDocument();
});

test('없는 호선', async () => {
  renderAt('/h/1234', { 'GET /api/hulls/1234': { __status: 404, detail: 'hull_not_found' } });
  expect(await screen.findByText('등록된 호선이 아닙니다')).toBeInTheDocument();
});

test('호선 목록', async () => {
  renderAt('/hulls', { 'GET /api/hulls?q=': [{ hull_no: '9999', ship_type: 'LNGC', entries: 2, last_at: '2026-09-05T00:00:00' }] });
  const link = await screen.findByRole('link', { name: '9999' });
  expect(link).toHaveAttribute('href', '/h/9999');
  expect(screen.getByText('LNGC')).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/pages/HullPage.test.jsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`frontend/src/pages/HullsPage.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Anchor } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText, formatDateTime } from '../lib/labels.js';

/** 호선 목록(`/hulls`) — 확정 자료가 있는 호선, 최근 순. */
export default function HullsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const reqRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const id = ++reqRef.current;
    api(`/hulls?q=${encodeURIComponent(q)}`).then((r) => { if (id === reqRef.current) setRows(r); })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '호선 목록을 불러오지 못했습니다.')); });
  }, [q]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  function onChange(e) {
    setText(e.target.value);
    clearTimeout(timerRef.current);
    const v = e.target.value.trim();
    timerRef.current = setTimeout(() => setParams(v ? { q: v } : {}, { replace: true }), 200);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">호선</h1>
        <input aria-label="호선 번호" value={text} onChange={onChange} placeholder="번호 앞자리" inputMode="numeric"
               className="h-8 w-40 rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring" />
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {rows?.length === 0 && <EmptyState icon={Anchor} title="아직 확정된 자료가 없습니다">자료를 올리고 확정하면 호선이 여기에 나타납니다.</EmptyState>}
      {rows?.length > 0 && (
        <table className="mt-4 w-full overflow-hidden rounded-lg border border-line bg-white text-[13px]">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr><th className="px-4 py-2 font-medium">호선</th><th className="px-4 py-2 font-medium">선종</th>
                <th className="px-4 py-2 text-right font-medium">자료</th><th className="px-4 py-2 font-medium">최근 확정</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.hull_no} className="hover:bg-zinc-50">
                <td className="px-4 py-2"><Link to={`/h/${r.hull_no}`} className="font-mono font-semibold text-brand hover:underline">{r.hull_no}</Link></td>
                <td className="px-4 py-2 text-zinc-700">{r.ship_type || '—'}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{r.entries}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-500">{formatDateTime(r.last_at).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

`frontend/src/pages/HullPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Anchor, Search } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { errorText } from '../lib/labels.js';

function Bars({ title, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold text-zinc-500">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-zinc-400">없음</p>}
      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.value} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-zinc-700">{r.value}</span>
            <span className="h-2 rounded-full bg-brand/70" style={{ width: `${(r.count / max) * 100}%`, minWidth: 4 }} />
            <span className="font-mono tabular-nums text-zinc-500">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 호선 화면(설계 §6.1 `/h/{hull}`) — 통계, 월별 타임라인, 구역 분포, 참여자. */
export default function HullPage() {
  const { hullNo } = useParams();
  const [hull, setHull] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setHull(null); setMissing(false); setError('');
    api(`/hulls/${hullNo}`).then(setHull).catch((err) => {
      if (err.status === 404) setMissing(true); else setError(errorText(err, '호선 정보를 불러오지 못했습니다.'));
    });
  }, [hullNo]);

  async function saveHull(patch) {
    try {
      const h = await api(`/hulls/${hullNo}`, { method: 'PATCH', body: patch });
      setHull((cur) => ({ ...cur, ship_type: h.ship_type, memo: h.memo }));
      setError('');
    } catch (err) { setError(errorText(err, '저장하지 못했습니다.')); }
  }

  if (missing) return <EmptyState icon={Anchor} title="등록된 호선이 아닙니다">확정된 자료가 있는 호선만 볼 수 있습니다.</EmptyState>;
  if (!hull) return error ? <p role="alert" className="p-6 text-[13px] text-err">{error}</p> : <div className="m-6 h-40 animate-pulse rounded-lg bg-zinc-200/60" />;

  const s = hull.stats;
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="font-mono text-3xl font-bold tracking-tight text-brand">{hull.hull_no}<span className="sr-only"> 호선</span></h1>
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="text-zinc-500">선종 <InlineText label="선종" value={hull.ship_type} onSave={(v) => saveHull({ ship_type: v || null })} className="text-zinc-900" /></span>
          <span className="text-zinc-500">메모 <InlineText label="메모" value={hull.memo} onSave={(v) => saveHull({ memo: v || null })} className="text-zinc-900" /></span>
        </div>
        <div className="flex-1" />
        {hull.drafts > 0 && <span className="text-xs font-semibold text-wait">미확정 {hull.drafts}건</span>}
        <Link to={`/?hull=${hull.hull_no}`} className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">
          <Search size={14} aria-hidden="true" />이 호선 자료 검색
        </Link>
      </header>
      {error && <p role="alert" className="mt-2 text-[13px] text-err">{error}</p>}
      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="자료" value={s.entries} /><Stat label="파일" value={s.files} />
        <Stat label="해석 종류" value={s.analysis_types.length} /><Stat label="참여자" value={s.people.length} />
      </div>
      <div className="mt-5 flex gap-5">
        <ol aria-label="월별 타임라인" className="min-w-0 flex-1 space-y-4">
          {hull.timeline.length === 0 && <li className="text-[13px] text-zinc-500">확정된 자료가 없습니다.</li>}
          {hull.timeline.map((m) => (
            <li key={m.month}>
              <h2 className="mb-1.5 font-mono text-xs font-semibold text-zinc-500">{m.month}</h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                {m.entries.map((e) => (
                  <li key={e.entry_id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="w-20 shrink-0 font-mono text-xs text-zinc-500">{e.entry_id}</span>
                    <Link to={`/e/${e.entry_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand hover:underline">{e.title}</Link>
                    {e.analysis_type && <span className="text-xs text-zinc-600">{e.analysis_type}</span>}
                    {e.zones.length > 0 && <span className="text-xs text-zinc-500">{e.zones.join(', ')}</span>}
                    <span className="flex gap-1">{e.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="w-72 shrink-0 space-y-3">
          <Bars title="구역 분포" rows={s.zones} />
          <Bars title="해석 종류" rows={s.analysis_types} />
          <section aria-label="참여자" className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold text-zinc-500">참여자</h2>
            <ul className="space-y-1 text-xs">
              {s.people.map((p) => (
                <li key={p.employee_id} className="flex justify-between"><span>{p.name || p.employee_id}</span>
                  <span className="font-mono text-zinc-500">{p.count}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/pages/HullPage.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03b 호선 목록·호선 화면`

---

### Task 6: 태그 화면

**Files:**
- Create: `frontend/src/pages/TagsPage.jsx`
- Test: `frontend/src/pages/TagsPage.test.jsx`

규칙(설계 §6.1 `/tags`):
- 탭 두 개: 구역(`zone`) / 자유 태그(`free`). `GET /tags?kind=` 로 불러온다.
- **묶음 목록**: 대표 태그(`alias_of` 없음)를 이름순으로 보이고, 그 아래에 동의어를 들여쓰기해 보인다. 사용 횟수는 mono 로 보인다. 위쪽 거르기 입력칸은 대표·동의어 값 어디에든 맞으면 그 묶음을 보인다.
- **대표 행**: [동의어로 묶기] 를 누르면 같은 종류의 다른 대표 태그 `<select aria-label="대표 태그">` 와 [묶기] 가 나온다. 묶으면 `POST /tags/{id}/alias {target_id}` 한 뒤 목록을 다시 불러온다.
- **동의어 행**: [풀기] 로 `DELETE /tags/{id}/alias` 하고 다시 불러온다.
- 오류는 `errorText` 로 보인다. 위쪽 안내문: "동의어로 묶은 값은 검색·필터에서 함께 찾습니다. 원래 입력한 값은 그대로 남습니다."

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/pages/TagsPage.test.jsx`:

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { calls, mockApi } from '../test/mockApi.js';
import TagsPage from './TagsPage.jsx';

const ZONES = [
  { id: 1, kind: 'zone', value: '선수부', alias_of: null, count: 2 },
  { id: 2, kind: 'zone', value: 'FWD', alias_of: { id: 1, value: '선수부' }, count: 1 },
  { id: 3, kind: 'zone', value: '선미부', alias_of: null, count: 0 },
];

function renderPage(map) {
  const fetch = mockApi(map);
  render(<MemoryRouter><TagsPage /></MemoryRouter>);
  return fetch;
}

test('대표 아래 동의어를 보이고, 풀 수 있다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=zone': ZONES, 'DELETE /api/tags/2/alias': { ...ZONES[1], alias_of: null } });
  const group = (await screen.findByText('선수부')).closest('li');
  expect(within(group).getByText('FWD')).toBeInTheDocument();
  await userEvent.click(within(group).getByRole('button', { name: 'FWD 풀기' }));
  expect(calls(fetch).filter((c) => c === 'GET /api/tags?kind=zone')).toHaveLength(2);
  expect(calls(fetch)).toContain('DELETE /api/tags/2/alias');
});

test('다른 대표 태그의 동의어로 묶는다', async () => {
  const fetch = renderPage({ 'GET /api/tags?kind=zone': ZONES, 'POST /api/tags/3/alias': { ...ZONES[2], alias_of: { id: 1, value: '선수부' } } });
  const row = (await screen.findByText('선미부')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  const post = fetch.mock.calls.find(([u, i]) => i?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ target_id: 1 });
});

test('탭으로 자유 태그를 보고, 거르기로 좁힌다', async () => {
  renderPage({ 'GET /api/tags?kind=zone': ZONES, 'GET /api/tags?kind=free': [{ id: 9, kind: 'free', value: '계류', alias_of: null, count: 3 }] });
  await screen.findByText('선수부');
  await userEvent.type(screen.getByRole('searchbox', { name: '태그 거르기' }), 'fw');
  expect(screen.getByText('선수부')).toBeInTheDocument();
  expect(screen.queryByText('선미부')).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: '자유 태그' }));
  expect(await screen.findByText('계류')).toBeInTheDocument();
});

test('묶기 오류를 보인다', async () => {
  renderPage({ 'GET /api/tags?kind=zone': ZONES, 'POST /api/tags/3/alias': { __status: 422, detail: 'same_tag' } });
  const row = (await screen.findByText('선미부')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: '동의어로 묶기' }));
  await userEvent.selectOptions(within(row).getByRole('combobox', { name: '대표 태그' }), '1');
  await userEvent.click(within(row).getByRole('button', { name: '묶기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('자기 자신이나');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/pages/TagsPage.test.jsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`frontend/src/pages/TagsPage.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import { errorText } from '../lib/labels.js';

const KINDS = [['zone', '구역'], ['free', '자유 태그']];

function groupsOf(tags) {
  const roots = tags.filter((t) => !t.alias_of).sort((a, b) => a.value.localeCompare(b.value, 'ko'));
  return roots.map((r) => ({ root: r, aliases: tags.filter((t) => t.alias_of?.id === r.id) }));
}

function RootRow({ group, roots, onAlias }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const others = roots.filter((r) => r.id !== group.root.id);
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
      <span className="font-semibold text-zinc-900">{group.root.value}</span>
      <span className="font-mono text-xs text-zinc-500">{group.root.count}</span>
      <div className="flex-1" />
      {open ? (
        <>
          <select aria-label="대표 태그" value={target} onChange={(e) => setTarget(e.target.value)}
                  className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs">
            <option value="">대표 태그 선택…</option>
            {others.map((r) => <option key={r.id} value={r.id}>{r.value}</option>)}
          </select>
          <Button size="sm" disabled={!target} onClick={() => onAlias(group.root, Number(target))}>묶기</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>취소</Button>
        </>
      ) : (
        others.length > 0 && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Link2 size={13} aria-hidden="true" />동의어로 묶기</Button>
      )}
    </div>
  );
}

/** 태그 화면(설계 §6.1 `/tags`) — 사용 횟수, 동의어 묶기·풀기. 누구나 할 수 있고 기록된다. */
export default function TagsPage() {
  const [kind, setKind] = useState('zone');
  const [tags, setTags] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api(`/tags?kind=${kind}`).then(setTags)
    .catch((err) => setError(errorText(err, '태그를 불러오지 못했습니다.'))), [kind]);
  useEffect(() => { setTags(null); setError(''); load(); }, [load]);

  async function act(fn) {
    setError('');
    try { await fn(); await load(); } catch (err) { setError(errorText(err, '처리하지 못했습니다.')); }
  }
  const alias = (tag, targetId) => act(() => api(`/tags/${tag.id}/alias`, { method: 'POST', body: { target_id: targetId } }));
  const unalias = (tag) => act(() => api(`/tags/${tag.id}/alias`, { method: 'DELETE' }));

  const groups = groupsOf(tags || []);
  const f = filter.trim().toLowerCase();
  const shown = f ? groups.filter((g) => [g.root, ...g.aliases].some((t) => t.value.toLowerCase().includes(f))) : groups;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-bold tracking-tight">태그</h1>
      <p className="mt-1 text-[13px] text-zinc-600">동의어로 묶은 값은 검색·필터에서 함께 찾습니다. 원래 입력한 값은 그대로 남습니다.</p>
      <div className="mt-4 flex items-center gap-3">
        <div role="tablist" aria-label="태그 종류" className="flex rounded-md border border-line bg-white p-0.5 text-xs">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                    className={`h-6 rounded px-3 ${kind === k ? 'bg-brand text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{label}</button>
          ))}
        </div>
        <input type="search" aria-label="태그 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="거르기"
               className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2.5 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring" />
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {tags && shown.length === 0 && <p className="mt-6 text-[13px] text-zinc-500">태그가 없습니다.</p>}
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        {shown.map((g) => (
          <li key={g.root.id}>
            <RootRow group={g} roots={groups.map((x) => x.root)} onAlias={alias} />
            {g.aliases.length > 0 && (
              <ul className="pb-2">
                {g.aliases.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-1 pl-10 pr-4 text-[13px] text-zinc-700">
                    <span className="text-zinc-400">↳</span><span>{a.value}</span>
                    <span className="font-mono text-xs text-zinc-500">{a.count}</span>
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" aria-label={`${a.value} 풀기`} onClick={() => unalias(a)}>
                      <Unlink size={13} aria-hidden="true" />풀기
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/pages/TagsPage.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋(사람)** — `feat: 03b 태그 동의어 화면`

---

### Task 7: 라우트 연결, 빌드

**Files:**
- Modify: `frontend/src/App.jsx`, `frontend/src/components/shell/SideNav.jsx`
- Delete: `frontend/src/pages/PlaceholderPage.jsx` (더는 쓰지 않음 — 다른 곳에서 import 하지 않는지 확인 후)
- Test: `frontend/src/components/shell/SideNav.test.jsx`(추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`SideNav.test.jsx` 끝에 추가한다. 파일 머리의 기존 import 와 렌더 방식을 따른다:

```jsx
test('호선 화면(/h/9999)에서도 호선 메뉴가 활성이다', () => {
  render(<MemoryRouter initialEntries={['/h/9999']}><SideNav isAdmin={false} storage={{ reachable: true }} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: '호선' })).toHaveClass('bg-brand-tint');
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/shell/SideNav.test.jsx` → FAIL

- [ ] **Step 3: 구현**

`SideNav.jsx` 를 고친다.
- `ITEMS` 의 호선 항목에 `also: ['/h/']` 를 더한다.
- `useLocation()` 으로 현재 경로를 얻는다.
- `className={(s) => linkClass({ isActive: s.isActive || also?.some((p) => pathname.startsWith(p)) })}` 로 넘긴다.

`App.jsx` 를 고친다.
- `PlaceholderPage` import 를 지운다.
- `SearchPage`·`HullsPage`·`HullPage`·`EntryPage`·`TagsPage` 를 import 한다.
- 라우트를 다음과 같이 둔다:

```jsx
            <Route index element={<SearchPage />} />
            <Route path="hulls" element={<HullsPage />} />
            <Route path="h/:hullNo" element={<HullPage />} />
            <Route path="e/:entryId" element={<EntryPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="tags" element={<TagsPage />} />
```

`SearchPage` 는 전체 높이를 쓴다(`h-full`). 그래서 `AppShell` 의 `<main className="min-w-0 flex-1 overflow-auto">` 안에서 필터·결과·패널이 각자 스크롤한다. `main` 을 바꿀 필요는 없다.

- [ ] **Step 4: 전체 확인**

Run: `npm test`
Expected: 전체 PASS(기존 102 + 새 테스트)

Run: `npm run build`
Expected: 성공, `frontend/dist` 갱신

- [ ] **Step 5: 커밋(사람)** — `feat: 03b 라우트 연결`

---

### Task 8: 실제 공유 폴더 E2E (컨트롤러가 직접 수행)

- [ ] 03a Task 10 과 같은 방식으로 API·워커를 띄운다.
- [ ] 합성 9999 자료(PPTX·XLSX·PDF)를 크롬 업로드로 올려 확정한다.
- [ ] Playwright(스크래치패드 `pw/`, playwright 1.61.0)로 다음을 확인한다.
  1. 상단 검색에 "강도" 를 입력하면 결과·발췌 강조가 나온다.
  2. 호선 필터 건수가 보이고, 호선 제안으로 좁힐 수 있다.
  3. 결과를 누르면 패널이 열리고 PDF iframe 이 나온다.
  4. Entry 상세에서 제목을 고치면 이력에 남는다. 경로 복사 문구를 확인한다.
  5. XLSX 시트 탭이 동작한다.
  6. `/h/9999` 타임라인이 나온다.
  7. `/tags` 에서 구역 동의어를 묶고, 검색에 반영되는지 확인한다.
  8. 콘솔 오류가 0건이다.
  9. 스크린샷으로 디자인을 점검한다.
- [ ] 시험 Entry 를 휴지통으로 보내고 서버를 멈춘다.
- [ ] `docs/plans/README.md` 의 03 줄을 03a·03b 로 나눈다.

---

## 자체 점검 (계획 작성 시)

- 설계 §6.1 화면 목록 중 `/`·`/h/{hull}`·`/e/{id}`·`/tags` → Task 3·5·4·6. `/hulls` 목록은 좌측 메뉴 진입점이다(설계에는 없지만 메뉴가 있다).
- §6.2
  - 즉시 결과(200ms) → Task 3 TopBar.
  - Ctrl+K → 기존 TopBar.
  - 4자리 호선 제안 → Task 3.
  - 순위·발췌 → 서버(03a) + Task 3 표시.
  - 필터 8종: 7개 차원 + 미확정 포함.
  - 보기 단위 → Task 3.
  - 동의어 → Task 6 + 서버.
- §6.3
  - PDF(크롬 내장 뷰어) / PPTX 슬라이드 목록 / XLSX 시트 탭 + 200행 / 그 외 다운로드 / 경로 복사 → Task 2.
  - BDF 3D 뷰어는 계획 04.
- §5.6 기존 Entry 에 추가 → Task 4.
- §8 확정 후 수정은 누구나·휴지통 → Task 4.
