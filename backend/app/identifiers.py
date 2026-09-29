"""사번 형식 검증 — routers/auth.py 와 cli.py 가 같은 규칙을 쓴다.

⚠ `\\d` 대신 `[0-9]` 를 쓴다. `\\d` 는 유니코드 숫자 범주 전체(아라비아 숫자
`١٢٣٤٥`, 전각 숫자 `１２３４５` 등)를 ASCII 숫자와 동일하게 매치한다 — utf8mb4_unicode_ci
콜레이션에서는 이런 문자가 ASCII 숫자와 다른 값으로 저장되므로, 검증은 통과하고 유니크
제약은 별개 행으로 취급해 사번이 충돌 없이 중복되는 구멍이 생긴다.
"""
import re

EMPLOYEE_ID_PATTERN = re.compile(r"^[A-Z][0-9]{5,7}$")


def is_valid_employee_id(employee_id: str) -> bool:
    return bool(EMPLOYEE_ID_PATTERN.fullmatch(employee_id))
