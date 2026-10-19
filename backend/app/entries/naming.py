"""20 — 자료 제목 형식(순수 함수, DB 와 무관).

제목 초안 = `{호선} · {구역} · {해석 종류} · {구별자}` — 값이 없는 칸은 건너뛴다.
- 호선·구역이 여럿이면 첫 값 + ' 외 N'(예: `3496 외 1`). '호선 없음(공용)' 이면 호선 칸이 `공용`.
- 21 — 호선이 없고 프로젝트가 있으면 호선 칸이 프로젝트 이름(`크레인 연구 · 기관실 · FE 해석`). 프로젝트가 '공용'보다 앞선다.
- 구별자 = 원래 폴더/파일 이름(title_source)에서 이 자료의 호선 번호·구역·해석 종류에 해당하는 토큰과
  흔한 잡음(final·최종·copy 등)을 뺀 나머지(예: `3496_선수부_M04_rev3_final` → `M04 rev3`).
- 세 값이 모두 없으면 예전 방식(파일/폴더 이름의 '_' 를 공백으로)을 그대로 쓴다(legacy_title).

원래 파일 이름은 파일 목록에 그대로 남는다 — 이 모듈은 제목만 만든다.
"""
import os
import re
from pathlib import PurePosixPath

SEP = " · "
TITLE_MAX = 200
SHARED_LABEL = "공용"   # '호선 없음(공용)' 자료의 호선 칸

# 나누는 기호 — 점(.)은 나누지 않는다(v1.2 같은 판 표기를 지킨다). 확장자는 먼저 뗀다
_SPLIT = re.compile(r"[\s_\-,;()\[\]{}+/\\~]+")
# 호선 표기 — 3496 · H3496 · 3496호선 · 3496호
_HULL_TOKEN = re.compile(r"^(?:H|HN|No\.?)?([0-9]{4})(?:호선|호)?$", re.IGNORECASE)
# 흔한 잡음(대소문자 무시). 판 표기(rev·v1)는 구별자라 남긴다
NOISE = frozenset({"final", "fin", "최종", "최종본", "copy", "복사본", "사본", "backup", "bak",
                   "tmp", "temp", "new"})
WORD = re.compile(r"[0-9A-Za-z가-힣]+")


def key(value) -> str:
    """비교 열쇠 — 공백·기호를 빼고 대소문자를 무시한다(E/R = ER, 강도평가 = 강도 평가)."""
    return "".join(WORD.findall(str(value or ""))).casefold()


def tokens(source: str) -> list[str]:
    return [t for t in _SPLIT.split(source or "") if t]


def legacy_title(source: str | None) -> str:
    """20 이전의 제목 규칙(ingest.proposal._title) — '_' 를 공백으로. source 는 확장자를 뗀 이름."""
    return (source or "").replace("_", " ").strip()[:TITLE_MAX]


def source_from_name(name: str, *, is_file: bool) -> str:
    """title_source 로 남길 값 — 폴더는 그대로, 파일은 확장자를 뗀 이름."""
    return (os.path.splitext(name)[0] if is_file else name).strip()[:255]


def source_from_files(rel_paths: list[str]) -> str:
    """title_source 가 없는(20 이전) 자료의 원래 이름 추정 — 모든 파일이 한 폴더 아래면 그 폴더, 아니면 첫 파일 이름.
    rel_paths 는 BDF 를 앞에 둔 순서로 주면 좋다(대표 파일)."""
    parts = [PurePosixPath(r).parts for r in rel_paths if r]
    if not parts:
        return ""
    tops = {p[0] for p in parts if len(p) > 1}
    if len(tops) == 1 and all(len(p) > 1 for p in parts):
        return next(iter(tops))[:255]
    return source_from_name(parts[0][-1], is_file=True)


def _phrase_keys(phrases) -> set[str]:
    return {k for k in (key(p) for p in phrases or []) if k}


def distinct_part(source: str | None, *, hulls=(), phrases=()) -> str:
    """원래 이름에서 호선(hulls)·구역/해석 종류 표기(phrases — 용어와 동의어)·잡음을 뺀 나머지.

    표기는 토큰 1~3개를 이어 붙인 열쇠로 맞춘다(`Engine Room`·`강도_평가`). 2글자 이상 토큰이 어떤 표기의
    앞부분이면(`권상` ↔ `권상 해석`) 그것도 뺀다 — 이 자료가 고른 값의 표기만 보므로 엉뚱한 단어를 지우지 않는다."""
    toks = tokens(source or "")
    hull_set = {str(h) for h in hulls or []}
    keys = _phrase_keys(phrases)
    out: list[str] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        m = _HULL_TOKEN.match(t)
        if m and m.group(1) in hull_set:
            i += 1
            continue
        if key(t) in NOISE:
            i += 1
            continue
        hit = 0
        for n in (3, 2, 1):
            if i + n <= len(toks) and key("".join(toks[i:i + n])) in keys:
                hit = n
                break
        if not hit:
            k = key(t)
            if len(k) >= 2 and any(p.startswith(k) for p in keys):
                hit = 1
        if hit:
            i += hit
            continue
        out.append(t)
        i += 1
    return " ".join(out)


def _first_plus(values: list[str]) -> str:
    vals = [v for v in values if v]
    if not vals:
        return ""
    return vals[0] + (f" 외 {len(vals) - 1}" if len(vals) > 1 else "")


def compose_title(*, hulls=(), no_hull: bool = False, zones=(), analysis_type: str | None = None,
                  distinct: str = "") -> str:
    """구조화 값으로 제목을 만든다. 호선(또는 공용)·구역·해석 종류가 모두 없으면 '' (부르는 쪽이 예전 방식으로)."""
    hull_list = list(hulls or [])
    hull_part = _first_plus(hull_list) if hull_list else (SHARED_LABEL if no_hull else "")
    head = [p for p in (hull_part, _first_plus(list(zones or [])), (analysis_type or "").strip()) if p]
    if not head:
        return ""
    return SEP.join(head + ([distinct] if distinct else []))[:TITLE_MAX]


def title_draft(source: str | None, *, hulls=(), no_hull: bool = False, zones=(), analysis_type: str | None = None,
                phrases=()) -> str:
    """제목 초안 — 값이 하나라도 있으면 형식, 아니면 예전 방식(원래 이름). phrases(구역·해석 종류 표기)는
    구별자에서 뺀다(quality.TitleContext.draft 가 넣는다)."""
    distinct = distinct_part(source, hulls=hulls, phrases=phrases)
    return compose_title(hulls=hulls, no_hull=no_hull, zones=zones, analysis_type=analysis_type,
                         distinct=distinct) or legacy_title(source)


def title_words(title: str | None, drop=()) -> set[str]:
    """비슷한 제목 비교용 낱말 집합(소문자). drop 의 낱말(같은 호선 번호 등)은 뺀다."""
    gone = {str(d).casefold() for d in drop or []}
    return {w.casefold() for w in WORD.findall(title or "")} - gone


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0
