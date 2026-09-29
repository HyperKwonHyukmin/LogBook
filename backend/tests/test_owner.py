from app.ingest import owner


def test_owner_account_of_local_file_is_lowercase_user(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("x", encoding="utf-8")
    acc = owner.owner_account(p)
    assert acc is None or acc == acc.lower()


def test_owner_account_missing_file_is_none(tmp_path):
    assert owner.owner_account(tmp_path / "없음.txt") is None


def test_employee_for_account(db, make_user):
    make_user("A476854")
    assert owner.employee_for_account(db, "a476854") == "A476854"
    assert owner.employee_for_account(db, "b999999") is None
    assert owner.employee_for_account(db, None) is None


def test_lookup_account_sid_is_cached(monkeypatch, tmp_path):
    import win32security

    calls = {"n": 0}
    real_lookup = win32security.LookupAccountSid

    def counting(system, sid):
        calls["n"] += 1
        return real_lookup(system, sid)

    monkeypatch.setattr(win32security, "LookupAccountSid", counting)
    owner._lookup_account.cache_clear()

    p1, p2 = tmp_path / "a.txt", tmp_path / "b.txt"
    p1.write_text("1", encoding="utf-8")
    p2.write_text("2", encoding="utf-8")

    owner.owner_account(p1)
    owner.owner_account(p2)  # 같은 프로세스가 만든 파일 — 같은 소유자, 캐시로 1회만 조회
    assert calls["n"] <= 1
