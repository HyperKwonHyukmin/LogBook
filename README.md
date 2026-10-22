# Hi-TESS LogBook — 구조해석 항해일지

구조해석 모델(BDF)·결과·보고서를 호선·선종·구역으로 묶어 보관·검색·확인하는 팀 자료 창고. Hi-TESS(구조 해석 도구 묶음)의 한 갈래다.

- **사용자 = HiTESS WorkBench 가입자**(15). 같은 MySQL 의 `hitessworkbench.users` 를 **읽기만** 한다 — logbook DB 계정에 `GRANT SELECT ON hitessworkbench.users` 가 필요하다(아래 'WorkBench 사용자 표'). 자체 가입은 없고, 처음 들어오면 LV1(게스트)이다. WorkBench 관리자는 자동 LV3.

- 설계: `docs/specs/2026-09-28-logbook-design.md` · 계획: `docs/plans/` · WorkBench 재사용 목록: `docs/reuse-inventory.md`
- 데이터 원본: `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`
- 서버: 10.14.42.145:9095 (개발 PC 에서 개발·테스트 → 커밋·푸시 → 145 에서 `git pull`)

## 개발 PC

MySQL 에 전용 계정 `logbook_app` 을 만든다(WorkBench 의 `admin` 계정을 공유하지 않는다 — 2026-09-29 사용자 결정). root 로 한 번만 실행:

```sql
CREATE USER IF NOT EXISTS 'logbook_app'@'localhost' IDENTIFIED BY '<비밀번호>';
CREATE DATABASE IF NOT EXISTS logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS logbook_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON logbook.* TO 'logbook_app'@'localhost';
GRANT ALL PRIVILEGES ON logbook_test.* TO 'logbook_app'@'localhost';
FLUSH PRIVILEGES;
```

그다음:

    cd backend
    py -3.11 -m venv .venv
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    Copy-Item .env.example .env          # LOGBOOK_DB_USER=logbook_app, LOGBOOK_DB_PASSWORD 입력
    .venv\Scripts\python.exe scripts\create_db.py
    .venv\Scripts\pytest.exe -q

    cd ..\frontend
    npm install
    npm test
    npm run build                         # dist 는 커밋한다(145 에 Node 불필요)

    cd ..\backend
    .venv\Scripts\python.exe -m app.cli create-admin <사번> <이름> [부서]   # WorkBench 관리자가 아니면서 LV3 가 필요할 때만
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095

프론트 개발 서버(핫 리로드)는 `cd frontend; npm run dev` → http://localhost:5180 (/api 는 9095 로 전달).

백엔드 테스트 DB(`logbook_test`) 초기화 방식(`backend/tests/conftest.py`): 스키마는 pytest 세션 시작 때 한 번만
만들고, 테스트 사이에는 손댄 표의 데이터만 비운다(DELETE + `AUTO_INCREMENT=1`, FULLTEXT 표는 TRUNCATE — id 는
새 표처럼 1번부터). 전체 실행 ~29분 → ~4.5분. **스키마를 바꾸는 테스트**(ALTER TABLE·DROP INDEX·일부 표 drop 후
`init_schema` 등)에는 `@pytest.mark.fresh_schema` 를 단다 — 그 테스트만 앞뒤로 drop_all/create_all 한다.
표시를 빠뜨리면 테스트 끝에 스키마 지문을 비교해 표를 다시 만들고 "fresh_schema 를 달 것" 경고를 남긴다.

## 145 서버 (첫 배포)

145 의 MySQL 에도 같은 전용 계정을 만든다(개발 PC 와 동일한 SQL — WorkBench `admin` 계정을 쓰지 않는다). root 로 한 번만 실행:

```sql
CREATE USER IF NOT EXISTS 'logbook_app'@'localhost' IDENTIFIED BY '<비밀번호>';
CREATE DATABASE IF NOT EXISTS logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON logbook.* TO 'logbook_app'@'localhost';
FLUSH PRIVILEGES;
```

