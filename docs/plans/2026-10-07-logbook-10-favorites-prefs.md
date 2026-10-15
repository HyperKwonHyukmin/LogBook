# 10 — 즐겨찾기·사용자 설정(미리보기 폭 기억)

선행: 09(미리보기 폭 조절·결과 행). 사용자 요청(2026-10-07):
"즐겨찾기 토글로 목록을 저장해 쉽게 찾게", "오른쪽 세부 내용의 폭을 한 번 바꾸면 기억".

## 1. 즐겨찾기 (사용자별, 서버 저장)

- 표 `favorites`(id, employee_id, entry_id→entries.id `ON DELETE CASCADE`, created_at, UNIQUE(employee_id, entry_id)).
  새 표라 `init_schema()` 의 `create_all` 이 만든다 — 145 는 API·워커 재시작만으로 생긴다(ALTER 없음).
- 휴지통: 행은 남기고 목록·`fav=1` 검색에서만 숨긴다(검색 상태 필터가 trashed 를 빼므로). 복원하면 그대로 돌아온다.
  영구 삭제·합치기·확정 병합으로 Entry 행이 지워질 때는 `entries.service._clear_dangling_references` 가 함께 지운다
  (모든 `db.delete(entry)` 경로가 이 함수를 거친다).
- **registry.json·재구축(05) 대상 아님** — 개인 편의 정보이고, 재구축은 Entry pk 를 새로 매겨 대응표가 필요하다.
  재구축하면 즐겨찾기는 비어서 시작한다(자료 자체는 그대로).
- API(`routers/favorites.py`, 로직 `app/favorites.py`)
  - `PUT /api/favorites/{entry_id}` 넣기(여러 번 불러도 같다, 휴지통 Entry 는 409 `entry_trashed`, 없으면 404)
  - `DELETE /api/favorites/{entry_id}` 빼기(없어도 200)
  - `GET /api/favorites?limit&offset` — 내 즐겨찾기, 최근에 넣은 순, 검색 결과(문서 보기)와 같은 행 모양 + `favorite`
  - `GET /api/search?fav=1` — 내 즐겨찾기만(미확정 포함, 휴지통 제외), 정렬 `favorited`(즐겨찾기한 순) 추가.
    `fav` 없이 `sort=favorited` 를 보내면 기본 정렬로 돌아간다. 응답에 `favorites_only`.
  - 검색 행(문서·파일 보기)·Entry 상세·호선 타임라인 행에 `favorite: bool` — 페이지 단위 한 번의 질의(N+1 없음).
- 화면
  - 별 단추 `components/favorites/Favorites.jsx` `FavoriteToggle`(lucide Star, 켜지면 채움, `aria-pressed`,
    라벨 '즐겨찾기 추가/해제'). 색 토큰 `fav` #B26B00(아이콘 전용, 흰 바탕 4.2:1).
  - 자리: 검색 결과 행(오른쪽, 꺼진 별은 행 hover·포커스·선택 때만), 미리보기 머리줄, Entry 상세 머리줄(휴지통이면 비활성),
    호선 타임라인 행. 행의 별은 눌러도 행 선택·미리보기·이동이 일어나지 않는다(키보드 ↑/↓·Enter 그대로).
  - `FavoritesProvider`(셸) — 낙관적 토글 + 실패 시 되돌림·토스트. 같은 Entry 의 별(행·미리보기·상세)이 같은 값을 보인다.
  - 찾기: 사이드 메뉴 '즐겨찾기'(검색 다음) → `/?fav=1`(검색 화면 재사용, 필터·정렬·미리보기 그대로).
    검색 머리말의 '즐겨찾기만' 토글(켜면 '미확정 포함' 은 숨김). 비어 있으면 넣는 방법을 안내하는 빈 상태.
  - 머리말 건수는 같은 종류의 응답일 때만 보인다(즐겨찾기로 바꾼 직후 옛 검색 건수를 '즐겨찾기 N건' 으로 보이던 것 수정).
  - 결과 열이 좁으면(미리보기를 넓게 끈 1366) 머리말이 두 줄로 접힌다 — 정렬 선택이 잘리던 것 수정. 진행 줄은 머리말 아래 끝.

## 2. 미리보기 폭 기억 — 로컬 + 서버

- 실측(Playwright, 1366·1920): 기존 localStorage 저장은 **새로 고침·상세 다녀오기·창 줄였다 늘리기** 모두에서 유지됐다
  (좁은 창에서는 표시만 잘리고 저장값은 그대로, 창을 되돌리면 원래 폭). 결함은 없었고 '다른 PC·브라우저에서는 처음 폭' 이 남은 문제였다.
- 표 `user_prefs`(employee_id, key PK, value JSON, updated_at) + `GET/PUT /api/me/prefs`.
  열쇠 화이트리스트 `app/prefs.py PREF_KEYS`(지금은 `search.previewWidth` = 360~4000 정수), 값 1KB·한 번 20개 한도,
  모르는 열쇠·잘못된 값 422, `null` 은 지우기.
- 화면 `lib/prefs.js` · `lib/usePrefsSync.js`
  - 셸이 뜰 때(로그인·앱 시작) 한 번 받아 localStorage 사본에 옮기고 열려 있는 화면에 알린다 — **서버 값이 이긴다**.
  - 끌기를 놓을 때·키로 바꿀 때 저장하고 600ms 뒤 한 번 보낸다. 두 번 눌러 기본 폭이면 서버에서도 지운다.
  - 보내지 못한 변경(`logbook.prefsUnsent.v1`)은 남겨 두고, 다음 시작 때 서버의 옛 값보다 이긴 뒤 다시 보낸다
    (끌고 600ms 안에 새로 고침해도 되돌아가지 않게). `pagehide`·로그아웃 직전에 바로 보낸다.
  - 화면 폭에 맞춰 자른 표시값은 저장하지 않는다(사용자가 끌거나 키로 바꿀 때만).

## 3. 검증

- 백엔드 `tests/test_favorites_prefs.py`(API·멱등·사용자별·휴지통 숨김/복원·영구 삭제·합치기·검색 `fav`·플래그·호선·
  `init_schema` 표 생성·설정 왕복·검사) — 전체 703 통과, 3 건너뜀.
- 프론트 별(행·미리보기·상세·호선, 실패 되돌림), 메뉴, 빈 상태, 머리말 건수, `prefs.js`, 폭 훅(잘림·서버 값) — 전체 435 통과.
- 시험 스택(9096, logbook_test, 합성 데이터)에서 Playwright 34항목 통과: 별·목록·정렬, 폭 저장(새로 고침·상세·창 크기),
  서버 값으로 다른 브라우저 시작, 기본 폭 되돌리기 → 서버 삭제.

## 4. 배포

- 145: `git pull` → 프론트 빌드 → API·워커 재시작. 새 표 2개는 시작 때 자동 생성. 의존성 추가 없음.
