# 12 — BDF 내용 기준 중복 감지(같은 모델·같은 형상)

선행: 04a(BDF 파서·convert_model), 02a(바이트 중복 `files.duplicate_of_id`), 11(정리 대기 카드). 사용자 요청(2026-10-07):
"완전 동일한 BDF 를 업로드하려고 하면, 파일명이 다르더라도 안의 Geometry 정보만 파악하여 동일 BDF 가 존재한다고 하고 이 동일 파일을
알려줘. 검토 기준은 Node, Element 기준이야. Property 또는 Material, 각종 Load 가 다른 점은 다른 BDF 라고 인식되어야 해."

## 1. 판정 규칙 — 범주별 내용 서명

BDF 를 읽은 카드(`DeckReader.cards`)와 Bulk 앞 실행·케이스 제어 줄(`DeckReader.control`, 12 에서 추가)을 범주로 나눠 정규화하고
범주마다 sha256 을 낸다(`app/bdf/signature.py`). **파일명·주석·줄 형식(고정/자유/대형 필드, 연속 줄)·카드 순서·실수 표기**는 무시한다.

| 범주 | 들어가는 것 |
|---|---|
| geometry | GRID·GRDSET·SPOINT·CORD*·강체(RBE1/2/3·RBAR·RROD…)·요소 연결 — 요소 카드는 **PID 칸을 뺀** 나머지(EID·절점·방향 벡터·오프셋). BAROR·BEAMOR 도 PID 칸만 뺀다 |
| property | P* 카드 전부 + 요소별 (EID→PID) 배정(PID 빈칸 = EID). CONROD 의 MID·A·J…, CELAS2·CDAMP2·CELAS4·CDAMP4 의 K·B·GE·S 처럼 요소 카드에 직접 적힌 단면·강성 값 |
| material | MAT*·MATS*·MATT*·TABLEM*·CREEP |
| load | 하중·경계조건·질량(FORCE·MOMENT·GRAV·LOAD·PLOAD·TEMP·SPC·SPCADD·SPCD·MPC·CONM·CMASS·ACCEL·RFORCE·DAREA·TLOAD·RLOAD·TABLED·SUPORT·NSM…) + SOL + Case Control 의 해석 선택(SUBCASE·LOAD=·SPC=·MPC=·TEMP=·METHOD=…) |
| other | 나머지 카드(PARAM 등) + Case Control 의 출력 요청(DISP·STRESS…) — 동일 판정에 쓰지 않는다 |

- Case Control: CEND 뒤만 본다(실행 제어는 SOL 만, `SESTATIC` 같은 이름은 번호로). TITLE·SUBTITLE·LABEL·ECHO 같은 출력 꾸밈은 뺀다.
  4글자 줄임(TEMP → TEMPERATURE)은 원형으로, 공백은 지운다. SUBCASE 묶음 안 문장 순서는 무시하고 묶음 순서는 지킨다.
- 필드 정규화(`norm_field`): 정수 → int, 실수 → `parse_float` 후 **유효숫자 7자리**(`REAL_DIGITS = 7`, `{:.7g}`, 정수와 구별되게 `.`
  을 남김 — `1.` ≠ `1`), 빈칸 → 빈칸(기본값으로 채우지 않음), 문자 → 대문자. 줄 형식 때문에 생기는 카드 끝 빈칸은 지운다.
- 규칙 버전 `signature.VERSION = 1`. 규칙을 바꾸면 올리고 `enqueue-convert --missing-signature` 로 다시 낸다(버전이 다른 행끼리는 비교 안 함).

판정:
1. **같은 모델(동일 BDF)** = geometry·property·material·load 가 모두 같다 → "동일 BDF 있음: <Entry ID> <파일>"(여러 개면 모두, 목록 5 + 총 개수).
2. **같은 형상** = geometry 만 같고 property·material·load 중 하나 이상 다르다 → 중복이 아니라 정보로만 "같은 형상: … (속성·하중 다름)".
   나중에 Revision 비교의 재료로 쓴다.
3. 바이트까지 같은 파일(기존 `files.sha256` → `duplicate_of_id`)은 기존 '…에 이미 있음' 칩 그대로. 그 파일은 같은 모델 목록에서 빼
   한 번만 보인다.

메모리: 범주마다 '카드 한 장 = 짧은 문자열 하나' 목록을 제자리 정렬해 해시에 차례로 넣는다(큰 문자열로 잇지 않음).
실측(합성 40만 카드): 서명 2.2s, 추가 메모리 최고 ≈ 53MB(카드 목록 위에).

## 2. 저장 — `model_summaries` 열

- `sig_version` INT, `sig_geometry`(색인 `ix_model_summaries_sig_geometry`)·`sig_property`·`sig_material`·`sig_load`·`sig_other` VARCHAR(64).
  모두 NULL 허용. 기존 DB 는 `database.ensure_columns`(ADDED_COLUMNS + 새 ADDED_INDEXES)가 시작 때 더한다.
