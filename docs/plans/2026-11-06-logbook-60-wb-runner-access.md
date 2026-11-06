# 60 — WorkBench 해석 실행자는 자기 자료를 등급과 무관하게 본다

2026-11-06 사용자 요청: "WorkBench 사용자가 LogBook 으로 Model Builder 또는 Module Unit 권상 모델을 보냈을 때, 본인이 보낸 건
LV 에 관계없이 LogBook 에서 확인 가능해야 하고, WorkBench 에서 가져올 때도 본인 것은 가져올 수 있어야 한다."

## 왜 못 봤나
- WorkBench → LogBook 보내기는 **WB 관리자만**(All Projects, WorkBench `admin_projects.py` `require_admin`) 한다.
  `as` = 보낸 관리자라 LogBook 자료의 올린 사람(`uploaded_by`)은 관리자다. 해석을 실행한 사람은 묶음 출처
  `batches.origin.owner`(39)에만 남는다.
- 열람 규칙(`access.py`)은 공유 · 올린 사람 · 열람 허락 · LV2 이상(일반) 뿐이라, LV1 실행자는 자기 해석 자료를
  LogBook 화면에서도, WorkBench 가져오기(`GET /api/integration/files/{id}/content`, GMU·Truss 의 LogBook 창)에서도 못 봤다.
- 권상 참조(`lifting-refs`, 50·59)는 이미 레벨과 무관(9d5a669)이라 이번 변경과 상관없다.

## 규칙(구현)
- **확정 자료이고, 그 자료의 파일(휴지통 아님) 중 하나가 WB 묶음(`wb_analysis_id` 있음)에서 왔고 그 `origin.owner` 가
  나이면 본다** — 등급·공개 단계(블록 포함) 무관. 올린 사람이 블록돼도 자기 자료를 보는 것과 같은 결.
- 초안(관리자가 정리 중)과 휴지통 자료는 넣지 않는다. 자료에서 뺀 파일(휴지통)의 출처로는 열리지 않는다.
- 보기만 넓힌다. 고치기·공개 범위 바꾸기는 그대로 올린 사람·LV3.
- SQL(`visible_entries_filter`)과 파이썬(`can_view_entry` → `is_wb_runner`) 두 곳이 같은 조건(`_wb_runner_entry_ids`,
  `JSON_EXTRACT(batches.origin, '$.owner')`). 목록·검색·관계 지도·WB 가져오기가 모두 이 두 함수를 거친다.
- 열람 허락(grant)을 자동으로 넣는 방식은 쓰지 않았다 — 옛 자료 되채우기가 필요하고, 올린 사람이 회수하면 다시 막힌다.

## 시험
`tests/test_wb_runner_access_60.py` — LV1 실행자: 자기 확정 자료(일반·블록) 상세·검색·WB 가져오기 됨, 남의 WB 자료·자기 초안·
뺀 파일 출처는 안 됨, SQL 과 파이썬 판정이 같음. 수정 전 코드에서 3건 실패 확인.

## 배포
145 Update(git pull + 재시작)만. 스키마·`.env` 변화 없음, WorkBench 쪽 변경 없음.
