"""판 표시 읽기(14 A) — 파일 이름에서 판 번호·날짜·상태 낱말·사본 번호를 떼어 '계열 열쇠'와 '순서 열쇠'를 만든다.

규칙(docs/plans/2026-10-08-logbook-14-revisions.md §1.1):
    줄기(확장자 뺀 이름)의 **끝**에서 표시를 반복해 뗀다(대소문자 무시). 떼고 남은 줄기가 같으면 같은 계열.
      판 번호   _r1 -R2 _rev3 v2 _ver2 .R0           → rev = 번호
      판 글자   Rev.A _revB                          → rev = A=1, B=2 …
      날짜      _20260930 _2026-09-30 _260930        → date = YYYYMMDD (올바른 월·일만)
      상태 낱말 old(−1) 수정·변경·new(1) 재수정(2) latest·last(3) final·fin·최종·최종본(4)
      사본 번호 ' (2)' '(3)'                          → copy
    줄기에 표시가 하나도 없으면 바로 위 폴더 이름에서 찾는다(R1/model.bdf, R2/model.bdf).
"""
import re
from dataclasses import dataclass
from datetime import date
from pathlib import PurePosixPath

_SEP = r"[\s_\-.]"
_LEAD = rf"(?:^|{_SEP})"
_COPY = re.compile(r"\s*\((\d{1,3})\)$")
_COPY_WORD = re.compile(rf"{_LEAD}(?:copy|사본|복사본)$", re.IGNORECASE)
_DATE8 = re.compile(rf"{_LEAD}(20\d{{2}})[-.]?(\d{{2}})[-.]?(\d{{2}})$")
_DATE6 = re.compile(rf"{_LEAD}(\d{{2}})(\d{{2}})(\d{{2}})$")
_REV_NUM = re.compile(rf"{_LEAD}(?:rev|ver|r|v)[\s_.]?(\d{{1,3}})$", re.IGNORECASE)
_REV_LETTER = re.compile(rf"{_LEAD}rev[\s_.]?([a-z])$", re.IGNORECASE)
# 상태 낱말 — 영문은 구분자가 있어야, 한글은 붙어 있어도 뗀다
_STATUS_RANK = {"old": -1, "수정": 1, "변경": 1, "new": 1, "수정본": 1, "재수정": 2, "latest": 3, "last": 3,
                "final": 4, "fin": 4, "최종": 4, "최종본": 4}
_STATUS_EN = re.compile(rf"{_LEAD}(old|new|latest|last|final|fin)$", re.IGNORECASE)
_STATUS_KO = re.compile(rf"{_SEP}?(최종본|최종|재수정|수정본|수정|변경)$")
_TRIM = re.compile(rf"{_SEP}+$")
_SPACES = re.compile(rf"{_SEP}+")
# 하중 경우 낱말 — 이름에 있으면 '형상이 같아도 판이 아니라 하중 경우 변형'으로 본다(내용 규칙 제외)
LOAD_CASE = re.compile(r"(?:^|[\s_\-.])(?:lc|case|sc|load|subcase|하중)[\s_\-.]?\d+", re.IGNORECASE)


@dataclass(frozen=True)
class Marks:
    rev: int | None = None
    letter: str | None = None
    date: int | None = None
    status: int = 0
    copy: int | None = None
    text: str = ""          # 사람이 읽을 표시(툴팁) — 'R2', 'Rev.A · 2026-09-30' …

    @property
    def empty(self) -> bool:
        return self.rev is None and self.date is None and self.status == 0 and self.copy is None

    def order(self) -> tuple:
        """순서 열쇠 앞부분 — (최종 묶음, 판 번호, 날짜, 상태 순위, 사본 번호)."""
        group = 0
        if self.rev is None and self.status == 4:
            group = 1          # 번호 없는 final/최종은 맨 뒤
        elif self.rev is None and self.status == -1:
            group = -1         # 번호 없는 old 는 맨 앞
        return (group, -1 if self.rev is None else self.rev, self.date or 0, self.status, self.copy or 0)


