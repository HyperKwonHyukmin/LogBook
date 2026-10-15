# 18 — HiTESS WorkBench ↔ Hi-TESS LogBook 연결 (계획)

작성 2026-10-08 · 상태: **계획 (구현 전, 사용자 결정 대기)**

## 0. 목표
1. WorkBench에 로그인한 사용자가 **추가 로그인 없이** LogBook 창을 연다.
2. 테스트 기간에는 WorkBench 백엔드와 **같은 IP의 9095**를 쓴다(개발 PC 10.133.122.70 / 서버 145).
3. BDF를 입력으로 받는 대표 앱 **Group & Module Unit 권상 구조 해석(GMU)**이 LogBook의 모델을 바로 입력으로 가져온다.
   - **방식 A — 골라서 보내기**: LogBook 창에서 모델을 누르고 [WorkBench로 보내기]를 누른다.
   - **방식 B — 번호 입력**: LogBook에서 번호를 복사해 WorkBench에 붙여 넣는다.

---

## 1. 지금 코드 상태 (조사 결과)

### LogBook (9095)
| 항목 | 현재 |
|---|---|
| 로그인 | `POST /api/auth/login {employee_id}`. 비밀번호가 없다. `hitessworkbench.users`를 읽고, 처음 로그인하면 LV1 행을 만든다. |
| 세션 | UUID Bearer 토큰(`user_sessions`, 8시간). 프런트는 `localStorage['logbook_token']`에 둔다. **쿠키는 쓰지 않는다.** |
| 매 요청 | WorkBench `is_active`를 60초 캐시로 다시 확인한다. 비활성이 되면 세션을 폐기한다. |
| 외부 연동 | **없다.** CORS·SSO·embed 모드·postMessage가 모두 없다. |
| 고유 번호 | Entry는 `E000123`이고 복사할 수 있다. 파일은 정수 `files.id`뿐이다(`/v/4512`). |
| 파일 받기 | `POST /api/files/{id}/link` → `GET /content?t=`(10분 일회 링크). 권한은 `access.file_visible`로 확인하고, 1MB 단위로 스트리밍하며 DRM 규칙(read 바이트)을 따른다. |
| 판(revision) | `model_revisions.is_latest`. **판이 1개뿐인 모델은 series가 없고 is_latest=False**이므로 `others`로 폴백해야 한다. |
| 모델 정보 | `GET /api/files/{id}/model`(카드 수·bbox·SOL·includes·missing), `thumb.png`, `solve-check` |

### WorkBench (9091)
| 항목 | 현재 |
|---|---|
| 로그인 | 사번만 받는다(비밀번호 없음). UUID Bearer 토큰(`UserSession`, 8시간). **서명 비밀키·JWT·SSO 발급 엔드포인트가 없다.** |
| 외부 앱 신원 전달 | `externalAppLaunch.js`에 두 방식이 있다. RAW 방식은 URL에 사번을 그대로 넣는다(인증 없음). PROXY 방식은 45초 일회 grant를 쿠키로 바꾼다(`external_apps.py`, `external_app_access.py`). |
| 외부 창 | Electron `open-app-window`는 windowKey당 창 1개다. **preload가 없어서 창에서 메인으로 돌아오는 통로가 없다.** |
| GMU 입력 | ① 파일을 놓으면 `setBdfFile(file)`이 받는다. ② `handoffBdfPath`는 서버 경로를 `request-from-path`로 넘긴다. 이 경로는 **`userConnection/` 아래이면서 그 사용자 폴더(`ts_사번_…`)일 때만** 통과한다. ③ `gmuHandoff {bdfServerPath, sourceApp}`는 Model Builder에서 넘어올 때 쓰는 통로이며 화면 처리가 이미 있다. |
| CORS | `localhost:5173/5174`, `app://.`, `file://`만 허용한다. |

> 결론: 두 시스템 모두 **사번만 알면 로그인되는 구조**다. 연동이 새 구멍을 만들지는 않지만, 연동 경로에 **WorkBench 세션을 실제로 확인하는 단계**를 넣어 지금보다 나빠지지 않게 한다.

---

## 2. 자동 로그인 — 일회 코드 교환 (권장)

```
[WorkBench 화면] ──POST /api/logbook/launch (WB Bearer)──▶ [WB 백엔드]
                                                          일회 코드 발급(30초, 1회용, 메모리)
[WorkBench 화면] ◀── {url: http://<host>:9095/sso?code=…&next=/e/E000123}
        │ open-app-window(windowKey='hitess-logbook')
        ▼
[LogBook 창] GET /sso?code=… ──▶ [LogBook 백엔드] ──POST /api/logbook/redeem {code}
                                                     (헤더 X-Integration-Secret)──▶ [WB 백엔드]
                                                  ◀── {employee_id} (코드 즉시 소멸)
                    LogBook 세션 발급 → 작은 HTML이 localStorage['logbook_token'] 저장 → next로 이동
```

