---
target: 정리 대기 화면(파일 추가 끌어 놓기·덮개·모델 우선 목록)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Coding\\Logbook\\frontend\\src\\pages\\InboxPage.jsx"
target_fingerprint: "sha256:06da02036f02dd6fcd4a6f04228a5c499a90f19fb3165f61e7aa1ccd4b7fd9c1"
target_path: "C:\\Coding\\Logbook\\frontend\\src\\pages\\InboxPage.jsx"
timestamp: 2026-10-14T01-39-17Z
slug: frontend-src-pages-inboxpage-jsx
---
# 정리 대기 critique (2026-10-14) — 27/40
Method: dual-agent.
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | 칸 진입이 링 색 차이로만 |
| 2 | Real world | 3 | 배치·초안·확정 학습 필요 |
| 3 | Control | 2 | 빗나가면 새 배치, 되돌리기 비쌈 |
| 4 | Consistency | 3 | <b> 700, 첨부 완료 text-ok |
| 5 | Error prevention | 2 | 올라온 칸이 모두 같은 문구 |
| 6 | Recognition | 3 | 확정 막힘 이유 title 에만 |
| 7 | Efficiency | 3 | 확정→다음 초안 키 흐름 없음 |
| 8 | Minimalist | 2 | 행별 옮기기 select 무거움 |
| 9 | Recovery | 3 | 구체적 안내·연결 해제 |
| 10 | Help | 3 | 왜 기다리나요 펼침 |

## Priority issues
- [P1] 두 놓기 목표 시각 충돌 (UploadZone.jsx:203, DraftAttachments.jsx:88) — 가운데 상자 → 상단 고정 띠, 칸 위 깜빡임 제거. layout/clarify
- [P1] 올라온 칸에 초안 식별자 없음 (DraftAttachments.jsx:93) — Entry ID·제목. clarify
- [P2] 놓기 목표 40px 띠로 좁음 — 끌기 중 카드 전체 목표화. adapt
- [P2] 토큰·접근성: <b> 700, text-ok 오용, 막힘 항목 색 구분, aria-describedby, em dash. audit/polish
- [P3] 행별 옮기기 select 무거움, 평소 칸 테두리 투명. quieter