def _valid_date(y: int, m: int, d: int) -> bool:
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def strip_marks(stem: str) -> tuple[str, Marks]:
    """줄기 끝의 판 표시를 반복해 뗀다 → (남은 줄기, 표시)."""
    s = stem.strip()
    rev = letter = dt = copy = None
    status = 0
    parts: list[str] = []
    for _ in range(8):          # 표시는 많아야 몇 개 — 끝없는 반복 방지
        before = s
        if m := _COPY.search(s):
            copy = copy if copy is not None else int(m.group(1))
            parts.append(f"({m.group(1)})")
        elif m := _COPY_WORD.search(s):
            copy = copy if copy is not None else 1
            parts.append("사본")
        elif (m := _DATE8.search(s)) and _valid_date(int(m.group(1)), int(m.group(2)), int(m.group(3))):
            dt = dt or int(m.group(1) + m.group(2) + m.group(3))
            parts.append(f"{m.group(1)}-{m.group(2)}-{m.group(3)}")
        elif (m := _DATE6.search(s)) and _valid_date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3))):
            dt = dt or int("20" + m.group(1) + m.group(2) + m.group(3))
            parts.append(f"20{m.group(1)}-{m.group(2)}-{m.group(3)}")
        elif m := _REV_LETTER.search(s):
            if rev is None:
                letter = m.group(1).upper()
                rev = ord(letter) - 64
            parts.append(f"Rev.{m.group(1).upper()}")
        elif m := _REV_NUM.search(s):
            rev = rev if rev is not None else int(m.group(1))
            parts.append(f"R{int(m.group(1))}")
        elif m := (_STATUS_EN.search(s) or _STATUS_KO.search(s)):
            word = m.group(1).lower()
            rank = _STATUS_RANK[word]
            status = rank if status == 0 else max(status, rank)
            parts.append(m.group(1))
        else:
            break
        s = _TRIM.sub("", s[:m.start()]) if m.start() > 0 else ""
        if s == before:
            break
    return s, Marks(rev=rev, letter=letter, date=dt, status=status, copy=copy, text=" · ".join(reversed(parts)))


def _norm(text: str) -> str:
    return _SPACES.sub("_", text.strip()).casefold().strip("_")


@dataclass(frozen=True)
class NameInfo:
    key: str        # 계열 열쇠(폴더 + 표시 뗀 줄기, 정규화)
    base: str       # 표시 뗀 줄기(정규화) — 하중 경우 낱말 검사용
    marks: Marks


def name_info(rel_path: str) -> NameInfo:
    """rel_path(posix) → 계열 열쇠·판 표시. 줄기에 표시가 없으면 바로 위 폴더 이름에서 찾는다."""
    p = PurePosixPath(rel_path)
    stem = p.name.rsplit(".", 1)[0] if "." in p.name else p.name
    base, marks = strip_marks(stem)
    dirs = list(p.parent.parts) if str(p.parent) not in ("", ".") else []
    if dirs:
        folder_base, folder_marks = strip_marks(dirs[-1])
        if marks.empty and not folder_marks.empty:
            marks = folder_marks
            dirs[-1] = folder_base
        elif not folder_marks.empty:
            # 줄기에 표시가 있어도 폴더가 판 폴더(R2/m_final)면 폴더 표시는 열쇠에서 빼고, 줄기에 없는 값만 보탠다
            dirs[-1] = folder_base
            marks = Marks(rev=marks.rev if marks.rev is not None else folder_marks.rev,
                          letter=marks.letter or (folder_marks.letter if marks.rev is None else None),
                          date=marks.date or folder_marks.date, status=marks.status or folder_marks.status,
                          copy=marks.copy if marks.copy is not None else folder_marks.copy,
                          text=" · ".join(t for t in (folder_marks.text, marks.text) if t))
    key = "/".join(_norm(d) for d in dirs) + "|" + _norm(base)
    return NameInfo(key=key, base=_norm(base), marks=marks)


def is_load_case(base: str) -> bool:
    return bool(LOAD_CASE.search(base))