- URL에는 **30초짜리 일회 코드만** 실린다. WorkBench 토큰도 LogBook 토큰도 주소창·기록에 남지 않는다.
- 공유 비밀키는 두 서버의 `.env`에만 둔다. 이름은 WB `LOGBOOK_INTEGRATION_SECRET`, LB `LOGBOOK_WB_INTEGRATION_SECRET`이다. **값은 사용자가 직접 넣는다**(agent는 .env를 읽거나 쓰지 않는다).
- LogBook은 교환 뒤에도 기존 `wb_users` 확인(활성·등급)을 그대로 탄다. 자동 로그인했다고 등급이 바뀌지 않는다.
- 이미 LogBook 창에 같은 사람의 토큰이 있으면 그대로 쓰고, **다른 사람의 토큰이면 덮어쓴다**(PC를 같이 쓰는 경우).
- 대안: LogBook이 WB의 `GET /api/session/context`로 WB 토큰을 직접 확인하는 방법도 있다. 다만 WB 토큰을 URL에 실어야 해서 **권장하지 않는다.**

---

## 3. 모델 가져오기 — 두 방식 비교

두 방식 모두 **실제 파일은 서버끼리 옮긴다.** WorkBench 화면이 LogBook에서 직접 내려받지 않는다.
이렇게 하면 CORS가 필요 없고, 큰 BDF도 브라우저 메모리를 거치지 않으며, DRM도 기존 서버 경로와 같다.

```
WB 백엔드  POST /api/logbook/import {ref, target:'GroupModuleUnit'}  (WB Bearer)
   └─ LB 백엔드 GET /api/integration/files/{id}/content?as=<사번>  (공유 비밀키)
        · LogBook 권한을 '그 사번'으로 검사한다(LV1이 공유되지 않은 모델을 가져오지 못하게).
   └─ userConnection/<ts>_<사번>_GroupModuleUnit/<원본파일명>.bdf 로 저장
   └─ 응답 {bdfServerPath, source:{entry:'E000123', fileId, name, sha256, revision:'R2'}}
WB 화면  기존 handoffBdfPath / gmuHandoff 경로를 그대로 탄다(검증 → Studio).
```

### 방식 A — LogBook 창에서 골라 보내기
1. GMU 첫 화면에서 [Hi-TESS LogBook에서 가져오기]를 누른다. LogBook 창이 `?pick=bdf&target=gmu&slot=<작업번호>`로 열린다.
2. LogBook은 **선택 모드 띠**를 보여 준다. 예: "WorkBench GMU 작업 2에 보낼 BDF를 고르세요". BDF 파일 행·모델 뷰어·판 흐름 줄에 [WorkBench로 보내기] 버튼이 생긴다.
3. 버튼을 누르면 WorkBench로 알린다. 통로는 두 가지다.
   - **A-1 (권장): Electron 다리.** LogBook 창에 전용 preload를 붙여 `window.hitessBridge.sendModel({fileId, slot})` 하나만 노출한다. main은 **발신 origin이 LogBook 주소일 때만** 메인 창에 `logbook:model-picked`를 보낸다. → **WorkBench exe를 다시 빌드해야 한다.**
   - **A-2: 서버 우편함.** LogBook이 WB 백엔드에 "사번 X가 slot 2에 file 4512를 골랐다"를 남기고, GMU 화면이 2초 간격으로 확인한다. exe를 다시 빌드할 필요는 없지만 폴링과 대기 상태가 생긴다.
4. 이벤트를 받은 GMU 탭은 `/api/logbook/import`를 호출하고 `gmuHandoff`로 받는다. 받은 탭으로 화면을 옮기고, LogBook 창은 그대로 둔다.

장점: 미리보기·판 비교를 보면서 고를 수 있다. 단점: Electron 수정(또는 폴링)이 필요하고 구현량이 가장 많다.

### 방식 B — 번호 붙여 넣기
1. LogBook 상세·뷰어에 **[번호 복사]**를 둔다. 파일 단위 번호를 새로 만든다.
   - 제안: `E000123-F4512`(Entry 번호 + 파일 id). 사람이 읽기 쉽고 Entry만 따로 떼어 써도 된다.
   - 판을 고정하고 싶을 때만 파일 번호를 쓰고, `E000123`만 넣으면 **최신판**으로 해석한다.
