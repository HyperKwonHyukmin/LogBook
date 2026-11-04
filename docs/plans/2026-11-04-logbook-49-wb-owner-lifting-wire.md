# 49 — WB 실행자 표시 · Module Unit 권상 Wire 모델 함께 올리기

2026-11-04. 상태: 구현·배포 끝(LogBook 8f746a3·206a2f7·cfd9d9e·6734875·f73c3b6, WorkBench aaf9a4e·c08fd10), 145 확인은 아래 목록으로.

## 왜
- WorkBench 에서 보낸 자료는 작성자(`uploaded_by`)가 **보낸 관리자**라, 46 의 담당자가 비어 있다. 실제 해석자 사번은
  출처 `origin.owner` 에 이미 실려 온다(WorkBench `routers/admin_projects.py` — 해석 레코드의 사번, 보낸 관리자와 다르다).
- Module Unit(MU) 권상 자료는 모델만 있으면 나중에 **권상 위치**(lug·wire·apex)를 찾을 수 없다. Wire 를 설치한 모델
  (`<stem>_lifting.bdf`)이 함께 있어야 Module Unit Studio 같은 곳에서 이전 실적의 권상 위치를 찾는다.

## 정한 것(사용자 확인 2026-11-04)
1. ~~담당자: WB 보내기 때 `origin.owner` 를 담당자로 자동 입력~~ → **바꿈(같은 날, 사용자)**: WorkBench 에서 실행한 사람은
   담당자(Module Unit 권상을 맡은 연구원)가 아니라 **실행자**다. 실행자는 자료 화면·정리 대기 카드에 '실행자'로 따로 보이고 담당자는
   사람이 고른다. 한때 담당자로 넣은 것은 `clear-wb-runners` 로 뺀다. 검색 필터 '담당자 없음'은 그대로. **'보완 필요'(needs_fix)에는 넣지 않는다** — 46 이전 자료가 모두 비어 있어 손볼 목록이 넘친다.
2. WB → LogBook 보내기에서 MU(`GroupModuleUnit`·`SidePassage`)는 **Wire 파일을 자동으로 묶어 한 항목에** 넣는다.
3. 사람이 직접 올린 MU 자료는 **권상(Wire) 모델도 올려 달라고 요청**한다(정리 대기 카드 안내 + 확정 때 한 번 묻기). 확정은 막지 않는다(43 원칙).

## WorkBench 쪽(WorkBench 저장소)
- `POST /api/admin/projects/{id}/logbook`: 프로그램이 `GroupModuleUnit`·`SidePassage` 면 작업 폴더(부모 + Unit 구조 해석 자식)에서
  `*_lifting.bdf`·`*_lifting_meta.json`·`*_posture.json` 을 고른 파일에 자동으로 더한다(이미 골랐으면 그대로). 응답 `auto_added`(더한 파일 이름).
  **작업 폴더 바로 아래 최종본만** — `lifting_reviews/<해시>/03_…` 같은 Studio 검토 중간본은 자동으로 넣지 않는다
  (처음엔 하위 폴더까지 넣어 같은 Wire 모델이 여러 벌 들어갔다, WorkBench c08fd10).
- 이유: 여권(passport)은 부모 레코드만 봐서 `_lifting.bdf` 가 role 로 오지 않는다 — LogBook 이 여권으로 판별하면 안 된다.
- Module Unit Studio 는 BDF 가 아니라 JSON 을 읽는다 — 권상 위치는 `_posture.json`(`hoisting.groups[].nodes[]`),
  Wire 연결은 `_lifting_meta.json`(`lifting.wires[]`). 그래서 BDF 와 함께 두 JSON 도 보낸다.

## LogBook 쪽
- **한 항목으로**: WB 출처가 있는 묶음(`batches.wb_analysis_id`)은 폴더가 여러 개여도(부모·자식 작업 폴더) 초안 하나로 묶는다
  (`ingest.proposal.propose(single=True)`). WB 해석 1건 = 자료 1건.
- **호선·제목(후속, 사용자 요청)**: WB 묶음은 관리자가 적은 **메모·묶음 이름**에서 호선을 먼저 찾고(파일 이름보다 우선, 근거
  'WorkBench 묶음 이름·메모'), 없으면 파일 이름에서 찾는다. 기본 묶음 이름의 `WB #7740` 은 해석 번호라 뺀다. WB 프로젝트 이름은
  쓰지 않는다('2026 FSRU' 같은 연도가 호선으로 뽑힐 수 있다). 제목 원천은 작업 폴더 이름(`20261104_111146_A418404_GroupModuleUnit`)이
  아니라 대표 BDF 이름(`_lifting`·`_validation`·`_edited` 가 아닌 첫 BDF). WorkBench 화면은 바꾸지 않는다(메모·이름을 이미 보낸다).
