# 23 — 발표자료 분류 · 문서 메뉴

작성 2026-10-12 · 상태: **구현 완료(테스트 통과), 커밋은 사용자**

## 0. 목표
파일 종류는 확장자로 정해지고(`ingest/rules.py`) .pdf·.pptx·.ppt·.docx·.doc·.xlsx·.xls 가 모두 `report` 다. 그래서 발표자료도
이미 21·22 의 보고서 화면(`/reports`)에 나오고 본문 색인·요약도 된다. 별도 탭을 만들지 않고(사용자 승인 추천안),
**문서 분류 값을 넓히고 · 발표 파일은 자동으로 '발표자료'로 보이게 하고 · 화면 위에 빠른 구분을 두고 · 메뉴 이름을 '문서'로** 바꾼다.

## 1. 바뀐 동작
| # | 무엇 | 어떻게 |
|---|---|---|
| 1 | **문서 분류 값 확장** | 해석 보고서 · 연구 보고서 · 시험 보고서 · 기술 검토 · **발표자료 · 회의자료 · 계산서** · 지침 · 기타(이 순서가 고르기 순서). 목록은 **서버 한 곳**(`models.REPORT_DOCUMENT_TYPES`)이고 `GET /api/reports` 응답의 `document_type_options` 로 내려준다 — 프런트의 사본(`labels.DOCUMENT_TYPES`)은 없앴다. |
| 2 | **발표 파일 자동 분류** | 문서 분류가 **저장되지 않은**(report_meta 행이 없는) `.ppt`·`.pptx` 는 '발표자료'로 **추정해 보여 준다**(저장하지 않음). 목록 행·미리보기에 '자동' 표시. 편집 칸은 그 값으로 미리 채워지고 "파일 형식으로 미리 채운 값 — 저장하면 확정" 안내. 저장(같은 값이어도, 다른 값·미분류로 바꿔도)하면 확정되어 그 뒤로는 추정하지 않는다. PDF 등은 추정하지 않는다. |
| 3 | **빠른 구분** | 문서 화면 위 `전체 / 보고서 / 발표자료 / 기타`(건수 포함). 문서 분류 거르기 값을 묶어서 거는 **바로가기**다 — 누르면 `document_type=` 값들이 주소에 되풀이로 남고(19 다중값 규칙, 같은 칸 OR), 같은 값이 '문서 분류' 거르기 칩으로도 보인다. 주소의 값 집합이 어느 묶음과 같으면 그 단추가 켜지고, 다른 조합이면 아무것도 켜지지 않는다. 문서 분류 거르기는 한 값 고르기(Select)에서 **여러 값(칩)** 으로 바꿨다. |
| 4 | **이름 '보고서' → '문서'** | 메뉴·화면 제목·설명·검색 칸·건수 줄('문서 N개')·빈 상태·미리보기·요약 단추('이 문서 근거로 요약')·관련 모델 문구('문서에 사용한 모델', '문서만')와 파일 종류 라벨(`KIND_LABELS.report` = '문서' → 메인 검색 결과 행 'BDF 2 · 문서 1 · …', 파일 종류 필터·배지, 대표 문서 줄)·작업 종류('문서 본문 추출')·감사 라벨('문서 분류 변경'·'문서 모델 연결 변경')·오류 문구·상단 검색 안내·정리 대기 안내·운영 화면·로그인 화면. |
| 5 | **기존 자료 정비 CLI** | `document-type-fill` — 문서 분류가 저장되지 않은 확정 자료의 Vault `.ppt`·`.pptx` 에 '발표자료'를 **실제로 저장**한다. 기본 dry-run(대상 목록), `--apply` 시 report_meta 저장 + 감사 `REPORT_META`(actor `system`) + entry.json 갱신. |

### 빠른 구분 정의(`report_catalog.DOCUMENT_TYPE_GROUPS`)
| 단추 | 문서 분류 값 | 판단 |
|---|---|---|
| 전체 | (거르기 없음) | |
| 보고서 | 해석 보고서 · 연구 보고서 · 시험 보고서 · 기술 검토 · 지침 | 문장으로 쓴 정식 문서. 지침도 읽는 문서라 여기 둔다. |
| 발표자료 | 발표자료 · 회의자료 | 슬라이드·회의 배포물. |
| 기타 | 계산서 · 기타 · 미분류(`__none__`) | 계산서(엑셀 등)·분류 안 한 것. 미분류는 여기서 찾아 분류한다. |

모든 문서 분류 값과 미분류가 정확히 한 묶음에 든다(`test_document_type_list_and_groups_cover_every_value`). 묶음도 목록 응답
`document_type_groups` 로 내려준다. 건수 = 서버의 문서 분류 칸 건수(다른 거르기·검색어는 적용, 문서 분류 칸만 뺀 셈 — 21 규칙)를
묶음별로 더한 값이라, 다른 묶음으로 옮겨 가도 단추 건수가 그대로다. '전체' = 모든 칸의 합.

