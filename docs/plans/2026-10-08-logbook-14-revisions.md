# 14 — 한 자료 안 BDF 판(Revision) 묶음과 변경 비교

선행: 04a(BDF 파서·convert_model), 05(entry.json·재구축), 06(무거운 작업·박동), 07(모델 화면분할 비교 `/compare`),
11([변경하기]→[변경 완료]), 12(범주별 내용 서명 `bdf/signature.py`), 13(권한 `access.py`).
사용자 요청(2026-10-07): "하나의 목록에 여러 BDF가 Revision으로 들어갈 수도 있어. 이 경우에는 동일 목록에서 이를 확인하고
어떤 점이 달라졌는지도 비교할 수 있는 방안" → 범위 **A(판 묶음) + B(변경 요약) + D(판 흐름 줄)**.
**C(3D 변경 색 표시)는 다음 차례** — 이번에는 B 결과에 요소·절점 ID 목록을 상한 있게 남겨 C 의 재료로 둔다.

## 1. 판 묶음(A) — 규칙

대상: 한 Entry 의 모델 파일(`kind=model`, 휴지통 밖) 중 INCLUDE 조각(`model_summaries.state=include`)과
요소 없는 조각(`skipped/no_elements`)을 뺀 것. 변환 전 파일은 일단 대상이다(변환 뒤 조각으로 밝혀지면 빠진다).

### 1.1 이름 규칙(`app/revisions/naming.py`)

파일 이름 줄기(확장자 뺀 것)의 **끝**에서 판 표시를 반복해 떼어 낸다(대소문자 무시). 떼고 남은 줄기(구분자 `_ - . 공백` 정리)가
같으면 같은 계열이다.

| 표시 | 예 | 순서 값 |
|---|---|---|
| 판 번호 | `_r1` `-R2` `_rev3` ` v2` `_ver2` `.R0` | 번호 |
| 판 글자 | `Rev.A` `_revB` | A=1, B=2 … |
| 날짜 | `_20260930` `_2026-09-30` `_260930`(올바른 월·일만) | YYYYMMDD |
| 상태 낱말 | `_old`(−1) · `_수정`/`_변경`/`_new`(1) · `_재수정`(2) · `_latest`/`_last`(3) · `_final`/`_fin`/`_최종`/`_최종본`(4) | 순위 |
| 사본 번호 | ` (2)` `(3)` | 번호 |

- 한글 상태 낱말은 구분자 없이 붙어 있어도 뗀다(`모델최종`). 영문은 구분자가 있어야 뗀다(`modelfinal` 은 그대로).
- 줄기에 표시가 없으면 **바로 위 폴더 이름**에서 표시를 찾는다(`R1/model.bdf`, `R2/model.bdf`). 계열 열쇠 = (윗 폴더들 + 표시 뗀 마지막 폴더, 표시 뗀 줄기).
  그래서 `hold1/model.bdf` 와 `hold2/model.bdf` 는 다른 계열이다(폴더 이름 `hold1` 은 판 표시가 아니다).
- 순서 열쇠: `(최종 묶음, 판 번호(없으면 −1), 날짜(없으면 0), 상태 순위, 사본 번호, 올라온 시각, 파일 id)`.
  최종 묶음 = `old` 만 있고 판 번호가 없으면 −1, `final/최종` 이 있고 판 번호가 없으면 +1(맨 뒤), 그 밖 0.
  → `deck.bdf < deck_r1 < deck_r2 < deck_final`, `deck_r3 < deck_r3_final`, 표시가 없으면 올라온 시각 순.
- 화면 판 이름(자동): 계열 안 모두가 서로 다른 판 번호를 갖고 있으면 `R<번호>`, 모두 서로 다른 판 글자면 `Rev.<글자>`,
  아니면 순서대로 `R0, R1, …`. 파일 이름에서 찾은 표시는 `mark`(툴팁)로 따로 준다. 사용자가 이름을 주면 그것(`label`, 최대 20자).

### 1.2 내용 규칙(이름으로 짝이 없는 파일만)

