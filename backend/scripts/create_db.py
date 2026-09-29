"""MySQL 에 logbook(운영)·logbook_test(테스트) 데이터베이스를 만든다.

사용법 (backend 폴더에서): .venv\\Scripts\\python.exe scripts\\create_db.py
backend\\.env 의 LOGBOOK_DB_* 접속 정보를 쓴다. 이미 있으면 건드리지 않는다.
"""
import os
import re
import sys
from pathlib import Path

import pymysql
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def main() -> int:
    base = os.getenv("LOGBOOK_DB_NAME", "logbook")
    names = [base, f"{base}_test"]
    for name in names:
        if not NAME_PATTERN.fullmatch(name):
            print(f"데이터베이스 이름이 올바르지 않습니다: {name}", file=sys.stderr)
            return 2
    conn = pymysql.connect(
        host=os.getenv("LOGBOOK_DB_HOST", "localhost"),
        port=int(os.getenv("LOGBOOK_DB_PORT", "3306")),
        user=os.getenv("LOGBOOK_DB_USER", "logbook_app"),
        password=os.getenv("LOGBOOK_DB_PASSWORD", ""),
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            for name in names:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
                print(f"준비됨: {name}")
        conn.commit()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
