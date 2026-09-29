# Logbook — 구조해석 항해일지

구조해석 모델(BDF)·결과·보고서를 호선·선종·구역으로 묶어 보관·검색·확인하는 팀 자료 창고.

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
    .venv\Scripts\python.exe -m app.cli create-admin <사번> <이름> [부서]
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9095

프론트 개발 서버(핫 리로드)는 `cd frontend; npm run dev` → http://localhost:5180 (/api 는 9095 로 전달).

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

## 운영 참고 (145)

- **uvicorn 실행 계정 권한**: 145 에서 `uvicorn app.main:app` 을 실행하는 Windows 계정은 `999_LogBook` UNC 경로(`\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`)에 **쓰기 권한**이 있어야 한다. 없으면 폴더 구조 생성(`ensure_layout`)·업로드·감사 로그 JSONL 기록이 조용히 실패한다(DB 기록은 남지만 파일 기록은 경고 로그만 남고 사라짐 — `app/audit.py` 참고).
- **`logbook_test` 는 개발 PC 전용**이다. 145 운영 서버에는 만들 필요가 없다(위 SQL 참고, `create_db.py` 도 145 에서는 실행하지 않는다). 테스트는 개발 PC 에서만 돌린다.
- **재부팅 시 자동 시작은 아직 설정돼 있지 않다.** 145 를 재부팅하면 `uvicorn` 을 수동으로 다시 실행해야 한다. Windows 서비스 등록/자동 시작은 이후 계획(05)에서 다룰 예정.
