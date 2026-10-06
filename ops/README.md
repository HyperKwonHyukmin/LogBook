# Logbook 145 서버 설치·운영 안내

145 서버(10.14.42.145)에서 Logbook 을 혼자 돌아가게 하는 절차다. API(포트 9095)와 워커 두 프로세스를
Windows 작업 스케줄러가 "시작 시 실행" 으로 띄우고, 프로세스가 끝나면 `run-*.ps1` 안의 루프가 60초 뒤 다시 띄운다. 서비스 관리 도구(NSSM 등)는 쓰지 않는다.

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

## 4. 프런트 빌드

`frontend\dist` 는 저장소에 들어 있다. 145 에서 따로 빌드하지 않는다.

## 5. 첫 관리자

```powershell
cd C:\Coding\Logbook\backend
.venv\Scripts\python.exe -m app.cli create-admin <사번> <이름> [부서]
```

## 6. 작업 스케줄러 등록

관리자 권한 PowerShell 에서 실행한다. 공유 폴더 권한이 있는 **도메인 계정**을 쓴다(SYSTEM 은 공유 폴더를 못 읽는다).

- 그 계정에 **'일괄 작업으로 로그온'(Log on as a batch job, `SeBatchLogonRight`)** 권한이 있어야 한다
  (`secpol.msc` → 로컬 정책 → 사용자 권한 할당. 도메인 정책으로 막혀 있으면 IT 에 요청). 없으면 작업이 시작되지 않는다.
- 비밀번호는 PowerShell 을 거치지 않는다. 스크립트는 작업 정의(XML)만 만들고 `schtasks.exe /Create /RU <계정> /RP *` 를
  부르며, **schtasks 가 직접 비밀번호를 묻는다**(작업마다 한 번씩, 두 번). 명령줄·변수·PowerShell 로그에 남지 않는다.

```powershell
cd C:\Coding\Logbook\ops
.\install-tasks.ps1 -User <도메인\계정> -WhatIf   # 할 일만 확인
.\install-tasks.ps1 -User <도메인\계정>           # 등록(비밀번호 입력)
Start-ScheduledTask -TaskName 'Logbook API'
Start-ScheduledTask -TaskName 'Logbook Worker'
```

- 등록되는 작업: `Logbook API`(`run-api.ps1`), `Logbook Worker`(`run-worker.ps1`).
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
- 처음 쓰는 사람은 사번으로 가입을 신청하고, 관리자가 **관리 → 사용자 관리** 에서 승인한다.
- 자료 원본은 공유 폴더에 있다. `10_Vault` 를 직접 고치지 않는다.

## 9. 업데이트

```powershell
cd C:\Coding\Logbook
git pull
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

재시작은 다음 순서로 한다. `run-*.ps1` 은 python 을 `cmd` 아래 자식 프로세스로 띄우므로 **작업을 멈춰도 python 이
남을 수 있다.** 남은 것을 끝내지 않으면 새 워커와 옛 워커가 동시에 돈다(일일 작업은 잠금으로 한쪽만 돌지만,
옛 코드가 계속 작업을 처리한다).

```powershell
Stop-ScheduledTask -TaskName 'Logbook API'
Stop-ScheduledTask -TaskName 'Logbook Worker'
# 남은 Logbook python 프로세스(backend\.venv\Scripts\python.exe 와 그것이 띄운 기본 python, uvicorn app.main·app.worker)를 찾아 끝낸다
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'uvicorn app\.main:app|-m app\.worker' } |
    ForEach-Object { "끝냄: $($_.ProcessId) $($_.CommandLine)"; Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'Logbook API'
Start-ScheduledTask -TaskName 'Logbook Worker'
```

표는 시작할 때 `create_all` 로 만들어진다(새 표는 생기고 기존 표의 열은 바뀌지 않는다).

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
  - 워커 자체 로그: 공유 폴더 `90_System\logs\worker.log`
  - 감사 로그: 공유 폴더 `90_System\audit\YYYY-MM.jsonl`
- **공유 폴더 끊김**: 화면에 연결 끊김이 표시되고 워커는 그 주기를 건너뛴다. 복구되면 저절로 이어진다.
- **휴지통 수동 비우기**: `.venv\Scripts\python.exe -m app.cli purge-trash [--days N]`, 또는 휴지통 화면의 `영구 삭제`(관리자).