이름 규칙으로 혼자 남은 파일은
1. 다른 파일과 **형상 서명(12 `sig_geometry`)이 같으면** 같은 계열 후보로 합친다.
2. 그 두 파일을 이미 비교한 결과(B, `revision_diffs`)가 있고 절점·요소 **ID 자카드 ≥ 0.5** 면 합친다(`JACCARD_MIN`).
   비교는 계열 안 인접 쌍과 사용자가 고른 쌍만 하므로, 이 규칙은 사용자가 한 번 비교해 본 쌍에만 쓰인다(따로 ID 집합을 쌓지 않는다).
- **하중 경우 변형은 판이 아니다**: 표시 뗀 줄기에 `LC1`·`case2`·`SC3`·`load4`·`하중5` 같은 하중 경우 낱말이 있으면 내용 규칙으로 합치지 않는다
  (`model_LC1.bdf` / `model_LC2.bdf` 는 형상이 같아도 판이 아니다).
- 내용 규칙으로 이름 계열에 붙은 파일은 이름에 판 표시가 없으므로 **올라온 시각**으로 그 계열 사이에 끼운다(그 시각까지 올라온 판들 다음).
- 혼자인 파일은 계열이 없다(`series_key` NULL). 계열은 파일 2개 이상.
- ⚠ 규칙 2 때문에 **사용자가 계열 밖 파일과 '두 판 고르기'로 비교하면**, ID 가 크게 겹치는 경우 다음 다시 추정 때 그 파일이 계열에 들어온다
  (실화면에서 `frame_other.bdf`(절점 하나만 다른 모델)가 이렇게 R3 으로 들어왔다). 원하지 않으면 판 정리로 빼면 된다(정리는 다시 추정에 유지된다).

### 1.3 저장 — `model_revisions`

| 열 | |
|---|---|
| `file_id` PK, FK files CASCADE | |
| `entry_id` FK entries CASCADE, 색인 | |
| `series_key` VARCHAR(64) NULL | 자동 `n:<해시>`(이름) · `g:<서명 앞부분>`(형상) · `j:<id>`(자카드) · 사용자 `u:<entry>:<첫 id>`. NULL = 계열 없음 |
| `rev_order` INT | 계열 안 0부터 |
| `is_latest` BOOL | 계열마다 하나 |
| `label` VARCHAR(20) NULL | 사용자가 준 판 이름(자동 이름은 저장하지 않고 읽을 때 계산) |
| `manual` BOOL | 사용자가 정리한 행 |
| `updated_by`, `updated_at` | |

- **다시 추정(`sync`)**: 대상 파일 집합을 다시 구해, 대상이 아닌 행(삭제·이동·조각)은 지우고, `manual` 이 아닌 행만 자동 규칙으로 다시 정한다.
  - 정리된(manual) 계열과 이름·내용 규칙으로 이어지는 **새 파일은 그 계열 끝에 붙는다**. 그 계열의 최신판이 끝에 있었으면 최신판도 새 파일로 옮긴다
    (사용자가 중간 판을 최신판으로 정해 두었으면 그대로).
  - 자동 계열의 최신판 = 마지막 판.
- 다시 추정하는 때: 모델 변환이 끝날 때(워커, 조각 여부·서명이 이때 정해진다), 파일이 들어오고 나갈 때(확정·기존 자료에 추가·쪼개기·합치기·파일 옮기기),
  그리고 판 목록을 읽을 때 대상 파일 집합이 저장된 행과 다르면(자가 복구). CLI `revisions-refresh` 로 전체를 한 번에.
- **사용자 정리(판 정리 모드)**: 계열에서 빼기·넣기·새 계열 만들기, 순서 바꾸기, 최신판 지정, 판 이름. [완료] 한 번에 Entry 의 판 배치 전체를 저장한다
  (모든 대상 파일 행이 `manual`) — 감사 `ENTRY_REVISIONS` 한 줄(before/after = 계열별 파일 이름 목록과 최신판). [자동 추정으로 되돌리기]는 manual 을 모두 풀고 다시 추정한다(감사 같은 이름, after `{auto: true}`).
  - 동시 수정: 목록 응답의 `token`(행 상태 해시)을 저장 때 돌려보낸다. 다르면 409 `revisions_conflict`.