2. GMU 첫 화면에 `LogBook 번호` 입력칸과 [불러오기]를 둔다.
   - WB 백엔드 `GET /api/logbook/resolve?ref=`가 LB의 `/api/integration/resolve`를 거쳐 **후보 목록**을 돌려준다.
   - 후보마다 이름·판·호선·절점/요소 수·SOL·썸네일·INCLUDE 경고를 보여 준다.
   - 후보가 1개면 바로 확인 카드를 띄우고, 여러 개(한 Entry에 모델 시리즈가 여럿)면 고르게 한다.
3. 확인하면 `/api/logbook/import`를 호출한다(방식 A와 같은 함수).

장점: Electron 수정이 없고 웹만으로 동작하며, 메일·메신저로 번호를 주고받을 수 있다. 단점: 창을 오가며 복사·붙여 넣기를 해야 한다.

### 권장 순서
**B를 먼저, A는 그다음이다.** B의 `resolve`·`import` 백엔드가 A에서도 그대로 쓰이므로 버리는 작업이 없다.
A의 통로는 처음부터 A-1(Electron 다리)로 간다. WorkBench는 작업 탭이 이미 Electron 변경을 요구하므로 다음 exe 배포에 함께 싣는다.

---

## 4. 단계별 구현 계획

| 단계 | 내용 | LogBook | WorkBench | 배포 영향 |
|---|---|---|---|---|
| **18-1** | 자동 로그인 창 | `GET /sso`(코드 교환·토큰 심는 HTML), 설정 `LOGBOOK_WB_API_URL`·`LOGBOOK_WB_INTEGRATION_SECRET` | `POST /api/logbook/launch`·`/redeem`(메모리 일회 코드), 사이드바/런처에 [Hi-TESS LogBook] 메뉴 → `open-app-window` | 프런트·백엔드만 바꾼다(exe 그대로) |
| **18-2** | 통합 API | `/api/integration/resolve`·`/files/{id}/content`(비밀키 + `as` 사번으로 권한 검사, read 바이트 스트림) | `GET /api/logbook/resolve`, `POST /api/logbook/import`(userConnection에 저장, `GUARDED_ROUTES` 등록) | 같음 |
| **18-3** | 방식 B 화면 | [번호 복사] 버튼, `E…-F…` 번호를 해석하는 라우트(`/f/E000123-F4512` → 뷰어) | GMU 첫 화면 입력칸·후보 카드·출처 표시(`handoffSource='Hi-TESS LogBook'`), `input_info.logbook_source` 기록 | 같음 |
| **18-4** | 방식 A 선택 모드 | `?pick=` 띠·[WorkBench로 보내기] 버튼, `window.hitessBridge`가 있을 때만 버튼 노출 | LogBook 창 전용 preload, main의 origin 확인 후 `logbook:model-picked` 전달, GMU 탭 수신(**slot 일치**) | **exe 재빌드** |
| **18-5** | 거꾸로 기록(선택) | 파일 상세에 "WorkBench에서 사용됨"(언제·누가·어느 해석) | import 때 LB에 사용 기록 전송 | 백엔드만 |

---

## 5. 꼭 고려해야 할 사항

### 보안·권한
- **LogBook 권한을 그대로 지킨다.** import·resolve는 WB 사번을 `as`로 넘겨 `access.file_visible`/`entry_visible`로 검사하고, 볼 수 없으면 404를 돌려준다. 공유 비밀키는 "서버 신원"만 증명할 뿐 권한을 넓히지 않는다.
- 통합 API는 비밀키가 없으면 **항상 401**이다. 키가 비어 있으면(설정 누락) 통합 기능 전체가 꺼지게 한다(fail-closed).
- 일회 코드: 30초, 1회용, 메모리 보관이다. WB를 재시작하면 사라지는데 의도한 것이다. 발급은 **사람당 분당 횟수를 제한**한다.
- WB에서 로그아웃해도 LogBook 세션은 남는다(최대 8시간). LogBook은 이미 매 요청마다 WB `is_active`만 본다. 로그아웃까지 따라가려면 WB 로그아웃 때 LB에 세션 폐기를 알리는 기능이 필요하다(선택).
- `/sso` 응답은 `Cache-Control: no-store`, `Referrer-Policy: no-referrer`로 둔다(코드가 다른 곳으로 새지 않게).

