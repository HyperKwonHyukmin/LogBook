import { BadgeCheck, Copy } from 'lucide-react';
import { formatDateTime } from '../../lib/labels.js';

/**
 * 39 — WorkBench 해석 출처(Hi-TESS Core 1단계). 서버가 LOGBOOK_WB_ORIGIN_SHOW 를 켰을 때만 wb_origins 를 싣는다.
 * 'WB #123 · 프로그램 · 해석자 · 해석 일시'와, 해석 여권의 산출물과 sha256 이 같은 파일('WB 산출물과 같음').
 */
export default function WbOrigins({ origins, files, onCopy }) {
  if (!origins?.length) return null;
  const nameOf = new Map((files || []).map((f) => [f.id, f.name]));
  return (
    <ul aria-label="WorkBench 출처" className="flex min-w-0 flex-col gap-2">
      {origins.map((o) => (
        <li key={o.analysis_id} className="min-w-0 text-meta text-n-600">
          <span className="flex items-center gap-1">
            <span className="font-mono text-ui font-medium text-n-900">{o.label}</span>
            <button type="button" onClick={() => onCopy(o.label)} aria-label={`${o.label} 복사`} title="번호 복사"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-n-500 hover:bg-n-100 hover:text-n-900">
              <Copy size={12} aria-hidden="true" />
            </button>
          </span>
          {/* 속성 칸이 좁다 — 해석자 사번이 잘리지 않게 자르지 않고 줄을 바꾼다 */}
          <span className="block break-words" title={o.project || undefined}>
            {[o.program, o.owner && `해석 ${o.owner}`, o.created_at && formatDateTime(o.created_at).slice(0, 10)].filter(Boolean).join(' · ')}
          </span>
          {o.matched?.length > 0 && (
            <span className="mt-0.5 flex items-start gap-1 text-ok" title="WorkBench 해석 여권의 산출물과 sha256 이 같은 파일">
              <BadgeCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0">WB 산출물과 같음 — {o.matched.map((m) => nameOf.get(m.file_id) || m.name).join(', ')}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
