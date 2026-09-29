# Logbook 사전 실험 (PoC)

Logbook 의 설계 전제 7가지를 실측으로 검증한다. 실행 결과는 `out\*.json` 으로 남기고,
핵심 값만 `RESULTS.md` 표로 옮긴다.

공유 폴더 루트(이하 `<share>`):
`\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`

## 0. 요구사항

- **Python 3.10 이상** — 코드 전반에 `X | None` 같은 PEP 604 유니온 문법을 쓴다(3.9 이하는
  `TypeError`로 즉시 깨진다). 먼저 버전을 확인한다.

      python --version

- 가상환경 생성 — `py` 런처로 3.11 이 있으면 그것을 쓰고, 없으면 시스템 `python` 을 쓴다.

      py -3.11 -m venv .venv          REM py -3.11 이 있을 때
      python -m venv .venv            REM 없으면 이 명령으로 대체

- 의존성 설치 — **활성화(activate) 없이 `.venv` 안의 실행 파일을 직접 호출**하는 방식을 쓴다
  (아래 모든 명령이 이 방식이다).

      .venv\Scripts\python.exe -m pip install -r requirements-poc.txt

  사내망 SSL 검사(프록시 인터셉션)로 pip 설치가 막히면:

      .venv\Scripts\python.exe -m pip install -r requirements-poc.txt --trusted-host pypi.org --trusted-host files.pythonhosted.org

- 테스트 실행(코드는 확정 상태, 88개 전부 통과해야 정상):

      .venv\Scripts\pytest.exe tests -q

- (선택) PowerShell 에서 가상환경을 활성화하고 싶다면:

      .venv\Scripts\Activate.ps1

  실행 정책 때문에 막히면(`이 시스템에서 스크립트를 실행할 수 없으므로...`) 관리자 PowerShell 에서
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 실행 후 재시도한다. 활성화 없이
  `.venv\Scripts\python.exe`/`.venv\Scripts\pytest.exe` 를 직접 부르는 쪽을 기본으로 삼는다 — 이
  문서의 모든 명령도 그 방식이다.

## 1. 실행 위치와 145 전달 방식 (2026-09-29 결정)

- **모든 측정·테스트는 개발 PC(사용자 PC)에서 한다.** 이 문서의 명령은 개발 PC 기준이다.
- **145 서버에는 git 으로만 넘긴다** — 사용자가 개발 PC에서 커밋·푸시 → 145 에서 `git pull`.
  (`.venv`·`out` 은 `.gitignore` 대상이라 올라가지 않는다. 145 에서는 받은 뒤 "0. 요구사항"의
  venv 생성·설치를 한 번 수행한다.)
- 145 고유 항목(9095 포트 인바운드, 서버 실행 계정의 공유 폴더 권한, 145 의 `LongPathsEnabled`)은
  별도 사전 실험이 아니라 **첫 배포 점검표**(계획 05)에서 확인한다.
- 예전 안내의 `<share>\_poc\tools\poc` 사본은 더 쓰지 않는다(실험 종료 시 `_poc` 와 함께 삭제).

## 2. 표본 준비 (사람이 직접)

