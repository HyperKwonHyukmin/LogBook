"""자동 제외 규칙과 파일 분류(설계 §5.1·§5.2)."""
import fnmatch
import os

# Office 임시 파일, 윈도우/맥 탐색기 부산물, Nastran 스크래치(수 GB), 다운로드 중 파일
EXCLUDE_PATTERNS = (
    "~$*", "thumbs.db", "desktop.ini", "*.master", "*.dball", "*.scratch", "*.tmp",
    ".ds_store", "._*", "*.crdownload", "*.part",
)

KIND_BY_EXT = {
    ".bdf": "model", ".dat": "model", ".nas": "model", ".blk": "model",
    ".f06": "result", ".op2": "result", ".h5": "result", ".log": "result",
    ".pdf": "report", ".pptx": "report", ".ppt": "report", ".xlsx": "report", ".xls": "report",
    ".docx": "report", ".doc": "report",
    ".dwg": "drawing", ".dxf": "drawing", ".png": "drawing", ".jpg": "drawing", ".jpeg": "drawing",
}


def is_excluded(name: str) -> bool:
    lower = name.lower()
    return any(fnmatch.fnmatchcase(lower, pat) for pat in EXCLUDE_PATTERNS)


def classify(name: str) -> str:
    return KIND_BY_EXT.get(os.path.splitext(name)[1].lower(), "other")


def safe_ext(name: str) -> str:
    """`File.ext` 컬럼에 저장할 값. 점이 여러 번 섞인 이름(예: 버전 표기)에서
    `os.path.splitext` 가 뽑아낸 마지막 조각이 진짜 확장자가 아닐 수 있어, 너무 길거나
    (10자 초과) 공백이 섞이면 확장자가 아닌 것으로 보고 빈 문자열을 둔다."""
    ext = os.path.splitext(name)[1].lower()
    if len(ext) > 10 or " " in ext:
        return ""
    return ext
