# Logbook 145 서버 설치·운영 안내

145 서버(10.14.42.145)에서 Logbook 을 혼자 돌아가게 하는 절차다. API(포트 9095)·워커·보고서 색인 워커(22) 세 프로세스를
**Server Manager**(`backend\server_manager.py`, `Logbook_Server.bat`) 한 창이 띄우고, 끝나면 다시 띄운다(6절). 145 는 이 방식이다(2026-10-20 확인 — 작업 스케줄러 작업 없음).
작업 스케줄러 방식(6-2절)은 대안으로 남겨 둔다. **두 방식을 함께 쓰지 않는다** — 프로세스가 둘씩 떠 서로 포트를 빼앗고 옛 워커가 작업을 계속 처리한다.
서비스 관리 도구(NSSM 등)는 쓰지 않는다.

- 원본은 공유 폴더 `999_LogBook` 이고 DB 는 다시 세울 수 있는 캐시다(설계 §2.1).
- 워커가 매일 02시 이후 첫 주기에 레지스트리 갱신·DB 백업·90일 지난 휴지통 비우기를 한다.

## 1. 저장소 받기

```powershell
cd C:\Coding
git clone <저장소 주소> Logbook
```

## 2. Python 가상환경

Python 3.11 을 쓴다.

```powershell
cd C:\Coding\Logbook\backend
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 3. `backend\.env` 작성

`backend\.env.example` 을 `backend\.env` 로 복사하고 **값은 담당자가 직접 입력한다**(이 문서·채팅·커밋에 값을 남기지 않는다).
키 이름은 다음과 같다.

| 키 | 뜻 |
|---|---|
| `LOGBOOK_DB_USER` · `LOGBOOK_DB_PASSWORD` · `LOGBOOK_DB_HOST` · `LOGBOOK_DB_PORT` · `LOGBOOK_DB_NAME` | MySQL 접속 |
| `LOGBOOK_STORAGE_ROOT` | 공유 폴더 `999_LogBook` 경로 |
| `LOGBOOK_SESSION_HOURS` | 로그인 유지 시간 |
| `LOGBOOK_MYSQLDUMP` | `mysqldump.exe` 경로(기본 `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe`) |
| `LOGBOOK_PUBLIC_URL` | 팀원 바로가기 주소(기본 `http://10.14.42.145:9095`) |
| `LOGBOOK_BACKUP_KEEP` | 백업 보관 개수(기본 30) |
| `LOGBOOK_TRASH_DAYS` | 휴지통 보관일(기본 90) |
| `LOGBOOK_DAILY_HOUR` | 매일 작업 시각(시, 기본 2) |
| `LOGBOOK_WB_USERS_TABLE` | WorkBench 사용자 표(기본 `hitessworkbench.users`, 읽기 전용 — 아래 GRANT 필요) |
| `LOGBOOK_WB_CACHE_SECONDS` | WorkBench 사용자 활성 여부 캐시(초, 기본 60) |
| `LOGBOOK_WB_INTEGRATION_SECRET` | **WorkBench 연동 비밀키.** WorkBench `.env` 의 `LOGBOOK_INTEGRATION_SECRET` 과 같은 값. 비우면 연동이 꺼진다(WorkBench 보내기·가져오기가 404) |
| `LOGBOOK_WB_API_URL` | WorkBench API 주소(기본 `http://127.0.0.1:9091` — 같은 서버면 그대로) |
| `LOGBOOK_NASTRAN_EXE` · `LOGBOOK_SOLVE_TIMEOUT` | 해석 검증용 Nastran 경로(비우면 PATH → 기본 설치 경로)·시간 제한(초, 기본 1800) |
| `LOGBOOK_EXTRACT_TIMEOUT` · `LOGBOOK_CONVERT_TIMEOUT` | 파일 하나의 본문 추출·BDF 변환 제한 시간(초, 기본 600 · 1800). 워커가 자식 프로세스에서 돌리고 넘으면 끝낸 뒤 그 작업을 "처리 시간이 N분을 넘어 중단했습니다"로 실패 처리하고 다음 작업을 한다(재시도 없음). `0` 이면 제한 없이 워커 안에서(예전 동작) |
| `LOGBOOK_FRONTEND_DIST` | 화면 빌드 폴더(기본 `frontend\dist`) |
| `LOGBOOK_REPORT_*` | 보고서 본문 색인(13-4절) |

### DB 계정 권한

앱 계정(`LOGBOOK_DB_USER`)은 `logbook` DB 에 대해 다음 권한이 있어야 한다.

