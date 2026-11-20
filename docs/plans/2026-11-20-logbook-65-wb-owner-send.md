# 65 — WorkBench 일반 사용자가 자기 해석을 LogBook 으로 보내기

- 날짜: 2026-11-20 (설계 확정, 사용자와 문답)
- 관련: 19(WB 관리자 보내기), 39(출처 origin), 49(권상 Wire 자동 첨부), 60(해석 실행자 열람)
- WorkBench 쪽: My Projects 해석 상세의 'LogBook 으로 보내기' (`POST /api/analysis/{id}/logbook`)

## 왜

지금까지 WorkBench → LogBook 보내기는 WB 관리자의 All Projects 에서만 됐다(`sender_not_admin`).
LV1 도 LogBook 화면에서는 이미 직접 올릴 수 있으므로(`require_writer`), 이 변경은 새 권한이 아니라 **올리는 길을 하나 더** 내는 것이다.

## 정한 것

| 항목 | 결정 |
|---|---|
| 누가 무엇을 | 모든 활성 WB 사용자가 **자기 해석만**(남의 해석은 관리자 All Projects 에서만) |
| LogBook 허용 규칙 | WB 관리자는 그대로. 관리자가 아니면 활성 WB 사용자이면서 시작 요청의 `origin.owner` 가 `as` 사번과 같을 때만(`sender_not_owner`). 조각, 마치기, 취소는 '묶음 주인만' 검사(`upload_service._uploading`)가 이미 있어 활성 WB 사용자만 확인 |
| WB 주인 확인 | WB 백엔드가 로그인 사번 = 해석 주인인지 확인(남의 해석은 404). LogBook 은 WB 에 되묻지 않는다(비밀키가 있어야 부를 수 있는 API) |
| 보낸 뒤 | 관리자와 같다 — 보낸 사람 본인의 '올리기와 확정' 초안, 본인이 확정. 공개 단계 기본값 그대로(올린 사람은 늘 자기 자료를 본다) |
| 감사 기록 | 같은 `WB_UPLOAD`, `after.by` = `admin` 또는 `owner`. WB 가 시작 본문에 `via`(`my_projects`, `all_projects`)를 실어 정한다(관리자가 All Projects 에서 자기 해석을 보내도 `admin`). `via` 가 없는 옛 WB 는 관리자면 `admin` |
| 오류 코드 | 활성 WB 사용자가 아니면 `sender_unknown`(예전 `sender_not_admin`). 새 LogBook 은 `sender_not_admin` 을 더 내지 않으므로 WB 는 그 코드를 '옛 LogBook' 표시로 읽는다 |
| 대상 해석 | WB 쪽에서 성공(Success)한 해석만 |
| 첨부 | 관리자와 같다 — 권상 Wire 모델 자동 첨부(49), 해석 여권(39) |
| 끄기 | WB `.env LOGBOOK_OWNER_SEND=0` + 백엔드 재시작(처음 안은 App Settings 였으나, 그 화면은 앱 카탈로그에 있는 앱만 다뤄 바꿈) |

## 배포 순서 (145)

1. **LogBook 먼저**: `git pull` + 재시작.
2. 그다음 WorkBench(`git pull` + 백엔드 재시작 + 프론트 재배포).

순서가 어긋나 옛 LogBook 이 비관리자에게 `sender_not_admin` 을 돌려주면, WB 는 'LogBook 서버가 아직 이 기능을 지원하지 않습니다'로 보여 준다.

## 시험

- `tests/test_wb_upload_19.py`: 비관리자 자기 해석 성공(왕복), 남의 해석과 origin 없음 403 `sender_not_owner`, 비활성 WB 사용자 403, `after.by`.