- 권한(13): 열람 = Entry 열람(볼 수 없으면 404). 수정 = `access.can_edit_entry`(초안·확정 같은 규칙, guest 403 `read_only_role`, 남의 자료 403 `not_uploader`). 휴지통 자료 409.
- 재구축(05): 판 정리는 사람이 한 일이라 **entry.json 에 `revisions`**(정리된 것이 있을 때만: `rel_path`·계열 번호·순서·최신판·판 이름)로 남기고
  재구축 때 되살린다. 자동 추정 결과·비교 결과(B)는 파생값이라 남기지 않는다(다시 계산). registry.json 은 바꾸지 않는다.

## 2. 변경 요약(B) — `revision_diff` 작업

두 모델(앞 판 a → 뒤 판 b)을 **ID 단위**로 비교한다. 같은 계열의 인접한 두 판은 자동으로, 그 밖에 사용자가 고른 두 판(같은 Entry 안, 계열 밖 파일도 가능)은 요청 때.

### 2.1 저장 — `revision_diffs`

`id` · `file_a`·`file_b`(FK files CASCADE, `uq(file_a, file_b)`) · `key_a`·`key_b`(비교한 원본 바이트 sha = `model_summaries.key`) · `rule_version`(`diff.VERSION`)
· `state` queued|running|done|error · `summary` JSON · `error` · `elapsed` · `requested_at`·`finished_at`.
- **캐시**: 행의 `key_a/key_b/rule_version` 이 지금 두 파일의 변환 key·규칙 버전과 같으면 그대로 쓴다. 다르면(다시 변환되어 내용이 바뀜) `stale` 로 보고 다시 대기열에 넣는다.
  다른 파일 쌍이라도 key 두 개·버전이 같은 끝난 행이 있으면 계산 없이 그 결과를 옮겨 쓴다.
- 상세(ID 목록·문장)는 파생 폴더 `20_Derived/_diff/<k[:2]>/<k>.rdiff`(gzip JSON, `k = sha256(key_a:key_b:v<VERSION>)`) — .lbm·f06 과 같은 취급,
  확장자는 DRM 이 감싸는 형식(.gz·.zip)을 피했다. 영구 삭제(휴지통 비우기) 때 행은 함께 지운다(파일은 내용 key 라 다른 쌍이 쓸 수 있어 남긴다).
- 작업: `jobs.HEAVY_JOB_TYPES` 에 `revision_diff`(대상 = `revision_diffs.id`). 두 덱을 차례로 읽어 간추린 사실만 남기고 카드 목록을 버린 뒤 비교한다.
  단계마다 박동(`worker.job_heartbeat`). 실패는 `state=error` + 이유(`file_missing`·`drm`·`too_large`·`model_not_ready`·`memory_error`·그 밖 예외 문구).
  재시도 끝 최종 실패도 error 로 남는다(`_final_failure`).
- 두 파일 모두 변환이 끝나야(`state=done`) 비교한다. 아니면 '변환 대기'(화면) / 요청은 409 `model_not_ready`.

### 2.2 비교 항목(범주는 12 서명과 같은 구분)

| 범주 | 요약(summary) | 상세(.rdiff) |
|---|---|---|
| 절점 | 수 a/b, 추가·삭제, **이동** 수·최대·평균 이동량(기본 좌표계 — `bdf.coords.resolve_coords`). 허용오차 `max(0.01, 1e-6 × 모델 대각선)` | 추가·삭제·이동 ID, 이동 큰 순 20개(ID, 거리) |
| 요소 | 수 a/b, 추가·삭제(카드 종류별), 연결 변경, 카드 종류 변경, PID 변경, 그 밖 칸(방향 벡터·오프셋·직접 입력 값) 변경 | 각 ID 목록, PID 변경 `{eid, a, b}`, 카드 변경 `{eid, a, b}` |
| 강체 | RBE2·RBE3·RBAR… 추가·삭제, 독립 절점 변경, 종속 절점 변경, 그 밖 변경(가중치 등) | ID 목록, 종속 변경 `{eid, added, removed}` |
| 속성 | PID 별 카드 비교 — 추가·삭제·값 변경, 두께(PSHELL T) 변경 수, 단면(PBARL/PBEAML DIM) 변경 수 | 문장 `PSHELL 12: T 10 → 12`, `PBEAML 5 I: DIM 300×150×10×12 → …` + 칸별 `{field, a, b}` |
| 재료 | MID 별 같은 방식(MAT1 E·G·NU·RHO…, MAT8·MAT2 칸 이름) | 문장 + 칸 |
| 하중·경계 | SPC(SPC·SPC1·THRU) 절점·성분 추가/삭제/변경, 하중 세트(SID)별 카드 수·힘 합·모멘트 합·GRAV 벡터·압력 합 변화, 바뀐 세트 수 | 세트 문장 `SID 10: FORCE 2 → 2개, 힘 합 (0, 0, −1000) → (0, 0, −1200)`, SPC `[sid, 절점, 성분]` |
| 질량 | CONM2·CMASS2·CMASS4 질량 합 a/b, 추가·삭제·변경 | `{eid, a, b}` |
| 해석 설정 | SOL a/b, Case Control 선택(12 `split_control` 의 load 문장 — SUBCASE·LOAD=·SPC=…) 추가·삭제, 그 밖 카드(PARAM·EIGRL…) 추가·삭제 | 문장 목록 |
| 겹침 | 절점·요소 ID 자카드 | |