| 쓰임 | 권한 |
|---|---|
| 앱 동작(표 생성·읽기·쓰기) | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `INDEX`, `ALTER`, `REFERENCES` |
| 재구축·`fix-autoinc`(자동 증가 값 변경) | `ALTER`(위에 포함) |
| 테스트·재구축 리허설(표 지우기) | `DROP` (`logbook_test` 에만 줘도 된다) |
| 백업(`mysqldump --single-transaction --routines --no-tablespaces`) | `SELECT`, `SHOW VIEW`, `TRIGGER`, `EVENT`, `LOCK TABLES`, 그리고 `--routines` 용 `SHOW_ROUTINE`(8.0.20+, 전역) |

- `--no-tablespaces` 를 쓰므로 전역 `PROCESS` 권한은 필요 없다.
- 백업은 `user_sessions`(로그인 세션)·`download_tokens`(짧게 사는 내려받기 링크) 표를 덤프하지 않는다(`--ignore-table`).
  복원 뒤에는 모두 다시 로그인하면 된다. 표 자체는 앱이 시작할 때 다시 만든다.
- 예시(값은 담당자가 넣는다):
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES
      ON logbook.* TO '<계정>'@'localhost';
  GRANT SHOW_ROUTINE ON *.* TO '<계정>'@'localhost';
  ```

### WorkBench 사용자 표 읽기 권한(필수)

로그인과 **모든 요청**이 WorkBench 사용자 표(`LOGBOOK_WB_USERS_TABLE`)에서 활성 여부를 읽는다.
읽지 못하면 로그인과 화면 요청이 모두 **503** 이 된다. root 로 한 번 준다.

```sql
GRANT SELECT ON hitessworkbench.users TO '<계정>'@'localhost';
FLUSH PRIVILEGES;
-- 확인(앱 계정으로 접속해서): SELECT COUNT(*) FROM hitessworkbench.users;
```

## 4. 프런트 빌드

`frontend\dist` 는 저장소에 들어 있다. 145 에서 따로 빌드하지 않는다.

## 5. 첫 관리자

```powershell
cd C:\Coding\Logbook\backend
.venv\Scripts\python.exe -m app.cli create-admin <사번> <이름> [부서]
```

## 6. 프로세스 띄우기 — Server Manager(145 기본)

`Logbook_Server.bat` 를 두 번 누르면 창 하나가 API·Worker·Index(보고서 색인 워커, 41 에서 추가) 셋을 띄운다.

- 창 위의 점(●) 셋이 각 프로세스 상태다. 끝나면 3초 뒤 다시 띄우고, 연달아 죽으면 점점 길게 기다린다(각자 따로).
  API 는 3분 동안 응답이 없으면 강제로 다시 띄운다. Worker·Index 는 프로세스가 살아 있는지만 본다.
- **[⟳ Update]**: 셋을 멈춤 → `git pull origin main` → `requirements.txt` 가 바뀌었으면 pip install → 셋을 다시 띄운다(9절).
- 로그: `backend\logs\uvicorn\`·`worker\`·`report-index\` 의 `YYYYMMDD.log`, 사건 기록 `backend\logs\server_events.jsonl`.
  30일 지난 일자 로그는 Manager 가 시작할 때 지운다.
- 이미 떠 있으면 두 번째 창은 경고만 하고 닫힌다(`backend\logs\server_manager.pid`).
- **자동 시작은 로그온 때만**이다. `install-autostart.ps1` 이 시작 프로그램(`shell:startup`)에 바로가기를 만든다.
  145 를 재부팅하면 **누군가 그 계정으로 로그온해야** 서비스가 뜬다. 재부팅 뒤에는 원격 데스크톱으로 한 번 로그온한다.

## 6-2. (대안) 작업 스케줄러 등록

로그온 없이 부팅만으로 띄워야 할 때 쓴다. 쓰려면 먼저 Server Manager 를 닫고 시작 프로그램 바로가기를 지운다.
관리자 권한 PowerShell 에서 실행한다. 공유 폴더 권한이 있는 **도메인 계정**을 쓴다(SYSTEM 은 공유 폴더를 못 읽는다).

- 그 계정에 **'일괄 작업으로 로그온'(Log on as a batch job, `SeBatchLogonRight`)** 권한이 있어야 한다
  (`secpol.msc` → 로컬 정책 → 사용자 권한 할당. 도메인 정책으로 막혀 있으면 IT 에 요청). 없으면 작업이 시작되지 않는다.
- 비밀번호는 PowerShell 을 거치지 않는다. 스크립트는 작업 정의(XML)만 만들고 `schtasks.exe /Create /RU <계정> /RP *` 를
  부르며, **schtasks 가 직접 비밀번호를 묻는다**(작업마다 한 번씩, 세 번). 명령줄·변수·PowerShell 로그에 남지 않는다.

```powershell
cd C:\Coding\Logbook\ops
.\install-tasks.ps1 -User <도메인\계정> -WhatIf   # 할 일만 확인
.\install-tasks.ps1 -User <도메인\계정>           # 등록(비밀번호 입력)
Start-ScheduledTask -TaskName 'Logbook API'
Start-ScheduledTask -TaskName 'Logbook Worker'
Start-ScheduledTask -TaskName 'Logbook Report Index'
```

- 등록되는 작업: `Logbook API`(`run-api.ps1`), `Logbook Worker`(`run-worker.ps1`), `Logbook Report Index`(`run-report-index.ps1`,
  22 보고서 본문 색인 — 13절). 보고서 색인을 아직 쓰지 않으면 `-SkipReportIndex`.
- 트리거: 시작 시 + 30초 지연. 실행 시간 제한 없음. 중복 실행 무시.
- **다시 띄우기는 `run-*.ps1` 안의 루프가 한다**. uvicorn·워커가 끝나면 종료 코드를 로그에 남기고 60초 뒤 다시 띄운다.
  작업 스케줄러의 '실패 시 다시 시작'은 프로세스가 0 이 아닌 코드로 끝난 것을 실패로 보지 않아 기대할 수 없다.
- 방화벽 `Logbook 9095`(TCP 9095 인바운드 허용, **도메인·개인 프로필만**)가 없으면 만든다.
- 지우기: `.\install-tasks.ps1 -Uninstall`. 계정 비밀번호가 바뀌면 같은 명령으로 다시 등록한다.

## 7. 팀원 바로가기

```powershell
.venv\Scripts\python.exe -m app.cli write-shortcut            # 기본 주소(LOGBOOK_PUBLIC_URL)
.venv\Scripts\python.exe -m app.cli write-shortcut --url http://10.14.42.145:9095
```

공유 폴더 루트에 `Logbook.url` 과 `Logbook 사용 안내.txt` 가 생긴다(있으면 덮어쓴다).

## 8. 팀원 안내

- 공유 폴더의 `Logbook.url` 을 두 번 누르거나 크롬에서 `http://10.14.42.145:9095` 를 북마크한다.
- WorkBench 가입자는 사번으로 바로 들어온다(15 — 따로 가입·승인 없음). 처음에는 LV1(게스트)이고, 등급은 관리자가 **관리 → 사용자 관리** 에서 바꾼다.
- 자료 원본은 공유 폴더에 있다. `10_Vault` 를 직접 고치지 않는다.

