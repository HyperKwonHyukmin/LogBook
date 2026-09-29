# Logbook 00 — 사전 실험(PoC) 결과 시트

## 측정 정보

| 항목 | 값 |
|---|---|
| 측정일 | (YYYY-MM-DD 기입) |
| 측정자 | (이름/사번 기입) |
| 145 Python 버전 | (`longpath_check.py` 결과의 `python` 필드 값 붙여넣기 — 예: `3.11.6 (tags/v3.11.6:...) [MSC ...] on win32`) |
| 145 `LongPathsEnabled` | (`longpath_check.py` 결과의 `long_paths_enabled` 값 — `true`/`false`/`null`) |

> 측정은 `README.md`의 "실행 순서" 표 순서대로 진행하고, 각 스크립트의 `-o out\expN.json` 산출물을
> 그대로 두고(제출물) 이 표에는 핵심 값만 옮긴다. 개발 PC 예비 측정 → 145 본측정 순으로 채운다.

## 결과표

| # | 실험 | 성공 기준 | 결과 (개발 PC 예비) | 결과 (145 본측정) | 판정 |
|---|---|---|---|---|---|
| 1 | 공유 폴더 문서 평문 읽기 (`drm_check.py`) | samples 표본 전 파일 `plaintext: true`<br>(1-대조: 개인 PC 로컬 원본은 `sniff: drm`) | **3개 중 plaintext=true 3개** (pdf 8쪽·xlsx 3시트·pptx 7슬라이드)<br>대조: 미측정(개인 PC 원본 필요) | | ☐ PASS ☐ FAIL |
| 2 | 이동·복사 후 평문 유지 (`move_check.py`) | `after_copy`/`after_rename`/`after_file_move` 모두 `plaintext: true`, `rename_error` 없음 | after_copy: 3/3 · after_rename: 3/3 · after_file_move: 3/3 plaintext · rename_error: 없음 | | ☐ PASS ☐ FAIL |
| 3 | 크롬 업로드 평문 여부 (`probe_server.py` `/upload`) | `received_sniff ≠ drm` | received_sniff=<br>saved_sniff=<br>save_dir=(공유 경로였는지 기록 — 공유 사용 증빙) | | ☐ PASS ☐ FAIL |
| 4 | 파일 소유자 식별 (`owner_check.py`) | `summary.user_owned` 가 대부분이고 `account` 가 업로드한 사람 계정과 일치 | files=3 / user_owned=3 / group_owned=0 / orphaned_sid=0 / read_failed=0 / walk_errors=0 (account=`a476854`, 올린 사람과 일치) | | ☐ PASS ☐ FAIL |
| 5 | BDF 파싱 — 자체 파서 (`bdf_bench.py`) | 팀 BDF 소·중·대 전부 `ok: true`(=파일을 끝까지 읽고 파싱하는 데 성공. 파싱 **품질**은 판정 기준이 아니고 `unknown_cards`/`xref_ok` 로 별도 관찰만 한다); 대형 모델 `parse_sec` 기록 | 1개만 측정: `3454-35020-A505080_20251021_final.bdf`(0.27MB) ok=true, parse_sec=0.085 (CBEAM 3,657·RBE2 438·CONM2 240, 노드 3,613)<br>개발 PC 표본 `jungbanBDF_A.bdf`(3.2MB, CQUAD4 27,088) parse_sec=0.23 (테스트) · **중·대형 표본 추가 필요** | | ☐ PASS ☐ FAIL |
| 6 | 145:9095 도달성 (`probe_server.py` `/`) | 팀원 PC 크롬에서 페이지와 접속 IP 표시 | (개발 PC 자가 접속으로 대체 확인) | 접속 IP 표시 확인: | ☐ PASS ☐ FAIL |
| 7 | 긴 경로·한글 경로 (`longpath_check.py`) | `with_prefix: ok` | with_prefix=**ok** / without_prefix=**fail**(파일 경로 350자) / long_paths_enabled=**false** → `to_long()` 강제 필요 | | ☐ PASS ☐ FAIL |

### 실험 5 부속 — 변환기 요구사항 도출 (팀 BDF 소·중·대 합산)

`bdf_bench.py` 출력의 진단 필드를 모두 더해, 04(변환기) 계획의 파서 범위에 반영할지 판단한다.
값이 0 이 아니면 해당 기능을 MVP 필수 항목 후보로 올린다.

| 필드 | 소 | 중 | 대 | 합계 | MVP 반영 필요? |
|---|---|---|---|---|---|
| `unknown_cards` (카드명별 개수) | {} (예비) | | | | ☐ |
| `large_field_cards` | 0 (예비) | | | | ☐ |
| `include` (경로 목록 존재 여부) | 없음 (예비) | | | | ☐ |
| `coords` (CORD1x/CORD2x 개수) | {} (예비) | | | | ☐ |
| `grid_cp_nonzero` | 0 (예비) | | | | ☐ |
| `grid_cd_nonzero` | 0 (예비) | | | | ☐ |
| `tab_lines` | 0 (예비) | | | | ☐ |
| `xref_ok` (전 파일 true 인가) | true (예비) | | | | — |
| `missing_grid_refs` (합계) | 0 (예비) | | | | ☐ |

