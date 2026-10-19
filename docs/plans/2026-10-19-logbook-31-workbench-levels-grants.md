# 31 — WorkBench 대시보드 LogBook 모달 · 등급 보기 · 열람 허락 여러 명 고르기

## 결정 (사용자, 2026-10-19)

| 항목 | 결정 |
|---|---|
| 대시보드 접근 | WorkBench 대시보드 인사 줄에 [Hi-TESS LogBook] 단추 → **모달(iframe)** 안에서 자동 로그인(/sso)으로 바로 연다 |
| 등급 보기 | WorkBench 사용자 관리 표에 'LogBook' 열(보기 전용 — 바꾸기는 LogBook 사용자 관리) |
| 등급 정리 | 등급 번호는 그대로(LV1 게스트 · LV2 일반 · LV3 관리자). **관리자 외 전원 LV1**(일반 공개 모델 자료가 안 보인다), 관리자 = LV3 |
| 열람 허락 | 찾기 칸을 누르면 WorkBench 가입자 목록이 뜨고, 사번·이름·부서로 좁혀 **체크로 여러 명** 골라 한 번에 허락. 허락받은 사람 목록에 사번·부서까지 보인다 |

## LogBook

| 파일 | 하는 일 |
|---|---|
| `wb_users.list_active` | 검색이 앞부분 일치 → **이름·사번·부서 어디든 포함** |
| `GET /api/users/lookup` | 검색어가 없으면 활성 가입자 전체(최대 500), 응답에 부서·직급 |
| `POST /api/entries/{id}/grants` `{employee_ids}` | 여러 명 한 번에(최대 200). 모두 먼저 확인 — 한 명이라도 없거나(404) 비활성(422)이면 아무도 더하지 않는다. 이미 있는 사람은 건너뛴다. 감사 ENTRY_GRANT 는 사람마다, registry 는 한 번. 단건 `PUT` 은 그대로 둔다 |
| `grants_of` | 허락 목록에 부서 |
| `GET /api/integration/levels` | (공유 비밀키) 저장 등급 `{levels: {사번: {level, last_login}}, labels}` — WorkBench 사용자 관리 화면용 |
| `roles.reset_to_guest` · CLI `level-guest [--apply]` | 관리자가 아닌 LV2 를 모두 LV1 로. WorkBench 관리자(wb_admin)·LV3 지정자는 그대로. 사람마다 감사 USER_LEVEL(행위자 system) |
| `AccessPanel.jsx` Grants | 찾기 칸을 누르면 목록 팝오버(체크 상자). 이미 허락·올린 사람·LV3 는 잠긴 칸. 고른 사람은 검색어를 바꿔도 남는다. [N명 허락] |

새로 가입하는 사람은 원래 LV1 로 만들어진다(`roles.ensure_local_user`) — 그래서 일괄 정리는 145 에서 한 번이면 된다.

## WorkBench

| 파일 | 하는 일 |
|---|---|
| `routers/logbook_link.py` `GET /api/logbook/levels` | (관리자) LB `/api/integration/levels` 를 서버끼리 묻는다. 연동 꺼짐 503, 닿지 않음 502 `logbook_unreachable` |
| `utils/logbookLink.js` `logbookLevelOf` | WB 관리자 → LV3(자동), 저장값, LogBook 미접속 → LV1 (`access.level_of` 와 같은 규칙) |
| `UserManagement.jsx` | 'LogBook' 열 — LV 배지(관리자 빨강·일반 파랑·게스트 회색), 미접속·자동 표시는 툴팁 |
| `components/modals/LogbookModal.jsx` · `Dashboard.jsx` | 열 때마다 `/api/logbook/launch` 로 일회 코드를 받아 iframe. 새로 고침·다시 시도도 코드를 새로 받는다. [새 창으로 열기] = 기존 LogBook 창 |
| `electron/response-security.js` | 본창 CSP 를 **iframe 문서(subFrame)에는 덮어쓰지 않는다** — LogBook 문서는 자기 헤더 그대로 |

모달 안에는 [WorkBench로 보내기] 다리가 없다(보내기는 GMU·Truss 의 가져오기 단추로 연 창에서).

## 배포 (145)

1. LogBook·WorkBench 둘 다 `git pull` 후 재시작(DB 변경 없음). WorkBench 는 프런트가 바뀌어 새 빌드(포터블 exe) 배포가 필요하다.
2. LogBook 에서 한 번: `.venv\Scripts\python.exe -m app.cli level-guest` 로 대상 확인 → `level-guest --apply`.

## 테스트

LogBook `tests/test_grants_levels_31.py`(부서·사번 가운데 검색, 여러 명 허락·중복·전부 아니면 없음·권한, 등급 API, 일괄 LV1),
`test_access_15` 빈 검색어 = 전체. 프런트 `AccessPanel.test.jsx`·`EntryPage.access.test.jsx` 를 새 고르기 흐름으로.
WorkBench `tests/test_logbook_link.py` levels 2건, `utils/logbookLink.test.js` `logbookLevelOf`, `electron/response-security.test.js` subFrame.
⚠ 모달 iframe 의 실제 자동 로그인은 Electron 실행으로 확인해야 한다(개발 PC 에서 LogBook 9095 를 띄우고 대시보드 단추).