1. DRM 이 걸린 pptx·xlsx·pdf 각 1개 이상을 **탐색기로** `<share>\_poc\samples\` 에 복사한다.
2. 같은 파일의 **원본**(DRM 이 걸리기 전 또는 개인 PC 로컬에만 있는 원본)은 **개인 PC 로컬**의
   `C:\LogbookPoc\local\` 에 그대로 둔다(개발 PC·145 에는 두지 않는다 — 대조군이 의미 있으려면
   회사 파일 서버/DRM 정책이 닿지 않는 위치여야 한다).
3. 팀 BDF **소·중·대** 3개를 `<share>\_poc\bdf\` 에 복사한다(INCLUDE 로 참조하는 파일이 있으면
   그 파일도 같은 상대 경로로 함께 복사한다).

## 3. 측정 위치(장비)

| 장비 | 역할 | 준비물 |
|---|---|---|
| 개발 PC | 예비 측정(본측정 전 스크립트 동작 확인) | `C:\Coding\Logbook\poc` + `.venv` |
| **145 서버** | **본측정** — 실험 1·2·4·5·7 + 3·6 의 서버 쪽 | `C:\LogbookPoc\poc` + `.venv`(위 1절) |
| 팀원 PC (크롬) | 실험 3·6 — 브라우저 업로드 + 145 접속 확인 | 크롬 브라우저만 있으면 됨(Python 불필요) |
| 개인 PC | 실험 1-대조 — DRM 원본이 있는 PC | Python(≥3.10)만 있으면 됨. `sniff()` 는 외부 라이브러리 없이도 동작하므로(첫 16바이트 매직 검사) `.venv`/`pip install` 없이 `poc` 폴더(적어도 `drm_check.py`+`pocio.py`)만 있어도 실행 가능. 이 PC의 exit code **1 은 예상된 정상 결과**(DRM 원본이니 `sniff=drm`이 나와야 맞다) — 실패로 착각하지 말 것. |

측정 순서는 **개발 PC 예비 → 145 본측정**이다. `RESULTS.md` 의 "결과 (개발 PC 예비)" / "결과 (145
본측정)" 두 칸을 순서대로 채운다.

## 4. 실행 순서 — 결과는 `out\*.json` 으로 남기고 `RESULTS.md` 에 옮긴다

145 에서 실행하는 명령은 모두 `C:\LogbookPoc\poc` 를 현재 폴더로 실행한다(`out\expN.json` 은 그
안의 상대 경로).

| 실험 | 위치 | 명령 |
|---|---|---|
| 1 | 145 | `.venv\Scripts\python.exe drm_check.py "<share>\_poc\samples" -o out\exp1.json` |
| 1-대조 | 개인 PC | `python drm_check.py C:\LogbookPoc\local -o out\exp1_local.json` (예상: 각 행 `sniff: "drm"`, 전체 종료 코드 **1**=정상) |
| 2 | 145 | `.venv\Scripts\python.exe move_check.py "<share>" -o out\exp2.json` |
| 4 | 145 | `.venv\Scripts\python.exe owner_check.py "<share>\_poc\samples" -o out\exp4.json` |
| 5 | 145 | `.venv\Scripts\python.exe bdf_bench.py "<share>\_poc\bdf" -o out\exp5.json` |
| 7 | 145 | `.venv\Scripts\python.exe longpath_check.py "<share>" -o out\exp7.json` |
| 3·6 | 145 + 팀원 PC | 아래 "5. 실험 3·6" 참고 |

모든 스크립트는 `<경로...> [-o <출력 파일>]` 형태이고 `-o` 를 안 주면 stdout(UTF-8)으로 결과를
찍는다. `drm_check.py` 종료 코드: `0`=DRM·에러 없음 / `1`=DRM 파일 있음(최우선 판정) /
`3`=DRM 은 없지만 stat/open 에러 행이 있음.

## 5. 실험 3·6 — 크롬 업로드 평문 여부 + 145:9095 도달성

**145 에서 서버 시작.** 먼저 환경변수 `LOGBOOK_POC_DIR` 로 저장 폴더를 공유 경로로 지정한다(안
주면 `out\web` 에 로컬로 저장돼 팀원 PC 업로드 결과가 공유 폴더에 남지 않는다).

cmd.exe:

    set LOGBOOK_POC_DIR=<share>\_poc\web
    .venv\Scripts\uvicorn.exe probe_server:app --host 0.0.0.0 --port 9095

PowerShell (⚠ **`set X=Y` 는 PowerShell 에서 환경변수를 바꾸지 못한다** — 같은 이름의 로컬
변수를 조용히 만들 뿐이라, 서버는 `LOGBOOK_POC_DIR` 이 없는 것처럼 동작한다. 반드시 `$env:` 를
쓴다):

    $env:LOGBOOK_POC_DIR = '<share>\_poc\web'
    .venv\Scripts\uvicorn.exe probe_server:app --host 0.0.0.0 --port 9095

측정자는 서버를 띄운 직후 **페이지에 표시된 "저장 폴더" 문구가 `<share>\_poc\web` 인지 반드시
확인한다.** `out\web`(상대 경로)이 보이면 환경변수가 안 먹은 것이니 서버를 내리고 위 명령을
다시 확인한다.

**팀원 PC(크롬)**: `http://10.14.42.145:9095` 접속 → DRM 걸린 로컬 파일을 업로드한다. 결과는
페이지에 파일별로 JSON 한 줄씩 쌓이고, 서버 쪽에도 `<save_dir>\upload_log.jsonl`(UTF-8, 한 줄에
`{at, client, name, size, received_sniff, saved_sniff, save_dir}`)로 남는다. `received_sniff` /
`saved_sniff` 가 `"drm"` 이면 크롬 업로드 경로에서도 DRM 이 유지된 것이고, `"zip"`/`"pdf"` 등이면
평문으로 도착한 것이다.

### 실험 6 문제 해결 순서 (팀원 PC 에서 접속이 안 될 때)

1. 145 자기 자신에서: `curl http://127.0.0.1:9095` — 서버 자체가 살아있는지 확인.
2. 팀원 PC PowerShell: `Test-NetConnection 10.14.42.145 -Port 9095` — 네트워크 경로/포트 도달성
   확인.
