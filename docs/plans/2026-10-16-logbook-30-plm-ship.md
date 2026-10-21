# 30 — 사내 PLM 선박 정보로 호선 채우기

호선 번호만으로 사내 PLM(Oracle `HIPLM`, 시노님 `VT_PLM_SHIP`)에서 선형·주기관·선급·인도일을 읽어 LogBook 호선에 넣는다.
선종을 하나하나 찾아 적지 않아도 되고, 관계 지도 등에서 선종·용량·선급·주기관으로 묶을 재료가 쌓인다.

조사 원본: WorkBench 저장소 `docs/superpowers/plans/2026-10-16-plm-ship-lookup.md`(145 실측 — 컬럼·598종 선형 형식·정규식).

## 결정 (사용자, 2026-10-16)

| 항목 | 결정 |
|---|---|
| 조회 경로 | **LogBook 이 직접 PLM 에 접속**한다 — WorkBench 가 꺼져 있어도 동작해야 한다. 접속 정보는 WorkBench `.env` 와 같은 키 |
| 선종(`hulls.ship_type`) 값 | 선형 그대로 **`174K LNG`**(`SHIP_TYPE_NAME` '174K-LNG' 의 하이픈을 공백으로). 분해 값은 따로 저장 |
| 단추 위치 | 호선 화면 [선박 정보 검색] · 호선 목록 [선종 채우기(PLM)] · 확정 때 자동 조회 — 셋 다 |

## 구조

| 파일 | 하는 일 |
|---|---|
| `backend/app/plm_ship.py` | 접속(`PLM_ORACLE_DSN/USER/PASSWORD`, `PLM_ORACLE_LIB_DIR` 있으면 thick mode 한 번), `normalize_ship_no`, `parse_ship_type`, `to_ship`, `lookup`·`lookup_many`(번호 여러 개를 IN 목록 한 질의로, 500개씩), 캐시(찾음 6시간·없음 10분, 장애는 캐시 안 함), `set_fetcher`(시험), `enqueue_fill` |
| `backend/app/hull_info.py` | `plm_of`(응답 모양), `lookup_and_apply`(단추 하나), `fill_from_plm`(일괄·작업·CLI), 감사 `HULL_PLM` |
| `backend/app/models.py` · `database.py` | `hulls` 에 열 10개(아래) — `ADDED_COLUMNS` 로 시작할 때 ALTER |
| `routers/hulls.py` | `POST /api/hulls/{hull_no}/plm` · `POST /api/hulls/plm-fill`(둘 다 LV2 — 선종은 공용 정보) |
| `worker.py` | 작업 `plm_fill`(대상 id 0 — 아직 조회하지 않은 호선 전부) |
| `entries/service.py` | 확정 때 `plm_ship.enqueue_fill` — PLM 이 설정돼 있고 미조회 호선이 있을 때만, 대기 중인 작업이 있으면 또 넣지 않는다 |
| `ops/registry.py` · `ops/rebuild.py` | registry.json `hulls[].plm` — 재구축 때 되살린다 |
| `cli.py` | `plm-fill [--unchecked]` — 145 첫 배포 때 기존 호선을 한 번에 |
| 프런트 `HullPage.jsx` · `HullsPage.jsx` · `labels.js` | 단추·PLM 정보 줄·오류 문구·활동 로그 라벨 |

### `hulls` 에 더한 열

`plm_status`(found · not_found · NULL=아직 안 봄) · `plm_checked_at` · `plm_ship_type`(원문 '174K-LNG') · `ship_capacity`('174K', 컨테이너는 단위 없이 '4500') ·
`ship_kind`('LNG') · `ship_variant`(괄호 부가정보 'DF' · 'MOSS') · `main_engine` · `ship_class`(SHIP_CLASS1) · `delivery_date`('YYYY-MM-DD') · `delivered`.

### 추가 (2026-10-19) — 자료 수정 화면에서도

