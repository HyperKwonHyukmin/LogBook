# 22 — 보고서 전체 본문 색인·검색·근거 요약

작성 2026-10-12 · 상태: **구현 완료(테스트 통과), 커밋은 사용자** · 개정 1(2026-10-12, 아래 '개정' 절 — 초안은 Codex)

저장소: `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\999_LogBook`. 원본에는 쓰지 않고, 확정 자료의 Vault 보고서만 색인한다.
폴더에 직접 넣은 미등록 파일은 기존 Inbox 등록·확정 흐름을 거쳐야 검색 대상이 된다.

## 0. 목표
보고서 화면(`/reports`, 21)에서 보고서를 **본문까지**(그림 속 글자 OCR 포함) 찾고, 맞은 곳을 쪽·시트·슬라이드 위치로 보여 주며,
고른 보고서를 색인된 발췌만 근거로 요약한다. 보고서가 수백~수천 개가 되어도 검색 한 번이 수백 MB 를 읽지 않는다.

## 1. 화면 — 보고서 화면 안의 검색 방식(별도 메뉴 없음)
| # | 무엇 | 어떻게 |
|---|---|---|
| 1 | 검색 칸 | 보고서 검색어 + **검색 조건**(모든 단어 포함 AND · 하나 이상 OR · 입력 문구 그대로) + **[의미 추천 포함]** 체크(`retrieval=hybrid`). 검색어가 있고 정렬을 안 고르면 관련도순(키워드 일치 → 의미 추천). 소속·프로젝트(여러 값)·문서 분류·관련 모델·정렬은 21 그대로. 모두 주소에 남는다. |
| 2 | 결과 행 | 한 보고서 = 한 행. 검색어가 있으면 '키워드 일치' / '의미상 관련 추천' 표시, 원문 위치(쪽·이미지 본문·시트·행·슬라이드·노트·머리말·각주 …)가 붙은 발췌 최대 3개와 강조, 색인이 끝나지 않은 행은 '본문 색인: 대기·실패·일부 추출·갱신 대기·원본 없음'. 건수 줄 = 전체 · 키워드 일치 · 의미 추천(관련 후보 일부). |
| 3 | 색인 상태 띠 | 내가 볼 수 있는 보고서 기준 완료/전체, 일부 추출·대기·실패·갱신 대기, 최근 색인 시각, 의미 추천 준비 수(서버 연결 여부와 실제 벡터 수를 구분). **화면이 보일 때만 1분마다** 묻는다(숨은 탭은 멈추고 다시 보이면 한 번). 색인을 쓸 수 없으면 '제목·자료 정보와 기존 본문 추출로만 찾는다'고 알린다. |
| 4 | 안내 | "이 화면의 검색은 그림 속 글자(OCR)까지 찾는다. 상단 전체 자료 검색은 OCR 본문을 찾지 않아 결과가 다를 수 있다 — OCR 포함 본문 검색은 보고서 화면에서." |
| 5 | 근거 요약 | 미리보기 패널의 **[이 보고서 근거로 요약]**을 눌렀을 때만 요청한다(자동으로 LLM 을 부르지 않는다). 답변 + 인용 [S1]… 의 파일명·원문 위치·발췌. 색인이 없으면 '요약할 본문 색인이 없음', 몰리면(429) '이미 요약 중' / '다른 사용자의 요약이 진행 중 — 잠시 뒤'. 실패해도 원문 미리보기는 그대로. |
| 6 | 옛 주소 | `/report-search?…` 는 질의를 그대로 들고 `/reports?…` 로 옮겨 간다(`ReportSearchRedirect`). 좌측 메뉴의 '보고서 본문 검색'은 없앴다. |

