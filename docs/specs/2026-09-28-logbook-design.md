# Logbook 설계 문서 (Spec)

- 작성일: 2026-09-28
- 상태: 설계 승인 완료 → 구현 계획 작성 전
- 화면 목업: https://claude.ai/artifact/WtzcLGqFa3hkuT8f7GSWWs (검색 / 호선 타임라인 / Entry 상세 + BDF 뷰어)

---

## 1. 개요

**Logbook — 구조해석 항해일지.**
조선소 구조해석 연구실의 해석 모델(BDF), 해석 결과(F06·OP2), 보고서(PPTX·XLSX·PDF)와 관련 자료를
**호선 · 선종 · 구역 · 해석 종류**로 묶어 보관하고, 검색하고, 브라우저에서 바로 확인하는 팀 공용 자료 창고.

### 1.1 목표
1. 팀원 개인 PC에 흩어진 해석 자료를 한곳(`999_LogBook`)에 모은다.
2. 호선 번호·메타데이터·**보고서 본문**으로 찾을 수 있게 한다.
3. BDF(1D·2D 쉘) 모델을 설치 없이 크롬에서 3D로 확인한다.
4. 누가 언제 무엇을 올리고 바꿨는지 모두 기록한다.

### 1.2 범위 밖 (명시)
- **AI 기능 전부**(요약·자연어 질의·임베딩) — 3단계 이후. 자리만 남긴다.
- HiTESS WorkBench 연동 — Logbook 은 **독립 프로그램**이다. 코드·DB·저장소를 공유하지 않는다.
- 설치형 런처(exe) — 크롬 웹앱만 제공한다.
- 해석 결과(OP2) 색 입히기 — 3단계.

### 1.3 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 이름 | Logbook (부제: 구조해석 항해일지) |
| 성격 | WorkBench 와 별개인 독립 프로그램, 별도 Git 저장소 `C:\Coding\Logbook` |
| 형태 | 크롬 웹앱. 접속은 공유 폴더의 `.url` 바로가기 + 북마크 안내 |
| 서버 | 10.14.42.145 (WorkBench 와 같은 머신, **별도 프로세스 · 포트 9095 · 별도 DB**) |
| 저장 | `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook` = **유일한 원본** |
| DB | 145 의 MySQL 인스턴스에 `logbook` 데이터베이스. `999_LogBook` 에서 재구축 가능한 **캐시** |
| 자료 출처 | 팀원 개인 PC → 각자 올림 |
| 올리기 | 탐색기로 `00_Inbox` 에 복사(기본, DRM 해제 경로) + 크롬 업로드(DRM 검사) |
| 묶기 | 서버가 Entry 묶음 제안 → **올린 사람이 확정**. Entry 를 먼저 만들고 넣는 방식도 지원 |
| 권한 | 확정 후 수정·삭제는 **팀원 누구나**. 삭제는 휴지통. **모든 변경 로그** |
| 로그인 | 사번 입력 + **관리자 승인** |
| 메타데이터 | 표준 코드 없음 → 자유 입력 + 자동완성 + 동의어 묶기. 호선은 주로 4자리 |
| 기술 | Python(FastAPI) + React(Vite) + three.js + MySQL(ngram 전문 검색) |
| 디자인 | HD현대 시그니처 컬러, 상용 제품 수준의 깔끔하고 전문적인 화면 |

---

## 2. 전체 구조

```
┌─ 크롬 ───────────────────────────────┐
│ Logbook Web (React + Vite + three.js)  │  빌드 결과물은 API 가 함께 서빙
└──────────────┬───────────────────────┘   → 접속 주소 하나: http://10.14.42.145:9095
               │ REST (JSON)
┌─ 145 서버 ───▼───────────────────────┐
│ logbook-api    (FastAPI)              │  로그인·검색·Entry CRUD·다운로드·로그
│ logbook-worker (Python, 별도 프로세스) │  Inbox 감시·분류·추출·BDF 변환·썸네일
│      ↕ 작업 큐 = MySQL jobs 테이블    │  (Redis 없음)
│ MySQL `logbook`                       │  메타데이터·전문 색인·로그 (캐시)
└──────────────┬───────────────────────┘
               │ SMB
┌─ 999_LogBook ▼ (유일한 원본) ────────┐
│ 00_Inbox 10_Vault 20_Derived           │
│ 80_Backup 90_System 95_Trash           │
└──────────────────────────────────────┘
```

