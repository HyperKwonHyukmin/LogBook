# 15 — Hi-TESS LogBook: 해석 시기 제거 · 이름/브랜드 · WorkBench 사용자 + LV1~LV3

선행: 01(사번 로그인), 05(registry.json·재구축), 08(해석 시기 도입 — 이번에 걷는다), 09·11(요약 띠·묶어 보기),
12(같은 BDF), 13(권한 — 규칙만 바꾸고 구조는 재사용), 14(판 묶음·비교).
사용자 요청(2026-10-08) 세 가지:
1. "해석 시기는 무의미한 정보이기에 제거해줘."
2. "프로그램 네이밍을 Hi-TESS LogBook으로 변경해줘. … WorkBench 의 로고, 시그니처를 차용해줘."
3. "사용자 DB도 HiTESS Workbench의 DB를 그대로 사용 … LogBook 등급 LV1~LV3."

## 1. 해석 시기 제거

- **화면·API·검색에서 없앤다.** `entries.analysis_period` **열은 남기고 쓰지 않는다**(값 보존, DB 백업에 그대로).
  - 상세(보기·편집 모드), 정리 대기 DraftCard 입력칸, 검색 결과 행·파일 행·미리보기, 요약 띠의 연도 막대,
    분류 둘러보기의 '해석 연도', 필터 '해석 연도'(`year`, `unknown` 버킷 포함), 정렬 '해석 시기', entry.json, 수정 API(`EDITABLE_FIELDS`)·
    형식 오류 `invalid_period`, 감사 스냅숏.
  - 경로·파일에서 연월을 뽑는 자동 추정은 원래 없었다(확인: ingest·uploads·extract 에 period 코드 없음).
- **날짜가 필요한 자리 = '올린 날짜'** = 확정일(`confirmed_at`), 초안은 등록일(`created_at`). 기존 `sort_at` 과 같은 값이다.
  - 정렬: 관련도 | **최신순**(`recent`) | 즐겨찾기한 순. 주소에 없으면 검색어가 있을 때 관련도, 없을 때 최신순.
    옛 주소의 `sort=period` 는 422 대신 최신순으로 받는다(공유된 링크가 깨지지 않게). `year=` 는 무시된다.
  - 결과 행 오른쪽 날짜: `해석 2025-11` → `올림 2026-10-06`(응답 `posted_at`).
  - 호선 타임라인 월: 해석 시기가 있으면 그 달이던 것을 **확정일의 달**로만.
- **연도 facet 은 없앤다(올린 연도로 바꾸지 않는다).** 이유: 자료는 2026 년부터 쌓이기 시작해 올린 연도는 한두 값뿐이라
  거르는 힘이 없고, 최신순 정렬과 같은 정보를 두 번 보인다(DESIGN.md 14번 '같은 정보 두 번'). 기간이 필요해지면 그때 날짜 범위 필터로 다시 설계한다.
- 재구축(05): 옛 entry.json 에 `analysis_period` 가 있으면 그대로 DB 열에 넣는다(호환). 새 entry.json 은 쓰지 않는다.

## 2. 이름·브랜드 — Hi-TESS LogBook

- 화면에 보이는 이름: **Hi-TESS LogBook**(로그인·상단 바·`<title>`·파비콘·빈 화면/안내 문구·`_INFO.txt`·바로가기 안내·API 제목·README·DESIGN/PRODUCT).
- 한글 부제 '구조해석 항해일지'는 **로그인 브랜드 면에서만 보조로 둔다**(이름은 영문 하나로 통일, 부제는 무엇을 하는 앱인지 한 번 알려 주는 역할).
- 로고: WorkBench 의 Hi-TESS 마크(`public/logo.png` — 회색 고리 + 빨강·파랑·초록 면)를 복사해 쓰고, 워드마크는 그림 대신 글자로 짠다 —
  `Hi-TESS`(흰 글자 600) + `LogBook`(WorkBench 잠금 로고의 민트 `#5FE0B0` 계열 → 토큰 `brand-mint`). 잠금 그림(`hitess_logo_lockup_transparent.png`)은
  'WorkBench' 글자가 박혀 있어 쓰지 않는다. 파비콘은 WorkBench `icon.ico` + `logo.png`.