- 자료 화면 [수정] · 정리 대기 카드의 호선 칸 아래 **[선박 정보 검색]**(`components/hull/HullPlmLookup.jsx`) — 입력한 호선마다
  선종·주기관·선급·인도일을 보여 준다. `GET /api/hulls/{hull_no}/plm`(`hull_info.preview_plm`, 로그인만).
  - (2026-10-19 바뀜) **한 번 찾은 호선은 저장한다** — 호선 행이 이미 찾음(`plm_status=found`)이면 PLM 에 묻지 않고 저장값을 돌려준다
    (서버 재시작 뒤에도). 처음 찾으면 PLM 칸을 저장하고 빈 선종만 채운다(자동 조회와 같은 규칙 — 찾음으로 기록되면 자동 조회가 건너뛰므로).
    감사 `HULL_PLM`·registry 갱신. 못 찾은 번호는 기록하지 않는다(오타가 호선 행으로 쌓이지 않게). 새로 받기는 호선 화면 [선박 정보 검색].
- 확정 자료에서 호선을 바꾸면(`update_entry`) 새 호선 행을 만들고 `enqueue_fill` — 확정 때와 같이 빈 선종을 자동으로 채운다
  (전에는 수정으로 더한 호선은 호선 행이 없어 PLM 일괄 조회 대상에서 빠졌다).

- 일괄 채우기(단추·CLI·작업)는 시작할 때 **확정 자료에 쓰였는데 호선 행이 없는 번호**에 행을 만든다(`_ensure_confirmed_hull_rows`) —
  위 수정 전 데이터(수정으로 더한 호선)도 빠지지 않게. 초안의 호선·형식 밖 번호는 만들지 않는다.

- 자료 화면 속성 칸의 호선 아래에 저장된 PLM 정보(선종·주기관·선급·인도)를 호선마다 한 줄(`HullPlmSummary`).
  자료 API(`entry_to_dict`, viewer 있을 때만)가 `hulls[].plm` 을 싣는다 — entry.json(재구축 원천)에는 넣지 않는다.

## 규칙

- **선종 덮어쓰기**: [선박 정보 검색](사람이 누름)은 선종을 선형으로 **바꾼다**(감사 before/after 에 남는다). 일괄·자동은 선종이 **빈 호선만** 채운다 —
  사람이 적은 선종은 그대로. PLM 칸(주기관 등)은 찾을 때마다 PLM 값으로.
- 선형이 규칙 밖(FPSO·함정·과제명)이면 원문을 그대로 선종으로, 분해 칸은 비운다. 빈 선형이면 선종을 바꾸지 않는다.
- **없음도 기록한다**(`plm_status='not_found'`) — 자동 조회가 같은 번호를 되풀이해 묻지 않는다. 일괄 단추는 못 찾은 호선을 다시 본다
  (10분 캐시 안에서는 다시 묻지 않는다). 예전에 찾은 값은 지우지 않는다.
- 오류: 형식 422 `invalid_ship_no` · 없음 404 `ship_not_found` · 설정 없음 503 `plm_not_configured` · 드라이버 없음 503 `plm_driver_missing` ·
  접속·질의 실패 502 `plm_fetch_error`. 일괄은 장애면 아무것도 바꾸지 않고 같은 오류. 작업은 503 이면 조용히 끝내고 502 는 재시도.
- 선종이 바뀌면 그 호선 확정 자료의 entry.json 을 다시 쓴다(`write_meta`) — 재구축 원천의 선종을 맞춘다.
- 컨테이너·PCTC 는 PLM 에 단위가 없어 `4500 CNTR` — 단위를 지어내지 않는다.

## 배포 (145)

README '사내 PLM 선박 정보 (30)'. ⟳ Update(requirements 변경 → pip install) → `.env` 에 WorkBench 의 `PLM_ORACLE_*` 4줄 + `TNS_ADMIN`(빠지면 ORA-12541 — 2026-10-19 145 에서 겪음) → 재시작 →
`app.cli plm-fill` 한 번. DB 열은 시작할 때 저절로 더해진다.

## 테스트

