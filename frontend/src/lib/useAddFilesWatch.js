import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { errorText } from './labels.js';
import { isRetryable } from './upload.js';
import { stagedStatus } from './inboxStatus.js';

const POLL_MS = 2000;
// 62 — 2분이 지나면 10초마다 계속 확인한다(워커가 3D 변환 등 앞 작업을 하면 몇 분 걸린다). 30분이 지나면 멈추고 [다시 확인]
const SLOW_AFTER_POLLS = 60;
const SLOW_POLL_MS = 10000;
const MAX_POLLS = SLOW_AFTER_POLLS + 170;
const MAX_ERRORS = 3; // 연속 일시 오류 — 이만큼 이어지면 실패로 알린다
// 62 — 배치 excluded 중 '제외'가 아닌 안내(이름 바뀜 · 이 자료에 이미 있음 · 동일 BDF)
const NOTE_REASONS = new Set(['renamed', 'duplicate_in_entry', 'duplicate_model', 'duplicate_include']);

/** 끝난 배치 → 결과 요약 {added:[{id, rel_path}], renamed:[{name,to}], same:[{name,of}], duplicates, excluded}. */
export function addResult(b) {
  const ex = b.excluded || [];
  return {
    added: b.added || [],
    renamed: ex.filter((x) => x.reason === 'renamed'),
    same: ex.filter((x) => x.reason === 'duplicate_in_entry'),
    // 17 — 워커가 완전 동일 BDF 로 뺀 파일(큰 파일·경합)
    duplicates: ex.filter((x) => x.reason === 'duplicate_model'),
    excluded: ex.filter((x) => !NOTE_REASONS.has(x.reason)).length,
  };
}

/**
 * 확정 자료의 [파일 추가]로 올린 배치를 따라가며, 워커가 그 자료에 합치면 onMerged(결과)를 부른다.
 * 서버는 정리 대기를 거치지 않고 곧장 합친다(worker → auto_merge_batch). 합치지 못하면
 * (대상이 그 사이 휴지통 등) 배치가 정리 대기에 남으므로 그곳으로 안내한다.
 * 상태: idle | working(line = 지금 무엇을 기다리는지) | done(결과) | inbox | failed | slow
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
    const next = () => { timer.current = setTimeout(tick, polls >= SLOW_AFTER_POLLS ? SLOW_POLL_MS : POLL_MS); };
    async function tick() {
      polls += 1;
      let b;
      try {
        b = await api(`/batches/${encodeURIComponent(key)}`);
      } catch (err) {
        if (gen !== generation.current) return;
        // 일시 오류(망 끊김·5xx)는 몇 번 더 묻는다 — 한 번 끊겼다고 '실패'로 끝내지 않는다
        errors += 1;
        if (isRetryable(err) && errors < MAX_ERRORS && polls < MAX_POLLS) { next(); return; }
        setWatch({ state: 'failed', key, message: errorText(err, '추가 상태를 확인하지 못했습니다.') });
        return;
      }
      if (gen !== generation.current) return;
      errors = 0;
      if (b.state === 'done') {
        const result = addResult(b);
        setWatch({ state: 'done', key, ...result });
        mergedRef.current?.(result);
        return;
      }
      if (b.state === 'processed') { setWatch({ state: 'inbox', key, ...addResult(b) }); return; }
      if (b.state === 'failed') { setWatch({ state: 'failed', key, message: b.error || '처리하지 못했습니다.' }); return; }
      if (polls >= MAX_POLLS) { setWatch({ state: 'slow', key }); return; }
      // 62 — 정리 대기와 같은 말로 '지금 무엇을 기다리는지'(앞 작업 · 워커 꺼짐 · 파일 확인 n/N)
      const st = b.state === 'staged' ? stagedStatus(b) : null;
      setWatch({ state: 'working', key, workerDown: b.queue?.worker_alive === false, line: st?.line || '', wait: st?.tone === 'wait' });
      next();
    }
    timer.current = setTimeout(tick, POLL_MS);
  }, [stop]);

  const reset = useCallback(() => { stop(); setWatch({ state: 'idle' }); }, [stop]);
  return { watch, start, reset };
}