`logbook_test` 는 145 에 만들지 않는다 — 테스트 실행용 DB 라 **개발 PC 에서만** 필요하다. `scripts/create_db.py`
는 `logbook`·`logbook_test` 둘 다 무조건 만들려 하므로(위 SQL 은 `logbook.*` 에만 권한을 줬다), **145 에서는
이 스크립트를 실행하지 않는다** — 위 SQL 로 `logbook` 은 이미 만들어졌으니 곧바로 다음 단계로 간다.

그다음:

    git clone https://github.com/HyperKwonHyukmin/LogBook.git
    cd LogBook\backend
    python -m venv .venv                  # Python 3.10 이상
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    Copy-Item .env.example .env           # LOGBOOK_DB_USER=logbook_app, LOGBOOK_DB_PASSWORD 입력
    .venv\Scripts\python.exe -m app.cli create-admin <사번> <이름>
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095

업데이트: `git pull` 후 서버 재시작. 첫 배포 점검: 팀원 PC 에서 http://10.14.42.145:9095 접속(안 되면 145 방화벽 9095 인바운드 허용), 화면 좌측 하단 "999_LogBook 연결됨" 확인.

## WorkBench 사용자 표 (15)

LogBook 은 로그인·매 요청 확인에 WorkBench 의 users 표를 **SELECT 만** 한다(INSERT·UPDATE·DDL 없음 — `tests/test_wb_users_15.py` 가 고정).
표 이름은 `LOGBOOK_WB_USERS_TABLE`(기본 `hitessworkbench.users`), 활성 여부 캐시는 `LOGBOOK_WB_CACHE_SECONDS`(기본 60초). root 로 한 번:

```sql
GRANT SELECT ON hitessworkbench.users TO '<logbook 계정>'@'<호스트>';
FLUSH PRIVILEGES;
SHOW GRANTS FOR '<logbook 계정>'@'<호스트>';
```

확인: 관리자 화면 '운영' 의 'WorkBench 사용자 표' 가 '연결됨 · 활성 N명'. 권한이 없으면 로그인이 'WorkBench 사용자 정보를 읽을 수 없습니다'(503)로 실패한다.
개발 PC 테스트는 `logbook_test` 안의 가짜 표 `wb_users`(conftest 가 만든다)를 쓴다 — 실제 `hitessworkbench` 에 접속하지 않는다.

## 사내 PLM 선박 정보 (30)

호선 화면 [선박 정보 검색]·호선 목록 [선종 채우기(PLM)]·확정 때 자동 조회는 사내 PLM(`VT_PLM_SHIP`)을 **LogBook 이 직접** 읽는다
(WorkBench 가 꺼져 있어도 된다). 145 에서 한 번:

1. Server Manager ⟳ Update — `requirements.txt` 에 `oracledb` 가 새로 들어와 Update 가 pip install 까지 한다(수동이면 `.venv\Scripts\python.exe -m pip install -r requirements.txt`).
2. `.env` 에 WorkBench `.env` 의 같은 이름 줄을 그대로 옮긴다: `PLM_ORACLE_DSN` · `PLM_ORACLE_USER` · `PLM_ORACLE_PASSWORD` ·
   `PLM_ORACLE_LIB_DIR`(145 의 PLM 은 10G password verifier 라 Oracle Client 폴더를 주는 thick mode 가 필요하다) ·
   **`TNS_ADMIN`**(별칭 `HIPLM` 을 풀 tnsnames.ora 폴더 — 빠지면 다른 tnsnames 의 옛 주소로 가서 `ORA-12541 No listener`).