## 9. 업데이트

**Server Manager(145)**: 창의 **[⟳ Update]** 한 번이면 된다(6절). 로그 창에서 `[2/4] git pull` 의 After 해시와
`[3/4]` 의 pip 결과를 본다 — pip 가 실패해도 재시작은 진행되니 오류 줄이 보이면 아래 명령으로 다시 설치하고 Update 를 한 번 더 누른다.

- **`backend\server_manager.py`·`backend\serverguard\` 가 바뀐 업데이트는 Update 뒤 창을 닫고 `Logbook_Server.bat` 로 다시 연다.**
  Update 는 창이 이미 메모리에 올린 옛 코드로 프로세스를 다시 띄우기 때문이다.
- 창은 **창의 닫기(X)로** 닫는다. `.bat` 콘솔 창을 닫거나 작업 관리자로 끝내면 Worker·Index 가 고아로 남는다.
  다음에 창을 열 때 같은 명령의 남은 프로세스를 찾아 끝내지만(41, 로그 '남아 있던 … 프로세스 종료'), 그 사이에는 옛 Worker 가 작업을 계속 처리한다.

```powershell
cd C:\Coding\Logbook
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

**작업 스케줄러(6-2절)** 를 쓸 때는 `git pull`·pip install 뒤 재시작을 다음 순서로 한다. `run-*.ps1` 은 python 을 `cmd` 아래 자식 프로세스로 띄우므로 **작업을 멈춰도 python 이
남을 수 있다.** 남은 것을 끝내지 않으면 새 워커와 옛 워커가 동시에 돈다(일일 작업은 잠금으로 한쪽만 돌지만,
옛 코드가 계속 작업을 처리한다).

