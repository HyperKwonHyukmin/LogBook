"""배치 안 파일을 Entry 후보로 묶는다(설계 §5.4). DB 와 무관한 순수 함수."""
import os
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from .hulls import best_hull, extract_hull_candidates
from .rules import classify

LOOSE = ""  # 폴더 없이 올라온 낱개 파일들


@dataclass
class FileInfo:
    key: int
    rel_path: str  # 배치 루트 기준 posix 경로


@dataclass
class Proposal:
    title: str
    file_keys: list[int]
    best_hull: str | None
    hull_candidates: list[dict] = field(default_factory=list)
    # 20 — 제목 초안의 원천(폴더 이름 또는 확장자 뗀 파일 이름) — entries.title_source
    source: str = ""


def _names(files: list[FileInfo]) -> list[str]:
    names: list[str] = []
    for f in files:
        names.extend(PurePosixPath(f.rel_path).parts)
    return names


def _title(label: str) -> str:
    return label.replace("_", " ").strip() if label else ""


def _title_from_filename(name: str) -> str:
    """낱개 파일 묶음(label 없음)의 제목 — 파일 이름이라 확장자를 뗀다.
    폴더 이름(label)에는 이 함수를 쓰지 않는다: "3496_검토_v1.2" 처럼 버전 표기의
    점을 확장자로 오인해 ".2" 를 잘라내면 안 된다."""
    return _title(os.path.splitext(name)[0])


HINT_REASON = "WorkBench 묶음 이름·메모"


def _make(label: str, files: list[FileInfo], known: set[str], hints: list[str] | None = None) -> Proposal:
    cands = extract_hull_candidates(_names(files), known)
    best = best_hull(cands)
    # 49 — 사람이 WorkBench 묶음 이름·메모에 적은 호선이 파일 이름보다 먼저다
    hint_cands = extract_hull_candidates([h for h in hints or [] if h], known)
    hinted = best_hull(hint_cands)
    if hinted:
        best = hinted
        for c in hint_cands:
            c.reasons = [f"{HINT_REASON}: {r}" for r in c.reasons]
        cands = hint_cands + [c for c in cands if c.hull_no not in {h.hull_no for h in hint_cands}]
    first = PurePosixPath(files[0].rel_path).name
    title = _title(label) or _title_from_filename(first)
    source = label if label else os.path.splitext(first)[0]
    return Proposal(title=title, file_keys=[f.key for f in files], best_hull=best,
                    hull_candidates=[c.as_dict() for c in cands], source=source[:255])


def _main_model(files: list[FileInfo]) -> FileInfo | None:
    """WorkBench 묶음의 대표 BDF — Wire 모델(_lifting)·검증 산출물(_validation)이 아닌 첫 BDF, 없으면 첫 BDF."""
    bdfs = sorted((f for f in files if classify(f.rel_path) == "model"),
                  key=lambda f: f.rel_path)
    plain = [f for f in bdfs if not re.search(r"_(lifting|validation|edited)$", PurePosixPath(f.rel_path).stem,
                                              re.IGNORECASE)]
    return (plain or bdfs or [None])[0]


def propose(files: list[FileInfo], known: set[str], *, single: bool = False,
            hints: list[str] | None = None) -> list[Proposal]:
    """single — 49: 묶음 전체를 초안 하나로(WorkBench 해석 1건 = 자료 1건, 부모·세부 검토 작업 폴더가 갈라져 와도).
    제목 원천은 작업 폴더 이름(날짜_사번_프로그램)이 아니라 대표 BDF 이름. hints = 호선을 먼저 찾아볼 글(묶음 이름·메모)."""
    top: dict[str, list[FileInfo]] = {}
    for f in files:
        parts = PurePosixPath(f.rel_path).parts
        top.setdefault(parts[0] if len(parts) > 1 else LOOSE, []).append(f)
    if single and files:
        main = _main_model(files)
        if main is not None:
            ordered = [main] + [f for f in files if f is not main]
            return [_make("", ordered, known, hints)]   # label 없음 → 첫 파일(대표 BDF) 이름이 제목 원천
        return [_make(max(top, key=lambda k: len(top[k])), files, known, hints)]

    proposals: list[Proposal] = []
    for label, group in top.items():
        subs: dict[str, list[FileInfo]] = {}
        for f in group:
            parts = PurePosixPath(f.rel_path).parts
            subs.setdefault(parts[1] if label != LOOSE and len(parts) > 2 else "", []).append(f)
        sub_hulls = {s: best_hull(extract_hull_candidates(_names(fs), known)) for s, fs in subs.items() if s}
        distinct = {h for h in sub_hulls.values() if h}
        if len(distinct) >= 2:
            for s, fs in subs.items():
                proposals.append(_make(s or label, fs, known))
        else:
            proposals.append(_make(label, group, known))
    return proposals