- API 와 워커를 분리해 무거운 변환 작업이 화면 응답을 느리게 하지 않게 한다.
- 워커의 무거운 작업은 **낮은 우선순위**로 돈다(WorkBench 의 Nastran 해석이 우선).

### 2.1 핵심 원칙 — "공유 폴더가 원본, 서버는 캐시"
- 모든 원본 파일과 메타데이터(`entry.json`)는 `999_LogBook` 에 있다.
- DB·검색 색인·파생물은 `999_LogBook` 만으로 **언제든 다시 만들 수 있어야** 한다(재구축 명령 제공).
- DB 엔진 데이터 파일은 공유 폴더에 두지 않는다(SMB 잠금으로 손상 위험).
- **DRM 규칙**: 풀린 원본을 145 로컬 디스크(C:)에 쓰면 회사 DRM 이 다시 암호화한다(+4096B).
  원본과 파생물은 **공유 폴더에만** 쓴다. 크롬 업로드도 API 가 곧바로 공유 폴더에 기록한다.

---

## 3. 저장소 폴더 구조 (`999_LogBook`)

```
999_LogBook\
├─ 00_Inbox\                          팀원이 올리는 곳
│   ├─ <올린 폴더 또는 파일>
│   └─ _web\<BatchID>\                크롬 업로드분
├─ 10_Vault\
│   ├─ _staging\<BatchID>\            받은 직후~확정 전
│   └─ <연도>\<EntryID>\              확정된 Entry (고정 경로, 메타데이터 수정 시에도 이동 없음)
│        ├─ entry.json                메타데이터 원본 (DB 재구축 원천)
│        ├─ _INFO.txt                 사람이 읽는 요약(호선·제목·올린 사람)
│        └─ files\<올린 그대로의 하위 구조>   ← BDF INCLUDE 상대경로 보존
├─ 20_Derived\<EntryID>\              서버 생성물 (지워도 재생성 가능)
│   ├─ text\  thumbs\  <파일ID>.lbm  summary.json
├─ 80_Backup\                         MySQL 일일 덤프
├─ 90_System\                         logs\ audit\(월별 JSONL) 명명 규칙 사전, 처리 로그
└─ 95_Trash\<EntryID 또는 파일ID>\    휴지통 (복원 가능, 90일 후 자동 비움)
```

- **EntryID**: `E` + 6자리 일련번호 (예: `E000123`). 말하기·메신저 공유용.
- 권한: 현재 `HDRND\AA_300_CF44` 그룹 FullControl. 당분간 "Vault 직접 수정 금지" 운영 규칙으로 막고,
  필요 시 IT 에 Vault 읽기 전용화를 요청한다.

---

## 4. 데이터 모델 (MySQL `logbook`)

