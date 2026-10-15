# 20 — 자료 이름·필수 분류 정비

작성 2026-10-12 · 상태: **구현 완료(테스트 통과), 커밋은 사용자**

## 0. 목표
모델이 수백 개로 늘어도 검색·묶기·호선순 정렬·WorkBench 보내기 규칙(구역·태그)이 기대는 **구조화 값(호선·구역·해석 종류)**이
빠지지 않게 하고, 제목을 그 값에서 일정한 형식으로 만든다. 이미 확정된 자료도 같은 규칙에 맞출 수 있게 운영자 도구를 둔다.

## 1. 바뀐 동작
| # | 무엇 | 어떻게 |
|---|---|---|
| 1 | **BDF 자료는 필수 분류가 있어야 확정** | 파일 중 `kind=model`(휴지통 제외)이 있으면 **호선(또는 '호선 없음(공용)')·구역·해석 종류** 가 모두 있어야 확정한다. 서버 `entries.service.confirm` 이 **409 `{"detail":{"code":"required_fields","missing":["hull","zone","analysis_type"]}}`** (빠진 칸만, 17 의 `duplicate_model` 과 같은 `detail.code` 관례). 정리 대기 카드는 같은 규칙(`inboxStatus.draftChecks`)으로 **확정 단추를 잠그고** 단추 설명·'확인할 것' 줄에 이유를 보인다. BDF 없는 자료(보고서만 등)는 예전처럼 호선·해석 종류를 권하기만 한다. 기존 자료에 파일을 더하는 초안(`merge_into`, [파일 추가]·자동 합치기)은 대상 자료의 분류를 따르므로 검사하지 않는다. |
| 1-b | **'호선 없음(공용)'** | 특정 호선이 없는 공용 모델을 위한 명시적 선택. `entries.no_hull`(불리언). 고르면 호선을 비우고, 호선을 넣으면 풀린다(함께 보내면 422 `no_hull_with_hulls`). 정리 대기 카드·자료 상세 [변경하기] 의 호선 칸 아래 체크 상자. 검색 결과 행·상세 속성에 '공용', **호선별 묶기에서 '공용' 묶음**(값 `__shared__`, '호선 없음' 묶음과 따로, 값 있는 묶음 뒤·'호선 없음' 앞, 거르기 단추 없음). 호선 필터 값으로는 쓰지 않는다. |
| 2 | **제목 초안 = 구조화 값** | 순수 함수 `entries/naming.py`: `{호선} · {구역} · {해석 종류} · {구별자}`(값 없는 칸은 건너뜀, 여러 값은 첫 값 + `외 N`, 공용은 `공용`). **구별자** = 원래 폴더/파일 이름(`entries.title_source`)에서 그 자료의 호선 번호(H3496·3496호선 포함)·고른 구역/해석 종류의 표기(용어·동의어, 토큰 1~3개 이어 맞춤, 2글자 이상 앞부분 일치 — `권상` ↔ `권상 해석`)·잡음(final·최종·copy·복사본·사본·backup·bak·tmp·temp·new)을 뺀 나머지. 예: `3496_선수부_M04_rev3_final` → `3496 · 선수부 · 권상 해석 · M04 rev3`. 세 값이 모두 없으면 예전 방식(이름의 `_` → 공백). |
| 2-b | 수신함 초안 | 올리기 때 호선을 알면 형식(`3496 · M04 rev3`), 모르면 예전 방식. `title_source` 에 원래 이름(폴더 이름 또는 확장자 뗀 파일 이름)을 남긴다(20 이전 자료는 NULL → 파일 경로로 추정: 모든 파일이 한 폴더 아래면 그 폴더, 아니면 첫 BDF/파일 이름). 정리 대기에서 호선·공용·구역·해석 종류를 바꿔 **저장하면**, 제목이 초안 그대로(형식 초안 또는 예전 방식 이름과 같음)일 때만 서버가 제목을 새 값으로 다시 만든다. 직접 고친 제목은 그대로 두고, 카드에 '형식: …' 과 **[형식대로 다시 만들기]**(PATCH `title_auto: true`)를 보인다. 같은 저장에 제목과 값을 함께 바꾸면 사람이 쓴 제목이 이긴다. 원래 파일 이름은 파일 목록에 그대로 남는다. |
| 3 | **같은 호선의 같은·비슷한 제목 알림** | 초안 응답의 `similar_entries`(`entries.quality.similar_entries`): 같은 호선(공용 자료는 공용끼리)의 확정 자료 중 제목 열쇠가 같으면 `same`, 호선 번호를 뺀 낱말 겹침(Jaccard) ≥ 0.6 이면 `similar`(최대 5건, 볼 수 없는 자료는 뺀다 — 13). 카드에 경고 + 자료 링크 + **[새 판이면 이 자료에 추가]**(기존 합치기 제안과 같은 `merge_into_id` PATCH → 확정하면 그 자료에 파일이 들어가 판 묶음(14)으로 이어진다). 막지 않는다. 올리기 때의 '비슷한 기존 자료에 추가할까요?'(`ingest.process._find_similar`, 0.5)는 그대로이고 낱말 함수만 공유한다. |
| 4 | **기존 자료 정비** | 관리자(LV3) **'자료 정비'**(`/admin/cleanup`, 관리 메뉴): ① 빠진 필수 분류 — 확정 BDF 자료 중 빠진 칸·지금 값·올린 사람, 빠진 칸·올린 사람·번호/제목으로 거르기, 번호 링크 → 자료 화면 [변경하기] 로 채운다. ② 제목 형식 — 미리보기(바꿀 수 있음 / 제외 사유: 필수 분류 빠짐·분류 값 없음, 이미 형식인 자료는 목록에 없음) → 행별 [바꾸기] 또는 골라서 일괄. ③ 바꾼 기록 — 한 건씩 원래 제목으로 **되돌리기**. 확정 자료를 숨기거나 상태를 바꾸지 않는다 — 올린 사람·LV3 에게만 **'보완 필요 · 구역'** 작은 표시(검색 결과 행·자료 상세 머리, 응답 `needs_fix`). |

