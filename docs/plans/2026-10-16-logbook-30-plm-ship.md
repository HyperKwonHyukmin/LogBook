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
  선종·주기관·선급·인도일을 **보여 주기만** 한다. `GET /api/hulls/{hull_no}/plm`(`hull_info.preview_plm`, 로그인만 — 저장·감사·없음 기록 없음).
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

`tests/test_plm_ship_30.py`(46건): 선형 파서 실측 형식 표·규칙 밖·빈 값, 번호 정규화, 조회 모양·빈 인도값·상태, 장애는 캐시 안 함,
설정 없음 → unavailable, [선박 정보 검색](선종 바꿈·감사·write_meta·registry), 오류 코드·LV1 403, 일괄(사람이 적은 선종 유지·한 번의 질의·
없음 기록·다시 누르기), 확정 때 작업 넣기(중복 없음·미설정이면 안 넣음), CLI. 프런트 `HullPage.test.jsx` 3건.
⚠ 개발 PC 는 PLM 에 닿지 않는다 — 실제 조회는 145 에서 확인(3370 → 174K LNG · G70ME-C10.5-GA-EGRBP · BV · 2025-02-28).
