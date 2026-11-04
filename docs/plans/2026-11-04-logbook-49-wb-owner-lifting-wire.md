# 49 — WB 해석자를 담당자로 · Module Unit 권상 Wire 모델 함께 올리기

2026-11-04. 상태: 구현·테스트 끝(LogBook + WorkBench), 145 확인은 아래 목록으로.

## 왜
- WorkBench 에서 보낸 자료는 작성자(`uploaded_by`)가 **보낸 관리자**라, 46 의 담당자가 비어 있다. 실제 해석자 사번은
  출처 `origin.owner` 에 이미 실려 온다(WorkBench `routers/admin_projects.py` — 해석 레코드의 사번, 보낸 관리자와 다르다).
- Module Unit(MU) 권상 자료는 모델만 있으면 나중에 **권상 위치**(lug·wire·apex)를 찾을 수 없다. Wire 를 설치한 모델
  (`<stem>_lifting.bdf`)이 함께 있어야 Module Unit Studio 같은 곳에서 이전 실적의 권상 위치를 찾는다.

## 정한 것(사용자 확인 2026-11-04)
1. 담당자: WB 보내기 때 `origin.owner` 를 담당자로 자동 입력, 이미 들어온 WB 자료는 CLI 로 되채움(미리보기 → `--apply`),
   검색 필터 '담당자 없음'. **'보완 필요'(needs_fix)에는 넣지 않는다** — 46 이전 자료가 모두 비어 있어 손볼 목록이 넘친다.
2. WB → LogBook 보내기에서 MU(`GroupModuleUnit`·`SidePassage`)는 **Wire 파일을 자동으로 묶어 한 항목에** 넣는다.
3. 사람이 직접 올린 MU 자료는 **권상(Wire) 모델도 올려 달라고 요청**한다(정리 대기 카드 안내 + 확정 때 한 번 묻기). 확정은 막지 않는다(43 원칙).

## WorkBench 쪽(WorkBench 저장소)
- `POST /api/admin/projects/{id}/logbook`: 프로그램이 `GroupModuleUnit`·`SidePassage` 면 작업 폴더(부모 + Unit 구조 해석 자식)에서
  `*_lifting.bdf`·`*_lifting_meta.json`·`*_posture.json` 을 고른 파일에 자동으로 더한다(이미 골랐으면 그대로). 응답 `auto_added`(더한 파일 이름).
- 이유: 여권(passport)은 부모 레코드만 봐서 `_lifting.bdf` 가 role 로 오지 않는다 — LogBook 이 여권으로 판별하면 안 된다.
- Module Unit Studio 는 BDF 가 아니라 JSON 을 읽는다 — 권상 위치는 `_posture.json`(`hoisting.groups[].nodes[]`),
  Wire 연결은 `_lifting_meta.json`(`lifting.wires[]`). 그래서 BDF 와 함께 두 JSON 도 보낸다.

## LogBook 쪽
- **한 항목으로**: WB 출처가 있는 묶음(`batches.wb_analysis_id`)은 폴더가 여러 개여도(부모·자식 작업 폴더) 초안 하나로 묶는다
  (`ingest.proposal.propose(single=True)`). WB 해석 1건 = 자료 1건.
- **담당자 자동**: `process_batch` 가 초안을 만들 때 `origin.owner` → 명부 행(`people.from_owner`, 없으면 WorkBench 에서 만든다).
  WorkBench 를 못 읽거나 없는 사번이면 비워 둔다(CLI 가 나중에 채운다).
- **되채우기 CLI**: `python -m app.cli assign-wb-owners [--apply]` — 담당자가 빈 자료(정리 대기·확정) 중 파일의 묶음에 `origin.owner` 가
  있는 것. 확정 자료는 `write_meta` 로 entry.json 도 다시 쓴다. 감사 `ASSIGNEE_FILL`.
- **검색 '담당자 없음'**: 담당자 필터 값 `none`.
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
- `python -m app.cli assign-wb-owners` 로 목록 확인 → `--apply`.
- WorkBench 를 배포한 뒤 MU 해석 하나를 보내 정리 대기에 **한 장**으로, 담당자 = 해석자, 'Wire 포함' 파일이 보이는지.
