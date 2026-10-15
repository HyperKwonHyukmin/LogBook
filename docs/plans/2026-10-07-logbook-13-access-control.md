# 13 — 사용자 등급 + 자료(Entry)별 비공개

선행: 01(사번 로그인·승인), 03a(검색), 05(registry.json·재구축), 10(즐겨찾기), 11(최근 비교), 12(같은 BDF — `_visible()` 자리).
사용자 요청(2026-10-07): 등급 5종(Master·관리자·전체 열람·승인 열람·Guest)과 자료별 공개/비공개, 비공개 자료의 개별 열람 허락.
**볼 수 없는 사용자에게는 자료의 존재 자체를 숨긴다**(403 이 아니라 404, 목록·건수에서도 빠진다).

> ⚠ **앱 권한은 앱 안에서만 지켜진다.** `999_LogBook` 공유 폴더에 Windows 접근 권한이 있는 사람은 탐색기로 파일을 직접 열 수 있으므로,
> 비공개를 실제로 보장하려면 그 폴더 NTFS/공유 권한을 서버 서비스 계정 위주로 좁혀야 한다(IT 확인 필요).
> 이 계획서의 모든 숨김은 Logbook 화면·API 기준이다. `_INFO.txt`·`entry.json` 에는 공개 범위만 적고(아래 §5) 열람 허락 명단은 적지 않는다.

## 1. 등급

| 등급 코드 | 화면 이름 | 권한 |
|---|---|---|
| `master` | Master | 전부. 관리자 지정·해제와 Master 이양은 Master 만. 시스템에 많아야 1명(없을 수 있음 — CLI 로 지정) |
| `admin` | 관리자 | 사용자 승인·등급 지정(guest·member·viewer_all 까지), 모든 자료 열람·수정·휴지통, 분류 목록·운영(예전 `is_admin` 기능 전부) |
| `viewer_all` | 전체 열람 | 비공개(최소 등급 `viewer_all`) 포함 확정 자료 열람, 올리기, 자기 자료 수정 |
| `member` | 승인 열람 | 공개 자료 + 자기가 올린 자료 + 열람 허락받은 비공개 자료, 올리기, 자기 자료 수정 |
| `guest` | Guest | 공개 자료 보기만. 올리기·수정·태그 묶기·해석 검증 요청·배치 가져가기·호선 선종/메모 수정 불가(403 `read_only_role`). 즐겨찾기·화면 설정·최근 비교는 된다 |

- 판단은 `backend/app/access.py` 한 곳: `role_of`·`role_rank`·`is_admin`(관리자 이상)·`can_write`(member 이상)·`require_writer`·
  `can_view_entry`·`visible_entries_filter`(SQL 조건)·`visible_entry_pks`·`file_visible`·`can_edit_entry`·`access_brief`.
  예전 `user.is_admin` 검사는 모두 `access.is_admin(user)` 로 바꿨다(`dependencies.require_admin` 포함). 새 의존성 `require_writer`.
- 등급 바꾸기 규칙은 `backend/app/roles.py` 한 곳(관리 화면·CLI 공용):
  - 관리자는 guest·member·viewer_all 사이만. admin 지정·해제(관리자 등급 사용자를 바꾸기)와 Master 지정은 Master 만(403 `master_required`).
  - Master 지정 = **이양**: 새 Master 를 정하면 이전 Master 는 admin 이 된다(감사 `MASTER_TRANSFER` + 이전 Master 의 `USER_ROLE`).
  - 마지막 Master 는 이양으로만 바뀐다 — 직접 내리기 409 `master_transfer_only`, 비활성·거절 409 `master_protected`.
  - 자기 자신의 등급은 내릴 수 없다(400 `cannot_change_self`, 예전 보호 그대로). 관리자 등급 사용자의 비활성화도 Master 만.
- 화면 쪽 같은 규칙: `frontend/src/lib/roles.js`(`ROLE_LABELS`·`ROLE_HELP`·`assignableRoles`·`canWriteRole`…). 서버가 최종 판단.

## 2. 자료 공개 범위