3. 서버 재시작 → 호선 화면에서 [선박 정보 검색]. 처음 한 번은 `.venv\Scripts\python.exe -m app.cli plm-fill` 로 기존 호선을 모두 채운다.
   시리즈 호선(45, 2026-10-21): PLM 선행호선이 같은 호선은 검색 · 관계 지도 · 갖춤 현황에서 한 묶음이다. 시리즈는 자동으로 채운다 — 워커가 시작할 때 · 자료를 올리고 확정할 때 시리즈를 아직 안 본 호선과 같은 시리즈 호선(자료 없는 것 포함)을 PLM 에서 읽는다. 바로 채우려면 `plm-fill --series`.

접속이 안 되면 `.venv\Scripts\python.exe -m app.cli plm-check 3370` — 모드(thin/thick)·`TNS_ADMIN`·별칭이 가리키는 tnsnames 항목을 보이고 한 번 조회해 본다(WorkBench `scripts\inspect_plm_hull_tables.py` 결과와 견준다).

비워 두면 기능만 꺼진다(단추를 누르면 'PLM 접속 정보가 설정되지 않았습니다'). 개발 PC 는 PLM 에 닿지 않아 늘 이 상태다.

## 등급 정리 · WorkBench 연동 (31)

관리자가 아닌 사람은 LV1(게스트 — 공유·허락받은 자료·자기 자료만)로 둔다. 145 에서 한 번:
`.venv\Scripts\python.exe -m app.cli level-guest` 로 대상을 보고 `level-guest --apply`. WorkBench 관리자는 자동 LV3, LogBook 에서 LV3 로
지정한 사람도 그대로다. WorkBench 사용자 관리 표의 'LogBook' 열은 `/api/integration/levels`(공유 비밀키)를 읽어 보여 준다.

자료의 변경 이력에는 자료 내용 변경만 남긴다. **열람 허락·회수는 기록하지 않는다**(2026-10-20 결정). 지금 누가 허락받았는지는 자료 화면의 허락 목록이 보여 준다.
예전 기록은 `.venv\Scripts\python.exe -m app.cli audit-purge-grants` 로 건수를 보고 `--apply` 로 지운다. DB 와 공유 폴더 감사 파일(`90_System\audit\*.jsonl`) 둘 다 지우므로 재구축해도 돌아오지 않는다.

## WorkBench 해석 출처 (39, Hi-TESS Core 1단계)

WorkBench 관리자가 All Projects 에서 해석 1건을 보내면 자료 화면 속성 칸 '출처'에 `WB #번호`·프로그램·해석자·일시와
'WB 산출물과 같음'(해석 여권 sha256 대조)이 보인다. 검색창에 `WB #번호` 로도 찾는다. 145 `.env` 두 곳에 키가 있어야 한다(2026-10-19 넣음):
LogBook `LOGBOOK_WB_ORIGIN_SHOW=1`(화면·검색), WorkBench `LOGBOOK_SEND_PASSPORT=1`(여권 싣기). 비우고 재시작하면 꺼진다(출처 저장은 늘 한다).
두 플랫폼 사이 약속은 `hitess-core` 저장소(`docs/02-current-links.md`·`docs/03-safety.md`) — 연동을 바꾸기 전에 먼저 본다.

## 구역·대상 (40)

분류 두 칸은 뜻이 다르다. **구역 = 배 안의 위치**(선수부·기관실·거주구, 여럿), **대상 = 해석한 구조물·모델 단위**(전선 모델·블록·Unit·Truss, 하나).
같은 값을 두 목록에 두지 않는다. BDF 자료는 구역 **또는** 대상 중 하나만 있으면 확정된다(위치 없는 Unit·Truss 모델은 대상만).
WorkBench 보내기 규칙도 대상으로 정한다(기본: Truss = 대상 'Truss' 또는 태그 'Truss').
구역 목록에 잘못 들어간 구조물 값은 145 에서 보고서를 본 뒤 옮긴다:
`.venv\Scripts\python.exe -m app.cli vocab-move zone Unit target` → 확인 후 같은 명령에 `--apply`.
이미 다른 대상이 있는 자료는 옮기지 않고 보고만 한다(그 자료의 구역 값은 '목록 밖 값'으로 남으니 관리 › 분류 목록에서 정리).

