# 17 — 완전 동일 BDF 업로드 차단

선행: 02a(배치 처리·제외 목록 `batches.excluded`), 02b(크롬 업로드 finish), 11(정리 대기 카드·[파일 추가] 자동 합치기),
12(BDF 내용 서명 `bdf/signature.py`, `model_summaries.sig_*`, `entries/same_model.py`), 15(LV1~LV3, `access.py`).

사용자 신고(2026-10-08): "현재 완전 동일한 BDF가 존재하면 이전에 존재한다고 파일을 찾아주고 업로드를 막아야 하는데 그대로 업로드가 된다."
12 는 변환이 끝난 뒤 정리 대기 카드에 '동일 BDF 있음' 칩만 띄웠다 — 막는 곳이 없었다.

## 1. 판정 — '완전 동일'

- **서명 동일** = 12 의 geometry·property·material·load 서명(규칙 버전 `signature.VERSION` 같음)이 모두 같다. 파일명·주석·줄 형식·카드 순서 무관.
  형상만 같은 것(같은 형상)은 막지 않는다 — 지금처럼 정보 칩.
- **바이트 동일(서명 없는 옛 모델 대비)** = 상대 모델에 쓸 수 있는 서명이 없을 때(12 이전 변환·옛 규칙 버전)만, `files.sha256` 이 같으면 완전 동일로 본다.
  단 **올린 BDF 가 INCLUDE 없이 혼자 완결될 때만**(INCLUDE 가 있으면 같은 바이트라도 끌어오는 조각이 달라 다른 모델일 수 있다).
  상대에 서명이 있으면 서명이 판정한다(바이트가 같으면 서명도 같다).
- 비교 대상: 휴지통이 아닌 파일(`files.location != 'trash'`) 중 **확정 자료 또는 정리 대기 초안**(`entries.status ∈ {confirmed, draft}`)에 든
  BDF 이고, INCLUDE 조각(`model_summaries.state = 'include'`)은 뺀다.
- 검사 대상(올린 쪽): 모델 파일(`.bdf/.dat/.nas/.blk`) 중
  - DRM 암호문·읽기 실패·크기 상한(600MB) 초과가 아닌 것,
  - **같은 업로드의 다른 BDF 가 INCLUDE 하는 조각이 아닌 것**(조각은 본 파일과 함께 판정),
  - 요소 카드(보·쉘: `model.BEAM_CARDS·TRI_CARDS·QUAD_CARDS`)가 하나라도 있는 것(변환이 서명을 남기는 모델과 같은 범위).
- 같은 업로드 안에서 두 파일이 서로 완전 동일하면 **경로 순서로 앞의 것만 받고** 나머지는 '이번 업로드 안에서 중복'으로 막는다.
- 막힌 본 파일이 INCLUDE 하는 조각 중 **다른(받는) 본 파일이 쓰지 않는 조각**은 함께 막는다(`duplicate_include`) — 조각만 남으면 혼자 다른 모델로 변환된다.

한 곳: `app/ingest/duplicates.py`(probe → 비교 → 설명). 화면·API 는 이 모듈 결과만 쓴다.

## 2. 막는 곳 세 군데

### 2.1 웹 업로드 마무리(`POST /api/uploads/{key}/finish`) — 즉시 차단
- 선언 확인 뒤, 폴더를 `_staging` 으로 옮기기 **전에** 모델 파일마다 `DeckReader + compute_signature` 를 동기로 계산한다
  (build_model·lbm 없음, 같은 업로드 안의 INCLUDE 는 업로드 폴더에서 함께 푼다).
- 동일하면 그 파일(과 1장의 함께 막는 조각)을 **받지 않는다** — 업로드 폴더에서 지운다(올린 사람 PC 에 원본이 있다).
  다른 파일은 그대로 진행한다. **남는 파일이 없으면 배치 행을 지우고 업로드 폴더를 정리**하며 응답 `state = "blocked"`.
- 일부만 막히면 배치의 `excluded` 에 `reason = duplicate_model`(+ 대상 파일 id)로 남겨 정리 대기 카드에서도 보인다.
- 응답: `{key, state: "staged"|"blocked", blocked: [...], deferred: N}` — `blocked` 항목 = 올린 파일 이름·크기·범위(`existing`|`same_upload`),
  대상 목록(Entry 번호·제목·상태·파일 이름·경로·올린 사람), 함께 막은 조각, 권한으로 가린 대상 여부(§3).
- **동기 상한**(설정, 넘으면 그 파일부터는 검사하지 않고 §2.2 워커에 맡긴다 — `deferred` 수):
  - `LOGBOOK_DUP_SYNC_MAX_BYTES`(기본 32MB) — 한 업로드의 모델 바이트 합.
  - `LOGBOOK_DUP_SYNC_SECONDS`(기본 15초) — 다음 파일을 시작하기 전 경과 시간.
  - 측정(§6): 자유 형식 합성 40만 카드(14MB) 읽기 1.5s + 서명 2.1s ≈ 3.6s. 32MB ≈ 8s 안팎.