- `entries.access` = `public`(기본, 기존 자료 전부) | `private`. `entries.private_min_role` = `viewer_all`(기본) | `admin`.
- `entry_grants`(entry_id, employee_id, granted_by, granted_at, unique(entry_id, employee_id)) — 비공개 열람 허락.
- **열람 가능** = 관리자 이상 항상 / public 은 활성 사용자 누구나 / private 은
  - 올린 사람(member 이상), 또는
  - 등급 ≥ `private_min_role`(viewer_all 은 `viewer_all` 최소 등급만), 또는
  - 열람 허락 보유(member 이상).
  - **guest 는 공개 자료만** — 자기가 올린 자료·받은 허락도 guest 로 내려가면 효력이 없다(행은 남고, 다시 올라가면 되살아난다).
- 공개 범위 변경·허락 주기/회수 = 올린 사람(member 이상) 또는 관리자 이상. 허락 대상은 활성 member 이상(guest 는 422 `grant_guest_not_allowed`).
  감사: `ENTRY_ACCESS`(before/after = {access, private_min_role}), `ENTRY_GRANT`, `ENTRY_REVOKE`, 사용자 `USER_ROLE`·`MASTER_TRANSFER`.
- **수정 권한(확정 자료)**: 올린 사람(member 이상) 또는 관리자 이상(`access.can_edit_entry`). ⚠ 예전(설계 §8)에는 확정 자료를
  로그인한 누구나 고치고 휴지통으로 보낼 수 있었다 — 13 에서 요청 표('자기 자료 수정', '관리자: 모든 자료 수정·휴지통')대로 좁혔다.
  휴지통 보내기·복원·파일 추가·공개 범위도 같은 규칙. 초안(정리 대기)은 예전 규칙(올린 사람·관리자) 그대로 + guest 403.

## 3. 숨김(404·목록 제외)을 적용한 경로 — 전수

목록·건수는 모두 `visible_entries_filter(user)` 를 **SQL 조건**으로 끼워 거른다(파이썬 후처리로 쪽 건수가 틀어지지 않게).
한 건 조회는 `ensure_visible`/`file_visible` 로 404(`entry_not_found`·`file_not_found` — 없는 번호와 같은 응답).