- 로고가 놓이는 바탕은 네이비 크롬(상단 바·로그인 브랜드 면) 둘뿐이다. **앱에는 다크 테마가 없다** — '어두운 바탕' = 네이비 크롬이므로
  투명 PNG 의 회색 고리·면 색이 `navy-900` 위에서 보이는지(대비 측정)와, 흰 바탕(파비콘·탭)에서 보이는지를 확인한다.
- DESIGN.md 토큰 체계는 그대로. 더하는 것은 `brand-mint`(네이비 위 워드마크 전용, 장식 금지) 하나.
- 바꾸지 않는 것: 저장소 폴더 `C:\Coding\Logbook`, 파이썬 패키지 `app`, DB `logbook`, 공유 폴더 `999_LogBook`, 환경변수 `LOGBOOK_*`,
  localStorage 키(`logbook_*` — 바꾸면 모두 로그아웃·설정 초기화), 바로가기 파일 이름 `Logbook.url`(운영 중인 바로가기를 깨지 않게).

## 3. 사용자 = WorkBench 사용자, LogBook 등급 LV1~LV3

### 3.1 WorkBench 사용자 표 — 읽기 전용

- 운영: 145 MySQL `hitessworkbench.users`(id, employee_id, name, company, department, position, is_active, is_admin, is_developer, …).
  LogBook 은 **같은 MySQL 연결(logbook DB 계정)로 이 표를 SELECT 만** 한다. INSERT/UPDATE/DELETE/DDL 은 코드에 없고 테스트가 고정한다.
- 설정 `LOGBOOK_WB_USERS_TABLE`(기본 `hitessworkbench.users`, `스키마.표`, 영문·숫자·밑줄만), `LOGBOOK_WB_CACHE_SECONDS`(기본 60).
- 모듈 `app/wb_users.py` 한 곳 — SQLAlchemy `Table`(별도 MetaData, **Base 에 등록하지 않아 create_all·drop_all 대상이 아니다**) + `select()` 만.
  - `fetch(db, 사번)` / `fetch_many` / `list_active(q)` / `status()`(관리자 운영 화면용: 표 이름·연결 여부·활성 수·오류).
  - 연결 실패·권한 없음(OperationalError·ProgrammingError) → `WbUnavailable` → 로그인 503 `wb_unavailable`, 관리 화면 503.
- 운영에서 logbook 계정에 SELECT 권한이 필요하다(§7).
- 시험: `logbook_test` 안의 가짜 표 `wb_users`(conftest·시험 스택 시드가 만든다). 개발 중 실제 `hitessworkbench` 에 접속하지 않는다.

### 3.2 로그인·세션

- 사번만(WorkBench 와 같다). 순서: 형식 검사 → WB 표 조회(캐시 무시) → 없으면 404 `not_registered`('WorkBench 에 가입된 사번이 아닙니다'),
  `is_active=0` 이면 403 `wb_inactive`('WorkBench 승인 대기 중이거나 비활성'), 조회 실패면 503 `wb_unavailable`.
- LogBook `users` 표는 **사번 기준 캐시·등급 저장소**로 유지한다(기존 FK·사번 참조 그대로). 처음 들어오면 행을 만들고 **LV1**,
  감사 `USER_JOIN`. 로그인할 때마다 이름·부서·직급·WB 관리자 여부를 WB 값으로 덮어쓴다.
- **매 요청 확인**: `require_auth` 가 WB 활성 여부를 다시 본다(사번별 60초 캐시). WB 에서 비활성·삭제되면 그 사람의 세션을 모두 지우고 401 `wb_inactive`
  (다음 요청에서 끊긴다, 늦어도 60초). 조회 실패면 503 `wb_unavailable`(토큰은 지우지 않는다 — 화면은 오류 줄만).