## 2. 검색 구조
### 2-1. 한 곳에서 계산
`GET /api/reports` → `report_index.search.list_reports`. 21 의 목록과 22 의 본문 검색이 같은 함수다.
1. **목록·권한·메타데이터는 MySQL**: 기존 검색(파일 보기, 종류=보고서)을 검색어 없이 한 번 불러 볼 수 있는 확정·Vault 보고서 전체를 얻는다(권한 = `access.visible_entries_filter`, 13·15). 소속은 `report_catalog.scope_of` 한 곳(호선 > 프로젝트 > 공용 > 미분류). 문서 분류·관련 모델 수는 21 의 `meta_of`·`model_counts`.
2. **현재성**: 파일의 등록 SHA·상대경로·자료 pk·Vault 경로가 색인 문서와 모두 같아야 '현재'(`is_current`). 삭제·휴지통·이동·교체된 자료의 옛 본문은 쓰지 않는다(상태 '갱신 대기').
3. 검색어가 없으면 목록 그대로(21 과 같은 순서·건수).
4. 검색어가 있으면
   - **색인이 현재이고 상태가 ready/partial 인 보고서 → 22 색인으로 판정.** 검색어마다 후보 파일 = FTS 후보 ∪ 메타데이터(파일명·제목·설명·해석 종류·프로젝트·문서 분류·호선·태그)에 든 파일, AND 는 교집합·OR 은 합집합. 후보 파일의 **조각 본문만** 읽어 기존 규칙(`keyword_match`)으로 다시 판정한다: AND 는 서로 다른 조각·메타데이터 조합 허용, OR, 정확 구문, 숫자 경계(`3496` 은 `13496` 안에서 맞지 않음), `:part:` 조각을 겹침 없이 다시 이어 경계에 걸린 구문도 찾음.
   - **색인이 없거나(대기) 오래된(갱신 대기)·실패한 보고서 → 기존 검색(03a 본문 추출, MySQL ngram)과 메타데이터.** 색인 전에도 21 수준의 본문 검색이 된다. 기존 검색은 낱말 AND 규칙이라 OR 는 낱말마다(최대 8번) 부르고, 구문은 낱말 AND 로 근사한다(색인이 끝나면 정확해진다). 숫자 경계도 색인된 보고서에만 보장된다.
   - **의미 추천**(`retrieval=hybrid`): 키워드에 안 걸린 색인 보고서 중 같은 임베딩 모델(이름+digest) 벡터가 있는 것만, 유사도 ≥ `LOGBOOK_REPORT_SEMANTIC_THRESHOLD`(0.5)인 가장 가까운 조각, 거르기를 적용한 뒤 상한 `LOGBOOK_REPORT_SEMANTIC_LIMIT`(50)개. 관련 문서 전부를 보장하지 않는다(`semantic_exhaustive=false`). 키워드 결과는 이 상한과 무관하게 전수.
5. 거르기 → 건수(자기 칸만 빼고) → 정렬 → 쪽 자르기.

### 2-2. 색인 저장소(서버 로컬 SQLite, 스키마 2)
| 표 | 내용 |
|---|---|
| `documents` | 파일 하나의 색인 상태(ready·partial·failed·missing·removed), 등록 정보(metadata JSON), `chunk_count`·`vector_count`·`embedding_model`, 실패 백오프(`fail_count`·`retry_at`·`fail_key`), 임베딩 백오프(`embed_fail_count`·`embed_retry_at`) |
| `chunks` | `file_id, seq, locator, text, norm` — `norm` = NFKC·casefold 정규화 본문. **벡터는 여기 두지 않는다** |
| `chunk_fts` | `chunks.norm` 의 **FTS5 `trigram`** 외부 내용 표(본문을 두 번 저장하지 않음). 삽입·삭제 트리거로 동기화 |
| `vectors` | `chunk_id, file_id, model, dim, data` — **float32 리틀 엔디언 BLOB** |
| `index_meta` | `schema`·`fts`·`generation`(조각·벡터가 바뀔 때마다 +1) |

