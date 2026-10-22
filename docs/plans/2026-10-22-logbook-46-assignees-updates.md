# 46 — 담당자(올린 사람과 따로) · 업데이트 이력 페이지

2026-10-22. 상태: 구현·테스트 끝, 145 확인 남음.

## 왜
- 자료를 올리는 사람(작성자)과 과제를 실제로 한 사람이 다를 수 있다. 지금은 `uploaded_by` 하나뿐이라 누가 해석했는지 남지 않는다.
- 해석한 사람이 퇴사했을 수도 있다 — WorkBench 에 없을 수 있고, 재직 여부를 적어 둬야 한다.
- 관리자가 LogBook 에 무엇이 언제 바뀌었는지 서버 주소 하나로 따라가고 싶다.

## 정한 것(사용자 확인)
1. 담당자는 **여러 명**(첫 사람이 주 담당자).
2. **공용 명부**(`people`) — 여러 자료가 한 사람 행을 가리킨다. 퇴사 처리를 한 번 하면 그 사람의 모든 자료에 보인다.
3. 이력 페이지는 **LV3 만**.

## 담당자
- 표: `people`(id, employee_id NULL 가능·UNIQUE, name, department, position, employed, source wb|manual, created_by, 시각),
  `entry_assignees`(entry_id CASCADE, person_id, sort_order). 새 표라 `create_all` 이 만든다(열 더하기 없음).
- 모듈 `app/people.py`: 찾기(명부 + WorkBench 활성 사용자 중 명부에 없는 사람), 만들기(손 입력 — 같은 이름·부서·직책이면 그 행),
  고치기(LV2 이상 `can_write_shared`, 감사 `PERSON_UPDATE`, 그 사람의 확정 자료에 `write_meta` 작업), 붙이기·옮기기, entry.json 내보내기·되살리기.
- API: `GET/POST /api/people`, `PATCH /api/people/{id}`. 자료에 붙이기는 `PATCH /api/entries/{id}` 의 `assignees: [{id} | {employee_id}]`
  (WorkBench 사번이면 그때 명부 행을 만든다. WB 를 읽을 수 없으면 503, 없는 사번은 422 `person_not_found`).
- 쪼개기 → 새 초안에 복사, 합치기·기존 자료에 추가 → 대상에 덧붙임, Entry 지울 때 연결 행 지움.
- 감사 스냅숏 `assignees: ["이름(부서, 직책, 퇴사)"]`(있을 때만), entry.json `assignees`(사본), `_INFO.txt` '담당자:' 줄, 재구축이 명부를 되살림.
- 검색: 낱말이 명부 이름·사번과 정확히 같으면 그 자료(적중 이유 '담당자'). 필터 칸은 아래 '후속'에서 더했다.
- 화면: `components/people/AssigneeInput.jsx` — 정리 대기 카드·자료 상세 [변경하기]의 '담당자' 칸, 읽기 화면은 이름(검색 링크)·부서·직책·퇴사 표시.
  명부 고치기(연필)는 자료 저장과 별개로 **바로 저장**된다(자료 변경 비교는 사람 id 로만 해서 충돌로 보지 않는다).

## 후속(같은 날) — 작성자 · 담당자별 보기
- 화면의 '올린 사람'을 **작성자**로(사용자: "많이 쓰는 표현이 아니다"). 자료 화면은 작성자 한 줄 + 등록일, '확정자' 줄은 없애고
  확정한 사람이 작성자와 다를 때만 '확정' 줄. API·DB 이름(`uploaded_by`)은 그대로.
- 검색 칸 `assignee`(값 = 명부 번호, 같은 이름도 가른다): 필터·건수(label 이름, detail 부서·직책·퇴사)·보기 기준 '담당자별'·분류 화면.
  자료 화면 담당자 이름 → `?assignee=<번호>`.

## 업데이트 이력
- 화면 = 앱 안 관리 › 업데이트 이력(`/admin/updates`, `frontend/src/pages/admin/UpdatesPage.jsx` + `lib/updateHistory.js`), 내용은
  `/api/admin/updates`(LV3). 처음엔 독립 HTML(`/updates`)이었는데 앱을 벗어나 사이드 메뉴가 사라져서 옮겼다(사용자 지적, 2026-10-22).
  옛 `/updates` 는 서버가 `?period=` 를 붙여 새 화면으로 넘긴다(307).
- 내용 `backend/app/changelog/changelog.json` — 01~45 는 계획 표에서 옮겼다. **새 기능을 끝내면 맨 앞에 한 줄**(CLAUDE.md 규칙).
  프런트 빌드와 무관해 145 Update 만으로 바뀐다.
- 관리 메뉴 '업데이트 이력'(같은 창, 다른 관리 화면과 같다).

## 145 확인
- Update 뒤 자료 하나에 담당자(WorkBench 사용자 + 직접 입력 퇴사자)를 넣고 저장 → 공유 폴더 entry.json `assignees` 확인.
- LV3 로 관리 › 업데이트 이력 열기(사이드 메뉴 그대로), 옛 주소 `/updates` 가 그 화면으로 넘어가는지.
- `.env` 새 키 없음. `server_manager.py` 안 바꿈(창 다시 열 필요 없음).
