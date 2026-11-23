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


# 52 — 폴더째 올리기 목록에서 처음에 체크를 풀어 두는 형식(사람이 다시 체크하면 올라간다 — 서버가 지우지 않는다).
# 해석 결과(op2·f06·xdb·h5 — BDF 로 다시 만들 수 있다)·HyperView 결과·세션(op2 경로에 매임)·Nastran 부산물.
# f06·odb(Abaqus 결과) 도 뺀다(사용자 결정 2026-11-05) — 필요하면 목록에서 체크해 올린다
# Abaqus 는 입력(.inp)만 추천하고 해석이 만든 파일(prt·sim·sta·msg·ipm 등)은 뺀다(사용자 결정 2026-11-06).
# 2026-11-19 — Nastran 부산물 .f04 · .fpdat 도 뺀다. 이 형식 뒤에 '.숫자' 가 붙은 것(a.f04.1, run.log.2)도
# 같은 형식으로 본다(판정은 화면 frontend/src/lib/folderPlan.js skipExtOf).
SKIP_BY_DEFAULT_EXTS = (".op2", ".f06", ".f04", ".fpdat", ".xdb", ".h5", ".h3d", ".mvw", ".hwsession", ".pch", ".asm", ".plt",
                        ".odb", ".prt", ".sim", ".sta", ".msg", ".msp", ".ipm", ".com", ".res", ".mdl", ".stt", ".lck", ".abq",
                        ".pac", ".sel", ".fil", ".023", ".log")
# .dat 은 Nastran 입력일 수도 있어 늘 빼지는 않는다 — 같은 폴더에 이름이 같은 .inp 가 있을 때만(Abaqus 결과 .dat) 뺀다
SKIP_WITH_INP_EXTS = (".dat",)


# 61 — 3D 뷰어로 여는 Abaqus 입력. kind 는 other 그대로 둔다 — kind 'model' 은 Nastran 실행·WorkBench 보내기·
# 내용 서명(같은 모델·판 비교)·권상 판정이 BDF 로 읽기 때문이다. 변환·뷰어만 이 확장자도 받는다.
ABAQUS_EXTS = (".inp",)
# 2026-11-23 — HyperMesh 가 쓴 OptiStruct 입력(.fem). Bulk 카드가 Nastran 과 같아 BDF 파서로 읽는다(운영 보관소 E000099 의
# 실제 .fem 으로 확인 — 요소 59,547개, 경고 없음). Nastran 으로 돌지 않으므로 .inp 처럼 보기 전용(kind other)
OPTISTRUCT_EXTS = (".fem",)
VIEWER_EXTS = ABAQUS_EXTS + OPTISTRUCT_EXTS


def _ext(name: str) -> str:
    return os.path.splitext(name or "")[1].lower()


def is_abaqus_input(name: str) -> bool:
    return _ext(name) in ABAQUS_EXTS


def is_optistruct_input(name: str) -> bool:
    return _ext(name) in OPTISTRUCT_EXTS


def is_viewer_only(name: str) -> bool:
    """3D 로 보기만 하는 모델 입력(.inp, .fem) — Nastran 실행, 내용 서명, 권상 판정, WorkBench 보내기는 하지 않는다."""
    return _ext(name) in VIEWER_EXTS


def has_model_view(kind: str, name: str) -> bool:
    """3D 변환·뷰어 대상인가 — BDF 류(kind 'model') 또는 보기 전용 입력(Abaqus .inp, OptiStruct .fem)."""
    return kind == "model" or is_viewer_only(name)


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
