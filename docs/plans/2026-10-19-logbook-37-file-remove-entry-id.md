# 37 — 자료 파일 개별 삭제 · 자료 번호 배지/복사

작성 2026-10-19 · 상태: **완료 — 207bf3f(2026-10-19 푸시), 145 반영** · 사용자 요청:
"항목의 수정에서 첨부파일도 개별로 삭제할 수 있는 기능이 필요해." /
"개별 항목의 고유 번호(E000051)를 눈에 잘 띄게 디자인해 주고 (개별 페이지에서) 바로 복사 버튼을 만들어서 다른 사람에게 붙여넣기 용이하게."

## 1. 파일 개별 삭제

### 동작
- 자료 상세 [변경하기] → 파일 트리 줄마다 휴지통 단추. 누르면 **삭제 예정**(취소선)으로 표시만 하고, [변경 완료] 때 칸 변경과 함께 반영(11 의 '확인 후 한 번에 저장' 규칙). 다시 누르면 취소, [취소]로 나가면 아무것도 빼지 않는다.
- 저장 순서: 바뀐 칸이 있으면 PATCH → 응답 version 으로 `POST /api/entries/{id}/files/remove`. 칸 저장은 됐는데 파일 빼기가 실패하면 "(정보 변경은 저장했습니다)" 를 덧붙여 알린다.
- 저장 뒤 토스트 [되돌리기]. 파일 목록 아래 **뺀 파일 N**(접힘)에서 하나씩 [되돌리기] — 고칠 수 있는 사람(올린 사람·LV3)에게만 보인다.
- 마지막 파일은 뺄 수 없다(단추 잠금 + 서버 422 `last_file`) — 자료 전체는 휴지통으로.

### 저장 방식(소프트 삭제)
- 실제 파일: Vault `files\<rel>` → `95_Trash\<자료번호>_files_<시각>\<rel>`(같은 볼륨 rename, `move_all` 되돌리기).
- DB: `files.entry_id = NULL`, `location = 'trash'`, 새 열 `removed_from_id`(원래 자료 pk, FK 없음)·`trash_rel`. `ensure_columns` 가 기존 DB 에 더한다(+ 색인 `ix_files_removed_from_id`).
- entry_id 를 비우는 이유: 파일을 entry_id 로 고르는 경로가 38곳(검색·판 묶음·문서·관계 지도·같은 BDF·갖춤 현황 …)이라, 위치 거르개를 곳곳에 더하지 않아도 저절로 빠진다.
- 판 묶음 행(`model_revisions`)은 그 파일 것을 지우고 `refresh_revisions`. entry.json·_INFO.txt 다시 씀(뺀 파일은 목록에서 빠짐).
- 감사 `ENTRY_FILES_REMOVED`(after: files·trash_rel) / `ENTRY_FILES_RESTORED`(after: files) — 변경 이력에 파일 이름으로 보인다.
- 되돌리기: 원래 rel 로, 그 사이 같은 이름이 생겼으면 `name (2).ext`(`unique_rel`).

### 운영 도구
- `ops/verify`: `trash_rel` 이 있는 파일은 `95_Trash/<trash_rel>/<rel>` 에서 찾고, 그 폴더를 '주인 없는 휴지통 폴더'로 보지 않는다.
- `ops/rebuild`: `E…_files_…` 폴더는 건너뛴다 — **뺀 파일은 DB 에만 기록돼 재구축하면 사라진다**(알려진 한계).
- 뺀 파일 자동 영구 삭제(2026-10-19 추가): `ops/purge.purge_removed_files` — 휴지통 폴더 이름의 시각(`_files_YYYYMMDD-HHMMSS`)으로
  `LOGBOOK_TRASH_DAYS`(휴지통과 같은 90일)가 지난 폴더를 지우고 행을 지운다(새 열 없음). 매일 작업(`ops/daily`, 상태 값 `purged_files`)과
  `python -m app.cli purge-trash` 가 부른다. 감사 `FILES_PURGE`(before: files·trash_rel, 변경 이력 '뺀 파일 영구 삭제').
  원래 자료를 영구 삭제하면(`purge_entry`) 그 자료에서 뺀 파일도 함께 지운다(감사 `TRASH_PURGE` before `removed_files`).
  되돌리기와 겹치지 않게 원래 자료 행을 잠그고 다시 고른다. 테스트 `test_file_remove_37.py` 2개 추가.

### 파일
- 백엔드: `models.py`(File 2열), `database.py`, `entries/service.py`(`remove_files`·`restore_files`·`removed_files_of`, 상세에 `removed_files`), `routers/entries.py`(2 경로), `ops/verify.py`, `ops/rebuild.py`
- 프런트: `pages/EntryPage.jsx`(`RemoveToggle`·`RemovedFiles`), `lib/labels.js`(동작·오류 라벨)
- 테스트: `backend/tests/test_file_remove_37.py`(5), `frontend/src/pages/EntryPage.files37.test.jsx`(3)

## 2. 자료 번호 배지·복사
- 머리 왼쪽의 작은 회색 글자 → **남색 테두리 배지**(`brand-subtle` 바탕, mono 15px 굵게, 자간 넓힘) + 배지 안 [복사] 단추. 누르면 번호만(`E000051`) 클립보드에, 단추가 1.6초 '복사됨'으로 바뀌고 토스트.
- 번호 글자는 `select-all` — 클릭 한 번으로 전체 선택돼 손으로 복사해도 된다.
- 자료 동작(⋯) 메뉴에도 [번호 복사] 를 링크 복사 위에 둔다.
- 사내 http 환경에서 `navigator.clipboard` 가 없으면 기존 `copyText` 의 textarea 대체 경로를 쓴다.
