# 61 — Abaqus .inp 3D 뷰어

2026-11-09 사용자 요청: "LogBook 에 아바쿠스 inp 는 뷰어 기능이 안 돼. Nastran BDF 는 되는데, inp 도 뷰어 기능을 추가하고 싶어."

## 왜 안 됐나
- 뷰어는 BDF 를 직접 읽지 않고 백엔드가 만든 `model.lbm`(절점·보·쉘·강체·질량·구속)만 그린다.
- 변환 작업(`convert/job.py enqueue_convert`)은 `kind == "model"` 만 받는데, `.inp` 는 확장자 표(`ingest/rules.py KIND_BY_EXT`)에
  없어 `other` 였다 → 변환도, 뷰어도 없었다.

## 방법
inp 를 읽어 **BDF 와 같은 `Model`** 을 만든다(`backend/app/abaqus/inp.py`). 그 뒤 lbm·썸네일·지문·뷰어는 그대로 쓴다.

| Abaqus | Model / 뷰어 |
|---|---|
| `*NODE` | 절점(2D 는 z = 0) |
| `*ELEMENT` S3·CPS3·CPE3·CAX3·M3D3…(2차 포함) | 삼각형(모서리 절점) |
| `*ELEMENT` S4·S4R·S8R·CPS4R·CPE4·CAX4·M3D4… | 사각형(모서리 절점) |
| `*ELEMENT` B31·B32·PIPE·ELBOW·T3D·CONN·SPRINGA… | 선(양 끝. B32 등 3절점은 1·3번째, B31 의 3번째 방향 절점은 버림) |
| `*ELEMENT, TYPE=MASS` + `*MASS` | 질량 |
| `*…SECTION, ELSET=` | 단면 하나 = PID 하나(나온 순서). 단면 없는 요소는 `*ELEMENT` 의 ELSET 마다 PID(HyperMesh 컴포넌트) |
| `*BEAM SECTION` PIPE·CIRC·RECT·BOX·I·L | 뷰어 단면(PIPE r,t → TUBE). 둘째 줄 n1 → 보 방향 벡터. PIPE·CIRC 외는 축이 달라 approx |
| `*MATERIAL` + `*ELASTIC`·`*DENSITY` | 재료(E·ν·ρ) |
| `*BOUNDARY` (번호 범위·ENCASTRE·PINNED·XSYMM 등) | 구속 표시 |
| `*MPC` TIE·BEAM·LINK·PIN, `*KINEMATIC COUPLING`, `*COUPLING`+`*KINEMATIC`, `*RIGID BODY` | 강체(뷰어의 RBE2 표시) |
| `*COUPLING`+`*DISTRIBUTING` | 뷰어의 RBE3 표시 |
| `*NSET`·`*ELSET`(GENERATE·묶음 안 묶음) · `*INCLUDE` · 끝 쉼표 이어짐 줄 | 지원 |

- lbm 요소 이름표(`header.cards`)는 Nastran 순서를 그대로 두고 처음 보는 이름(S4R·B32…)을 뒤에 붙인다(`bdf/lbm.card_lists`).
  BDF 의 lbm 은 바이트까지 같아 형식 버전을 올리지 않았다.
- 단면·재료 라벨: `LINE1 PIPE 36.5,14`(묶음 이름·형상·첫 줄 원값), 재료 `A312_TP316L_I E193290 ν0.292`.
- 첫 `*STEP` 의 절차(STATIC 등)가 SOL 칸에 들어간다.

## kind 는 other 그대로 (결정)
`kind == "model"` 은 Nastran 실행 검증·WorkBench 보내기/가져오기·내용 서명(같은 모델·판 비교·선례 찾기)·권상 Wire 판정·중복 차단이
BDF 로 읽는 22곳이 본다. inp 를 model 로 바꾸면 그 길을 하나씩 막아야 해서, **변환·뷰어만** 확장자로 연다.
- 백엔드 `ingest.rules.has_model_view` / `convert.job.model_file_filter` — 변환 대기열·재변환(`cli convert`)·복원·INCLUDE 형제·파일 메타.
- 프런트 `lib/files.hasModelView` — 파일 미리보기·전체 화면 뷰어(`/v/{id}`). inp 미리보기에서는 해석 검증·선례 찾기·비교 담기를 숨긴다.
- 그래서 검색의 '모델' 수·필터에는 inp 가 들지 않는다(필요하면 따로 정한다).

## 아직 안 하는 것
- **솔리드(C3D·SC)**: lbm 에 칸이 없어 그리지 않고 경고 `solid_elements: N`. 솔리드만 있으면 '요소 없음'으로 건너뛴다.
  필요하면 바깥면만 뽑아 쉘처럼 그린다.
- **`*PART`/`*INSTANCE`(Abaqus/CAE 형식)**: 인스턴스 이동·회전을 풀지 않고 평면으로 읽는다(경고 `parts_flat`). 견본 2개는
  HyperMesh 평면 형식이라 해당 없음. 파트마다 번호가 겹치는 CAE 파일이 들어오면 그때 한다.
- 2D 모델 썸네일도 3D 와 같은 등각 방향에서 그린다(뷰어에서는 돌려 본다).
- 판 비교(diff)·같은 모델 찾기·비교 화면 — BDF 카드 기준이라 inp 는 대상 아님.

## 시험
`tests/test_abaqus_inp_61.py`(2D 평면·단면·재료·구속, 보 끝 절점·PIPE·방향, 묶음·INCLUDE·이어짐 줄·강체·질량·솔리드 경고,
lbm 이름표가 BDF 와 같음, kind other, 변환 작업·`cli convert` 연결). 프런트 `files.test.js`·`elementInfo.test.js`·
`ModelPreview.test.jsx`(inp 는 검증·선례 찾기 숨김).
견본: `PSA/FuelLine/L29_EXP_T2+D1-D2_iter02.inp`(B32 234 · ELBOW31B 442 · CONN3D2 78 · SPRINGA 18 · MPC 4, 0.1초),
`8004_3000_PSD_2D.inp`(14 MB, CPS4R 130,660 · CPS3 3,430, 2.4초) — 썸네일 확인.

## 배포
1. 커밋·푸시(프런트 `dist` 포함) → 145 Server Manager ⟳ Update.
2. **이미 올라간 inp 변환**: 관리 › 운영 › [BDF 다시 변환](전체 다시 체크 없이, 또는 `python -m app.cli enqueue-convert`) —
   변환 기록이 없는 inp 만 대기열에 들어가고 이미 변환된 BDF 는 건드리지 않는다. 새로 올리는 inp 는 저절로 변환된다.
스키마·`.env` 변화 없음.
