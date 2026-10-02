# Logbook 04b — BDF 3D 뷰어 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 04a 가 만든 `model.lbm` 을 크롬에서 3D 로 본다(설계 §7.3·§7.4 MVP ①~④).
- 1D·2D 표시와 시점 조작
- PID 별 색과 표시 토글
- 요소 클릭 정보
- RBE2·RBE3·CONM2·SPC 표시 토글

Entry 상세·검색 미리보기·전체 화면(`/v/:fileId`)에서 쓰고, 목록에는 썸네일을 보인다.

**Architecture:**
- `lib/lbm.js` 가 바이너리를 TypedArray 로 읽는다.
- `lib/modelGeometry.js`(순수)가 PID 별 삼각형·경계선·선 인덱스와 피킹 표를 만든다.
- `lib/elementInfo.js`·`lib/viewFrame.js` 도 순수 함수다.
- three.js 는 `components/viewer/viewerEngine.js` 한 곳에만 둔다(장면·직교 카메라·온디맨드 렌더·GPU 피킹).
- 화면 컴포넌트 `ModelViewer.jsx` 는 엔진을 `ViewerEngineContext` 로 받아, 테스트에서 가짜 엔진을 끼운다. jsdom 에는 WebGL 이 없다.
- 뷰어는 `React.lazy` 로 따로 묶어 검색 화면 번들에 three 가 섞이지 않게 한다.

**Tech Stack:** React 19 · three 0.184(OrbitControls) · Vitest · Tailwind v4(디자인 토큰은 `DESIGN.md`)

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md` §7.3(PID 별 병합 메시, 경계선 토글, 직교 카메라, 시점 프리셋, GPU 피킹, 대형 모델 경계선 기본 끔), §7.4(MVP ①~④), §7.7(실패 사유 표시), §6.3(BDF = 3D 뷰어)

**이식 근거(재사용 목록 §2):** WorkBench `HiTessWorkBench/frontend/src/components/analysis/FeModelViewer.jsx` 에서 다음을 가져온다.
- 온디맨드 렌더, damping 끔
- 카메라에 붙인 조명
- `OrbitControls` 설정: 왼쪽 회전, 가운데 확대, 오른쪽 이동, `zoomToCursor`
- `webglcontextlost` 복구
- StrictMode 의 `frameRef` 초기화 함정 주석
- `utils/feModelCamera.js` 의 직교 카메라 생성·리사이즈

읽어서 그대로 이식한다. 쉘 경계선은 `feGeometry.buildShellEdgeIndices` 와 같은 방식(요소 테두리 선분)이다.

**디자인:** `DESIGN.md`·`PRODUCT.md` 를 따른다.
- 뷰어 바탕은 토큰 `viewer`(`#0E1A2B`)이고, 그 위 글자·링크는 `*-on-dark` 토큰을 쓴다.
- 도구줄·PID 목록은 밝은 크롬(작업면) 쪽에 둔다.

---

## 공통 규칙 (모든 태스크)

