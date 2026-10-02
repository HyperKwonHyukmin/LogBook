# Logbook 디자인 시스템

`PRODUCT.md`(전략·보이스) 아래의 시각 규칙이다. 원본 토큰은 `frontend/src/index.css` 의 `@theme` 한 곳이고, 공용 컴포넌트는 `frontend/src/components/ui/` 에 있다. 방향은 **흰 작업면 + 옅은 청회색 크롬 + 헤어라인**이다. 카드로 감싸는 대신 여백과 선으로 위계를 만든다.

## 1. 토큰

### 색
색은 `@theme` 에서만 정의한다. Tailwind 기본 팔레트는 `--color-*: initial` 로 꺼 두었다. 그래서 `zinc-*` 같은 클래스는 아무것도 만들지 않는다.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `n-0` | #FFFFFF | 작업면(`<main>`), 떠 있는 표면 |
| `n-25` | #FBFCFD | 표 머리행, 아주 옅은 hover |
| `n-50` | #F7F8FA | 크롬(상단 바, 사이드 내비, 필터 열), 미리보기 바탕 |
| `n-100` / `n-150` | #F0F2F5 / #E8EBEF | hover / active 배경, 검색칸, 스켈레톤 |
| `n-200` | #E1E5EA | 헤어라인(구분선, 표, 패널) |
| `n-250` / `n-300` | #D3D9E0 / #BBC3CD | 입력 테두리 / 입력 hover, 분포 막대 |
| `n-400` | #8C95A3 | **아이콘 전용이며 글자에는 쓰지 않는다** |
| `n-500` | #646D7C | 메타 글자, 플레이스홀더(흰 바탕 5.2:1, 크롬 4.9:1) |
| `n-600` / `n-700` | #4B5362 / #353C49 | 보조 본문 / 섹션 제목 |
| `n-900` | #13171E | 본문 잉크 |
| `brand` | #002554 | Trust Blue: 주 버튼, 선택 글자, 링크 |
| `brand-hover` / `brand-press` | #0B3468 / #001C40 | 주 버튼 상태 |
| `brand-subtle` / `brand-muted` | #EEF2F8 / #DCE4EF | 선택 행, 활성 메뉴 / 선택+hover, 호선 칩 테두리 |
| `brand-ring` | #7F97B8 | 포커스 링 |
| `ok` / `ok-bg` | #007A30 / #EAF5EE | Heritage Green: **확정·연결됨에만** |
| `wait` / `wait-bg` | #A34A07 / #FDF3E7 | 미확정 |
| `err` / `err-bg` / `err-line` | #B42318 / #FDEEEC / #F4C7C1 | 오류, 위험 동작 |
| `hit` | #FFEDB3 | 검색 강조 `mark` |
| `k-pdf` · `k-ppt` · `k-xls` · `k-bdf` · `k-res` · `k-doc` (+`-bg`) | | 파일 종류 배지(옅은 바탕 + 진한 글자, 모두 AA) |
| `scrim` | rgb(19 23 30 / .30) | 대화상자·서랍 뒤 가림막(블러 없음) |

**표면은 네 층까지만 쓴다.** Chrome(`n-50`) → Surface(`n-0`) → Sunken(`n-25`/`n-50`, 표 머리·미리보기 바탕) → Raised(`n-0` + `shadow-md`/`lg`, 팝오버·메뉴·토스트·대화상자). 정적인 패널에는 그림자를 쓰지 않고 헤어라인만 쓴다.

### 모서리 · 그림자
- `rounded-xs` 3px(배지, mark), `sm` 5px(칩, kbd), `md` 6px(버튼, 입력, 행), `lg` 8px(패널, 표 틀, 메뉴), `xl` 12px(대화상자, 로그인 카드).
- `shadow-xs`는 버튼과 입력, `shadow-sm`은 미리보기 속 문서 페이지와 세그먼트 선택, `shadow-md`는 메뉴와 자동완성, `shadow-lg`는 대화상자와 토스트에 쓴다.

