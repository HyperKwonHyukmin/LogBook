# 47 — 전반 검토 후 고친 것 세 가지 · 남겨 둔 것

2026-10-22. 상태: 구현·테스트 끝(백엔드 1237·프런트 780 통과), 커밋 a7a429f 푸시. 145 는 Update 만(새 `.env` 키·스키마 없음,
`server_manager.py` 안 바뀜) — Update 뒤 LV1 계정으로 활동 로그 화면이 전과 같은지 확인 남음(개발 PC 는 화면 확인 못 함).

## 왜
프로젝트 전반 검토(백엔드·프런트 코드 읽기, 프런트 테스트 777건 통과, 운영용 의존성 취약점 0건)에서 실사용에 걸리는 세 곳이 나왔다.

## 고친 것
1. **활동 로그(`/api/audit`) 바뀐 내용은 LV3 만** — `backend/app/routers/system.py`.
   숨김 거르개가 '지금 DB 에 있는 볼 수 없는 Entry' 만 가려서, 영구 삭제·합치기로 사라진 비공개 자료의 기록(before/after 에 제목·호선·설명)과
   `UPLOAD_DUPLICATE_FORCED` 의 남의 자료 번호가 LV1 에게 보였다. LV3 가 아니면 `before`·`after` 를 `null` 로 보낸다.
   활동 로그 화면(`AuditLogPage.jsx`)은 내용을 쓰지 않아 화면 변화는 없다. 자료별 이력(상세 화면)은 권한 검사를 따로 하므로 그대로.
2. **워커 Inbox 받기의 다른 예외** — `backend/app/worker.py`. `stage_item` 이 `OSError` 아닌 예외(DB 오류 등)를 내면 `run_once` 밖으로 나가
   그 주기의 작업 큐 처리가 통째로 건너뛰어졌다. 그 항목만 로그 남기고 건너뛴다(다음 주기 재시도는 같다).
3. **[파일 추가] 상태 확인** — `frontend/src/lib/useAddFilesWatch.js`.
   - `stop()`·`reset()` 이 타이머만 지워서 응답을 기다리던 요청이 돌아오면 폴링이 되살아났다(자료 A 에서 추가 → B 로 옮기면 B 에 A 결과).
     세대 번호로 멈춘 뒤의 응답을 버린다.
   - 망 끊김·5xx 한 번에 바로 '실패' 로 끝나던 것을 연속 3번까지 다시 묻는다(`upload.js` `isRetryable` 규칙, 4xx 는 바로 실패).
   - 테스트 `useAddFilesWatch.test.jsx`(수정 전 코드에서 2건 실패 확인).

## 남겨 둔 것(검토에서 나왔지만 지금은 안 함)
- 규모가 커지면: 활동 로그 `NOT IN` 목록, 정리 대기 목록 N+1(`entry_to_dict`·`TitleContext`), 검색이 쪽 단위가 아님(`search/mysql_backend.py`).
- 초안에 붙이는 업로드가 409 로 실패하면 재시도 끝에 배치가 `failed` 로 덮일 수 있음(`worker.py` `attach_processed_batch`, 추정·재현 안 함).
- `.env` 숫자 값이 틀리면 API·워커가 시작하지 못함(`config.py`), API 요청 시간 제한 없음(`frontend/src/api/client.js`).
- 판 비교 폴링 상한 없음(`RevisionDiffPanel.jsx`), 만료 세션 정리, 쓰지 않는 별칭(`EXTRACT_BUDGET_SECONDS`·`LOW_PRIORITY_TYPES`),
  `report_index/worker.py` 머리말의 '작업 스케줄러'.
- 하지 않기로: `viewerEngine.js` 쪼개기(자원 정리가 한곳에 모여 있음), 관리 화면 lazy 로딩(사내망이라 실익 작음),
  `EntryPage.jsx`·`entries/service.py` 쪼개기는 그 기능을 다음에 고칠 때.

## 검토 뒤 판단(2026-10-22)
코드 정확성·견고성은 탄탄하다(검토는 읽기 위주·항목 수 제한이라 결함이 이것뿐이라는 증명은 아님). 남은 불확실성은 코드 밖 —
실사용(팀원이 찾던 자료를 찾는지), 대규모 성능(측정 안 함), 의도해 열어 둔 위험(사번만 로그인, 백업이 데이터와 같은 공유 폴더, 서버 한 대).
그래서 다음에 할 만한 것은 코드 다듬기보다 **실사용 신호 모으기**(검색어·0건 검색 기록) 그리고 41 에서 하지 않기로 한 **백업 사본(공유 폴더 밖)** 을 다시 볼지 정하기(공유 폴더가 망가지면 원본과 백업이 함께 사라짐).