- 프런트 명령은 `C:\Coding\Logbook\frontend` 에서 실행한다(`npx vitest run <파일>`, 전체 `npm test`, `npm run build`).
- 백엔드 명령은 `C:\Coding\Logbook\backend` 에서 `.venv\Scripts\python.exe -m pytest ...` 로 순차 실행한다.
- **git 금지**, **`backend\.env` 열기 금지**.
- 색은 `index.css` `@theme` 토큰만 쓴다(Tailwind 기본 팔레트는 꺼져 있다). PID 색은 3D 데이터 색이라 `lib/pidPalette.js` 에 상수로 둔다(UI 토큰이 아니다).
- 새 테스트는 `src/test/mockApi.js` 를 쓴다. 바이너리 응답이 필요하면 Task 2 에서 확장한다.
- 실제 호선·기밀 모델 금지. 테스트 모델은 코드로 만든 작은 합성 모델이다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/app/routers/files.py` (수정) | `GET /api/files/{id}` 파일 메타 |
| `frontend/package.json` (수정) | `three@~0.184.0` |
| `frontend/src/api/client.js` (수정) | `apiArrayBuffer`·`apiBlob` |
| `frontend/src/test/mockApi.js` (수정) | `{ __binary }`·`{ __blob }` 응답 |
| `frontend/src/lib/lbm.js` (새) | `parseLbm` |
| `frontend/src/lib/pidPalette.js` (새) | PID 색(어두운 바탕용) |
| `frontend/src/lib/modelGeometry.js` (새) | `buildGeometry`·`encodePick`·`decodePick` |
| `frontend/src/lib/elementInfo.js` (새) | `elementInfo`·`sectionLabel` |
| `frontend/src/lib/viewFrame.js` (새) | 시점 프리셋·`computeFrame` |
| `frontend/src/components/viewer/viewerEngine.js` (새) | three 장면·카메라·렌더·피킹 |
| `frontend/src/components/viewer/ViewerEngineContext.js` (새) | 엔진 공장 컨텍스트 |
| `frontend/src/components/viewer/ModelViewer.jsx` (새) | 도구줄·캔버스·PID 목록·요소 정보 |
| `frontend/src/components/viewer/ModelThumb.jsx` (새) | 인증 썸네일(blob URL 캐시) |
| `frontend/src/components/preview/ModelPreview.jsx` (새) | 모델 파일 미리보기(상태·썸네일·뷰어) |
| `frontend/src/components/preview/FilePreview.jsx` (수정) | `kind === 'model'` 이면 ModelPreview |
| `frontend/src/components/search/ResultList.jsx` (수정) | 파일 보기 모델 행에 썸네일 |
| `frontend/src/pages/ViewerPage.jsx` (새) | `/v/:fileId` 전체 화면 |
| `frontend/src/App.jsx` (수정) | 라우트 |
| `frontend/src/lib/labels.js`·`lib/search.js` (수정) | 모델 상태·오류 라벨, `model` 위치 라벨 |

---

### Task 1: 파일 메타 API (백엔드)

**Files:**
- Modify: `backend/app/routers/files.py`
- Test: `backend/tests/test_file_meta_api.py`

전체 화면 뷰어(`/v/:fileId`)가 파일 이름·소속 Entry 를 알아야 한다. 휴지통 파일은 기존 `_file()` 이 404 로 막는다.

- [ ] **Step 1: 실패하는 테스트**

```python
def test_file_meta(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    e, f = make_entry_file(title="모델 검토", name="sub/m.bdf", kind="model")
    d = client.get(f"/api/files/{f.id}", headers=h).json()
    assert d == {"id": f.id, "name": "m.bdf", "rel_path": "sub/m.bdf", "kind": "model", "size": 10,
                 "entry_id": e.entry_id, "entry_title": "모델 검토", "entry_status": "confirmed"}
    assert client.get(f"/api/files/{f.id}").status_code == 401
    assert client.get("/api/files/999999", headers=h).status_code == 404
```

- [ ] **Step 2:** `.venv\Scripts\python.exe -m pytest tests/test_file_meta_api.py -v` → FAIL(405 또는 404)
- [ ] **Step 3: 구현** — `files.py` 에 다음을 더한다. 라우트 순서: `/{file_id}` 는 `/{file_id}/...` 와 겹치지 않는다.

```python
@router.get("/{file_id}")
def file_meta(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    f = _file(db, file_id)
    e = db.get(models.Entry, f.entry_id) if f.entry_id else None
    return {"id": f.id, "name": f.name, "rel_path": f.rel_path, "kind": f.kind, "size": f.size,
            "entry_id": e.entry_id if e else None, "entry_title": e.title if e else None,
            "entry_status": e.status if e else None}
```

- [ ] **Step 4:** 같은 테스트 PASS, `pytest -q` 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 04b 파일 메타 API`

---

### Task 2: 의존성·API 도구·`parseLbm`

**Files:**
- Modify: `frontend/package.json`(npm 으로), `frontend/src/api/client.js`, `frontend/src/test/mockApi.js`
- Create: `frontend/src/lib/lbm.js`
- Test: `frontend/src/lib/lbm.test.js`, `frontend/src/api/client.test.js`(추가)

`model.lbm` 형식(04a Task 3)을 정리하면 다음과 같다.
- 바이트 배치: `"LBM1"` | u32(LE) 머리말 길이 | 머리말 JSON | 본문 블록이다.
- 블록 `offset` 은 본문 시작 기준이고 4바이트 정렬이다.
- dtype 은 `<i4`(Int32), `<f4`(Float32), `|u1`(Uint8) 이다.
- 서버가 `Content-Encoding: gzip` 으로 보내므로 `fetch` 가 받은 바이트는 이미 풀려 있다.

- [ ] **Step 1: 설치**

Run: `npm i three@~0.184.0`
Expected: `package.json` dependencies 에 `"three": "~0.184.x"` 가 들어간다.

- [ ] **Step 2: 실패하는 테스트**

`frontend/src/lib/lbm.test.js`:

```js
import { parseLbm } from './lbm.js';

/** 테스트용 인코더 — 04a 형식 그대로(머리말 4바이트 정렬, 블록 4바이트 정렬). */
export function encodeLbm(header, blocks) {
  const parts = [];
  let offset = 0;
  const metas = {};
  for (const [name, { dtype, width, data }] of Object.entries(blocks)) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    metas[name] = { offset, dtype, count: width > 1 ? data.length / width : data.length, width };
    parts.push(bytes);
    offset += bytes.byteLength;
  }
  let json = new TextEncoder().encode(JSON.stringify({ ...header, blocks: metas }));
  const hpad = (4 - (json.length % 4)) % 4;
  if (hpad) json = new Uint8Array([...json, ...new Array(hpad).fill(32)]);
  const out = new Uint8Array(8 + json.length + offset);
  out.set(new TextEncoder().encode('LBM1'), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let p = 8 + json.length;
  for (const part of parts) { out.set(part, p); p += part.byteLength; }
  return out.buffer;
}

test('블록을 형식대로 읽는다', () => {
  const buf = encodeLbm({ version: 1, counts: { CROD: 1 } }, {
    node_ids: { dtype: '<i4', width: 1, data: new Int32Array([1, 2]) },
    node_xyz: { dtype: '<f4', width: 3, data: new Float32Array([0, 0, 0, 1000, 0, 0]) },
    beam_cards: { dtype: '|u1', width: 1, data: new Uint8Array([2]) },
    beams: { dtype: '<i4', width: 4, data: new Int32Array([7, 1, 0, 1]) },
  });
  const m = parseLbm(buf);
  expect(m.header.counts.CROD).toBe(1);
  expect(Array.from(m.blocks.node_ids)).toEqual([1, 2]);
  expect(m.blocks.node_xyz).toBeInstanceOf(Float32Array);
  expect(Array.from(m.blocks.node_xyz)).toEqual([0, 0, 0, 1000, 0, 0]);
  expect(Array.from(m.blocks.beams)).toEqual([7, 1, 0, 1]);
  expect(m.blocks.beam_cards).toBeInstanceOf(Uint8Array);
  expect(m.width.beams).toBe(4);
});

test('형식이 아니면 오류', () => {
  expect(() => parseLbm(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow('LBM');
});
```

`frontend/src/api/client.test.js` 끝에 추가한다. 파일 머리의 import 에 `apiArrayBuffer` 를 더한다.

```js
test('apiArrayBuffer 는 Bearer 를 붙여 ArrayBuffer 를 돌려준다', async () => {
  localStorage.setItem('logbook_token', 'tok');
  const buf = new Uint8Array([1, 2, 3]).buffer;
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buf) }));
  vi.stubGlobal('fetch', fetchMock);
  const got = await apiArrayBuffer('/files/1/model.lbm');
  expect(new Uint8Array(got)).toEqual(new Uint8Array([1, 2, 3]));
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/lib/lbm.test.js src/api/client.test.js` → FAIL
- [ ] **Step 4: 구현**

`client.js` 끝에 더한다.

```js
async function fetchAuthed(path) {
  const token = tokenStore.get();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && tokenStore.get() === token) {
      tokenStore.clear();
      window.dispatchEvent(new Event('logbook:unauthorized'));
    }
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return res;
}

/** 바이너리 응답(model.lbm). gzip 은 브라우저가 Content-Encoding 으로 이미 풀어 준다. */
export async function apiArrayBuffer(path) {
  return (await fetchAuthed(path)).arrayBuffer();
}

/** 이미지 등 Blob 응답(썸네일). */
export async function apiBlob(path) {
  return (await fetchAuthed(path)).blob();
}
```

`test/mockApi.js` 의 성공 응답 분기를 확장한다. 값이 `{ __binary: ArrayBuffer }` 면 `arrayBuffer()` 를, `{ __blob: Blob }` 이면 `blob()` 을 주는 응답 객체를 만든다. 일반 값에는 기존처럼 `json()` 을 준다. 세 메서드를 모두 넣어 둔다:

```js
    const body = r ?? null;
    return {
      ok: true, status: 200,
      json: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(body?.__binary ?? new ArrayBuffer(0)),
      blob: () => Promise.resolve(body?.__blob ?? new Blob([])),
    };
```

`frontend/src/lib/lbm.js`:

```js
/** model.lbm 읽기(04a Task 3 형식). 블록은 버퍼를 복사하지 않는 TypedArray 보기로 준다(4바이트 정렬). */
const TYPES = { '<i4': Int32Array, '<f4': Float32Array, '|u1': Uint8Array };

export function parseLbm(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'LBM1') throw new Error('LBM 형식이 아닙니다');
  const hlen = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  const base = 8 + hlen;
  const blocks = {};
  const width = {};
  for (const [name, meta] of Object.entries(header.blocks || {})) {
    const T = TYPES[meta.dtype];
    if (!T) throw new Error(`LBM 블록 형식 미지원: ${meta.dtype}`);
    const n = meta.count * meta.width;
    const start = base + meta.offset;
    // 정렬이 맞으면 보기로, 아니면(이론상 없음) 복사
    blocks[name] = start % T.BYTES_PER_ELEMENT === 0
      ? new T(buffer, start, n)
      : new T(buffer.slice(start, start + n * T.BYTES_PER_ELEMENT));
    width[name] = meta.width;
  }
  return { header, blocks, width };
}
```

- [ ] **Step 5: 통과** — 같은 테스트 PASS
- [ ] **Step 6: 커밋(사람)** — `feat: 04b three 의존성·바이너리 API·lbm 읽기`

---

### Task 3: 순수 기하 — PID 묶음·피킹 표·요소 정보·시점

**Files:**
- Create: `frontend/src/lib/pidPalette.js`, `frontend/src/lib/modelGeometry.js`, `frontend/src/lib/elementInfo.js`, `frontend/src/lib/viewFrame.js`
- Test: `frontend/src/lib/modelGeometry.test.js`, `frontend/src/lib/elementInfo.test.js`, `frontend/src/lib/viewFrame.test.js`

규칙:
- **위치**: 절점 좌표는 bbox 중심을 빼서 `positions`(Float32Array)로 둔다. 큰 좌표에서 float32 정밀도가 깨지지 않게 하려는 것이다.
- **요소 순번**: 1D → 삼각형(CTRIA*) → 사각형(CQUAD*) 순으로 0부터 매긴다.
  - `elemKind`(Uint8: 0=beam, 1=tri, 2=quad)와 `elemRow`(블록 행)로 원래 행을 찾는다.
- **PID 묶음**: PID 마다 `{ pid, color, shell: Uint32Array(삼각형 인덱스), shellElem: Int32Array(삼각형마다 요소 순번), edges: Uint32Array(선분 쌍), beams: Uint32Array(선분 쌍), beamElem: Int32Array(선분마다 요소 순번), count }` 를 만든다. 묶음은 PID 오름차순이다.
  - 사각형은 (a,b,c)·(a,c,d) 두 삼각형이 같은 요소 순번을 갖는다.
  - 경계선은 요소 테두리이고, 공유 변은 두 번 그려도 된다.
- **표시물**: `rigid`: `{ rbe2: Uint32Array, rbe3: Uint32Array }`(선분 쌍), `masses`: Uint32Array, `spcs`: Uint32Array(절점 순번).
- **피킹 색**: `encodePick(i)` = 요소 순번+1 을 24비트 RGB 로 바꾼 것이다(0 = 빈 곳). `decodePick(r,g,b)` 는 그 역이고, 빈 곳이면 `null` 이다.
- **요소 정보**: `{ eid, card, pid, section, thickness, material, nodes: [절점 id], length }` 이다.
  - `length` 는 1D 만 있고 mm 소수 1자리다.
  - CONROD 는 PID 대신 `A`·재료를 `header.conrods` 에서 쓴다.
  - `section` 은 백엔드 지문과 같은 형식이다(`PBEAML L 100x100x10x10`, `PSHELL t12`, `PROD A50`).
  - `material` 은 `MAT1 E206000 ν0.3` 형식이다.
- **시점 프리셋**: `iso`(dir [1,-1,0.75], up z), `front`(정면 [0,-1,0], up z), `side`(측면 [1,0,0], up z), `top`(평면 [0,0,1], up y)이다. 평면도는 화면 →X·↑Y 다. WorkBench Studio 들과 같은 결정이다(2026-10-01).
  - `computeFrame(preset, radius, aspect)` 는 `{ position, up, halfHeight, halfWidth, near, far }` 를 준다.
  - 카메라는 중심(원점)에서 dir 방향으로 `radius*4` 떨어지고, `halfHeight = radius*1.08` 이다.
  - 가로가 좁은 화면이면 가로 기준으로 맞춘다.

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/lib/modelGeometry.test.js`:

```js
import { buildGeometry, decodePick, encodePick } from './modelGeometry.js';

export function sampleModel() {
  // 절점 1..5, CBEAM(pid 1) 1-2, CQUAD4(pid 5) 1-2-3-4, CTRIA3(pid 5) 2-3-5, RBE2 1→2,3, RBE3 4←1, CONM2 at 5, SPC at 1
  const header = {
    bbox: { min: [0, 0, 0], max: [1000, 1000, 500] },
    cards: { beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'], tri: ['CTRIA3', 'CTRIA6', 'CTRIAR'],
             quad: ['CQUAD4', 'CQUAD8', 'CQUADR'], rigid: ['RBE2', 'RBE3'] },
    properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 10, 10] }, 5: { card: 'PSHELL', mid: 1, t: 12 } },
    materials: { 1: { card: 'MAT1', E: 206000, G: null, nu: 0.3, rho: 7.85e-9 } },
    conrods: {},
  };
  const blocks = {
    node_ids: new Int32Array([1, 2, 3, 4, 5]),
    node_xyz: new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0, 1000, 1000, 500]),
    beams: new Int32Array([10, 1, 0, 1]), beam_cards: new Uint8Array([1]),
    tris: new Int32Array([21, 5, 1, 2, 4]), tri_cards: new Uint8Array([0]),
    quads: new Int32Array([20, 5, 0, 1, 2, 3]), quad_cards: new Uint8Array([0]),
    rigid_lines: new Int32Array([30, 0, 1, 30, 0, 2, 31, 3, 0]), rigid_kinds: new Uint8Array([0, 0, 1]),
    masses: new Int32Array([40, 4]), mass_values: new Float32Array([2.5]),
    spcs: new Int32Array([0, 123456]),
  };
  const width = { node_ids: 1, node_xyz: 3, beams: 4, beam_cards: 1, tris: 5, tri_cards: 1, quads: 6, quad_cards: 1,
                  rigid_lines: 3, rigid_kinds: 1, masses: 2, mass_values: 1, spcs: 2 };
  return { header, blocks, width };
}

