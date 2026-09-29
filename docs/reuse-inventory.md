# WorkBench 재사용 자산 목록 (Logbook용)

- 조사일: 2026-09-28 (읽기 전용 전수 조사)
- 원칙(사용자 지시): **WorkBench 코드에서 가져올 수 있는 것은 모두 가져와 활용한다.**
- 소유: Studio·HiTessModelBuilder·Nastran_bridge 모두 사내(권혁민) 코드, LICENSE 없음 → 사내 복제 가능.
  예외(가져오지 않음): DoublePipe PSA 엔진(타 연구원 소유), `Darkmode.js`·`mcp-shrimp-task-manager`(제3자).
- ⚠ WorkBench 샘플 BDF 는 실제 호선 모델(기밀) — **Logbook 저장소에 복사하지 않는다.** 테스트는 합성 픽스처 + 로컬 경로 존재 시에만 도는 선택 테스트로.
- 판정: **복사**(그대로) / **이식**(수정해 가져옴) / **참고**(방식만).

기준 경로: `WB = C:\Coding\WorkBench`, `BE = WB\HiTessWorkBenchBackEnd`, `FE = WB\HiTessWorkBench\frontend\src`, `SUB = C:\Coding\WorkBenchSubModule`

---

## 1. BDF 파싱 → 계획 04