## 2. 기본값 방식 결정 — 읽을 때 추정(저장하지 않음)
`report_catalog.effective_document_type(meta, name)` 한 곳: report_meta 행이 있으면 저장값, 없으면 확장자 추정(`AUTO_DOCUMENT_TYPES`).

| 기준 | 읽을 때 추정(채택) | 확정 시점에 행 생성(안 함) |
|---|---|---|
| 거르기·건수 | 목록 계산(`list_reports`)이 같은 함수로 값을 정하므로 거르기·건수·검색어 적중이 늘 일치 | 일치하지만 행을 만드는 모든 길을 빠짐없이 막아야 함 |
| 들어오는 길 | 확정·합치기 확정·[파일 추가]·자동 합치기·재구축·sidecar 이전 어디로 들어와도 같은 규칙 | 길마다 훅이 필요 — 하나라도 빠지면 그 파일만 미분류로 남는다 |
| 재구축 | 추정값은 DB·entry.json 에 없고 확장자에서 다시 나오므로 재구축 뒤에도 같다 | entry.json 에 실린 값으로 되살아남(가능하지만 위 누락 위험 그대로) |
| 감사·버전 | 사람이 정하지 않은 값이 감사 기록·version 을 만들지 않는다 | 확정마다 system 기록이 쌓이고 version 1 이 '사람이 정함'처럼 보인다 |
| 사용자 변경 | 저장하면 확정. '미분류'로 저장하면 NULL 행이 생겨 다시 추정하지 않는다 | 같음 |

- 메인 검색(`/api/search`)의 문서 분류 적중도 같은 규칙을 따른다 — 검색어가 '발표자료'의 일부(예: `발표`)이면 행 없는 `.ppt/.pptx` 보고서 파일이 맞는다(그 파일만, 21 규칙).
- 저장 API(`PUT /api/reports/{id}/catalog`): 행이 없고 추정값이 있던 파일은 **같은 값을 보내도 저장한다**(확정). 감사 before 에 `document_type_auto` 를 남겨 이력이 '자동 발표자료 → 발표자료' 로 보인다.
- report_meta 행이 있고 문서 분류가 NULL 인 경우 = 사용자가 '미분류'로 저장(또는 모델 연결만 저장 — 화면은 이때 미리 채운 값을 함께 보내므로 보통 확정된다)이라 추정하지 않는다.
- 응답 필드: 목록 항목·`GET /catalog` 에 `document_type_auto: bool` 추가. `document_type` 은 추정값을 포함한 보이는 값.

## 3. 이름 변경 범위
- **바꾼 곳(화면)**: SideNav '문서', 문서 화면 전부(제목·설명·탭·검색 칸·건수·빈 상태·로딩·미리보기·편집·요약·관련 모델·aria 라벨), `KIND_LABELS.report`='문서'(메인 검색 결과 행 종류 수·파일 종류 필터·배지 대체 글자), `RowInsight` 대표 문서 줄, `JOB_TYPE_LABELS.extract_file`='문서 본문 추출', `ACTION_LABELS.REPORT_META/LINKS`='문서 분류 변경/문서 모델 연결 변경', 오류 `report_not_found`·`report_catalog_conflict`, 상단 검색 칸 안내, 정리 대기 진행 안내, 운영 화면 추출 안내, 로그인 화면 소개, 자료 이력 줄.
- **일부러 둔 곳**: 주소 `/reports`·`/report-search`(리다이렉트), API 경로 `/api/reports…`, DB·응답 값 `kind='report'`, 감사 동작 코드 `REPORT_META`·`REPORT_LINKS`, 테이블 이름(`report_meta`·`report_model_links`), entry.json `reports` 키(재구축 원천 호환). 빠른 구분 단추 '보고서'와 문서 분류 값 '해석 보고서' 등은 문서 분류 값 자체라 그대로. 정리 대기 호선 근거 문구 `보고서 본문: 파일명`(`extract/job.py`)은 초안 Entry 의 `hull_evidence` 에 **저장되는 값**이고 중복 판정 열쇠라 그대로 뒀다. 22 근거 요약의 LLM 시스템 프롬프트·`scope_note`(화면 미표시)·서버 로그 문구도 그대로.

## 4. 저장·감사·스키마
- **스키마 변경 없음**(새 표·열 없음). `report_meta.document_type` 은 VARCHAR(50) 그대로 새 값을 담는다.
- 감사: 화면 저장은 21 의 `REPORT_META`(before 에 추정값이 있었으면 `document_type_auto`). CLI 는 같은 동작 코드, actor `system`, after 에 `source: "document-type-fill"`.
- entry.json `reports` 는 저장된 값만 싣는다(추정값은 싣지 않는다). '미분류'로 저장한 발표 파일은 `document_type: null` 로 실려 재구축 뒤에도 추정하지 않는다.

## 5. CLI
    .venv\Scripts\python.exe -m app.cli document-type-fill            # 대상 목록만(아무것도 바꾸지 않는다)
    .venv\Scripts\python.exe -m app.cli document-type-fill --apply    # 저장

