# 21 — 보고서 탐색과 독립 프로젝트

작성 2026-10-12 · 상태: **구현 완료(테스트 통과), 커밋은 사용자** · 개정 1(2026-10-12, 아래 '개정' 절)

## 0. 목표
보고서 파일 하나를 한 행으로 찾고 관련 모델을 함께 본다. 호선과 상관없는 독립 프로젝트 자료(보고서만 있는 것, 독립 프로젝트의
BDF 모델)도 같은 흐름으로 등록·분류·검색한다.

## 1. 동작
| # | 무엇 | 어떻게 |
|---|---|---|
| 1 | 보고서 화면 `/reports` | 보고서 파일 하나가 한 행(BDF 와 함께 등록된 보고서 포함). 파일 이름·자료 제목·본문·프로젝트·문서 분류로 검색(낱말끼리 AND). 자료 소속·프로젝트(여러 값, 또는)·문서 분류(미분류 포함)·관련 모델 유무로 거르고, 최신순·파일 이름순·관련도순. 고른 보고서는 원래 형식별 미리보기를 쓰고 관련 모델은 `/v/{file_id}` 뷰어로 연다. |
| 2 | **프로젝트 = 자료(Entry) 값** | 호선처럼 자료의 소속을 나타낸다(자료당 하나, 자유 값 + 자동완성). 정리 대기 카드·자료 상세 [변경하기]의 '프로젝트' 칸. 메인 검색 필터(`project=`, 한 칸 여러 값 — 19 규칙)·묶기('프로젝트별')·분류 화면·상단 자동완성(`/api/suggest/all` 의 `project`)·결과 행(문서·파일 보기)·검색어 적중(맞은 곳 '프로젝트')에 쓰인다. |
| 3 | **자료 소속 = 파생 값** | 따로 저장하지 않는다. 호선이 있으면 '호선 관련', 없고 프로젝트가 있으면 '독립 프로젝트', 없고 '호선 없음(공용)'이면 '공통 참고자료', 그 밖은 '미분류'(`report_catalog.scope_of`). 보고서 화면에서는 읽기만 하고 '자료 상세에서 변경' 링크로 자료 편집에 보낸다. |
| 4 | **필수 분류(20)와의 관계** | BDF 자료의 확정 필수 칸 '호선' 은 **호선 · '호선 없음(공용)' · 프로젝트 중 하나**면 채운 것으로 본다(독립 프로젝트 모델도 등록할 수 있게). 409 `required_fields` 의 이름은 그대로 `hull`, 화면 라벨은 '호선(또는 프로젝트)'. 자료 정비(빠진 필수 분류 목록·'보완 필요')도 같은 규칙. |
| 5 | **제목 초안(20)** | 호선이 없고 프로젝트가 있으면 제목 머리가 프로젝트 이름(`크레인 연구 · 기관실 · FE 해석 · M01`). 프로젝트가 '공용'보다 앞선다. 구별자에서 프로젝트 표기를 뺀다. 프로젝트를 바꾸면 사람이 고치지 않은 초안 제목이 따라 바뀐다. 같은 프로젝트(호선 없는 자료끼리)의 같은·비슷한 제목을 알린다. |
| 6 | 보고서별 정보 | **문서 분류**(해석 보고서·연구 보고서·시험 보고서·기술 검토·지침·기타)와 **'보고서에 사용한 모델'** 연결만 보고서마다 저장한다(DB). 같은 자료의 모델은 연결하지 않아도 '같은 자료의 모델'로 보인다. 저장은 자료를 고칠 수 있는 사람(올린 사람·LV3). |