| 영역 | 경로 | 적용 |
|---|---|---|
| 검색 | `GET /api/search` | 낱말 적중(번호·호선·제목·태그·해석 종류·속성 값·설명·파일 이름·본문)과 검색어 없는 목록의 SQL `live` 조건에 포함 → 목록·`total`·facet 건수·묶어 보기 group 건수·'더 보기'·결과 요약 띠(insight)·정렬·파일 보기 모두 보이는 것만. 4자리 호선 제안 `known` 도 보이는 자료 기준(`hull_known`) |
| 분류 둘러보기 | `GET /api/search/browse` | 속성별 값·건수·`total` |
| 즐겨찾기 | `GET /api/favorites`, 검색 `fav=1`, `PUT/DELETE /api/favorites/{id}` | 목록·건수에서 빠지고, 넣기/빼기는 404 |
| 호선 | `GET /api/hulls`(목록 건수), `GET /api/hulls/{no}`(통계·타임라인·분포·참여자·초안 수) | 볼 수 있는 자료가 없고 선종·메모도 없는 호선은 404(호선 행은 확정 때 저절로 생기므로) |
| Entry | `GET /api/entries/{id}`, `/history`, `PATCH`, `/confirm`, `/split`, `/merge`(양쪽), `DELETE`, `/restore`, `/access`, `/grants` | `routers/entries._entry(db, id, user)` 한 곳에서 404 |
| Entry 안의 참조 | `entry_to_dict(viewer=…)` | 바이트 동일 파일의 소속(`duplicate_of_entry` → None), 같은 BDF·같은 형상(`same_model.py _visible()` — 목록과 `*_total` 모두), 합치기 제안(`suggested_entry`/`suggested_entry_id`)·`merge_into` |
| 이력 | `GET /api/entries/{id}/history` | Entry 를 볼 수 있어야 하고, 열람 허락 기록은 공개 범위를 바꿀 수 있는 사람에게만 |
| 휴지통 | `GET /api/trash` | 목록에서 빠짐. 복원 단추는 `can_restore` |
| 파일 | `GET /api/files/{id}`, `/link`, `/content`(토큰 주인이 **지금도** 볼 수 있어야 함), `/text`, `/sheet`, `/model`, `/model.lbm`, `/thumb.png` | `routers/files._file(db, id, user)` 한 곳에서 404 |
| 해석 검증 | `GET/POST /api/files/{id}/solve-check`, `/solve-check.f06` | 404, POST 는 guest 403 |
| 파일 옮기기 | `POST /api/files/{id}/move` | 404 |
| 비교 | `POST /api/me/compares`(숨은 파일은 없는 것과 같아 `too_few_models`), `GET /api/me/compares` | 숨은 파일 id 를 응답에서 빼고, 남은 모델이 2개 미만이면 그 기록을 목록에서 뺀다. **행은 고치지 않는다**(다시 볼 수 있게 되면 돌아온다). `dropped` 는 영구 삭제 수만(숨은 수는 알리지 않음). `/compare` 화면은 위 파일 API 를 쓰므로 함께 막힌다 |
| 정리 대기 | `GET /api/batches`, `GET /api/batches/{key}` | 볼 수 없는 초안은 빠지고, 남의 배치인데 보이는 초안이 없으면 배치째 빠짐(단건은 404). 초안의 `merge_into_id` 를 볼 수 없는 Entry 로 지정하면 422 `merge_target_not_found`, 확정 때 대상이 숨으면 409 `target_not_confirmed` |
| 파일 추가 | `POST /api/uploads`(target_entry_id) | 볼 수 없으면 422 `target_not_confirmed`, 남의 자료면 403 |
| 어휘·태그 건수 | `GET /api/tags`(자유 태그 건수, 볼 수 없는 자료에만 쓰인 자유 태그는 이름도 숨김), `GET /api/vocab`(용어 건수) | |
| 자동완성 | `GET /api/suggest` — hull(볼 수 없는 자료에만 있는 호선 번호 제외), tag(위와 같음), analysis_type(보이는 자료의 값만) | |
| 활동 로그 | `GET /api/audit` | 볼 수 없는 Entry(번호)·그 파일(id)을 대상으로 한 기록을 SQL 로 뺀다 |
| 대시보드·통계 | (따로 없음) | 관리자 운영 화면(`/api/admin/ops/*`)·목록 밖 값(`/api/vocab/unlisted`)은 관리자 전용이라 전체 기준 |

내부 호출(entry.json 쓰기·감사 스냅숏·워커)은 `viewer=None`/`access.SYSTEM` 으로 거르지 않는다. `SearchQuery.user` 가 None 이면
**아무것도 보이지 않는다**(안전한 기본값) — 직접 검색하는 테스트는 `access.SYSTEM` 을 넘긴다.

## 4. 데이터 이전(기존 DB)

- `users.role VARCHAR(12) NOT NULL DEFAULT 'member'`, `entries.access VARCHAR(10) NOT NULL DEFAULT 'public'`,
  `entries.private_min_role VARCHAR(12) NOT NULL DEFAULT 'viewer_all'` — `database.ADDED_COLUMNS`(ensure_columns 패턴). `entry_grants` 는 create_all.
- `database.migrate_roles()` — 시작 때(`init_schema`) 매번: `is_admin=1 AND role NOT IN (master,admin)` → `admin`,
  `role IN (master,admin) AND is_admin=0` → `is_admin=1`. 멱등(두 번째부터 0행).
- `is_admin` 은 호환용으로 남기고 role 과 늘 맞춘다: `models._sync_role`(before_insert/update) — role 을 바꾸면 is_admin = role∈{master,admin},
  is_admin 만 바꾸면 role = admin / member. 응답(`user_to_dict`)에 `role` 추가, `is_admin` 은 계속 실린다.
- 가입 승인: `POST /api/admin/users/{id}/approve` 본문 `{role}`(기본 member, 없으면 member). admin 으로 승인은 Master 만.
- 예전 `PUT /api/admin/users/{id}/admin {is_admin}` 은 남겨 두되 role 규칙을 따른다(관리자 지정·해제 → Master 만). 새 `PUT /{id}/role {role}`.
- CLI(`python -m app.cli`):
  - `set-master <사번>` — 활성 사용자만, 기존 Master 는 admin 으로(이양).
  - `set-role <사번> guest|member|viewer_all|admin` — 마지막 Master 를 직접 내리는 것은 여기서도 막는다.
  - `create-admin` — role=admin(이미 Master 면 그대로).