## 2. 글자

글꼴은 Pretendard Variable(sans)과 JetBrains Mono 400/500 두 가지다.

**모노 스택에 Pretendard 폴백이 있다.** 순서는 `"JetBrains Mono", "Pretendard Variable", Pretendard, ui-monospace, monospace` 이다. 그래도 **한글이 든 문자열에는 `font-mono` 를 걸지 않는다**(두 겹 방어). 모노는 Entry ID, 호선, 날짜, 크기, 경로의 라틴 부분에만 쓰고, 모노에는 `tabular-nums slashed-zero` 가 자동으로 붙는다.

| 토큰 | 크기/행간 | 쓰임 |
|---|---|---|
| `text-micro` | 11/16 | 배지 글자 |
| `text-meta` | 12/18 | 날짜, 사람, 위치표, 보조 설명 |
| `text-ui` | 13/20 | 메뉴, 버튼, 표 셀, 섹션 제목 |
| `text-body` | 14/22 | 본문, 결과 행 제목 |
| `text-title` | 20/28 | 페이지 제목(600, -0.012em) |
| `text-entry` | 22/30 | Entry 상세 제목(600, -0.015em) |
| `text-hull` | 28/32 mono | 호선 번호(500, n-900이며 파란색이 아니다) |

- 굵기는 400·500·600 세 가지만 쓴다(700 금지). 활성 메뉴도 굵기를 바꾸지 않는다.
- 섹션 제목은 13/600 n-700 한 줄로 쓴다. 대문자나 자간을 벌린 eyebrow는 쓰지 않는다.
- `body` 에는 `word-break: keep-all`(어절 단위 줄바꿈)과 `overflow-wrap: break-word` 를 건다. `anywhere` 는 쓰지 않는다. Chrome에서 버튼 같은 inline-flex 요소의 min-content 폭을 무너뜨려 "추 / 가"처럼 한 글자씩 끊긴다.

## 3. 레이아웃

- **셸**: 상단 바 48px(`n-50`, 하단선 없음)과 사이드 내비 208px(`n-50`, 테두리 없음)이 크롬 한 톤을 이룬다. `<main>` 은 `n-0` 에 `border-l border-t n-200 rounded-tl-lg` 로 크롬 안에 끼운 흰 작업면이다.
- **표준 컨테이너는 한 종류**: `Page` = `mx-auto max-w-[1200px] px-6 py-6`(1441px 이상에서는 `px-8`). 검색을 뺀 모든 화면이 이것을 써서 제목의 x 위치가 고정된다. 좁은 표(태그)도 컨테이너는 같게 두고 표만 `max-w-[880px]` 로 줄인다.
- **페이지 머리말**: `PageHeader` 는 제목 + 설명(`mt-1`) + 오른쪽 동작으로 이루어지고 아래에 헤어라인과 `mb-5` 를 둔다.
- **검색만 전폭 3-pane**이다. 필터(232px, `n-50`) | 결과(흰 면) | 미리보기(`clamp(360px,34vw,480px)`). 미리보기가 열리면 **1600px 미만에서 필터 열을 접고** 머리말의 `필터` 단추(서랍)로 바꾼다. 1366px에서 결과 열은 약 460px 이상 남는다.
- **Entry 상세**: 머리 아래를 `minmax(0,1fr) | 272px` 레일로 나눈다(1200px 미만에서는 한 열). 레일은 `76px | 1fr` 속성 격자와 변경 이력이다.
- **호선 화면**: 한 줄 요약 + 타임라인 | 272px 레일(분포, 참여자).

## 4. 컴포넌트

