"""실험 4: 공유 폴더 파일의 소유자(Owner) 계정을 읽을 수 있는지 확인한다.

사용법: python owner_check.py <폴더> [-o 결과.json]
출력: {"rows": [파일별 {path, sid, owner, account, sid_type, is_user, lookup_error, error,
                       walk_error}],
      "summary": {files, user_owned, group_owned, orphaned_sid, read_failed, walk_errors}}
account 가 사번과 대조할 값이다. **모든 행에 error·lookup_error·walk_error 세 키가 항상
있다**(성공/실패와 무관하게 스키마가 같아야 후처리가 쉽다) — 없으면 None/False.
walk_error=True 인 행은 특정 파일이 아니라 폴더 나열 자체의 실패라 summary.files 에서
빠지고 summary.walk_errors 로만 센다.

⚠ 2026-09-28 코드 리뷰 수정: LookupAccountSid 만 따로 try 로 감싼다 — 도메인에서 지워진
계정(orphan SID)은 SID 는 읽히지만 이름 조회만 실패하므로, sid 는 항상 남기고
owner/account 만 None 으로 떨어뜨린다(→ summary.orphaned_sid). GetFileSecurity 자체의
실패(권한 없음 등)는 collect_owners 에서 파일 단위로 잡는다(→ summary.read_failed).
⚠ 2026-09-28 재리뷰: `Path.rglob()` 대신 `os.walk(onerror=...)` 로 순회한다 — 폴더
자체를 나열하다가(권한 없는 하위 폴더 등) 나는 OSError 는 rglob 이면 전체 실행을
죽이지만, os.walk 는 onerror 콜백으로 계속 진행할 수 있다. 그 콜백도 행으로 남긴다.
"""
import os
import sys
from pathlib import Path

import win32security

from pocio import dump, parse_args


def account_name(owner: str) -> str:
    """'HDRND\\A476854' → 'a476854'. 사번 대조는 소문자 계정명으로 한다."""
    return owner.rsplit("\\", 1)[-1].lower()


def owner_info(path: str) -> dict:
    """파일 하나의 소유자 정보를 읽는다.

    sid 조회(GetFileSecurity/GetSecurityDescriptorOwner/ConvertSidToStringSid)는
    실패하면 그대로 예외를 던진다(collect_owners 가 파일 단위로 잡는다).
    이름 조회(LookupAccountSid)만 따로 잡아 orphan SID 를 구분해 남긴다.
    """
    sd = win32security.GetFileSecurity(path, win32security.OWNER_SECURITY_INFORMATION)
    sid = sd.GetSecurityDescriptorOwner()
    sid_str = win32security.ConvertSidToStringSid(sid)
    try:
        name, domain, sid_type = win32security.LookupAccountSid(None, sid)
    except Exception as exc:  # orphan SID: 도메인에서 삭제된 계정 등
        return {
            "sid": sid_str,
            "owner": None,
            "account": None,
            "sid_type": None,
            "is_user": False,
            "lookup_error": f"{type(exc).__name__}: {exc}",
        }
    owner = f"{domain}\\{name}"
    return {
        "sid": sid_str,
        "owner": owner,
        "account": account_name(owner),
        "sid_type": sid_type,
        "is_user": sid_type == win32security.SidTypeUser,
        "lookup_error": None,
    }


def _blank_row(path: str) -> dict:
    """error/walk 실패 행의 공통 뼈대 — 성공 행과 키 집합을 맞춘다.

    ⚠ 2026-09-28 재재검토: `walk_error` 를 추가해 "폴더 나열 자체의 실패"(특정 파일이
    아니다)를 "그 파일 하나의 읽기 실패"와 구분한다 — 전자는 summary.files(파일 수)에
    안 넣는다(파일이 아니므로).
    """
    return {
        "path": path,
        "sid": None,
        "owner": None,
        "account": None,
        "sid_type": None,
        "is_user": False,
        "lookup_error": None,
        "error": None,
        "walk_error": False,
    }


def collect_owners(folder: str) -> list[dict]:
    rows: list[dict] = []

    def on_walk_error(exc: OSError) -> None:
        # 폴더 나열 자체의 실패(권한 없는 하위 폴더 등) — 실행을 죽이지 않고 행으로 남긴다.
        row = _blank_row(getattr(exc, "filename", None) or folder)
        row["error"] = f"walk {type(exc).__name__}: {exc}"
        row["walk_error"] = True
        rows.append(row)

    files: list[Path] = []
    for dirpath, _dirnames, filenames in os.walk(folder, onerror=on_walk_error):
        for name in filenames:
            files.append(Path(dirpath) / name)

    for p in sorted(files):
        try:
            info = owner_info(str(p))
            rows.append({"path": str(p), "error": None, "walk_error": False, **info})
        except Exception as exc:  # 실험 도구: 파일 하나의 실패는 기록만 한다
            row = _blank_row(str(p))
            row["error"] = f"{type(exc).__name__}: {exc}"
            rows.append(row)
    return rows


def summarize(rows: list[dict]) -> dict:
    walk_errors = sum(1 for r in rows if r.get("walk_error"))
    file_rows = [r for r in rows if not r.get("walk_error")]  # 파일이 아닌 행은 files 에서 뺀다
    files = len(file_rows)
    user_owned = sum(1 for r in file_rows if r.get("is_user") is True)
    orphaned_sid = sum(1 for r in file_rows if r.get("lookup_error"))
    read_failed = sum(1 for r in file_rows if r.get("error"))
    group_owned = files - user_owned - orphaned_sid - read_failed
    return {
        "files": files,
        "user_owned": user_owned,
        "group_owned": group_owned,
        "orphaned_sid": orphaned_sid,
        "read_failed": read_failed,
        "walk_errors": walk_errors,
    }


def main(argv: list[str]) -> int:
    positionals, out = parse_args(argv)
    rows = collect_owners(positionals[0])
    dump({"rows": rows, "summary": summarize(rows)}, out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