| 테이블 | 핵심 필드 | 비고 |
|---|---|---|
| `users` | employee_id, name, department, status(pending/active/disabled), is_admin, created_at | 첫 관리자는 설치 시 지정 |
| `hulls` | hull_no(4자리 문자열), ship_type(자유), memo | **선종은 호선의 속성** |
| `entries` | entry_id, title, analysis_type, description, status(unconfirmed/confirmed/trashed), analysis_period(YYYY-MM), uploaded_by, confirmed_by, confirmed_at, vault_path, **version** | version = 낙관적 잠금 |
| `entry_hulls` | entry_id, hull_no, is_primary | Entry ↔ 호선 N:M (자매선 공통 해석) |
| `tags` | tag_id, kind(zone/analysis_type/free), value, alias_of | 자유 입력 + 동의어 |
| `entry_tags` | entry_id, tag_id | |
| `batches` | batch_id, source(inbox/web), original_path, uploader_guess, uploader_claimed, received_at, state, target_entry_id | target 이 있으면 "기존 Entry 에 추가" |
| `files` | file_id, batch_id, entry_id, rel_path, name, ext, kind(model/result/report/drawing/other), size, sha256, is_include, drm_encrypted, extract_state, convert_state, convert_error | |
| `file_texts` | file_id, locator(쪽/슬라이드/시트), text | `FULLTEXT ... WITH PARSER ngram` |
| `model_summaries` | file_id, counts(JSON), bbox(JSON), properties(JSON), materials(JSON), sol, fingerprint_text | fingerprint_text 는 검색 색인 대상 |
| `jobs` | job_id, type, target_id, state, attempts, last_error, priority, updated_at | 워커 큐 |
| `audit_log` | at, employee_id, action, target_type, target_id, before(JSON), after(JSON) | `90_System\audit\YYYY-MM.jsonl` 에도 기록 |

### 4.1 `entry.json` (Vault 원본 메타데이터)
DB 의 entries·entry_hulls·entry_tags·files(해당 Entry 분) + 최종 수정자/시각을 담는다.
**Entry 가 바뀔 때마다 DB 와 함께 갱신**한다. 재구축 명령은 모든 `entry.json` 을 읽어 DB 를 채우고,
파생물(텍스트·lbm·썸네일)은 `20_Derived` 에 있으면 재사용, 없으면 작업 큐에 넣는다.

---

## 5. 올리기 흐름

