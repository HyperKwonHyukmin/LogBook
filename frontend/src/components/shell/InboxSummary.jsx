import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../api/client.js';

/**
 * 62 — 내 정리 대기 요약(GET /api/batches/summary) 하나를 셸 전체가 같이 쓴다.
 * { drafts: 확정하지 않은 내 초안 수, staged: 서버가 정리 중인 묶음 수, uploading: 브라우저가 보내는 중인 묶음 수,
 *   names: [{name, state, received_at}] 진행 중 묶음 }
 * 쓰는 곳: 사이드 메뉴 '정리 대기' 배지 · 정리 대기의 '다른 창에서 올리는 중' 안내 · 폴더 창의 같은 이름 경고.
 * 30초마다(탭이 보일 때만) · 화면을 옮길 때 · refresh() 를 부를 때 다시 읽는다.
 */
const InboxSummaryContext = createContext(null);
const NONE = { summary: null, refresh: () => {} };

export function InboxSummaryProvider({ children, enabled = true, intervalMs = 30000 }) {
  const [summary, setSummary] = useState(null);
  const { pathname } = useLocation();
  const refresh = useCallback(() => {
    if (!enabled || document.visibilityState === 'hidden') return;
    api('/batches/summary').then(setSummary).catch(() => {});   // 못 읽으면 배지를 그대로 둔다
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(refresh, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, intervalMs, refresh]);
  const value = useMemo(() => ({ summary, refresh }), [summary, refresh]);
  return <InboxSummaryContext.Provider value={value}>{children}</InboxSummaryContext.Provider>;
}

/** { summary, refresh } — 공급자가 없으면(단독 렌더 테스트) summary 는 null. */
export const useInboxSummary = () => useContext(InboxSummaryContext) || NONE;
/** 테스트에서 요약 값을 바로 넣을 때. */
export const InboxSummaryContextForTest = InboxSummaryContext;

const norm = (s) => String(s || '').trim().toLowerCase();

/** 같은 이름의 진행 중 묶음(폴더 창 경고). 없으면 null. */
export function sameNameBatch(summary, name) {
  if (!summary?.names || !norm(name)) return null;
  return summary.names.find((b) => norm(b.name) === norm(name)) || null;
}