test('PID 묶음·삼각형 분할·경계선·요소 순번', () => {
  const g = buildGeometry(sampleModel());
  expect(g.groups.map((x) => x.pid)).toEqual([1, 5]);
  const [beam, shell] = g.groups;
  expect(Array.from(beam.beams)).toEqual([0, 1]);
  expect(Array.from(beam.beamElem)).toEqual([0]);
  // 요소 순번: beam 0, tri 1, quad 2 → 삼각형 순서는 tri 먼저
  expect(Array.from(shell.shell)).toEqual([1, 2, 4, 0, 1, 2, 0, 2, 3]);
  expect(Array.from(shell.shellElem)).toEqual([1, 2, 2]);
  expect(shell.edges.length).toBe((3 + 4) * 2);
  expect(shell.count).toBe(2);
  expect(Array.from(g.elemKind)).toEqual([0, 1, 2]);
  expect(Array.from(g.elemRow)).toEqual([0, 0, 0]);
  expect(g.total).toBe(3);
});

test('중심 이동·반지름·표시물', () => {
  const g = buildGeometry(sampleModel());
  expect(g.center).toEqual([500, 500, 250]);
  expect(Array.from(g.positions.slice(0, 3))).toEqual([-500, -500, -250]);
  expect(g.radius).toBeCloseTo(Math.hypot(1000, 1000, 500) / 2);
  expect(Array.from(g.rigid.rbe2)).toEqual([0, 1, 0, 2]);
  expect(Array.from(g.rigid.rbe3)).toEqual([3, 0]);
  expect(Array.from(g.masses)).toEqual([4]);
  expect(Array.from(g.spcs)).toEqual([0]);
  expect(g.groups[0].color).toMatch(/^#[0-9a-f]{6}$/);
});

test('피킹 색 왕복', () => {
  for (const i of [0, 1, 255, 256, 65535, 1_000_000]) {
    const [r, g, b] = encodePick(i);
    expect(decodePick(r, g, b)).toBe(i);
  }
  expect(decodePick(0, 0, 0)).toBeNull();
});
```

`frontend/src/lib/elementInfo.test.js`:

```js
import { buildGeometry } from './modelGeometry.js';
import { sampleModel } from './modelGeometry.test.js';
import { elementInfo, sectionLabel } from './elementInfo.js';

test('1D 요소 정보', () => {
  const m = sampleModel();
  const info = elementInfo(m, buildGeometry(m), 0);
  expect(info).toEqual({ eid: 10, card: 'CBEAM', pid: 1, section: 'PBEAML L 100x100x10x10', thickness: null,
                         material: 'MAT1 E206000 ν0.3', nodes: [1, 2], length: 1000 });
});

test('쉘 요소 정보', () => {
  const m = sampleModel();
  const info = elementInfo(m, buildGeometry(m), 2);
  expect(info.eid).toBe(20);
  expect(info.card).toBe('CQUAD4');
  expect(info.section).toBe('PSHELL t12');
  expect(info.thickness).toBe(12);
  expect(info.nodes).toEqual([1, 2, 3, 4]);
  expect(info.length).toBeNull();
});

test('CONROD 와 속성 없는 요소', () => {
  const m = sampleModel();
  m.blocks.beam_cards = new Uint8Array([3]);
  m.header.conrods = { 10: { mid: 1, A: 25 } };
  const info = elementInfo(m, buildGeometry(m), 0);
  expect(info.card).toBe('CONROD');
  expect(info.section).toBe('CONROD A25');
  expect(sectionLabel(undefined)).toBe('');
});
```

`frontend/src/lib/viewFrame.test.js`:

```js
import { VIEW_PRESETS, computeFrame } from './viewFrame.js';

test('프리셋 4종', () => {
  expect(Object.keys(VIEW_PRESETS)).toEqual(['iso', 'front', 'side', 'top']);
  expect(VIEW_PRESETS.top.up).toEqual([0, 1, 0]);
});

test('화면 맞춤 — 세로 기준, 좁으면 가로 기준', () => {
  const f = computeFrame(VIEW_PRESETS.front, 100, 2);
  expect(f.position.map((v) => Math.round(v))).toEqual([0, -400, 0]);
  expect(f.halfHeight).toBeCloseTo(108);
  expect(f.halfWidth).toBeCloseTo(216);
  const narrow = computeFrame(VIEW_PRESETS.front, 100, 0.5);
  expect(narrow.halfWidth).toBeCloseTo(108);
  expect(narrow.halfHeight).toBeCloseTo(216);
  expect(f.near).toBeLessThan(0);
  expect(f.far).toBeGreaterThan(400);
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/modelGeometry.test.js src/lib/elementInfo.test.js src/lib/viewFrame.test.js` → FAIL
- [ ] **Step 3: 구현**

`frontend/src/lib/pidPalette.js`:

```js
/** PID 색 — 어두운 뷰어 바탕(#0E1A2B) 위에서 서로 구별되는 12색. 3D 데이터 색이라 UI 토큰과 따로 둔다. */
export const PID_COLORS = ['#7aa7e6', '#5fd38d', '#f2a65a', '#b79cf2', '#4fc3d9', '#f07e94',
                           '#c2ccd8', '#e3c35d', '#6fb6f2', '#a8d672', '#f29bd0', '#d8b49c'];

export function pidColor(pid) {
  return PID_COLORS[((pid % PID_COLORS.length) + PID_COLORS.length) % PID_COLORS.length];
}
```

`frontend/src/lib/modelGeometry.js`:

```js
/** lbm → 렌더용 PID 묶음·피킹 표(설계 §7.3). three 를 모르는 순수 함수라 jsdom 에서 시험한다. */
import { pidColor } from './pidPalette.js';

export const ELEM_BEAM = 0;
export const ELEM_TRI = 1;
export const ELEM_QUAD = 2;

export function encodePick(index) {
  const id = index + 1;
  return [id & 255, (id >> 8) & 255, (id >> 16) & 255];
}

export function decodePick(r, g, b) {
  const id = r + g * 256 + b * 65536;
  return id === 0 ? null : id - 1;
}

export function buildGeometry({ header, blocks }) {
  const xyz = blocks.node_xyz;
  const box = header.bbox || { min: [0, 0, 0], max: [0, 0, 0] };
  const center = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
  const radius = Math.max(Math.hypot(...[0, 1, 2].map((k) => box.max[k] - box.min[k])) / 2, 1e-6);
  const positions = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    positions[i] = xyz[i] - center[0];
    positions[i + 1] = xyz[i + 1] - center[1];
    positions[i + 2] = xyz[i + 2] - center[2];
  }

  const groups = new Map();
  const group = (pid) => {
    let g = groups.get(pid);
    if (!g) {
      g = { pid, shell: [], shellElem: [], edges: [], beams: [], beamElem: [], count: 0 };
      groups.set(pid, g);
    }
    return g;
  };
  const beams = blocks.beams || new Int32Array(0);
  const tris = blocks.tris || new Int32Array(0);
  const quads = blocks.quads || new Int32Array(0);
  const nb = beams.length / 4;
  const nt = tris.length / 5;
  const nq = quads.length / 6;
  const total = nb + nt + nq;
  const elemKind = new Uint8Array(total);
  const elemRow = new Int32Array(total);
  let e = 0;
  for (let r = 0; r < nb; r += 1, e += 1) {
    const g = group(beams[r * 4 + 1]);
    g.beams.push(beams[r * 4 + 2], beams[r * 4 + 3]);
    g.beamElem.push(e);
    g.count += 1;
    elemKind[e] = ELEM_BEAM;
    elemRow[e] = r;
  }
  for (let r = 0; r < nt; r += 1, e += 1) {
    const o = r * 5;
    const [a, b, c] = [tris[o + 2], tris[o + 3], tris[o + 4]];
    const g = group(tris[o + 1]);
    g.shell.push(a, b, c);
    g.shellElem.push(e);
    g.edges.push(a, b, b, c, c, a);
    g.count += 1;
    elemKind[e] = ELEM_TRI;
    elemRow[e] = r;
  }
  for (let r = 0; r < nq; r += 1, e += 1) {
    const o = r * 6;
    const [a, b, c, d] = [quads[o + 2], quads[o + 3], quads[o + 4], quads[o + 5]];
    const g = group(quads[o + 1]);
    g.shell.push(a, b, c, a, c, d);
    g.shellElem.push(e, e);
    g.edges.push(a, b, b, c, c, d, d, a);
    g.count += 1;
    elemKind[e] = ELEM_QUAD;
    elemRow[e] = r;
  }

  const lines = blocks.rigid_lines || new Int32Array(0);
  const kinds = blocks.rigid_kinds || new Uint8Array(0);
  const rbe2 = [];
  const rbe3 = [];
  for (let i = 0; i < kinds.length; i += 1) {
    (kinds[i] === 0 ? rbe2 : rbe3).push(lines[i * 3 + 1], lines[i * 3 + 2]);
  }
  const masses = blocks.masses || new Int32Array(0);
  const spcs = blocks.spcs || new Int32Array(0);

  return {
    center, radius, positions, total, elemKind, elemRow,
    groups: [...groups.values()].sort((a, b) => a.pid - b.pid).map((g) => ({
      pid: g.pid, color: pidColor(g.pid), count: g.count,
      shell: Uint32Array.from(g.shell), shellElem: Int32Array.from(g.shellElem),
      edges: Uint32Array.from(g.edges), beams: Uint32Array.from(g.beams), beamElem: Int32Array.from(g.beamElem),
    })),
    rigid: { rbe2: Uint32Array.from(rbe2), rbe3: Uint32Array.from(rbe3) },
    masses: Uint32Array.from({ length: masses.length / 2 }, (_, i) => masses[i * 2 + 1]),
    spcs: Uint32Array.from({ length: spcs.length / 2 }, (_, i) => spcs[i * 2]),
  };
}
```

`frontend/src/lib/elementInfo.js`:

```js
/** 클릭한 요소의 정보(설계 §7.4 ③) — EID, 카드, PID·단면·치수, 재료, 절점, 길이. */
import { ELEM_BEAM, ELEM_QUAD, ELEM_TRI } from './modelGeometry.js';

const fmt = (v) => `${Number(Number(v).toPrecision(6))}`;

export function sectionLabel(p) {
  if (!p) return '';
  if ((p.card === 'PBARL' || p.card === 'PBEAML') && p.dims?.length) return `${p.card} ${p.type} ${p.dims.map(fmt).join('x')}`;
  if ((p.card === 'PSHELL' || p.card === 'PCOMP') && p.t) return `${p.card} t${fmt(p.t)}`;
  if ((p.card === 'PBAR' || p.card === 'PBEAM' || p.card === 'PROD') && p.A) return `${p.card} A${fmt(p.A)}`;
  return p.card || '';
}

function materialLabel(m) {
  if (!m) return '';
  if (m.card === 'MAT1') return [`MAT1`, m.E != null && `E${fmt(m.E)}`, m.nu != null && `ν${fmt(m.nu)}`].filter(Boolean).join(' ');
  return m.card;
}

export function elementInfo({ header, blocks }, geometry, index) {
  const kind = geometry.elemKind[index];
  const row = geometry.elemRow[index];
  const ids = blocks.node_ids;
  const xyz = blocks.node_xyz;
  let eid; let pid; let card; let nodeIdx;
  if (kind === ELEM_BEAM) {
    const o = row * 4;
    [eid, pid] = [blocks.beams[o], blocks.beams[o + 1]];
    nodeIdx = [blocks.beams[o + 2], blocks.beams[o + 3]];
    card = header.cards.beam[blocks.beam_cards[row]];
  } else if (kind === ELEM_TRI) {
    const o = row * 5;
    [eid, pid] = [blocks.tris[o], blocks.tris[o + 1]];
    nodeIdx = [blocks.tris[o + 2], blocks.tris[o + 3], blocks.tris[o + 4]];
    card = header.cards.tri[blocks.tri_cards[row]];
  } else {
    const o = row * 6;
    [eid, pid] = [blocks.quads[o], blocks.quads[o + 1]];
    nodeIdx = [2, 3, 4, 5].map((k) => blocks.quads[o + k]);
    card = header.cards.quad[blocks.quad_cards[row]];
  }
  let prop = header.properties?.[pid];
  if (card === 'CONROD') {
    const c = header.conrods?.[eid] || {};
    prop = { card: 'CONROD', A: c.A, mid: c.mid };
  }
  let length = null;
  if (kind === ELEM_BEAM) {
    const [a, b] = nodeIdx;
    length = Math.round(Math.hypot(xyz[b * 3] - xyz[a * 3], xyz[b * 3 + 1] - xyz[a * 3 + 1], xyz[b * 3 + 2] - xyz[a * 3 + 2]) * 10) / 10;
  }
  return {
    eid, card, pid,
    section: card === 'CONROD' && prop?.A ? `CONROD A${fmt(prop.A)}` : sectionLabel(prop),
    thickness: prop?.t ?? null,
    material: materialLabel(header.materials?.[prop?.mid]),
    nodes: nodeIdx.map((i) => ids[i]),
    length,
  };
}

export { ELEM_QUAD };
```

`frontend/src/lib/viewFrame.js`:

```js
/** 시점 프리셋과 화면 맞춤(설계 §7.3). 모델은 원점 중심으로 옮겨져 있다(modelGeometry). */
export const VIEW_PRESETS = {
  iso: { label: 'ISO', key: 'i', dir: [1, -1, 0.75], up: [0, 0, 1] },
  front: { label: '정면', key: '1', dir: [0, -1, 0], up: [0, 0, 1] },
  side: { label: '측면', key: '2', dir: [1, 0, 0], up: [0, 0, 1] },
  top: { label: '평면', key: '3', dir: [0, 0, 1], up: [0, 1, 0] },
};

export function computeFrame(preset, radius, aspect) {
  const n = Math.hypot(...preset.dir);
  const dist = radius * 4;
  const position = preset.dir.map((v) => (v / n) * dist);
  let halfHeight = radius * 1.08;
  let halfWidth = halfHeight * aspect;
  if (aspect < 1) {
    halfWidth = radius * 1.08;
    halfHeight = halfWidth / aspect;
  }
  return { position, up: preset.up, halfHeight, halfWidth, near: -radius * 20, far: dist + radius * 20 };
}
```

`elementInfo.js` 끝의 `export { ELEM_QUAD }` 는 쓰지 않으면 지운다.

- [ ] **Step 4: 통과** — 세 테스트 파일 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 04b 기하·요소 정보·시점 계산(순수 함수)`

---

### Task 4: three 엔진

**Files:**
- Create: `frontend/src/components/viewer/viewerEngine.js`, `frontend/src/components/viewer/ViewerEngineContext.js`
- Test: 없음. jsdom 에 WebGL 이 없어서 Task 8 실브라우저 E2E 로 검증한다. 대신 Step 2 에서 빌드가 깨지지 않는지 확인한다.

엔진 계약(화면 컴포넌트와 가짜 엔진이 같은 모양을 쓴다):

```
createViewerEngine(container: HTMLElement) → {
  setModel(geometry, { edges }) : void      // 장면을 새로 만들고 ISO 로 맞춘다
  setGroupVisible(pid, visible) : void
  setEdges(visible) : void
  setMarkers({ rbe2, rbe3, conm2, spc }) : void
  setView(presetId) : void                  // 'iso' | 'front' | 'side' | 'top'
  fit() : void                              // 현재 방향 유지, 화면 맞춤
  pickAt(clientX, clientY) : number | null  // 요소 순번
  highlight(index | null) : void
  dispose() : void
}
```

구현 요점(WorkBench `FeModelViewer.jsx` 이식):
- **렌더러**: `WebGLRenderer({ antialias: true })`, 픽셀비 `min(dpr, 2)`, `outputColorSpace = SRGBColorSpace`.
- **장면**: 바탕 `#0E1A2B`.
- **카메라**: `OrthographicCamera`. `computeFrame` 결과로 위치·up·좌우상하·near/far 를 잡고, `zoom = 1` 이다.
- **조작**: `OrbitControls` — `enableDamping = false`, `zoomToCursor = true`, `screenSpacePanning = true`, 왼쪽 ROTATE, 가운데 DOLLY, 오른쪽 PAN. `change` 이벤트에서 `requestRender`.
- **온디맨드 렌더**: `requestRender()` 가 `requestAnimationFrame` 을 한 번만 예약한다. cleanup 에서 `frameRef = 0` 으로 되돌린다(StrictMode 함정 — WorkBench 주석을 옮긴다).
- **조명**: 카메라에 `DirectionalLight` 2개(주광·보조광)를 붙이고, `AmbientLight` 를 둔다.
- **공유 위치 속성**: `positions` 하나로 `BufferAttribute` 를 만들어 모든 묶음이 쓴다.
- **PID 묶음마다 세 가지 객체**를 둔다.
  - 쉘 `Mesh`(MeshLambertMaterial, 색 = 묶음 색, `side: DoubleSide`, `polygonOffset` 으로 경계선이 묻히지 않게)
  - 경계선 `LineSegments`(색 = 묶음 색을 어둡게 한 값, 투명도 0.55)
  - 1D `LineSegments`(색 = 묶음 색)
  - `setGroupVisible` 은 세 객체를 함께 끄고 켠다. `setEdges` 는 모든 경계선만 끄고 켠다.
- **표시물**: 크기는 화면 고정이다(`PointsMaterial({ sizeAttenuation: false })`).
  - RBE2 선: 주황 `#f2a65a`
  - RBE3 선: 보라 `#b79cf2`
  - CONM2 점: 노랑 `#f5d36b`, 8px
  - SPC 점: 초록 `#5fd38d`, 7px
  - 기본은 RBE2·RBE3·CONM2·SPC 모두 켬이다.
- **GPU 피킹**
  - 피킹 장면을 따로 만든다. 묶음마다 **인덱스를 풀어 쓴(non-indexed)** 쉘 삼각형과 1D 선분을 둔다.
  - 꼭짓점 색 = `encodePick(요소 순번)/255`, `MeshBasicMaterial({ vertexColors: true })`·`LineBasicMaterial({ vertexColors: true })`. 색 변환을 막도록 재질의 `toneMapped = false` 로 두고, 피킹 렌더 동안 `renderer.outputColorSpace` 를 `LinearSRGBColorSpace` 로 바꿨다가 되돌린다.
  - 피킹 객체의 visible 은 화면 묶음과 같이 바꾼다.
  - `pickAt`:
    1. 5×5 `WebGLRenderTarget` 에 `camera.setViewOffset(w, h, x-2, y-2, 5, 5)` 로 클릭 주변만 그린다.
    2. `readRenderTargetPixels` 로 25개 픽셀을 읽는다.
    3. 가운데에서 가장 가까운 빈 곳 아닌 픽셀의 순번을 돌려준다.
    4. 끝나면 `clearViewOffset` 한다.
  - 피킹 장면은 첫 `pickAt` 때 만든다(지연). 큰 모델 메모리를 아끼려는 것이다.
- **강조**: `highlight(i)` 는 그 요소 하나만 담은 작은 기하로 그린다(쉘이면 흰 테두리, 1D 면 굵은 흰 선 대신 흰 선 + 끝점). 다시 부르면 바꾸고, `null` 이면 지운다.
- **정리**
  - 크기: `ResizeObserver` 로 크기를 맞추고, 가로·세로 범위는 `resizeFeOrthographicCamera` 와 같이 세로를 유지한다.
  - 문맥 복구: `webglcontextlost`·`restored` 처리를 넣는다.
  - `dispose` 는 기하·재질·렌더 타깃·렌더러를 해제하고 캔버스를 뗀다.

`ViewerEngineContext.js`:

```js
import { createContext } from 'react';

/** 엔진 공장 — 화면 컴포넌트는 이것만 안다. 테스트는 가짜 공장을 넣는다(jsdom 에 WebGL 이 없다). */
export const ViewerEngineContext = createContext(async (container) => {
  const { createViewerEngine } = await import('./viewerEngine.js');
  return createViewerEngine(container);
});
```

(공장은 `Promise<engine>` 을 돌려준다. three 는 이 동적 import 로만 불러와 별도 묶음에 들어간다.)

- [ ] **Step 1: `viewerEngine.js` 작성** — 위 계약·요점대로 작성한다.
  - 상단 주석에 WorkBench `FeModelViewer.jsx` 에서 이식했다는 사실과 온디맨드 렌더·StrictMode 함정을 적는다.
  - import 는 `import * as THREE from 'three'`, `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'`, `computeFrame`·`VIEW_PRESETS`·`encodePick` 이다.
- [ ] **Step 2: 빌드 확인** — `npm run build`. 성공해야 하고, 출력에 three 가 든 별도 청크(`viewerEngine-*.js`)가 보여야 한다.
- [ ] **Step 3: 커밋(사람)** — `feat: 04b three 뷰어 엔진(온디맨드 렌더·GPU 피킹)`

---

### Task 5: ModelViewer 화면

**Files:**
- Create: `frontend/src/components/viewer/ModelViewer.jsx`
- Test: `frontend/src/components/viewer/ModelViewer.test.jsx`

화면 규칙(설계 §7.4·DESIGN.md):
- **배치**
  - 위: 밝은 도구줄. 시점 세그먼트 ISO·정면·측면·평면, `화면 맞춤`(F), `경계선` 토글, 표시물 토글 칩 RBE2·RBE3·CONM2·SPC(개수 표시, 0개면 숨김). 오른쪽 끝에 선택 `전체 화면` 링크(`fullscreenHref` prop)를 둔다.
  - 아래: 왼쪽 캔버스(바탕 `viewer`) + 오른쪽 240px 패널.
  - 패널 위쪽은 PID 목록이다. 각 행은 색 칩, PID(mono), 단면 라벨, 요소 수, 표시 체크로 되어 있고, 위에 `모두 보이기`·`모두 숨기기` 가 있다.
  - 패널 아래쪽은 선택 요소 정보다: EID·카드·PID·단면·두께·재료·절점·길이. 비었으면 "요소를 누르면 정보가 보입니다".
- **불러오기**
  - `apiArrayBuffer('/files/{id}/model.lbm')` → `parseLbm` → `buildGeometry` → 엔진 `setModel(geometry, { edges })` 순이다.
  - 경계선 기본값은 요소 20만 개 이하면 켬, 넘으면 끔이다(설계 §7.3).
  - 불러오는 동안 캔버스 위에 "모델 여는 중…" 과 진행 줄(불확정)을 보인다.
- **오류**: 404 `model_not_ready`·`model_missing` 등은 `errorText` 로 보인다. WebGL 엔진을 만들지 못하면(예외) "이 브라우저에서 3D 를 표시할 수 없습니다." 를 보인다.
- **클릭 정보**: 캔버스 클릭(드래그가 아닌 클릭 — 누른 자리와 뗀 자리가 4px 안)에서 `pickAt` 하고, 결과가 있으면 `highlight` + 정보, 없으면 해제한다.
- **키보드**(캔버스 영역에 포커스가 있을 때): `F` 맞춤, `I`·`1`·`2`·`3` 시점, `E` 경계선, `Esc` 선택 해제.
- **정리**: 언마운트 시 `dispose`. `fileId` 가 바뀌면 새로 불러온다(늦게 온 옛 응답은 버린다).

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/components/viewer/ModelViewer.test.jsx`:

```jsx
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import { encodeLbm } from '../../lib/lbm.test.js';
import { ViewerEngineContext } from './ViewerEngineContext.js';
import ModelViewer from './ModelViewer.jsx';

function lbmBuffer() {
  return encodeLbm({
    version: 1, bbox: { min: [0, 0, 0], max: [1000, 1000, 0] },
    cards: { beam: ['CBAR', 'CBEAM', 'CROD', 'CONROD', 'CBUSH'], tri: ['CTRIA3'], quad: ['CQUAD4'], rigid: ['RBE2', 'RBE3'] },
    properties: { 1: { card: 'PBEAML', mid: 1, type: 'L', dims: [100, 100, 10, 10] }, 5: { card: 'PSHELL', mid: 1, t: 12 } },
    materials: { 1: { card: 'MAT1', E: 206000, nu: 0.3 } }, conrods: {},
  }, {
    node_ids: { dtype: '<i4', width: 1, data: new Int32Array([1, 2, 3, 4]) },
    node_xyz: { dtype: '<f4', width: 3, data: new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0]) },
    beams: { dtype: '<i4', width: 4, data: new Int32Array([10, 1, 0, 1]) },
    beam_cards: { dtype: '|u1', width: 1, data: new Uint8Array([1]) },
    tris: { dtype: '<i4', width: 5, data: new Int32Array(0) },
    tri_cards: { dtype: '|u1', width: 1, data: new Uint8Array(0) },
    quads: { dtype: '<i4', width: 6, data: new Int32Array([20, 5, 0, 1, 2, 3]) },
    quad_cards: { dtype: '|u1', width: 1, data: new Uint8Array([0]) },
    rigid_lines: { dtype: '<i4', width: 3, data: new Int32Array([30, 0, 1]) },
    rigid_kinds: { dtype: '|u1', width: 1, data: new Uint8Array([0]) },
    masses: { dtype: '<i4', width: 2, data: new Int32Array(0) },
    mass_values: { dtype: '<f4', width: 1, data: new Float32Array(0) },
    spcs: { dtype: '<i4', width: 2, data: new Int32Array([0, 123456]) },
  });
}

