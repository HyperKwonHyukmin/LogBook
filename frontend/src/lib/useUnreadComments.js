import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

const INTERVAL_MS = 60000;

/**
 * 63 — 새 의견 수(내가 올린 자료에 남이 쓴 글 + 내 글에 남이 단 답글, 읽은 시각 뒤).
 * 화면을 옮길 때, 1분마다(탭이 보일 때만) 다시 읽는다. 못 읽으면 앞 값을 그대로 둔다.
 * 'logbook:comments-seen' 이벤트(새 의견 화면이 읽음 표시를 하면)에 0 으로 맞춘다.
 */
export function useUnreadComments(enabled = true) {
  const [unread, setUnread] = useState(0);
  const { pathname } = useLocation();
  const refresh = useCallback(() => {
    if (!enabled || document.visibilityState === 'hidden') return;
    api('/me/comments/summary').then((r) => setUnread(r?.unread || 0)).catch(() => {});
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(refresh, INTERVAL_MS);
    const onSeen = () => setUnread(0);
    window.addEventListener('logbook:comments-seen', onSeen);
    return () => { clearInterval(t); window.removeEventListener('logbook:comments-seen', onSeen); };
  }, [enabled, refresh]);
  return unread;
}