```powershell
Stop-ScheduledTask -TaskName 'Logbook API'
Stop-ScheduledTask -TaskName 'Logbook Worker'
Stop-ScheduledTask -TaskName 'Logbook Report Index' -ErrorAction SilentlyContinue
# 남은 Logbook python 프로세스(backend\.venv\Scripts\python.exe 와 그것이 띄운 기본 python, uvicorn app.main·app.worker·app.report_index.worker)를 찾아 끝낸다
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'uvicorn app\.main:app|-m app\.worker|-m app\.report_index\.worker' } |
    ForEach-Object { "끝냄: $($_.ProcessId) $($_.CommandLine)"; Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'Logbook API'
Start-ScheduledTask -TaskName 'Logbook Worker'
Start-ScheduledTask -TaskName 'Logbook Report Index' -ErrorAction SilentlyContinue
```

시작할 때 새 표는 `create_all` 로 생기고, **기존 표에 새로 생긴 열은 자동으로 `ALTER TABLE ... ADD` 된다**
(`backend/app/database.py` `ADDED_COLUMNS` — 모두 NULL 허용 또는 기본값이 있어 기존 행에 안전).
등급(LV)·공개 범위 이전도 시작할 때 자동으로 한 번 돈다(다시 돌려도 같은 결과). API 로그에 추가한 열 목록이 찍힌다.
옛 커밋으로 되돌려도 추가된 열은 남지만 옛 코드는 그 열을 쓰지 않으므로 그대로 동작한다.

### 업데이트 전·후 점검(큰 업데이트일 때)

1. **업데이트 전 수동 백업**: `backend\.venv\Scripts\python.exe -m app.cli backup`
2. 새 `.env` 키가 생겼는지 `backend\.env.example` 과 비교한다(3절 표). 특히 `LOGBOOK_WB_INTEGRATION_SECRET`.
3. WorkBench 사용자 표 GRANT(3절)가 되어 있는지 확인한다.
4. (작업 스케줄러 방식일 때만) 새 작업이 생겼으면 `install-tasks.ps1` 을 **다시 실행**해 등록한다(예: 22 이후 `Logbook Report Index`).
5. 재시작 뒤 확인: 로그인 → 관리 › 운영 화면에서 워커 박동·'WorkBench 사용자 표: 연결됨' → Inbox 에 시험 파일 하나를 올려 확정까지.
6. 1회 정비 명령(해당 업데이트의 계획 문서·WorkLog 에 적힌 것만, **한 곳에서 한 번**). 예(09~24 업데이트):
   ```powershell
   cd C:\Coding\Logbook\backend
   .venv\Scripts\python.exe -m app.cli enqueue-convert --outdated
   .venv\Scripts\python.exe -m app.cli enqueue-convert --missing-signature
   .venv\Scripts\python.exe -m app.cli revisions-refresh
   .venv\Scripts\python.exe -m app.cli vocab-report            # 보고 → 필요하면 vocab-normalize --apply
   .venv\Scripts\python.exe -m app.cli report-catalog-migrate  # 보고 → --apply
   .venv\Scripts\python.exe -m app.cli document-type-fill      # 보고 → --apply
   .venv\Scripts\python.exe -m app.cli naming-cleanup          # 보고 → 필요하면 --apply
   ```
7. WorkBench 와 함께 바뀌는 업데이트는 **LogBook 을 먼저** 올린다(옛 LogBook 이면 WorkBench 보내기가 404).

## 10. 백업 확인·복원

- 매일 백업: 워커가 02시 이후 첫 주기에 `80_Backup\logbook-YYYYMMDD-HHMMSS.sql.gz` 를 쓰고 30개를 넘으면 오래된 것부터 지운다.
  관리자 화면 `/admin/ops` 에 마지막 백업 시각·크기·실패 사유가 보인다.
  - 백업이 실패한 날은 완료로 치지 않고 **60분 뒤 다시 시도**한다(매 주기 반복하지 않는다).
  - 덤프가 30분을 넘으면 끝내고 실패로 기록한다(`mysqldump_timeout`).
  - 하루가 지난 `.tmp`(중간에 죽은 백업)는 정리한다.
- 수동 백업: 관리자 화면의 `지금 백업`, 또는 `.venv\Scripts\python.exe -m app.cli backup`.
  이름이 `…-manual.sql.gz` 로 끝나고, 일일 백업과 **따로** 30개를 보관한다(수동 백업이 일일 백업을 밀어내지 않는다).
- ⚠ 공유 폴더에 **평문 SQL(gzip)** 로 남는다. 공유 폴더 접근 권한이 곧 DB 내용 열람 권한이다.

복원(빈 DB 에). `gunzip` 대신 파이썬 한 줄로 푼다.

```powershell
cd C:\Coding\Logbook\backend
.venv\Scripts\python.exe -c "import gzip,shutil,sys; shutil.copyfileobj(gzip.open(sys.argv[1]), open(sys.argv[2],'wb'))" `
    "<공유 폴더>\80_Backup\logbook-20261002-020000.sql.gz" "$env:TEMP\logbook.sql"