### 모델 데이터
- **INCLUDE**: GMU는 BDF 1개만 받는다. `includes`/`missing`이 있는 모델은 처음에는 **가져오기를 막고 이유를 보여 준다.** 이후 선택지는 두 가지다. ① 서버에서 한 파일로 펼쳐 합치기 ② 폴더째 복사.
- **변환 전 모델**: LogBook 변환이 아직 안 끝난 파일은 정보(카드 수·썸네일)가 없다. 가져오기는 허용하되 "LogBook 미검사"로 표시한다. 검증은 어차피 GMU가 다시 한다.
- **판 선택**: Entry 번호만 넣었을 때 최신판 규칙은 `is_latest=1`이다. series가 없는 단일 모델은 `others`로 폴백한다. 시리즈가 여럿이면 자동으로 고르지 않고 사용자에게 고르게 한다.
- **출처 추적**: WB `analysis.input_info.logbook_source = {entry, fileId, name, sha256, revision, importedAt}`. 보고서·My Projects 상세에 "LogBook E000123 R2에서 가져옴"을 표시한다. 나중에 결과를 LogBook에 되올릴 때 이 정보가 연결 고리가 된다.
- **중복**: 같은 sha256을 같은 사람이 최근에 가져왔으면 다시 받지 않고 기존 사본을 써도 된다(최적화, 나중).
- **크기·시간**: 큰 BDF(수백 MB)도 스트리밍으로 받는다. WB→LB 요청 시간 제한은 넉넉히 잡고(예: 120초), 실패하면 "LogBook 연결 실패/권한 없음/파일 없음"을 구분해 보여 준다.

### 회사 DRM
- LogBook은 공유 폴더 파일을 `read()` 바이트로 보낸다. 이때 `drm_encrypted` 파일은 Content-Length를 빼야 한다(기존 `/content`와 같은 규칙, `to_long` 사용).
- WB는 받은 바이트를 `userConnection/`(로컬 C:)에 쓴다. 기존 업로드와 같은 경로라 Nastran·검증이 이미 이 상태를 다룬다. **실제 PC에서 받은 파일의 앞부분이 `HHIDRMC`가 아닌 평문인지** 18-2 실측 항목에 넣는다.

### WorkBench 화면 규칙
- **작업 탭**: 가져온 모델은 **요청을 보낸 탭(slot)**에만 들어간다. 방식 A 이벤트는 slot이 같아야 받는다(작업 탭 규칙: Studio 이벤트처럼 탭을 특정할 것). 그 탭이 그사이 다른 작업을 시작했으면 받지 않고 토스트로 알린다.
- 가져오기가 끝나면 기존처럼 "BDF 검증" 단계로 간다. 자동 실행은 대시보드 전달과 같은 규칙을 따른다(사용자 결정 필요).
- App Settings 게이트: 새 라우트 `/api/logbook/*`를 `GUARDED_ROUTES`에 넣을지 결정해야 한다(LogBook을 '점검 중'으로 내릴 수 있게).
- LogBook 주소: 테스트 중에는 `new URL(API_BASE_URL)`에서 포트만 9095로 바꾼다. 다만 **코드에 하드코딩하지 말고** WB 백엔드 설정 `LOGBOOK_BASE_URL`(기본값 = 같은 호스트:9095)을 `GET /api/logbook/config`로 내려준다. 정식 서버로 옮길 때 설정 한 줄만 바꾸면 된다.
- ⚠ `config.js`의 `DEFAULT_API_BASE_URL`은 개발용으로 바꿔 둔 상태다. 이번 작업에서도 커밋에서 뺀다.

### 운영·배포
- 개발 PC(70): WB 9091 ↔ LB 9095, 같은 MySQL(LB는 `hitessworkbench.users` SELECT만 한다). **WB DB에 새 테이블은 만들지 않는다**(일회 코드는 메모리에 둔다).
- 서버 145: 두 서비스가 같은 호스트에 있다. `git pull` 두 번, 비밀키를 양쪽 `.env`에 넣기, 재시작 두 번이 필요하다. 18-4 이후에는 WorkBench exe도 배포한다.
- LogBook이 꺼져 있으면 WB 메뉴는 "LogBook에 연결할 수 없습니다"를 보여 주고, GMU의 다른 입력 경로는 그대로 쓸 수 있다.
- 다른 BDF 앱(BDF Scanner, Truss Assessment, Side Passage, 해상 운송)으로 넓히기: `import`의 `target`만 늘린다. 화면은 `runFrame/`에 공용 `LogbookImportCard`로 둔다.

