# LogBook — 작업 규칙

Hi-TESS LogBook(구조해석 자료 창고). 무엇·어떻게 쓰는지는 `README.md`, 설계는 `docs/specs/2026-09-28-logbook-design.md`, 기능별 계획·현황은 `docs/plans/`.
말하는 방식·커밋 원칙은 전역 규칙을 따른다.

## 구조
- `backend/` FastAPI + SQLAlchemy(MySQL) — 가상환경 `backend\.venv`, 관리 명령 `python -m app.cli <명령>`.
- `frontend/` React + Vite + Tailwind, 테스트 vitest, 관계 지도는 d3 캔버스.
  - **화면 이름(2026-11-18 설명회 전 결정)**: 메뉴 '살펴보기' → **자료 현황**, '선례 찾기' → **비슷한 모델 찾기**, '정리 대기' → **올리기와 확정**,
    탭 '내 배치' → **내가 올린 묶음**, '손볼 자료' → **보완할 자료**(문서 없는 모델 · 모델 없는 문서 · 검증 실패 · 분류 보완 · 서명 없음 다섯 종류),
    '주인 없는 배치' → **폴더에 직접 넣은 묶음**. 화면 글자의 '배치' 는 '묶음' 으로, 초안 **상태** 이름은 '확정 전'(장소 이름과 구분).
    옛 이름으로 되돌리지 말 것. 주석·서버 설명글·변경 이력(changelog.json)은 옛 이름 그대로 둔다(화면에 안 보임 · 과거 기록).
    탭 제목은 `lib/pageTitle.js` 한 곳 — 메뉴 이름을 바꾸면 같이. 설명회 데모는 `npm run demo` 로 다시 만든다(데모 메뉴 `demo/DemoShell.jsx`).
  - 같은 날 다듬기: 최근 비교는 계정 메뉴로(바구니가 비면 떠 있는 단추 없음) · 활동 코드 라벨 누락은 `labels.test.js` 가 서버 코드와 대조해 잡는다 ·
    BDF 범례는 1280px 미만이면 접힌 채로 연다 · 자료 검색이 비면 '문서 본문에서 찾기' 링크. 기록 `.impeccable/critique/2026-11-18T06-15-00Z__logbook-frontend.md`.
  - 관계 지도 첫 열기 30초(2026-11-18 신고) = 서버 재시작 뒤 보고서 본문 특징(MinHash·평균 벡터, 메모리 캐시뿐)을 232건 모두 계산하던 것. 이제 서버 시작 때 백그라운드 스레드가 미리 계산한다(`report_index.features.warm`, `main._start_report_features_warmup`, 끄기 `LOGBOOK_GRAPH_WARMUP=0`). 재시작 직후 약 30초 안에 열면 그만큼은 기다린다. 더 줄이려면 MinHash 를 한 순열 방식으로 바꾸는 안(약 10배)이 남아 있다 — 지도 결과 값이 조금 바뀌어 보류.
  - **파일 이름 검색 규칙(2026-11-18, 'post' 로 찾으면 권상 자료 28건이 나온 신고)**: 파일 이름은 부분 일치라 권상 보조 파일(`…_posture.json`, 종류 '기타')이 낱말 안에서 걸렸다. 이제 보조 파일(`.json`·`.csv`, `SIDECAR_EXTS`)의 이름 적중은 **파일 보기에서만** 찾고 자료 보기 결과에는 올리지 않는다(`search/mysql_backend.py` `_Hits.side`·`for_unit`). 종류 '기타' 전체로 넓히지 말 것 — `.hm`·`.fem`·`.inp`·`.stp`·`.zip` 이름으로 자료를 못 찾게 된다(커밋 전 리뷰). 자료 보기 행에는 이름이 맞은 파일을 `matched_files`(최대 3개)로 싣고 카드가 '파일 이름 …' 줄로 보인다(`ResultList.jsx`). 시험 `tests/test_search_sidecar_names.py`.
  - **사용 설명서(2026-11-20)**: 웹판 = `frontend/public/manual/index.html`(한 파일 HTML). 위쪽 바 [설명서 보기] 단추와 계정 메뉴 '사용 설명서'는 새 탭이 아니라 **오른쪽 패널**(`ManualPanel.jsx`)로 연다. 처음 폭은 화면의 절반(30~85%, 비율로 기억, 사용자 결정 — 가려지면 닫고 본다). 넓으면 A4 쪽 그대로, 760px 이하로 좁히면 설명서 HTML 의 웹판 배치(A4 틀을 풀고 글을 다시 흘림)로 바뀐다 — 설명서를 다시 만들 때 이 배치와 `data-sec` 구역 이름, `postMessage({manualSection})` 를 지킬 것. 화면별 구역은 `TopBar.jsx` `manualSection`, PDF 는 따로 배포. 원본은 이 저장소가 아니라 WorkBench `outputs/LB-manual/source`(회사 PC 로컬, 설명서 전용 DB `logbook_manual` + 가상 자료로 찍음, `node make.mjs LB`). 화면 이름이나 올리기 절차를 바꾸면 설명서도 다시 만들고 이 파일을 갈아 끼운다. 내용은 핵심 위주로(사용자 지시).

