import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../../api/client.js';

/**
 * 66 — 올리기 절차도: ① 올리기 → ② 분류 확인 → ③ 확정. 처음 쓰는 사람이 '올렸는데 왜 검색에 안 나오지'를 겪지 않게
 * 지금 몇 단계이고 다음에 무엇을 해야 하는지 보인다(사용자 요청 2026-11-20). '올리고 바로 확정'이면 ② 를 '자동 확인'으로 쓴다.
 * 색만으로 말하지 않는다 — 끝난 단계는 체크 아이콘, 지금 단계는 굵은 글자와 '(지금)' 읽기 글자.
 */
export const STEP_LABELS = ['올리기', '분류 확인', '확정'];

export default function UploadSteps({ current, done = 0, auto = false, className = '' }) {
  const labels = auto ? ['올리기', '자동 확인', '확정'] : STEP_LABELS;
  return (
    <ol aria-label="올리기 절차" className={`flex items-center gap-1.5 text-meta ${className}`}>
      {labels.map((label, i) => {
        const n = i + 1;
        const finished = n <= done;
        const now = !finished && n === current;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className={`h-px w-5 ${n <= Math.max(done, current) ? 'bg-brand' : 'bg-n-250'}`} />}
            <span aria-current={now ? 'step' : undefined}
                  className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 ${now ? 'bg-brand text-on-navy' : finished ? 'bg-brand-subtle text-brand' : 'bg-n-100 text-n-600'}`}>
              {finished ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : <span className="font-mono">{n}</span>}
              <span className={now ? 'font-semibold' : 'font-medium'}>{label}</span>
              {now && <span className="sr-only">(지금)</span>}
              {finished && <span className="sr-only">(끝남)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const FOLLOW_MS = 3000;
const FOLLOW_LIMIT_MS = 10 * 60 * 1000;

/**
 * 올리기가 끝난 묶음을 서버가 정리하는 동안 따라간다(3초마다, 최대 10분). 정리가 끝나면(processed·done·failed, 바로 확정이면
 * auto_result 까지) 멈춘다. → batch | null
 */
export function useBatchFollow(key, enabled) {
  const [batch, setBatch] = useState(null);
  useEffect(() => {
    if (!key || !enabled) return undefined;
    let alive = true;
    let timer = null;
    const started = Date.now();
    const tick = async () => {
      let b = null;
      try { b = await api(`/batches/${encodeURIComponent(key)}`); } catch { /* 다음 차례에 다시 */ }
      if (!alive) return;
      if (b) setBatch(b);
      const settled = b && (b.state === 'failed' || ((b.state === 'processed' || b.state === 'done') && (!b.auto_confirm || b.auto_result)));
      if (!settled && Date.now() - started < FOLLOW_LIMIT_MS) timer = setTimeout(tick, FOLLOW_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [key, enabled]);
  return batch;
}

/**
 * 올리기 상황(u)과 따라간 묶음(batch)으로 단계와 안내 한 줄을 정한다.
 * → { current, done, auto, text, go } — go 가 참이면 '올리기와 확정으로' 단추를 보인다.
 */
export function stepState(u, batch) {
  const auto = !!u.autoConfirm;
  if (u.busy || u.resumable || !(u.result?.uploaded > 0)) {
    return { current: 1, done: 0, auto, text: auto ? '올린 뒤 서버가 확인하고 문제없는 자료는 바로 확정합니다.' : '올린 뒤 분류를 확인하고 [확정]을 눌러야 검색에 나옵니다.' };
  }
  if (!batch || batch.state === 'staged' || batch.state === 'uploading' || (auto && !batch.auto_result && batch.state !== 'failed')) {
    return { current: 2, done: 1, auto, text: '서버가 파일을 정리하는 중입니다. 잠시 기다려 주세요.' };
  }
  if (batch.state === 'failed') return { current: 2, done: 1, auto, text: '서버가 정리하지 못했습니다. 올리기와 확정에서 확인해 주세요.', go: true };
  if (auto) {
    const ok = batch.auto_result?.confirmed?.length || 0;
    const kept = batch.auto_result?.kept?.length || 0;
    if (!kept) return { current: 3, done: 3, auto, text: `확정까지 끝났습니다. 자료 ${ok}건이 검색에 나옵니다.` };
    return { current: 2, done: 1, auto, go: true,
      text: `${ok ? `자료 ${ok}건은 확정했습니다. ` : ''}확인이 필요한 초안 ${kept}건이 남았습니다. 올리기와 확정에서 보고 [확정]을 눌러 주세요.` };
  }
  const n = (batch.entries || []).length;
  return { current: 2, done: 1, auto, go: true,
    text: `지금 2단계입니다. 올리기와 확정에서 초안${n ? ` ${n}건의` : '의'} 분류를 확인하고 [확정]을 누르면 3단계(검색에 나옴)가 됩니다.` };
}