function fakeEngine(pick = 0) {
  return {
    setModel: vi.fn(), setGroupVisible: vi.fn(), setEdges: vi.fn(), setMarkers: vi.fn(),
    setView: vi.fn(), fit: vi.fn(), pickAt: vi.fn(() => pick), highlight: vi.fn(), dispose: vi.fn(),
  };
}

function renderViewer(engine, map = { 'GET /api/files/7/model.lbm': { __binary: lbmBuffer() } }) {
  mockApi(map);
  const factory = vi.fn(async () => engine);
  render(
    <ViewerEngineContext.Provider value={factory}>
      <ModelViewer fileId={7} fullscreenHref="/v/7" />
    </ViewerEngineContext.Provider>,
  );
  return factory;
}

test('불러와서 엔진에 넘기고 PID 목록·표시물 칩을 보인다', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  const list = await screen.findByRole('list', { name: 'PID' });
  expect(within(list).getByText('PBEAML L 100x100x10x10')).toBeInTheDocument();
  expect(within(list).getByText('PSHELL t12')).toBeInTheDocument();
  expect(engine.setModel).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }), { edges: true });
  expect(screen.getByRole('button', { name: /RBE2 1/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /SPC 1/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /CONM2/ })).toBeNull();
  expect(screen.getByRole('link', { name: '전체 화면' })).toHaveAttribute('href', '/v/7');
});

