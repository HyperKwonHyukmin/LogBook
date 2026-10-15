import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import Button from '../ui/Button.jsx';
import { UploadButtons, UploadFeedback, useUploader } from './UploadZone.jsx';

/**
 * Targeted upload stays in the selected draft; final approval remains on its card.
 * 끌어 놓기는 카드(DraftCard)가 받아 ref.drop(dataTransfer) 로 넘긴다 — 놓을 곳이 카드 전체라야 좁은 띠를 노리지 않는다.
 */
const DraftAttachments = forwardRef(function DraftAttachments({ entry, disabled, onChanged, onBusyChange }, ref) {
  const [open, setOpen] = useState(false);
  const [watch, setWatch] = useState({ state: 'idle' });
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [dropNote, setDropNote] = useState('');
  const panel = useRef(null);
  const focusOnOpen = useRef(false);
  const generation = useRef(0);
  const timer = useRef(null);
  const callback = useRef(onChanged);
  callback.current = onChanged;
  const stop = useCallback(() => { generation.current += 1; clearTimeout(timer.current); }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback((key) => {
    stop();
    const id = generation.current;
    let polls = 0;
    setWatch({ state: 'working', key });
    callback.current?.();
    const tick = async () => {
      try {
        const batch = await api(`/batches/${encodeURIComponent(key)}`);
        if (id !== generation.current) return;
        if (batch.state === 'done') {
          setWatch({ state: 'done', key, excluded: batch.excluded?.length || 0 });
          callback.current?.();
          return;
        }
        if (batch.state === 'failed') {
          setWatch({ state: 'failed', key }); callback.current?.(); return;
        }
        // 'processed' is temporary: attachment worker still has to merge proposals.
        if (++polls >= 150) {
          setWatch({ state: 'slow', key }); callback.current?.(); return;
        }
        timer.current = setTimeout(tick, 2000);
      } catch (err) {
        if (id === generation.current) { setError(errorText(err, '첨부 상태를 확인하지 못했습니다.')); setWatch({ state: 'slow', key }); }
      }
    };
    timer.current = setTimeout(tick, 500);
  }, [stop]);
  const pending = entry.pending_attachments || [];
  const u = useUploader({ scope: `draft:${entry.entry_id}`, targetEntryId: entry.entry_id, targetEntryStatus: 'draft', onUploaded: start,
    away: { title: `${entry.entry_id} 초안에 첨부`, message: '초안에 붙일 파일을 올렸습니다. 정리 대기에서 첨부 결과를 확인하세요.', to: '/inbox', label: '정리 대기로' },
    disabled: disabled || pending.length > 0 || watch.state === 'working' });
  const busy = u.busy || watch.state === 'working' || releasing;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  /** 카드에 끌어 놓은 파일 — [파일 추가] → 파일 선택과 같은 첨부 업로드. */
  useImperativeHandle(ref, () => ({
    drop(dataTransfer) {
      setOpen(true);
      if (disabled || busy || u.disabled) {
        setDropNote(busy || pending.length > 0 ? '첨부가 끝난 뒤 다시 놓아 주세요.' : '지금은 이 초안에 첨부할 수 없습니다.');
        return;
      }
      setDropNote('');
      u.onDrop(dataTransfer);
    },
  }));
  // [파일 추가]로 펼치면 키보드 포커스를 드러난 첫 단추(파일 선택)로 옮긴다
  useEffect(() => {
    if (open && focusOnOpen.current) panel.current?.querySelector('button:not(:disabled)')?.focus();
    focusOnOpen.current = false;
  }, [open]);

  async function release(key) {
    setReleasing(true); setError('');
    try {
      await api(`/entries/${entry.entry_id}/attachments/${encodeURIComponent(key)}/release`, { method: 'POST' });
      stop(); setWatch({ state: 'idle' }); callback.current?.();
    } catch (err) { setError(errorText(err, '첨부 연결을 해제하지 못했습니다.')); }
    finally { setReleasing(false); }
  }

  return (
    <section aria-label="이 초안에 파일 추가" className="border-t border-n-200 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={disabled || busy} aria-expanded={open}
          onClick={() => { focusOnOpen.current = !open; setOpen(!open); }}><Paperclip size={14} aria-hidden="true" />파일 추가</Button>
        <span className="text-meta text-n-600">보고서 등을 이 자료에 첨부해 함께 확정합니다. 파일을 이 카드에 끌어 놓아도 됩니다.</span>
      </div>
      {dropNote && <p role="status" className="mt-2 text-meta text-wait">{dropNote}</p>}
      {open && <div ref={panel} className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-2"><UploadButtons u={u} /></div>
        <UploadFeedback u={{ ...u, disabled: false }} showSuccess={false} />
      </div>}
      {(busy || pending.some((p) => p.state !== 'failed')) && <p role="status" className="mt-2 text-meta text-n-600">파일 첨부 중입니다. 같은 목록에 추가된 뒤 확정할 수 있습니다.</p>}
      {watch.state === 'done' && <p role="status" className="mt-2 text-meta text-n-700">첨부 처리가 끝났습니다. 아래 파일 목록을 확인한 뒤 함께 확정하세요.{watch.excluded > 0 && ` 제외된 파일 ${watch.excluded}개는 정리 대기 배치에서 확인해 주세요.`}</p>}
      {watch.state === 'slow' && <p role="status" className="mt-2 text-meta text-wait">첨부가 지연되고 있습니다. <Button variant="ghost" size="sm" onClick={() => start(watch.key)}>상태 다시 확인</Button></p>}
      {(watch.state === 'failed' || pending.some((p) => p.state === 'failed')) && <div role="alert" className="mt-2 text-meta text-err">
        첨부하지 못했습니다. 원본 초안은 유지됩니다. 파일은 별도 배치에 보존됩니다.
        {[...new Set([...pending.filter((p) => p.state === 'failed').map((p) => p.key), ...(watch.state === 'failed' ? [watch.key] : [])])].map((key) => (
          <Button key={key} variant="secondary" size="sm" className="ml-2" disabled={releasing}
            onClick={() => release(key)}>첨부 연결 해제</Button>
        ))}
      </div>}
      {error && <p role="alert" className="mt-2 text-meta text-err">{error}</p>}
    </section>
  );
});

export default DraftAttachments;