결정:
- **토크나이저 = `trigram`**: 한국어는 띄어쓰기·조사 때문에 낱말 토크나이저(unicode61)로는 부분 일치가 안 된다. trigram 은 3글자 이상 임의 부분 문자열을 찾는다(공백 포함 구문도). 검색어 앞 200자만 FTS 에 넣는다 — 조각이 256자씩 겹치므로 그 길이 이하 문자열은 반드시 한 조각 안에 있다(그보다 긴 구문은 앞부분으로 후보만 뽑고 조각을 이어 판정).
- **1~2글자 검색어**(한국어에서 가장 흔한 `응력`·`하중`): trigram 으로 찾을 수 없어 `instr(norm, ?)` 로 정규화 본문만 훑는다. 흔한 낱말은 어차피 대부분의 조각이 맞으므로 색인을 따로 두는 이득이 작고, 벡터는 읽지 않는다. 실측(아래 규모 시험): 2,000 보고서 전부에 있는 2글자 0.16~0.20초.
- FTS5 trigram 이 없는 SQLite(3.34 미만)에서는 모든 검색어를 instr 로 찾는다(정확하지만 느림, 상태 `fts=false`).
- **키워드 경로는 벡터를 절대 읽지 않는다**(테스트가 SQL 추적으로 고정).
- **의미 검색 = numpy 행렬곱 한 번**: `semantic_best` 가 (색인 세대·모델·차원)별 벡터 행렬을 API 프로세스에 들고 있고(float16, 상한 `LOGBOOK_REPORT_VECTOR_CACHE_MB`=512), 세대가 바뀌면 다시 읽는다. 상한을 넘는 큰 색인은 4,096행씩 읽어 곱하고 버린다. float16 캐시라 유사도 오차 ~1e-3.
- 권한은 매 요청 SQL — 색인을 복사하거나 공개 단계가 바뀌어도 색인을 믿지 않는다.

### 2-3. 기존 index.sqlite3(스키마 0, Codex 초안)
처음 열 때 **자동 이전**한다(한 트랜잭션, `BEGIN IMMEDIATE` — 워커·API 가 동시에 열어도 한쪽만): `documents` 에 열 추가, `chunks` 를 새 표로 옮기며 `norm` 계산, `chunks.vector`(JSON) 는 그 파일의 `embedding_model` 이 있으면 float32 BLOB 로 `vectors` 에 옮긴다(재임베딩 없음), FTS 를 채우고 건수를 다시 센다. 이전이 실패하거나 색인을 새로 만들고 싶으면 `python -m app.report_index.worker --rebuild`(옛 파일은 `.bak-시각`) — 공유 폴더 추출 캐시가 있으면 원본을 다시 추출하지 않는다(벡터는 다시 만든다).
- 개발 PC 의 Codex 색인(`backend/.report-search/index.sqlite3`, 실데이터 보고서 4개·104조각)은 이번 작업에서 **열지 않았다**(실데이터 접근 금지). 다음에 API·워커가 처음 열 때 위 규칙으로 이전된다. 145 에는 색인이 없다(새로 만든다).

## 3. 원문 추출 범위와 상태
- PDF: 쪽 글자 + 그림이 있거나 글자가 없는 쪽은 쪽 전체를 200dpi 로 그려 OCR(`page:N:ocr`).
- DOCX: OOXML 문단·표·글상자·머리말·꼬리말·각주·미주·주석, 포함 그림 OCR.
- XLSX/XLSM: 시트별 모든 행·셀의 수식과 저장된 계산 값(다시 계산하지 않는다), 주석, 그림 OCR. 차트 그림의 글자는 경고.
- PPTX: 슬라이드(표 포함)·발표자 노트(표시 순서 = presentation.xml 관계 순서), 그림 OCR.
- 구형 PPT: 임시 사본을 LibreOffice 로, 없으면 Windows PowerPoint COM(별도 프로세스·시간 제한)으로 변환. 둘 다 없으면 실패. 변환본은 늘 '일부 추출'.
- OCR = Tesseract `kor+eng`, JPEG-XR 은 Windows WIC 로 PNG 변환. 언어 데이터 폴더 = `LOGBOOK_REPORT_TESSDATA`, 비우면 **Tesseract 설치 폴더의 `tessdata`**(예전 초안은 gitignore 된 `backend/.report-search/tessdata` 에 기대고 있었다).
- 상태: 읽지 못한 부분이 있으면 `partial`, 원본이 없으면 `missing`, 처리 오류는 `failed`. 전체 완료로 둔갑시키지 않는다. 임베딩 실패는 본문 상태를 바꾸지 않는다(벡터 수로 따로 본다).