`tests/test_plm_ship_30.py`(51건): 선형 파서 실측 형식 표·규칙 밖·빈 값, 번호 정규화, 조회 모양·빈 인도값·상태, 장애는 캐시 안 함,
설정 없음 → unavailable, [선박 정보 검색](선종 바꿈·감사·write_meta·registry), 오류 코드·LV1 403, 일괄(사람이 적은 선종 유지·한 번의 질의·
없음 기록·다시 누르기), 확정 때 작업 넣기(중복 없음·미설정이면 안 넣음), CLI. 프런트 `HullPage.test.jsx` 3건.
⚠ 개발 PC 는 PLM 에 닿지 않는다 — 실제 조회는 145 에서 확인(3370 → 174K LNG · G70ME-C10.5-GA-EGRBP · BV · 2025-02-28).

## 현황 (2026-10-19)

- 145 PLM 조회 성공 확인(3515 → 170K-FSRU · BV · 미인도, `.env` 에 `TNS_ADMIN` 추가 후).
- 아직 145 에서 안 한 것: ⟳ Update(1a7b8bd 이후 반영) → `app.cli plm-fill` 한 번 → 자료 화면 속성 칸·수정 화면 [선박 정보 검색] 눈으로 확인.
- 하지 않기로 미룬 것: 이미 찾은 호선 다시 조회(주기 갱신) — 인도일이 바뀌는 경우가 문제가 되면.

## PLM 추가 정보 탐색 (2026-10-21, 145 `inspect_plm_hull_tables.py`)

| 대상 | 결과 | 판단 |
|---|---|---|
| `WSS_SIMILAR_SHIP`(유사선) · `TB_SHIP_SPECIFICS`(주요 치수) · `TB_PMS_SHIPMEMBER`(호선 담당) · `VT_SEARCH_SHIP_REMARK_LIST`(특이사항) | 열이 안 보임 — caduser 권한 없음(INFODBA2 · ANET 소유) | 쓰려면 권한 요청. 유사선이 가장 기대됨 |
| `TB_HULL_TROUBLEREPORT_LIST` | 읽힘, 5행 — 2012년 CAD 프로그램 오류 문의 | 구조 트러블이 아님 → 쓰지 않음 |
| `TB_PROJECT_PROBLEM_ACTION` | 읽힘, 2행 — CAD DB 조치 기록 | 쓰지 않음 |
| `TB_HULL_STRUCT_SCANTLING` | 읽힘, 69행 — 3000 호선 AFT 부재 치수 일부만 | 체계적 자료가 아님 → 쓰지 않음 |

→ 쓸 만한 것은 이미 읽는 `VT_PLM_SHIP` 의 안 쓰는 열(공정 실적일 · `SHIP_TYPE_CODE` · 선주 · 선급2)과 `VT_PLM_USER`(35열, 팀 등)뿐.
- 키워드 `DWG` · `BLOCK` · `WEIGHT` 로 한 번 더 훑음 — 도면 목록(`VT_PLM_DWGITEM*`) · 블록 분할 · 중량(`TB_MBOM_BLOCKDIV` 등)이 이름으로 보였으나 나머지는 BOM · 배관 · 전장 · 네스팅 등 생산 데이터.
- **결론(사용자, 2026-10-21): PLM 활용은 사번(사용자) · 호선 기본 정보 · 시리즈까지로 닫는다.** 같은 선형 · 선주 · 도면 · 블록 중량 후보는 실사용 가치가 낮다고 판단.
  더 넓히려면 PLM 이 아니라 다른 시스템이나 DB 권한 요청(유사선 · 주요 치수 등)부터 다시 검토한다.

## 다음 후보 — 시리즈 호선 (2026-10-21 조사 시작)

요구: 같은 선종·같은 설계의 시리즈(예: 3척)는 호선 번호가 달라도 **같은 호선으로 취급**하고 싶다 → PLM 에서 시리즈를 알 수 있나.
- 단서(WorkBench 145 조사 기록 `plm_hull_scan.txt`·PLM 계획서): `SHIP_PRE`(선행호선) · `SHIP_SEQ`(시리즈 순번) 열이
  `ANET.CNPLM_DW0070` · `ANET.VT_SHIP_DWGFST_LIST` 에 있다. 시리즈 전용으로 보이는 `TB_SNSD_SDRAW_SERIES_SHIP` · `VT_CNPLM_SHIP_PRE` 도 있다.
