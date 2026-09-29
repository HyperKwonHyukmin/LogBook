import { AlertCircle, FolderInput, Globe, Loader2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import DraftCard from './DraftCard.jsx';
import { BATCH_STATE_LABELS, EXCLUDE_REASON_LABELS } from '../../lib/labels.js';

/** 한 번에 올라온 배치 — 머리(출처·상태·제외 목록) + 초안 카드들. */
export default function BatchCard({ batch, me, isAdmin, onChanged, onClaim }) {
  const mine = batch.uploader === me;
  const drafts = batch.entries || [];
  const SourceIcon = batch.source === 'web' ? Globe : FolderInput;
  return (
    <section aria-label={`배치 ${batch.original_name}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <SourceIcon size={15} className="text-zinc-500" aria-hidden="true" />
        <h2 className="font-semibold">{batch.original_name}</h2>
        <span className="font-mono text-xs text-zinc-500">{batch.received_at ? batch.received_at.replace('T', ' ').slice(0, 16) : '—'}</span>
        <span className={`inline-flex items-center gap-1 rounded px-1.5 text-xs ${batch.state === 'failed' ? 'bg-red-50 text-err' : 'bg-zinc-100 text-zinc-700'}`}>
          {batch.state === 'staged' && <Loader2 size={11} className="animate-spin" aria-hidden="true" />}
          {BATCH_STATE_LABELS[batch.state] || batch.state}
        </span>
        {!batch.uploader && batch.owner_account && <span className="text-xs text-zinc-500">파일 소유 계정 <span className="font-mono">{batch.owner_account}</span></span>}
        <div className="flex-1" />
        {!batch.uploader && <Button size="sm" onClick={() => onClaim(batch.key)}>내가 올렸어요</Button>}
      </div>
      {batch.state === 'failed' && (
        <p className="flex items-center gap-1.5 text-[13px] text-err"><AlertCircle size={14} aria-hidden="true" />처리하지 못했습니다: {batch.error}</p>
      )}
      {batch.excluded?.length > 0 && (
        <details className="rounded-md border border-line bg-white px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer">제외된 파일 {batch.excluded.length}개</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {batch.excluded.map((x) => (
              <li key={x.name}>{x.name}{x.reason && <span className="ml-2 font-sans text-wait">{EXCLUDE_REASON_LABELS[x.reason] || x.reason}</span>}</li>
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
