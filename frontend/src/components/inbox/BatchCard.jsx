import { AlertCircle, ChevronRight, FolderInput, Globe } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import DraftCard from './DraftCard.jsx';
import { BATCH_STATE_LABELS, EXCLUDE_REASON_LABELS } from '../../lib/labels.js';

const STATE_TONE = { failed: 'text-err', staged: 'text-n-600', processed: 'text-wait', done: 'text-ok', uploading: 'text-n-600' };

/** 한 번에 올라온 배치 = 섹션 — 머리(출처·받은 시각·상태) + 제외 목록 + 초안들. */
export default function BatchCard({ batch, me, isAdmin, onChanged, onClaim }) {
  const mine = batch.uploader === me;
  const drafts = batch.entries || [];
  const SourceIcon = batch.source === 'web' ? Globe : FolderInput;
  return (
    <section aria-label={`배치 ${batch.original_name}`} className="flex flex-col gap-3">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <SourceIcon size={14} className="text-n-400" aria-hidden="true" title={batch.source === 'web' ? '웹에서 올림' : '00_Inbox 에서 받음'} />
        <h2 className="text-ui font-semibold text-n-900">{batch.original_name}</h2>
        <span className="font-mono text-meta text-n-500">{batch.received_at ? batch.received_at.replace('T', ' ').slice(0, 16) : '—'}</span>
        <span className={`inline-flex items-center gap-1.5 text-meta font-medium ${STATE_TONE[batch.state] || 'text-n-600'}`}>
          {batch.state === 'staged' ? <Spinner size={12} /> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
          {BATCH_STATE_LABELS[batch.state] || batch.state}
        </span>
        {drafts.length > 0 && <span className="text-meta text-n-500">초안 <span className="font-mono">{drafts.length}</span>개</span>}
        {!batch.uploader && batch.owner_account && (
          <span className="text-meta text-n-500">파일 소유 계정 <span className="font-mono text-n-700">{batch.owner_account}</span></span>
        )}
        <div className="flex-1" />
        {!batch.uploader && <Button size="sm" onClick={() => onClaim(batch.key)}>내가 올렸어요</Button>}
      </div>
      {batch.state === 'failed' && (
        <p className="flex items-center gap-1.5 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
          <AlertCircle size={14} aria-hidden="true" />처리하지 못했습니다: {batch.error}
        </p>
      )}
      {batch.excluded?.length > 0 && (
        <details className="group rounded-md border border-n-200 text-meta text-n-600">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-3 hover:bg-n-25 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="text-n-400 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
            제외된 파일 <span className="font-mono">{batch.excluded.length}</span>개
          </summary>
          <ul className="space-y-0.5 border-t border-n-200 px-3 py-2">
            {batch.excluded.map((x) => (
              <li key={x.name} className="flex flex-wrap gap-x-2">
                <span className="text-n-800">{x.name}</span>
                {x.reason && <span className="text-wait">{EXCLUDE_REASON_LABELS[x.reason] || x.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.entry_id} entry={d} canEdit={mine || isAdmin}
                   siblings={drafts.filter((s) => s.entry_id !== d.entry_id).map((s) => ({ entry_id: s.entry_id, title: s.title }))}
                   onChanged={onChanged} />
      ))}
    </section>
  );
}