| 컴포넌트 | 파일 | 규칙 |
|---|---|---|
| 버튼 | `ui/Button.jsx` | sm 28 / md 32 / lg 36 / icon 32 / icon-sm 28. 변형은 primary · secondary · ghost · danger · danger-solid(확인 대화상자 안에서만). 비활성은 opacity가 아니라 색(`n-150`/`n-50` 바탕 + `n-500` 글자)으로 칠한다. `loading` 이면 스피너를 두고 `aria-busy` 를 켠다. |
| 입력 | `ui/Field.jsx` | `inputClass()` 는 h-8, `n-250` 테두리, hover `n-300` 이다. 포커스는 `.field` 가 `border-brand` 와 3px 옅은 링으로, 오류는 `aria-invalid` 에 따라 `err` 로 그린다. 라벨은 위쪽 12/500 n-600. |
| 탭 | `ui/Tabs.jsx` `Tabs` | 보기 전환(정리 대기, 사용자 상태, XLSX 시트)에 쓴다. 선택은 n-900 글자와 2px n-900 밑줄이며 **강조색을 쓰지 않는다**. ←/→ 로 옮긴다. |
| 세그먼트 | `ui/Tabs.jsx` `Segmented` | 값 전환(문서\|파일, 구역\|자유 태그, 로그인\|가입 신청)에 쓴다. 선택은 `n-0 + shadow-sm` 이며 **파란 채움을 쓰지 않는다**. |
| 상태 | `ui/Status.jsx` | `StatusDot` 은 6px 점과 글자로 표시한다(색만으로 구분하지 않는다). `DraftBadge`, `HullChip`(전역 1종: 흰 바탕, `brand-muted` 테두리, mono, 링크), `TagChip`(`n-100`). |
| 파일 배지 | `ui/KindBadge.jsx` | 파일 이름이 있으면 **확장자 라틴 대문자**(PDF/PPTX/XLSX/BDF/F06)를 sans 600으로 쓴다. 종류만 아는 Entry 행은 종류 라벨을 sans로 쓴다. 모노는 쓰지 않는다. |
| 인라인 편집 | `ui/InlineText.jsx` | "조용한 필드": 값 자체가 단추이고(키보드 진입 가능), hover 시 `n-100` 바탕과 연필 12px이 나타난다. 빈 값은 n-500 "추가"로 쓴다. 형식 힌트(YYYY-MM)는 편집 중 플레이스홀더로만 보인다. 저장에 성공하면 "저장됨"을 1.5초 보인다. ⚠ 단추에 `max-width:%` 를 주지 말 것(버튼은 compressible 이라 폭이 0으로 무너진다). |
| 칩 입력 | `ui/ChipInput.jsx` | `compact` 이면 평소에는 칩과 `+` 단추만 보이고, 누르면 그 자리에서 입력칸이 열린다. Esc를 누르거나 칸을 벗어나면 닫힌다. 자동완성은 `shadow-md` 팝오버다. |
| 메뉴 | `ui/Menu.jsx` | 계정 메뉴와 Entry `⋯` 동작 메뉴에 쓴다. ↑/↓, Esc, 바깥 누르기를 지원하고, 닫히면 포커스를 단추로 돌려준다. |
| 토스트 | `ui/Toast.jsx` | 하단 가운데 `n-900` 바탕, 36px 높이로 한 개만 띄운다. `되돌리기` 같은 동작 단추를 하나 둘 수 있고 5초 뒤 닫힌다. `role="status"`. |
| 확인 대화상자 | `ui/ConfirmDialog.jsx` `useConfirm()` | **되돌릴 수 없는 동작에만** 쓴다(초안 버리기, 가입 거절, 비활성화). 420px, `rounded-xl`, `shadow-lg`, `scrim` 을 쓰고 블러는 없다. 포커스를 가두고, Esc를 누르면 취소된다. |
| 빈 상태 | `ui/EmptyState.jsx` | 위쪽 정렬(`mt-12`)로, 20px 단색 아이콘(원 배경 없음), 14/600 제목, 13 설명으로 구성하고 필요하면 동작 하나를 둔다. |
| 스켈레톤 | `ui/Skeleton.jsx` | 실제 행 모양(제목 60%, 메타 40%, 발췌 90%)을 따른다. **300ms 뒤에 나타나고**(`.appear-late`) opacity로만 숨쉬며, 쉬머는 쓰지 않는다. |
| 페이지 틀 | `ui/Page.jsx` | `Page`, `PageHeader`, `ErrorNote`(err-bg 줄 + 선택적 `다시 시도`), `OkNote`, `SectionTitle`. |

