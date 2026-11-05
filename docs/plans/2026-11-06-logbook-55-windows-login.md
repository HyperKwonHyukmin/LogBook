# 55 — Windows 계정 자동 로그인(사번만 로그인 닫기)

상태: 1·2단계 구현(2026-11-06). 3단계(145 에서 다른 PC 크롬 확인)·4단계(사번 로그인 닫기) 남음.

## 구현 결과 (2026-11-06)

- 백엔드: `app/windows_auth.py`(WorkBench 이식 — Negotiate 상태·NTLM 이름 읽기·사번 대응·횟수 제한), `app/login_page.py`(`/sso` 와 같이 쓰는 토큰 심기 HTML·`safe_next`), `routers/auth.py` 의 `GET /api/auth/options`·`POST /api/auth/windows`·`GET /auth/windows`, `LOGBOOK_AUTH_MODE`·`LOGBOOK_WINDOWS_LOGIN`·`LOGBOOK_AD_DOMAIN`, health 의 `storage.root` 제거.
- 프런트: 로그인 화면이 options 를 읽어 Windows 로그인을 쓸 수 있으면 한 번 자동으로 `/auth/windows?next=<원래 경로>` 로 간다. `?windows=<사유>`(방금 실패)·로그아웃 직후(`logbook_logout_reason=logged_out`)에는 자동으로 가지 않고 [Windows 계정으로 로그인] 단추를 보인다. 사번 칸은 `employee_id_login` 일 때만.
- **로그인 화면 단순화(2026-11-06 사용자 의견)**: 화면에는 Windows 이야기를 꺼내지 않고 "사번 칸 + [로그인]" 만 둔다. [로그인]은 `/auth/windows?employee_id=<입력한 사번>` 으로 가고, 이 PC 의 Windows 계정이 그 사번과 다르면 403 `windows_account_mismatch`(남의 PC 에서 그 PC 주인으로 들어가지 않게, WorkBench 와 같음). 처음 들어올 때의 자동 시도는 사번 없이 그대로 하고, Windows 확인을 못 쓰는 서버(`windows: false`)는 예전 사번 로그인으로 보낸다.
- 테스트: `tests/test_windows_login_55.py`(가짜 SSPI 20건), `LoginPage.test.jsx` 7건 추가. `/sso` 이동 주소는 JSON 으로 넣게 바뀌어 18·19 테스트의 기대 문자열만 고쳤다.
- **실제 SSPI 확인(개발 PC, 같은 PC 안)**: 시험 서버(`10.133.122.70:19095`, `LOGBOOK_AUTH_MODE=windows`, 저장소는 임시 폴더)에서
  - `curl.exe --negotiate -u : -X POST …/api/auth/windows` → A476854 토큰. 사번만 `POST /api/auth/login` → 403.
  - 크롬 `--headless=new` 새 프로필로 `/hulls` 를 바로 열면 입력 창 없이 로그인되어 그 화면이 열렸다. `/login?windows=windows_account_not_employee` 는 사유와 단추만 보이고 사번 칸이 없다.
- **의존성 취약점(`pip-audit`, 2026-11-06)**: 18개 중 4개에 알려진 취약점이 있다. 이번 커밋에서는 올리지 않았다(별도 단계로 올리고 전체 테스트).
  - `pillow` 12.3.0 → 13.0.0(39건, 올린 그림·보고서 그림을 연다)
  - `python-multipart` 0.0.22 → 0.0.31(10건, 업로드 본문을 해석한다)
  - `cryptography` 46.0.4 → 50.0.0(13건)
  - `python-dotenv` 1.2.1 → 1.2.2(2건)

## 왜

2026-11-06 보안 점검에서 가장 큰 문제가 나왔다. `POST /api/auth/login` 에 사번만 보내면 토큰이 나온다. 관리자 사번이면 LV3 권한(삭제·분류 일괄 변경·사용자 관리)까지 얻는다. 사번은 비밀이 아니다(명함·메일 주소·결재선에 있다).

이 구조를 둔 이유는 "WorkBench 도 사번만이라 LogBook 만 막아도 `/sso` 로 우회된다"(2026-10-20 결정)였다. 그런데 WorkBench 는 2026-11-03~05 보안 테스트 지적을 받고 바뀌었다. 145 에서 AD 로그인(`AUTH_MODE=ad`)과 Windows 통합 인증(`POST /api/login/windows`)을 쓰고, 사번만 보내면 401 이다. 지금은 LogBook 이 WorkBench 인증을 돌아가는 뒷문이다.

