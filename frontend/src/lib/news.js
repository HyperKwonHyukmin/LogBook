import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * 72 — 새 자료 표시. 서버 /api/me/news 가 셈과 설정을 준다(사용자별, 두 PC 공통).
 * 본 것으로 표시하거나 설정을 바꾸면 NEWS_EVENT 를 쏘아 왼쪽 메뉴 숫자, 검색 줄, 결과 행이 함께 바뀐다.
 */
export const NEWS_EVENT = 'logbook:news';

export function announceNews(detail = {}) {
  window.dispatchEvent(new CustomEvent(NEWS_EVENT, { detail }));
}

/** 자료를 열었다 — 새 자료였으면 본 것으로(실패해도 화면은 그대로). */
export async function markSeen(entryId) {
  try {
    await api('/me/news/seen', { method: 'POST', body: { entry_id: entryId } });
    announceNews({ seen: entryId });
  } catch { /* 다음에 다시 열면 된다 */ }
}

export async function seenAll() {
  const r = await api('/me/news/seen-all', { method: 'POST' });
  announceNews({ all: true });
  return r;
}

/** 새 자료 요약 {enabled, count, since, targets, ship_types} — 처음, 알림 때, 창으로 돌아올 때 다시 묻는다. 실패하면 null. */
export function useNews() {
  const [news, setNews] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    api('/me/news').then((r) => { if (alive) setNews(r); }).catch(() => {});
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    window.addEventListener(NEWS_EVENT, reload);
    window.addEventListener('focus', reload);
    return () => { window.removeEventListener(NEWS_EVENT, reload); window.removeEventListener('focus', reload); };
  }, [reload]);
  return [news, reload];
}

export const countText = (n) => (n > 99 ? '99+' : String(n));