### 테스트(규칙 유지)
- LB: pytest를 `logbook_test`에서 순차로 돌린다. `sso`·`integration` 테스트를 추가한다(비밀키 없음 401, 권한 밖 404, LV1 공유만, 일회 코드 재사용 거부, 만료).
- WB: `launch`·`redeem`·`import`·`resolve` 단위 테스트를 추가하고, LB는 가짜 서버(httpx mock)로 대신한다. **실제 `hitessworkbench`·`logbook` DB에는 붙지 않는다.**
- 실화면: 시험 스택(LB 9096 + WB 시험 백엔드)을 Playwright로 돌려 메뉴→자동 로그인→번호 입력→GMU 검증 시작까지 확인한다. Electron 다리(18-4)는 exe 빌드 후 사용자 PC에서 직접 확인한다.

---

## 6. 사용자 결정 (2026-10-08)
1. **방식 A(골라 보내기)로 간다.** [WorkBench로 보내기]는 **WorkBench를 통해 들어온 LogBook 창에서만** 보인다.
   브라우저로 직접 접속하면 보이지 않는다. 판단 기준은 Electron이 그 창에만 붙이는 `window.hitessBridge`가 있는지 여부다.
   방식 B(번호 입력)는 이번 범위에서 뺀다.
2. **모델을 가져오면 바로 BDF 검증을 시작한다.**
3. **진입점은 GMU 권상 화면 하나뿐이다.** 외부 앱 런처(Block Weld 등)나 사이드바 메뉴는 만들지 않는다. GMU에서 결과를 보고 다른 앱으로 넓힐지 정한다.
4. **WorkBench에서 로그아웃하면 LogBook도 로그아웃된다.** 세션을 폐기하고 LogBook 창도 닫는다.
5. INCLUDE가 있는 모델은 가져오기를 막는다(권장안 채택. 사용자가 따로 다르게 말하지 않았다).

## 7. 인터페이스 계약 (두 저장소가 같이 지킨다)

### 설정(.env — 값은 사용자가 직접 넣는다. agent는 .env를 읽거나 쓰지 않는다)
| 쪽 | 이름 | 기본 | 뜻 |
|---|---|---|---|
| WB | `LOGBOOK_INTEGRATION_SECRET` | 빈 값 → 연동 꺼짐 | 서버 간 공유 비밀키 |
| WB | `LOGBOOK_BASE_URL` | 빈 값 → 요청 Host의 호스트명 + `:9095` | 사용자 창이 여는 주소 |
| WB | `LOGBOOK_INTERNAL_URL` | `http://127.0.0.1:9095` | WB 서버가 LB 서버를 부르는 주소 |
| LB | `LOGBOOK_WB_INTEGRATION_SECRET` | 빈 값 → 연동 꺼짐 | 같은 비밀키 |
| LB | `LOGBOOK_WB_API_URL` | `http://127.0.0.1:9091` | LB 서버가 WB 서버를 부르는 주소 |

서버 간 요청은 헤더 `X-HiTESS-Integration: <비밀키>`를 쓰고 `hmac.compare_digest`로 비교한다. 비밀키가 비어 있으면 받는 쪽은 404를 돌려준다(경로를 숨긴다).

### WB 백엔드 (`/api/logbook/*`)
- `POST /api/logbook/launch` (WB Bearer) `{target?: "gmu"|"truss", slot?: 1..4}` (truss 는 단일 화면이라 slot 이 항상 1) → `{url, windowKey: "hitess-logbook"}`
  - 일회 코드: `secrets.token_urlsafe(32)`, 30초, 1회용, 메모리에 둔다. 보관 값은 employee_id, `wb_ref = sha256(WB 토큰) hex`, WB 세션 만료 시각이다.
  - 사람당 분당 10회까지. 비밀키가 없으면 503 `logbook_integration_disabled`.
  - url = `{base}/sso?code=…[&target=gmu|truss&slot=N]`
- `POST /api/logbook/redeem` (비밀키) `{code}` → `{employee_id, wb_ref, wb_expires_at}`. 코드는 즉시 소멸하며, 없거나 만료되면 404 `code_invalid`.
- `POST /api/logbook/import` (WB Bearer) `{file_id: int, target: "GroupModuleUnit"|"TrussAssessment"}`
  - LB `GET /api/integration/files/{id}/content?as=<사번>&target=<gmu|truss>`을 불러 `userConnection/<YYYYMMDD_HHMMSS>_<사번>_LogBookImport/<파일명>`에 저장한다. 같은 폴더에 `logbook_source.json`도 남긴다.
  - 응답 `{bdfServerPath, fileName, entryId, fileId}`
  - 오류: LB 404 → 404 `logbook_file_not_found`, 409 → 409 `logbook_has_includes`(본문 detail 이 `target_not_allowed` 면 409 `logbook_target_not_allowed` + LB `message` 그대로), 415 → 415 `logbook_not_bdf`, 연결 실패 → 502 `logbook_unreachable`