test('PID 표시 토글·모두 숨기기·시점·경계선·표시물', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  const list = await screen.findByRole('list', { name: 'PID' });
  await userEvent.click(within(list).getByRole('checkbox', { name: 'PID 5 표시' }));
  expect(engine.setGroupVisible).toHaveBeenCalledWith(5, false);
  await userEvent.click(screen.getByRole('button', { name: '모두 숨기기' }));
  expect(engine.setGroupVisible).toHaveBeenCalledWith(1, false);
  await userEvent.click(screen.getByRole('radio', { name: '평면' }));
  expect(engine.setView).toHaveBeenCalledWith('top');
  await userEvent.click(screen.getByRole('button', { name: '경계선' }));
  expect(engine.setEdges).toHaveBeenLastCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: /RBE2 1/ }));
  expect(engine.setMarkers).toHaveBeenLastCalledWith(expect.objectContaining({ rbe2: false, spc: true }));
});

test('클릭하면 요소 정보를 보인다, 드래그는 무시', async () => {
  const engine = fakeEngine(1);  // 요소 순번 1 = CQUAD4 20
  renderViewer(engine);
  await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 140, clientY: 100, button: 0 });
  expect(engine.pickAt).not.toHaveBeenCalled();
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: 101, clientY: 101, button: 0 });
  const info = await screen.findByRole('region', { name: '선택 요소' });
  expect(info).toHaveTextContent('20');
  expect(info).toHaveTextContent('CQUAD4');
  expect(info).toHaveTextContent('PSHELL t12');
  expect(engine.highlight).toHaveBeenCalledWith(1);
  fireEvent.keyDown(canvas, { key: 'Escape' });
  expect(engine.highlight).toHaveBeenLastCalledWith(null);
});