- 값 비교는 12 의 `norm_field`(정수·실수 7자리·대문자)로 — 표기만 다른 것은 같다.
- 좌표계 정의(CORD*) 변경은 따로 세지 않는다 — 그 결과는 절점 이동으로 잡힌다. FORCE·MOMENT 의 CID 는 그 절점 위치의 기본 좌표계 벡터로 바꿔 더한다.
- ID 목록은 범주·종류마다 **최대 5000개**(`LIST_LIMIT`)로 저장하고, 넘으면 `truncated` 에 그 이름과 원래 개수를 적는다(화면 '앞 5000개만').
  문장 목록은 최대 2000줄. **C(3D 색 표시)는 이 ID 목록(추가·삭제·변경 요소, 이동 절점)을 그대로 쓴다.**
- 같은 내용이면 `identical: true`.

### 2.3 API

| 경로 | |
|---|---|
| `GET /api/entries/{id}/revisions` | 계열(판 목록·자동/사용자 이름·최신판·인접 비교 상태와 요약) + 계열 밖 모델 + `token` + `can_edit`. 인접 비교가 없거나 낡았으면 이때 대기열에 넣는다 |
| `PUT /api/entries/{id}/revisions` | `{token, series: [{file_ids, latest, labels}]}` — 판 정리 저장 |
| `POST /api/entries/{id}/revisions/reset` | 자동 추정으로 되돌리기 |
| `GET /api/files/{a}/diff/{b}` | 비교 상태·요약(대기열에 넣지 않음, 없으면 `state: null`) |
| `POST /api/files/{a}/diff/{b}` | 비교 요청(있으면 그대로, 낡았거나 실패면 다시). 같은 파일·모델 아님 422, 변환 전 409 |
| `GET /api/files/{a}/diff/{b}/detail` | 상세(gzip JSON) |

두 파일 중 하나라도 볼 수 없으면 404(13 — 존재를 숨긴다). 비교는 보기 동작이라 guest 도 요청할 수 있다(원본을 바꾸지 않는다).

## 3. 화면(D)

- **Entry 상세 파일 영역 위 '판' 줄**(계열이 있을 때만): 계열마다 `R0 → R1 → R2` — 판 단추(누르면 그 파일 미리보기, 최신판은 '최신' 표시),
  판 사이 화살표 자리에 변경 칩: `요소 +120 −8 · 두께 3건 · 하중 변경`(계산 전 '비교 중', 변환 전 '변환 대기', 실패면 '비교 실패: 이유', 같으면 '변경 없음').
- 칩을 누르면 그 아래 **변경 요약 패널**(제자리, 닫기): 범주별 섹션(절점·요소·강체·속성·재료·하중/경계·질량·해석 설정), 바뀐 속성·재료는 전후 값 표,
  ID 목록은 접기 + [복사], '앞 5000개만' 표시. [두 판 3D 나란히 보기] → `/compare?ids=a,b`(07).