### 5.1 받기
| 입구 | 동작 |
|---|---|
| 탐색기 → `00_Inbox` | 워커가 **30초 주기**로 확인(SMB 변경 알림 대신 폴링). Inbox 바로 아래 **폴더 1개 = 배치 1개**. 낱개 파일은 **같은 소유자가 2분 안에 넣은 것 = 배치 1개**. 복사 완료 판정 = **60초 동안 크기·수정 시각 불변 + 배타적 열기 성공** |
| 크롬 업로드 | 폴더/다중 파일 드래그·선택 → 분할 업로드 → API 가 `00_Inbox\_web\<BatchID>\` 에 기록. 첫 바이트가 `HHIDRMC` 면 **그 파일은 거부**하고 "탐색기로 Inbox 에 복사" 안내 |

- **올린 사람**: 크롬 = 로그인 사용자. Inbox = 파일 소유자(`HDRND\<계정>`)를 사번과 대조. 실패 시 "주인 없는 배치" → 누구나 "내가 올렸어요"로 가져감.
- 받자마자 `10_Vault\_staging\<BatchID>\` 로 이동(같은 공유 폴더 내 rename).
- **자동 제외**: `~$*`(Office 임시), `Thumbs.db`, `desktop.ini`, `*.MASTER`, `*.DBALL`, `*.SCRATCH`. 제외 목록은 화면에 표시.

### 5.2 처리 (파일 단위, 한 파일 실패가 다른 파일을 막지 않음)
SHA-256 → 중복 검사 → 분류 → 본문 추출 → 호선 후보 추출 → (BDF) 변환·썸네일 → 색인

- **분류**(확장자 + 내용): `bdf dat nas blk` → model / `f06 op2 h5 log` → result / `pdf pptx xlsx docx` → report / `dwg dxf png jpg` → drawing / 그 외 other.
- **중복**: 해시가 같으면 "E000045 에 이미 있음" 표시, 확정 시 건너뛰기/포함 선택.
- **본문 추출**: PDF = PyMuPDF(쪽 단위), PPTX = python-pptx(슬라이드 본문 + **발표자 노트**), XLSX = openpyxl(시트별 셀 값, 계산값 기준), DOCX = python-docx.
- **요약 카드(규칙 기반)**: 제목, 쪽·슬라이드 수, 작성일(문서 속성), 목차·슬라이드 제목 목록, 표지 텍스트.

### 5.3 호선 추출 (점수 기반)
| 근거 | 가중치 |
|---|---|
| 문서 안 "HULL", "호선", "Hull No" 옆의 4자리 | 매우 높음 |
| 파일·폴더명 **맨 앞** 4자리 + 구분자(`-` `_` 공백) | 높음 |
| 같은 배치 여러 파일에서 반복 | 높음 |
| 이미 등록된 호선 목록에 존재 | 높음 |
| 19xx·20xx 형태(연도 가능성) | 감점 |
결과는 후보 + 근거로 제시한다(예: "3496 — 파일명 5개, 보고서 표지").

### 5.4 묶음 제안
1. 하위 폴더 경계로 후보 Entry 분할(폴더 없으면 배치 전체 = 후보 1개).
2. 파일명 stem 이 같은 파일끼리 묶음(`a.bdf ↔ a.f06 ↔ a.op2`).
3. 호선 후보가 다르면 분할, 같으면 병합 방향.
4. 기존 Entry 와 호선 동일 + 제목/파일명 유사 → "E000045 에 추가할까요?" 제안.

### 5.5 확정
- **정리 대기 화면**: 후보 Entry 카드, 파일 드래그로 이동·병합·분할, 추정값이 미리 채워진 호선·제목·해석 종류·구역.
- 확정 권한 = **올린 사람**. 관리자는 30일 이상 방치된 배치를 대신 확정·이관할 수 있고 이력에 남는다.
- **미확정 자료도 검색·열람 가능**("미분류" 표시, 수정은 불가).
- 확정 → `10_Vault\<연도>\<EntryID>\files\...` 로 이동, `entry.json`·`_INFO.txt` 생성, 로그.

### 5.6 기존 Entry 에 추가
Entry 화면 [파일 추가] → target_entry_id 가 지정된 배치 생성 → 같은 흐름. 보고서를 나중에 올리는 경우.

---

## 6. 검색과 화면

### 6.1 화면 목록
| 화면 | 주소 | 내용 |
|---|---|---|
| 검색(홈) | `/`, `/search?q=` | 검색창 + 필터(건수) + 결과 + 오른쪽 미리보기 패널 |
| 호선 | `/h/{hull}` | 호선 정보 + 통계 + **월별 타임라인** + 구역 분포·참여자 |
| Entry 상세 | `/e/{entryId}` | 인라인 수정 머리말, 파일 트리, 미리보기/BDF 뷰어, 변경 이력 |
| 정리 대기 | `/inbox` | 내 배치 / 주인 없는 배치, 묶음 제안, 확정, 업로드 영역 |
| 태그 | `/tags` | 사용 횟수, 동의어 묶기·풀기 |
| 휴지통 / 활동 로그 | `/trash`, `/log` | 복원 / 전체 변경 이력 |
| 관리자 | `/admin` | 가입 승인, 관리자 지정, 재색인·재변환·재구축, 워커 상태 |

모든 주소는 메신저로 공유 가능한 **고정 링크**다.

### 6.2 검색
- 대상: Entry 제목·설명·태그, 파일명, 보고서 본문, 모델 지문.
- 입력 즉시 결과(디바운스 ~200ms), `Ctrl+K` 로 어디서든 검색창.
- 4자리 숫자는 **호선 필터 적용을 제안**(자동 적용하지 않음).
- 순위: 호선/제목 정확 일치 > 태그 > 파일명 > 본문. 본문 일치는 **쪽·슬라이드 위치 + 강조 발췌문**.
- 필터: 호선, 선종, 해석 종류, 구역, 연도, 올린 사람, 파일 종류, 미확정 포함. 건수는 `GROUP BY`.
- 보기 단위: Entry(기본) / 파일.
- 동의어: 검색 시 alias 로 묶인 값을 함께 찾는다(원래 입력값은 보존).
- **검색 모듈은 인터페이스 뒤에 둔다** — 추후 Meilisearch 로 교체할 때 이 모듈만 바꾼다.

### 6.3 미리보기
PDF = pdf.js 페이지 보기 / PPTX = 슬라이드별 제목·본문 목록(이미지 없음) / XLSX = 시트 탭 + 앞 200행 표 / BDF = 3D 뷰어 / 그 외 = 다운로드.
브라우저는 UNC 경로를 열 수 없으므로 **"경로 복사"** 버튼을 제공한다.

### 6.4 디자인 시스템
- **원칙**: 검색이 곧 제품 / 틀은 조용하게 내용은 또렷하게 / 밀도 + 위계 / 떠나지 않고 본다(오른쪽 패널) / 출처가 보이는 신뢰.
- **벤치마크**: Autodesk Docs·Vault, Box·Dropbox 미리보기, Linear, Algolia 계열 검색 UI, Notion 인라인 편집.
- **안티 레퍼런스**: 낡은 사내 시스템(회색 그라데이션, 작은 아이콘 줄, 모달 중첩, 페이지 새로고침).
- **색 (HD현대 시그니처)**

| 토큰 | 값 | 용도 |
|---|---|---|
| Trust Blue | `#002554` | 주 버튼, 링크, 선택·포커스, 활성 메뉴 |
| Trust Blue Dark | `#003366` | hover |
| Trust Blue Tint | `#E8EDF4` / 링 `#D3DCE8` | 활성 메뉴 배경, 필터 칩, 포커스 링 |
| Heritage Green | `#008233` | 확정 상태, 정상 연결 |
| Heritage Green Light | `#00E600` | **로고 한 점에만**(희소 신호) |
| 미확정 / 오류 | `#B45309` / `#B91C1C` | 점·배지로만 |
| 중성 | Zinc 계열, 바탕 `#F4F4F5`, 표면 `#FFFFFF`, 선 `#E4E4E7` | |
| 3D 뷰어 배경 | `#0E1A2B` | |
| 파일 종류 | BDF 남색, 결과 보라, PDF 빨강, PPTX 주황, XLSX 초록 | 옅은 배경 + 진한 글자 배지 |

