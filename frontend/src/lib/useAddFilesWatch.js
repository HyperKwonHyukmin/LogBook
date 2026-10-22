import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { errorText } from './labels.js';
import { isRetryable } from './upload.js';

const POLL_MS = 2000;
const MAX_POLLS = 150; // 5분 — 큰 파일·워커가 바쁠 때
const MAX_ERRORS = 3; // 연속 일시 오류 — 이만큼 이어지면 실패로 알린다

/**
 * 확정 자료의 [파일 추가]로 올린 배치를 따라가며, 워커가 그 자료에 합치면 onMerged 를 부른다.
 * 서버는 정리 대기를 거치지 않고 곧장 합친다(worker → auto_merge_batch). 합치지 못하면
 * (대상이 그 사이 휴지통 등) 배치가 정리 대기에 남으므로 그곳으로 안내한다.
 * 상태: idle | working | done | inbox | failed | slow
 */
export function useAddFilesWatch({ onMerged }) {
  const [watch, setWatch] = useState({ state: 'idle' });
  const timer = useRef(null);
  // 47 — 멈춘 뒤 돌아온 응답은 버린다. 타이머만 지우면 응답을 기다리던 tick 이 다시 걸어 폴링이 되살아난다
  const generation = useRef(0);
  const mergedRef = useRef(onMerged);
  mergedRef.current = onMerged;

  const stop = useCallback(() => { generation.current += 1; clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback((key) => {
    stop();
    const gen = generation.current;
    setWatch({ state: 'working', key });
    let polls = 0;
    let errors = 0;
    const tick = async () => {
      polls += 1;
      let b;
      try {
        b = await api(`/batches/${encodeURIComponent(key)}`);
      } catch (err) {
        if (gen !== generation.current) return;
        // 일시 오류(망 끊김·5xx)는 몇 번 더 묻는다 — 한 번 끊겼다고 '실패'로 끝내지 않는다
        errors += 1;
        if (isRetryable(err) && errors < MAX_ERRORS && polls < MAX_POLLS) {
          timer.current = setTimeout(tick, POLL_MS);
          return;
        }
        setWatch({ state: 'failed', key, message: errorText(err, '추가 상태를 확인하지 못했습니다.') });
        return;
      }
      if (gen !== generation.current) return;
      errors = 0;
      // 17 — 워커가 완전 동일 BDF 로 뺀 파일(큰 파일·경합). 제외 수와 따로 알린다
      const duplicates = (b.excluded || []).filter((x) => x.reason === 'duplicate_model');
      const excluded = (b.excluded || []).filter((x) => !String(x.reason || '').startsWith('duplicate_')).length;
      if (b.state === 'done') {
        setWatch({ state: 'done', key, excluded, duplicates });
        mergedRef.current?.();
        return;
      }
      if (b.state === 'processed') { setWatch({ state: 'inbox', key, excluded, duplicates }); return; }
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