- WB 로그아웃(`/api/logout` 계열)은 세션을 폐기한 뒤 **백그라운드로** LB `POST /api/integration/logout {wb_ref}`를 부른다. 실패해도 WB 로그아웃은 성공으로 끝난다.

### LB 백엔드
- `GET /sso?code=&target=&slot=` (SPA보다 먼저 등록) — target = gmu(slot 1..4) | truss(slot 1 로 맞춤)
  - WB redeem을 부른다 → 로그인과 같은 절차(wb_users 확인, ensure_local_user)를 밟는다 → 세션을 만든다(`wb_ref` 저장, 만료 = min(지금+session_hours, wb_expires_at)).
  - 응답은 작은 HTML이다(`Cache-Control: no-store`, `Referrer-Policy: no-referrer`). 이 HTML은 다음을 한다.
    - `localStorage.logbook_token`을 세팅한다.
    - `sessionStorage.logbook_wb = {target, slot}`을 저장한다.
    - `location.replace('/')`로 이동한다.
  - 실패하면 안내 HTML을 보여 준다("WorkBench에서 다시 열어 주세요"와 /login 링크).
- `user_sessions.wb_ref` VARCHAR(64) NULL, 색인. ensure_columns로 자동 추가된다.
- `POST /api/integration/logout` (비밀키) `{wb_ref}` → 해당 세션을 모두 지운다 → `{revoked: n}`
- `GET /api/integration/files/{id}/content?as=<사번>[&target=gmu|truss]` (비밀키) — target 은 다음 단계의 대상별 분류 검사용(지금은 무시). 거절 시 409 `target_not_allowed`(+`message`)
  - 그 사번의 권한(`_file`·`access.file_visible`)으로 검사한다. 볼 수 없으면 404.
  - `kind=='model'`이 아니면 415. `includes`가 비어 있지 않으면 409.
  - read 스트림으로 보내고, 헤더에 `X-LogBook-Entry`, `X-LogBook-File-Name`(URL 인코딩), `X-LogBook-Sha256`을 싣는다. DRM 파일은 Content-Length를 뺀다.
  - 감사 기록 `WB_EXPORT`를 남긴다.

### Electron (WorkBench)
- `open-app-window`에 옵션 `bridge: "logbook"`을 추가한다. 이때만 전용 `electron/logbook-preload.js`(contextIsolation)를 붙인다.
  - 노출하는 것: `window.hitessBridge = { version: 1, sendModel(payload) → Promise<{ok, message}> }`
- main `ipcMain.handle('logbook:send-model')`의 처리 순서:
  1. 발신 창이 LogBook 창이고, 발신 프레임의 origin이 그 창을 연 URL의 origin과 같은지 확인한다.
  2. payload를 검증한다: `{target:'gmu'|'truss', slot:1..4, fileId:int, entryId, name}` (truss 는 slot 1 로 맞춤).
  3. requestId를 붙여 메인 창에 `logbook:model-picked`를 보낸다.
  4. `logbook:model-picked-result`를 15초 기다린다. 성공하면 메인 창을 앞으로 가져온다.
- `close-app-window {windowKey}`를 추가한다. WB 로그아웃 때 `hitess-logbook` 창을 닫는다.

### 화면
- **WB GMU 첫 화면**: [Hi-TESS LogBook에서 가져오기] → `launch {target:'gmu', slot: 작업 번호}` → `open-app-window`
  - 브라우저 개발 모드에서는 `window.open`을 쓴다(다리가 없으므로 보내기 버튼도 없다).
  - 가져오기 이벤트는 slot이 같은 탭만 받는다. 탭이 진행 중이면 거절하고 사유를 회신한다.
  - 받으면 import → `handoffSource='Hi-TESS LogBook'` → **BDF 검증 자동 시작**
- **LB**: `window.hitessBridge`와 `sessionStorage.logbook_wb`가 둘 다 있을 때만 다음을 보인다.
  - 상단 선택 띠: "WorkBench · GMU 권상 작업 N에 보낼 BDF를 고르세요"
  - BDF(`kind=='model'`) 파일 행과 모델 뷰어의 [WorkBench로 보내기] 버튼
  - 결과(성공·거절 사유)는 토스트로 보여 준다.
  - WB에 연결된 세션이 401이 되면 "WorkBench에서 로그아웃되어 LogBook도 로그아웃되었습니다" 안내를 띄운다.

## 8. 18-b — 앱별 보내기 제한(분류 규칙) · Truss 확장 (2026-10-08 사용자 결정)

