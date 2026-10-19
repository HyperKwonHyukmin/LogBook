# 39 — WorkBench 해석 출처(Hi-TESS Core 1단계, LogBook 쪽)

작성 2026-10-19 · 상태: **구현(키 꺼짐, 커밋 전)** · 원 변경안: `hitess-core` `docs/10-phase1-provenance.md`(A1~A6)

## 하는 일
WorkBench 관리자가 All Projects 에서 해석 1건을 LogBook 으로 보낼 때(19, `/api/integration/uploads`) 실어 오는
`origin` 을 감사 기록뿐 아니라 **묶음(batches.origin)** 에도 남겨, 확정된 자료에서 "WorkBench 해석 WB #123 에서 왔다"를 본다.

| # | 변경 | 키 꺼짐일 때 |
|---|---|---|
| A1 | `batches.origin`(JSON)·`wb_analysis_id`(INT, 색인) 열, `wb_upload_begin` 이 저장(실패해도 업로드는 계속) | 저장은 한다 — 화면·API 변화 없음 |
| A2 | `origin.passport.artifacts`(역할·이름·sha256, 500개까지) 저장 | 같음 |
| A3 | 자료 화면 속성 칸 '출처': `WB #123`(복사) · 프로그램 · 해석자 · 해석 일시 | 응답에 `wb_origins` 없음 → 안 보임 |
| A4 | 여권 sha256 과 같은 파일 'WB 산출물과 같음' | 안 보임 |
| A5 | entry.json `origins`(묶음 출처 + 파일 rel_path), 재구축이 출처마다 묶음(`rbo-…`)을 만들어 되살림 | 늘 한다(보존) |
| A6 | 검색어 전체가 `WB #123`·`WB#123`·`wb 123` → 그 해석에서 온 자료(맞은 곳 'WorkBench 해석') | 지금처럼 글자 검색 |

- 키: `LOGBOOK_WB_ORIGIN_SHOW=1`(기본 꺼짐). 되돌리기 = 키를 비우고 재시작. 열은 남겨 둔다.
- 받은 값은 `wb_origin.clean` 이 정한 칸만(analysis_id·owner·program·project·created_at·note·passport) 길이를 잘라 남긴다. 경로 등 모르는 칸은 버린다.
- 묶음 단위인 이유: 파일은 합치기·옮기기 뒤에도 원래 batch_id 를 간직한다.

## 파일
- 백엔드: `wb_origin.py`(새), `models.py`·`database.py`(Batch 2열·색인), `config.py`(`wb_origin_show`), `routers/integration.py`,
  `entries/service.py`(`wb_origins`), `entries/files.py`(entry.json `origins`), `ops/rebuild.py`, `search/mysql_backend.py`(`_wb_hits`)
- 프런트: `components/workbench/WbOrigins.jsx`, `pages/EntryPage.jsx`, `lib/labels.js`
- 테스트: `backend/tests/test_wb_origin_39.py`, `frontend/src/components/workbench/WbOrigins.test.jsx`

## 다음(Core 순서 ③~⑥)
③ 145 배포(키 꺼짐) → WB 보내기 한 번이 지금과 같은지 · ④ WorkBench B1(`LOGBOOK_SEND_PASSPORT`) · ⑤ 두 키 켜고 관리자 해석 1건 · ⑥ Core 02 L6 갱신.
