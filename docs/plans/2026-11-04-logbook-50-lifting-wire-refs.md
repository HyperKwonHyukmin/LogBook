# 50 — 다른 Unit 권상 Wire 배치 찾기 (WorkBench Module Unit Studio 참조)

2026-11-04 · 상태: 구현(`43f0540`), 145 반영·실제 연결 확인 남음 · 원 계획: WorkBench `docs/plans/2026-11-04-mu-studio-logbook-wire-reference.md`

## 목적
Module Unit 권상 Studio(Hoist 탭)가 LogBook 에 확정된 다른 Unit 의 Wire 모델을 찾아, Wire 를 어떻게 걸었는지(훅·lug·길이·슬링각) 평면 그림으로 본다.
49 가 Wire 모델(`_lifting.bdf`)을 쌓기 시작했고, 50 은 그것을 서버 간 API 로 꺼낸다. 보기 전용이다(노드 번호는 모델마다 다르다).

## 구현
- 요약 `app/bdf/wires.py` `wire_summary(model)` — 순수 함수.
  - apex(훅) = 병진 1·2·3 이 모두 구속되고 CROD 에만 쓰이는 노드. wire = 한쪽 끝이 apex 인 CROD, 같은 apex = 한 그룹.
  - 주석 `$ PID=` 는 DeckReader 가 떼어 쓰지 않는다. 강체 운동 막이 `SPC1 12` 노드는 apex 가 아니다.
  - 내용: 그룹별 apex·lug 좌표, Wire 길이, 슬링각(수평면 기준), lug 간격, 구조 bbox(wire·apex 제외), 평면 선분(긴 것 3,000개).
  - 질량은 넣지 않았다(CONM2 단위를 확정할 수 없음).
  - 실측: WorkBench 3496 `_lifting.bdf` → `_lifting_meta.json` wire 4개와 일치, 0.08초, 약 68KB.
- 저장 `model_summaries.wires`(JSON, `ensure_columns`). 변환 때 TITLE 이 권상이면 쓰고(`convert/job.py`),
  없으면(49 이전 변환·이름만 `_lifting`) 처음 요청 때 읽어 채운다(`lifting_refs.ensure_wires`, 한 요청에 5개). apex 가 없으면 `{"none": true, "reason"}`.
  재변환은 요청 때 채운 값을 지우지 않는다(변환이 요약을 만들었을 때만 덮는다).
- API(`routers/integration.py`, 비밀키 + `as` 사번):
  - `GET /api/integration/lifting-refs?as=&q=&hull=&limit=&offset=` — 확정·보관소 Wire 모델, `as` 가 볼 수 있는 것만, 평면 선분 제외.
  - `GET /api/integration/lifting-refs/{file_id}?as=` — 전체 요약. 404 = 없음·권한 밖·확정 전, 415 = Wire 모델이 아니거나 apex 없음.
- ⚠ 목록 정렬은 id·날짜만 고른다(`_candidate_ids`) — JSON·TEXT 를 실은 채 ORDER BY 하면 MySQL 정렬 버퍼 1038(독립 리뷰가 잡음).
- 테스트 `test_lifting_wires_50.py` · `test_lifting_refs_50.py`. 전체 1,267 통과(수정 전), 수정 뒤 관련 66 통과.

## 남은 일
- 145 `git pull` + 재시작(새 칸 자동 추가) 뒤 WorkBench Studio 에서 실제 목록·상세 1회 확인.
- 145 의 Wire 모델 실제 건수 확인 — 적어도 기능은 유지(사용자 결정 2026-11-04: Wire 자료를 앞으로 늘린다).
- 사람이 손으로 만든 권상 BDF(TITLE 없음)는 apex 규칙에 맞지 않으면 목록에서 빠진다 — 실례가 나오면 규칙을 넓힌다.