- **글꼴**: 본문 Pretendard(목업은 IBM Plex Sans KR 로 대체), 숫자·ID·경로 JetBrains Mono(tabular).
- 본문 14px, 목록 13px, 모서리 6px, 전환 150~200ms, 로딩은 스켈레톤.
- 접근성: 대비 AA 이상, 키보드 포커스 표시, 아이콘 버튼 aria-label, 상태는 색 + 글자 + 점으로 중복 표기.
- 셸: 상단 바 56px(로고·검색·올리기·계정) + 좌측 탐색 208px + 본문 + 오른쪽 미리보기 패널.

---

## 7. BDF 뷰어

### 7.1 변환 (워커)
- 파서: **자체 파서 — HiTESS WorkBench `nastran_bridge.py` 의 BDF 파싱 기법을 이식**(2026-09-28 사용자 결정, pyNastran 미사용).
  - 읽기: `read_text(encoding="utf-8", errors="replace")` + 8칸 고정폭/쉼표 자유 필드 분리. 한글은 `$` 주석에만 있어 버려지므로
    **UTF-8·cp949 어느 쪽으로 저장된 BDF 든 안전**하다(pyNastran 은 한글 주석이 있으면 두 인코딩 모두에서 파싱 실패 — PoC 검토에서 확인).
  - 자체 구현 필요 항목: 대형 필드(`GRID*` 등 16칸), 연속 행, INCLUDE, 좌표계(CORD2R/CORD1R) 변환 후 **전역 좌표 저장**, 참조 확인(요소→PID·GRID).
    WorkBench 에 이미 있는 구현은 그대로 가져온다(재사용 목록: `docs/reuse-inventory.md`).