WorkBench 와 같은 방식으로 막는다. **PC 에 로그인한 Windows 계정(HHI\사번)으로 자동 로그인하고, 사번만 로그인은 닫는다.** 사용자는 크롬에서 주소를 열면 비밀번호 없이 그대로 들어온다.

## 가능성 시험 (2026-11-06, 개발 PC)

- pywin32 `sspi.ServerAuth("Negotiate")` 로 만든 작은 서버를 `10.133.122.70:18777`(개발 PC 자신의 IP)에 띄웠다. 설치된 크롬 `--headless=new` 와 임시 프로필로 열었다.
  - 결과: 크롬이 **입력 창 없이** NTLM 을 보냈다(`TlRMTVNTUAAB…` → `…AAD…`). 서버가 받은 계정은 `HHI\A476854`, 방식은 NTLM 이었다.
  - 이 PC 크롬 정책에는 `AuthServerAllowlist` 가 없다. 정책을 더 넣지 않아도 된다는 뜻이다.
- **남은 불확실성:** 서버와 크롬이 같은 PC 였다. 다른 PC(145)를 IP 주소로 열 때도 크롬이 자동으로 보내는지는 3단계에서 확인한다. 안 되면 아래 '안 될 때'로 간다.
- WorkBench 기록: 145 는 도메인 가입 PC 이고, IP 로 부르면 NTLM, FQDN 으로 부르면 Kerberos 로 확인됐다(WorkBench `RecordMD/2026-11-05-https-certificate-pinning-plan.md`). 크롬 시험 기록은 없다(Electron·.NET 만 시험).

## 설계

### 서버 — `app/windows_auth.py` (WorkBench `services/windows_auth.py` 이식)

- `sspi.ServerAuth("Negotiate")` 하나로 NTLM 과 Kerberos 를 모두 받는다. pywin32 는 이미 `requirements.txt` 에 있다(312).
- 핸드셰이크
  - Authorization 이 없으면 `401 + WWW-Authenticate: Negotiate` 를 준다.
  - `SEC_I_CONTINUE_NEEDED` 이면 `401 + Negotiate <토큰>` 을 준다.
  - 0 이면 완료다.
  - 실패 응답에는 `WWW-Authenticate` 를 다시 주지 않는다. 다시 주면 크롬이 같은 실패를 되풀이한다.
- **NTLM 3단계 상태**: 진행 중인 SSPI 객체를 `(클라이언트 IP, 포트)` 키로 메모리에 30초 둔다. 상한은 전체 500개, IP 당 10개다.
  - API 는 uvicorn 프로세스 하나다(`server_manager.py` `API_CMD`, `--workers` 없음). 이 전제를 코드 주석과 이 문서에 못 박는다. 워커를 늘리면 깨진다.
- **사번 대응**
  - 계정 이름(`SECPKG_ATTR_NAMES`)이 `<도메인>\<이름>` 형태다. 도메인이 `LOGBOOK_AD_DOMAIN`(기본 `HHI`)이고 이름이 `EMPLOYEE_ID_PATTERN`(`^[A-Z][0-9]{5,7}$`, WorkBench 와 같음)에 맞을 때만 대문자 사번으로 쓴다.
  - 로컬 계정·다른 도메인·공용 계정은 403 `windows_account_not_employee` 이다.
- **횟수 제한**
  - 사번당 15분 4회, IP 당 20회(WorkBench 와 같은 값)를 둔다.
  - NTLM 3번째 메시지에 평문으로 든 `DOMAIN\user` 를 먼저 읽어 SSPI(도메인 컨트롤러)에 묻기 **전에** 건다. 틀린 응답이 DC 로 가면 그 직원의 회사 계정 실패 횟수가 오르기 때문이다.
  - 누구인지 모르는 실패는 IP 키로 센다. 제한에 걸리면 429 `too_many_attempts` 이고, 성공하면 그 사번의 횟수를 비운다.