### 2.2 워커 배치 처리(`process_batch`) — 우회 경로
- 탐색기로 `00_Inbox` 에 넣은 파일, 동기 상한을 넘긴 큰 파일, 동시 업로드 경합(두 업로드가 같은 순간 마무리)을 여기서 막는다.
  워커는 배치를 하나씩 처리하므로 앞 배치의 초안이 뒤 배치의 비교 대상이 된다.
- 파일 목록을 만든 뒤·묶음 제안 전에 같은 검사를 한다(자기 배치 파일은 비교 대상에서 뺀다). 동일하면 File 행을 만들지 않고(지우고)
  `excluded` 에 `duplicate_model`·`duplicate_include` + 대상으로 남긴다.
- **원본은 지우지 않는다** — 기존 제외 규칙(경로 길이·읽기 실패)처럼 `10_Vault\_staging\<key>\<경로>` 에 그대로 둔다
  (탐색기로 넣은 사람은 원본을 옮겨 버렸을 수 있다 — 데이터 손실 금지). 제외 항목에 `kept: true`.
- 계산한 서명은 변환을 기다리지 않고 `model_summaries.sig_*` 에 미리 적는다(변환이 끝나면 같은 값으로 덮거나, include·요소 없음이면 지운다) —
  정리 대기 칩과 §2.3 확정 재검사가 변환 전에도 동작한다.

### 2.3 확정·[파일 추가] 자동 합치기 — 재검사
- `confirm`(새 Entry 확정과 기존 자료에 합치기 모두)이 파일을 옮기기 전에 초안의 BDF(서명 또는 바이트)로 다시 찾는다(같은 배치 파일은 제외 —
  들어올 때 이미 판정). 그 사이 생긴 동일 BDF(예: 옛 모델이 `--missing-signature` 로 서명을 얻음, 관리자 강제 업로드)가 있으면
  **409 `{code: "duplicate_model", files: [...]}`** — 초안 카드에 대상 목록과 '그 파일을 골라 [새 묶음으로 나누기] → 그 초안 버리기' 안내.
- `auto_merge_batch` 는 confirm 을 부르므로 409 를 받아 초안을 정리 대기에 남긴다(기존 규칙 그대로).

## 3. 권한(15)

- 대상이 업로더가 볼 수 없는 자료여도 **막는다**(중복 저장을 막는 것이 목적). 그 대상의 번호·제목·파일·올린 사람은 싣지 않고
  `hidden: true` 만 — 화면 문구 '권한이 없는 자료에 같은 BDF 가 이미 있습니다. 관리자(LV3)에게 문의하세요.'
- 볼 수 있는 대상과 볼 수 없는 대상이 섞이면 볼 수 있는 것만 싣고 `hidden: true` 를 함께 준다(숨은 개수는 싣지 않는다).
- 판단: 막힌 것 자체가 '어딘가에 같은 BDF 가 있다'는 사실은 드러낸다. 12 의 칩은 볼 수 없는 자료를 완전히 숨기지만(정보 표시라 숨겨도 손해가 없다),
  17 은 막는 이유를 말하지 않으면 사용자가 원인을 알 수 없다. 그래서 '존재'만 알리고 '무엇·어디·누구'는 숨긴다.
- `batches.excluded` 에는 대상 **파일 id 만** 저장하고, 응답을 만들 때(`batch_to_dict`·업로드 응답·409) 보는 사람 권한으로 다시 설명한다
  (배치를 볼 수 있는 관리자와 올린 사람의 권한이 다르다).

## 4. 관리자 강제(LV3)

- 업로드 마무리 `force: true` — LV3 만(그 밖 403 `level3_required`). 막지 않고 받으며, 배치에 `allow_duplicates = 1` 을 남겨 워커 처리·확정 재검사도
  그 배치를 막지 않는다. 동일 대상이 있었으면 감사 `UPLOAD_DUPLICATE_FORCED`(파일 이름·대상 Entry 번호).
- 화면: 막힌 목록 옆 [그래도 올리기](LV3 에게만) — 브라우저가 들고 있는 그 파일들(+ 함께 막힌 조각)을 `force` 로 새 배치로 다시 올린다.
- 확정 409 도 LV3 는 [그래도 확정](`POST /entries/{id}/confirm?force=true`, 감사 `CONFIRM_DUPLICATE_FORCED`). 일반 사용자는 우회 없음.
- 막힌 업로드는 감사 `UPLOAD_DUPLICATE_BLOCKED`(파일 이름·수 — 대상 정보는 남기지 않는다. 활동 로그를 보는 사람 권한과 무관하게 안전하게).

