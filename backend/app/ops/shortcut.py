"""팀원 배포용 바로가기(설계 §1.3) — 공유 폴더 루트에 Logbook.url 과 사용 안내문을 둔다.

15 — 앱 이름은 Hi-TESS LogBook. 파일 이름(Logbook.url 등)은 이미 퍼진 바로가기를 깨지 않게 그대로 둔다."""
import os

from ..storage.paths import StoragePaths, to_long

URL_FILE = "Logbook.url"
GUIDE_FILE = "Logbook 사용 안내.txt"


def _guide(url: str) -> str:
    return "\r\n".join([
        "Hi-TESS LogBook 사용 안내",
        "",
        f"접속 주소: {url}",
        "",
        "1. 이 폴더의 Logbook.url 을 두 번 누르면 크롬에서 Hi-TESS LogBook 이 열립니다.",
        "2. 크롬 북마크: 주소창에 위 주소를 연 뒤 Ctrl+D 를 눌러 북마크에 추가합니다.",
        "3. HiTESS WorkBench 에 가입·승인된 사번으로 바로 로그인합니다(따로 가입하지 않습니다).",
        "   처음 들어오면 LV1(게스트) — 공유 자료만 보입니다. 더 필요하면 관리자에게 등급을 요청하세요.",
        "4. 자료는 00_Inbox 에 폴더째 넣거나, 화면의 올리기 단추로 올립니다.",
        "",
        "자료 원본은 이 폴더에 있습니다. 10_Vault 를 직접 고치지 마세요.",
        "",
    ])


def _write(path, data: bytes) -> None:
    """임시 파일에 쓰고 바꿔 끼운다(기존 파일은 덮어쓴다)."""
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(to_long(tmp), "wb") as fh:
            fh.write(data)
        os.replace(to_long(tmp), to_long(path))
    except BaseException:
        try:
            os.remove(to_long(tmp))
        except OSError:
            pass
        raise


def write_shortcut(storage: StoragePaths, url: str) -> list[str]:
    _write(storage.root / URL_FILE, f"[InternetShortcut]\r\nURL={url}\r\n".encode("ascii"))
    # 메모장이 한글을 깨뜨리지 않게 UTF-8 BOM 을 붙인다
    _write(storage.root / GUIDE_FILE, _guide(url).encode("utf-8-sig"))
    return [URL_FILE, GUIDE_FILE]