| 자산 | 내용 | 판정 |
|---|---|---|
| `BE\InHouseProgram\NastranBridge\nastran_bridge.py` (= `SUB\Nastran_bridge\`, 테스트 포함) 46~500행 순수 함수 | `split_fields`(8칸 고정/쉼표 자유), `read_records`(공백·`+`·`*` 연속행 결합), `convert_bdf` 의 GRID·CBEAM·CBAR·CROD·CONROD·CBUSH·CTRIA3·CQUAD4·RBE2·PBEAML·PBEAM·PBAR·PROD·PSHELL·MAT1·CONM2·SPC·SPC1 해석 | **이식** — 기반 |
| 동 — **없는 것** | `GRID*` 대형 필드(16칸), INCLUDE, CORD2R(CP 무시), RBE3(`convert_bdf` 미해석) | Logbook 이 추가 구현 |
| `C:\Coding\Csharp\Projects\FemScanner\Parsers\CardReader.cs` (C#) | 고정/자유/**대형 필드** 파싱, GRID CP 읽기 | **참고** — 대형 필드 로직을 Python 으로 이식 |
| `BE\app\services\module_ocean_bdf.py` | `_card_name`, `_card_fields`, `_is_continuation` | 참고 |
| `BE\app\services\module_ocean_merge.py` | CORD2R/C/S 인식(변환은 안 함) | 참고 |
| `BE\app\services\bdf_mass_properties.py` | `compute_mass_properties()` 질량·무게중심(Nastran GPWG 대조 검증) | **복사** (Entry 에 질량·COG 표시 시) |

## 2. 3D 뷰어 (three.js) → 계획 04

| 자산 | 내용 | 판정 |
|---|---|---|
| `FE\components\analysis\FeModelViewer.jsx` (1,195행) | 쉘+빔 압축 페이로드 렌더, on-demand 렌더, 직교 카메라, 카메라 고정 조명, `VIEW_PRESETS`(ISO/상/하/전/후/좌/우 + 단축키), `toDataURL` PNG 캡처, 레이캐스트 노드 피킹 | **이식** — 뷰어 기반. ocean "parts" 로직 제거, PID 색·요소 피킹 추가 |
| `FE\utils\feGeometry.js` | `buildTriangleIndices`(CQUAD4→삼각형 2개), `buildShellEdgeIndices`, `toIndexArray` (단위 테스트 있음) | **복사** (deck-seating 부분 제외) |
| `FE\utils\feModelCamera.js` | 직교 카메라 생성/리사이즈 | **복사** |
| `FE\utils\stressColorMap.js` | 컨투어 색 | **복사** (3단계 결과 색) |
| `BE\app\services\module_ocean_transport_service.py::slim_model_json()` | 0-기반 positions/quads/trias/beams/beam_ids 압축 페이로드 | **이식** → `model.lbm` (요소별 PID 배열 추가) |
| `BE\app\services\model_geometry_service.py` + `FE\components\modelRegistry\RegistryModelPreview3D.jsx` | 미리보기 페이로드(대형 모델 절단·명시·캐시), 선 미리보기 | 이식 / 참고 |
| `SUB\ModelBuilderStudio\apps\model-studio\src\three\screenPick.js` | 화면 공간 픽셀 피킹(노드 우선) | **복사** |
| 동 `three\screenSpaceMaterial.js` | 화면 고정 크기 마커·튜브, **직교용 `uOrthoWpp`** | **복사** (RBE·CONM2·SPC 마커) |
| 동 `three\orthoPan.js`, `three\WorldAxes.js` | 직교 팬, 좌표축 | **복사** |
| 동 `utils\groupPalette.js`, `utils\colors.js` | PID/그룹 팔레트 | **복사** |
| 동 `three\BeamMesh.js`, `BeamMesh3D.js`, `data\StageData.js` | 빔 메시(스테이지 형식 결합) | 이식 (2단계 단면 솔리드) |
| `SUB\MooringFittingStudio\src\three\sectionShapes.js` | PBEAML dims → `THREE.Shape` (ROD/TUBE/BAR/BOX/H/I/T/L/CHAN) | **복사** (2단계) |
| `SUB\ModuleUnitStudio\...\utils\renderPixelRatio.js` | 픽셀비 1~2 클램프 | **복사** |
| `SUB\STUDIO_REFERENCE.md` | 뷰포트 골격(조명, 단축키 F/R/A/S/D, 렌더 루프) | 참고 |
| ⚠ 버전 | Studio: three 0.184 + React 19 + zustand / WorkBench FE: three 0.155 + React 18 | **Logbook 은 three 0.184 + React 19 로 통일** (Studio 부품 복사가 더 많음) |

## 3. 썸네일 → 계획 04

| 자산 | 내용 | 판정 |
|---|---|---|
| `BE\app\services\unit_lifting_report\solid3d.py` | matplotlib Agg 헤드리스, `build_mesh`(빔→각기둥/튜브), `render(mesh, colors, view)`→PNG, `face_colors`, `_trim_white`, `fit_aspect` (~1–2s/2,500부재) | **이식** — 쉘 폴리곤 추가 (설계 7.5 의 numpy+Pillow 대신 검증된 이 코드를 우선) |
| `unit_lifting_report\figures.py` | 2D 투영 와이어(`project`, `_segments`) — 더 가벼움 | 이식 (대형 모델용 폴백) |
| `BE\app\routers\newsletters.py` ~160행 | fitz `get_pixmap` PDF→PNG + 메모리 캐시, `fitz.open(stream=_read_bytes(...))` DRM 안전 | **패턴 복사** (보고서 첫 쪽 썸네일) |

## 4. 문서 본문 추출 → 계획 03

- **재사용할 파이프라인 없음** (python-pptx·openpyxl 덤프·ingest 코드 없음) → 신규 작성.
- 조각: `BE\app\routers\analysis.py` ~3600–3680 fitz `get_text()` 공백 정규화·목차 감지 (참고), `drawing_to_analysis_service.py` `_check_pdf`/`_normalize_pdf` (이식).
- 호선 추출: `unit_lifting_report\collector.py:336` 정규식 `(?<!\d)(\d{4})[-_](\d{5})(?!\d)` (호선-유닛) → 설계 5.3 점수 규칙의 "파일명 맨 앞 4자리+구분자" 근거로 사용 (참고).
- `PyMuPDF==1.27.2` 버전 고정 선례.

## 5. DRM 처리 → 계획 01·02·03

규칙(코드보다 지식):
- 응답은 **`read()` 바이트 + 명시적 Content-Length**. `FileResponse`·`os.path.getsize` 금지.
- 매직 바이트만 믿지 말고 실제로 열어 확인.
- 정규화/임시 산출물은 재암호화 폴더 밖(OS temp).
- xlsx 는 BytesIO 메모리에서 생성.

| 자산 | 판정 |
|---|---|
| `newsletters.py` `_read_bytes`, `_safe_issue_dir` | 복사 |
| `viewers.py` zip 무결성 폴백 | 참고 |
| `BE\InHouseAdapters\doublepipe_psa\hitess_adapter\shims\openpyxl_drm.py` (PK 매직 확인 → BytesIO 로드) | 복사 (어댑터 코드이며 엔진 아님) |
| `BE\app\services\xlsx_to_pdf.py` (Excel COM, 프로세스 내 되읽기, 락) | 복사 (필요 시) |
| 문서: `WB\CLAUDE.md` DRM 절, `WB\docs\operations\drawing-to-analysis-pdf-drm-*.md` | 참고 |

## 6. 로그인·사용자·승인·감사 → 계획 01

| 자산 | 내용 | 판정 |
|---|---|---|
| `BE\app\routers\auth.py` | 가입(`EMPLOYEE_ID_PATTERN`, 신규 `is_active=False`)·로그인 | **복사 후 축소** (`server_state`·`external_app_access_store`·`UserPresence` 의존 제거) |
| `BE\app\sessions.py` | DB 기반 UUID 토큰, 8시간 TTL, 매 호출 `is_active` 재확인 | **복사** |
| `BE\app\dependencies.py` | `require_auth`, `require_admin`, `authenticated_employee_id` | **복사** |
| `BE\app\routers\users.py` | 관리자 승인·토글·삭제 | **복사 후 축소** |
| `BE\app\services\activity_service.py`, `routers\activity.py` | `log_activity`(실패 안전), CSV 내보내기 | **참고** — Logbook 감사 로그는 **before/after diff + 무기한 보존**이라 새 테이블. 30일 정리(`prune_activity_logs`)는 가져오지 않음 |
| `FE\contexts\AuthContext.jsx` | 인증 컨텍스트 | 복사 |
| `FE\pages\auth\LoginScreen.jsx` | 로그인 화면 | 이식 (Electron `window.electron` 의존 제거) |
| `FE\pages\Administration\UserManagement.jsx` (1,620행, 일괄 승인) | 사용자 관리 | 이식·축소 |

## 7. 백엔드 기반 → 계획 01·02

| 자산 | 판정 |
|---|---|
| `BE\app\database.py` (pymysql, `.env`, 안전 URL, `pool_pre_ping`) | **복사** |
| `BE\app\schema_bootstrap.py` (`_add_missing_columns`/`_add_missing_indexes`) | **패턴 복사** |
| `BE\app\main.py` (`create_app`, lifespan, CORS `expose_headers` Content-Disposition, 미들웨어 순서) | 이식 |
| `BE\app\services\job_manager.py` (`ManagedAnalysisExecutor`, 취소, Windows 프로세스 트리 종료) | 이식 → 워커 (Analysis 모델 결합 제거) |
| **`BE\app\services\model_registry_storage.py`** — `resolve_registry_root`(env→UNC→로컬), `publish_revision`(staging→checksum→같은 볼륨 원자적 `os.replace`), `is_within_dir`, `sha256_of` | **복사** — Inbox→Vault 확정 이동의 핵심 |
| `BE\app\models.py` `RegisteredModel`/`Revision`/`Artifact` (sha256 중복 제거, 상대 경로만) | 이식 → `files` 테이블 설계 참고 |
| `model_search_service.py` (설명 가능한 유사도 검색) | 참고 (3단계 "비슷한 모델") |
| `routers\_access_control.py`, `services\workspace.py` (원자적 작업 폴더) | 이식 |
| ⚠ `cleanup_service.py` (userConnection 30일 무조건 삭제) | 가져오지 않음. Logbook 보관소는 이런 정리 대상 밖 |

## 8. 프론트 셸·디자인 → 계획 01·03

| 자산 | 판정 |
|---|---|
| `WB\DESIGN.md` 토큰 (Trust Blue #002554, 상태색, Rare Spark 규칙) | **복사** → Logbook 디자인 토큰 |
| `FE\index.css` Tailwind v4 `@theme` 토큰, Inter/SUIT 폰트 | 복사 (본문 폰트는 설계대로 Pretendard 검토) |
| `FE\components\ui\` Button, Badge, StatusBadge, Modal, ConfirmDialog, **FileDropzone**, PageHeader, PageBanner, KpiCard, FilterTabs, FeedbackState, Input | **복사** |
| `FE\contexts\ToastContext.jsx` | 복사 |
| `FE\utils\httpErrors.js`, `formatting.js`, `workbenchRequest.js`(같은 출처에만 토큰 첨부) | 복사 |
| `FE\components\layout\Layout.jsx`, `Sidebar.jsx` | 이식 (NavigationContext·Dashboard 결합 제거) |
| `FE\config.js` | 이식 (포트 9095, 같은 출처 서빙이면 상대 경로) |

## 9. 표본·픽스처

- 쉘: `BE\InHouseProgram\ModuleOceanMoving\JungbanBDF\jungbanBDF_A.bdf`(3.2MB, 27,088 CQUAD4/CTRIA3), `_B.bdf`(4.3MB, 36,304) + 옆의 `.viewer.json` — 성능·쉘 테스트 최적.
- 빔+RBE2+CONM2+SPC1: `BE\SampleFile\GroupModuleUnit\3496-35210-A508372_20260108_edit.bdf`, `SampleFile\ModuleOceanMoving\3521.bdf`, `SampleFile\SidePassage\struData_ori_fixed.bdf`.
- CBAR·SPC·FEGate 헤더: `SampleFile\TrussStructuralAssessment\8276NO1Tank-LV2.bdf`(2.6MB). HyperMesh 헤더: `SampleFile\HPSCR\3276_HPSCR_*.bdf`.
- 작은 쉘: `C:\Coding\Csharp\Projects\FemScanner\FemScanner.Tests\Fixtures\sample.bdf`, `sample_errors.bdf`.
- PDF: `SampleFile\TS\3314 FINAL TRIM STABILITY BOOKLET.pdf`.
- **`GRID*`·INCLUDE·CORD2R·RBE3 표본은 어디에도 없음** → 합성 픽스처 작성.
- 테스트 패턴: `BE\tests\conftest.py`, `test_database_lifecycle.py`, `test_p0_security.py`, `test_activity_service.py`.

## 10. 복사가 어려운 것 (가져오지 않음)

- Studio `ThreeViewport.jsx`(1,864행)·스토어 — Electron host·stage JSON·편집 intent 에 깊게 결합.
- `BE\app\routers\analysis.py`(4,700+행).
- 하드코딩된 개인 UNC 경로(`viewers.py`).
