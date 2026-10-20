# Logbook 41 — Server Manager 가 보고서 색인 워커도 띄운다

**상태:** 완료 · 145 반영 확인(2026-10-20, 커밋 `4a633a8`·`14a69f0`)

## 왜

실사용 전 운영 점검(2026-10-20)에서 145 의 실제 시작 방식을 확인했다.

- 145 는 **Server Manager**(`backend/server_manager.py`, 시작 프로그램 바로가기)로만 돈다. 작업 스케줄러에 `Logbook*` 작업이 없다.
- Server Manager 는 API·Worker 둘만 띄웠다. 보고서 색인 워커(22, `app.report_index.worker --loop`)는 작업 스케줄러 작업으로만 띄우게 되어 있었다.
- 그래서 145 에서는 색인이 한 번도 돌지 않았다: `--status` → `documents: 0`. 문서 화면 검색은 색인 없는 옛 검색으로 대신 돌았고,
  그림 속 글자·쪽 위치 발췌·의미 추천·근거 요약은 쓸 수 없었다.
- 문서도 어긋나 있었다: `README.md` 는 "자동 시작 아직 안 됨", `ops/README.md` 는 작업 스케줄러가 기본인 것처럼 적혀 있었다.

## 결정

1. **Server Manager 를 145 의 기본으로 둔다.** Update 버튼·한 창 로그를 잃지 않는다. 작업 스케줄러 방식은 대안으로 문서에 남기고, 둘을 함께 쓰지 않는다.
2. **"재부팅 뒤 로그온해야 뜬다"는 받아들이고 문서에 적는다.** 145 재부팅이 드물어 작업 스케줄러로 옮기는 득보다 실이 크다.
3. Worker 와 색인 워커는 둘 다 HTTP 없이 프로세스 생존만 보므로 **한 틀(`BackgroundChild`)** 로 다룬다(코드 두 벌 금지). API 는 건강 확인 때문에 따로 둔다.
4. 일자별 로그 정리(30일)를 `uvicorn` 폴더만이 아니라 `worker`·`report-index` 폴더까지 넓힌다(전에는 `logs\worker\` 가 끝없이 쌓였다).
5. 백업 보강(공유 폴더 밖 사본·IT 스냅숏 문의)은 **하지 않기로** 했다(2026-10-20 사용자 결정). 공유 폴더에 '이전 버전'이 없음은 확인했다.

## 바뀐 것

| 파일 | 내용 |
|---|---|
| `backend/server_manager.py` | `INDEX_CMD`, `BackgroundChild`(이름·명령·로그 폴더·재시작 정책·화면 점), Worker 전용 메서드를 `_start_child`·`_stream_child`·`_on_child_exit`·`_schedule_child_restart`·`_child_restart_fire`·`_stop_child(ren)` 로. 창에 Index 점, 로그 색 `index`, 사건 이름 `index_start`·`index_crash`… |
| `backend/serverguard/events.py` | `prune_uvicorn_logs(..., subdir=)` — 다른 일자 로그 폴더도 정리 |
| `ops/README.md` | 머리·6절(Server Manager 기본, 6-2 작업 스케줄러 대안)·8절(옛 가입 승인 문구 → WorkBench 사번 로그인)·9절(Update 버튼)·13절 |
| `README.md` | '운영 참고' 의 자동 시작 문장 |

## 검증

- 개발 PC: 창 생성 시 Worker·Index 둘 다 시작 호출, 가짜 명령으로 Index 만 반복 종료시켜 `index_crash → index_start → index_restart_done` 이 Worker 와 따로 도는 것,
  `logs\report-index\YYYYMMDD.log` 기록을 확인. 화면은 눈으로 확인하지 않음(회사 PC).
- 145(사용자): **이번 한 번은 Update 뒤 Server Manager 창을 닫고 `Logbook_Server.bat` 로 다시 연다** — 떠 있는 Manager 는 옛 코드라
  Update 가 API·Worker 만 다시 띄운다. 다시 연 창에 Index 점이 초록인지, 몇 분 뒤 `.venv\Scripts\python.exe -m app.report_index.worker --status` 의 `documents` 가 늘어나는지.

## 후속 — 고아 Worker·Index 정리(2026-10-20)

145 첫 반영 때 Index 가 "다른 보고서 색인 워커가 이미 실행 중"(WorkerLock)으로 못 떴다. 잠금을 쥔 것은 08:56:23 에 뜬 색인 워커였고,
그 부모(옛 Server Manager, PID 33972)는 이미 없었다 — 창이 `_on_close` 없이 꺼지며 자식을 고아로 남겼다(콘솔 창 닫기·강제 종료로 추정).
API 는 `_kill_port` 로 옛 프로세스를 치우지만 Worker·Index 에는 그런 정리가 없었다.

- `_kill_strays(child)`: Worker·Index 를 띄우기 직전, **명령줄에 이 backend 경로와 같은 명령(`-m app.worker` / `-m app.report_index.worker --loop`)이 든
  python 중 이 창의 자손이 아닌 것**을 자손까지 끝낸다(venv `python.exe` 는 실제 python 을 자식으로 띄운다). 사건 `worker_stray_killed`·`index_stray_killed`.
  `--once`·`--status` 처럼 손으로 돌리는 명령은 명령줄이 달라 건드리지 않는다.
- 검증(개발 PC): 부모가 끝난 고아 한 쌍(실행기 + 실제 python)을 창 시작 때 끝내고, 창이 띄운 Worker 와 무관한 python 은 남는 것 확인.
- Update 는 창 메모리의 옛 코드로 다시 띄우므로, Server Manager 자체가 바뀐 업데이트는 창을 다시 열어야 한다(`ops/README.md` 9절).

## 145 반영 결과(2026-10-20)

- 다시 연 창이 고아 Worker(21396)·Index(19032)를 끝내고 셋 다 정상 기동. 옛 Worker 고아가 그때까지 함께 돌고 있었다.
- `--status`: 등록 보고서 10개 모두 색인(`documents: 10`, `chunks: 157`). 단 **10개 모두 `partial`**(Tesseract 없음으로 추정 — 그림 속 글자 빠짐),
  **`embedding_available: false`**(145 Ollama 에 `bge-m3` 없음 또는 꺼짐 — 의미 추천·근거 요약 불가, 키워드 검색은 됨).
  보고서가 10개라 급하지 않다. **과거 자료 대량 이관 전에** `ops/README.md` 13-1 로 갖춘다(확인: `tesseract.exe --list-langs`, `ollama list`).

## 실사용 전 점검에서 정한 다음 순서(2026-10-20)

41 은 실사용 전 점검(운영·복구 / 보안·권한 / 도입 준비)에서 나왔다. 사용자가 쓸모 있다고 고른 나머지는 이 순서로 한다.

1. **40 구역·대상 뜻 나누기** — 과거 자료 이관 전에. 이관 뒤에 하면 쌓인 분류값을 다시 옮겨야 한다.
2. **과거 자료 일괄 분류·일괄 확정 도구** — 지금 자동 추정은 호선뿐이고 구역·해석 종류는 카드마다 손으로, 확정도 한 건씩(`ingest/process.py`). 폴더 경로 규칙으로 분류 채우기 + 고른 초안 한꺼번에 확정. 40 다음.
3. **팀원용 한 장 안내** — 기능이 굳은 뒤. LV1 이 검색 0건일 때 등급 때문일 수 있다는 안내(`SearchPage.jsx` 빈 화면)도 함께.

하지 않기로 한 것: 로그인 본인 확인(아래 CLAUDE.md), 백업 보강(공유 폴더 밖 사본·IT 스냅숏 문의 — 공유 폴더 '이전 버전' 없음은 확인).
미뤄 둔 것(필요할 때): 내려받기·열람·로그인 감사 기록, `/api/audit` LV1 노출 축소, `/api/users/lookup` 의 등급 노출, 업로드 전체 크기 상한, 37 뺀 파일의 재구축 누락, 고아 파생물 정리.

## 145 첫 색인 참고

- 처음에는 보고서 전부를 추출한다(기본 5분마다 25개). 빨리 채우려면 `.env` 에 `LOGBOOK_REPORT_BATCH_SIZE=200`·`LOGBOOK_REPORT_INTERVAL=60` 을 넣고 Update(또는 Stop/Start All), 끝나면 지운다(`ops/README.md` 13-2).
- Tesseract 가 없으면 그림 속 글자만 빠지고('일부 추출'), Ollama 임베딩이 없으면 키워드 색인만 한 뒤 나중에 벡터를 채운다. 둘 다 멈추지 않는다.