## 검사
- 백엔드: `backend\.venv\Scripts\pytest.exe -q`(전체 약 15분). 고친 곳만 먼저 돌리고 전체는 끝에 한 번.
- 프런트: `cd frontend; npm test` → `npm run build`.

## 규칙
- **프런트를 고치면 `npm run build` 후 `frontend/dist` 도 커밋한다** — 145 에는 Node 가 없고 dist 를 그대로 쓴다.
- **테스트 DB `logbook_test` 는 모든 세션이 같이 쓴다.** 다른 세션이 pytest 를 돌리는 중이면 기다린다(동시에 돌리면 잠겨서 멈춘다). 멈췄다고 중간에 끊으면 표 지우기가 반쯤 끝나 다음 실행이 `Can't DROP ...` 로 실패한다 → `SET FOREIGN_KEY_CHECKS=0` 후 `logbook_test` 의 표를 모두 DROP 하고 다시 돌린다(2026-10-19).
- **작업 폴더도 여러 세션이 같이 쓴다** — 커밋할 때 `git add -A` 금지, 이 세션이 고친 파일만 골라 add 하고 커밋 전에 `git status` 로 확인한다(2026-10-19 다른 세션의 39 미커밋 작업이 섞여 푸시됨).
  - **dist 도 섞인다** — 다른 세션의 미커밋 프런트 변경이 있으면 `npm run build` 결과에 그 코드가 들어가 145 에 배포된다. 그때는 `git worktree add --detach <scratchpad>\wt HEAD` 로 깨끗한 사본을 만들고 이 세션이 고친 파일만 복사해 거기서 테스트·빌드한 뒤 그 `frontend/dist` 를 가져와 커밋한다(node_modules 는 junction, 끝나면 junction 부터 지우고 `git worktree remove`)(2026-11-06, 55·56 배포 때).
- **사이드 메뉴를 늘리지 않는다** — 새 화면은 기존 메뉴 아래 위쪽 탭(`components/shell/SectionTabs.jsx`, 살펴보기·관리가 이 방식)이나 화면 안 단추로 넣는다. 메뉴는 8개 + 관리 1개(51, 2026-11-05 에 7개 → 2026-11-19 사용자 결정으로 '나의 메모'(64)를 더해 8개 — 날마다 따로 찾아 들어가는 개인 노트라 예외).
- **알려진 결함(2026-11-20 설명서 촬영 중 발견, 미해결)**: 올린 직후 확정하면 워커 처리와 겹쳐 MySQL 1213 교착으로 확정이 500 을 낸다(다시 누르면 됨, 설명서 `lbapi.py confirm` 은 재시도로 피함). 활동 기록에 검토 서명자가 이름 대신 사번으로 보이는 경우가 있다(원인 미확인).
- 스키마를 바꾸는 테스트에는 `@pytest.mark.fresh_schema`(README '개발 PC' 끝).
- 계획 문서는 `docs/plans/YYYY-MM-DD-logbook-NN-<주제>.md`, 번호는 `docs/plans/README.md` 표에 올린다. 다른 계획이 미리 잡아 둔 번호(예: 32 가 33·34 예약)는 건너뛴다. 다른 세션이 커밋 전에 번호를 잡았을 수 있으니 문서를 만들기 직전에 `docs/plans` 폴더와 표를 다시 본다(2026-11-05 — 52 가 두 세션에서 겹쳐 결론·검토 서명을 53 으로 옮김).
- **개발 이력(업데이트 이력)** = `backend/app/changelog/changelog.json`, 관리자가 관리 › 업데이트 이력(`/admin/updates`)에서 본다(46).
  사용자가 **"변경사항 기록해" · "업데이트 이력 작성해" · "개발 이력에 등록해"** 라고 하면 지난 기록 뒤의 커밋을 보고 이 파일의 `items` 맨 앞에 더한다(2026-10-22 지시).
  - **큰 범주로만 적는다.** 한 항목 = 사용자가 체감하는 기능 하나·개선 묶음 하나(보통 하루 1~3건). 같은 기능의 후속 수정·문구 손질·버그 수정·리팩터링·테스트·문서·데모·빌드 커밋은 따로 적지 않고 그 기능 항목에 합친다(필요하면 `points` 한 줄).
  - 이미 있는 항목의 후속이면 새 항목 대신 그 항목의 `summary`·`points` 를 고친다. 제목은 주간 보고에 쓸 수준의 한 줄, `summary` 는 사용자에게 무엇이 좋아졌는지 한 문장.
  - 날짜는 실제 커밋일, 요청자가 있으면 `requester`, `status` 는 배포 뒤에도 실제로 남은 일(예: 145 `.env` 키)이 있을 때만. 화면 문구에 em dash 금지(테스트가 잡는다).
  - 끝나면 커밋·푸시 → 145 Update 로 반영(프런트 빌드 불필요). 요청 없이는 이 파일을 고치지 않는다.