- **두 판 고르기**: 같은 Entry 의 모델 두 개(계열 밖도)를 골라 [비교] → 같은 패널.
- **판 정리 모드**(올린 사람·관리자): [판 정리] → 계열마다 판 줄(▲▼ 순서, 최신판 고르기, 판 이름 칸, [계열에서 빼기]), 계열 밖 파일은 [넣을 계열 고르기 / 새 계열],
  [자동 추정으로 되돌리기] · [취소] · [완료](한 번에 저장, 이력 한 줄). 11 의 [변경하기]와 같은 문법 — 둘 중 하나만 열린다.
- **검색 결과 행·미리보기**: 계열이 있는 자료에 `판 3개 · 최신 R2` 한 줄 조각(`revisions` 요약 — 페이지당 한 번의 질의).
- **정리 대기 DraftCard**: 초안 안에 계열이 있으면 `판 a.bdf → a_r1.bdf` 한 줄(이름만, 비교 칩은 확정 뒤 상세에서).

## 4. 테스트

- 백엔드 `tests/test_revisions_14.py` — 이름 규칙(여러 표시·순서·폴더 표시·하중 경우 제외), 형상 서명 합치기, 자카드 합치기, 자동 이름,
  수동 정리 유지·새 파일 끝에 붙음·자동 되돌리기, 대상 파일(include 제외) 자가 복구, 권한(열람 404·수정 403·guest), entry.json·재구축,
  diff 범주별 합성 BDF 쌍, 같은 파일 → 변경 없음, 상한 잘림, 작업 큐(성공·실패·캐시 재사용·내용 바뀌면 무효), API.
- 프런트 vitest: `lib/revisions.test.js`(칩·문장·저장 본문), `components/revisions/*.test.jsx`(흐름 줄·칩 상태·요약 패널·판 정리 모드·두 판 고르기).
- 합성 데이터만(가상 호선 9999/9001/9002).

## 5. 결과 (2026-10-08)

### 테스트
백엔드 전체 pytest **828 passed**(19분 32초, 14 신규 `test_revisions_14.py` 53건) · 프런트 vitest **73 파일 / 494 테스트** · `npm run build` 통과(dist 갱신).
`lib/labels.test.js` 의 작업 종류 라벨 기대값에 `revision_diff` 를 더했다.

### 바뀐·새 파일
- 새: `backend/app/revisions/{__init__,naming,series,diff,job,service}.py`, `backend/app/routers/revisions.py`, `backend/tests/test_revisions_14.py`,
  `frontend/src/lib/revisions.js`(+test), `frontend/src/components/revisions/{RevisionSection,RevisionDiffPanel,RevisionEditor,RevisionBrief}.jsx`(+test 2).
- 수정(백엔드): `models.py`(ModelRevision·RevisionDiff), `jobs.py`(HEAVY_JOB_TYPES), `worker.py`(revision_diff 실행·최종 실패, 변환 뒤 판 묶음 갱신),
  `main.py`(라우터 — files 보다 먼저), `entries/service.py`(entry_to_dict `revisions`, 확정 합치기·쪼개기·합치기·옮기기 뒤 다시 추정),
  `entries/files.py`(entry.json `revisions`), `ops/rebuild.py`(되살리기), `ops/purge.py`(행·작업 지우기), `search/mysql_backend.py`(행 `revisions`), `cli.py`(`revisions-refresh`),
  `tests/test_convert_wiring.py`(무거운 작업 목록).
- 수정(프런트): `pages/EntryPage.jsx`(판 영역·[변경하기]와 판 정리 상호 잠금·이력 '판 정리' 줄), `components/search/{ResultList,EntryPreviewPanel}.jsx`,
  `components/inbox/DraftCard.jsx`, `lib/labels.js`(ENTRY_REVISIONS·revision_diff·오류 문구) + 테스트(`EntryPage.test.jsx`·`DraftCard.test.jsx`).

### DB
새 표 2개 `model_revisions`, `revision_diffs`(create_all 로 시작 때 생긴다). 기존 표 열 변경 없음.

### 성능(합성 40만 카드 × 2, 개발 PC, `scratchpad/rev14/perf.py`)
- 모델 하나(카드 38.4만: 절점 14.4만·쉘 14.4만·보 3.6만·PLOAD4 6만, 13MB) 읽기 0.9~1.3s + 간추리기 2~4s. 두 번째 모델은 첫 모델의 사실을 든 채라 읽기 3.6s + 간추리기 8.6s.
  비교 0.2~0.6s, 상세 gzip 14KB(ID 목록 상한 5000). 한 쌍 전체 약 15~20s.