- 통과하면 기존 `auth.admit()` 을 그대로 밟는다. WorkBench 표 활성 확인 → 로컬 행 맞추기 → 감사 기록 → 세션 순서다. 권한 규칙(15·31)은 바뀌지 않는다.
- 토큰·NTLM 메시지는 로그에 남기지 않는다(`/sso` 와 같은 원칙).

### 경로

| 경로 | 쓰는 곳 | 성공 | 실패 |
|---|---|---|---|
| `GET /auth/windows?next=<내부 경로>` | 브라우저 최상위 이동(로그인 화면이 보낸다) | `/sso` 와 같은 토큰 심기 HTML → `next` 로 이동 | `/login?windows=<사유>` 로 보내는 작은 HTML(401 본문에 넣음) |
| `POST /api/auth/windows` (본문 없음) | 스크립트·관리 작업 — `curl.exe --negotiate -u : -X POST …` | `{token, user}` (`/api/auth/login` 과 같은 모양) | 401·403·429 + 사유 코드 |
| `GET /api/auth/options` | 로그인 화면 분기 | `{windows: bool, employee_id_login: bool}` | — |

- 브라우저는 **최상위 이동**으로 한다. fetch 로 부르면 교차 출처·본문 여부에 따라 자격 증명이 실리지 않을 수 있다. WorkBench Electron 40 에서 본문이 있는 요청은 NTLM 3번째 메시지가 나가지 않고 멈췄다. 최상위 이동이 크롬의 통합 인증이 가장 확실하게 붙는 방식이고, `/sso` 의 토큰 심기 HTML 도 그대로 다시 쓴다.
- `_success_page`·`_failure_page` 는 `integration.py` 에서 `app/login_page.py` 로 옮겨 `/sso` 와 같이 쓴다.
- `next` 는 지금 `SSO_NEXT_PATHS` 허용 목록뿐이다. 로그인 뒤 원래 보던 화면으로 돌아가야 하므로 내부 경로 검사로 넓힌다.
  - `/` 로 시작하고, `//`·`\` 로 시작하지 않고, 제어 문자가 없고, 길이 512 이하일 것.
  - 스크립트에는 `_js()` 로 넣는다.

### 모드 스위치 — `LOGBOOK_AUTH_MODE`

- `employee_id`(기본): 지금처럼 사번 로그인이 열려 있다. 개발 PC 와 pytest(사번 로그인을 쓰는 테스트 13개)가 그대로 돈다. Windows 경로도 같이 열린다.
- `windows`(145): `/api/auth/login` 이 403 `employee_id_login_disabled` 이다. 들어오는 길은 Windows 경로와 `/sso` 둘뿐이다.
- `LOGBOOK_WINDOWS_LOGIN=0` 이면 Windows 경로를 끈다. `import sspi` 가 안 되면 조용히 꺼지고 options 가 `windows: false` 를 준다.
- 서버 간 API(`/api/integration/*`, 공유 비밀키)와 내려받기 일회 링크는 바뀌지 않는다.

### 로그인 화면 — `frontend/src/pages/LoginPage.jsx`

- 토큰이 없고 options 의 `windows: true` 이면, 들어오자마자 `/auth/windows?next=<원래 경로>` 로 **한 번** 이동한다.
- 다시 시도하지 않는 경우(무한 이동 방지)
  - 주소에 `?windows=<사유>` 가 있을 때(방금 실패함)
  - 방금 로그아웃했을 때(`?out=1`)
- 실패하면 사유를 한 줄로 보인다. "이 PC 의 Windows 계정으로 확인하지 못했습니다" 다음에 [다시 시도] 단추와 "WorkBench 에서 LogBook 열기" 안내를 둔다.
  - 사번 입력 칸은 `employee_id_login: true`(개발 PC)일 때만 보인다.
- 로그아웃 단추는 `/login?out=1` 로 보낸다.

### 같이 고치는 보안 점검 항목

- `GET /api/system/health` 에서 저장소 경로(`storage.root`, UNC·개인 폴더 이름)를 뺀다. 로그인 없이 보이는 경로라서다. Server Manager 는 `ok`·`reachable` 만 쓰는지 확인한 뒤 뺀다.
- 백엔드 의존성 취약점: `pip-audit` 을 개발 PC venv 밖(`pipx run` 또는 임시 venv)에서 한 번 돌려 결과를 이 문서에 남긴다. 프런트 `npm audit --omit=dev` 는 0건이다(2026-11-06).

## 단계

1. **백엔드**: `windows_auth.py`·`login_page.py`·세 경로·모드 스위치·health 경로 제거를 한다.
   - pytest 는 `sspi.ServerAuth` 를 가짜로 바꿔 시험한다(핸드셰이크 2단계, 계정 대응, 다른 도메인 403, 횟수 제한 429, `windows` 모드에서 사번 로그인 403, `next` 검사).
2. **프런트**: 로그인 화면 자동 시도·실패 안내·로그아웃 `?out=1` 을 넣고 vitest → `npm run build` → dist 커밋.
3. **145 확인**(모드는 아직 `employee_id`): Update 뒤 아래를 확인한다(사용자 몫).
   - 내 PC 크롬에서 `http://10.14.42.145:9095/auth/windows` → 들어와지는지.
   - **다른 사람 PC 크롬 1~2대**에서 같은 확인을 하고, 감사 기록에 그 사람 사번으로 남는지 본다.
   - 개발 PC 에서 `curl.exe --negotiate -u : -X POST http://10.14.42.145:9095/api/auth/windows` → 토큰이 나오는지.
4. **닫기**: 145 `backend\.env` 에 `LOGBOOK_AUTH_MODE=windows` 를 넣고 Update 한다. 사번만 보내는 `curl` 이 403 인지 확인한다.
   - 같은 커밋에서 문서를 고친다. CLAUDE.md '로그인은 사번만' 규칙을 바꾸고, '145 데이터 검증' 의 로그인을 `curl --negotiate` 로 바꾼다(개발 PC 사용자 A476854 가 관리자라 그대로 된다).
   - README '145 서버' 의 `.env` 키 목록도 고친다.

## 안 될 때

- **3단계에서 다른 PC 의 크롬이 자동으로 보내지 않으면**(입력 창이 뜨거나 401 화면): 크롬은 인트라넷으로 보는 주소에만 자동으로 보낸다. 대응은 두 가지다.
  - FQDN(`HHIPW170658.HDShipGroup.HHI.co.kr:9095`)으로 열면 인트라넷으로 잡힐 수 있다. 145 Kerberos 도 이 이름에서 됐다.
  - 회사 그룹 정책 `AuthServerAllowlist` 에 주소를 넣는다(보안팀 요청이 필요하다).
  - 그동안은 `/sso`(WorkBench 에서 열기)가 우회로다. 4단계(닫기)는 이 문제가 풀린 뒤에 한다.
- **도메인 밖 PC·공용 PC**: 도메인 밖 PC 는 Windows 경로로 들어오지 못하고 `/sso` 만 된다. 공용 PC 는 그 PC 에 로그인한 Windows 계정으로 들어온다. WorkBench 와 같은 성질이라 받아들인다.
- **AD 비밀번호 로그인은 이번에 넣지 않는다.** 9095 가 평문 HTTP 라 비밀번호가 망에 그대로 실린다. 3단계에서 Windows 로그인이 안 되는 PC 가 많을 때만, HTTPS 와 묶어서 다시 정한다.

## 하지 않는 것 / 남은 위험

- **HTTPS 는 이번 범위가 아니다.** NTLM 은 비밀번호를 보내지 않지만, 로그인 뒤 토큰과 자료는 여전히 평문으로 오간다.
  - 크롬은 앱처럼 인증서 고정을 할 수 없다. 자체 서명 인증서는 경고가 계속 뜬다(WorkBench 는 회사 PC 신뢰 저장소를 건드리지 않기로 했다).
  - 사내 CA 인증서를 받을 수 있을 때 따로 계획한다.
- Microsoft 의 NTLM 단계적 폐지: FQDN + Kerberos 로 옮기는 길이 있다(위 '안 될 때').
- 횟수 제한은 프로세스 메모리에 둔다. API 를 다시 시작하면 초기화된다(WorkBench 와 같음).

## 관련

- 13 접근 제어, 15 WorkBench 사용자 표, 18 WorkBench 연동(`/sso`), 31 등급
- WorkBench: `HiTessWorkBenchBackEnd/app/services/windows_auth.py`, `app/routers/auth.py`(`login_windows`), `RecordMD/2026-11-05-https-certificate-pinning-plan.md`