## 2. 저장·감사
- 새 열(시작 시 `database.ADDED_COLUMNS` 가 자동으로 더한다 — 수동 ALTER 불필요):
  `entries.no_hull TINYINT(1) NOT NULL DEFAULT 0`, `entries.title_source VARCHAR(255) NULL`.
- `entry.json` 에 `no_hull`(참일 때만)·`title_source`(있을 때만)를 쓰고 `rebuild` 가 되살린다. Entry 단위 값이라 `registry.json` 은 바뀌지 않았다.
- 감사 스냅숏(`snapshot`)에 `no_hull`(참일 때만). 정비 적용·되돌리기는 자료 편집과 **같은 함수**(`service.update_entry`)를 타서 version 이 오르고
  `ENTRY_RETITLE` / `ENTRY_RETITLE_REVERT`(before/after = 스냅숏, 옛·새 제목 포함)와 entry.json 이 남는다. 되돌리기는 **지금 제목이 그때 바꾼 제목 그대로일 때만**(아니면 409 `title_changed_since`, 기록 없음 409 `nothing_to_revert`).
- 적용은 서버가 그 자리에서 다시 계산한다 — 미리보기 뒤 자료가 바뀌었으면(version·제안 제목) 건너뛰고 이유를 돌려준다(`version_conflict`·`proposal_changed`·`blocked`·`already_formatted`).