## 5. 재구축 원천

- `registry.json`(90_System): `users[].role` 추가, `entry_access`(비공개 Entry 만: entry_id·access·private_min_role), `grants`
  (entry_id·employee_id·granted_by·granted_at). 공개 범위·허락이 바뀔 때마다 다시 쓴다.
- `entry.json`(Entry 폴더): `access`, 비공개면 `private_min_role` 추가. **열람 허락 명단은 넣지 않는다**(Entry 폴더는 탐색기로 보이는 자리).
  `_INFO.txt` 에 `공개 범위: 공개 | 비공개 · …` 한 줄.
- `ops/rebuild.py`: 사용자 role 복원(13 이전 registry 는 is_admin → admin/member), entry.json 의 access, 그 위에 registry 의
  `entry_access`·`grants` 를 입힌다(`_restore_access`). 결과에 `private_entries`·`grants` 건수. 관리자 목록은 role 기준.

## 6. 화면

- **사용자 관리**: '등급' 열 — 활성 사용자는 바꿀 수 있는 등급만 고르는 select(관리자는 Guest~전체 열람, Master 는 관리자까지),
  바꿀 수 없는 행(나, Master, 관리자가 본 다른 관리자)은 배지. 승인 대기 행은 승인 등급 select(기본 승인 열람) + [승인].
  Master 에게만 [Master 이양](확인 대화상자). 접히는 '등급 안내'(등급마다 한 줄 설명). 활동 로그 라벨 `USER_ROLE`·`MASTER_TRANSFER`·`ENTRY_*`.
- **머리글 계정 메뉴**: 이름·사번·부서 아래 '등급 <배지>'.
- **Entry 상세**: 머리에 비공개 배지(자물쇠 + '비공개 · 전체 열람 이상'). 레일에 '공개 범위' 패널 — 현재 범위와 설명,
  바꿀 수 있는 사람에게만 select + [적용](확인 대화상자 → 즉시 적용, 이력 '공개 범위 변경'), 비공개면 '열람 허락' 목록(이름·등급·'효력 없음'·[회수])과
  사람 찾기(이름·사번 앞부분 → `GET /api/users/lookup`, 활성 member 이상만). **[변경하기] 흐름과 분리한 이유**: 누가 볼 수 있는지가
  바로 바뀌는 보안 동작이라 확인을 따로 받고, 감사도 칸 수정(ENTRY_UPDATE)과 다른 한 줄(ENTRY_ACCESS)로 남기며, 허락 목록은
  칸이 아니라 더하기/빼기 동작이라서다. 고치는 중에는 패널을 잠근다.
  고칠 수 없으면 [변경하기]·[파일 추가]·휴지통 메뉴가 없고 '올린 사람만 수정'(member) / '보기 전용'(guest) 이유가 보인다.
- **정리 대기 DraftCard**: '공개 범위' select(기본 공개, 바로 저장 — 합치기 제안과 같은 방식). 기존 자료에 추가하는 초안은 대상의 범위를 따르므로 숨긴다.
- **검색 결과 행·파일 행·미리보기 머리·호선 타임라인 데이터**: 비공개 배지(볼 수 있는 사람에게만 실린다).
- **Guest**: 상단 [올리기] 없음, 전역 끌어 놓기 올리기는 받지 않고 이유 토스트, 정리 대기 올리기 단추·덮개·[내가 올렸어요] 없음(설명 줄에 이유),
  [해석 검증] 비활성 + 이유(title), 호선 선종·메모 잠김, 태그 동의어 묶기·풀기 없음 + 이유 줄, 휴지통 복원은 `can_restore` 일 때만.

## 7. 테스트