## 2. 저장
- **프로젝트**: 태그 `kind='project'`(`tags`·`entry_tags`, 자료당 하나 — `entries.service.set_project`). 이미 있는 이름은 대소문자·공백이 달라도 그 이름으로 맞추고(MySQL 정렬 규칙), 동의어로 묶인 이름이면 대표 이름으로. entry.json `project`, 감사 스냅숏 `project`(있을 때만).
- **`report_meta`**(새 표): `file_id`(PK, files FK CASCADE) · `document_type` · `version`(동시 저장 확인) · `updated_by` · `updated_at`. 행이 없으면 미분류(version 0).
- **`report_model_links`**(새 표): `id` · `report_file_id` · `model_file_id`(둘 다 files FK CASCADE, 쌍 UNIQUE) · `created_by` · `created_at`.
- 새 표는 시작할 때 `init_schema()`(create_all)가 만든다 — 수동 DDL 불필요. 기존 표에 열은 더하지 않았다.
- **재구축 원천**: 보고서가 든 자료의 entry.json `reports` = `[{rel_path, sha256, document_type, version, updated_by, updated_at, models:[{entry_id, rel_path, sha256}]}]`(정보가 있는 보고서만). `ops/rebuild` 가 모든 자료를 되살린 뒤 `report_catalog.restore_reports` 로 잇는다(다른 자료의 모델도 가리키므로). sha256 이 다르면 잇지 않는다(그 사이 대체된 파일이 연결을 물려받지 않게).

### 파일 이동·휴지통 규칙
| 상황 | 결과 |
|---|---|
| 합치기 확정·[파일 추가](staging → 대상 자료) | 파일 행이 옮겨 갈 뿐 **file_id 가 같다** → 보고서 정보·연결이 그대로 따라간다(`test_file_id_follows_confirm_merge`). 쪼개기·합치기·파일 옮기기(초안끼리)도 file_id 를 바꾸지 않는다. 연결은 확정된 Vault 파일에만 걸리므로 초안 단계에는 걸린 연결이 없다. |
| 자료 휴지통 | 행을 남기고 화면에서만 숨긴다 — 그 자료의 보고서는 목록에서 빠지고, 그 자료의 모델은 다른 보고서의 관련 모델·건수에서 빠진다. 복원하면 그대로 돌아온다. |
| 영구 삭제(90일 자동·관리자) | 그 파일들의 `report_meta`·`report_model_links`(보고서 쪽·모델 쪽 모두)를 지우고, 그 모델을 연결했던 **다른 자료의 entry.json 을 다시 쓴다**(`report_catalog.purge_files`). |
| 볼 수 없게 된 모델 | 화면에서 숨기고, 편집자가 저장해도 그 연결은 지우지 않는다(남의 연결을 모른 채 잃지 않게). |

## 3. 감사
| 동작 | 언제 | target |
|---|---|---|
| `ENTRY_PROJECT` | 확정 자료에서 프로젝트만 바뀐 수정(다른 칸과 함께 바꾸면 `ENTRY_UPDATE`, 스냅숏에 `project`) | 자료 |
| `REPORT_META` | 보고서 문서 분류 변경 — before/after `{report: 상대경로, document_type}` | 보고서가 든 자료(자료 이력에 보인다) |
| `REPORT_LINKS` | '보고서에 사용한 모델' 연결 변경 — before/after `{report, models: ["E000123/상대경로", …]}` | 보고서가 든 자료 |

활동 로그 라벨은 `lib/labels.js` `ACTION_LABELS`. 예전 sidecar 의 `history` 는 없앴다.

## 4. API
| 경로 | 설명 |
|---|---|
| `GET /api/reports?q=&scope=&project=&document_type=&model=yes\|no&sort=recent\|title\|relevance&limit=&offset=` | 목록. `scope`·`project`·`document_type` 은 되풀이할 수 있다(같은 칸 OR). `document_type=__none__` = 미분류, `project=__none__` = 프로젝트 없음. 응답 `{total, items[], projects[{name,count}], no_project, scopes{}, document_types{}, applied}` — 거르기 칸 건수는 자기 칸만 빼고 센다. 항목 = 파일 검색 행 + `scope`·`project`·`document_type`·`model_count`. |
| `GET /api/reports/{file_id}/catalog` | `{file_id, entry_id, entry_title, document_type, version, updated_by, updated_at, scope, project, hulls, no_hull, related_models[{file_id,name,entry_id,entry_title,relation: explicit\|same_entry}], can_edit}`. 확정 자료의 Vault 보고서가 아니거나 볼 수 없으면 404 `report_not_found`. |
| `PUT /api/reports/{file_id}/catalog` `{version, document_type, model_ids[]}` | 저장(올린 사람·LV3, 아니면 403). 409 `report_catalog_conflict`(version 다름) · 422 `invalid_document_type`·`too_many_links`(50) · 404 `model_not_found`(볼 수 없는·휴지통·모델 아닌 파일). 프로젝트·소속은 받지 않는다. |
| `PATCH /api/entries/{id}` | `project: str \| null`(빈 값·null = 지움) |
| `GET /api/search` | `project=`(되풀이) 필터·`group=project`·facet `project`·행 `project`(문서·파일 보기)·파일 행 `no_hull`. 검색어가 프로젝트 이름·보고서 문서 분류에도 맞는다(문서 분류는 그 파일만 — 같은 자료의 다른 파일은 물려받지 않는다). |
| `GET /api/suggest?kind=project` · `GET /api/suggest/all` | 프로젝트 제안(볼 수 없는 자료에만 쓰인 이름은 빼는 태그 규칙과 같다). `suggest/all` 응답에 `project` 키 추가. |

