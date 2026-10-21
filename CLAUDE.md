# LogBook — 작업 규칙

Hi-TESS LogBook(구조해석 자료 창고). 무엇·어떻게 쓰는지는 `README.md`, 설계는 `docs/specs/2026-09-28-logbook-design.md`, 기능별 계획·현황은 `docs/plans/`.
말하는 방식·커밋 원칙은 전역 규칙을 따른다.

## 구조
- `backend/` FastAPI + SQLAlchemy(MySQL) — 가상환경 `backend\.venv`, 관리 명령 `python -m app.cli <명령>`.
- `frontend/` React + Vite + Tailwind, 테스트 vitest, 관계 지도는 d3 캔버스.

## 검사
- 백엔드: `backend\.venv\Scripts\pytest.exe -q`(전체 약 15분). 고친 곳만 먼저 돌리고 전체는 끝에 한 번.
- 프런트: `cd frontend; npm test` → `npm run build`.

## 규칙
- **프런트를 고치면 `npm run build` 후 `frontend/dist` 도 커밋한다** — 145 에는 Node 가 없고 dist 를 그대로 쓴다.
- **테스트 DB `logbook_test` 는 모든 세션이 같이 쓴다.** 다른 세션이 pytest 를 돌리는 중이면 기다린다(동시에 돌리면 잠겨서 멈춘다). 멈췄다고 중간에 끊으면 표 지우기가 반쯤 끝나 다음 실행이 `Can't DROP ...` 로 실패한다 → `SET FOREIGN_KEY_CHECKS=0` 후 `logbook_test` 의 표를 모두 DROP 하고 다시 돌린다(2026-10-19).
- **작업 폴더도 여러 세션이 같이 쓴다** — 커밋할 때 `git add -A` 금지, 이 세션이 고친 파일만 골라 add 하고 커밋 전에 `git status` 로 확인한다(2026-10-19 다른 세션의 39 미커밋 작업이 섞여 푸시됨).
- 스키마를 바꾸는 테스트에는 `@pytest.mark.fresh_schema`(README '개발 PC' 끝).
- 계획 문서는 `docs/plans/YYYY-MM-DD-logbook-NN-<주제>.md`, 번호는 `docs/plans/README.md` 표에 올린다. 다른 계획이 미리 잡아 둔 번호(예: 32 가 33·34 예약)는 건너뛴다.
- **사용자에게 보이는 기능·개선을 끝내면 `backend/app/changelog/changelog.json` 의 `items` 맨 앞에 한 줄 더한다**(날짜·계획 번호·분류·제목·한 문장 요약). 관리자가 `/updates` 에서 본다(46, 2026-10-22).
- 개발 PC 는 사내 PLM 에 닿지 않는다 — PLM 실제 조회는 145 에서 확인한다(README '사내 PLM 선박 정보 (30)').
- **로그인은 사번만(비밀번호 없음)으로 둔다** — WorkBench 도 사번만이라 LogBook 만 막아도 `/sso` 로 우회되고, 직접 주소 접속도 열어 둔다(2026-10-20 결정). 본인 확인을 붙이려면 Hi-TESS 전체(`hitess-core`)에서 다룬다.

## 배포 (145)
개발 PC 에서 커밋·푸시 → 145 Server Manager ⟳ Update(git pull · requirements 바뀌면 pip install · 재시작).
145 는 Server Manager 한 창이 API·Worker·보고서 색인 워커를 띄운다(작업 스케줄러 없음, 41). `server_manager.py`·`serverguard/` 를 바꾼 업데이트는 Update 뒤 **창을 X 로 닫고 다시 열도록** 알린다(Update 는 창 메모리의 옛 코드로 다시 띄운다).
`backend\.env` 는 git 밖이라 Update 로 바뀌지 않는다 — 새 설정 키가 생기면 145 `.env` 에 손으로 넣도록 알린다. 처음 설치·설정은 README '145 서버'.