- 백엔드 `tests/test_access_13.py` — 등급 5종 × 자료 5종(공개 / 비공개 viewer_all / 비공개 admin / 비공개 admin + member 허락(guest 허락은 효력 없음) /
  member 자기 자료) 매트릭스: 상세·이력·파일 메타·본문·모델·lbm·썸네일·해석 검증·f06·링크+내려받기·즐겨찾기 넣기(404),
  검색 목록·total·summary·facet(호선·해석 종류)·검색어(제목·본문·속성)·파일 보기·group 건수·정렬, browse, 호선 목록·상세·숨은 호선 404·`known`,
  즐겨찾기 목록, 최근 비교(행은 그대로), 같은 BDF(목록·total), 태그·자동완성(태그·해석 종류·호선), 활동 로그, 휴지통 목록,
  SQL 거르개 = 한 건 판정 일치. 쓰기: guest 403(수정·휴지통·공개 범위·업로드·검증·호선·사용자 찾기·태그 묶기, 개인 기능은 허용),
  확정 자료 수정 = 올린 사람·관리자, 공개 범위 변경 감사·registry, 허락 규칙(guest 거부·허락받은 사람은 못 줌·강등 시 무력화·회수),
  사용자 찾기, entry.json 에 공개 범위만, 초안 공개 범위·합치기 제안 숨김·정리 대기 목록, 등급 규칙(관리자 한계·Master 이양·마지막 Master·자기 자신),
  승인 등급, role↔is_admin 동기화, 이전 멱등, CLI set-master/set-role, 재구축 후 등급·공개 범위·허락 유지.
- 예전 동작이 바뀐 테스트: `test_users_api.test_grant_admin`(관리자 → 403, Master 로 지정), `test_trash_split.test_trash_and_restore_confirmed`(남 → 403, 관리자로).
- 프런트 vitest: `lib/roles.test.js`, `components/access/AccessPanel.test.jsx`, `pages/EntryPage.access.test.jsx`(guest·남의 자료·올린 사람 버튼),
  `pages/admin/UsersPage.test.jsx`(등급 선택지·Master 이양·승인 등급).

## 8. 운영 반영

1. 코드 받고 API·워커 재시작 → 시작 때 열 추가·`migrate_roles`(기존 관리자 → admin). 기존 자료는 모두 공개라 화면은 그대로.
2. `python -m app.cli set-master <사번>` 으로 Master 지정(한 번).
3. **확정 자료 수정이 '올린 사람·관리자'로 좁아진다** — 팀에 알릴 것.
4. 비공개를 실제로 보장하려면 `999_LogBook` 공유 폴더 권한을 서버 서비스 계정 위주로 좁힌다(위 경고, IT 확인).

## 9. 남은 한계

- 공유 폴더 직접 접근(위 경고). `_INFO.txt`·`entry.json` 에 제목·파일 목록이 있어 폴더를 열 수 있으면 비공개 자료도 보인다.
- `registry.json` 에는 열람 허락 명단이 있다(재구축에 필요) — 90_System 폴더도 같은 권한 정리가 필요하다.
- 태그·해석 종류 **이름**: 볼 수 없는 자료에만 쓰인 자유 태그는 숨기지만, 통제 어휘(구역·해석 종류 목록 용어)는 공용 목록이라 이름이 보인다(건수는 숨김).
- 감사 로그의 사용자 관련 기록(가입·등급 변경)은 지금처럼 모두에게 보인다.

## 10. 검증 결과 (2026-10-08)

- 백엔드 전체 pytest **775 passed**(건너뜀 0, 16분 48초). 프런트 vitest **70 파일 · 474 테스트 통과**. `npm run build` 통과(dist 갱신).
- 실화면(시험 스택 9096 · `logbook_test` · 합성 자료 가상 호선 9999/9001/9002, Playwright 91 확인 0 실패, 1366·1920 폭):
  등급 5종 × 공개 / 비공개(전체 열람 이상) / 비공개(관리자 이상 + 승인 열람 1명 허락) / 비공개(관리자 이상) 로
  검색 목록·total·검색어, 상세(API·주소 직접 접근 '자료를 찾을 수 없습니다'), 즐겨찾기, 최근 비교, 같은 BDF 목록이 기대대로 보이거나 숨는다.
  공개 범위 바꾸기(확인 대화상자)·열람 허락 추가/회수(허락받은 사람 200 → 회수 뒤 404)·이력, 사용자 관리 등급 선택지(관리자 한계·Master 는 관리자까지)·
  Master 이양(확인 → 이전 Master 는 관리자), Guest 쓰기 버튼 숨김을 확인했다.
