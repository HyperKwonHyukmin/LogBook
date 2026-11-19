# 63 — 자료 의견과 이슈(댓글)

- 날짜: 2026-11-19
- 상태: 구현
- 관련: 13·15(권한), 05(재구축), 26·48(보완할 자료), 53(결론과 주의점)

## 왜
확정 자료는 올린 사람의 보관용이면서 다른 사람이 참고하는 자료다. 지금은 다른 사람이 "이 모델은 경계조건이 다르다",
"보고서 3쪽 값이 모델과 안 맞는다" 같은 말을 남길 곳이 없다. 자료 화면 아래에 의견을 남기고, 고쳐야 할 것은 이슈로 올려
해결 여부까지 따라갈 수 있게 한다.

결론과 주의점(53)은 **올린 사람이 정리한 글**이고, 의견은 **다른 사람의 목소리**다. 화면 문구로 둘을 구분한다.

## 범위(1차)
1. 자료 화면 '의견' 구역 — 파일 미리보기 아래. 글 종류 '의견' 과 '이슈'. 미리보기가 길어 찾기 어려워 오른쪽 속성 칸에
   '의견' 줄(의견 수, 열린 이슈 수, 없으면 '의견 남기기')을 두고 누르면 의견 구역으로 내려간다(`CommentsLink`).
2. 이슈는 '열림' → '해결됨'(다시 열기 가능). 해결할 수 있는 사람 = 이슈를 쓴 사람, 자료를 올린 사람, LV3.
3. 답글 한 단계(답글에 답글 없음). 자기 글은 고치고 지운다. LV3 는 남의 글도 지운다(감사 기록 `COMMENT_DELETE`).
4. 새 의견 알림 — 계정 메뉴 '새 의견 N'(아바타에 점). 대상 = 내가 올린 자료에 남이 쓴 글 + 내 글에 남이 단 답글.
   [새 의견] 화면(`/comments`)을 열면 읽은 시각을 저장한다. 메일, 푸시는 하지 않는다.
5. 보완할 자료(올리기와 확정 › 보완할 자료)에 '열린 이슈' 종류를 더한다.
6. 재구축 보존 — `registry.json` 의 `comments` 에 남기고 재구축 때 되살린다.

빼는 것(쓰임을 본 뒤 판단): @멘션, 좋아요, 첨부 파일, 의견 본문 검색, 검색 결과 카드의 의견 수, 의견을 주의점으로 올리기.

## 규칙
- **확정 자료에만** 쓴다. 초안은 올린 사람의 작업 공간이라 받지 않는다(409 `entry_not_confirmed`). 휴지통 자료는 읽기만.
- 보기 = 자료를 볼 수 있는 사람(`access.can_view_entry`, 못 보면 404). 쓰기 = LV1 이상(`access.can_write`).
- 본문 1~2000자. 답글은 최상위 글에만, 답글의 종류는 늘 '의견'.
- 지우기: 답글이 달린 최상위 글은 '삭제된 의견입니다' 로 남기고(본문 비움, `deleted_at`), 답글이 없으면 행을 지운다.
  마지막 답글이 지워져 남은 것이 삭제 표시뿐이면 그 표시도 지운다.
- 자료가 영구 삭제되면 의견도 지운다(`_clear_dangling_references`, FK CASCADE). 합치기는 초안끼리만 하므로 의견이 없다.

## 저장
- 표 `entry_comments`: id, entry_id(FK CASCADE), parent_id, employee_id, kind(comment|issue), body, resolved_by,
  resolved_at, created_at, edited_at, deleted_at.
- 읽은 시각: `user_prefs` 열쇠 `comments.seenAt`(서버만 쓴다, `PREF_KEYS` 밖이라 설정 API 에는 안 보임).
- `registry.json` `comments`: 원래 id 를 `key`, 답글은 `parent_key` 로 — 재구축 때 새 id 로 다시 잇는다.

## API
| 방법 | 주소 | 내용 |
| --- | --- | --- |
| GET | `/api/entries/{id}/comments` | 글 목록(최상위 + 답글), `can_comment` |
| POST | `/api/entries/{id}/comments` | `{kind, body, parent_id?}` |
| PATCH | `/api/comments/{cid}` | `{body}` 고치기(작성자) |
| DELETE | `/api/comments/{cid}` | 지우기(작성자, LV3) |
| POST/DELETE | `/api/comments/{cid}/resolve` | 이슈 해결, 다시 열기 |
| GET | `/api/me/comments?limit=` | 새 의견 화면 목록 + `unread`, `seen_at` |
| GET | `/api/me/comments/summary` | `{unread}` 계정 메뉴용 |
| POST | `/api/me/comments/seen` | 읽은 시각 저장 |

`/api/coverage` 의 자료 행에 `open_issues`(열린 이슈 수)를 더한다.

## 시험
- `backend/tests/test_comments_63.py`: 권한(못 보는 자료 404, 초안 409), 답글 한 단계, 고치기와 지우기 권한, 삭제 표시 규칙,
  이슈 해결 권한, 새 의견 수와 읽음, 영구 삭제 때 정리, registry 쓰기와 재구축 복원, coverage `open_issues`.
- 프런트: `EntryComments.test.jsx`, 보완할 자료 '열린 이슈' 종류, 계정 메뉴 항목.

## 145 반영
Update 만 하면 된다(표는 시작 때 `create_all` 이 만든다, `.env` 키 없음).
