# 09 — 분류 둘러보기·속성 값 찾기·미리보기 폭·결과 통찰

선행: 08(통제 어휘·결과 행), 06(해석 검증), 04b(썸네일). 사용자 요청(2026-10-07).

## 1. 미리보기 패널 폭 조절

- 검색의 오른쪽 미리보기 패널 왼쪽 가장자리에 손잡이(`role="separator"`, 세로, `aria-valuenow/min/max`).
  끌기(포인터 캡처) · ←/→(16px, Shift 64px) · Home/End(최소·최대) · 두 번 누르면 기본 폭.
- 범위: 최소 360px, 최대 = min(검색 영역 70%, 영역 − 펼친 필터 열 − 결과 열 최소 480px).
  1366~1599px 에서는 미리보기가 열리면 필터 열이 서랍으로 접히므로 그 폭은 빼지 않는다(`ResizeObserver` 로 다시 잼).
- 기본 폭은 예전과 같다 — clamp(360px, 34vw, 480px). 폭은 브라우저마다 `localStorage`
  (`logbook.searchPreviewWidth.v1`, try/catch — 저장소가 막혀도 그 화면에서는 동작).
- 끄는 동안 React 상태를 바꾸지 않고 패널 DOM 폭만 rAF 로 고친다(결과 목록을 다시 그리지 않음). 놓을 때 한 번 저장.
  `body[data-resizing]` 동안 iframe(PDF)·canvas(3D)·embed 의 pointer-events 를 끈다(끌기를 삼키지 않게).
- 코드: `lib/panelWidth.js`(순수 함수), `components/search/usePreviewWidth.jsx`(훅 + 손잡이).

## 2. 분류 화면 `/browse` (옛 '태그' 메뉴)

- 메뉴 '태그' → **'분류'**. 탭 = 검색 필터 차원 전부: 구역·해석 종류·호선·선종·해석 연도·태그·파일 종류·올린 사람.
  값마다 자료 수(건수 막대 + 수치), 건수순/이름순, '값·동의어로 거르기', '미확정 포함'.
- 값을 누르면 그 값 하나로 거른 검색(`/?zone=선미부`, `/?analysis_type=…`, `/?hull=…`, `/?tag=…`, `/?year=…`,
  `/?kind=…`, `/?uploaded_by=…`, `/?ship_type=…` — `lib/search.js filterHref`). 미확정 포함이면 `drafts=1` 도 붙인다.
- API `GET /api/search/browse?drafts=` — 검색과 같은 셈법(`MySqlSearch._rows`)을 개수 제한 없이. 구역·해석 종류는
  대표 값으로 세고, 동의어(`aliases`)·목록 여부(`listed`)를 싣고, 아직 쓰이지 않은 목록 용어도 0건으로 보탠다.
  호선은 선종(`label`), 올린 사람은 이름(`label`).
- 옛 주소 `/tags` → `/browse?by=tag`. 자유 태그 동의어 묶기·풀기(누구나)는 `/tags/manage`('태그 동의어').
  구역·해석 종류 관리는 그대로 관리자 '분류 목록'(`/admin/vocab`) — 분류 화면에서 관리자에게만 링크.

## 3. 속성 값은 어디서나 링크

- 결과 행 둘째 줄(구역·해석 종류·선종 — 값마다), 미리보기 패널(구역·해석 종류), Entry 상세 속성 레일
  (구역·해석 종류 = 읽기 상태의 값이 링크이고 고치기는 옆 단추, 올린 사람). 호선 칩은 지금처럼 호선 화면으로.

## 4. 검색어로 속성 값 찾기

본문·제목에 낱말이 없어도 속성 값이 맞으면 찾는다(`_property_hits`).
- 구역·해석 종류: 기존 LIKE(값·동의어)에 더해 **표기 변형**(공백·대소문자 — '선미 부', 'engineroom')을 목록 용어로 맞춘다.
- 선종: 호선 정보의 선종(LIKE). 올린 사람: 이름·사번이 **정확히** 같을 때만(한 글자 성으로 넘치지 않게).

## 5. 결과 통찰(사용자 승인 A + C)

**A. 결과 행** — 대표 BDF(썸네일과 같은 고르기: 변환된 BDF 중 GRID 최다, INCLUDE 전용 제외)의 한 줄:
`요소 12,431 ▕보·쉘·RBE·질량·기타 막대▏ 노드 9,820 · 24,000 × 18,200 × 9,600 · SOL 101 · ✓ 해석 가능 · 그룹 1`.
- 크기는 BDF 에 단위가 없어 모델 좌표 그대로(ModelPreview 와 같은 규칙), mm 추정 m 환산은 툴팁에만.
- 그룹 수는 해석 검증이 세어 둔 `solve_checks.groups` 만 쓴다(lbm 을 행마다 읽지 않는다). 모르면 뺀다.
- 대표 보고서 줄: 보고서 중 요약 있는 것 > PDF > PPTX > DOCX > 큰 파일. 「제목」 + 쪽/슬라이드/시트 수 + 작성자.
  **검색어 발췌가 있으면 보고서 줄 대신 발췌**(행 높이를 지키고, 검색어 맥락이 더 중요).
- 썸네일 128×80(화면에 들어올 때 받는다). 모델이 없는 행은 빈 막대 없이 그 줄을 뺀다.
- 한 쪽 분량을 묶어서 읽는다 — 대표 모델(ModelSummary + SolveCheck outer join)·보고서(File + FileExtract) 각 한 번.

**C. 요약 띠**(문서 보기, 결과 2건 이상) — 맞은 자료 **전체**(쪽이 아니라)의 분포 두 줄:
해석 종류 상위 4 · 해석 시기 연도 막대 · 시기 미상 / 호선 상위 4 · 모델 규모(요소 수 구간 1천 미만·1천~1만·1만~5만·5만 이상, 최소~최대) ·
해석 검증(해석 가능·불가·확인 못 함·다시 검증 필요·검증 중·미검증, BDF 없음).
- 해석 종류·호선·연도 막대는 누르면 그 필터(다시 누르면 해제), 걸린 값만 브랜드 남색. 모델 규모·검증은 필터가 없어 보기만.
- 접기 상태는 `localStorage`(`logbook.searchSummaryCollapsed.v1`). 차트 라이브러리 없이 CSS 막대.
- 서버: 검색 응답 `summary`(`app/search/insight.py summarize`) — 대표 모델은 맞은 Entry 전체에 대해 한 번 읽어
  요약과 이 쪽 행이 함께 쓴다(1,000개씩 IN 묶음).

테스트: 백엔드 `test_search_09.py`·`test_search_insight.py`, 프런트 `BrowsePage.test.jsx`·`ResultSummary.test.jsx`·
`lib/panelWidth.test.js`·`lib/insight.test.js` + SearchPage·EntryPage·SideNav 추가 항목.