## 판정 규칙

- **1 실패**(평문으로 안 읽힘) → 설계 문서 2.1·5.1(공유 폴더 직접 읽기 전제) 재검토, 01(스캐폴딩) 착수 보류.
- **2**: `os.rename`/`os.replace` 만 성공하고 나머지는 상관없음 → Vault 이동 로직은 **rename/replace 만
  사용**(설계 유지, `shutil.copy2` 는 임시 스테이징에만). 모두 실패(암호화되거나 예외) → 이동 전략 재검토.
- **3 실패**(`received_sniff == "drm"`) → 크롬 브라우저 업로드는 신뢰하지 않고 **거부 + "탐색기로
  Inbox 폴더에 복사해 주세요" 안내**로 대체(설계 5.1 그대로 — 애초에 브라우저 업로드를 1급 경로로
  두지 않는다).
- **4**: `group_owned`/`orphaned_sid` 비율이 크면(대부분이 `user_owned` 가 아니면) → 소유자 자동
  판별을 접고, 업로드 화면에서 **"내가 올렸어요" 수동 지정만** 사용.
  ⚠ **개발 PC 예비 측정 결과는 이 판정에 결정적이지 않다** — 개발 PC의 로컬 표본은 흔히 관리자
  권한 계정으로 만들어져 있어, 실제로는 개인 소유 파일이어도 소유자가 `BUILTIN\Administrators`
  같은 그룹 SID 로 찍혀 `group_owned` 로 잡힌다(관리자 계정이 파일을 만들면 OS 가 소유자를 그
  계정이 속한 관리자 그룹으로 남기는 경우가 흔하다). **145 본측정**(공유 폴더에 일반 사용자
  계정으로 올린 표본) 결과를 기준으로 판정한다.
- **5**: 어떤 파일이라도 `ok: false` → 원인(카드 미지원/인코딩/거대 파일 등) 분석 후 04 계획의
  파서 범위에 반영. `unknown_cards`·`large_field_cards`·`include`·`coords`·`grid_cp_nonzero`/
  `grid_cd_nonzero`·`tab_lines`·`missing_grid_refs`(합계) 중 하나라도 0 이 아니면, 또는
  `xref_ok` 가 전 파일 `true` 가 아니면 그 카드/기능을 **04 계획의 MVP 필수 항목**으로 올린다.
  ⚠ `ok: true` 는 "파일을 끝까지 읽고 파싱했다"는 뜻일 뿐 파싱 **품질**의 보증이 아니다 — 품질은
  항상 `unknown_cards`/`xref_ok` 로 따로 본다(위 부속 표가 그 기준이다).
  대형 모델 `parse_sec > 60s` 면 웹 요청-응답 동기 처리 대신 **워커 타임아웃·야간 배치 처리**를
  설계에 반영한다.
- **6 실패**(팀원 PC 에서 접속 불가) → IT 에 145:9095 인바운드 방화벽 허용을 요청하고, **허용되기
  전에는 배포하지 않는다.**
- **7**: `with_prefix` 도 실패 → 긴 경로 전략 자체를 재검토(폴더 구조를 얕게 재설계).
  `without_prefix` 만 실패(=접두사가 있어야만 됨) → 코드 전 영역의 파일 접근을 반드시
  `to_long()` 경유로 강제(누락 시 260자 초과 파일에서 조용히 실패하므로).

## 결론

☐ 설계 유지
☐ 부분 수정 (항목: ________________________)
☐ 재설계

## 참고: 부수 발견

`bdf_bench.py` 의 대형 필드(large field) 파싱을 WorkBench FemScanner
(`C:\Coding\Csharp\Projects\FemScanner\FemScanner\Parsers\CardReader.cs:33`)를 참고해 이식하는
과정에서, FemScanner 자체의 결함 2가지를 발견했다(PoC 파서에서는 수정 반영, FemScanner 원본은
미수정 — Logbook 범위 밖):

1. **대형 필드를 `*` 로 시작하는 연속행에서만 감지한다.** 그래서 `GRID*` 카드의 **첫 줄**은
   대형 필드(16칸)가 아니라 **일반 8칸 고정 필드로 잘못 읽힌다** — 표준 `GRID*` 포맷(1행에
   ID·CP·X1·X2, 2행 첫 칸에 `*`)에서 1행 필드가 밀린다.
2. `ReadLargeField()` 가 **빈 필드를 건너뛰어**(`if token:`) 그 뒤 필드가 한 칸씩 밀리고,
   **cols 73~80(연속행 매칭 식별자)을 5번째 데이터 필드로 잘못 읽는다.**

두 결함 모두 PoC 의 `bdf_bench.py` 이식본에서는 위치 기반 고정 파싱으로 수정했다
(`README.md` "출력 형식" 절 참고). WorkBench 의 `InHouseProgram` BDF Scanner 가 대형 필드
포맷(`GRID*` 등)의 실제 모델을 다룬다면 같은 증상(필드 밀림)이 나올 수 있으니, 이 메모를
근거로 별도 이슈로 다룰 것 — 이번 Logbook PoC 작업 범위에는 포함하지 않는다.
