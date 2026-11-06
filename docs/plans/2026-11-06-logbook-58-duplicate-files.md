# 58 — 중복 파일 찾기·정리(관리 › 자료 정비 › 중복 파일)

상태: 구현(2026-11-06), 145 확인 남음.

## 왜
같은 보고서·엑셀·모델 파일이 여러 자료에 따로 올라가 있다(폴더째 올리기 52 이후 늘어남). 17 은 **올릴 때** 완전 동일 BDF 만 막고,
145 데이터 검증의 sha256 중복 찾기는 손으로 API 를 불렀다. 관리자가 화면에서 찾아 바로 정리하게 한다.

## 판정
- **파일명(대소문자 무시)이 같은 파일이 서로 다른 자료 2건 이상**에 있으면 한 묶음. 한 자료 안의 같은 이름(하중 경우별 폴더 등)은 보지 않는다.
- 대상: 확정·정리 대기 자료의 파일. 휴지통·뺀 파일(37)은 뺀다.
- 종류: 보고서(pdf·ppt·pptx·doc·docx·hwp·hwpx) · 엑셀(xls·xlsx·xlsm·csv) · 모델(bdf·dat·nas·blk·inp). 결과(op2·f06)·도면은 보지 않는다.
- 묶음마다 **내용도 같음**(sha256 모두 같음) / **이름만 같음**(판이 다를 수 있음)을 표시한다. 내용도 같은 묶음을 위에.
- **남길 것** 추천: 확정 자료 먼저, 그다음 먼저 올린 자료.

## 정리
- 고른 파일마다: 자료에 다른 파일이 남으면 **그 파일만 빼기**(37 `remove_files` — 감사 `ENTRY_FILES_REMOVED`, 확정 자료는 되돌리기),
  자료의 마지막 파일이면 **자료째 휴지통**(`service.trash` — 복원 가능). 같은 자료의 파일은 한 번에 처리.
- 영구 삭제는 하지 않는다. 자료별로 따로 처리해 하나가 실패해도 나머지는 진행, 건너뛴 사유를 보인다.
- '내용도 같은 것 고르기' 단추는 내용도 같은 묶음에서 남길 것 외를 고른다. 이름만 같은 묶음은 사람이 열어 보고 고른다.
- 확인 대화상자에 자료째 휴지통으로 가는 자료 번호를 적는다.

## 구현
- `backend/app/entries/duplicate_files.py` — `duplicate_list`(category·same·q·offset·limit) · `resolve(file_ids)`.
- `GET /api/admin/cleanup/duplicates` · `POST /api/admin/cleanup/duplicates/resolve {file_ids}`(LV3, 최대 200개).
- 화면 `frontend/src/pages/admin/DuplicateFilesView.jsx` — 자료 정비(20)의 네 번째 탭. 사이드 메뉴는 늘리지 않음.
- 테스트 `backend/tests/test_duplicate_files_58.py` · `frontend/src/pages/admin/DuplicateFiles58.test.jsx`.

## 남은 것
- 145 Update 후 실제 자료로 묶음 수·정리 동작 확인.
- 자료 수가 많아지면 파일 전체를 한 번에 읽는 방식(질의 3번)을 이름 GROUP BY 로 바꾼다 — 지금 규모(수천 건)에서는 충분.