- **기존 모델과 견주기(후속, 사용자 요청)**: 정리 대기 카드(`DraftSimilar.jsx`)가 확정 전에 두 가지를 보인다.
  ① 이 묶음에서 **똑같은 BDF 가 이미 있어**(17) 받지 않은 BDF 와 그 자료(초안 응답 `blocked_models` — 묶음 `excluded` 의
  duplicate_model 기록 + 보는 사람 권한의 대상, 묶음의 초안이 여럿이면 최상위 폴더가 같은 것만) → [그 자료에 추가](합치기 제안).
  ② 완전히 같지 않아도 **비슷한 후보**: 선례 찾기(27) `GET /api/similar?file_id=&tol=true` — **허용 범위**(크기 L·W·H 각 ±15%,
  요소 수 ±30%, `similar.TOL_DIM`·`TOL_ELEMS`, 형상 서명이 같으면 늘) 안이고 '많이 비슷'(0.7) 이상인 것 3건, 점수·말과
  기준 대비 차이('크기 +9% · +5% · −7% · 요소 +11%', 응답 `diff`), [새 판이면 이 자료에 추가]. 선례 찾기 화면은 범위를 걸지 않는다.
  (처음엔 0.5 이상이었는데 145 에서 전혀 다른 권상 모델 셋이 모두 53% 로 떠서 사용자 지적으로 바꿨다 — 같은 도구가 만든 모델이라
  구성·단면 점수가 높고 크기가 달라도 이 값에 모인 것으로 추정, 145 데이터로는 확인 안 함.) 기준 BDF 는 초안의 대표 BDF(변환 끝, `_lifting`·`_validation`·`_edited` 가 아닌 첫 BDF),
  BDF 가 모두 막혀 없으면 이미 있는 그 똑같은 BDF(2026-11-04 E000071 — WB 를 다시 보내 BDF 3개가 모두 막히고 JSON 만 남은 카드).
  보인 것이 있으면 확정 때 한 번 묻는다. 없으면 '비슷한 기존 모델이 없습니다' 한 줄. 모든 초안에 보인다(손으로 올린 모델도 같은 확인이 필요하다).
  막힌 BDF 에 `_lifting` 이 있으면 Wire 요청을 띄우지 않는다(이미 LogBook 에 있다).
- **호선 후보 잡음**: 양쪽이 영문자인 4자리(해시 `d9d4452cc` 의 4452)는 호선 후보에서 뺀다(`ingest/hulls.py`). 'H3496' 처럼 한쪽만 붙은 표기는 그대로.
- **실행자**: 자료 응답 `runners`(`wb_origin.runners` — 묶음 출처 `origin.owner`, 이름은 WorkBench 사용자 표 → LogBook 사용자 표 → 사번).
  출처 스위치(`LOGBOOK_WB_ORIGIN_SHOW`)와 상관없이 보인다(해석 번호·여권은 싣지 않는다). 화면 '실행자'(`RunnerList`). 명부(people)에 넣지 않는다.
- **담당자에서 빼기 CLI**: `python -m app.cli clear-wb-runners [--apply]` — 처음 배포(8f746a3)가 실행자를 담당자로 넣었다
  (ingest 자동 + `assign-wb-owners`, 145 에서 E000054·65·66 에 적용). 담당자가 **그 실행자 한 사람뿐**인 WB 자료만 뺀다
  (사람이 더 고른 자료는 그대로). 확정 자료는 감사 ENTRY_UPDATE·entry.json.
- **검색 '담당자 없음'**: 담당자 필터 값 `__none__`.
- **Wire 모델 판별**: 파일 이름이 `_lifting.bdf` 로 끝나거나, 변환 때 case control `TITLE` 에 `HiTessWorkBench Lifting Analysis` 가 있으면
  (`model_summaries.lifting`). 이름은 사람이 바꿀 수 있어 본문이 더 확실하다. 자료 상세·카드의 파일 칩 'Wire 포함'.
- **MU 자료 판별**: 대상이 'Unit' 또는 'Module Unit'(동의어 포함) 이거나 WB 출처 프로그램이 `GroupModuleUnit`·`SidePassage`.
  145 는 40 에서 구역에서 옮겨 온 **대상 'Unit'(동의어 GMU)**이 이미 Module Unit 을 뜻한다 — 새 용어를 만들지 않는다.
  처음엔 기본 목록에 'Module Unit'(동의어 GMU)을 더했는데 40 의 'Unit' 과 GMU 가 겹쳐 같은 개념이 둘로 갈라져서 되돌렸다
  (`vocab.DEFAULTS` 는 40 과 같이 바꾸지 않는다).
- **요청**: MU 자료인데 Wire 모델이 없으면 정리 대기 카드에 안내('권상 Wire 모델도 함께 올려 주세요' + 파일 추가), 확정 때 한 번 더 묻는다.
  자료 응답 `lifting: {needed, has_wire}`.

## 145 확인
- Update 뒤 관리 › 분류 목록 › 대상에 'Unit'(동의어 GMU)이 있는지 확인. 없으면 'Unit' 을 더한다.
- `python -m app.cli clear-wb-runners` 로 목록 확인 → `--apply`(실행자를 담당자에서 뺀다).
- WorkBench 를 배포한 뒤 MU 해석 하나를 보내 정리 대기에 **한 장**으로, '실행자'에 실행한 사람(담당자는 빈 칸), 'Wire 포함' 파일이 보이는지.
  (2026-11-04 확인됨: 한 장·실행자·호선 자동·Wire 포함 칩. 남은 확인 ↓)
- WorkBench 서버 `git pull + 재시작`(c08fd10) 뒤 보내면 `lifting_reviews/` 중간본이 들어오지 않는지(그 전엔 들어와 '이번 업로드 안의 …와 같아 하나만' 문구가 뜬다).
- E000072 카드: 허용 범위(f73c3b6) 뒤 53% 후보 셋이 사라지는지. 남으면 줄 끝 차이(크기·요소)를 보고 TOL 을 다시 맞춘다.
- `clear-wb-runners --apply` 를 했는지(E000054·65·66 은 한때 실행자가 담당자로 들어갔다).
- 이미 받은 자료의 `lifting_reviews` 중간본은 자료 상세 [변경하기]에서 [삭제]로 뺀다(사용자 손).
- 정해 둔 것: `_lifting_meta.json`·`_posture.json` 은 계속 함께 보낸다(Module Unit Studio 가 JSON 만 읽고, 그룹 정보는 BDF 에 없다 — 2026-11-04 사용자 확인).