test('키보드 F·숫자', async () => {
  const engine = fakeEngine();
  renderViewer(engine);
  await screen.findByRole('list', { name: 'PID' });
  const canvas = screen.getByTestId('viewer-canvas');
  fireEvent.keyDown(canvas, { key: 'f' });
  fireEvent.keyDown(canvas, { key: '1' });
  expect(engine.fit).toHaveBeenCalled();
  expect(engine.setView).toHaveBeenCalledWith('front');
});

test('준비 안 됨·엔진 실패', async () => {
  renderViewer(fakeEngine(), { 'GET /api/files/7/model.lbm': { __status: 404, detail: 'model_not_ready' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('변환');
});

test('언마운트 시 엔진 해제', async () => {
  const engine = fakeEngine();
  mockApi({ 'GET /api/files/7/model.lbm': { __binary: lbmBuffer() } });
  const { unmount } = render(
    <ViewerEngineContext.Provider value={async () => engine}><ModelViewer fileId={7} /></ViewerEngineContext.Provider>,
  );
  await screen.findByRole('list', { name: 'PID' });
  unmount();
  expect(engine.dispose).toHaveBeenCalled();
});
```

`lib/labels.js` 의 `ERROR_LABELS` 에 다음을 더한다. Task 7 에서 다시 쓴다.
- `model_not_ready: '아직 3D 변환이 끝나지 않았습니다.'`
- `model_missing: '3D 변환 결과를 찾을 수 없습니다. 관리자에게 재변환을 요청해 주세요.'`

이 테스트는 `'변환'` 으로 확인한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/viewer` → FAIL
- [ ] **Step 3: 구현** — `ModelViewer.jsx` 를 작성한다. 뼈대는 다음과 같다. 스타일은 DESIGN.md 의 도구줄·세그먼트·칩 컴포넌트를 재사용하고, 기존 `components/ui` 에 Segmented·Button 이 있으면 그것을 쓴다.

```jsx
import { useContext, useEffect, useRef, useState } from 'react';
import { apiArrayBuffer } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { parseLbm } from '../../lib/lbm.js';
import { buildGeometry } from '../../lib/modelGeometry.js';
import { elementInfo, sectionLabel } from '../../lib/elementInfo.js';
import { VIEW_PRESETS } from '../../lib/viewFrame.js';
import { ViewerEngineContext } from './ViewerEngineContext.js';

const EDGE_LIMIT = 200_000;
const CLICK_SLOP = 4;
const MARKER_KEYS = [['rbe2', 'RBE2'], ['rbe3', 'RBE3'], ['conm2', 'CONM2'], ['spc', 'SPC']];

export default function ModelViewer({ fileId, fullscreenHref, className = '' }) {
  const factory = useContext(ViewerEngineContext);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const downRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [model, setModel] = useState(null);       // { lbm, geometry }
  const [hidden, setHidden] = useState(() => new Set());
  const [edges, setEdges] = useState(true);
  const [markers, setMarkers] = useState({ rbe2: true, rbe3: true, conm2: true, spc: true });
  const [view, setView] = useState('iso');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', error: '' });
    setModel(null); setPicked(null); setHidden(new Set());
    (async () => {
      try {
        const lbm = parseLbm(await apiArrayBuffer(`/files/${fileId}/model.lbm`));
        const geometry = buildGeometry(lbm);
        let engine;
        try { engine = await factory(canvasRef.current); } catch {
          if (alive) setState({ status: 'error', error: '이 브라우저에서 3D 를 표시할 수 없습니다.' });
          return;
        }
        if (!alive) { engine.dispose(); return; }
        engineRef.current = engine;
        const withEdges = geometry.total <= EDGE_LIMIT;
        engine.setModel(geometry, { edges: withEdges });
        setEdges(withEdges);
        setModel({ lbm, geometry });
        setState({ status: 'ready', error: '' });
      } catch (err) {
        if (alive) setState({ status: 'error', error: errorText(err, '모델을 불러오지 못했습니다.') });
      }
    })();
    return () => {
      alive = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [fileId, factory]);

  // …도구줄·PID 목록·정보 패널 처리 함수(toggleGroup, showAll, hideAll, changeView, toggleEdges,
  //   toggleMarker, onPointerDown/Up, onKeyDown)와 JSX
}
```

나머지 처리 함수와 JSX 는 위 화면 규칙대로 작성한다.
- 접근 이름은 테스트와 맞춘다.
  - 시점: `role="radiogroup"` 안의 `role="radio"`
  - PID 목록: `role="list" aria-label="PID"`
  - 표시 체크박스: `aria-label="PID n 표시"`
  - 선택 정보: `role="region" aria-label="선택 요소"`
  - 캔버스 영역: `data-testid="viewer-canvas"` + `tabIndex=0`
- 표시물 칩 개수의 출처:
  - RBE2·RBE3: `lbm.header.counts`
  - CONM2: `geometry.masses.length`
  - SPC: `geometry.spcs.length`
- PID 행의 단면 라벨은 `sectionLabel(lbm.header.properties[pid])` 다.

- [ ] **Step 4: 통과** — `npx vitest run src/components/viewer` PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 04b ModelViewer 화면`

---

### Task 6: 썸네일·모델 미리보기·FilePreview 연결

**Files:**
- Create: `frontend/src/components/viewer/ModelThumb.jsx`, `frontend/src/components/preview/ModelPreview.jsx`
- Modify: `frontend/src/components/preview/FilePreview.jsx`, `frontend/src/lib/labels.js`
- Test: `frontend/src/components/preview/ModelPreview.test.jsx`

규칙(설계 §7.7):
- **`ModelThumb({ fileId, className, alt })`**
  - `apiBlob('/files/{id}/thumb.png')` → `URL.createObjectURL`.
  - 같은 fileId 는 모듈 안 Map 에 캐시한다(최대 100개, 넘으면 오래된 것부터 `revokeObjectURL`).
  - 실패하면 아무것도 그리지 않는다(자리만 회색).
- **`ModelPreview({ file, inline = true })`**: `GET /files/{id}/model` 상태에 따라 다르게 보인다.
  - `null`·`queued`: "3D 변환 대기 중" + 3초 뒤 한 번 다시 확인(최대 20번)
  - `include`: "같은 자료의 다른 BDF 가 INCLUDE 하는 파일입니다. 그 BDF 를 열어 보세요."
  - `skipped`
    - `drm`: DRM 문구
    - `too_large`: "1GB 를 넘는 모델은 3D 변환을 하지 않습니다."
    - `no_elements`: "요소가 없는 BDF(재료·하중 등)라 3D 로 볼 것이 없습니다."
    - `trashed`: 휴지통 문구
  - `failed`: "3D 로 바꾸지 못했습니다: <error>". 파일 내려받기는 그대로 된다(`FileActions` 는 FilePreview 가 이미 보인다).
  - `done`
    - **INCLUDE 누락이 있으면(`missing` 비어 있지 않음)** 위에 안내를 둔다: "INCLUDE 파일 <이름들> 이 없습니다. 같은 자료에 추가하면 자동으로 다시 변환합니다."(설계 §7.7 문구)
    - 요약 한 줄: 요소 종류별 개수(많은 순 4개), `크기 a×b×c mm` 대신 `크기 a×b×c` 를 쓴다(BDF 에는 단위가 없다), SOL.
    - 경고가 있으면 접히는 `경고 N` 목록.
    - `inline` 이면 `ModelViewer`(React.lazy)를 바로 보인다(높이 `min(70vh, 640px)`). 아니면 썸네일 + `3D 로 보기` 버튼(`/v/:id` 링크)을 보인다.
- `FilePreview`: `file.kind === 'model'` 이고 휴지통·DRM 이 아니면 `View` 대신 `<ModelPreview file={file} inline={inlineModel} />` 를 쓴다.
  - 새 prop `inlineModel`(기본 `true`) 을 둔다. 검색 미리보기 패널(`EntryPreviewPanel`)은 좁아서 `false` 로 넘긴다.
  - `SummaryCard` 는 모델 파일에 쓰지 않는다(추출 요약이 없다).

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/components/preview/ModelPreview.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import { ViewerEngineContext } from '../viewer/ViewerEngineContext.js';
import ModelPreview from './ModelPreview.jsx';

const FILE = { id: 7, name: 'm.bdf', kind: 'model', rel_path: 'm.bdf', size: 10 };

function renderPreview(summary, { inline = false } = {}) {
  mockApi({ 'GET /api/files/7/model': summary, 'GET /api/files/7/thumb.png': { __blob: new Blob(['png']) } });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
  render(
    <ViewerEngineContext.Provider value={async () => ({ setModel() {}, dispose() {} })}>
      <MemoryRouter><ModelPreview file={FILE} inline={inline} /></MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
}

test('변환 완료 — 요약·썸네일·전체 화면 링크', async () => {
  renderPreview({ state: 'done', counts: { CQUAD4: 3400, CBEAM: 1200, GRID: 5000 }, bbox: { min: [0, 0, 0], max: [12000, 8000, 3000] },
                  sol: '101', warnings: ['coord_unresolved: 2'], missing: [], has_lbm: true });
  expect(await screen.findByText(/CQUAD4 3,400/)).toBeInTheDocument();
  expect(screen.getByText(/크기 12,000×8,000×3,000/)).toBeInTheDocument();
  expect(screen.getByText(/SOL 101/)).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: /m\.bdf/ })).toHaveAttribute('src', 'blob:thumb');
  expect(screen.getByRole('link', { name: '3D 로 보기' })).toHaveAttribute('href', '/v/7');
  expect(screen.getByText('경고 1')).toBeInTheDocument();
});

test('INCLUDE 누락 안내', async () => {
  renderPreview({ state: 'done', counts: { CROD: 1 }, bbox: null, warnings: [], missing: ['mesh.bdf', 'mat.bdf'], has_lbm: true });
  expect(await screen.findByText(/INCLUDE 파일 mesh\.bdf, mat\.bdf 이 없습니다/)).toBeInTheDocument();
});

test.each([
  [{ state: 'include' }, /다른 BDF 가 INCLUDE/],
  [{ state: 'skipped', error: 'no_elements' }, /요소가 없는 BDF/],
  [{ state: 'skipped', error: 'too_large' }, /1GB/],
  [{ state: 'failed', error: 'ValueError: 깨짐' }, /3D 로 바꾸지 못했습니다: ValueError: 깨짐/],
  [{ state: 'queued' }, /3D 변환 대기 중/],
])('상태 %o', async (summary, text) => {
  renderPreview(summary);
  expect(await screen.findByText(text)).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/preview` → FAIL
- [ ] **Step 3: 구현**
  - `ModelThumb.jsx`·`ModelPreview.jsx` 를 규칙대로 작성한다. 숫자는 `toLocaleString('ko-KR')` 로 쓴다.
  - `ModelViewer` 는 `const ModelViewer = lazy(() => import('../viewer/ModelViewer.jsx'))` 로 불러오고, `<Suspense fallback={스켈레톤}>` 으로 감싼다.
  - `labels.js` 에 `MODEL_STATE_LABELS`(위 문구들)와 Task 5 의 오류 라벨을 둔다.
  - `FilePreview.jsx` 를 고친다. 기존 테스트가 깨지지 않게 모델이 아닌 파일의 동작은 그대로 둔다.
- [ ] **Step 4: 통과** — `npx vitest run src/components/preview` PASS, `npm test` 전체 PASS
- [ ] **Step 5: 커밋(사람)** — `feat: 04b 모델 미리보기·썸네일`

---

### Task 7: 전체 화면 뷰어·검색 썸네일·라우트

**Files:**
- Create: `frontend/src/pages/ViewerPage.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/components/search/ResultList.jsx`, `frontend/src/components/search/EntryPreviewPanel.jsx`, `frontend/src/lib/search.js`
- Test: `frontend/src/pages/ViewerPage.test.jsx`, `frontend/src/lib/search.test.js`(추가), `frontend/src/pages/SearchPage.test.jsx`(추가)

규칙:
- **`/v/:fileId`**: `GET /files/{id}`(Task 1)로 이름·Entry 를 읽는다.
  - 머리줄: 파일 이름, `E000123 · 제목` 링크(`/e/E000123?file=<id>`), `닫기`(브라우저 뒤로).
  - 본문: 머리줄을 뺀 남은 높이 전부를 `ModelViewer` 가 쓴다.
  - 파일이 없거나 모델이 아니면 EmptyState 를 보인다.
- **검색 미리보기 패널**(`EntryPreviewPanel`): `FilePreview` 에 `inlineModel={false}` 를 넘긴다.
- **검색 파일 보기**(`unit=file`) 결과 행: `kind === 'model'` 이면 행 왼쪽에 `ModelThumb`(64×40, 모서리 `rounded-sm`)를 둔다.
- **위치 라벨**: `locatorLabel('model')` → `'모델 지문'`.

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/pages/ViewerPage.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import { ViewerEngineContext } from '../components/viewer/ViewerEngineContext.js';
import ViewerPage from './ViewerPage.jsx';

function renderAt(map) {
  mockApi(map);
  render(
    <ViewerEngineContext.Provider value={async () => ({ setModel() {}, dispose() {} })}>
      <MemoryRouter initialEntries={['/v/7']}><Routes><Route path="/v/:fileId" element={<ViewerPage />} /></Routes></MemoryRouter>
    </ViewerEngineContext.Provider>,
  );
}

test('파일 이름과 소속 자료 링크', async () => {
  renderAt({
    'GET /api/files/7': { id: 7, name: 'main.bdf', rel_path: 'model/main.bdf', kind: 'model', size: 10,
                          entry_id: 'E000003', entry_title: '계류 검토', entry_status: 'confirmed' },
    'GET /api/files/7/model.lbm': { __status: 404, detail: 'model_not_ready' },
  });
  expect(await screen.findByRole('heading', { name: 'main.bdf' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /E000003/ })).toHaveAttribute('href', '/e/E000003?file=7');
});

test('모델이 아닌 파일', async () => {
  renderAt({ 'GET /api/files/7': { id: 7, name: 'r.pdf', rel_path: 'r.pdf', kind: 'report', size: 1,
                                    entry_id: 'E1', entry_title: 't', entry_status: 'confirmed' } });
  expect(await screen.findByText('3D 로 볼 수 있는 모델 파일이 아닙니다')).toBeInTheDocument();
});
```

`src/lib/search.test.js` 에 `expect(locatorLabel('model')).toBe('모델 지문');` 을 더한다.

`SearchPage.test.jsx` 에 파일 보기 테스트를 하나 더한다. 모델 행이 있으면 썸네일 `img` 가 있어야 한다.
- 썸네일 요청 `GET /api/files/{id}/thumb.png` 를 `{ __blob }` 으로 등록한다.
- `URL.createObjectURL` 은 가짜로 둔다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
  - `ViewerPage.jsx` 를 작성한다. 높이는 셸 본문을 꽉 채우도록 `h-full flex flex-col` 로 둔다.
  - `App.jsx` 에 `<Route path="v/:fileId" element={<ViewerPage />} />` 를 더한다.
  - `ResultList`·`EntryPreviewPanel`·`search.js` 를 고친다.
- [ ] **Step 4: 통과** — `npm test` 전체 PASS, `npm run build` 성공. three 가 들어간 청크가 검색 첫 화면 청크와 분리됐는지 빌드 출력으로 확인한다.
- [ ] **Step 5: 커밋(사람)** — `feat: 04b 전체 화면 뷰어·검색 썸네일`

---

### Task 8: 실제 브라우저 E2E (컨트롤러가 직접 수행)

- [ ] 04a Task 10 의 합성 9999 모델이 공유 폴더에 변환돼 있는 상태에서 시작한다. API·워커를 띄운다.
- [ ] Playwright(스크래치패드 `pw/`, 1.61.0, 캐시 chromium) 로 아래를 확인한다. 헤드리스 WebGL 은 SwiftShader 로 돈다. 안 되면 `--use-angle=swiftshader` 를 준다.
  1. Entry 상세에서 BDF 를 고르면 뷰어가 뜨고 캔버스가 비어 있지 않다. 캡처한 픽셀 중 바탕색이 아닌 것이 있어야 한다.
  2. 시점 4종과 화면 맞춤이 동작한다.
  3. PID 숨기기를 하면 그 색 픽셀이 사라진다.
  4. 경계선 토글이 동작한다.
  5. 쉘을 클릭하면 정보 패널의 EID·PSHELL 이 맞다. 1D 요소 클릭도 확인한다.
  6. RBE2·SPC 토글이 동작한다.
  7. `/v/:id` 전체 화면이 뜬다.
  8. 검색 파일 보기의 모델 행에 썸네일이 있다.
  9. 콘솔 오류 0건이다.
  10. 1440·1366 스크린샷을 보고 디자인을 점검한다.
- [ ] 큰 표본으로도 확인한다. 04a Task 9 에서 쓴 WorkBench 표본을 **로컬 스크래치패드 안에서만** 합성 Entry 로 올려, 로드 시간·회전 반응을 관찰하고 기록한다. 시험 뒤 그 Entry 는 휴지통에 넣는다.
- [ ] 시험 자료를 휴지통으로 보내고 서버를 멈춘다. `docs/plans/README.md` 의 04 줄을 04a·04b 로 나눈다.

---

## 자체 점검 (계획 작성 시)

- §7.3
  - PID 별 병합 메시(1D LineSegments·2D Mesh) → Task 3·4
  - 경계선 토글 → Task 4·5
  - 직교 카메라·시점 프리셋·화면 맞춤 → Task 3·4·5
  - GPU 피킹 → Task 4
  - 대형 모델 경계선 기본 끔 → Task 5. "PID 단위 순차 로드 + 진행 막대"는 lbm 을 한 번에 받는 구조라 불확정 진행 줄로 대신한다. 실측(Task 8)에서 느리면 후속으로 다룬다.
- §7.4
  - ① 표시·시점 → Task 4·5
  - ② PID 색·토글 → Task 3·5
  - ③ 요소 정보 → Task 3·5
  - ④ 표시물 토글 → Task 4·5
- §7.7 실패 사유·INCLUDE 안내 → Task 6
- §6.3 BDF = 3D 뷰어 → Task 6·7
- §7.5 썸네일 → Task 6·7