# PowerShell 은 '<' 리다이렉션이 없어 cmd 로 넘긴다(-p 는 비밀번호를 입력 창으로 묻는다)
cmd /c "mysql -u <계정> -p logbook < %TEMP%\logbook.sql"
Remove-Item "$env:TEMP\logbook.sql"
```

복원 순서:
1. API·워커를 멈추고 남은 python 프로세스를 끝낸다(9번).
2. 위 명령으로 덤프를 넣는다.
3. **Entry 번호를 보정한다**. 덤프 이후에 확정·폐기된 Entry 의 번호가 공유 폴더·감사 로그에 남아 있을 수 있다.
   보정하지 않으면 새 Entry 가 그 번호를 다시 써서 폴더·감사 기록이 서로 다른 두 건을 가리킨다.
   ```powershell
   .venv\Scripts\python.exe -m app.cli fix-autoinc
   ```
   - 다음 Entry 번호를 출력하고, **Vault 에는 있는데 DB 에 없는 Entry**(덤프 이후 확정된 것)를 경고로 보여 준다.
     그런 Entry 는 파일이 Vault 에 그대로 있으니, 사람이 보고 다시 올리거나 재구축(11번)을 고려한다.
4. API·워커를 다시 시작한다.

### 백업 비밀번호 전달 방식: `MYSQL_PWD` 와 그 대안

백업은 `mysqldump` 에 DB 비밀번호를 **명령줄이 아니라 환경변수 `MYSQL_PWD`** 로 넘긴다.
명령줄(`-p비밀번호`)은 작업 관리자·`Get-CimInstance Win32_Process` 로 누구나 볼 수 있어 피했다.
비밀번호는 `app.config.settings` 에서만 읽고, 로그·화면·예외 메시지에는 남기지 않는다(오류 문구에 섞이면 `***` 로 가린다).

알고 있는 한계:
- MySQL 8.0 은 `MYSQL_PWD` 를 **사용 중단 예정(deprecated)** 으로 표시한다. 이후 버전에서 빠지면 백업이 비밀번호 없이 접속을 시도해 실패한다(관리자 화면에 실패 사유가 뜬다).
- 같은 계정(또는 관리자)으로 실행 중인 `mysqldump` 프로세스의 환경변수는 진단 도구로 읽을 수 있다. 덤프가 도는 몇 초~몇 분 동안만 노출된다.

대안: `--defaults-extra-file`(옵션 파일):
- 실행 직전에 `[client]\nuser=…\npassword=…` 를 담은 임시 파일을 **작업 계정만 읽을 수 있는 권한**(ACL)으로 만들고,
  `mysqldump --defaults-extra-file=<파일> …`(이 옵션은 반드시 첫 인자) 로 실행한 뒤 바로 지운다.
- 장점: 사용 중단 경고가 없고 프로세스 환경에도 비밀번호가 없다.
- 단점: 잠깐이라도 디스크에 평문 파일이 생긴다. 회사 DRM 이 로컬 파일을 감싸면 `mysqldump` 가 못 읽을 수 있어 145 에서 실측이 필요하다. 프로세스가 죽으면 파일이 남을 수 있어 정리 로직이 더 필요하다.
- 바꾸려면 `backend\app\ops\backup.py` 의 `_run_dump` 만 고치면 된다(`MYSQL_PWD` 대신 임시 옵션 파일).

## 11. 재구축(DB 를 잃었을 때)

공유 폴더만으로 빈 DB 를 다시 채운다. **entries 표가 비어 있을 때만** 돈다(운영 DB 덮어쓰기 방지).

1. API·워커 작업을 멈춘다.
2. MySQL 에 빈 DB 를 만든다(이름은 `.env` 의 `LOGBOOK_DB_NAME`).
3. 실행한다.

```powershell
cd C:\Coding\Logbook\backend
.venv\Scripts\python.exe -m app.cli rebuild          # 할 일만 안내
.venv\Scripts\python.exe -m app.cli rebuild --yes    # 실행
```

- 되살리는 것: `90_System\registry.json`(사용자·호선 선종/메모·태그 동의어), `10_Vault` 의 `entry.json`(확정 Entry, 원래 번호 그대로),
  `95_Trash` 의 `entry.json`(휴지통), `90_System\audit\*.jsonl`(감사 로그).
- 미확정 초안은 되살리지 않는다. 대신 `10_Vault\_staging\<key>` 폴더마다 배치를 새로 만들어 다시 처리한다(정리 대기 화면에 다시 나온다).
- 본문 추출·BDF 변환은 작업 큐에 다시 들어가고, 워커가 `20_Derived` 캐시로 다시 채운다. 자료가 많으면 큐가 비기까지 오래 걸린다.
- 결과에 `missing_files`(디스크에 없는 파일)·`skipped_bad`(entry.json 이 없거나 깨진 폴더)가 0 이 아니면 로그를 보고 사람이 판단한다.
- 휴지통 Entry 의 보관 기간(90일)은 폴더 이름의 버린 시각부터 센다(재구축 시각부터 다시 세지 않는다).
- 손상된 entry.json 하나 때문에 전체가 실패하지 않는다. 그 Entry 만 건너뛰고 `skipped_bad` 로 센다.
- 끝나면 Entry 자동 증가 값을 공유 폴더·감사 로그에서 본 최대 번호 다음으로 올리고(`next_entry_id`), 관리자 목록을 출력한다.
  관리자가 없으면 `create-admin` 으로 만든다.
- 워커 심장 박동이 최근(10분 안)이면 거부한다. 워커가 빈 DB 를 보고 돌고 있다는 뜻이다. 워커를 멈추고 다시 하거나,
  확실히 멈춘 것을 알면 `rebuild --yes --force`.
- 일일 덤프가 있으면 덤프 복원(10번)이 더 빠르고 정확하다. 재구축은 덤프도 없을 때 쓴다.

**재구축이 중간에 실패하면**(공유 폴더 끊김·DB 오류 등) 일부만 채워진 DB 가 남는다. entries 가 비어 있지 않으므로
다시 실행하면 거부된다. DB 를 지우고 다시 만든 뒤 처음부터 다시 한다.

```sql
DROP DATABASE logbook;
CREATE DATABASE logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