- 12 같은 BDF: 같은 내용·다른 이름 BDF → 정리 대기 카드 '동일 BDF 있음' 칩과 상세 '동일 BDF 가 이미 있습니다', 두께(PSHELL t)만 바꾼 BDF → '같은 형상(속성 다름)' 정보 칩.
  관리자 이상만 볼 수 있는 비공개 사본은 볼 수 없는 사용자에게 목록·건수(`외 N`) 모두에서 빠진다.

검증 중 고친 것:
1. **SQL 3값 논리 누락** — `visible_entries_filter` 의 `uploaded_by == 나` 가 `uploaded_by` NULL(주인 없는 배치의 초안)에서 NULL 이 되어
   `~visible_entries_filter()` 를 쓰는 곳(활동 로그의 숨은 Entry 목록)이 그 비공개 초안을 놓쳤다 → `uploaded_by IS NOT NULL AND …` 로.
2. **배치 가져가기 권한 상승** — `POST /api/batches/{key}/claim` 이 볼 수 없는 비공개 초안이 든 주인 없는 배치를 가져가게 해, 가져간 사람이
   '올린 사람'이 되어 그 초안을 볼 수 있었다 → 볼 수 없는 초안이 하나라도 있으면 404 `batch_not_found`(목록·단건과 같은 응답). 관리자는 그대로.
   테스트 `test_unowned_private_draft_hidden_and_not_claimable`(수정 전 실패 확인).
3. **호선 자동완성** — 13 에서 '볼 수 있는 자료에 쓰인 호선'만 내게 바뀌며 어떤 자료에도 안 쓰인 호선 행(숨길 것이 없음)까지 빠졌다
   (`test_suggest_api` 실패) → 태그 제안과 같은 규칙(안 쓰인 값은 그대로 제안). `test_access_13` 에 같은 규칙 추가.
4. **상세 변경 이력이 허락 뒤 갱신되지 않음** — 열람 허락·회수는 version 을 올리지 않아 이력을 다시 읽지 않았다 → 이력 다시 읽기 기준에 허락 명단 포함.
   이력의 허락 줄은 사번만 보였다 → history 응답에 `subject_name`(대상 이름), 화면은 '박승인 (M900002)'.
5. **Guest 정리 대기 화면** — 공유 폴더가 연결돼 있는데도 '공유 폴더에 연결되면 올릴 수 있습니다'(빨간 글씨)와 '끌어 놓거나 단추로 고르세요'가 보였다
   → Guest 에게는 올리기 안내를 감추고 빈 화면은 'Guest 등급은 자료를 올릴 수 없습니다'.

숨김 누락 전수 점검: `backend/app/routers/*.py` 의 Entry·파일 id 를 받는 경로(entries·files·solve·favorites·compares·batches·uploads·hulls·admin_ops)와
`models.Entry`/`models.File` 목록 질의(search·hull_info·tags·vocab·suggest·system·compares·favorites)를 모두 보았다. 위 2번 외 누락 없음.
관리자 전용(`/api/admin/*`, 휴지통 영구 삭제)과 내부 처리(vocab 이름 바꾸기 반영, 워커, CLI)는 거르지 않는 것이 맞다.

남은 것(이번에 고치지 않음):
- 관리자가 남의 **초안** 상세를 보면 '올린 사람'이 이름 대신 사번으로 보인다(이름을 변경 이력·로그인 사용자에서만 찾는 기존 방식 — 13 이전부터).
- `logbook_test` 에 시험 스택(`init_schema`)이나 중단된 pytest 가 남긴 표가 있으면 pytest 의 `drop_all` 이 FK(`fk_batches_target_entry`) 삭제에서 실패해
  전부 설정 오류(이번 첫 실행 774 errors)가 난다. 스택을 쓴 뒤·pytest 를 끊은 뒤에는 표를 비우고 돌릴 것(이번에는 스크래치 `wipe_testdb.py` 로 비웠다).
