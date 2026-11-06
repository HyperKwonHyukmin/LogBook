import { useEffect, useRef } from 'react';
import Button from './Button.jsx';

/**
 * 목록 끝 '더 보기' — 2026-11-06 목록 끝이 화면에 다가오면(300px 전) 저절로 다음 쪽을 받는다.
 * 단추는 그대로 둔다: 키보드·자동이 멈췄을 때(오류 등)·IntersectionObserver 가 없는 곳에서 손으로 누른다.
 * paused(불러오는 중·오류)면 받지 않고, 받은 뒤에도 끝이 여전히 보이면(행이 적어 화면이 안 찼을 때) 한 번 더 받는다.
 */
export default function AutoMore({ onMore, loading = false, paused = false, children = '더 보기' }) {
  const ref = useRef(null);
  const seen = useRef(false);      // 끝이 지금 화면 가까이에 있는가
  const busy = loading || paused;
  const busyRef = useRef(busy);
  const moreRef = useRef(onMore);
  busyRef.current = busy;
  moreRef.current = onMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      seen.current = entry.isIntersecting;
      if (entry.isIntersecting && !busyRef.current) moreRef.current();
    }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 한 쪽을 받고 나서도 끝이 보이면 이어서 받는다(관찰자는 '보임 상태가 바뀔 때'만 알려 준다)
  useEffect(() => {
    if (!busy && seen.current) moreRef.current();
  }, [busy]);

  return (
    <div ref={ref} className="flex justify-center py-4">
      <Button variant="secondary" onClick={onMore} disabled={loading} loading={loading}>{children}</Button>
    </div>
  );
}