- 가입·승인 대기 흐름 없앰: `POST /api/auth/register` → 410 `register_moved`. 화면의 '가입 신청' 탭 → 'WorkBench 에서 가입·승인 후 사용' 안내.
  관리자 승인·거절·비활성·활성 API 와 화면도 없앤다(활성 여부는 WorkBench 가 정한다).

### 3.3 등급

| 등급 | 화면 이름 | 열람 | 쓰기 |
|---|---|---|---|
| LV1 | 게스트 | 공유 자료 + 개별 허락받은 자료 + 자기가 올린 자료 | 올리기, 자기 자료 수정·공유 지정·허락 |
| LV2 | 일반 | 공유 + 일반 + (블록은 개별 허락 있을 때) + 자기 자료 | LV1 + 공용 데이터(태그 동의어·호선 선종/메모)·해석 검증 |
| LV3 | 관리자 | 모든 자료 | 모든 자료 수정·휴지통, 블록 지정/해제, 등급 지정, 분류 목록·운영 |

- 저장: `users.level`(1/2/3). **실효 등급 = WB `is_admin=1` 이면 3, 아니면 저장값**(`users.wb_admin` 에 WB 값을 캐시). WB 관리자는 LogBook 에서 내릴 수 없다(409 `wb_admin_locked`, 화면 잠금 표시).
- 판단은 `access.py` 한 곳: `level_of`·`is_admin`(LV3)·`can_write`(LV1 이상 = 로그인한 누구나)·`can_write_shared`(LV2 이상)·`require_shared_writer`(403 `level2_required`)·
  `can_view_entry`·`visible_entries_filter`·`can_edit_entry`·`can_manage_access`·`access_brief`. 13 의 Master 개념은 없앤다(LV3 끼리 동등).
- 등급 바꾸기(`roles.py` → `set_level`): LV3 만. 자기 자신 400 `cannot_change_self`, WB 관리자 409 `wb_admin_locked`, WB 비활성 422 `wb_user_inactive`,
  WB 에 없는 사번 404 `user_not_found`. LogBook 에 행이 없는 WB 사용자도 고를 수 있다(그때 행을 만든다). 감사 `USER_LEVEL`.
  - **마지막 LV3 보호**: 화면에서는 고르는 사람 자신이 LV3 이고 자기 자신은 못 바꾸므로 LV3 가 0명이 될 수 없다(별도 검사 불필요).
    CLI `set-level` 은 행위자가 없으므로, 내린 뒤 실효 LV3(저장 LV3 + WB 활성 관리자)가 0명이면 거부한다.
- **13 데이터 이전(멱등)**: 시작 때 `database.migrate_levels()` — `level IS NULL` 인 행만:
  `status='pending'` → 1(승인된 적 없음), `role∈{master,admin}` 또는 `is_admin=1` → 3, `role∈{viewer_all,member}` → 2, 그 밖(guest·disabled) → 1.
  disabled 를 1 로 둔 이유: LogBook 비활성은 사라지고 WB 활성 여부만 남으므로, 막혀 있던 사람이 WB 로 들어와도 공유 자료만 보게 한다(최소 권한).
  13 이전 DB(role 열 없음 → 'member' 기본값)도 같은 식으로 맞다. `role`·`is_admin`·`status` 열은 남긴다(`is_admin` = 실효 LV3 로 맞춰 둔다).

### 3.4 자료 공개 단계

`entries.access` 열을 그대로 쓰고 값을 바꾼다: `shared`(공유) / `normal`(일반, **기본**) / `blocked`(관리자 블록). `private_min_role` 은 쓰지 않는다.