42 — **해석 종류는 없앴다**(필수 칸·제목·검색·분류 목록 모두. DB 열·옛 값은 남지만 읽지 않는다). 분류 목록에서 구역·대상 용어를 **지우면**
그 값(동의어 포함)을 단 자료에서도 함께 빠진다(`DELETE /api/vocab/terms/{id}`, 확정 자료는 이력·entry.json). 이름 바꾸기는 전부터 자료 전부에 반영된다.

## 담당자 · 업데이트 이력 (46)

**담당자 = 과제를 한 사람**, 올린 사람(작성자)과 따로다. 정리 대기 카드·자료 상세 [변경하기]의 '담당자' 칸에서
WorkBench 사용자를 찾아 넣거나, 없으면 [직접 입력]으로 이름·부서·직책·재직을 넣어 **담당자 명부**(`people`)에 만든다. 여러 명, 첫 사람이 주 담당자.
퇴사 표시는 명부 한 곳(연필 단추, LV2 이상 — 바로 저장)에서 하면 그 사람의 모든 자료에 보인다. 검색창에 담당자 이름·사번을 치면 그 자료가 나온다.
entry.json `assignees`(사람 정보 사본)가 재구축 원천이다.

**업데이트 이력** — `http://<서버>/updates`(관리 메뉴 '업데이트 이력'). LV3 로 로그인한 브라우저에서만 내용이 보인다(내용은 `/api/admin/updates`).
항목은 `backend/app/changelog/changelog.json` 의 `items` 맨 앞에 더한다(프런트 빌드 불필요 — 145 Update 로 바로 바뀐다).
기간은 두 단 — 전체·최근 7일·최근 30일·해(2026년), 아래 단은 보고 있는 해의 달. 주소 `?period=2026`·`?period=2026-10` 으로 공유한다. 요청자가 있으면 `requester`('요청 김도현 선임'). 운영 서버(145) 확인이 남은 항목은 `status: "운영 확인 전"`, 확인하면 지운다.

## 운영 참고 (145)

- **uvicorn 실행 계정 권한**: 145 에서 `uvicorn app.main:app` 을 실행하는 Windows 계정은 `999_LogBook` UNC 경로(`\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`)에 **쓰기 권한**이 있어야 한다. 없으면 폴더 구조 생성(`ensure_layout`)·업로드·감사 로그 JSONL 기록이 조용히 실패한다(DB 기록은 남지만 파일 기록은 경고 로그만 남고 사라짐 — `app/audit.py` 참고).
- **서버 관리자 [API] 로그의 `ConnectionResetError: [WinError 10054]`**(`_ProactorBasePipeTransport._call_connection_lost`)는 무해하다(2026-10-19 확인).
  응답이 끝난 뒤 브라우저·WorkBench 가 먼저 연결을 끊었을 때(탭 닫기·새로고침·화면 이동) Windows Python asyncio 가 정리 단계에서 남기는 기록이다.
  2026-10-20 부터 `app/main.py` 의 `_quiet_connection_reset` 가 이 한 종류만 걸러 [API] 로그에 남지 않는다(다른 예외는 그대로).
- **`logbook_test` 는 개발 PC 전용**이다. 145 운영 서버에는 만들 필요가 없다(위 SQL 참고, `create_db.py` 도 145 에서는 실행하지 않는다). 테스트는 개발 PC 에서만 돌린다.
- **145 는 Server Manager**(`Logbook_Server.bat`)가 API·Worker·보고서 색인 워커를 띄운다(41). 자동 시작은 로그온 때만이라, 145 를 재부팅하면 그 계정으로 한 번 로그온해야 한다. 작업 스케줄러 방식과 함께 쓰지 않는다 — `ops/README.md` 6절.