### 목록과 표
- 틀은 `border n-200 rounded-lg overflow-hidden` 이고 그림자는 없다. 머리행은 h-8 `n-25` 12/500 n-500, 본문 행은 h-10에 13px이며 hover 시 `n-25` 로 바뀐다.
- 행 안의 부차 동작(복원, 동의어로 묶기, 풀기)은 ghost sm으로 두고 **행 hover나 focus-within 때만 보인다**. 터치(`hover:none`)에서는 늘 보인다.
- **검색 결과 행**은 제목(14/600)이 먼저 오고 오른쪽 끝에 날짜(mono)를 둔다. 둘째 줄은 호선 칩 · 구역 · 해석 종류 · 종류 배지이고 오른쪽 끝에 Entry ID(mono)를 둔다. 셋째 줄은 발췌(12, 2줄 clamp)다. 제목 일치는 제목 안 `mark` 로 보이므로 '일치:' 줄은 두지 않는다.
- **선택 상태**는 `bg-brand-subtle` 에 제목 `text-brand` 이고, 선택+hover는 `brand-muted/60` 이다. 목록에 키보드 포커스가 있으면 선택 행 **안쪽**에 2px `brand-ring` 윤곽을 그린다. 측면 색 띠는 쓰지 않는다.

### 미리보기
- **같은 정보는 한 화면에 한 번만** 보인다. 검색 미리보기에서는 파일 목록이 이름과 크기를 맡고, 미리보기 본문 위에 파일 머리줄을 다시 두지 않는다. 동작(내려받기, 경로 복사, 경로 끝부분)은 패널 하단 고정 바에 둔다. Entry 상세도 파일 목록 아래 미리보기 줄에는 크기와 동작만 둔다.
- 요약(`SummaryCard`)은 접히는 한 블록이다. 머리줄에 분량·작성자·작성일을 두고, **자료 제목이나 요약 제목과 같은 목차 항목과 표지 줄은 뺀다**.
- **PDF**는 불러오는 동안 A4 비율 자리 표시와 "PDF 여는 중…"을 보이고, iframe `load` 뒤에 걷는다. 브라우저의 PDF 보기가 꺼져 있으면(`navigator.pdfViewerEnabled === false`) 빈 흰 상자 대신 안내 한 줄과 `내려받아 열기` 를 보인다. 미리 볼 수 없는 모든 형식(DRM, 미지원, 본문 없음)도 같은 대체 상자를 쓴다.
- 문서 페이지(슬라이드 카드, PDF, 시트 표)는 `n-50` 바탕 위에 `n-0 + shadow-sm` 으로 띄운다.

### 사람 표기
사번보다 이름을 먼저 쓴다. 단, **API가 이미 준 이름만** 쓰고 API 필드를 새로 만들지 않는다. 쓰는 출처는 필터 건수의 `label`, 변경 이력의 `name`, 호선 참여자 `name`, 로그인한 나(`useAuth`)다. 이름을 모르면 사번을 mono로 쓰고, 이름을 쓸 때는 사번을 `title` 로 단다.

## 5. 상태 규칙
- 모든 상호작용 요소에 hover · focus-visible · active · disabled 상태를 둔다.
- 포커스는 전역 `:focus-visible` 2px `brand-ring`(offset 1)로 그리고, 입력은 `.field` 링으로 대신한다.
- 로딩: 첫 로딩은 모양을 따른 스켈레톤으로 보인다. 재검색은 목록을 흐리지 않고 머리말 아래에 2px 진행 줄을 둔다.
- 오류는 머리말 아래 `ErrorNote` 로 보인다(위치 고정, 가능하면 `다시 시도`).
- 휴지통으로 보내기는 복원할 수 있는 동작이라 **확인을 묻지 않는다**. 바로 보내고 토스트의 `되돌리기`(`POST /api/entries/{id}/restore`)로 되돌린다. 복원은 되돌릴 필요가 없는 동작이라 확인 없이 실행하고, 결과 줄에 `열기` 링크를 둔다.