- 대상 = 확정 자료·Vault·kind report·확장자 .ppt/.pptx·report_meta 행 없음(= 화면의 '자동' 파일). 휴지통·초안 자료는 보지 않는다.
- '미분류'로 저장된 발표 파일(행 있음·값 NULL)은 **건너뛰고** `[건너뜀]` 으로만 보고한다.
- 자료마다 행 잠금 뒤 다시 확인하므로(그 사이 사용자가 저장했으면 덮지 않음) 운영 중에 돌려도 된다. 다시 돌려도 바뀌는 것이 없다.

## 6. 145 반영
1. **DB 백업**(CLI `--apply` 가 문서 분류를 쓰므로): `.venv\Scripts\python.exe -m app.cli backup`
2. `git pull` → **API(uvicorn)·워커 재시작**(DB 표·열 변경 없음, 프런트 dist 는 커밋본). 재시작만으로 발표 파일이 '발표자료(자동)'로 보이고 빠른 구분·거르기에 잡힌다.
3. 보기만: `.venv\Scripts\python.exe -m app.cli document-type-fill` — 대상 목록·건너뜀 확인.
4. 적용: `.venv\Scripts\python.exe -m app.cli document-type-fill --apply`.
5. 확인: 문서 화면 빠른 구분 건수, 발표 파일 행의 '자동' 표시가 사라졌는지, 자료 이력에 '문서 분류 변경 — 자동 발표자료 → 발표자료' 줄.
- 21·22 가 같이 반영되는 경우 21 절차(백업 → 재시작 → `report-catalog-migrate`)를 먼저 끝낸 뒤 3~4 를 한다(migrate 가 옮긴 문서 분류는 행이 생겨 이 CLI 대상에서 빠진다).

## 7. 바뀐 곳
- 백엔드: `app/models.py`(`REPORT_DOCUMENT_TYPES` 9개) · `app/report_catalog.py`(`NONE`·`DOCUMENT_TYPE_GROUPS`·`AUTO_DOCUMENT_TYPES`·`auto_document_type`·`effective_document_type`, `catalog` 의 `document_type_auto`, `save` 확정 규칙·감사 before, `fill_document_types`) · `app/report_index/search.py`(추정값으로 거르기·건수·적중, 응답 `document_type_options`·`document_type_groups`·항목 `document_type_auto`) · `app/search/mysql_backend.py`(메인 검색 문서 분류 적중에 추정값) · `app/cli.py`(`document-type-fill`).
- 프런트: `pages/ReportsPage.jsx`(문서 이름·`QuickTypes`·여러 값 `TypeFilter`·'자동' 표시·서버 목록 사용) · `lib/labels.js`(KIND·작업·감사·오류 라벨, `DOCUMENT_TYPES` 삭제) · `components/shell/SideNav.jsx`·`TopBar.jsx` · `components/search/RowInsight.jsx`·`ResultList.jsx`(주석) · `lib/inboxStatus.js` · `pages/admin/OpsPage.jsx` · `pages/LoginPage.jsx` · `pages/EntryPage.jsx`(이력 줄 '자동 …').
- 테스트: `tests/test_document_types_23.py`(신규) · `ReportsPage.test.jsx`·`EntryPage.test.jsx`·`SideNav.test.jsx`·`SearchPage.test.jsx`·`labels.test.js`·`OpsPage.test.jsx` 기대 문자열.

## 8. 테스트
- 백엔드 `tests/test_document_types_23.py`(7건): 목록·묶음이 모든 값+미분류를 한 번씩 덮음·추정값이 목록 안 값, 응답의 목록·묶음, 발표 파일 추정(행 안 만듦·PDF 제외·거르기/건수/미분류·보고서 화면과 메인 검색 적중), 저장(다른 값 우선·미분류 저장 시 NULL 행과 재추정 없음·감사 before·entry.json·새 값 저장), 재구축 뒤 추정 유지, CLI dry-run/apply(미분류 저장 건너뜀·초안 제외·감사·entry.json·재실행 무변화), CLI 인자.
- 프런트 `ReportsPage.test.jsx`(+4: 빠른 구분 건수·주소·칩, 주소 값으로 단추 상태, 여러 값 거르기와 서버 목록 순서, 자동 표시·확정 저장) · `EntryPage.test.jsx`(+1: 이력 '자동 발표자료 → 발표자료').

```powershell
# backend (logbook_test, 순차)
.\.venv\Scripts\python.exe -m pytest tests/test_document_types_23.py tests/test_reports_21.py -q
# frontend
npx vitest run src/pages/ReportsPage.test.jsx src/pages/EntryPage.test.jsx
npm run build    # frontend/dist
```

## 9. 하지 않은 것
- PDF·DOCX 의 내용 기반 자동 분류(사용자 결정 — PDF 는 추정하지 않음).
- 별도 '발표자료' 탭·메뉴(빠른 구분으로 대신).
- 주소·API·DB 값의 'report' → 'document' 개명(호환을 위해 그대로).
- 브라우저 육안 검증(vitest·빌드로만 확인).