### 목록 계산(성능·장애 격리)
DB 만으로 계산한다 — 공유 폴더를 읽지 않으므로 자료 폴더 하나가 없거나 깨져도 목록·상세가 실패하지 않는다. 기존 검색(`unit=file`, `kind=report`, 검색어)을 **한 번** 불러 권한·검색어를 적용하고, `report_meta`·관련 모델 수(질의 2번)를 붙인 뒤 소속·프로젝트·문서 분류·모델 유무로 거르고 **그다음** 쪽을 자른다. 검색 백엔드 확장은 최소만: 프로젝트 필터·적중, 보고서 문서 분류 적중, 파일 행의 `project`·`no_hull`.

## 5. 기존 sidecar(report-catalog.json) 이전
개정 전 초안은 자료 폴더에 `report-catalog.json`(+`.lock`)을 썼다. 쓰기 경로는 없앴고, 남은 파일은 CLI 로 옮긴다:

    .venv\Scripts\python.exe -m app.cli report-catalog-migrate            # 계획만(아무것도 바꾸지 않는다)
    .venv\Scripts\python.exe -m app.cli report-catalog-migrate --apply    # 옮기기

- 문서 분류·명시 연결 → `report_meta`·`report_model_links`(감사 `REPORT_META`/`REPORT_LINKS`, actor `system`). 이미 DB 에 정보가 있는 보고서는 건드리지 않는다(다시 돌려도 같다). 보고서 파일의 sha256 이 sidecar 와 다르면 '건너뜀'으로 보고, 연결 모델을 찾지 못하면 '연결할 모델을 찾지 못함'으로 보고한다.
- `scope=project` 의 프로젝트명 → 자료 프로젝트(자료 편집과 같은 경로 `update_entry`, 감사 `ENTRY_PROJECT`). **같은 자료 안 보고서끼리 이름이 다르거나 자료에 이미 다른 프로젝트가 있으면 충돌 목록에만 올리고 프로젝트는 바꾸지 않는다**(나머지 정보는 옮긴다 — 관리자가 자료 상세에서 정한다).
- `scope=reference` 만 있는 자료는 호선·프로젝트가 없으면 '호선 없음(공용)'으로 표시한다(공통 참고자료가 그 값에서 파생되므로). `hull`·`unclassified` 는 옮길 것이 없다(파생).
- 옮긴 뒤 sidecar 는 지우지 않고 `report-catalog.migrated.json` 으로 **이름만** 바꾸고(이미 있으면 시각을 붙인다), `report-catalog.lock`·`.report-catalog-*.tmp` 는 지운다. entry.json 을 다시 쓴다.
- 확정·휴지통 자료 폴더를 본다(휴지통 자료는 프로젝트·공용을 바꾸지 않고 보고서 정보만 옮긴다).

