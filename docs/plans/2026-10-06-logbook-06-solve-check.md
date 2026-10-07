# 06 — 해석 검증: Nastran 이 실제로 도는 모델인지 확인해 모델 특성에 남긴다

선행: 04a(변환·`DeckReader`), 05(워커·운영 화면). 사용자 결정(2026-10-06):
경계조건 = **그룹마다 Z 최하단 고정**, 실행 권한 = **로그인한 모든 사용자**, 실행 시점 = **버튼으로만**(+관리자 일괄),
**원본 BDF 는 절대 건드리지 않는다**(해석용 사본만 만들고 버린다), **오류가 있으면 오류 유형을 모델 특성에 적는다**.

목적은 결과(응력·변위)가 아니라 "이 모델이 해석이 돌아가는가" 하나다.

## 1. 원본 불변 원칙

- 원본 파일(Vault·staging)은 **읽기만** 한다. 쓰기·이름 바꾸기·덮어쓰기 금지.
- 해석용 입력 BDF 는 **워커 PC 의 로컬 임시 폴더**에만 만들고, 판정이 끝나면 폴더째 지운다.
  공유 폴더·Vault·Entry 파일 목록 어디에도 남기지 않는다(파일 목록에 새 파일로 붙이지 않는다).
- 보관하는 것은 f06 하나뿐이고, 파생 폴더(`derived/_solve/<key[:2]>/<key>.f06`)에 둔다 — `.lbm`·썸네일과 같은 취급.
- 테스트: 검증 전후 원본 파일의 sha256·mtime 이 같다(`test_original_untouched`).

## 2. 해석 입력 만들기 — `backend/app/solve/deck.py` (순수 함수)

1. 원본을 기존 `DeckReader` 규칙으로 읽되, **Bulk 줄 원문**을 모은다. INCLUDE 는 그 자리에 내용을 풀어 넣어
   파일 하나로 만든다(경로 해석·깊이·순환 검사는 `DeckReader` 와 같게). 빠진 INCLUDE 가 있으면 해석하지 않고
   `확인 못 함 · INCLUDE 누락` 으로 끝낸다.
2. 원본의 Executive/Case Control 은 쓰지 않는다. 새로 쓴다:
   ```
   SOL 101
   CEND
   ECHO = NONE
   SPC = <sid>
   LOAD = <sid>
   BEGIN BULK
   <원본 Bulk 원문>
   GRAV, <sid>, , 1.0, 0., 0., -1.
   SPC1, <sid>, 123456, <노드…>
   ENDDATA
   ```
   출력 요청은 넣지 않는다(f06 을 작게).
3. 원본의 SPC·SPC1·LOAD·GRAV·FORCE 등 **경계조건·하중 카드는 지우지도 고치지도 않는다.** Case Control 이 고르지
   않으므로 해석에 쓰이지 않을 뿐이다. 우리 `sid` 는 990001 부터, 원본의 SPC/LOAD 계열 SID 와 겹치지 않는 값.
4. 고정 노드: 부재(CBAR·CBEAM·CROD·CONROD)·쉘(CTRIA3·CQUAD4 등)·RBE 연결로 독립 그룹을 union-find 로 나누고
   (프런트 `lib/modelGroups.js` 와 같은 규칙, Python `bdf/groups.py`), 그룹마다 Z 최솟값에서 1mm 안의 노드를 모두 고정한다.
   요소가 없는 GRID 는 고정하지 않는다(AUTOSPC 가 처리).
5. 원본의 PARAM 은 그대로 둔다 — 원본 모델의 성질이므로 판정에 포함된다.

## 3. 실행·판정 — 워커 작업 `solve_check`