```powershell
.venv\Scripts\python.exe -m app.cli rebuild --yes
```

## 12. 문제 해결

- **워커 멈춤**: 관리자 화면 `/admin/ops` 의 워커 상태가 "멈춤"(10분 넘게 소식 없음: 주기 시작·작업 1건마다·일일 작업 단계마다 소식을 남긴다)이면 `Get-ScheduledTask 'Logbook Worker'` 상태와 로그를 본다.
- **실패한 작업**: 같은 화면의 실패 목록에서 `다시 시도`. 오류 전문은 펼쳐서 본다.
- **로그 위치**
  - API 콘솔: `backend\logs\api.log`(10MB 넘으면 `api.log.1`)
  - 워커 콘솔: `backend\logs\worker-console.log`
  - 보고서 색인 워커 콘솔: `backend\logs\report-index-console.log`
  - 워커 자체 로그: 공유 폴더 `90_System\logs\worker.log`
  - 감사 로그: 공유 폴더 `90_System\audit\YYYY-MM.jsonl`
- **공유 폴더 끊김**: 화면에 연결 끊김이 표시되고 워커는 그 주기를 건너뛴다. 복구되면 저절로 이어진다.
- **휴지통 수동 비우기**: `.venv\Scripts\python.exe -m app.cli purge-trash [--days N]`, 또는 휴지통 화면의 `영구 삭제`(관리자).
- **확정·휴지통·복원이 `storage_error`/`storage_error_partial`(503)로 실패**: 공유 폴더가 이동 도중 끊긴 경우다. 파일 이동은
  멱등이라 연결이 돌아온 뒤 **같은 버튼을 다시 누르면 이어서 끝난다**(이미 옮겨진 파일은 크기·내용으로 알아보고 건너뛴다).
  목적지에 **내용이 다른** 파일이 있으면 덮어쓰지 않고 계속 실패한다 — 그때는 아래 대조로 확인한다.
- **DB ↔ 공유 폴더 대조**: `.venv\Scripts\python.exe -m app.cli verify` — 없는 파일, 반쯤 옮겨진 파일, DB 행이 없는 폴더를
  보고만 한다(문제가 있으면 종료 코드 1). `--fix` 는 staging↔vault 사이에 반쯤 옮겨진 파일만 **DB 가 말하는 자리로** 옮긴다
  (DB 는 고치지 않고 폴더는 지우지 않는다. 휴지통이 걸린 경우는 보내기·복원을 다시 실행). 큰 업데이트·장애 뒤 한 번 돌려 본다.
- **entry.json 이 빠졌거나 낡음**: 쓰기는 임시 파일 → 바꿔 끼우기라 도중에 끊겨도 기존 파일이 깨지지 않는다. 실패하면 `write_meta`
  작업이 1분부터 두 배씩(최대 1시간) 하루 남짓 다시 시도하고, 매일 작업(02시)이 확정·휴지통 Entry 의 entry.json 을 훑어 빠지거나
  DB 판보다 낡은 것을 한 번에 최대 500건 다시 쓴다. registry.json 쓰기가 실패한 날은 60분마다 그것만 다시 쓴다.