## 6. 운영 반영(145)
1. **DB 백업** — `.venv\Scripts\python.exe -m app.cli backup`(또는 관리 화면 '운영'의 수동 백업).
2. `git pull` → **API(uvicorn)·워커 재시작**. 시작할 때 `init_schema()` 가 `report_meta`·`report_model_links` 표를 만든다(열 추가 없음). 프런트 dist 는 커밋본.
3. sidecar 이전 — 먼저 보기만: `.venv\Scripts\python.exe -m app.cli report-catalog-migrate`. 충돌·건너뜀·찾지 못한 모델 목록을 확인한다(sidecar 가 하나도 없으면 '0건'으로 끝 — 할 일 없음).
4. 적용: `.venv\Scripts\python.exe -m app.cli report-catalog-migrate --apply`. 충돌로 남은 자료는 자료 상세 [변경하기]에서 프로젝트를 정한다.
5. 확인: 보고서 화면에서 문서 분류·관련 모델이 보이는지, 자료 이력에 '보고서 문서 분류 변경'·'프로젝트 변경' 줄이 있는지. 필수 분류가 빠졌던 독립 프로젝트 BDF 자료는 프로젝트를 넣으면 '보완 필요'가 사라진다(20 의 `naming-cleanup` 보고에서도 빠진다).

## 7. 개정 (2026-10-12)
처음 초안(Codex)은 기능 20 과 같은 파일을 피하려고 보고서 정보를 **자료 폴더의 sidecar** 에 두고 소속·프로젝트를 **보고서별 값**으로 저장했다. 사용자 결정에 따라 다음을 바꿨다.

| 바꾼 것 | 이유 |
|---|---|
| 프로젝트를 **자료 값**으로(보고서별 `project` 폐지) | 프로젝트는 호선처럼 자료의 소속이다. 보고서마다 따로 두면 같은 자료 안에서 갈라지고, 메인 검색·묶기·분류 화면·자동완성에서 쓸 수 없었다. |
| 보고서별 `scope` 폐지 → 자료 값에서 **파생** | 소속이 자료의 호선·공용(20 의 `no_hull`)과 따로 저장되면 둘이 어긋난다(호선 관련인데 호선이 없는 자료 등). 한 곳(자료)에서만 정한다. |
| 저장을 sidecar → **DB 표 2개**, 재구축 원천은 entry.json | 목록이 자료마다 공유 폴더 파일을 읽어 느리고, 폴더 하나만 못 읽어도 목록 전체가 503 이었다. 파일 잠금·원자 교체도 필요 없어진다. entry.json 은 이미 재구축 원천이라 같은 자리에 둔다. |
| sidecar `history` → **감사 로그**(`REPORT_META`·`REPORT_LINKS`·`ENTRY_PROJECT`) | 활동 로그·자료 이력 화면과 한 곳에서 보이게. |
| 목록: 낱말마다 전체 검색 되풀이(최대 8회) → **검색 한 번** | 검색어 AND·본문 발췌는 기존 검색이 이미 한다. 프로젝트·문서 분류만 검색 백엔드에 최소 확장(필터·적중). |
| 20 필수 분류: 프로젝트가 있으면 호선 면제 | 사용자 의도(독립 프로젝트 모델도 등록) — 제목 초안·보완 필요·자료 정비에도 같은 규칙. |
| 테스트: `backend/report_tests`(SQLite, FULLTEXT 를 LIKE 로 바꿔치기) → **`tests/test_reports_21.py`(logbook_test MySQL, conftest)** | 저장소 규칙(설계 §10 SQLite 금지). 실제 ngram FULLTEXT 로 본문·발췌를 시험한다. |
| 빌드 출력 | 저장소 규칙대로 `frontend/dist`(별도 경로 빌드 안 함). |

## 8. 범위와 제한
- 프로젝트 동의어 묶기 화면은 만들지 않았다(태그 `set_alias` 가 kind 를 가리지 않아 API 로는 LV3 가 묶을 수 있고, 검색·필터·재구축은 동의어를 따른다). 구역처럼 관리자 목록이 필요해지면 통제 어휘(08)로 올린다.
- 프로젝트는 자료당 하나다(여러 프로젝트에 걸친 자료는 대표 하나를 고른다).
- 미리보기 수준(PDF 원문, PPTX/DOCX 추출 텍스트, XLSX 일부 행)은 그대로.