### 결정
- **모델 내용 검사(카드 수 규칙)로 막지 않는다.** 모델 종류가 늘어나면 앱마다 규칙을 세우기 어렵다.
  대신 **LogBook 분류(구역·태그)로 제한**한다.
- 규칙은 **LogBook 관리자 화면에서 LV3가 정한다.** 'WorkBench 앱(target) → 필요한 구역/태그'를 등록하며, 코드를 고치지 않고 화면에서 추가할 수 있다.
- 조건에 맞지 않는 모델은 **목록에 그대로 둔다.** [WorkBench로 보내기]만 비활성으로 하고 사유를 보여 준다(예: "태그 'Truss'가 필요합니다").
  태그를 붙이면 바로 보낼 수 있다.
- 초기 규칙: **Truss Structural Assessment(target `truss`)는 태그 `Truss`(동의어 포함)가 있어야 한다.** GMU(`gmu`)는 제한하지 않는다.

### 동작
- 규칙은 Entry 단위다. Entry의 구역 또는 태그 가운데 **하나라도** 규칙 값과 같으면 통과한다(OR). 비교는 동의어 묶음의 대표값 기준이다.
  규칙이 없거나 비어 있으면 제한하지 않는다.
- 화면: 선택 띠에 조건을 함께 보인다. 버튼의 사용 가능 여부는 서버 판정(`eligible`)을 쓴다.
- **서버에서도 강제한다.** WB import가 `target`을 함께 보내면 LB `/api/integration/files/{id}/content?as=&target=`가 같은 규칙을 검사한다.
  맞지 않으면 409 `target_not_allowed`, WB는 409 `logbook_target_not_allowed`로 돌려준다.
- 규칙을 바꾸면 감사 기록을 남긴다. registry.json에도 남긴다(재구축 원천).

### 확장 — Truss Structural Assessment (2026-10-08)
- 대상 `truss` 추가. WB Truss 화면(단일 화면, 작업 탭 없음 → slot 1 고정)의 [Hi-TESS LogBook에서 가져오기] → `launch {target:'truss', slot:1}`.
- LB 선택 띠: "WorkBench · Truss Structural Assessment에 보낼 BDF를 고르세요"(GMU 문구는 그대로). 성공 토스트 "WorkBench · Truss Structural Assessment로 보냈습니다".
- Electron: 응답이 없을 때 문구가 대상별 — truss = "WorkBench의 Truss Structural Assessment 화면이 열려 있지 않습니다. 화면을 연 뒤 다시 보내 주세요."
- WB Truss 화면: 해석 중이면 거절("Truss 해석이 진행 중입니다. 끝난 뒤 다시 보내 주세요."), 아니면 import(`TrussAssessment`) → 입력 교체 → **BDF 파싱 후 바로 해석 시작** → "Truss Structural Assessment로 가져와 해석을 시작했습니다."
- GMU·Truss 두 화면이 같은 `logbook:model-picked` 를 듣고, 자기 target 이 아니면 회신 없이 무시한다.
- 모델 종류 제한(Truss 에 Unit 모델이 가지 않게)은 내용 검사가 아니라 LB 분류(구역/태그)로 한다(설계 예정). WB 는 그 검사를 위해 content 요청에 `target` 을 붙이고 409 `target_not_allowed` 를 `logbook_target_not_allowed` 로 전달한다.

### 구현 (18-b, 2026-10-08)
- 표 `wb_target_rules`(target PK · zones JSON · tags JSON · updated_by · updated_at), create_all 로 자동 생성.
  알려진 대상·라벨·판정은 `backend/app/wb_targets.py` 한 곳(`TARGETS` — 새 앱은 여기 한 줄).
- 기본 규칙: API 시작 때 `truss` 행이 **없을 때만** `{tags:["Truss"]}` 를 넣는다(비워 두면 다시 넣지 않는다). 이때 registry 는 쓰지 않는다
  (빈 DB 로 막 뜬 서버가 재구축 전에 registry 를 덮지 않게). 규칙 변경(WB_RULE_SET)은 감사 + registry `wb_target_rules`, 재구축이 되살린다.
- 판정: 구역은 분류 목록 대표 용어, 태그는 동의어 묶음 대표값으로 바꾼 뒤 `vocab.key`(공백 제거·대소문자 무시)로 비교, OR.
  Entry 에 속하지 않은 파일은 규칙이 있으면 거절.