## 5. 서명 없는 옛 모델

- 서명이 없는 변환 완료 모델은 서명 비교 대상이 아니다 → §1 바이트 동일 규칙이 대신한다.
- 운영 화면(`GET /api/admin/ops/status` → `signatures: {missing}`): '서명 없는 모델 N개' + `python -m app.cli enqueue-convert --missing-signature` 안내.

## 6. 측정(dev PC, 합성 자유 형식 BDF, GRID+CQUAD4 반반)

| 카드 | 바이트 | 읽기 | 서명 | sha256 |
|---|---|---|---|---|
| 10만 | 3.3MB | 0.27s | 0.50s | 0.00s |
| 20만 | 6.7MB | 0.71s | 1.03s | 0.00s |
| 40만 | 14.0MB | 1.48s | 2.12s | 0.01s |
| 80만 | 28.8MB | 3.21s | 4.20s | 0.01s |

바이트당 약 4MB/s. 기본 상한 32MB/15초. 공유 폴더 위에서는 읽기가 더 걸린다(상한을 시간으로도 둔 이유).

## 7. 바뀌는 것

- DB: `batches.allow_duplicates TINYINT(1) NOT NULL DEFAULT 0`(ADDED_COLUMNS — 시작 때 자동 추가).
- 설정: `LOGBOOK_DUP_SYNC_MAX_BYTES`, `LOGBOOK_DUP_SYNC_SECONDS`(`.env.example`).
- 새 모듈 `app/ingest/duplicates.py`. 수정: `uploads/service.py`·`routers/uploads.py`(force·blocked 응답), `ingest/process.py`,
  `entries/service.py`(confirm 재검사·force), `routers/entries.py`, `routers/batches.py`(excluded 설명), `routers/admin_ops.py`, `models.py`, `database.py`, `config.py`.
- 프런트: `lib/upload.js`(blocked·force), `UploadZone.jsx`(막힌 목록 `DuplicateBlockList` + [그래도 올리기]), `GlobalDrop.jsx`, `EntryPage.jsx`([파일 추가]),
  `InboxPage.jsx`, `BatchCard.jsx`(excluded 이유·대상), `DraftCard.jsx`(409 목록·[그래도 확정]), `OpsPage.jsx`, `lib/labels.js`.

## 8. 테스트

- `tests/test_duplicate_block_17.py` — 업로드 API: 완전 동일(이름 다름) 차단, 형상만 같음 통과, 같은 업로드 내 중복, 혼합(보고서 통과),
  전부 차단 시 배치·폴더 없음, sha256 동일(서명 없음) 차단, INCLUDE 있는 BDF 는 바이트 규칙 안 씀, 휴지통 자료는 대상 아님,
  볼 수 없는 대상 → 익명, LV3 강제 + 감사, LV2 강제 403, 큰 파일 상한 → deferred 후 워커가 막음,
  워커 process_batch 차단(excluded·원본 보존·서명 미리 기록), 확정 409 + LV3 강제, auto_merge 경합, ops 서명 없는 모델 수, INCLUDE 조각 함께 판정.
- 프런트 vitest: 막힌 목록·링크(볼 수 있을 때만)·익명 문구·LV3 [그래도 올리기]·일반 사용자 버튼 없음, `uploadBatch` 의 blocked·force,
  BatchCard excluded 이유, DraftCard 409 목록.
- 합성 데이터만(가상 호선 9999/9001/9002, 가상 사번).

## 9. 결과 (2026-10-08)

### 동작 — 어디서 어떻게 막히나
| 경로 | 막는 곳 | 막힌 파일 | 사용자에게 보이는 것 |
|---|---|---|---|
| 크롬 업로드(정리 대기·전역 끌어 놓기·Entry [파일 추가]) | `finish` 동기 검사 | 업로드 폴더에서 지움(PC 에 원본) | 업로드 칸 아래 '올리지 않음: 동일 BDF 가 이미 있음' + 기존 자료 링크. 모두 막히면 배치 없음 |
| 큰 파일(상한 초과)·동시 마무리 경합 | 워커 `process_batch` | 초안에 넣지 않음, 원본은 `_staging/<key>` 보존 | 정리 대기 카드 '제외된 파일'(펼쳐짐) 이유·대상·보존 위치, [파일 추가]는 상태 줄 아래 목록 |
| 탐색기로 `00_Inbox` | 워커 `process_batch` | 위와 같음 | 위와 같음. 모두 막혀 초안이 하나도 없으면 done 배치를 3일 동안 정리 대기에 남김(`DUPLICATE_DONE_DAYS`) |
| 초안 확정·자동 합치기 | `confirm` 재검사 | 확정 안 함(409) | 초안 카드 '확정하지 않음: 동일 BDF' 목록 + 나누기→버리기 안내. 자동 합치기는 초안이 정리 대기에 남음 |

