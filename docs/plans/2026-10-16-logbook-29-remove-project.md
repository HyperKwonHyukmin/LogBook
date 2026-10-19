# 29 — 프로젝트(21) 걷어 내기

21 에서 넣은 **프로젝트**(자료의 소속, 태그 `kind='project'`, 자료당 하나)를 화면과 규칙에서 모두 뺀다.

## 왜

- 실제 자료는 호선 기준으로 쌓인다. 2026-10-16 기준 dev DB 자료 39건 중 프로젝트 값이 있는 자료는 **0건**,
  호선이 있는 자료는 30건. 145 운영 DB 도 같은 형태다(사용자 확인).
- 정리 대기 카드에서 BDF 를 확정할 때마다 '호선 / 호선 없음(공용) / 프로젝트' 셋 중 하나를 고르게 해, 쓰지 않는 칸이
  판단 거리만 늘렸다.
- 호선 없는 독립 과제 자료는 **'호선 없음(공용)' + 태그**로 충분히 표현된다.
- 자료 상세 칸만 지우면 검색 필터·묶기·문서 화면 소속·갖춤 현황 행·관계 지도 기준에 넣을 곳 없는 값이 남는다 —
  그래서 한 번에 모두 뺀다.

## 바뀌는 것

| 곳 | 전 | 후 |
|---|---|---|
| 정리 대기 카드 · 자료 상세 [변경하기] | '프로젝트' 칸 | 없음(`ProjectInput` 삭제) |
| BDF 확정 필수 칸 | 호선 · 공용 · 프로젝트 중 하나 | **호선 또는 '호선 없음(공용)'** (라벨 '호선(또는 공용)') |
| 제목 초안 | 호선이 없으면 프로젝트 이름이 머리 | 호선 → 공용 → (없음) |
| 같은·비슷한 제목 알림 | 같은 프로젝트끼리도 비교 | 같은 호선 · 공용끼리만 |
| `PATCH /api/entries/{id}` | `project` 받음, 감사 `ENTRY_PROJECT` | `project` 를 받지 않는다(보내도 무시) |
| 문서 화면 `/reports` | 소속 '독립 프로젝트', 프로젝트 거르기(`project=`), 응답 `projects`·`no_project` | 소속 = 호선 관련 · 공통 참고자료 · 미분류. 거르기·응답 키 없음 |
| 메인 검색 | `project=` 필터 · '프로젝트별' 묶기 · 검색어 적중 '프로젝트' · 행의 `project` | 모두 없음(`group=project` 는 422, 옛 주소의 `project=` 는 무시) |
| 자동완성 | `/api/suggest?kind=project`, `suggest/all` 의 `project` | 없음(`kind=project` 는 422) |
| 분류 화면 `/browse` | 프로젝트 칸 | 없음 |
| 갖춤 현황(26) | 프로젝트 행 `p:` | 없음 — 호선 → 공용 → 미지정 |
| 관계 지도(25) | 모으는 기준 호선 · 구역 · 프로젝트, 응답 `projects` | 호선 · 구역 |
| 선례 찾기 고르기 목록 | 호선 없을 때 프로젝트 칩 | 없음 |
| entry.json · `_INFO.txt` | `project` | 쓰지 않는다. 재구축은 옛 `project` 를 읽지 않는다 |
| `report-catalog-migrate`(21 이전 CLI) | 'project' 소속 → 자료 프로젝트 | 'project' 소속도 'reference' 처럼 '호선 없음(공용)'으로. 이름은 옮기지 않는다 |

## 그대로 두는 것

- **DB 스키마** — `tags.kind` 는 문자열이라 바꿀 것이 없다. 혹시 `kind='project'` 행이 남아 있어도 어디서도 읽지 않는다
  (검색 태그 적중에서도 계속 뺀다).
- **옛 이력 표시** — 활동 로그 `ENTRY_PROJECT` 라벨, 자료 이력 줄의 '프로젝트' 칸 이름(옛 감사 기록을 읽을 수 있게).
- 21 의 나머지(문서 화면·문서 분류·'문서에 사용한 모델' 연결·재구축)는 그대로다.

## 배포

마이그레이션 없음. 145 는 `git pull` + Server Manager ⟳ Update 로 끝난다(프런트 `dist` 포함).

## 테스트

- 백엔드: `test_reports_21.py` 를 다시 썼다 — 소속 파생(프로젝트 태그가 남아 있어도 미분류), 쪽 자르기,
  `test_project_is_gone_from_search_suggest_and_patch`(필터 무시·묶기 422·자동완성 422·PATCH 무시·entry.json 없음),
  `test_bdf_needs_hull_or_shared_project_does_not_count`, 재구축이 옛 `project` 를 읽지 않음, 이전 CLI 의 'project' 소속 → 공용.
  `test_coverage_26`(프로젝트 태그가 행이 되지 않음) · `test_graph_25`(`projects` 없음) · `test_search_19`(`suggest/all` 키) ·
  `test_report_index_22`(프로젝트 거르기 → 소속 거르기).
- 프런트: `coverage`·`entryEdit`·`inboxStatus`·`ReportsPage`(옛 주소의 `project=` 를 보내지 않음)·`graphModel`·`GraphPage`.