- 145 확인(2026-10-21, `inspect_plm_hull_tables.py`):
  - **`VT_PLM_SHIP` 에 `SHIP_PRE` VARCHAR2(4) · `SHIP_SEQ` VARCHAR2(4000) 가 있다** — 지금 쓰는 접속·뷰 그대로, 열 두 개만 더 읽으면 된다(총 45열, 3,638행).
  - 3370 실측: `SHIP_PRE='3370'`, `SHIP_SEQ='1'` → 시리즈 첫 호선은 선행호선이 **자기 번호**. 같은 행 `SHIP_TYPE_CODE='LG017'`(선형 코드), `IMO_NO='9975521'`.
  - `TB_SNSD_SDRAW_SERIES_SHIP` 는 행 0개, `VT_CNPLM_SHIP_PRE` 는 ORA-01031(권한 없음) → 쓰지 않는다.
- 남은 확인: 후속 호선이 `SHIP_PRE='3370'` 을 갖는지와 그 호선들의 `SHIP_TYPE_NAME` 이 같은지 —
  `--table VT_PLM_SHIP --column SHIP_PRE --value 3370 --rows 10 --out series_check4.txt`.
- → **계획 45(`2026-10-21-logbook-45-hull-series.md`)로 옮김.** 결정(사용자, 2026-10-21): 호선 번호는 그대로, 같은 시리즈는 검색 · 관계 지도 · 갖춤 현황에서 **기본으로** 한 묶음.
  아래 탐색 표의 '시리즈 포함 켜기'(선택)는 이 결정으로 기본 동작이 됐다.

### 시리즈로 묶기 — 탐색 (2026-10-21)

원칙(추천): **자료에 단 호선 번호는 바꾸지 않는다.** 시리즈는 호선의 속성(`hulls` 에 대표 호선 = `SHIP_PRE`)으로 두고,
'같은 호선 취급'은 화면마다 **묶는 기준 하나를 더하는 방식**으로 한다. 호선 번호를 대표 호선으로 바꿔 쓰면 실제 어느 배 자료인지가 사라진다.

| 곳 | 지금 | 시리즈를 넣으면 |
|---|---|---|
| PLM 채우기(30) | 6열 읽음 | `SHIP_PRE` · `SHIP_SEQ` 를 더 읽어 `hulls.series_lead` · `series_seq` 에 저장. 사람이 고칠 수 있게(선종처럼) |
| 호선 화면 | 호선 하나 | '같은 시리즈 3370 · 3371 · 3372' 줄, 시리즈 호선들 자료를 함께 보기 |
| 갖춤 현황(44) | 행 = 호선 · 선종 · 크기급 | 행 기준에 **시리즈** 추가 — 시리즈 한 행에 세 척 자료가 모여 빈 칸이 실제로 비었는지 보인다 |
| 검색 거르기 | 호선 = 정확히 그 번호 | 호선 거르기에 '시리즈 포함' 켜기(3371 로 걸러도 3370 · 3372 자료가 나옴), 묶기 기준에 시리즈 |
| 관계 지도(35) | 모으는 기준 호선 · 선종 · 크기급 … | 기준에 시리즈 |
| 선례 찾기(27) | 모델 특징 점수 | 같은 시리즈면 점수 가산 또는 표시만(나중) |

- 시리즈 이름은 대표 호선 번호로 보인다(예: '3370 시리즈'). 시리즈가 한 척뿐이면 호선과 같으니 묶지 않는다.
- 대안: `SHIP_TYPE_CODE`(선형 코드 'LG017')는 시리즈보다 넓은 '같은 선형' 묶음일 수 있다 — 값 분포를 보고 필요하면 크기급과 시리즈 사이 단계로.
