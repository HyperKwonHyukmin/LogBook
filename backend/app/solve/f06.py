"""f06 판정과 오류 유형 분류(06 §3) — 순수 함수.

판정: pass = f06 이 끝까지 쓰였고 FATAL 이 없다 / fail = `*** USER|SYSTEM FATAL MESSAGE` 가 있다 /
error = 모델 결함이 아니라 확인을 못 했다(Nastran 없음·라이선스·타임아웃·f06 없음·INCLUDE 누락).

메시지 형식은 MSC Nastran 2013.1 실측(이 PC, tests/fixtures/solve_f06/)과 WorkBench
`nastran_diagnostics.py` 를 따랐다 — 머리줄 `*** USER FATAL MESSAGE 9050 (SUBDMAP SEKRRS)` 뒤에 설명 줄이 온다.
같은 원인이 버전마다 코드가 다르다(RBE 종속 중복: 2013.1 = 5289 WRGMTD, 그 뒤 버전 = 2101 GP4).
"""
import re

_HEAD = re.compile(r"^\s*\*\*\*\s+(USER|SYSTEM)\s+(FATAL|WARNING)\s+MESSAGE\s*(\d+)?\w*\s*(.*)$", re.IGNORECASE)
_END = re.compile(r"\*\s*\*\s*\*\s+END OF JOB\s+\*\s*\*\s*\*")
_NEAR_LINE = re.compile(r"\bnear line \d+\s*$", re.IGNORECASE)
# 앞선 FATAL 때문에 따라 나오는 연쇄 메시지(WorkBench CASCADE_CODES) — 원인 FATAL 이 있으면 세지 않는다.
# 6624 IFP 요약·9002 BULK 오류 요약·208/102 입력 변환 실패, 경고 285 = 'FATAL 이 있었다'.
# 6498(API 그룹 오류)은 연쇄이면서 원인을 본문에 싣는다(실측: PBEAML H 단면 치수 오류 → 6498 본문에 6623 'HEIGHT,
# DIM3, CAN NOT BE LESS THAN WIDTH, DIM4' + 6624 + 9002 뿐). 다른 원인 FATAL 이 없으면 6498 을 원인으로 쓴다.
CASCADE_CODES = {6624, 9002, 208, 102}
CARRIER_CODES = {6498}
CASCADE_WARNINGS = {285}
LICENSE_CODES = {3060}
MAX_FATALS = 5
MAX_BODY_LINES = 10       # 6498 은 본문 7줄 뒤에 원인이 있다(실측)
MESSAGE_CHARS = 300
VERDICT_MESSAGE_CHARS = 500

# 로그·표준출력에서 라이선스 실패를 알아보는 문구(성공 로그의 'Checkout Successful'·'License files:' 는 안 걸린다)
_LICENSE_LOG = re.compile(
    r"checkout failed|licen[sc]e[^\n]{0,80}(not available|fail|denied|expired|unable|cannot|could not)"
    r"|(unable to|cannot|could not)[^\n]{0,40}(check ?out|obtain|acquire)[^\n]{0,40}licen[sc]e",
    re.IGNORECASE)

# 유형 키 → 판정 함수(대문자 본문, 코드). 위에서부터 처음 맞는 것.
_RULES: tuple[tuple[str, object], ...] = (
    ("rbe_dependent_dup", lambda t, c: c in (2101, 5289)
        or ("DEPENDENT" in t and ("MORE THAN ONCE" in t or "MORE THAN ONE" in t))),
    ("mechanism", lambda t, c: c == 9050 or "MECHANISM" in t or "MAXRATIO" in t
        or "EXCESSIVE PIVOT RATIO" in t),
    ("undefined_ref", lambda t, c: "UNDEFINED" in t or "NOT DEFINED" in t
        or ("REFER" in t and ("INVALID" in t or "NONEXISTENT" in t or "DOES NOT EXIST" in t))),
    ("bad_geometry", lambda t, c: any(k in t for k in (
        "BAD GEOMETRY", "ILLEGAL GEOMETRY", "WARP", "ZERO LENGTH", "ZERO AREA", "NEGATIVE AREA",
        "ZERO VOLUME", "NEGATIVE VOLUME", "JACOBIAN", "REPEATED AT LOCATIONS", "COINCIDENT"))),
    ("card_format", lambda t, c: c == 316 or c == 307 or any(k in t for k in (
        "ILLEGAL DATA", "FORMAT ERROR", "ILLEGAL REAL VALUE", "ILLEGAL INTEGER VALUE", "ILLEGAL CHARACTER",
        "ILLEGAL NAME FOR BULK DATA ENTRY", "ILLEGAL VALUE FOR FIELD", "IMPROPER FORMAT"))),
    ("property_value", lambda t, c: bool(re.search(r"\bMAT\w*\b|MATERIAL|PROPERTY|\bMID\s*=|\bPID\s*=", t))
        and bool(re.search(r">=|<=|\s[<>]\s|MUST BE|CAN ?NOT BE|LESS THAN|GREATER THAN|ILLEGAL VALUE|"
                           r"INVALID VALUE|NEGATIVE|NOT POSITIVE|OUT OF RANGE|ZERO", t))),
)


