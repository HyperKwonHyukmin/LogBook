import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { errorText } from './labels.js';

const POLL_MS = 2000;
const MAX_POLLS = 150; // 5분 — 큰 파일·워커가 바쁠 때

/**
 * 확정 자료의 [파일 추가]로 올린 배치를 따라가며, 워커가 그 자료에 합치면 onMerged 를 부른다.
 * 서버는 정리 대기를 거치지 않고 곧장 합친다(worker → auto_merge_batch). 합치지 못하면
 * (대상이 그 사이 휴지통 등) 배치가 정리 대기에 남으므로 그곳으로 안내한다.
 * 상태: idle | working | done | inbox | failed | slow
 */
export function useAddFilesWatch({ onMerged }) {
  const [watch, setWatch] = useState({ state: 'idle' });
  const timer = useRef(null);
  const mergedRef = useRef(onMerged);
  mergedRef.current = onMerged;

  const stop = useCallback(() => { clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback((key) => {
    stop();
    setWatch({ state: 'working', key });
    let polls = 0;
    const tick = async () => {
      polls += 1;
      let b;
      try {
        b = await api(`/batches/${encodeURIComponent(key)}`);
      } catch (err) {
        setWatch({ state: 'failed', key, message: errorText(err, '추가 상태를 확인하지 못했습니다.') });
        return;
      }
      const excluded = (b.excluded || []).length;
      if (b.state === 'done') {
        setWatch({ state: 'done', key, excluded });
        mergedRef.current?.();
        return;
      }
      if (b.state === 'processed') { setWatch({ state: 'inbox', key, excluded }); return; }
      if (b.state === 'failed') { setWatch({ state: 'failed', key, message: b.error || '처리하지 못했습니다.' }); return; }
      if (polls >= MAX_POLLS) { setWatch({ state: 'slow', key }); return; }
      setWatch({ state: 'working', key, workerDown: b.queue?.worker_alive === false });
      timer.current = setTimeout(tick, POLL_MS);
    };
    timer.current = setTimeout(tick, POLL_MS);
  }, [stop]);

  const reset = useCallback(() => { stop(); setWatch({ state: 'idle' }); }, [stop]);
  return { watch, start, reset };
}