- 미지원 카드는 건너뛰고 경고 목록으로 남긴다(변환은 계속).
- 같은 Entry 안 다른 BDF 가 INCLUDE 하는 파일은 `is_include=true` — 단독 모델로 변환하지 않는다.

### 7.2 `model.lbm` (gzip 바이너리)
| 블록 | 내용 |
|---|---|
| 머리말(JSON) | 형식 버전, 단위, bbox, 요소 종류별 개수, 경고 |
| 노드 | id int32 + xyz float32 |
| 1D | CBAR·CBEAM·CROD·CONROD: `[eid, pid, n1, n2]` |
| 2D | CTRIA3/6, CQUAD4/8 꼭짓점 노드(중간 절점 무시) |
| 강체·질량·구속 | RBE2·RBE3(독립/종속), CONM2(노드·질량), SPC 노드 |
| 속성표(JSON) | pid → 카드, 단면 형상·치수, 두께, 재료 |

### 7.3 렌더링 (three.js)
- **PID 별 병합 메시**(1D = LineSegments, 2D = Mesh), 요소 경계선은 토글.
- 직교 카메라 기본, 시점 프리셋 등각·정면·측면·평면, 화면 맞춤.
- **GPU 피킹**(ID 색 렌더 타깃)으로 요소 선택.
- 대형 모델(기준 예: 20만 요소 이상): PID 단위 순차 로드 + 진행 막대, 경계선 기본 끔.

### 7.4 MVP 기능
1. 1D·2D 기본 표시 + 시점 조작
2. PID 별 색상 + 표시 토글
3. 요소 클릭 정보(EID, 카드, PID·단면·치수, 재료, 절점, 길이)
4. RBE2·RBE3·CONM2·SPC 표시 토글

2단계: 1D 단면 솔리드, 쉘 두께 표시, 측정·클리핑. 3단계: OP2/F06 결과 컨투어.

### 7.5 썸네일
서버에서 numpy + Pillow 로 등각 투영 PNG(선·면 직접 래스터화). 브라우저·GPU·추가 설치 불필요.

### 7.6 모델 지문 (검색용)
요소 종류별 개수, bbox, 단면 문자열(`PBEAML L 100x100x10`, `PSHELL t12`), 재료, SOL → `fingerprint_text`.

### 7.7 실패
변환 실패 시에도 Entry 등록·다운로드는 가능. 뷰어 자리에 사유 표시
(예: "INCLUDE 파일 mat.bdf 없음 → 같은 Entry 에 추가하면 자동 재변환"). 관리자 화면에서 전체 재변환.

---

## 8. 로그인·권한·로그

- 최초 접속 → 사번·이름·부서 입력 → **가입 신청** → 관리자 승인 후 사용. 브라우저가 세션을 기억.
- 역할: 일반(조회·올리기·확정(본인 배치)·수정·삭제) / 관리자(+승인, 관리자 지정, 방치 배치 처리, 휴지통 영구 삭제, 재구축).
- 삭제 = 휴지통 이동(`95_Trash`), 복원 가능, 90일 후 자동 비움(영구 삭제는 관리자도 수동 가능).
- 모든 생성·수정·삭제·확정·복원은 `audit_log` + 월별 JSONL 에 before/after 로 남긴다.

---

## 9. 오류 처리