## 4. 증분 갱신과 운영
- 워커(`python -m app.report_index.worker --loop`)는 5분마다 등록 파일의 상태·경로·크기·수정 시각·등록 SHA·추출 조건을 보고 새로·바뀐 파일만 처리한다(주기당 25개, 오래 확인하지 않은 것부터). 24시간마다 내용 SHA 를 다시 잰다. DB 조회 실패를 빈 목록으로 보지 않는다(색인을 지우지 않는다).
- **실패 재시도 = 지수 백오프**: 5분 → 10분 → 20분 … 최대 24시간. 실패 열쇠(추출기 판·추출 조건·등록 SHA·경로·확장자·크기·수정 시각)가 바뀌면 바로 다시. 백오프 중인 파일은 배치 개수에 세지 않는다.
- **벡터만 빠진 파일**: 임베딩 서버가 살아 있으면 원본을 다시 읽지 않고 색인된 조각으로 벡터만 채운다(실패하면 같은 백오프).
- **작업 스케줄러 등록**(05 와 같은 방식): `ops/install-tasks.ps1` 이 세 번째 작업 **`Logbook Report Index`**(`ops/run-report-index.ps1`)를 시작 시 실행으로 등록한다. 스크립트 안 루프가 끝난 워커를 60초 뒤 다시 띄우고, 로그는 `backend/logs/report-index-console.log`. 초안의 `ops/run-report-search.ps1`(사용자 로그인 세션에서 숨은 프로세스로 띄우던 방식)은 없앴다 — 재부팅·로그아웃에 의존하지 않는다.
- `GET /api/reports/index-status` 의 Ollama 확인(`/api/tags`)은 **60초 캐시**(성공·실패 모두). 워커는 주기마다 새로 확인한다.
- 근거 요약은 **사용자당 동시 1건 · 전체 2건**(`LOGBOOK_REPORT_RAG_CONCURRENCY`) — 넘치면 429 `rag_busy_user` / `rag_busy`. ⚠ Ollama(`127.0.0.1:11434`)는 **WorkBench AI(qwen2.5:7b)와 같은 서버를 함께 쓴다.**
- 설치·환경 변수·초기 색인 소요는 `ops/README.md` 13절.

