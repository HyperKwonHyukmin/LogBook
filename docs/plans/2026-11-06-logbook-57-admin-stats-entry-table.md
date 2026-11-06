# 57 — 관리 › 자료 현황 · 자료 목록 (LV3)

상태: 구현(2026-11-06), 145 확인 남음.

## 왜

2026-11-06 사용자 요청이다.
- WorkBench 처럼 모델 현황을 본다. 전체 모델(BDF·INP 등)·보고서·엑셀이 몇 개인지 통계를 LV3 가 본다.
- 모든 자료를 목록으로 띄워 구역·대상·담당자·공개 범위를 한꺼번에 본다. 빠지거나 잘못된 것을 눈으로 찾아 한 번에 고친다.

살펴보기(갖춤 현황·관계 지도)에는 파일 형식별 개수가 없었다. 관리 › 자료 정비(20)는 BDF 자료의 필수 분류만 본다.

## 정한 것

- **위치는 관리 탭 두 개다**: '자료 현황'(`/admin/stats`), '자료 목록'(`/admin/entries`). 관리 메뉴는 이미 LV3 전용이고 사이드 메뉴도 늘지 않는다.
- **통계는 확정 자료만 센다.** 정리 대기 초안·휴지통은 건수만 따로 보인다. 휴지통으로 뺀 파일(`location=trash`)은 세지 않는다.
- **형식은 확장자로 묶는다**(`app/admin_stats.py` `CATEGORIES`). 파일 종류(kind)는 검색용이라 `.inp` 가 '기타' 다. 통계는 해석 프로그램별로 나눠 보여야 한다.

  | 묶음 | 확장자 |
  |---|---|
  | 해석 모델 (Nastran) | `.bdf .dat .nas .blk` |
  | 해석 모델 (Abaqus) | `.inp` |
  | 해석 결과 | `.f06 .op2 .h5 .xdb .pch .h3d .odb .sta .msg .log .mvw .hwsession` |
  | 보고서 | `.pdf .pptx .ppt .docx .doc .hwp .hwpx` |
  | 엑셀·표 | `.xlsx .xls .xlsm .csv` |
  | 도면·그림 | `.dwg .dxf .png .jpg .jpeg .bmp .gif .tif .tiff` |
  | 기타 | 나머지 |

- **고치기는 새로 만들지 않는다.** 54 일괄 분류(`POST /api/entries/bulk-classify`)에 `access`(공유·일반·블록)만 더했다.
  - 자료마다 한 건씩 고친 것과 같은 기록이 남는다. 분류는 `update_entry`(ENTRY_UPDATE), 공개 범위는 `set_access`(ENTRY_ACCESS)를 거친다.
  - 권한도 한 건씩과 같다. 공유↔일반은 올린 사람과 LV3, 블록은 LV3 만이다.
  - 공개 범위 칸은 자료 목록의 대화창에서만 보인다(`allowAccess`). 검색의 일괄 분류는 그대로다.

## 화면

- **자료 현황**
  - 요약: 확정 자료(정리 대기·휴지통 건수 함께)·파일·용량·호선·해석 모델(Nastran + Abaqus 파일)
  - 형식별 표: 파일 수·자료 수·용량, 묶음을 누르면 확장자별로 펼친다
  - 월별 확정: 막대 + 자료·파일 수
  - 많이 쓰인 분류: 구역·대상·호선 상위 10
- **자료 목록**
  - 열: 자료(번호·제목) · 호선 · 구역 · 대상 · 담당자 · 공개 · 파일(Nastran·Abaqus·보고서·엑셀·결과 개수) · 올린 사람 · 확정일
  - 빠진 칸은 빨간 '빠짐'으로 보인다. 공용(호선 없음) 표시가 있으면 호선이 없어도 '공용'이다.
  - 거르개: 글자(번호·제목·호선·분류·사람) · [구역 없음 n] [대상 없음 n] [담당자 없음 n] [호선 없음(공용 아님) n] · 공개 범위 · 정리 대기 초안 포함
  - **표에서 바로 고치기**(2026-11-06 사용자 의견 — 골라서 대화창을 여는 것이 번거롭다): 구역·대상은 칸을 눌러 목록에서 고르고, 담당자는 칸 안에서 찾아 더하거나 빼고, 공개는 콤보로 고른다.
    - 고친 줄은 노란 바탕과 '고침' 표시만 하고, [변경 N건 저장]으로 한 번에 저장한다. 원래 값으로 되돌리면 변경에서 빠지고, [되돌리기]는 저장 전 변경을 모두 버린다.
    - 저장은 자료마다 기존 API 를 쓴다. 분류·담당자는 `PATCH /api/entries/{id}`(version), 확정 자료의 공개 범위는 그다음 version 으로 `PUT /api/entries/{id}/access`, 초안의 공개 범위는 PATCH 안에 넣는다. 기록·권한은 한 건씩 고친 것과 같다.
    - 실패한 줄(예: 그사이 다른 사람이 고침)은 빨간 바탕에 사유가 보이고 고친 값이 남는다. 빠진 칸 거르개는 저장된 값으로 거른다(고치는 동안 줄이 사라지지 않게). 저장하지 않고 창을 닫으면 묻는다.
    - 열이 많아 이 화면만 폭을 1600px 까지 넓혔다.
  - 같은 값을 여러 자료에 넣을 때는 골라서(보이는 것 모두 고르기 가능) [고른 N건 바꾸기]: 구역 더하기·빼기, 대상, 공용, 담당자 더하기·빼기, 공개 범위. [미리보기] 뒤에 바꾼다.
  - 서버는 한 번에 최대 5000건을 주고, 화면은 200건씩 더 보인다.

## API

- `GET /api/admin/stats` → `{summary, categories[{key,label,files,entries,bytes,exts[]}], monthly[{month,entries,files}], top{zones,targets,hulls}}`
- `GET /api/admin/entry-table?drafts=` → `{rows[{entry_id,title,status,version,hulls,no_hull,zones,target,assignees,access,uploaded_by,uploader_name,confirmed_at,files{묶음:개수}}], limit, categories}`
- `POST /api/entries/bulk-classify` 에 `access` 를 더했다.

## 검사

- `backend/tests/test_admin_stats_57.py`: 묶음 판정, LV3 만, 묶음·월별·상위 집계(초안·휴지통 제외), 자료 목록 열·초안 포함, 일괄 공개 범위(감사 ENTRY_ACCESS), 블록은 LV3 만.
- `frontend/src/pages/admin/Stats57.test.jsx`: 현황 펼치기·월별, 목록 빠짐 표시·거르개·골라서 공개 범위 바꾸기, 표에서 바로 고쳐 저장(PUT access·PATCH version, 되돌리면 변경 아님, 실패 줄 유지), bulkBody.

## 배포

스키마·`.env` 변경은 없다. 145 Update 만 하면 된다.

## 남은 것

- 145 에서 실제 자료로 숫자가 맞는지 확인한다(사용자).
- WorkBench 모델 현황 화면과 모양을 맞추지는 않았다(WorkBench 화면은 보지 않음).