- **추출·변환 시간 초과**: 실패 목록에 "처리 시간이 N분을 넘어 중단했습니다". 같은 파일은 다시 돌려도 멈출 가능성이 크다 — 정말 큰 정상
  파일이면 `LOGBOOK_EXTRACT_TIMEOUT`·`LOGBOOK_CONVERT_TIMEOUT` 을 늘리고 워커를 다시 시작한 뒤 `다시 시도`.

## 13. 보고서 본문 색인(22)

보고서 화면(`/reports`)의 검색은 보고서 **본문 색인**(그림 속 글자 OCR 포함, 쪽·시트·슬라이드 위치)으로 찾고, '의미 추천 포함'을
켜면 로컬 Ollama 임베딩으로 관련 보고서를 덧붙이며, 미리보기의 [이 보고서 근거로 요약]이 Ollama 채팅 모델로 근거 요약을 만든다.
색인을 만드는 것은 따로 도는 **보고서 색인 워커**(`python -m app.report_index.worker --loop`)다. 145 는 Server Manager 의 Index 가 띄운다
(41 — 그 전에는 145 에서 한 번도 돌지 않아 2026-10-20 `--status` 가 `documents: 0`). 작업 스케줄러 방식이면 작업 `Logbook Report Index`.

- **색인은 서버 로컬**: `backend\.report-search\index.sqlite3`(SQLite, gitignore). 서버마다 따로 만든다(개발 PC 색인을 복사하지 않는다).
  공유 폴더 경로(`\\…`)를 색인 위치로 주면 시작하지 않는다(SQLite 잠금을 SMB 에서 믿을 수 없다).
- **추출 캐시는 공유 폴더**: `20_Derived\_report_search\<추출 조건 해시>\<내용 SHA>.json`. 추출 조건(Tesseract 경로·언어 데이터 크기/시각
  포함)이 같은 서버라면 색인을 지워도 원본을 다시 추출하지 않는다. 다른 서버는 조건 해시가 달라 처음엔 다시 추출한다.
- **원본은 읽기만** 한다(임시 사본으로 추출). 권한은 매 요청 MySQL 로 다시 확인한다(색인은 권한의 근거가 아니다).
- 색인 워커·Ollama·Tesseract 가 없어도 보고서 목록과 기존 검색(03a 본문 추출)은 그대로 된다 — 화면에 '본문 색인 사용 불가'가 뜬다.

### 13-1. 설치(한 번)

1. **Tesseract OCR**(Windows 설치본, 기본 `C:\Program Files\Tesseract-OCR`). 설치할 때 **Korean** 언어 데이터를 고르거나,
   `kor.traineddata`·`eng.traineddata` 를 `C:\Program Files\Tesseract-OCR\tessdata` 에 넣는다. 사내망에서 내려받기가 막히면
   개발 PC 의 언어 데이터 파일을 복사한다. 다른 폴더에 두면 `backend\.env` 에 `LOGBOOK_REPORT_TESSDATA=<그 폴더>`.
   확인: `& 'C:\Program Files\Tesseract-OCR\tesseract.exe' --list-langs` 에 `kor`·`eng`.
   Tesseract 가 없으면 그림 속 글자는 색인되지 않고 그 보고서는 '일부 추출'로 표시된다.
2. **Ollama 모델**: 임베딩 `bge-m3:latest`(의미 추천), 요약 `qwen2.5:7b`(근거 요약). `ollama pull bge-m3:latest`, `ollama list` 로 확인.
   ⚠ Ollama(`127.0.0.1:11434`)는 **WorkBench AI 와 같은 서버를 함께 쓴다.** LogBook 요약은 사용자당 1건·전체 2건(`LOGBOOK_REPORT_RAG_CONCURRENCY`)만
   동시에 돌리고 넘치면 '잠시 뒤 다시'(429)로 돌려보낸다. 색인 워커의 임베딩은 16문장씩 차례로 보낸다. 사내망에서 pull 이 막히면
   개발 PC 의 `%USERPROFILE%\.ollama\models` 를 복사한다. Ollama 가 없으면 키워드 검색만 된다.
3. **구형 PPT(.ppt)**: LibreOffice(`soffice`) 또는 Microsoft PowerPoint 가 있어야 변환해 색인한다. 둘 다 없으면 그 파일은 '실패'로
   남고(지수 백오프로 최대 하루 한 번 다시 시도) 목록·미리보기는 그대로다.
