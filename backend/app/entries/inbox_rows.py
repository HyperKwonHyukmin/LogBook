"""68 — '올리기와 확정' 줄 목록: 초안마다 상태를 서버가 한 곳에서 정한다(화면은 이 값을 쓴다).

상태(확정 규칙은 바꾸지 않는다 — 지금 화면의 bulkConfirmPlan, draftChecks 와 같은 판정을 옮긴 것):
    processing     묶음을 워커가 정리하는 중(staged)
    attaching      24 첨부 묶음이 남아 있음(올리는 중, 정리 중, 합치기 전) — 확정이 막힌다(ensure_no_pending)
    attach_failed  첨부 묶음이 실패해 남아 있음 — 확정이 막힌다(첨부 연결 해제가 필요)
    waiting_files  파일 0개(과제 엑셀 초안, 68 3단계). 지금 단계에서는 표시만 한다
    needs_check    [이 묶음 모두 확정]이 건너뛰는 이유가 있음(제목 없음, 똑같은 BDF, 권상 Wire 확인). 하나씩은 확정된다
    ready          위에 해당 없음
'저장하지 않은 변경'은 화면만 아는 것이라 화면이 덧붙인다. 호선 없음은 막지 않는다('보완 필요'로 확정, 43).

목록은 가볍게 — 파일 목록, 3D 상태, 비슷한 자료 같은 무거운 칸은 넣지 않고, 고른 초안 하나는 GET /api/entries/{id} 로 따로 읽는다.
초안 수가 수백 건을 넘지 않는다는 전제로 보이는 초안을 모두 읽어 상태를 매긴 뒤 거르고 자른다(건수 칩이 거르기 전 숫자라서)."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from .. import access, lifting, models, vocab
from .draft_attachments import PENDING_STATES

STATES = ("ready", "needs_check", "attach_failed", "waiting_files", "attaching", "processing")
STATE_ORDER = {s: i for i, s in enumerate(STATES)}   # 할 일 순(확정 가능 → 확인 필요 → … → 처리 중)
REASON_TITLE = "제목 없음"
REASON_BLOCKED = "똑같은 BDF 가 이미 있음"
REASON_WIRE = "권상 Wire 모델 확인"


def needs_wire(*, merge_into: bool, needed: bool, has_wire: bool, blocked_wire: bool) -> bool:
    """49 — 권상 Wire 모델을 올려 달라고 할지(화면 needsLiftingWire 와 같은 규칙)."""
    if merge_into or has_wire or blocked_wire:
        return False
    return needed


def draft_state(*, batch_state: str | None, pending: list[str], live_files: int, title: str | None,
                blocked: bool, wire: bool) -> tuple[str, str]:
    """(상태, 확인 필요 이유) — 이유는 needs_check 일 때만. 앞의 것이 이긴다."""
    if batch_state == "staged":
        return "processing", ""
    if any(s == "failed" for s in pending):
        return "attach_failed", ""
    if pending:
        return "attaching", ""
    if live_files == 0:
        return "waiting_files", ""
    if not (title or "").strip():
        return "needs_check", REASON_TITLE
    if blocked:
        return "needs_check", REASON_BLOCKED
    if wire:
        return "needs_check", REASON_WIRE
    return "ready", ""


def _attachment_proposals():
    """24 — 다른 초안에 붙는 임시 첨부 묶음(대상이 초안)의 id. 그 묶음의 초안은 할 일이 아니라 첨부 진행이다."""
    T = aliased(models.Entry)
    return (select(models.Batch.id).join(T, T.id == models.Batch.target_entry_id)
            .where(T.status == "draft"))


def draft_query(db: Session, user, scope: str = "mine", who: str = "all"):
    """보이는 초안(임시 첨부 초안은 뺀다) + 범위. scope: mine(내가 올린 묶음 + 내가 담당한 초안) | unclaimed | all.
    who(scope=mine 에서만): all | uploaded(내가 올린 것만) | assigned(내가 담당한 것만)."""
    E, B = models.Entry, models.Batch
    q = (db.query(E, B).join(B, B.id == E.batch_id)
         .filter(E.status == "draft", access.visible_entries_filter(user), ~B.id.in_(_attachment_proposals())))
    me = user.employee_id
    assigned = E.id.in_(access._draft_assignee_ids(me))
    if scope == "mine":
        q = q.filter({"uploaded": B.uploader == me, "assigned": assigned}.get(who, or_(B.uploader == me, assigned)))
    elif scope == "unclaimed":
        q = q.filter(B.uploader.is_(None))
    return q


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def draft_rows(db: Session, user, *, scope: str = "mine", who: str = "all", state: str | None = None,
               batch: str | None = None, q: str = "", offset: int = 0, limit: int = 500) -> dict:
    """줄 목록 {rows, counts, total} — counts 는 상태 거르기 전(다른 거르기는 적용한 뒤) 상태별 수."""
    from ..entries.service import ADMIN_TAKEOVER_DAYS, blocked_records

    E, B = models.Entry, models.Batch
    query = draft_query(db, user, scope, who)
    if batch:
        query = query.filter(B.key == batch)
    q = (q or "").strip()
    if q:
        like = _like(q)
        query = query.filter(or_(E.title.like(like, escape="\\"), E.entry_id == q.upper(),
                                 E.id.in_(select(models.EntryHull.entry_id)
                                          .where(models.EntryHull.hull_no.like(like, escape="\\"))),
                                 # 2026-11-25 — 담당자 이름으로도 찾는다(신고: '장영재' 로 찾으면 0건)
                                 E.id.in_(select(models.EntryAssignee.entry_id)
                                          .join(models.Person, models.Person.id == models.EntryAssignee.person_id)
                                          .where(models.Person.name.like(like, escape="\\")))))
    pairs = query.order_by(B.received_at.desc(), B.id.desc(), E.id).all()
    if not pairs:
        return {"rows": [], "counts": {s: 0 for s in STATES}, "total": 0}
    ids = [e.id for e, _b in pairs]
    batch_ids = {b.id for _e, b in pairs}

    files: dict[int, list[models.File]] = {}
    for f in db.query(models.File).filter(models.File.entry_id.in_(ids), models.File.location != "trash"):
        files.setdefault(f.entry_id, []).append(f)
    model_ids = [f.id for fs in files.values() for f in fs if f.kind == "model"]
    wire_flag = dict(db.query(models.ModelSummary.file_id, models.ModelSummary.lifting)
                     .filter(models.ModelSummary.file_id.in_(model_ids))) if model_ids else {}
    hulls: dict[int, list[str]] = {}
    for eid, no in (db.query(models.EntryHull.entry_id, models.EntryHull.hull_no).filter(models.EntryHull.entry_id.in_(ids))
                    .order_by(models.EntryHull.is_primary.desc(), models.EntryHull.hull_no)):
        hulls.setdefault(eid, []).append(no)
    targets: dict[int, str] = {}
    for eid, value in (db.query(models.EntryTag.entry_id, models.Tag.value)
                       .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                       .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind == "target").order_by(models.Tag.value)):
        targets.setdefault(eid, value)
    people: dict[int, list[dict]] = {}
    for eid, p in (db.query(models.EntryAssignee.entry_id, models.Person)
                   .join(models.Person, models.Person.id == models.EntryAssignee.person_id)
                   .filter(models.EntryAssignee.entry_id.in_(ids))
                   .order_by(models.EntryAssignee.sort_order, models.Person.id)):
        people.setdefault(eid, []).append({"name": p.name, "employee_id": p.employee_id})
    pending: dict[int, list[str]] = {}
    for tid, st in (db.query(B.target_entry_id, B.state)
                    .filter(B.target_entry_id.in_(ids), B.state.in_(PENDING_STATES))):
        pending.setdefault(tid, []).append(st)
    draft_count = dict(db.query(E.batch_id, func.count(E.id)).filter(E.batch_id.in_(batch_ids), E.status == "draft")
                       .group_by(E.batch_id))
    # 49 — WorkBench 출처 프로그램(권상 MU 판정). 파일의 묶음 기준(첨부로 옮겨 온 파일도 원래 묶음으로 바뀐다)
    file_batches = {f.batch_id for fs in files.values() for f in fs if f.batch_id}
    programs = {bid: o.get("program") for bid, o in db.query(B.id, B.origin)
                .filter(B.id.in_(file_batches or {0}), B.wb_analysis_id.isnot(None))
                if isinstance(o, dict) and o.get("program")}
    target_vocab = vocab.Vocab(db, "target")
    me = user.employee_id
    mine_assigned = {i for (i,) in db.execute(access._draft_assignee_ids(me).where(models.EntryAssignee.entry_id.in_(ids)))}
    admin = access.is_admin(user)
    my_team = access.team_id_of(db, user)   # 74 — 팀 초안은 팀원 누구나 고치고 확정한다
    takeover = datetime.now() - timedelta(days=ADMIN_TAKEOVER_DAYS)
    # 합치기 대상은 보는 사람이 볼 수 있을 때만 있는 것으로 친다(상세 응답 merge_into 와 같다 — 볼 수 없으면 숨긴다)
    merge_seen = access.visible_entry_pks(db, user, {e.merge_into_id for e, _b in pairs if e.merge_into_id})

    rows = []
    for e, b in pairs:
        fs = files.get(e.id, [])
        blocked = blocked_records(db, b, fs, draft_count.get(b.id, 0))
        wire_files = [f for f in fs if lifting.is_wire_model(f, SimpleNamespace(lifting=wire_flag.get(f.id)))]
        needed = lifting.is_mu(db, targets.get(e.id), [programs[f.batch_id] for f in fs if f.batch_id in programs],
                               target_vocab=target_vocab)
        merge_into = bool(e.merge_into_id) and e.merge_into_id in merge_seen
        wire = needs_wire(merge_into=merge_into, needed=needed, has_wire=bool(wire_files),
                          blocked_wire=any(lifting.name_is_lifting(str(r.get("name") or "").rsplit("/", 1)[-1])
                                           for r in blocked))
        st, reason = draft_state(batch_state=b.state, pending=pending.get(e.id, []), live_files=len(fs),
                                 title=e.title, blocked=bool(blocked), wire=wire)
        uploader = bool(e.uploaded_by and e.uploaded_by == me)
        assigned = e.id in mine_assigned
        team_member = my_team is not None and access.access_of(e) == "team" and e.team_id == my_team
        can_write = access.can_write(user)
        rows.append({
            "entry_id": e.entry_id, "title": e.title, "state": st, "reason": reason,
            "hulls": hulls.get(e.id, []), "no_hull": bool(e.no_hull), "target": targets.get(e.id),
            "assignees": people.get(e.id, []), "assigned_to_me": assigned,
            "file_count": len(fs), "merge_into": merge_into, "uploaded_by": e.uploaded_by,
            "batch": {"key": b.key, "name": b.original_name, "state": b.state, "source": b.source,
                      "uploader": b.uploader, "received_at": b.received_at.isoformat() if b.received_at else None},
            "can_edit": can_write and (admin or uploader or assigned or team_member),
            # 확정 권한(service._check_confirmer 와 같은 규칙)
            "can_confirm": can_write and (uploader or assigned or team_member
                                          or (admin and b.received_at is not None and b.received_at <= takeover)),
        })
    counts = {s: 0 for s in STATES}
    for r in rows:
        counts[r["state"]] += 1
    if state:
        wanted = set(state.split(","))
        rows = [r for r in rows if r["state"] in wanted]
    total = len(rows)
    return {"rows": rows[offset:offset + limit], "counts": counts, "total": total}