## 6. 모션

| 대상 | 시간 | 이징 |
|---|---|---|
| hover·active 색 | 120ms | `--ease-out` cubic-bezier(.2,0,0,1) |
| 포커스 링 | 즉시 | |
| 팝오버·메뉴·자동완성 등장 | 140ms, opacity + translateY(-4px) + scale(.98) | out |
| 미리보기 패널, 필터 서랍 | 180ms, opacity + translateX(12px) | out |
| 토스트 | 180ms, opacity + translateY(8px) | out |
| "저장됨", 가림막 | 150ms, opacity | out |
| 스켈레톤 | 1.2s 반복, opacity 1↔.55 | in-out |
| 진행 줄 | 1s 반복, transform | linear |

- 폭이나 높이 같은 레이아웃 속성은 애니메이션하지 않는다. 행 선택 배경은 즉시 바뀐다.
- `prefers-reduced-motion: reduce` 에서는 모든 전환을 0.01ms로 줄이고, 스켈레톤은 opacity .7로 멈추며, 진행 줄은 고정 막대로 바꾼다.
- bounce·spring·overshoot 이징은 쓰지 않는다(y 값이 1을 넘는 cubic-bezier 금지).

## 7. 하지 말 것
1. 측면 색 띠(`border-l-2/4` 강조선)를 선택, 경고, 이력에 쓰지 않는다. 이력은 점 타임라인으로 그린다.
2. 그라데이션 글자, 그라데이션 배경·버튼을 쓰지 않는다.
3. glassmorphism(`backdrop-blur`, 반투명 흰 패널, 블러 모달 배경)을 쓰지 않는다.
4. hero-metric 카드(큰 숫자 + 작은 라벨)를 쓰지 않는다. 수치는 문장 한 줄로 쓴다(호선 화면 `자료 2 · 파일 4 · …`).
5. 같은 모양의 카드를 반복하는 그리드를 쓰지 않는다. 목록은 표나 행과 헤어라인으로 만든다.
6. 대문자 eyebrow와 `uppercase tracking-widest` 를 쓰지 않는다.
7. bounce·elastic 이징과 `animate-bounce` 를 쓰지 않는다.
8. UI 문구에 em dash(—)를 쓰지 않는다. 단, 빈 값을 나타내는 한 글자 기호 `—` 는 값 자리 표시로만 허용한다.
9. 한글 문자열에 `font-mono` 를 걸지 않는다. 굵기 700 이상과 opacity로 표현한 비활성도 쓰지 않는다.
10. 트러스트 블루를 장식(분포 막대, 세그먼트 채움, 탭 밑줄, 아이콘 원 배경)에 쓰지 않는다. 헤리티지 그린은 확정·연결 외에는 쓰지 않는다.
11. 정적인 패널에 그림자를 주지 않는다. 표면 층은 네 단계를 넘기지 않는다.
12. `window.confirm` 과 `alert` 를 쓰지 않는다. 복원할 수 있는 동작은 되돌리기 토스트로, 복원할 수 없는 동작만 `useConfirm` 으로 처리한다.
13. 이모지와 일러스트를 쓰지 않는다. 아이콘은 lucide 단색만 쓴다.
14. 같은 정보(파일명, 호선, 요약 제목)를 한 화면에 두 번 보이지 않는다.
15. 토큰 밖의 색(hex, Tailwind 기본 팔레트)을 컴포넌트에 쓰지 않는다. 새 색이 필요하면 `@theme` 에 먼저 추가한다.
