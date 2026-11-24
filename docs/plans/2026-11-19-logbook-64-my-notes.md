# 64 — 나의 메모(개인 지식 노트)

작성 2026-11-19 · 상태: **구현** · 사용자 요청: "각 항목들을 보면서 개인이 메모 해둘 수 있나? 내 메모들 모아서 보고 그 항목 바로 클릭하면 들어가서 볼 수 있게. 나의 지식 저장 노트인 거야."

## 결정

1. 자료마다 **내 메모 하나**(사용자별). 쓴 사람만 본다 — 다른 사람도 관리자도 못 본다. 의견(63)은 모두가 보는 글, 메모는 나만 보는 글.
2. **왼쪽 메뉴 '나의 메모'**(`/notes`, '찾아 쓰기' 맨 아래). 사이드 메뉴 7 → 8(사용자 결정 — 날마다 따로 찾아 들어가는 개인 노트라 `CLAUDE.md` 메뉴 규칙의 예외로 적음).
3. **마크다운**: `marked`(GFM — 표, 체크 목록, 취소선, 한 줄 바꿈 = 줄바꿈) + `dompurify`(스크립트, on* 속성, javascript: 주소 제거). 링크는 새 탭, `file:` 링크(공유 폴더 경로) 허용. 판은 나온 지 2주 넘은 것으로 고정(`marked 18.1.3`, `dompurify 3.4.17`, 2026-11-19 기준 알려진 취약점 없음).
4. **저장**: [저장] 단추, Ctrl+Enter(맥 Cmd+Enter), 편집 칸을 벗어날 때(같은 상자의 [저장]·[취소]로 가는 것은 제외). 셋 다 저장 뒤 보기로. [취소]는 버린다. 편집 중에 다른 화면으로 가도 바뀐 글은 저장한다. 빈 본문 저장 = 메모 지우기. 상한 2만 자.
5. 휴지통 자료의 메모는 목록에서 숨기고(행은 남아 복원하면 돌아온다) 새로 쓰지 않는다(409). 영구 삭제·합치기 때 함께 지운다.
6. 개인 편의 정보라 감사 기록, `registry.json`(재구축) 대상이 아니다 — 즐겨찾기(10)와 같다. DB 백업에는 들어간다.

## 화면

- **자료 화면** 오른쪽 속성 목록 아래 '나의 메모 · 나만 보임'. 비었으면 [메모 쓰기], 있으면 변환된 마크다운(높이 50vh 넘으면 칸 안 스크롤) + [고치기] + 고친 시각 + '나의 메모 모아 보기'.
- **나의 메모**(`/notes`): 고친 시각 최근 순. 줄마다 호선 칩(공용), 자료 번호 + 제목(누르면 자료 화면), 확정 전 표시, 고친 시각, 변환된 메모(길면 접고 [펼치기]). 찾기 칸 = 메모 본문, 자료 제목, 자료 번호(낱말 모두, 서버).

## API

| 방법 | 주소 | 내용 |
|---|---|---|
| GET | `/api/me/notes?q=&limit=` | 내 메모 목록 `{items[{entry{entry_id,title,status,hulls,no_hull}, body, preview, updated_at, created_at}], total}` |
| GET | `/api/entries/{id}/note` | `{body, updated_at}`(없으면 빈 본문). 볼 수 없는 자료 404 |
| PUT | `/api/entries/{id}/note` `{body}` | 저장(같은 본문이면 고친 시각 그대로), 빈 본문이면 지움. 2만 자 넘으면 422 `note_too_long`, 휴지통 409 |

표 `entry_notes`(employee_id, entry_id FK CASCADE, body TEXT, created_at, updated_at, UNIQUE(employee_id, entry_id)) — `create_all` 이 만든다(145 Update 때 자동).

## 파일

- 서버: `app/models.py` `EntryNote` · `app/notes.py` · `app/routers/notes.py` · `app/main.py` · `app/entries/service.py`(`_clear_dangling_references`)
- 화면: `lib/markdown.js` · `components/notes/EntryNote.jsx` · `pages/NotesPage.jsx` · `components/shell/SideNav.jsx` · `App.jsx` · `lib/pageTitle.js` · `pages/EntryPage.jsx` · `index.css` `.md-body`
- 시험: `tests/test_notes_64.py`(3) · `markdown.test.js` · `EntryNote.test.jsx` · `NotesPage.test.jsx` · `SideNav.test.jsx`(메뉴 8개)

## 덧붙임 — 의견과 이슈 탭(2026-11-25)

- 사용자 요청: "나의 메모에, 내가 댓글, 또는 이슈를 적은 항목들도 따로 볼 수 있도록". 메뉴는 늘리지 않고 '나의 메모' 안에 탭 둘: [메모] [의견과 이슈](`?tab=comments`).
- API `GET /api/me/comments/written?kind=comment|issue&status=open|resolved&q=&limit=`(`comments.written`) — 내가 쓴 의견, 이슈, 답글(최근 순). 지운 글, 지금 볼 수 없는 자료(휴지통 포함)의 글은 뺀다. `counts`(전체, 의견, 이슈, 열린 이슈)는 거르기 전 수. 답글은 `reply_to`(누구의 어떤 글, 앞부분).
  `/api/me/comments` 는 '내게 온 글'(받은 알림)이라 다르다.
- 줄을 누르면 `/e/{id}#entry-comments` — 자료 화면이 글을 불러온 뒤 의견과 이슈 칸으로 한 번 내려간다(`EntryComments.jsx`).
- 시험 `tests/test_my_written_comments.py`, `NotesPage.test.jsx`.

## 남은 것

- 145 에서 실제 화면 확인(개발 PC 에서 화면을 띄워 보지 못함).
- 써 보고 필요하면: 검색 결과 행에 '메모 있음' 표시, '메모한 자료만' 거르기(처음에는 일부러 뺐다).