3. 145 (관리자 권한)에서 방화벽 규칙 확인·추가:

       netsh advfirewall firewall show rule name=all | findstr 9095
       netsh advfirewall firewall add rule name="Logbook PoC 9095" dir=in action=allow protocol=TCP localport=9095

4. 그래도 안 되면 **IT 에 145 → 팀원 PC 대역 9095 인바운드 방화벽 허용을 요청**한다(사내 네트워크
   방화벽은 로컬 `netsh` 로 못 고친다).

## 6. 출력 형식 (2026-09-28 코드 리뷰 이후)

- **exp4 (`owner_check.py`)**: 최상위가 `{"rows": [...], "summary": {...}}` 로 바뀌었다(과거엔 배열
  하나였다). 각 row 는 **항상** `{path, sid, owner, account, sid_type, is_user, lookup_error, error,
  walk_error}` 9개 키를 갖는다(성공/실패 무관 — 없는 값은 `None`/`False`). `error` = 그 파일 자체를
  못 읽음(권한 없음 등), `lookup_error` = SID 는 읽혔지만 계정 이름 조회만 실패(orphan SID, 도메인
  에서 지워진 계정). 폴더 순회는 `os.walk(onerror=...)` 라 하위 폴더 나열 자체가 실패해도(권한
  없음) 전체 실행이 죽지 않고 행으로 남는데, 이 행은 **특정 파일이 아니므로** `walk_error=True`
  로 따로 표시하고 `summary.files`(파일 수)에서 뺀다(대신 `summary.walk_errors`). `summary` =
  `{files, user_owned, group_owned, orphaned_sid, read_failed, walk_errors}`.
- **exp5 (`bdf_bench.py`)**: **pyNastran 을 쓰지 않는다(폐기 — 사용자 결정).** 대신 WorkBench 코드를
  최대한 재사용한다(`docs/reuse-inventory.md` §1·§9) — `split_fields`·`is_new_card`·`read_records`
  의 연속행 병합 로직은 `HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py`
  (46·245·249행)를 그대로 가져왔고, 대형 필드(`GRID*` 등 16칸)는 bridge 에 없어
  `C:\Coding\Csharp\Projects\FemScanner\FemScanner\Parsers\CardReader.cs` 의 `ReadLargeField()` 를
  이식했다. 카드 값은 항상 ASCII 라 주석이 깨져도(`had_replacement_chars`) 카드 파싱 결과는
  영향받지 않는다(`read_text(encoding="utf-8", errors="replace")`).
  - ⚠ **대형 필드 이식 2차 수정(2026-09-28 재재검토, Critical)**: 원본 `ReadLargeField()` 를 그대로
    옮긴 1차 이식은 (a) 빈 16칸 필드를 건너뛰어(`if token:`) 그 뒤 필드가 한 칸씩 밀리고, (b)
    cols 73~80(연속행 매칭 식별자)을 5번째 데이터 필드로 잘못 읽는 결함이 있었다. Patran/FEMAP
    표준 `GRID*`(CP 를 비우고 col 73 에 `*`)에서 실제로 값이 밀려 `grid_cp_nonzero` 가 틀리게
    셌다. 지금은 위치 기반으로 정확히 4개(cols 8~72)만 읽고 빈 칸도 `''` 로 보존하며, cols
    72~80 은 아예 보지 않는다.
  - INCLUDE 는 **전체 텍스트**를 따로 스캔한다(`find_includes`, `all_cards` 처럼 벌크 구간만
    보지 않는다) — INCLUDE 는 `BEGIN BULK` 이전(케이스 제어부)에도 올 수 있어서다.
  - 파싱(`parse_bdf`)과 경량 xref(`cross_reference`)를 분리해 기록한다. xref 는 (a) 필드2 가 PID 인
    요소 카드(CQUAD4·CBAR·… — **CONROD/CELAS2 는 필드2 가 PID 가 아니라 제외**)의 참조
    Property 존재 여부(`xref_ok`/`xref_errors`), (b) 요소가 참조하는 GRID ID 존재 여부
    (`missing_grid_refs`, CQUAD4/CQUAD8/CTRIA3/CTRIA6/CBAR/CBEAM/CROD/CONROD/CBUSH/CSHEAR 만) 두
    가지다. pyNastran 급의 완전한 상호참조(재질·좌표계 변환·중복 정의)는 아니다.
    ⚠ `ok: true` 는 **파일을 끝까지 읽고 파싱하는 데 성공했다는 뜻일 뿐**이다 — 파싱 품질(카드를
    빠짐없이 이해했는가)은 `ok` 가 아니라 `unknown_cards`(모르는 카드명)·`xref_ok`(참조 무결성)로
    따로 판단한다. `unknown_cards` 가 비어 있지 않거나 `xref_ok=false` 여도 `ok` 는 여전히
    `true` 일 수 있다.
  - **카드 특징 탐지**(진단용, 침묵하지 않는다): `all_cards`(벌크 구간에서 본 모든 카드명별
    개수) · `unknown_cards`(위 카드 집합 밖의 이름만) · `continuation_lines` · `include`
    (INCLUDE 문 경로 목록) · `coords`(CORD1x/CORD2x 개수) · `grid_cp_nonzero`/`grid_cd_nonzero`
    (GRID 필드2/필드6 이 0 이 아닌 카드 수) · `tab_lines`(탭 문자가 있는 줄 수) ·
    `large_field_cards`(대형 필드로 쓰인 카드 수) · `grid_cards`(GRID 카드 원본 개수 — `nodes`
    는 고유 ID 수라 다를 수 있다).
  - **⚠ 한계**: INCLUDE 는 **경로만 기록**하고 내용을 따라 읽지 않는다(참조 파일의 카드는
    통계에 없다). CORD1x/CORD2x 는 **존재만 감지**한다 — 좌표계 변환(GRID 의 CP/CD 를 실제
    좌표로 계산)은 하지 않는다. `all_cards`/`unknown_cards` 는 `BEGIN BULK`~`ENDDATA` 구간만
    본다(케이스 제어부의 `SUBCASE`·`SPC =` 같은 줄은 제외) — `BEGIN BULK` 자체가 없는 파일
    (펀치)은 처음부터 전부 벌크로 본다.
  - 펀치 판정(`punch`)은 주석에 "BEGIN BULK" 라는 문구가 있어도 속지 않는다(실제 카드 줄만
    본다). 폴더 순회는 exp4 와 같은 이유로 `os.walk(onerror=...)`.
  - 실사 표본(선택, 로컬에 있을 때만): `InHouseProgram/ModuleOceanMoving/JungbanBDF/
    jungbanBDF_A.bdf` — CQUAD4+CTRIA3 합계 27,088 로 확인됨(`parse_sec≈0.23s`).