- **열람**: LV3 전부 / 올린 사람은 자기 자료 항상(**블록돼도** — 자기가 만든 자료의 존재를 본인에게 숨기면 같은 파일을 다시 올리는 사고가 난다.
  대신 블록 자료의 공유 범위·허락은 고칠 수 없다) / `shared` 는 LV1 이상 / `normal` 은 LV2 이상 / 개별 허락(`entry_grants`)이 있으면 단계와 무관하게.
- SQL: `level≥3` → 참 / 그 밖 `uploaded_by=나 OR 허락 OR access='shared' OR (LV2 이상 AND access<>'blocked')`.
  13 처럼 알 수 없는 값(`public`·`private` 가 남은 행)은 '일반'으로 다룬다(LV1 에게 숨김, LV2 에게 보임 — 이전 전에도 새지 않는다).
- **바꾸기**: 공유↔일반 = 올린 사람 + LV3. 블록 지정·해제 = LV3 만(403 `level3_required`). 블록된 자료는 올린 사람도 단계·허락을 못 바꾼다.
- **개별 허락**: 올린 사람 + LV3(블록 자료는 LV3 만). 대상 = WB 활성 사용자 누구나(LV1 포함, LogBook 에 들어온 적 없어도 된다). 효력 = 대상이 WB 활성일 때.
  공유 자료에는 허락이 필요 없으므로 패널을 숨긴다(행은 남는다).
- **13 이전**: `database.migrate_access()` — `public`→`normal`, `private`+`admin`→`blocked`, `private`→`normal`. 멱등.
  13 은 운영에 배포되지 않았으므로 운영 자료는 모두 `normal` 이 된다(요청대로). 개발 DB 의 관리자 전용 비공개만 블록으로 남는다.
- 숨김 구조(404·목록 제외·SQL 거르개·`entry_grants`·12 same_model `_visible`·14 판 묶음/비교·즐겨찾기·최근 비교·활동 로그·자동완성)는 13 그대로 — 규칙만 `access.py` 에서 바뀐다.

### 3.5 쓰기 권한 표

| 동작 | LV1 | LV2 | LV3 | 근거 |
|---|---|---|---|---|
| 올리기·정리 대기 확정·배치 가져가기·초안 쪼개기/합치기 | O | O | O | 요청 'LV1 도 업로드 가능' |
| 자기 자료 수정·휴지통·복원·파일 추가·판 정리 | O | O | O | |
| 자기 자료 공유/일반·열람 허락 | O | O | O | 요청 |
| 남의 자료 수정·휴지통 | X | X | O | 13 `can_edit_entry` 그대로 |
| 블록 지정/해제·블록 자료 허락 | X | X | O | 요청 |
| 해석 검증(Nastran) 요청 | 자기 자료만 | O | O | 서버 자원을 쓰고 결과가 모두에게 보이는 공용 데이터 |
| 자유 태그 동의어 묶기·풀기 | X | O | O | 공용 데이터(모든 자료의 검색에 영향) |
| 호선 선종·메모 | X | O | O | 공용 데이터 |
| 분류 목록·운영·사용자 등급·목록 밖 새 용어 | X | X | O | |
| 판 비교 요청·즐겨찾기·화면 설정·최근 비교·사용자 찾기 | O | O | O | 보기·개인 기능 |

### 3.6 API

| 경로 | |
|---|---|
| `POST /api/auth/login` | 위 §3.2. 응답 user 에 `level`(실효)·`stored_level`·`wb_admin` |
| `POST /api/auth/register` | 410 `register_moved` |
| `GET /api/admin/users?q=` | WB 활성 사용자 + LogBook 에 행이 있는데 WB 활성이 아닌 사람(`wb_active:false`) — 등급·WB 관리자·마지막 로그인 |
| `PUT /api/admin/users/{사번}/level` | `{level}` — §3.3 |
| `GET /api/users/lookup?q=` | 허락 대상 찾기 — WB 활성 사용자(이름·사번 앞부분, 20명), 로그인한 누구나 |
| `PUT /api/entries/{id}/access` | `{access: shared|normal|blocked, version}` |
| `PUT/DELETE /api/entries/{id}/grants…` | 13 그대로, 규칙만 §3.4 |
| `GET /api/admin/ops/status` | `wb_users: {table, ok, active, error}` 추가 |