- `jobs.enqueue(db, "solve_check", file_id)`. `HEAVY_JOB_TYPES` 에 넣고 **가장 낮은 우선순위**(변환·추출 뒤).
- 실행: `<LOGBOOK_NASTRAN_EXE> deck.bdf scr=yes old=no batch=no`, cwd = 임시 폴더, 타임아웃 `LOGBOOK_SOLVE_TIMEOUT`(기본 1800s).
  실행 중 1분마다 job `updated_at` 을 갱신해 '멈춘 작업'(10분) 재대기에 걸리지 않게 한다. 타임아웃이면 프로세스 트리를 끝낸다.
- 설정(`config.py`): `nastran_exe` = `LOGBOOK_NASTRAN_EXE`, 기본은 PATH 의 `nastran` → 없으면
  `C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe`. `solve_timeout` = `LOGBOOK_SOLVE_TIMEOUT`.
- 판정(`backend/app/solve/f06.py`, 순수 함수):

| 결과 | 조건 |
|---|---|
| `pass` 해석 가능 | f06 이 있고 `FATAL` 이 없다 |
| `fail` 해석 불가 | f06 에 `*** USER FATAL` / `SYSTEM FATAL` 이 있다 |
| `error` 확인 못 함 | Nastran 없음·라이선스·타임아웃·f06 없음·INCLUDE 누락 — **모델 결함이 아니다** |

- **오류 유형**(모델 특성에 적는 값). FATAL 코드 + 메시지 키워드로 분류하고, 모르는 것은 `기타`:

| 유형 키 | 표시 | 근거 |
|---|---|---|
| `mechanism` | 구속 부족·메커니즘 | 9050, `MECHANISM`, `MAXRATIO` |
| `rbe_dependent_dup` | RBE 종속 자유도 중복 | 2101, `DEPENDENT` + `MORE THAN ONCE` 류 |
| `undefined_ref` | 정의 안 된 참조(GRID·PID·MID·CID) | `UNDEFINED`, `REFERENCES … NOT DEFINED` |
| `card_format` | 카드 형식 오류 | 316, `ILLEGAL DATA`, `FORMAT` |
| `property_value` | 재료·속성 값 오류 | `MATERIAL`·`PROPERTY` + 값 오류 |
| `bad_geometry` | 요소 형상 불량 | `BAD GEOMETRY`, `WARPED`, `ZERO LENGTH` 류 |
| `other` | 기타 FATAL `<code>` | 위에 안 맞음 |

  `error` 의 유형: `nastran_missing`·`license`·`timeout`·`include_missing`·`no_f06`.
  실제 코드·문구 목록은 구현 때 WorkBench `docs/operations/nastran-diagnostics.md`·실측 f06 으로 채운다.
- 같이 남기는 값: FATAL 최대 5건(코드·첫 줄 메시지), WARNING 수, 고정 노드 수·그룹 수, 소요 초, 실행자, 시각, 모델 key.

## 4. 저장 — 새 테이블 `solve_checks`

`file_id`(PK, FK files) · `state`(queued/running/pass/fail/error) · `error_types`(JSON, 유형 키 목록) ·
`fatals`(JSON) · `warning_count` · `message`(String 500) · `spc_nodes` · `groups` · `elapsed` ·
`model_key` · `has_f06` · `requested_by` · `requested_at` · `finished_at`.
파일당 1행, 다시 검증하면 덮어쓴다. `model_key` 가 현재 `ModelSummary.key` 와 다르면 화면은 "다시 검증 필요".
`registry.json`·재구축(05)에는 넣지 않는다 — 다시 돌리면 나오는 파생값이다.

## 5. API

- `POST /api/files/{id}/solve-check` — 로그인 사용자. 모델 변환이 `done` 이어야 하고, 이미 queued/running 이면 그대로 돌려준다. 감사 `SOLVE_CHECK`.
- `GET /api/files/{id}/solve-check` — 위 행(없으면 `state: null`).
- `GET /api/files/{id}/solve-check.f06` — 보관한 f06 내려받기.
- `GET /api/files/{id}/model` 응답에 `solve` 요약(state·error_types)을 붙인다.
- 관리자: `POST /api/admin/ops/solve-check` — 미검증(또는 `force` 시 전체) 모델을 대기열에. CLI `enqueue-solve-check [--all]`.