감사: `UPLOAD_DUPLICATE_BLOCKED`(웹·워커 모두, 파일 이름만), `UPLOAD_DUPLICATE_FORCED`(LV3, 대상 Entry 번호), 확정 강제는 `ENTRY_CONFIRM`/`ENTRY_FILES_ADDED` 의 `after.duplicates_forced`.

### 판단한 점
- **권한**: 볼 수 없는 대상이어도 막고 '존재'만 알린다(§3). 12 칩(완전히 숨김)과 다르게 둔 이유 — 막으면서 이유를 말하지 않으면 사용자가 원인을 알 수 없다.
- **바이트 규칙은 서명 없는 상대에만 + 올린 쪽이 INCLUDE 없이 완결될 때만**: 바이트가 같아도 INCLUDE 가 끌어오는 조각이 다르면 다른 모델이다.
- **INCLUDE 조각**: 혼자 비교하지 않고 본 파일과 함께 판정. 막힌 본 파일만 쓰던 조각은 함께 뺀다(남기면 혼자 다른 모델로 변환된다). 읽지 못한(상한 초과) BDF 가 있으면 조각을 남긴다(지우는 쪽으로 틀리지 않게).
- **워커 경로 원본 보존**: 탐색기로 넣은 사람은 원본을 옮겨 버렸을 수 있어 지우지 않는다(경로 길이·읽기 실패 제외와 같은 규칙). 웹 업로드는 PC 에 원본이 있어 지운다.
- **서명 미리 적기**: 워커가 계산한 서명을 변환 전에 `model_summaries` 에 적는다 → 다음 배치·확정 재검사·12 칩이 변환을 기다리지 않는다.
- **LV3 확정 강제**도 열었다(요청은 업로드 강제) — 확정 409 에서 LV3 가 막히지 않게. 일반 사용자는 우회 없음.
- **모두 막힌 탐색기 배치**는 초안 없이 done 이 되어 목록에서 사라지므로 3일 동안 남겨 이유를 보인다(웹 업로드는 응답으로 바로 안다).

### 측정
- 동기 검사(합성 자유 형식, §6): 40만 카드 14MB ≈ 3.6s, 80만 카드 29MB ≈ 7.4s. 기본 상한 32MB·15초. 실화면에서 작은 BDF 마무리 응답은 체감 지연 없음.
- 워커는 BDF 를 한 번 더 읽는다(배치 처리 + 변환). 600MB 상한 모델이면 배치 처리 시간이 그만큼 늘어난다.

### 테스트
- 백엔드 `tests/test_duplicate_block_17.py` 23건, 기존 `test_uploads_service.py` 는 finish 반환값(사전)에 맞춤. 백엔드 전체 pytest 859 passed(+ 뒤에 더한 1건 포함 영향 파일 재실행 통과), vitest 76 파일 / 520, `npm run build` 통과.
- 프런트 `DuplicateBlocked.test.jsx` 9건, `upload.test.js` +2, `GlobalDrop.test.jsx` +1.
- 실화면: 시험 스택 9096(API 만, 워커 없음 — 워커 경로는 `seed17.py` 가 `process_batch` 를 직접 호출), `logbook_test` + 가짜 `wb_users`, 1366 폭,
  Playwright 30 확인 0 실패, 스크린샷 스크래치 `dup17/shots/` 10장(직접 확인). 끝난 뒤 스택 종료·`logbook_test` 표 모두 지움.

### 배포(145)
`git pull` → 프런트 빌드(dist) → **API·워커 재시작**(시작 때 `batches.allow_duplicates` 열 자동 추가) → 운영 화면에 '서명 없는 모델 N개' 가 보이면
`python -m app.cli enqueue-convert --missing-signature` 1회. 의존성 추가 없음. 필요하면 `.env` 에 `LOGBOOK_DUP_SYNC_MAX_BYTES`·`LOGBOOK_DUP_SYNC_SECONDS`.

### 남은 한계
- 12 서명 규칙의 한계 그대로(재번호·빈칸 vs 기본값·유효숫자 7자리). '같은 모델인데 번호만 다른' 것은 막지 않는다.
- 서명 없는 옛 모델은 바이트가 같을 때만 막는다 → `--missing-signature` 재변환 전까지 '형식만 다른 같은 모델'은 통과한다.
- 워커가 뺀 원본은 `_staging/<key>` 에 남는다(자동 정리 없음) — 관리자가 탐색기로 지운다.
- 동기 상한을 넘긴 큰 BDF 는 업로드 직후가 아니라 배치 처리 때(수 초~분 뒤) 정리 대기 카드에서 알린다.
- '요소 있음' 판정은 카드 이름 기준(BEAM·TRI·QUAD 카드)이라 변환의 `no_elements` 와 드물게 다를 수 있다(ID 가 깨진 요소만 있는 덱 등).
