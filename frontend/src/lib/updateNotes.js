/**
 * 70 업데이트 안내(Update Note) — 공유 주소, 그림 주소, 달 묶음, 새 안내 표시.
 * 내용은 서버 app/update_notes/notes.json(GET /api/update-notes). WorkBench 의 '업데이트 안내'를 본떴다.
 */
export const SEEN_KEY = 'logbook_update_notes_seen';
/** 본 기록이 바뀌면 같은 탭의 계정 메뉴가 새 글 수를 다시 센다. */
export const SEEN_EVENT = 'logbook:update-notes-seen';

/** 앱 안 경로 — 로그인 전이면 로그인 뒤 이 주소로 돌아온다(RequireAuth 의 from). */
export const notePath = (id) => `/update-notes/${encodeURIComponent(id)}`;

/** 메일과 메신저에 붙여 넣을 전체 주소. */
export const noteUrl = (id, origin = window.location.origin) => `${origin}${notePath(id)}`;

/** 그림은 로그인 없이 받는 주소(<img> 는 토큰을 못 보낸다). */
export const noteImageSrc = (src) => `/api/update-notes/img/${encodeURIComponent(src)}`;

/** 목록(최근 순) → [{ month: 'YYYY-MM', label: 'YYYY년 M월', items }]. */
export function groupByMonth(items) {
  const out = [];
  for (const it of items || []) {
    const month = (it.date || '').slice(0, 7);
    let g = out[out.length - 1];
    if (!g || g.month !== month) {
      g = { month, label: `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

export function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}

export function writeSeen(id) {
  if (!id) return;
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* 저장 못 해도 화면은 그대로 */ }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

/** 이 브라우저에서 지난번에 본 최신 안내 뒤로 새로 나온 안내 수(처음이면 최근 14일 안의 것만). */
export function unseenCount(items, seen, today = new Date()) {
  if (!items?.length) return 0;
  if (seen) {
    const i = items.findIndex((it) => it.id === seen);
    return i < 0 ? items.length : i;
  }
  const limit = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  return items.filter((it) => it.date >= limit).length;
}