def classify(code: int | None, text: str) -> str:
    """FATAL 하나 → 유형 키(06 §3 표). 모르는 것은 other."""
    t = text.upper()
    for kind, rule in _RULES:
        if rule(t, code):
            return kind
    return "other"


def _messages(text: str) -> list[dict]:
    """f06 의 FATAL/WARNING 메시지 [{level, code, lines}] — 머리줄 + 뒤따르는 설명 줄(최대 MAX_BODY_LINES).
    본문 안의 `*** USER INFORMATION MESSAGE` 줄(6498 이 싣는 6623 등)은 본문으로 둔다.
    빈 줄·페이지 머리(1열 '1')·제어 줄(1열 '0')·`^^^` 줄에서 메시지가 끝난다."""
    found: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        head = _HEAD.match(raw)
        if head:
            current = {"level": head.group(2).lower(),
                       "code": int(head.group(3)) if head.group(3) else None, "lines": []}
            found.append(current)
            continue
        if current is None:
            continue
        body = raw.strip()
        if (not body or raw[:1] in ("1", "0") or body.startswith("^^^")
                or len(current["lines"]) >= MAX_BODY_LINES):
            current = None
            continue
        current["lines"].append(body)
    return found


def _first_message(lines: list[str]) -> str:
    """첫 설명 줄. 9994 류처럼 첫 줄이 'X with ID=… near line N' 뿐이면 다음 줄을 잇는다."""
    if not lines:
        return ""
    if lines[0].upper().startswith("API MESSAGE FOLLOWS"):
        # 6498: 'API MESSAGE FOLLOWS.' 다음의 정보 메시지 본문이 실제 원인이다
        body = [ln for ln in lines[1:] if not ln.startswith("***")
                and not ln.upper().startswith("USER INFORMATION: EVALUATOR")]
        return " ".join(" ".join(body).split())[:MESSAGE_CHARS] or lines[0]
    msg = lines[0]
    if _NEAR_LINE.search(msg) and len(lines) > 1:
        msg = f"{msg} — {lines[1]}"
    return " ".join(msg.split())[:MESSAGE_CHARS]


def _is_license(code: int | None, text: str) -> bool:
    t = text.upper()
    return code in LICENSE_CODES or "LICENSE" in t or "NOT IN APPROVED LIST" in t or "AUTHORIZATION" in t


def error_result(kind: str, message: str | None = None) -> dict:
    """확인 못 함(error) 결과 — 모델 결함이 아니다."""
    return {"state": "error", "error_types": [kind], "fatals": [], "warning_count": None,
            "message": (message or None) and message[:VERDICT_MESSAGE_CHARS]}


def judge(f06_text: str | None, *, log_text: str = "", timed_out: bool = False) -> dict:
    """f06 본문(없으면 None) → {state, error_types, fatals, warning_count, message}.
    log_text = Nastran 표준출력·.log — f06 이 없거나 끝나지 않았을 때 라이선스 실패를 가려낸다."""
    if timed_out:
        return error_result("timeout", "제한 시간 안에 해석이 끝나지 않았습니다")
    licensed_fail = bool(log_text and _LICENSE_LOG.search(log_text))
    if not f06_text or not f06_text.strip():
        return (error_result("license", "Nastran 라이선스를 얻지 못했습니다") if licensed_fail
                else error_result("no_f06", "f06 이 만들어지지 않았습니다"))

    msgs = _messages(f06_text)
    fatals = [m for m in msgs if m["level"] == "fatal"]
    warnings = [m for m in msgs if m["level"] == "warning" and m["code"] not in CASCADE_WARNINGS]
    for m in fatals:
        if _is_license(m["code"], " ".join(m["lines"])):
            return error_result("license", f"라이선스: {_first_message(m['lines'])}")
    causes = ([m for m in fatals if m["code"] not in CASCADE_CODES | CARRIER_CODES]
              or [m for m in fatals if m["code"] in CARRIER_CODES] or fatals)

    if causes:
        items = [{"code": m["code"], "message": _first_message(m["lines"]),
                  "type": classify(m["code"], " ".join(m["lines"]))} for m in causes]
        types: list[str] = []
        for it in items:
            if it["type"] not in types:
                types.append(it["type"])
        first = items[0]
        head = f"FATAL {first['code']}" if first["code"] is not None else "FATAL"
        return {"state": "fail", "error_types": types, "fatals": items[:MAX_FATALS],
                "warning_count": len(warnings),
                "message": f"{head} · {first['message']}"[:VERDICT_MESSAGE_CHARS]}

    if not _END.search(f06_text):
        return (error_result("license", "Nastran 라이선스를 얻지 못했습니다") if licensed_fail
                else error_result("no_f06", "f06 이 끝까지 쓰이지 않았습니다(중간에 멈춤)"))
    return {"state": "pass", "error_types": [], "fatals": [], "warning_count": len(warnings), "message": None}