- API: `GET /api/wb-targets`(대상·규칙·띠 문구) · `POST /api/wb-targets/{target}/eligible {entry_ids}`(볼 수 없는 Entry 는 뺌, 200개 상한)
  · `GET/PUT /api/admin/wb-targets[/{target}]`(LV3, 구역은 목록 용어만 — 아니면 422 zone_not_listed).
- content: 모르는 target 422 `unknown_target`(입력 오류라 맨 앞) → 404 → 415 → 409 has_includes → 409
  `{"detail":"target_not_allowed","message":사유}`(최상위 — JSONResponse).
- 화면: 관리 › WorkBench 연결 규칙(`/admin/wb-targets`). 보내기 버튼은 Entry 별 판정을 같은 틱에 모아 한 번에 묻는다(`lib/wbTargets.js`).
  판정 요청이 실패하면 버튼을 켜 둔다(서버가 다시 막는다). 선택 띠는 조건 문구 + 창이 열린 첫 검색 화면에 규칙 첫 값(태그 우선)으로
  검색 필터를 한 번 켠다(검색 필터는 속성마다 값 하나·AND 라 OR 규칙을 그대로 옮길 수 없다 — 나머지 조건은 띠에서 안내).

## 9. 19 — WorkBench → LogBook 보내기 (WB 관리자 'All Projects', 2026-10-13)

18 은 LogBook → WorkBench(모델 가져오기) 방향이었다. 19 는 반대 방향이다. WB 관리자가 모든 사용자의 해석 기록을 보는
`ADMINISTRATION > All Projects` 에서 의미 있는 모델의 파일을 골라 LogBook 으로 보낸다.

### 결정 (사용자, 2026-10-13)
- 전송 = 서버끼리 연동 API(공유 비밀키). `00_Inbox` 폴더 복사는 올린 사람·출처가 남지 않아 쓰지 않는다.
- 보낸 파일은 **보낸 관리자 이름의 '정리 대기' 묶음**이 된다. 제목·호선 정리와 확정은 LogBook 에서 평소처럼 한다.
- 보낼 파일은 관리자가 체크해서 고른다(처음엔 아무것도 체크하지 않는다). 보내면 WorkBench 가 LogBook 추가 창(정리 대기)을 바로 띄운다.

### LB 백엔드 (`/api/integration/uploads*`, 헤더 `X-HiTESS-Integration`, 쿼리 `as=<보내는 사번>`)
| 메서드·경로 | 내용 |
|---|---|
| `POST /api/integration/uploads` | `{name, origin}` → `{key, state:'uploading'}`. origin(분석 ID·원 사번·App·메모)은 감사 `WB_UPLOAD` 에만 남긴다 |
| `PUT /api/integration/uploads/{key}/chunk?path=&offset=` | 크롬 업로드와 같은 8MB 조각. 첫 조각이 `HHIDRMC` 면 422 `drm_encrypted` |
| `POST /api/integration/uploads/{key}/finish` | `{files:[{rel_path,size}], rejected:[...]}` → `{key, state: staged\|blocked, blocked, deferred}`. 완전 동일 BDF 는 받지 않는다(force 없음) |
| `DELETE /api/integration/uploads/{key}` | 반쯤 올라간 묶음 지우기(실패 시 WB 가 부른다) |

- `as` 는 WorkBench 에서 **활성 관리자**여야 한다(403 `sender_not_admin`). LogBook 에 처음 오는 관리자면 사번 로그인과 같은
  절차(`auth.admit`)로 행을 만든다. 업로드 처리 자체는 `uploads.service` 를 그대로 쓴다(source='web').
- `/sso?next=inbox` — 자동 로그인 뒤 정리 대기 화면을 연다. 허용 목록(`SSO_NEXT_PATHS`) 밖은 첫 화면.
- 테스트: `tests/test_wb_upload_19.py`.

### WB 백엔드
- `GET /api/admin/projects`, `GET /api/admin/projects/{id}/files`, `POST /api/admin/projects/{id}/logbook`
  (`routers/admin_projects.py`, `services/admin_projects.py`). 보낸 기록 = 표 `logbook_exports`.
- 묶음 안 경로 = `<작업 폴더 이름>/<폴더 기준 상대 경로>`. 이름 기본값 = `WB #<id> · <App> · <원 사번>`.
- `POST /api/logbook/launch` 에 `next:'inbox'` 를 주면 위 `/sso?next=inbox` 주소를 준다.

### 배포
LogBook 을 먼저 올린다(`git pull` + 재시작). LogBook 이 옛 버전이면 WB 는 404 를 받아
"LogBook 서버에 보내기 기능이 없거나 연동이 꺼져 있습니다" 로 알린다. 공유 비밀키 설정은 18 과 같다(추가 설정 없음).
