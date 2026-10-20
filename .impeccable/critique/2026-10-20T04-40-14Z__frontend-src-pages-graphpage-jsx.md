---
target: 관계 지도
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Coding\\Logbook\\frontend\\src\\pages\\GraphPage.jsx"
target_fingerprint: "sha256:0dee81af9d4476f6ac8ddcdb69963ddafa02eb4313fc27d330b96ba7860ceeab"
target_path: "C:\\Coding\\Logbook\\frontend\\src\\pages\\GraphPage.jsx"
timestamp: 2026-10-20T04-40-14Z
slug: frontend-src-pages-graphpage-jsx
---
# 관계 지도(GraphPage) critique — 2026-10-20

Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score — 25/40 (Acceptable)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | 상태 보임 | 3 | 자료 선택 때 오른쪽 열 스크롤이 남아 제목이 잘림 |
| 2 | 현실과 맞음 | 3 | '호선 없음'이 진짜 호선처럼 지도 한가운데 |
| 3 | 사용자 통제 | 3 | 휠 확대가 몇 번 만에 12배 끝 |
| 4 | 일관성 | 2 | 범례 9개 중 기본 화면에 안 보이는 선 다수, UI 문구 em dash |
| 5 | 오류 예방 | 3 | 읽기 전용이라 위험 낮음 |
| 6 | 기억보다 인식 | 2 | 선 모양 9가지를 외워야 함, 읽는 법이 긴 글 |
| 7 | 유연성 | 3 | 찾기·방향키·고정 있음 |
| 8 | 미니멀 | 1 | 호선 기준 기본 화면이 실타래(hairball) |
| 9 | 오류 회복 | 3 | 머리 경고 명확 |
| 10 | 도움말 | 2 | 도움말이 길고 범례가 안 보이는 것을 설명 |

## Design Specificity
LLM: 셸·옆 열은 DESIGN.md 를 잘 따름(네이비 허브, mono 호선, 헤어라인). 캔버스가 문제 — 옵시디언식 그래프 모양이 '무엇이 왜 이어졌나'를 한눈에 주지 못함.
Detector: `impeccable detect` GraphPage.jsx · components/graph · lib/graphModel.js = 0건. 브라우저 오버레이 1건 `layout-transition`(transition: width) — 지도 화면이 아니라 정리 대기 진행 막대(BatchCard.jsx:86, UploadZone.jsx:138) 클래스라 이 화면엔 오탐.
측정: 데모 데이터 자료 388 · 모델 관계 221 · 문서 관계 142. 범례 9항목이 1600px 에서 두 줄.

## Priority Issues
- [P0] 호선 기준 기본 화면이 실타래 — 호선 30개 거의 모든 쌍에 곡선이 늘 그려짐(3321 은 9개 중 8개가 '형상만 같음 1'). 약한 관계가 강한 관계를 가림. Fix: 기본은 관계 2건 이상(또는 호선마다 상위 N개)만 곡선, 초점일 때만 전부; K.agg 알파 .36→.2, 1건 선은 더 가늘게. (distill/quieter)
- [P1] '○○ 없음' 점이 한가운데 — 곡선을 끌어당김. Fix: aggregate/related 힘에서 빼고 가장자리로. (layout)
- [P1] 범례가 길고 안 보이는 선까지 나열 — Fix: 지금 그려지는 종류만, 4개 이내, 나머지는 읽는 법으로. (clarify)
- [P2] 초점 때 선 위 글자('형상만 같음 1')가 겹침 — Fix: 충돌 상자 적용, 숫자만, 이유는 오른쪽 열에. (polish)
- [P2] 확대·스크롤 — 휠이 민감하고 최대 12배, 선택 때 오른쪽 열 스크롤 유지. Fix: wheelDelta 절반, 최대 6배, 선택 때 scrollTop=0. (polish)

## Persona Red Flags
- Alex: 강도·종류로 선 거르기 없음, 하이라이트 칩 약 40개.
- Sam: 선 종류를 얇은 점선 모양으로만 구분, 이유가 툴팁에만(오른쪽 열이 일부 보완).
- 설명회 발표자: 기본 화면이 프로젝터에서 잡음처럼 보여 '이게 뭐냐'는 질문을 부름.

## Minor
- 호선 기준에서 '선종 색'은 거의 효과 없음. 기준을 오가면 배치가 바뀜. 2배 확대부터 자료 번호가 쏟아짐. 표시 팝오버가 1366px 에서 화면 아래로 넘침. UI 문구 em dash(DESIGN 8번).

## Questions
1. 기본은 '호선을 고르기 전엔 선을 안 그림'(지도는 길잡이, 답은 오른쪽 열)이어야 하나?
2. 형상 하나 겹친 두 호선에 선이 필요한가, 목록 한 줄이면 충분한가?
3. 호선 30개 사이 관계는 그래프보다 호선 × 호선 행렬이 더 잘 답하지 않나?
