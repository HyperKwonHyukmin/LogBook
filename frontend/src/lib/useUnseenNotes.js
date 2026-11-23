import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { SEEN_EVENT, readSeen, unseenCount } from './updateNotes.js';

/**
 * 70 — 이 브라우저에서 아직 안 본 업데이트 안내 수(계정 메뉴 '업데이트 안내' 옆).
 * 목록은 한 번만 묻는다. 안내 화면이 본 기록을 쓰면(SEEN_EVENT) 바로 다시 센다. 실패하면 0.
 */
export function useUnseenNotes() {
  const [items, setItems] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api('/update-notes').then((r) => { if (alive) setItems(r?.items || []); }).catch(() => {});
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(SEEN_EVENT, bump);
    window.addEventListener('storage', bump);   // 다른 탭에서 본 것
    return () => { alive = false; window.removeEventListener(SEEN_EVENT, bump); window.removeEventListener('storage', bump); };
  }, []);
  return useMemo(() => unseenCount(items, readSeen()), [items, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
}