- 최고 RSS 448MB(두 모델 바이트 + 두 번째 모델 카드 목록 + 첫 모델 사실). 요소는 연결·나머지 칸을 해시 정수로 줄여 사실 하나가 약 100MB
  (튜플 그대로 두었을 때 최고 577MB). 읽는 동안 순환 GC 를 끈다(약 25% 빠름).

### 화면 확인(시험 스택 9096 · `logbook_test` · 저장소 `scratchpad
ev14` · 워커 함께, Playwright 44 확인 0 실패, 1366·1920)
검색 행·미리보기 '판 4개 · 최신 R3', 상세 판 흐름 줄(칩: `요소 +2 · 절점 +1 · 두께 1건 · 질량 변경`, `요소 −1 · 절점 이동 4 · 단면 1건 · 하중 변경 · 외 2`),
판 단추로 미리보기 파일 고르기, 변경 요약(속성 전후 표 PSHELL T 12→14 · PBEAML DIM 150×10×300×15→180×12×320×16, GRAV, `SUBCASE 1 · METHOD = 1` 추가,
ID 목록 펼치기·복사), [두 판 3D 나란히 보기] → `/compare?ids=4,5`, 두 판 고르기(계열 밖 모델, 워커가 실제로 비교), 판 정리(넣기·순서·이름·최신판 → 저장 → '정리됨'·이력 한 줄)
→ 자동 추정으로 되돌리기, 정리 대기 카드 '판 R1 hatch.bdf → R2 hatch.bdf 최신'(폴더 판 표시), Guest·남(member)은 판 정리 단추 없음·저장 403, 비공개 자료 판 목록 404·화면 숨김.
스크린샷: 세션 스크래치 `rev14/shots/`.
검증 중 고친 것: 변경 없는 범주에 숫자 0 이 새던 것(`{0 && …}`), ID 목록 단추의 이름이 줄 나뉨으로 깨지던 것(aria-label), 판 정리 자리표시를 위치 기준 R<n> 으로.

### 사용자가 할 일
1. API·워커 재시작(새 표 자동 생성).
2. 1회: `python -m app.cli revisions-refresh` — 기존 자료의 판 묶음을 맞추고 인접 판 비교를 대기열에 넣는다(워커가 처리).
   12 서명이 없는 옛 모델은 `enqueue-convert --missing-signature` 를 먼저 돌리면 형상 규칙까지 쓴다(이름 규칙은 서명 없이도 된다).

### 남은 한계 · C 로 넘길 것
- 재번호 모델(절점·요소 번호를 다시 매긴 판)은 ID 비교라 '전부 삭제 + 전부 추가'로 보인다(형상 일치 매칭은 하지 않는다).
- CORD 정의 변경은 따로 세지 않고 절점 이동으로만 보인다. FORCE1/2·MOMENT1/2 는 힘 합에 넣지 않고 세트 변경(값 변경)으로만 잡는다.
  PLOAD4 압력 합은 P1 기준, 질량 합은 CONM2·CMASS2·CMASS4 만.
- 원본 key 는 '경로 + 바이트' sha 라 같은 내용이라도 이름이 다르면 비교 결과를 옮겨 쓰지 않는다(다시 계산).
- 검색 결과의 판 요약은 저장된 행 기준 — 배포 뒤 `revisions-refresh` 전에는 상세를 한 번 열거나 변환이 끝난 자료에만 보인다.
- **C(3D 변경 색 표시)용 데이터**: `GET /api/files/{a}/diff/{b}/detail` 의 `nodes.{added,removed,moved}`, `elements.{added,removed,conn,other}`·
  `elements.{pid,card}[].eid`, `rigids.{added,removed,indep}`·`rigids.dep[].eid`, `loads.spc_nodes`(각 최대 5000, 넘으면 `truncated` 에 원래 수).
  삭제 요소는 앞 판(a)의 모델에서, 추가·변경은 뒤 판(b)의 모델에서 찾으면 된다.