## 3. API
| 경로 | 설명 |
|---|---|
| `PATCH /api/entries/{id}` | `no_hull: bool`, `title_auto: bool` 추가 |
| `POST /api/entries/{id}/confirm` | 409 `required_fields` (위) |
| `GET /api/entries/{id}` | `no_hull`·`required_missing`·`title_source`·`title_draft`·`title_is_auto`(초안)·`needs_fix`(확정, 고칠 수 있는 사람)·`similar_entries`(초안) |
| `GET /api/search` | 행에 `no_hull`·`needs_fix`, `group=hull` 에 `__shared__` 묶음(label `공용`, `group_value=__shared__` 더 보기) |
| `GET /api/admin/cleanup/missing?missing=&uploader=&q=&offset=&limit=` | 빠진 필수 분류 목록(LV3) |
| `GET /api/admin/cleanup/titles?status=ready\|blocked&q=&offset=&limit=` | 제목 형식 미리보기(LV3) |
| `POST /api/admin/cleanup/titles/apply` `{items:[{entry_id, version?, new_title?}]}` | 적용 → `{applied, skipped}` |
| `GET /api/admin/cleanup/titles/applied` · `POST /api/admin/cleanup/titles/revert {entry_id}` | 바꾼 기록 · 되돌리기 |

## 4. 바뀐 곳
- 백엔드: `app/entries/naming.py`(신규, 순수 함수) · `app/entries/quality.py`(신규 — 필수 분류·제목 초안 문맥·비슷한 제목) · `app/entries/cleanup.py`(신규 — 정비 목록·미리보기·적용·되돌리기) · `app/routers/admin_cleanup.py`(신규) · `app/entries/service.py`(confirm 409, update_entry `no_hull`·`title_auto`·초안 제목 따라가기·`action`/`system_actor`, entry_to_dict 새 칸, split 이 `no_hull`·`title_source` 복사) · `app/routers/entries.py`(EntryPatch) · `app/ingest/proposal.py`(`source`) · `app/ingest/process.py`(형식 제목·`title_source`, 낱말 함수 공유) · `app/search/base.py`·`mysql_backend.py`(공용 묶음·`needs_fix`) · `app/entries/files.py`·`app/ops/rebuild.py`(entry.json) · `app/models.py`·`app/database.py`(열) · `app/cli.py`(`naming-cleanup`) · `app/main.py`.
- 프런트: `lib/entryEdit.js`(`no_hull`·`missingRequired`·`hasBdf`) · `lib/inboxStatus.js`(BDF 필수 분류 blocking) · `lib/labels.js`(감사 라벨·오류·`requiredText`) · `lib/search.js`(`GROUP_SHARED`) · `components/inbox/DraftCard.jsx`(공용 체크·확정 잠금·제목 형식 안내/다시 만들기·비슷한 제목) · `pages/EntryPage.jsx`(공용 체크·표시·보완 필요) · `components/ui/NeedsFixBadge.jsx`(신규) · `components/search/ResultList.jsx`·`GroupedResults.jsx` · `pages/admin/CleanupPage.jsx`(신규) · `App.jsx`·`components/shell/SideNav.jsx`.

## 5. 운영 반영(145)
1. **DB 백업** — 새 열이 자동으로 더해지고 정비 적용이 제목을 바꾸므로 반영 전에 백업한다: `.venv\Scripts\python.exe -m app.cli backup` (또는 관리 화면 '운영' 의 수동 백업).
2. `git pull` → **API(uvicorn)·워커 재시작**. 시작할 때 `init_schema()` 가 `entries.no_hull`·`entries.title_source` 를 더한다(기존 행 = 공용 아님·원래 이름 없음). 프런트 dist 는 커밋본을 쓴다(145 에 Node 불필요).
3. 정비 순서(관리자):
   1. 보기만: `.venv\Scripts\python.exe -m app.cli naming-cleanup` — 빠진 필수 분류 목록과 바꿀 제목 미리보기(아무것도 바꾸지 않는다).
   2. 화면 **관리 › 자료 정비 › 빠진 필수 분류** 에서 자료를 열어 호선(또는 '호선 없음(공용)')·구역·해석 종류를 채운다(올린 사람에게 맡겨도 된다 — 그 사람 화면에 '보완 필요' 가 보인다).
   3. **제목 형식** 에서 미리보기를 확인하고 행별 [바꾸기] 또는 골라서 일괄 적용. 일괄로 모두 바꾸려면 `naming-cleanup --apply`(바꿀 수 있는 것만, 감사 기록 actor `system`).
   4. 잘못 바꾼 것은 **바꾼 기록** 에서 [되돌리기](지금 제목이 바꾼 제목 그대로일 때만).
