# 19 — 검색 화면 개선: 한 칸 여러 값·칸 안 찾기·자동완성·정렬/묶기

작성 2026-10-12 · 상태: **구현 완료(테스트 통과), 커밋은 사용자**

## 0. 목표
모델이 수백 개가 되어도 호선·구역·태그로 원하는 자료를 정확히 찾는다.

## 1. 바뀐 동작
| # | 무엇 | 어떻게 |
|---|---|---|
| 1 | 필터 칸 안 찾기 + 개수 제한 해제 | 서버 `FACET_LIMIT` 30 → **1000**(칸마다, 고른 값은 상한을 넘어도 늘 싣는다). 필터 칸 값이 8개를 넘으면 칸 안 찾기 입력이 생긴다 — 값·라벨(호선 = 선종, 올린 사람 = 이름)·동의어에서 공백·대소문자 무시(`FacetPanel.matchesFilter`, 분류 화면과 같은 함수). 고른 값은 찾기·더 보기와 무관하게 칸 맨 위에 늘 보인다. 응답 facet 에 구역·해석 종류·태그 `aliases`(있을 때만)와 호선 `label`(선종)을 싣는다. |
| 2 | 한 칸 여러 값 | **같은 칸 안은 OR, 칸끼리는 AND.** 필터 열·요약 띠는 값을 켜고 끄고(체크 토글), 적용 칩은 값마다 하나(같은 칸 사이 '또는'). 호선 제안 배너·묶음 머리 '거르기'는 그 칸을 값 하나로 바꾼다. 서버 `applied_filters` 는 `{칸: [대표 값, …]}`. |
| 2-b | WorkBench 선택 모드 자동 필터 | 규칙(구역 또는 태그)은 칸을 넘는 OR 이라 검색 필터로 그대로 옮길 수 없다. **한 칸(태그 우선, 없으면 구역)에 그 칸 규칙 값 전부를 OR 로** 켜고, 다른 칸 조건은 띠 문구로 안내한다("구역 '선수부' 자료도 보낼 수 있습니다(함께 걸면 둘 다 맞는 자료만 남으니 이 필터를 끄고 따로 거르세요)"). 끌 때는 규칙 값만 빼고 사용자가 더 고른 값은 남긴다. 칸을 넘는 OR 용 서버 파라미터는 만들지 않았다. |
| 3 | 호선 앞부분 일치 + 상단 자동완성 | 숫자만 2자리 이상인 검색어는 호선 **앞부분 일치**로도 맞는다(점수 60, 정확 일치 100 보다 낮다). 4자리 호선 제안 배너는 그대로. 상단 검색창은 ARIA combobox — 입력이 멈추면(200ms) `GET /api/suggest/all?q=&limit=5` 로 호선·구역·태그 후보, ↑/↓·Enter(그 필터로 검색, 다른 필터는 두고 글자 q 는 뺀다)·Esc(후보만 닫기), 그냥 Enter 는 기존 글자 검색. 한글 조합 중 키는 입력기 몫. |
| 4 | 정렬·묶기 | 정렬에 **호선순**(대표 호선 = 주 호선, 숫자는 수로 비교, 호선 없는 자료 뒤)·**제목순**(대소문자·연속 공백 무시, 유니코드 순 = 가나다순) 추가. 파일 보기에서는 호선순 = 파일이 든 자료의 대표 호선, 제목순 = 파일 이름. 보기 기준에 **태그별**('태그 없음', 태그 여러 개인 자료는 묶음마다, `multi_valued` 안내) 추가 — 사용자 설정 `search.group` 도 `tag` 를 받는다. |

## 2. 주소 형식 결정
- **같은 이름을 되풀이한다**: `?hull=3496&hull=3497&zone=선수부`.
- 쉼표로 나누지 않는 이유: 태그·구역은 자유 입력 값이라 쉼표가 들어갈 수 있다(`tag=a,b` 는 값 하나 'a,b').
- 옛 단일값 주소(`?zone=X`)는 값 하나짜리 목록으로 그대로 동작한다. 백엔드는 FastAPI `list[str]` 쿼리로 받는다.
- 칸마다 값 50개 상한, 빈 값·중복은 뺀다(`search.base.filter_values`). 같은 대표 값으로 모이는 동의어(ER·Engine Room)는 하나로.

## 3. 바뀐 곳
- 백엔드: `app/search/base.py`(SORTS·GROUP_KEYS·`filter_values`), `app/search/mysql_backend.py`(`_passes` OR/AND, `_facets` 상한·aliases·label, 앞부분 일치, `_hull_key`/`_title_key`, 파일 보기 종류 여러 값), `app/routers/search.py`(반복 파라미터), `app/routers/suggest.py`(`suggest_values` 공용 + `/api/suggest/all`, LIKE 특수 문자 글자 그대로), `app/prefs.py`(`search.group` = GROUP_KEYS).
- 프런트: `lib/search.js`(`filterValues`·`toggleFilterValue`, 반복 파라미터 읽기/쓰기, 정렬·묶기), `components/search/FacetPanel.jsx`(칸 안 찾기·여러 값·`matchesFilter`), `pages/SearchPage.jsx`(값 토글·값마다 칩), `ResultSummary.jsx`(값 토글), `ResultList.jsx`(호선 하나일 때만 칩 숨김), `GroupedResults.jsx`(태그 여러 값 안내), `pages/BrowsePage.jsx`(`matchesFilter` 공용), `components/shell/TopBar.jsx`(자동완성), `lib/wbTargets.js`·`components/workbench/WorkbenchSend.jsx`(자동 필터).
- 접근 권한(13·15): `/api/suggest/all` 은 `/api/suggest` 와 같은 함수라 볼 수 없는 자료에만 쓰인 호선·태그는 제안하지 않는다(`test_access_15` 매트릭스에 추가).

## 4. 테스트
- 백엔드 `tests/test_search_19.py`(OR/AND·facet 건수·상한·동의어·앞부분 일치·정렬(문서·파일)·태그 묶기·반복 파라미터·suggest/all·설정), `test_access_15.py`(suggest/all 권한), 기존 `test_search.py`·`test_search_08.py` 의 `applied_filters` 기대값을 목록으로.
- 프런트 `lib/search.test.js`·`FacetPanel.test.jsx`·`SearchPage.test.jsx`·`ResultSummary.test.jsx`·`TopBar.test.jsx`·`lib/wbTargets.test.js`·`WorkbenchSend.test.jsx`.