## 9. 바뀐 곳
- 백엔드: `app/models.py`(`ReportMeta`·`ReportModelLink`·`REPORT_DOCUMENT_TYPES`) · `app/report_catalog.py`(DB 기반으로 다시 씀 — 읽기·저장·entry.json·재구축·영구 삭제·sidecar 이전) · `app/routers/reports.py`(다시 씀) · `app/entries/service.py`(`set_project`·`project_of`·entry_to_dict·snapshot·update_entry `project`/`ENTRY_PROJECT`·split 이 프로젝트 복사) · `app/entries/quality.py`·`naming.py`·`cleanup.py`(프로젝트 = 호선 대신) · `app/entries/files.py`(entry.json `project`·`reports`, _INFO.txt) · `app/search/base.py`·`mysql_backend.py`(필터·묶기·적중·행) · `app/routers/search.py`·`suggest.py`·`entries.py` · `app/ops/rebuild.py`·`purge.py` · `app/cli.py`(`report-catalog-migrate`). `backend/report_tests/` 삭제.
- 프런트: `pages/ReportsPage.jsx`(+test) · `components/ui/ProjectInput.jsx`(신규) · `components/inbox/DraftCard.jsx` · `pages/EntryPage.jsx`(프로젝트 칸·이력 줄) · `components/search/ResultList.jsx` · `components/shell/TopBar.jsx` · `pages/BrowsePage.jsx` · `pages/admin/CleanupPage.jsx` · `lib/search.js`(FILTER_KEYS·GROUPS) · `lib/labels.js`(감사·오류·소속·문서 분류) · `lib/entryEdit.js`·`lib/inboxStatus.js`(+test).
- ⚠ 같은 날 기능 22(보고서 본문 색인·검색, 별도 작업)가 `ReportsPage.jsx`·`main.py` 등에 이어서 작업했다. 22 는 이 문서의 API 계약(보고서 저장은 문서 분류·모델 연결만)을 따른다. 22 개정 1 에서 `GET /api/reports` 의 계산은 `report_index.search.list_reports` 로 옮겨(21 목록 + 22 본문 검색 한 곳) 응답 필드를 더했다(기존 필드·동작 그대로 — `tests/test_reports_21.py` 통과).

## 10. 테스트
- 백엔드 `tests/test_reports_21.py`(22건): 목록(같은 자료 모델·보고서만·Vault 아닌 파일 제외·쪽 자르기 전 거르기·공유 폴더를 읽지 않음), 소속 파생(호선>프로젝트>공용), 프로젝트 거르기·건수, 저장(권한·충돌·검사·숨은 연결 보존·감사·entry.json), 검색어(프로젝트+본문 AND, 문서 분류 적중이 형제 파일로 번지지 않음), 메인 검색 필터·묶기·자동완성·분류 화면, PATCH·`ENTRY_PROJECT`, 프로젝트로 BDF 확정·제목 초안, 자료 정비, 휴지통·복원·영구 삭제, 합치기 확정 후 file_id 유지, 재구축(entry.json → 표), 내용이 다른 파일 건너뜀, sidecar 이전(dry-run·apply·충돌·공용·재실행), 볼 수 없는 자료의 프로젝트 이름 숨김. 기존 `test_search_19.py` 의 `suggest/all` 기대값에 `project` 추가.
- 프런트 `pages/ReportsPage.test.jsx`(9건) · `lib/entryEdit.test.js` · `lib/inboxStatus.test.js`.

```powershell
# backend (logbook_test, 순차)
.\.venv\Scripts\python.exe -m pytest tests/test_reports_21.py -q
# frontend
npx vitest run src/pages/ReportsPage.test.jsx
npm run build    # frontend/dist
```

## 11. 이후 변경(23)
- 문서 분류에 발표자료·회의자료·계산서를 더했다(9개). 저장되지 않은 .ppt/.pptx 는 '발표자료'로 읽을 때 추정한다(행을 만들지 않음, '자동' 표시). 화면 이름 '보고서' → '문서', 상단 빠른 구분(전체/보고서/발표자료/기타). 상세: `2026-10-12-logbook-23-document-types.md`.
