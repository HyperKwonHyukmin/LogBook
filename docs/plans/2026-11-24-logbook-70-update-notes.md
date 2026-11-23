# 70 업데이트 안내(Update Note)

상태: 구현(2026-11-24). 사용자 요청: "WorkBench 처럼 LogBook 도 관리 페이지에 Update Note 를 신설, 업데이트 내용을 넣고 각 페이지 링크를 사용자에게 공유".

## 무엇
바뀐 사용법을 사용자에게 알리는 안내 글. 안내 한 건마다 공유 주소가 있어 메일이나 메신저에 붙여 보낸다.

- 사용자 화면: `/update-notes`(최신 안내), `/update-notes/<id>`(그 안내). 왼쪽 달별 목록, 오른쪽 본문, [링크 복사], 안내에 적은 화면으로 가는 [… 열기].
  로그인한 누구나 읽는다(LV1, 손님 포함). 로그인 전이면 로그인 뒤 그 주소로 돌아온다(RequireAuth 의 from).
  없는 id 면 최신 안내를 보이며 "찾는 안내가 없어 최신 안내를 보여 줍니다"(죽은 링크 없음, WorkBench 와 같다).
- 관리 › 업데이트 안내(`/admin/update-notes`, LV3): 안내 목록과 공유 주소 전체, [복사], 사용자 화면 링크.
- 계정 메뉴 '업데이트 안내': 이 브라우저에서 안 본 안내가 있으면 '(새 글 n)'. 기록은 localStorage `logbook_update_notes_seen`(최신으로 본 id), 처음이면 최근 14일 안의 것만 센다.
- 업데이트 이력(46, changelog.json) 항목에 `"page": "<안내 id>"` 를 달면 이력 화면에 '사용자 안내' 링크가 생긴다.

## 데이터
`backend/app/update_notes/notes.json` 한 파일(새 안내가 맨 앞), 그림은 같은 폴더 `img/`. DB 표 없음. 작성 화면 없음(WorkBench 와 같은 결정): 파일을 고쳐 커밋하고 145 Update(프런트 빌드 불필요).

한 건: `id`(영문 소문자, 숫자, 하이픈, `YYYY-MM-DD-주제`), `date`, `kind`(새 기능, 개선, 고침), `title`, `summary`, `links[{label, path}]`(앱 안 경로),
`sections[{heading, body[], facts[{label, text}], steps[], points[], image{src, alt, caption} 또는 images[], note}]`.
형식이 틀린 안내(잘못된 id, 날짜, 빈 제목, 겹친 id)는 서버가 건너뛴다. 시험(`tests/test_update_notes_70.py`)이 파일 모양, 그림 파일 존재, 가운뎃점과 em dash 금지를 잡는다.

## API
- `GET /api/update-notes`(로그인): 목록(id, date, kind, title, summary)
- `GET /api/update-notes/{id}`(로그인): 한 건, 없으면 404 `note_not_found`
- `GET /api/update-notes/img/{파일}`(로그인 없음): `<img>` 는 Bearer 토큰을 못 보내서 공개. 파일 이름 규칙과 폴더 밖 차단.

## 일부러 뺀 것
- 관리자 작성 화면: 안내는 배포와 같이 나가는 글이라 커밋으로 충분하다(WorkBench 도 없음).
- 조회 통계(WorkBench beacon), 로그인 때 뜨는 팝업: 실사용 가치에 비해 구조가 크다. 필요해지면 따로.
- 로그인 없는 공개 페이지: LogBook 은 사번 로그인이고 안내의 '화면 열기'가 어차피 로그인을 요구한다.

## 새 안내 쓰는 법
사용자가 "업데이트 안내 써"라고 하면: 사용 방법이 바뀐 기능만 고른다(작은 수정은 changelog.json 에만). notes.json 맨 앞에 한 건, 그림은 화면을 찍어 `img/`.
문장은 짧게, 화면 이름은 지금 이름(CLAUDE.md '화면 이름'), 가운뎃점과 em dash 금지. 커밋, 푸시, 145 Update 뒤 관리 › 업데이트 안내에서 주소를 복사해 보낸다.