## 5. API
| 경로 | 설명 |
|---|---|
| `GET /api/reports?q=&mode=and\|or\|phrase&retrieval=keyword\|hybrid&scope=&project=&document_type=&model=yes\|no&sort=recent\|title\|relevance&limit=&offset=` | 21 의 목록 + 본문 검색. 응답 = 21 필드(`total, items, projects, no_project, scopes, document_types, applied`) + `index_available`. 검색어가 있으면 `keyword_total, semantic_total, semantic_available, semantic_error(코드), semantic_limit, semantic_exhaustive=false`. 항목에 `index_state`(pending·stale·ready·partial·failed·missing, 색인을 못 열면 null)·`match_type`(keyword·semantic)·`score`·`snippets[{file_id,name,locator,text,highlights}]`(최대 5). |
| `GET /api/reports/index-status` | 내가 볼 수 있는 보고서의 `total, ready, partial, pending, failed(원본 없음 포함), missing, stale, last_updated(ISO UTC), embedding_available, embedding_ready, index_available`. 경로·오류 문구는 주지 않는다. LV3 는 `index`(전역 건수·조각·벡터·백오프 대기·FTS·워커 마지막 주기)를 더 받는다. |
| `POST /api/reports/answer` `{question, q?, file_ids?(≤20), retrieval?}` | 근거 요약. 권한·현재성을 다시 확인하고 최대 16발췌·10,000자(고른 보고서의 일반 요약은 처음·중간·끝 표본). 응답 `{answer, citations[{id,file_id,name,entry_id,locator,text}], truncated, scope_note}`. 답변의 [S#] 가 준 발췌문인지만 확인한다(모든 사실의 자동 검증은 아니다). 볼 수 없는 선택 404 `report_not_found`(존재를 숨김) · 색인 없음 422 `no_indexed_sources` · 동시 상한 429 · 모델 장애·잘못된 인용 503 `rag_unavailable`. |

21 의 `/api/reports/{file_id}/catalog`(GET·PUT)는 그대로. 초안의 `/api/report-search`·`/status`·`/answer` 는 이 경로로 합쳤다(배포된 적 없음 — 옛 경로는 404).

## 6. 개정 (2026-10-12)
Codex 초안을 검토한 결과대로 고쳤다.

| 바꾼 것 | 이유 |
|---|---|
| 검색: 요청마다 볼 수 있는 모든 보고서의 모든 조각 + 1024차원 벡터(JSON TEXT)를 읽어 파이썬 루프로 키워드·코사인 계산 → **FTS5 trigram 후보 + 후보 파일 조각만 재판정**, 키워드는 벡터를 읽지 않음, 벡터는 **float32 BLOB** 별도 표 + numpy 행렬곱(세대별 캐시) | 수천 보고서면 요청 하나가 수백 MB 를 읽었다(키워드 모드에서도). 판정 규칙(AND 조합·OR·구문·숫자 경계·`:part:` 잇기)은 그대로 두고 후보만 줄였다. |
| 스키마 0 → 2 자동 이전(+`--rebuild`) | 이미 만든 색인·벡터를 버리지 않게. |
| 메뉴 '보고서 본문 검색'(`/report-search`, `ReportSearchPage`) → **보고서 화면 안의 검색 방식**, 옛 주소는 리다이렉트 | 같은 보고서를 두 화면에서 다른 규칙으로 찾았다. 소속·프로젝트·문서 분류·모델 연결·미리보기가 한 화면에 있어야 한다. |
| API `/api/report-search` 와 21 `/api/reports` 중복 → **`/api/reports` 하나**(검색 계산 `report_index.search.list_reports`), 상태·요약은 `/api/reports/index-status`·`/api/reports/answer` | 목록·거르기·건수 계산이 두 벌이었다. 소속 파생은 `report_catalog.scope_of` 한 곳만 쓴다. |
| 색인이 없는 보고서: 메타데이터만 → **기존 검색(03a 본문)으로 대신** | 색인 워커가 아직 안 돌았거나 색인을 못 열 때도 21 수준의 본문 검색이 되게. 프런트의 `/reports` 대체 호출은 없앴다. |
| 워커: 사용자 세션 숨은 프로세스(`run-report-search.ps1`) → **작업 스케줄러 `Logbook Report Index`**(`run-report-index.ps1`, 05 방식) | 재부팅·로그아웃에 살아남게. |
| 실패 파일을 매 주기 다시 처리(배치 자리를 차지) → **지수 백오프**(5분~24시간, 바뀌면 즉시) · 벡터만 빠진 파일은 조각으로 임베딩만 | 깨진 파일 몇 개가 매 5분 원본 복사·추출을 되풀이하며 새 보고서를 밀어냈다. 임베딩 서버가 꺼졌을 때도 매 주기 원본을 다시 읽었다. |
| 상태 API 가 요청마다 Ollama `/api/tags` 호출 + 모든 조각·벡터 읽기 → **60초 캐시 + 문서 행만**(`chunk_count`·`vector_count`) · 프런트 폴링 30초 → **화면이 보일 때만 60초** | 탭마다 HTTP·수백 MB 읽기. |
| 요약 동시 실행 제한 없음 → **사용자당 1 · 전체 2 · 429** | Ollama 를 WorkBench AI 와 나눠 쓴다. |
| OCR 언어 데이터: gitignore 된 `backend/.report-search/tessdata` → **`LOGBOOK_REPORT_TESSDATA`, 기본 Tesseract 설치 폴더** | 145 에는 그 폴더가 없다. |
| 임베딩 실패 시 본문 상태를 `partial` 로 낮춤 → 본문 상태 유지, 벡터 수로 따로 | '일부 추출'은 본문을 다 못 읽었다는 뜻이어야 한다. |
| 테스트 `backend/report_index_tests/`(SQLite 로 MySQL 엔티티 흉내) → **`tests/test_report_index_22.py`**(logbook_test, conftest) | 저장소 규칙. 색인 자체는 원래 SQLite 라 임시 폴더 SQLite. Ollama·Tesseract 는 모의, 색인 경로·Ollama 주소는 conftest 가 임시/닫힌 포트로. |
| 영어 주석·경고 문구 → 한국어 | 저장소 규칙. |
| 빌드 출력 `C:/Coding/WorkBench/.codex/report-search-build` → `frontend/dist` | 저장소 규칙(다른 저장소에 쓰지 않는다). 초안이 만든 그 폴더는 이번에 건드리지 않았다(지워도 된다). |

## 7. 범위와 제한
- **메인 검색(`/`)과 결과가 갈릴 수 있다**: 메인 검색은 03a 본문 추출(MySQL)만 보고 OCR 본문을 찾지 않는다. 이번에는 메인 검색에 22 색인을 넣지 않고 보고서 화면에 안내만 했다(하지 않은 것).
- 색인 전·갱신 대기 보고서의 OR·구문·숫자 경계는 기존 검색 규칙(근사)이다.
- 의미 추천은 상한·임계값이 있는 '추천'이다. 같은 보고서 안 여러 조각 중 가장 가까운 하나만 발췌로 보인다.
- OCR 은 글자 인식 오류가 있을 수 있다 — 원문(미리보기)으로 확인한다.
- 색인은 서버마다 따로다. 추출 캐시는 추출 조건(도구 경로·언어 데이터)이 같을 때만 다시 쓴다.

## 8. 바뀐 곳
- 백엔드: `app/report_index/`(`config.py` 설정·tessdata·캐시 상한·요약 동시 수 · `embeddings.py` 60초 확인 캐시·float32 · `store.py` 스키마 2·이전·FTS5·벡터 BLOB·백오프·`semantic_best` · `search.py` `list_reports` 한 곳 · `worker.py` 백오프·벡터만 채우기·`--rebuild` · `extractors.py` tessdata·한국어) · `app/routers/reports.py`(목록·`index-status`·`answer`·`RagGate`) · `app/routers/report_search.py` 삭제 · `app/main.py` · `.env.example`.
- 프런트: `pages/ReportsPage.jsx`(+test — 검색 조건·의미 추천·상태 띠·발췌 위치·요약·`ReportSearchRedirect`) · `pages/ReportSearchPage.jsx`(+test) 삭제 · `App.jsx` · `components/shell/SideNav.jsx`(+test) · `lib/reportLocator.js`(+test, 그대로).
- 운영: `ops/run-report-index.ps1`(신규) · `ops/install-tasks.ps1`(세 번째 작업, `-SkipReportIndex`) · `ops/run-report-search.ps1` 삭제 · `ops/README.md` 13절.
- 테스트: `tests/test_report_index_22.py`(33건) · `tests/conftest.py`(색인 경로·Ollama 주소·캐시 비우기) · `backend/report_index_tests/` 삭제.

## 9. 테스트
- `tests/test_report_index_22.py`(33건): 판정 규칙(AND 조합·OR·구문·숫자·`:part:`), 추출기 4종(+tessdata 설정·기본값), FTS 후보(3글자 이상·1~2글자·NFKC), 벡터 BLOB·원자적 교체, **스키마 0 이전(벡터 보존)**, 벡터 캐시 세대 무효화·나눠 읽기·모델 digest 분리·임계값, 워커(증분·실패 시 이전 색인 유지·**백오프 두 배·변경 즉시**·원본 없음·**벡터만 채우기**·임베딩 실패 상태 유지·DB 장애 시 정리 안 함·백오프 파일이 배치를 막지 않음·잠금), 임베딩 검증·**60초 확인 캐시**, API(검색 규칙 전부·**키워드 경로 벡터 미사용(SQL 추적)**·색인 없음/오래됨 → 기존 검색·권한은 SQL·거르기/건수/쪽(81건 전수)·의미 추천/임계값/장애·색인 없음·상태(날짜·관리자 전용·경로 미노출·캐시)·요약 권한/근거/인용 검증·**429 사용자/전체**·옛 경로 404), **규모**.
- **규모 시험**(합성 2,000 보고서 × 3조각 = 6,000조각, 1024차원 float32 = 24.6MB 벡터, 개발 PC): 희귀어(5글자) 0.006초·최대 메모리 0.3MB(벡터 안 읽음) · 모든 보고서에 있는 2글자 0.16~0.20초(2,000건) · 의미 검색 첫 요청(행렬 적재+곱) 0.10초 · 캐시 0.02초. 상한(느슨): 2초 / 10초 / 10초 / 2초, 메모리 20MB. 초안 구조였다면 요청마다 조각 6,000개 + JSON 벡터 약 120MB 를 읽었다.
- 21 `tests/test_reports_21.py` 22건 그대로 통과(목록·검색어 결합은 색인 없는 경로 = 기존 검색).
- 프런트 `pages/ReportsPage.test.jsx`(19건 — 21 의 9 + 22 의 10: 키워드/의미 구분·발췌 위치·강조, 의미 추천 토글, 서버 장애 문구, 상태 띠·행 상태·OCR 안내, 색인 불가 안내, 문구 조건+반복 프로젝트, 명시적 요약·근거, 429 안내, 옛 주소 리다이렉트, 화면이 보일 때만 폴링) · `SideNav.test.jsx` · `reportLocator.test.js`.

```powershell
# backend (logbook_test, 순차)
.\.venv\Scripts\python.exe -m pytest tests/test_report_index_22.py tests/test_reports_21.py -q
# frontend
npx vitest run src/pages/ReportsPage.test.jsx src/components/shell/SideNav.test.jsx src/lib/reportLocator.test.js
npm run build    # frontend/dist
```

## 10. 145 반영
1. **설치**(한 번, `ops/README.md` 13-1): Tesseract + `kor`·`eng` 언어 데이터(설치 폴더 `tessdata`, 다른 곳이면 `.env` 의 `LOGBOOK_REPORT_TESSDATA`) · `ollama pull bge-m3:latest`(요약은 WorkBench 가 쓰는 `qwen2.5:7b`) · (구형 PPT 가 있으면) LibreOffice 또는 PowerPoint.
2. `git pull` → `backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt`(numpy 등 — 새 패키지 없음).
3. **API·워커 재시작**(`ops/README.md` 9절). DB 표·열 변경은 없다(색인은 SQLite). 프런트 dist 는 커밋본.
4. **색인 워커 등록**: 관리자 PowerShell 에서 `ops\install-tasks.ps1 -User <도메인\계정>`(세 작업 모두 다시 등록 — 비밀번호 세 번) → `Start-ScheduledTask -TaskName 'Logbook Report Index'`.
5. **초기 색인 확인**: `backend` 에서 `.venv\Scripts\python.exe -m app.report_index.worker --status`(documents·chunks·vectors 증가, `worker.last_error` 없음), 보고서 화면 상태 띠(완료 수 증가·의미 추천 준비), 로그 `backend\logs\report-index-console.log`. 보고서가 많으면 처음에만 `LOGBOOK_REPORT_BATCH_SIZE=200`·`LOGBOOK_REPORT_INTERVAL=60`(13-2).

기술 참조: [Ollama 임베딩 API](https://docs.ollama.com/api/embed), [Ollama 채팅 API](https://docs.ollama.com/api/chat), [SQLite FTS5 trigram](https://sqlite.org/fts5.html#the_trigram_tokenizer).