- `convert/job.py run_convert` 가 lbm·썸네일·지문과 함께 계산해 저장(`set_signature`). include 조각·건너뜀(요소 없음·DRM·크기)은 지운다.
  재변환이 실패하면 지문과 같은 규칙으로 이전 값을 남긴다.

## 3. 조회 — 한 곳(`app/entries/same_model.py find_same_models`)

- 서명이 있는 파일들의 geometry 로 후보를 한 번에 읽고(색인), 범주를 비교해 같은 모델 / 같은 형상(+ `differs`)으로 나눈다.
- 제외: 자기 자신, 휴지통 파일·휴지통 Entry, 다른 규칙 버전. 초안(정리 대기)도 포함 — 같은 배치의 두 파일이 같아도 서로 알린다.
- 정렬: 확정 Entry 먼저, 그다음 먼저 올라온 파일. 상한 `SAME_LIMIT = 5` + `*_total`.
- ⚠ **Entry 권한(비공개)** 이 들어오면 이 모듈의 `_visible()` 한 곳에서 '볼 수 없는 Entry 는 숨김/익명화' 를 끼운다(주석 표시).

## 4. 노출

- API: `entry_to_dict` 의 파일 `model` 에 `same_model`·`same_model_total`·`same_geometry`(각 항목 `differs`)·`same_geometry_total`.
  항목 = `{file_id, name, rel_path, entry_id, entry_title, entry_status}`. 정리 대기 배치 목록·Entry 상세가 함께 받는다.
- 화면(`components/preview/SameModel.jsx`):
  - 정리 대기 `DraftCard` 파일 줄: 동일 BDF → 주의 칩 "동일 BDF 있음: E000123 a.bdf 외 N"(Entry 링크, 툴팁에 전체 목록),
    형상만 같으면 옅은 정보 칩 "같은 형상: …"(툴팁에 다른 범주).
  - Entry 상세: 파일 트리 줄에 '동일' 표시, 고른 파일의 미리보기 위에 '동일 BDF 가 이미 있습니다'(주의)·'같은 형상, 다른 조건'(정보) 목록.
  - 변환 전에는 서명이 없어 아무것도 그리지 않는다(기존 '모델 확인 중' 그대로). 검색 결과 행은 건드리지 않았다.

## 5. 기존 모델 채우기

`python -m app.cli enqueue-convert --missing-signature` — 변환이 끝났는데(done) 서명이 없거나 규칙 버전이 다른 모델만 재변환.
(재변환은 같은 key 의 lbm·썸네일을 다시 쓰고 서명을 채운다.)

## 6. 검증

- 백엔드 `tests/test_model_signature_12.py` — 형식만 바꾼 같은 모델(자유/고정/대형·순서·주석·실수 표기·INCLUDE 분할) 4범주 동일,
  GRID 좌표 → geometry, PSHELL t → property, 요소 PID → property, PID 빈칸 = EID, MAT1 E → material, FORCE 크기·SPC 추가 → load,
  TITLE 만 다름 → 같음, LOAD= 선택·SOL → load, 출력 요청·PARAM → other, 인라인 요소 값, CONM → load, 유효숫자 상수 고정;
  변환 저장·include 조각 지움, API same_model/same_geometry(+differs)·휴지통 제외, 초안끼리·바이트 중복 한 번만·확정 먼저, 상한·총 개수,
  변환 전 빈 목록, CLI `--missing-signature`. `tests/test_config_db.py` — 서명 열·색인 추가(멱등).
- 프론트 `DraftCard.test.jsx`(주의 칩 링크·외 N·정보 칩·변환 전 없음), `EntryPage.test.jsx`(동일·같은 형상 목록·트리 표시·없을 때 없음).
- 합성 데이터만(가상 호선 9999·9001·9002).

## 7. 배포

- 145: `git pull` → 프론트 빌드(dist 커밋됨) → **API·워커 재시작**(시작 때 열·색인 자동 추가) →
  `python -m app.cli enqueue-convert --missing-signature` 1회(워커가 기존 모델을 재변환해 서명을 채운다). 의존성 추가 없음.

## 8. 남은 한계

- 정규화는 '표기' 차이까지만 흡수한다 — 같은 모델이라도 **번호 체계가 다르면**(절점·요소 재번호) 다른 형상으로 본다.
  빈칸과 기본값(예: GRID CP 빈칸 vs 0)도 다르게 본다.
- 유효숫자 7자리 밖의 좌표 차이(1e-7 상대)는 같게, 그 안의 차이는 다르게 본다(허용 오차 비교가 아니다).
- INCLUDE 를 찾지 못한 모델은 읽은 만큼으로 서명한다(빠진 조각이 있으면 다른 모델로 보일 수 있다).
- 업로드 **전** 경고가 아니라 변환이 끝난 뒤(정리 대기 카드)에 보인다.