## 6. 화면

- **모델 미리보기(ModelPreview)** 요약 줄 옆 배지: `미검증` · `검증 중…` · `✓ 해석 가능 (경고 N)` ·
  `✗ 해석 불가 · 구속 부족·메커니즘` · `확인 못 함 · Nastran 없음` · `다시 검증 필요`.
  옆에 [해석 검증]/[다시 검증] 버튼. 펼치면 FATAL 목록, "그룹 N개 · 최하단 노드 M개 고정 · GRAV −Z" 설명, f06 받기.
  "원본 파일은 바뀌지 않습니다. 해석용 사본으로만 확인합니다." 한 줄을 버튼 옆에 둔다.
- **전체 화면 뷰어 '점검' 탭**에 같은 카드. 검증 결과가 있으면 고정한 노드를 3D 에 표시(토글).
- **운영 페이지**: 동작 목록에 '해석 검증 일괄', 실패 작업 목록·라벨에 `solve_check`.

## 7. 테스트

- Nastran 없이(순수 함수): 입력 BDF 생성(Executive 교체·INCLUDE 풀기·SID 충돌 회피·원본 경계조건 카드 보존),
  그룹별 최하단 선택, f06 판정·유형 분류(합성 f06: 정상·9050·2101·316·라이선스 실패·빈 파일), 원본 불변.
- 워커: 가짜 실행기(fake runner)로 pass/fail/timeout/missing 경로, 하트비트.
- 실측(이 PC, `C:\MSC.Software\MSC_Nastran\20131`): 가상 호선 9999 합성 모델 3개 — 정상, 떨어진 그룹 없이 RBE 종속 중복(fail·`rbe_dependent_dup`), INCLUDE 포함(pass).
  dev 스택 규칙대로 `logbook_test` + scratchpad 저장소 + 별도 포트.

## 넣지 않음

응력·변위 결과 보기, 사용자 지정 경계조건·하중, 변환 후 자동 검증, 검색 필터(필요하면 나중에).

## 145 반영

`git pull` + 재시작. **145 에 MSC Nastran 이 설치돼 있어야 한다**(경로가 다르면 `LOGBOOK_NASTRAN_EXE`).

## 구현 메모 (2026-10-06, 백엔드)

모듈: `bdf/groups.py`(연결 그룹) · `solve/deck.py`(입력 BDF) · `solve/f06.py`(판정·분류) · `solve/runner.py`(실행) ·
`solve/job.py`(작업·응답 모양) · `routers/solve.py`(API). `DeckReader` 에 `raw_sink` 를 더해 Bulk 줄 원문을 같은 INCLUDE
규칙으로 받는다(기존 동작·테스트는 그대로).

계획과 달라진 점·실측으로 정한 점:

- **고정 노드에서 RBE 종속 노드를 뺀다**(RBE2 종속 절점·RBE3 기준 절점). 종속 자유도에 SPC 를 걸면 모델 결함이 아닌데도
  FATAL 이 난다. 최하단 Z 는 '요소가 쓰는 비종속 노드' 중에서 잰다.
- **SPC1 은 한 줄에 노드 6개씩 여러 장**(연속 줄 없음). 고정 노드가 없으면(드묾) `SPC =` 줄을 넣지 않는다.
- 원본 Bulk 의 줄 끝 주석(`$…`)은 떼고 넘긴다(데이터 칸은 탭·칸 배치까지 원문 그대로) — 한글 주석 인코딩 문제를 피한다.
- 우리 sid 는 SPC/SPC1/SPCADD/SPCD/LOAD/GRAV/FORCE*/MOMENT*/PLOAD*/ACCEL*/RFORCE/TEMP/MPC 계열 세트 번호와,
  LOAD·SPCADD·MPCADD·DLOAD 가 묶는 번호를 모두 피한다.