Entry 응답: `access`·`label`(공유/블록, 일반은 null)·`can_manage_access`·`can_block`·`grants[{employee_id,name,level,effective}]`.
없앤 API: 가입 승인·거절·비활성·활성, `PUT /role`, `PUT /admin`. 없앤 CLI: `set-master`·`set-role` → `set-level <사번> <1|2|3>`. `create-admin` 은 LV3 로 만든다.

### 3.7 재구축 원천

- registry.json: `users[]` 에 `level`(저장값)·`wb_admin` — `role`·`is_admin` 은 쓰지 않는다. `entry_access` = 일반이 아닌 자료(공유·블록)만 `{entry_id, access}`. `grants` 그대로.
- entry.json: `access`(단계만, 허락 명단 없음 — 13 규칙). `_INFO.txt` '공개 범위: 공유 | 일반 | 블록'.
- 재구축: 사용자 `level`(없으면 13 registry 의 role·is_admin·status 로 위 이전 규칙), 자료 단계는 옛 값(public/private+min_role)도 이전 규칙으로.

### 3.8 화면

- 로그인: WorkBench 사번 한 칸. 세그먼트(로그인 | 가입 신청) → 가입 탭 대신 아래 안내 줄 'WorkBench 에 가입·승인된 사번으로 들어옵니다'. 오류 문구 4종.
- 계정 메뉴: 이름·사번·부서 + 'LV2 일반' 배지(+ 'WorkBench 관리자' 표시).
- 사용자 관리(LV3): WB 사용자 표(찾기 칸, 이름·사번·부서·등급 select·마지막 로그인). WB 관리자 행은 'LV3 관리자 · WorkBench 관리자 자동' 잠금, 나 자신은 배지.
  접히는 '등급 안내'. WB 표를 못 읽으면 오류 줄(무엇을 확인할지 — GRANT).
- Entry 상세 '공개 범위' 패널: 공유/일반/블록 세 단계(블록은 LV3 에게만 선택지) + 허락 목록(공유면 숨김). 블록된 자기 자료에는 '관리자가 블록한 자료입니다' 한 줄.
- DraftCard: '공개 범위' 기본 '일반'(LV1 의 초안도 일반 — LV1 은 자기 자료라 볼 수 있다).
- 검색 행·미리보기·호선 타임라인: '공유'·'블록' 배지(일반은 표시 없음). 볼 수 있는 사람에게만 실린다.
- 13 의 `lib/roles.js` → `lib/levels.js`, `components/access/*` 를 LV 체계로.

## 4. DB 변경

| 표 | 변경 | 방법 |
|---|---|---|
| users | `level INT NULL`, `wb_admin TINYINT(1) NOT NULL DEFAULT 0` 추가 | `ADDED_COLUMNS`(시작 때) + `migrate_levels()` |
| entries | `access` 값 public/private → shared/normal/blocked | `migrate_access()`(시작 때, 멱등). 열 정의 그대로 |
| entries | `analysis_period`, `private_min_role` | 남기고 쓰지 않는다 |
| (hitessworkbench.users) | 없음 — 읽기만 | |

13 의 `migrate_roles()` 는 더 부르지 않는다(15 의 등급 이전이 대신한다).

## 5. 테스트

- 백엔드 `tests/test_access_15.py`(13 매트릭스를 옮김): 단계 3종 × LV1/2/3 × (올린 사람·허락) — 상세·이력·파일·본문·lbm·썸네일·해석 검증·f06·링크,
  검색 목록·total·summary·facet·검색어·파일 보기·묶어 보기·정렬, browse, 호선, 즐겨찾기, 최근 비교, 같은 BDF, 태그·자동완성, 활동 로그, 휴지통,
  14 판 묶음/비교 404, SQL 거르개 = 한 건 판정. 권한 규칙(공유·허락 = 올린 사람+LV3, 블록 = LV3, 블록 자료는 올린 사람도 못 바꿈), 쓰기 표.