- 개발 PC 는 사내 PLM 에 닿지 않는다 — PLM 실제 조회는 145 에서 확인한다(README '사내 PLM 선박 정보 (30)').
- **로그인은 사번만(비밀번호 없음)으로 둔다** — WorkBench 도 사번만이라 LogBook 만 막아도 `/sso` 로 우회되고, 직접 주소 접속도 열어 둔다(2026-10-20 결정). 본인 확인을 붙이려면 Hi-TESS 전체(`hitess-core`)에서 다룬다.

## 배포 (145)
개발 PC 에서 커밋·푸시 → 145 Server Manager ⟳ Update(git pull · requirements 바뀌면 pip install · 재시작).
145 는 Server Manager 한 창이 API·Worker·보고서 색인 워커를 띄운다(작업 스케줄러 없음, 41). `server_manager.py`·`serverguard/` 를 바꾼 업데이트는 Update 뒤 **창을 X 로 닫고 다시 열도록** 알린다(Update 는 창 메모리의 옛 코드로 다시 띄운다).
`backend\.env` 는 git 밖이라 Update 로 바뀌지 않는다 — 새 설정 키가 생기면 145 `.env` 에 손으로 넣도록 알린다. 처음 설치·설정은 README '145 서버'.

## 145 데이터 검증 (사용자가 요청할 때만)
"145 데이터 검증해 / 분류 제대로 됐는지 봐" 같은 요청이면 개발 PC 에서 145 운영 자료를 점검·정리한다(2026-11-05 첫 실행 — 분류 5건 채움, 중복 1건 휴지통).
- **API 로만 한다** `http://10.14.42.145:9095` — 관리자 사번 `/api/auth/login`(사번만) → Bearer 토큰 → 끝나면 `/api/auth/logout`. MySQL 직접 수정 금지(145 계정은 localhost 전용이라 접속도 안 되고, 고치면 `entry.json`·감사 기록과 어긋난다). 공유 폴더도 손대지 않는다.
- **읽기**: `/api/search?drafts=true&limit=200`(전체 자료) · `/api/vocab?kind=zone|target`(분류 목록) · `/api/vocab/unlisted?kind=…`(목록 밖 값) · `/api/admin/cleanup/titles`(제목 정리 후보) · `/api/entries/{id}`(파일·sha256).
- **볼 것**: 호선 없음인데 공용(`no_hull`) 아님 · 구역/대상 빠짐 · 목록 밖 분류 값 · 같은 sha256 파일의 중복 자료 · 제목과 분류 어긋남 · PLM 선종 빈 호선. `/api/admin/cleanup/missing` 은 BDF 자료의 호선만 보므로 이것만 믿지 않는다.
- **고치기**: 결과를 표로 보고하고 승인받은 뒤 `POST /api/entries/bulk-classify` — 먼저 `dry_run: true`, 적용 뒤 다시 읽어 확인. 중복은 sha256 재확인 후 `DELETE /api/entries/{id}`(휴지통, 복원 가능). 영구 삭제는 하지 않는다. 임시 스크립트는 scratchpad 에 둔다.