4. 되돌릴 수 없는 변경은 없다(제목은 감사 기록으로 되돌릴 수 있고, 새 열은 기본값이라 예전 코드도 무시한다). 그래도 일괄 적용 전 백업을 권한다.

## 6. 판단한 것
- 필수 칸은 **확정 시점에만** 강제한다. 이미 확정된 자료를 고칠 때 칸을 비우는 것은 막지 않는다(그 자료에 '보완 필요' 가 붙는다) — 기존 자료를 숨기거나 상태를 바꾸지 말라는 결정과 맞춘다.
- `merge_into`(기존 자료에 파일 추가, [파일 추가] 자동 합치기)는 검사하지 않는다 — 들어가는 쪽 자료의 분류를 따른다. 대상 자료에 빠진 칸이 있으면 그 자료가 '보완 필요' 로 보인다.
- 올리기 때 구역·해석 종류를 이름에서 추측해 채우지는 않았다(정리 대기에서 사람이 고른다). 그래서 올라온 초안 제목은 보통 `호선 · 구별자` 로 시작하고, 값을 고르면 따라 바뀐다.
- 구별자는 **이 자료가 고른 값의 표기만** 뺀다(다른 호선 번호·고르지 않은 구역 이름은 남긴다 — 정보를 잃지 않게).
- 비슷한 제목 경고 문턱은 0.6(호선 번호 제외). 형식 제목은 같은 호선·구역·해석 종류끼리 앞부분이 같아 0.5 로는 판만 다른 자료가 모두 걸렸다.
- 정비 제목 변경 대상은 '분류 값이 하나 이상 있는 자료' 만이다(값이 없으면 예전 방식 제목 = 파일 이름으로 되돌아가 사람이 지은 제목을 잃는다).

## 7. 테스트
- 백엔드 `tests/test_naming_20.py` — 구별자 표(9건)·형식 규칙·원래 이름 추정, 확정 필수값(BDF 유/무·공용·합치기 예외·API 409 모양·공용+호선 422), 초안 제목 따라가기/직접 수정 보존/[형식대로 다시]/예전 제목, 올리기 형식 제목, 비슷한 제목(같은·비슷한·다른 호선·볼 수 없는 자료), 정비 API(목록·권한 403·미리보기·적용·감사·되돌리기·오래된 미리보기·되돌리기 거부), CLI dry-run/apply·인자, 검색 `needs_fix`(올린 사람만)·공용 묶음, entry.json.
  기존 테스트: `conftest.setup_entry_with_files` 가 구역·해석 종류를 채우고, `fill_required` fixture 를 더했다. `test_process` 의 제목 기대값을 새 형식으로.
- 프런트 `lib/entryEdit.test.js`·`lib/inboxStatus.test.js`·`components/inbox/DraftCard.test.jsx`·`components/search/GroupedResults.test.jsx`·`pages/admin/CleanupPage.test.jsx`.

결과(2026-10-12, 개발 PC): 백엔드 `pytest -q` **957 passed**(25분) · 프런트 `npx vitest run` **602 passed (84 files)** · `npm run build` 성공.

## 8. 이후 변경(21)
- 21 에서 **프로젝트**(자료 값, 태그 kind=project)가 생겼다. BDF 자료의 필수 칸 '호선' 은 이제 호선 · '호선 없음(공용)' · 프로젝트 중 하나면 채운 것으로 본다(409 `missing` 이름은 그대로 `hull`, 화면 라벨 '호선(또는 프로젝트)'). 제목 초안은 호선이 없으면 프로젝트 이름이 머리(`프로젝트 · 구역 · 해석 종류 · 구별자`, 프로젝트가 '공용'보다 앞선다), 비슷한 제목은 호선 없는 자료끼리 같은 프로젝트에서 찾는다. 자료 정비·'보완 필요'도 같은 규칙. 상세: `2026-10-12-logbook-21-report-catalog.md`.
