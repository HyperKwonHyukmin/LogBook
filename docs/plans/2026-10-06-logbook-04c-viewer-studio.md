# 04c — BDF 뷰어 확장: 3D 단면 · 연결 그룹 · 기본 확인 기능 (Model Builder Studio 벤치마킹)

선행: 04a(변환), 04b(뷰어). 사용자 결정(2026-10-06): 제안 범위 전부, Studio식 전체 구성은 **전체 화면 뷰어(`/v/:id`)만**.
검색·Entry 미리보기 안의 작은 뷰어는 툴바 + 그룹 목록 정도로 간단히 둔다.

참고: Studio = `C:\Coding\WorkBenchSubModule\ModelBuilderStudio\apps\model-studio\src\`
(`three/BeamMesh3D.js` 단면 형상, `data/StageData.js` `_computeGroups`, `data/findEntity.js`·`components/FindBar.jsx`,
`three/NodePoints.js`·`three/screenSpaceMaterial.js` 화면 고정 노드, `components/shell/*`, `three/viewportGeometry.js` 시점).
Studio 는 단면의 축 회전(roll)을 무시한다 — **Logbook 은 방향 벡터를 반영한다**(Studio 보다 정확해야 한다).

## 1. 변환 형식 v2 (백엔드 ↔ 프런트 계약)

`model.lbm` 머리 JSON `version: 2`. v1 의 블록·필드는 모두 그대로 두고 아래를 더한다.

| 블록 | dtype × width | 행 = | 내용 |
|---|---|---|---|
| `beam_orient` | f4 × 3 | `beams` 한 행 | 기본 좌표계 단위 방향 벡터 v(요소 xy 평면을 정하는 벡터). G0 이면 `xyz(G0) − xyz(GA)`, X1–X3 이면 GA 의 변위 좌표계(CD)에서 기본 좌표계로 돌린 값. 없으면(CROD·CONROD·CBUSH 등) `0,0,0`. |
| `beam_offsets` | f4 × 6 | `beams` 한 행 | 기본 좌표계 WA(3)·WB(3), mm(모델 단위). 없으면 0. OFFT 가 GGG(기본)가 아니면 가능한 만큼 변환하고, 못 하면 0 + 경고 `offset_unsupported`. |

속성(`properties`) 보강:
- `PTUBE` → `{card:"PTUBE", type:"TUBE", dims:[R_out, R_in], mid}` (OD·T 에서 계산. T 없으면 R_in=0). PBARL TUBE 와 같은 규약(DIM1 바깥 반지름, DIM2 안 반지름).
- `PROD` → 기존 `A` 에 더해 `type:"ROD", dims:[sqrt(A/π)], approx:true`.
- `PBAR`·`PBEAM`(단면 형상 없음) → 기존 `A` 에 더해 `type:"BAR", dims:[√A, √A], approx:true` (등가 정사각형).
- PBARL/PBEAML 은 그대로(type·dims).

머리 JSON 에 `units` 는 넣지 않는다(모델 단위 그대로, 대부분 mm).

**캐시**: 파생물 경로나 ETag 에 형식 버전을 넣어, 다시 변환한 뒤 브라우저가 v1 캐시를 쓰지 않게 한다.
`ModelSummary` 에 형식 버전을 남겨(없으면 1) API 가 `format_version` 을 돌려주고, CLI `enqueue-convert --outdated` 로
옛 형식 모델만 다시 변환 대기열에 넣는다.

구현 메모(백엔드, 2026-10-06):
- 파생물 경로: v1 = `{key}.lbm`(그대로), v2 = `{key}.v2.lbm`. 재변환이 옛 파일을 덮지 않고, 대기·실패 중에는
  `format_version` 이 가리키는 옛 파일을 계속 준다(옛 파일은 지우지 않는다). 썸네일은 `{key}.png` 그대로.
- ETag: `model.lbm` 은 v1 = `"{key}"`, v2 = `"{key}.v2"`. `thumb.png` 는 `"{key}"` 그대로.
- `format_version` 은 `GET /api/files/{id}`·`/model`·Entry 파일 목록의 `model` 에 실린다(변환 결과 없음 = null, 04c 이전 = 1).
- 열 추가: `model_summaries.format_version INT NULL` — 기동(API·워커·CLI) 때 `database.init_schema()` 가 없는 열만
  `ALTER TABLE` 로 더한다(`ADDED_COLUMNS`).
- 방향 벡터: OFFT 첫 글자 B 면 X1–X3 을 기본 성분 그대로, G 면 GA 의 CD 로 회전(원통·구 CD 는 GA 위치의 국부 기저).
  카드 칸이 비면 BAROR/BEAMOR 기본값. 오프셋 O(오프셋 좌표계 = 요소 좌표계)도 변환한다.
- 경고(개수): `beam_orient_missing`(CBAR·CBEAM 인데 v 를 못 정함 → 0,0,0), `cd_unresolved`(정의 안 된 CD → 기본으로 봄),
  `offset_unsupported`(알 수 없는 OFFT, 또는 O 인데 v 없음 → 0).

## 2. 프런트 뷰어

v1 파일도 계속 열린다(방향 벡터 없음 → 단면 roll 임의 + "다시 변환하면 단면 방향이 정확해집니다" 한 줄).

- **표시 방식**: 선(현재) / 3D 단면. 단면 = L·H(I)·T·BOX·CHAN·TUBE·ROD·BAR(+approx) — 축은 GA→GB, 단면 y·z 축은
  방향 벡터로 정한다(Nastran 규약: 요소 x = GA→GB, v 가 x-y 평면, z = x × v, y = z × x). 오프셋 반영.
  같은 PID 는 InstancedMesh 하나. 쉘은 지금처럼 면 + (선택) 두께 표시는 하지 않는다(범위 밖).
- **그룹**: 부재·쉘·RBE 연결을 union-find 로 묶은 독립 그룹(요소 수 내림차순, 0번 = 주 구조). 색·요소 수·노드 수,
  보이기/숨기기, **이 그룹만 보기**, 그룹으로 이동(카메라 맞춤).
- **색 기준**: PID / 그룹 / 단면 종류 / 요소 종류(CBAR·CBEAM·CROD·쉘…) + 범례(개수, 숨긴 항목 표시).
- **기본 확인**: 시점 평면·정면·측면·등각(A/S/D 키, F = 화면 맞춤; 기존 i/1/2/3 도 유지), 직교/원근, Ctrl+F 노드·요소 ID 찾기
  (목록·범위), 노드 표시(화면 고정 크기) + 노드 점검(자유단 1연결·고립 0연결·공유), 선택만 보기, 축 평면 자르기(X/Y/Z, 위치, 뒤집기),
  클릭 정보(요소·노드·RBE), 축 표시(gizmo).
- **전체 화면 구성**(Studio 벤치마킹, Logbook 네이비 토큰으로): 어두운 뷰포트, 왼쪽 패널(모델 · 그룹 · 점검 탭),
  오른쪽 정보 도크(선택 정보), 뷰포트 왼쪽 위 툴바, 오른쪽 아래 범례. 단축키 도움말.
- 넣지 않음: 편집, 해석, 다중 뷰포트, 치수 재기.