- `model_key` 는 검증 때 실제로 읽은 원본 바이트의 key(`DeckReader.digest`, 변환과 같은 계산) — 지금 `ModelSummary.key` 와
  다르면 `stale`.
- MSC Nastran 2013.1 실측: `batch=no` 는 Windows 에서 '사용할 수 없는 키워드' 경고만 내고 무시되며 nastran.exe 는 끝날 때까지
  기다린다. 결과 파일 이름은 소문자가 될 수 있다(`negE.bdf` → `nege.f06`) — 대소문자 무시로 찾는다.
- **RBE 종속 중복은 2013.1 에서 5289 (WRGMTD)** "DEPENDENT DEGREE-OF-FREEDOM … APPEARS ON MORE THAN ONE MPC OR RIGID
  ELEMENT ENTRY"(2101 은 뒤 버전) — 둘 다 `rbe_dependent_dup`.
- 실측 분류: 9050 SEKRRS → mechanism · 2007/2042 "REFERENCES UNDEFINED …"·6440 "REFERS TO AN INVALID PROPERTY" →
  undefined_ref · 9994 BULKPM "illegal real value"·307 "ILLEGAL NAME FOR BULK DATA ENTRY" → card_format ·
  9994 "MAT1 … E:-206000. >= 0.0"·6498(PBEAML H 치수) → property_value · 4296 "ILLEGAL GEOMETRY"·
  9994 BULFUN "repeated at locations GA and GB"(길이 0 CBAR) → bad_geometry.
- 연쇄 코드 6624·9002·208·102(경고 285)는 원인 FATAL 이 있으면 뺀다. **6498 은 원인을 본문(6623)에 싣는다** —
  다른 원인이 없으면 6498 을 원인으로 쓰고 메시지는 'API MESSAGE FOLLOWS.' 대신 실린 문구를 보인다.
- fatals 의 message: 첫 설명 줄. 9994 처럼 첫 줄이 '… near line N' 뿐이면 다음 줄을 ' — ' 로 잇는다(최대 300자).
- error 유형을 몇 개 더했다: `model_not_ready`(변환 미완·휴지통) · `file_missing` · `drm` · `too_large` · `model_error`
  (모두 드묾). 작업이 재시도 끝에 실패하면 `error` + `other` + '검증 작업 실패: …'.
- f06 이 있어도 `END OF JOB` 이 없고 FATAL 도 없으면(중간에 멈춤) `error · no_f06`. 라이선스는 FATAL 3060·'LICENSE' 문구 또는
  (f06 이 없거나 끝나지 않았을 때) 표준출력·.log 의 'Checkout Failed'·'license … not available/denied' 로 가린다 — 실제 라이선스
  실패 f06 은 이 PC 에서 재현하지 못해(라이선스 서버가 이 PC) 합성 문구로만 시험했다.
- `GET /model` 응답의 `solve` 는 변환 기록이 없을 때도 붙는다(`state: null`).
- 휴지통 영구 삭제(`ops/purge.py`)가 `solve_checks` 행과 `solve_check` 작업도 지운다. 실패 작업 '재시도'는 검증 행을 queued 로 되돌린다.
- 워커: 실행 중 60초마다 별도 세션으로 `jobs.updated_at` + 워커 심장 박동을 갱신한다(운영 화면 '워커 멈춤' 10분에도 안 걸리게).
  검증 한 건이 무거운 작업 예산(120초)을 넘기므로 주기당 사실상 1건이다.

실측(이 PC, 2026-10-06, 가상 호선 9999 합성 모델, 원본 sha256·mtime 불변·임시 폴더 삭제 확인):
프레임(보+쉘, MAT1 RHO) pass 6.2s · RBE2 종속 중복 fail `rbe_dependent_dup`(5289) 5.4s ·
INCLUDE(여러 줄 따옴표 이름 + 개인 PC 절대경로) pass 5.7s · 떨어진 그룹 2개(그룹별 고정) pass 5.6s.