- `tests/test_wb_users_15.py`: WB 표 읽기 전용(실행된 SQL 중 WB 표에 닿는 것은 모두 SELECT, 모듈에 쓰기 구문 없음, Base 에 없음),
  로그인(없음 404·비활성 403·조회 실패 503·처음 LV1·이름 갱신), 세션 끊김(비활성화 → 다음 요청 401, 캐시 60초), WB 관리자 자동 LV3·내릴 수 없음,
  등급 지정 규칙, 이전 멱등(levels·access), CLI set-level·마지막 LV3, 재구축 후 등급·단계·허락, ops 상태.
- 해석 시기: 검색 정렬(최신순 기본·`period` 호환)·facet 없음·요약 띠 연도 없음·수정 API 가 값을 받지 않음·entry.json 에 없음.
- 프런트 vitest: `lib/levels.test.js`, AccessPanel·EntryPage.access·UsersPage·LoginPage·TopBar·결과 행·요약 띠·DraftCard·정렬.
- 실화면(시험 스택 9096/9097, `logbook_test` + 가짜 `wb_users`, 합성 9999/9001/9002, 1366·1920).

## 6. 남은 한계(예상)

- 앱 권한은 앱 안에서만(13 경고 그대로 — `999_LogBook` 폴더 권한은 IT).
- WB 비활성화가 반영되기까지 최대 60초(캐시). 즉시 끊으려면 LogBook 을 재시작하거나 캐시 시간을 줄인다.
- WB 표를 못 읽는 동안은 모든 요청이 503 이다(조용히 통과시키지 않는다는 요청 — 대신 운영 화면에 원인이 보인다).

## 7. 운영 반영 순서(145)

1. **GRANT** — MySQL root 로 한 번(계정 이름·호스트는 `backend\.env` 의 `LOGBOOK_DB_USER` 와 접속 호스트):
   ```sql
   GRANT SELECT ON hitessworkbench.users TO '<logbook 계정>'@'<호스트>';
   FLUSH PRIVILEGES;
   SHOW GRANTS FOR '<logbook 계정>'@'<호스트>';   -- 'GRANT SELECT ON `hitessworkbench`.`users`' 줄 확인
   ```
   확인: logbook 계정으로 `SELECT COUNT(*) FROM hitessworkbench.users WHERE is_active = 1;`
2. `git pull` → API·워커 재시작 → 시작 때 열 추가·등급 이전·단계 이전(로그 '추가한 열'에 `users.level`, `users.wb_admin`).
3. 관리자 화면 '운영' 에서 'WorkBench 사용자 표: 연결됨 · 활성 N명' 확인, '사용자' 에서 등급 확인.
   예전 관리자 → LV3, 예전 일반 사용자 → LV2, 처음 들어오는 WB 가입자 → LV1. 팀에 알릴 것: **처음 들어오는 사람은 공유 자료만 보인다**.

## 8. 결과 (2026-10-08)

### 테스트
- 백엔드 전체 pytest **833 passed**(1회차 832 passed + 1 failed — `test_revisions_14.test_access_rules` 가 13 등급 가정이라 15 규칙으로 옮긴 뒤 단독 재실행 통과, 19분).
  새 `test_access_15.py` 33건(13 매트릭스 이전: 등급 4종 + 올린 사람 × 자료 6종), `test_wb_users_15.py` 16건, `test_auth_api.py`·`test_users_api.py` 개편.
  `test_access_13.py` 는 지웠다(같은 검증을 15 매트릭스가 대신한다).
