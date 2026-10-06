import os

from app.ops.shortcut import write_shortcut
from app.storage.paths import to_long


def test_write_shortcut(storage):
    names = write_shortcut(storage, "http://10.14.42.145:9095")
    assert set(names) == {"Logbook.url", "Logbook 사용 안내.txt"}
    with open(to_long(storage.root / "Logbook.url"), "rb") as fh:
        assert fh.read() == b"[InternetShortcut]\r\nURL=http://10.14.42.145:9095\r\n"
    with open(to_long(storage.root / "Logbook 사용 안내.txt"), "rb") as fh:
        data = fh.read()
    assert data.startswith(b"\xef\xbb\xbf") and "http://10.14.42.145:9095" in data.decode("utf-8-sig")


def test_write_shortcut_overwrites_and_cli(storage, capsys):
    from app import cli

    write_shortcut(storage, "http://old:1")
    assert cli.main(["write-shortcut", "--url", "http://10.14.42.145:9095"]) == 0
    with open(to_long(storage.root / "Logbook.url"), "rb") as fh:
        assert b"URL=http://10.14.42.145:9095" in fh.read()
    assert "Logbook.url" in capsys.readouterr().out
    assert not any(n.endswith(".tmp") for n in os.listdir(to_long(storage.root)))