| 상황 | 대응 |
|---|---|
| 공유 폴더 연결 끊김 | 상단 배너, 업로드 차단, 워커 일시정지 + 백오프 재접속. 검색·열람은 DB 로 유지 |
| 복사 중·잠긴 파일 | 안정성 판정 후 재시도, 배치에 대기 사유 표시 |
| 워커 중단 | 작업 멱등, `jobs` 상태로 재개, 공유 폴더 내 이동은 rename |
| DB 유실 | `entry.json` 기반 재구축 + 일일 덤프 복구 |
| DRM 파일 | 크롬 업로드 거부 / Inbox 유입 시 보관하되 "암호화됨" 표시·추출 제외 |
| 동시 수정 | Entry.version 낙관적 잠금, 충돌 안내 |
| 경로 길이 260자 초과 | 내부는 `\\?\UNC\` 긴 경로 접두사, 확정 화면에서 경고 |

---

## 10. 테스트

- 단위: 호선 추출, 분류, 묶음 제안, BDF→lbm, 형식별 본문 추출(표본 파일: INCLUDE·대형 필드·CORD2R 포함).
- 통합: 임시 폴더로 `999_LogBook` 모사 → 올리기~확정~검색 전 과정, **DB 삭제 후 재구축** 시나리오.
- **DB 테스트는 MySQL** 로 한다(SQLite 는 운영 차이를 숨긴다).
- 화면: Playwright E2E(검색·업로드·확정·수정·휴지통) + 표본 모델 뷰어 스모크.
- 성능: 50만 요소 모델 변환 시간, 브라우저 로드 시간, 회전 FPS.

---

## 11. 사전 실험 (구현 착수 전 필수)

| # | 실험 | 영향 |
|---|---|---|
| 1 | 표본 pptx·xlsx·pdf 를 `999_LogBook` 에 복사 → 145 의 Python 이 평문으로 읽는가 | 전체 전제 |
| 2 | 공유 폴더 내 다른 폴더로 이동 후에도 평문인가 | Inbox→Vault 이동 |
| 3 | 크롬 업로드한 DRM 파일이 암호문으로 도착하는가 | 크롬 업로드 효용 |
| 4 | 145 에서 파일 소유자(Owner) 계정을 읽을 수 있는가 | 올린 사람 자동 판별 |
| 5 | 팀 실제 BDF 소·중·대 3종 pyNastran 파싱 시간·메모리 | 대형 모델 처리 |
| 6 | 145 실행 계정의 공유 폴더 권한 + 팀원 PC → 9095 포트 접속(방화벽) | 배포 가능성 |
| 7 | 긴 경로·한글 파일명 처리 | 경로 처리 방식 |

실험 1 이 실패하면 설계(특히 2.1 원칙과 5.1 입구)를 재검토한다.

---

## 12. 운영 (145)

- API·워커를 Windows 서비스로 등록(재부팅 자동 시작).
- 로그 `90_System\logs`, DB 덤프 매일 `80_Backup`.
- 관리자 화면: 워커 상태, 대기 작업 수, 최근 오류.
- 배포: 개발 PC(10.133.122.70)에서 개발 → 145 에서 `git pull` + 서비스 재시작. 프론트는 빌드 산출물을 API 가 서빙.

---

## 13. 단계별 범위

| 단계 | 포함 |
|---|---|
| **MVP** | 사번 로그인·승인, Inbox·크롬 업로드, 묶음 제안·확정, Entry 수정·휴지통·로그, 필터 + 본문 검색, 호선 타임라인, pdf·pptx·xlsx 미리보기, BDF 뷰어 ①~④, 썸네일, 재구축 명령 |
| 2단계 | 1D 단면 솔리드, 쉘 두께, 측정·클리핑, 동의어 관리 UI 다듬기, 슬라이드 이미지(145 에 PowerPoint 있을 때) |
| 3단계 | OP2·F06 결과 컨투어, AI 요약, Meilisearch, 자매선 연결 |

---

## 14. 열린 질문 (구현 계획 단계에서 확정)

- 사내 DNS 이름 발급 가능 여부(가능하면 `.url` 대신 이름으로 접속).
- 145 에 PowerPoint 설치 여부(슬라이드 이미지, 2단계).
- 휴지통 자동 비움 기간(기본 90일) 확정.
- Pretendard 폰트 자체 호스팅(웹폰트 파일을 저장소에 포함).