- 프런트 vitest **73 파일 / 488 테스트** 통과(`lib/roles*` → `lib/levels*`), `npm run build` 통과(dist 갱신, 파비콘 2개 포함).
- 실화면: 시험 스택 9096(`logbook_test` + 가짜 `wb_users`, 저장소 스크래치 `lv15`), Playwright **113 확인 0 실패**, 1366·1920, 스크린샷 `lv15/shots/` 29장.

### 바뀐·새 파일
- 새(백엔드): `app/wb_users.py`, `tests/test_access_15.py`, `tests/test_wb_users_15.py`. 지움: `tests/test_access_13.py`.
- 수정(백엔드): `config.py`(WB 표·캐시 설정), `models.py`(level·wb_admin·공개 단계 상수, `_sync_level`), `database.py`(열 2개, `migrate_levels`·`migrate_access`),
  `access.py`(LV·단계 규칙 전면), `roles.py`(`set_level`·`ensure_local_user`), `dependencies.py`(매 요청 WB 확인, WB 장애 때 열어 둘 경로),
  `schemas.py`, `routers/{auth,users,entries,solve,hulls,tags,search,admin_ops}.py`, `entries/{service,files}.py`, `search/{base,mysql_backend,insight}.py`,
  `hull_info.py`, `ops/{registry,rebuild,shortcut}.py`, `cli.py`(`set-level`), `main.py`(API 제목), `.env.example`, 테스트(conftest 가짜 표·`make_user`·검색/호선/registry/판 테스트).
- 새(프런트): `lib/levels.js`(+test), `assets/hitess-mark.png`, `public/favicon.png`·`favicon.ico`(WorkBench 사본). 지움: `lib/roles.js`(+test).
- 수정(프런트): `index.html`, `index.css`(`brand-mint`), `ui/Logo.jsx`, `pages/{LoginPage,EntryPage,HullPage,InboxPage,TagsPage,BrowsePage,SearchPage}.jsx`,
  `pages/admin/{UsersPage,OpsPage}.jsx`, `components/access/AccessPanel.jsx`, `components/search/{ResultList,ResultSummary,FacetPanel,EntryPreviewPanel}.jsx`,
  `components/inbox/DraftCard.jsx`, `components/preview/SolveCheckCard.jsx`, `components/shell/{TopBar,GlobalDrop}.jsx`, `auth/AuthContext.jsx`,
  `lib/{labels,search,entryEdit}.js` + 테스트.
- 문서: 이 계획서, `docs/plans/README.md`, `DESIGN.md`(§0 이름과 로고, `brand-mint`), `PRODUCT.md`, `README.md`(WorkBench 사용자 표·GRANT).

### 검증 중 판단·발견
- WB 표를 못 읽을 때 모든 요청을 503 으로 막으면 관리자도 원인을 볼 수 없다 → 로그아웃은 누구나, `/auth/me`·`/admin/ops/status` 는 마지막으로 확인된 LV3 만 통과시켰다(그 밖은 503).
- 해석 검증 단추: 파일 카드는 올린 사람을 모르므로 LV1 에게도 단추를 열어 두고, 남의 자료면 서버 403 `level2_required` 문구를 보인다.
- ⚠ 시험 스택 워커가 '매일 작업'으로 `logbook_test` 의 실제 mysqldump 를 한 번 돌렸다(스크래치 `lv15/80_Backup` 에 5.5KB). 시험 DB 덤프라 운영 자료는 없고,
  로그에 비밀번호는 남지 않았다(확인). 파일은 지웠다. 다음 시험 스택은 워커 없이 API 만 띄우거나 `LOGBOOK_MYSQLDUMP` 를 없는 경로로 둘 것.

### 남은 한계
- §6 그대로. 내려받기 링크(짧은 토큰)는 발급 뒤 WB 비활성화를 확인하지 않는다(LogBook 행 status 만 본다 — 링크 수명 동안).
- 13 운영 배포 전이라 13 의 Master·비공개 데이터는 개발 DB 에만 있었다. 이전 규칙은 §3.3·§3.4.
