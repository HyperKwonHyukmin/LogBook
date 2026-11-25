# 72 새 자료 표시(New)

상태: 배포(2026-11-25, 커밋 `07a6210`, 145 Update 후 `/api/me/news` 200 확인). 화면은 눈으로 확인하지 않음. 사용자 요청: "새로운 모델이 등록되면 검색에 새로운 항목 개수 띄워주고, 사용자 확인 전까지 New 띄워주는거 어때, 이건 사용자 커스터마이징화 되어야 겠지" → 추천안 승인.

## 규칙
- 새 자료 = **확정 시각이 내 기준 시각보다 뒤**인 확정 자료 중, 내가 올리지 않았고, 볼 수 있고, 아직 열어 보지 않은 것.
- 기준 시각 = 사용자 설정 `news.seenAt`(서버, 두 PC 공통). 없으면(처음) 지금부터 7일 전.
- 확인 두 가지: [모두 확인] = 기준 시각을 지금으로(내 열어 본 기록도 비운다), 자료 화면이나 검색 미리보기에서 그 자료를 열면 그 자료만(`entry_views`).
  검색 화면을 연 것만으로는 지우지 않는다(못 보고 지나가지 않게).
- 설정(계정 메뉴 '새 자료 표시 설정'): `news.enabled`(기본 켬), `news.targets`(관심 대상, 묶음이면 하위 포함), `news.shipTypes`(관심 선종). 비우면 전체. 꺼 두면 개수와 배지가 모두 없다.
- 개인 편의 정보라 감사 기록, registry.json 대상이 아니다(즐겨찾기, 메모와 같다).

## 화면
- 검색: 결과 위 한 줄 '새 자료 N건' + [새 자료만 보기](`?new=1`) + [모두 확인] + [설정]. 결과 행 제목 앞 'New'.
- 왼쪽 메뉴 '검색' 옆 숫자(99+).
- 배포하면 모든 사용자에게 지난 7일 확정 자료가 처음에 New 로 보인다(처음 기준 시각 규칙).

## API
| 방법 | 주소 | 내용 |
|---|---|---|
| GET | `/api/me/news` | `{enabled, count, since, targets, ship_types}` |
| POST | `/api/me/news/seen` `{entry_id}` | 그 자료를 본 것으로 |
| POST | `/api/me/news/seen-all` | 기준 시각을 지금으로 |
| GET | `/api/search?new=true` | 새 자료만. 자료 행마다 `is_new` |
| GET | `/api/entries/{id}` | `is_new`(화면이 열면 seen 을 부른다) |
| PUT | `/api/me/prefs` | `news.enabled` · `news.targets` · `news.shipTypes` · `news.seenAt` |

표 `entry_views`(employee_id, entry_id FK CASCADE, seen_at, 기본 키 둘) — create_all 이 만든다.