4. 띄우기: Server Manager 면 따로 할 일 없다(Update 뒤 Index 점이 초록인지 본다). 작업 스케줄러 방식이면 6-2절 `install-tasks.ps1`(세 번째 작업 `Logbook Report Index`).

### 13-2. 초기 색인

- 기본은 5분(`LOGBOOK_REPORT_INTERVAL`)마다 최대 25개(`LOGBOOK_REPORT_BATCH_SIZE`) 파일. 보고서 1,000개면 기본값으로 약 3~4시간 이상
  (원본 복사 + OCR 이 대부분 — 스캔 PDF 는 쪽마다 수 초, 임베딩은 CPU 에서 조각당 0.1~0.5초 정도). 처음 한 번은 `.env` 에
  `LOGBOOK_REPORT_BATCH_SIZE=200`, `LOGBOOK_REPORT_INTERVAL=60` 으로 올렸다가 끝나면 되돌려도 된다(워커만 다시 시작).
- 진행 확인: `backend` 에서 `.venv\Scripts\python.exe -m app.report_index.worker --status`(상태별 건수·조각·벡터·백오프 대기·워커 마지막 주기),
  또는 보고서 화면 위의 색인 상태 띠(관리자는 `GET /api/reports/index-status` 의 `index` 에 전역 상태).
- 손으로 한 주기만: `.venv\Scripts\python.exe -m app.report_index.worker --once`(작업이 돌고 있으면 잠금 때문에 바로 끝난다).
- 색인을 처음부터: 작업을 멈추고 `... -m app.report_index.worker --rebuild`(옛 파일은 `.bak-시각` 으로 남긴다) 뒤 작업을 다시 시작.

### 13-3. 실패·재시도

- 실패한 파일은 5분 → 10분 → 20분 … 최대 24시간 간격으로 다시 시도한다. 파일 크기·수정 시각·등록 SHA·추출 조건(추출기 판·OCR 설정)이
  바뀌면 기다리지 않고 바로 다시 한다. 백오프 중인 파일은 배치 개수에 세지 않는다(새 보고서가 밀리지 않는다).
- 임베딩 서버가 꺼져 있으면 본문만 색인하고, 서버가 돌아오면 원본을 다시 읽지 않고 색인된 조각으로 벡터만 채운다.
- 색인 워커 로그: `backend\logs\report-index-console.log`. DB 조회가 실패한 주기는 색인을 지우지 않는다.

### 13-4. 환경 변수(`backend\.env`, 비우면 기본값)

| 키 | 기본 | 뜻 |
|---|---|---|
| `LOGBOOK_REPORT_INDEX_PATH` | `backend\.report-search\index.sqlite3` | 색인(로컬 디스크만) |
| `LOGBOOK_REPORT_INTERVAL` · `LOGBOOK_REPORT_BATCH_SIZE` | 300초 · 25 | 주기·주기당 처리 파일 수 |
| `LOGBOOK_REPORT_VERIFY_SECONDS` | 86400 | 바뀌지 않은 파일의 내용 SHA 재확인 주기 |
| `LOGBOOK_REPORT_OCR` · `LOGBOOK_REPORT_OCR_LANGUAGES` | 1 · `kor+eng` | OCR 켜기·언어 |
| `LOGBOOK_REPORT_TESSDATA` | (Tesseract 설치 폴더\tessdata) | OCR 언어 데이터 폴더 |
| `LOGBOOK_REPORT_CONVERSION_TIMEOUT` | 120초 | OCR·PPT 변환 한 건 제한 |
| `LOGBOOK_REPORT_EXTRACT_TIMEOUT` | 3600초 | 보고서 한 건 추출(OCR 포함) 전체 제한 — 자식 프로세스에서 돌리고 넘으면 끝내 '실패'(백오프)로 남긴다. `0` = 제한 없음 |
| `LOGBOOK_REPORT_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama(WorkBench AI 와 공유) |
| `LOGBOOK_REPORT_EMBED_MODEL` · `LOGBOOK_REPORT_RAG_MODEL` | `bge-m3:latest` · `qwen2.5:7b` | 임베딩·요약 모델 |
| `LOGBOOK_REPORT_SEMANTIC_THRESHOLD` · `LOGBOOK_REPORT_SEMANTIC_LIMIT` | 0.5 · 50 | 의미 추천 유사도 하한·최대 개수 |
| `LOGBOOK_REPORT_VECTOR_CACHE_MB` | 512 | API 가 의미 검색용 벡터를 메모리에 들고 있을 상한(넘으면 매번 나눠 읽음) |
| `LOGBOOK_REPORT_RAG_CONCURRENCY` | 2 | 근거 요약 전체 동시 실행 수(사용자당은 늘 1) |
