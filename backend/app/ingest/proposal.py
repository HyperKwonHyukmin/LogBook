"""배치 안 파일을 Entry 후보로 묶는다(설계 §5.4). DB 와 무관한 순수 함수."""
import os
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from .hulls import best_hull, extract_hull_candidates

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


def _make(label: str, files: list[FileInfo], known: set[str]) -> Proposal:
    cands = extract_hull_candidates(_names(files), known)
    title = _title(label) or _title_from_filename(PurePosixPath(files[0].rel_path).name)
    return Proposal(title=title, file_keys=[f.key for f in files], best_hull=best_hull(cands),
                    hull_candidates=[c.as_dict() for c in cands])


def propose(files: list[FileInfo], known: set[str]) -> list[Proposal]:
    top: dict[str, list[FileInfo]] = {}
    for f in files:
        parts = PurePosixPath(f.rel_path).parts
        top.setdefault(parts[0] if len(parts) > 1 else LOOSE, []).append(f)

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
