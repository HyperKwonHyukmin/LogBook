import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { hasPendingConvert } from '../../lib/inboxStatus.js';
import Button from '../ui/Button.jsx';
import { BlockSkeleton } from '../ui/Skeleton.jsx';
import { ErrorNote } from '../ui/Page.jsx';
import DraftCard from './DraftCard.jsx';

const POLL_MS = 5000;
const CONVERT_POLL_MS = 15000;

/**
 * 68 — 상세 칸: 고른 초안 하나를 GET /api/entries/{id} 로 읽어 예전 초안 카드(DraftCard)로 그린다.
 * 첨부가 진행 중이면 5초, BDF 3D 변환만 남았으면 15초마다 다시 읽는다(카드는 version, 파일이 같으면 입력을 지우지 않는다).
 * ref = DraftCard 의 { saveForLeave } (다른 줄로 옮길 때 [저장하고 이동]).
 * onGone — 초안이 사라짐(확정, 버림, 볼 수 없음). 부모가 목록을 새로 부르고 다음 줄을 고른다.
 */
const DraftDetail = forwardRef(function DraftDetail({ entryId, siblings, batchName, onShowBatch, onBack,
  onChanged, onDirtyChange, onConfirmed, onGone }, ref) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const req = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(() => {
    const id = ++req.current;
    inFlight.current = true;
    return api(`/entries/${entryId}`)
      .then((e) => {
        if (id !== req.current) return;
        if (e.status !== 'draft') { setEntry(null); onGone?.(); return; }
        setEntry(e); setError('');
      })
      .catch((err) => {
        if (id !== req.current) return;
        if (err?.status === 404) { setEntry(null); onGone?.(); return; }
        setError(errorText(err, '초안을 불러오지 못했습니다.'));
      })
      .finally(() => { if (id === req.current) inFlight.current = false; });
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps -- onGone 은 부모가 매번 새로 준다
  useEffect(() => { setEntry(null); setError(''); load(); }, [load]);

  const attaching = (entry?.pending_attachments || []).some((p) => p.state !== 'failed');
  const converting = !attaching && entry && hasPendingConvert({ entries: [entry] });
  const pollMs = attaching ? POLL_MS : converting ? CONVERT_POLL_MS : 0;
  useEffect(() => {
    if (!pollMs) return undefined;
    // 앞 요청이 아직이면 건너뛴다 — 응답이 폴링 간격보다 늦으면 새 요청이 늘 앞 응답을 버려 화면이 멈춘다
    const t = setInterval(() => { if (!inFlight.current) load(); }, pollMs);
    return () => clearInterval(t);
  }, [pollMs, load]);

  const changed = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />목록으로</Button>
        )}
        {batchName && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-meta text-n-600">
            <Layers size={13} className="shrink-0 text-n-500" aria-hidden="true" />
            <span className="shrink-0">묶음</span>
            <span className="min-w-0 truncate text-n-800">{batchName}</span>
            {onShowBatch && <Button variant="ghost" size="sm" onClick={onShowBatch}>묶음 보기</Button>}
          </span>
        )}
      </div>
      {error && <ErrorNote action={<Button variant="secondary" size="sm" onClick={load}>다시 읽기</Button>}>{error}</ErrorNote>}
      {!entry && !error && <BlockSkeleton className="h-64" />}
      {entry && (
        // 68 — 초안 사이 옮기기, 합치기는 올린 사람과 LV3 만(서버 owner_required). 담당자에게는 같은 묶음 초안 목록을 주지 않는다
        <DraftCard key={entry.entry_id} ref={ref} entry={entry} canEdit={!!entry.can_edit}
                   siblings={entry.can_discard === false ? [] : siblings}
                   onChanged={changed} onDirtyChange={onDirtyChange} onConfirmed={onConfirmed} />
      )}
    </div>
  );
});

export default DraftDetail;
