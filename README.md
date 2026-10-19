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
   `PLM_ORACLE_LIB_DIR`(145 의 PLM 은 10G password verifier 라 Oracle Client 폴더를 주는 thick mode 가 필요하다).
3. 서버 재시작 → 호선 화면에서 [선박 정보 검색]. 처음 한 번은 `.venv\Scripts\python.exe -m app.cli plm-fill` 로 기존 호선을 모두 채운다.

접속이 안 되면 `.venv\Scripts\python.exe -m app.cli plm-check 3370` — 모드(thin/thick)·`TNS_ADMIN`·별칭이 가리키는 tnsnames 항목을 보이고 한 번 조회해 본다(WorkBench `scripts\inspect_plm_hull_tables.py` 결과와 견준다).

비워 두면 기능만 꺼진다(단추를 누르면 'PLM 접속 정보가 설정되지 않았습니다'). 개발 PC 는 PLM 에 닿지 않아 늘 이 상태다.

## 등급 정리 · WorkBench 연동 (31)

관리자가 아닌 사람은 LV1(게스트 — 공유·허락받은 자료·자기 자료만)로 둔다. 145 에서 한 번:
`.venv\Scripts\python.exe -m app.cli level-guest` 로 대상을 보고 `level-guest --apply`. WorkBench 관리자는 자동 LV3, LogBook 에서 LV3 로
지정한 사람도 그대로다. WorkBench 사용자 관리 표의 'LogBook' 열은 `/api/integration/levels`(공유 비밀키)를 읽어 보여 준다.

## 운영 참고 (145)

- **uvicorn 실행 계정 권한**: 145 에서 `uvicorn app.main:app` 을 실행하는 Windows 계정은 `999_LogBook` UNC 경로(`\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`)에 **쓰기 권한**이 있어야 한다. 없으면 폴더 구조 생성(`ensure_layout`)·업로드·감사 로그 JSONL 기록이 조용히 실패한다(DB 기록은 남지만 파일 기록은 경고 로그만 남고 사라짐 — `app/audit.py` 참고).
- **`logbook_test` 는 개발 PC 전용**이다. 145 운영 서버에는 만들 필요가 없다(위 SQL 참고, `create_db.py` 도 145 에서는 실행하지 않는다). 테스트는 개발 PC 에서만 돌린다.
- **재부팅 시 자동 시작은 아직 설정돼 있지 않다.** 145 를 재부팅하면 `uvicorn` 을 수동으로 다시 실행해야 한다. Windows 서비스 등록/자동 시작은 이후 계획(05)에서 다룰 예정.