- **exp7 (`longpath_check.py`)**: 실행마다 `_poc\longpath_<uuid8>\` 처럼 고유한 폴더를 쓴다(이전
  실행 잔재를 건드리지 않는다). 접두사 없이/있이 두 시도가 서로 다른 마지막 폴더명
  (`..._무접두사`/`..._접두사`)을 써서 한쪽이 만든 폴더를 다른 쪽이 그냥 재사용하지 않는다.
  `python`(`sys.version`)과 레지스트리 `HKLM\...\FileSystem\LongPathsEnabled` 값
  (`long_paths_enabled`, 읽기 실패 시 `None`)을 같이 기록한다. `file_path_len` 에 시도별
  실제 파일 경로(디렉터리+파일명) 길이를 남긴다.
- **exp1 (`drm_check.py`)**: 행마다 `{path, size, sniff, open, plaintext}`. `sniff` 는 첫 16바이트
  매직으로만 판별(`"drm"`/`"zip"`/`"pdf"`/`"unknown"`/`"error ..."`), `open` 은 실제 추출
  라이브러리(pymupdf/python-pptx/openpyxl)로 열어 본 결과(`"ok ..."`/`"fail ..."`/`"skip"`).
  `plaintext` 는 `sniff` 가 zip/pdf **이면서** `open` 이 성공했을 때만 `true` — zip/pdf 헤더만
  보고 평문으로 오판하지 않는다.
- **exp2 (`move_check.py`)**: `{before, after_copy, after_rename, after_file_move}` 각각
  `drm_check.check()` 스키마의 배열. `rename_error`/`samples_error` 키는 실패했을 때만 나타난다
  (`os.rename` 실패 시 `after_file_move` 는 빈 배열로 남는다 — ③ 단계는 ② 가 성공해야 의미가
  있어서 건너뛴다).
- **exp3·6 (`probe_server.py`)**: 업로드 응답/로그 행은
  `{at, client, name, size, received_sniff, saved_sniff, save_dir}`. `save_dir` 은 그 요청을 처리한
  서버 인스턴스가 실제로 쓴 저장 폴더 경로라, 환경변수가 잘못 설정된 실행을 화면/로그만으로
  바로 알아챌 수 있다.

## 7. 정리

실험이 끝나고 결과를 `RESULTS.md` 에 다 옮겼으면, **폴더 소유자(작업 요청자)에게 확인 후**
`<share>\_poc\` 를 통째로 지운다(DRM 샘플·팀 BDF 등 임시 표본이 공유 폴더에 남지 않게 한다).
