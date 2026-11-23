/**
 * 68 — '올리기와 확정' 목록 + 상세 화면의 순수 함수. 초안 상태는 서버(GET /api/inbox/drafts, backend entries/inbox_rows.py)가
 * 정하고, 화면은 묶음으로 모으고, 거르고, 한꺼번에 확정할 초안을 고른다. '저장하지 않은 변경'만 화면이 덧붙인다.
 */

/** 서버 상태 → 칩 글자. 순서 = 할 일 순(서버 STATES 와 같다). */
export const DRAFT_STATES = ['ready', 'needs_check', 'attach_failed', 'waiting_files', 'attaching', 'processing'];
export const DRAFT_STATE_LABELS = {
  ready: '확정 가능', needs_check: '확인 필요', attach_failed: '첨부 실패',
  waiting_files: '파일 기다림', attaching: '첨부 중', processing: '처리 중',
};
/** 칩 색 — 글자색과 점 색(Tailwind 토큰). */
export const DRAFT_STATE_TONES = {
  ready: 'text-ok', needs_check: 'text-wait', attach_failed: 'text-err',
  waiting_files: 'text-n-600', attaching: 'text-n-600', processing: 'text-n-600',
};
const ORDER = Object.fromEntries(DRAFT_STATES.map((s, i) => [s, i]));
/** 저장하지 않은 변경이 있는 초안의 이유(서버는 모른다). */
export const REASON_DIRTY = '저장하지 않은 변경';

const byTime = (a, b) => String(b || '').localeCompare(String(a || ''));

/**
 * 줄(rows)과 묶음 머리(batches, ?lite=1)를 묶음별로 모은다.
 * - 줄이 없는 묶음도 할 일이 남았으면(분석 중, 처리 실패, 자동 확정 결과) 머리만 보인다.
 * - 끝났고 줄도 없는 묶음(같은 BDF 뿐 등)은 settled 로 따로(맨 아래 접힌 줄).
 * - 다른 초안에 붙이는 임시 첨부 묶음(attachment_target)은 줄의 '첨부 중'으로 보이므로 뺀다.
 * - stateFilter(Set)가 있으면 그 상태 줄만 남기고, 남은 줄이 없는 묶음은 뺀다.
 * → { groups: [{ key, name, received_at, state, uploader, source, batch|null, rows }], settled: [batch] }
 */
export function groupRows(rows, batches, stateFilter = null) {
  const map = new Map();
  const settled = [];
  for (const b of batches || []) {
    if (b.attachment_target) continue;
    if (b.state === 'done' && !(rows || []).some((r) => r.batch.key === b.key)) {
      if (b.auto_result) map.set(b.key, { ...head(b), batch: b, rows: [] });
      else settled.push(b);
      continue;
    }
    map.set(b.key, { ...head(b), batch: b, rows: [] });
  }
  for (const r of rows || []) {
    if (!map.has(r.batch.key)) map.set(r.batch.key, { ...head(r.batch), batch: null, rows: [] });
    map.get(r.batch.key).rows.push(r);
  }
  let groups = [...map.values()];
  for (const g of groups) g.rows.sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || a.entry_id.localeCompare(b.entry_id));
  groups.sort((a, b) => byTime(a.received_at, b.received_at));
  if (stateFilter && stateFilter.size) {
    groups = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => stateFilter.has(r.state)) })).filter((g) => g.rows.length);
  }
  return { groups, settled };
}

function head(b) {
  return { key: b.key, name: b.original_name ?? b.name, received_at: b.received_at, state: b.state,
    uploader: b.uploader, source: b.source };
}

/** 묶음 순서대로 펼친 줄(위·아래 고르기, 확정 뒤 다음 줄로). */
export const flatRows = (groups) => groups.flatMap((g) => g.rows);

/**
 * 한꺼번에 확정 — 고른 줄 중 확정할 것과 건너뛸 것. 확정 권한이 있고 '확정 가능'인 줄만 보낸다.
 * dirtyId = 지금 상세에서 고치고 저장하지 않은 초안. → { go: [row], skip: [{ row, reason }] }
 */
export function bulkPick(rows, dirtyId = null) {
  const go = [];
  const skip = [];
  for (const r of rows) {
    const reason = r.entry_id === dirtyId ? REASON_DIRTY
      : !r.can_confirm ? '확정 권한 없음'
        : r.state === 'ready' ? ''
          : r.reason || DRAFT_STATE_LABELS[r.state] || r.state;
    if (reason) skip.push({ row: r, reason }); else go.push(r);
  }
  return { go, skip };
}

/** 줄 한 개의 둘째 줄 글자 — 호선, 담당자, 파일 수. */
export function rowMeta(r) {
  const parts = [];
  if (r.hulls?.length) parts.push(r.hulls.join(', '));
  else if (r.no_hull) parts.push('공용');
  if (r.assignees?.length) parts.push(`담당 ${r.assignees.map((a) => a.name).join(', ')}`);
  parts.push(`파일 ${r.file_count}`);
  return parts;
}
