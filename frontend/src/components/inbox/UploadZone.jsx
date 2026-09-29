import { useEffect, useRef, useState } from 'react';
import { FolderUp, UploadCloud } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { collectFromDrop, collectFromInput, uploadBatch } from '../../lib/upload.js';
import { errorText, formatBytes } from '../../lib/labels.js';

const BUSY_NOTICE = '올리는 중입니다. 지금 올리기가 끝난 뒤 다시 놓아 주세요.';

/** 폴더·여러 파일 끌어 놓기/선택 → 한 배치로 올린다. DRM 파일은 거부하고 탐색기 경로를 안내한다. */
export default function UploadZone({ onUploaded, disabled = false }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const dirRef = useRef(null);
  const [notice, setNotice] = useState('');

  // 올리는 동안: 영역 밖에 떨어뜨린 파일을 브라우저가 열어 페이지를 떠나지 않게 하고, 창 닫기를 경고한다.
  useEffect(() => {
    if (!busy) return undefined;
    // 바깥(탐색기)에서 끌어 온 파일만 다룬다. 화면 안의 끌기(초안 카드 파일 옮기기)나 이미 처리된 놓기는 그대로 둔다.
    const isOsFileDrag = (e) => !e.defaultPrevented && Array.from(e.dataTransfer?.types || []).includes('Files');
    const block = (e) => { if (isOsFileDrag(e)) e.preventDefault(); };
    const onDrop = (e) => { if (isOsFileDrag(e)) { e.preventDefault(); setNotice(BUSY_NOTICE); } };
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [busy]);

  async function start(items) {
    if (!items.length || busy) return;
    setBusy(true); setError(''); setNotice(''); setResult(null); setProgress({ sent: 0, total: 1 });
    try {
      const res = await uploadBatch(items, { onProgress: setProgress });
      setResult(res);
      onUploaded(res.key);
    } catch (err) {
      if (err.code === 'all_drm') setResult({ uploaded: 0, rejected: err.rejected });
      setError(err.code === 'all_drm' ? '모든 파일이 DRM 암호화 상태라 올리지 않았습니다.' : errorText(err, '올리기에 실패했습니다. 다시 시도해 주세요.'));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const pct = progress ? Math.floor((progress.sent / Math.max(progress.total, 1)) * 100) : 0;
  return (
    <section aria-label="자료 올리기" className="rounded-lg border border-line bg-white p-4">
      <div
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); if (!busy) setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setOver(false);
          if (disabled) return;
          if (busy) { setNotice(BUSY_NOTICE); return; }
          start(await collectFromDrop(e.dataTransfer));
        }}
        className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-6 py-7 text-center transition-colors ${over ? 'border-brand bg-brand-tint' : 'border-zinc-300 bg-zinc-50'} ${disabled ? 'opacity-60' : ''}`}>
        <UploadCloud size={26} className="text-brand" aria-hidden="true" />
        <p className="text-sm font-semibold">폴더나 파일을 여기로 끌어 놓으세요</p>
        <p className="text-xs text-zinc-600">한 번에 올린 것이 한 배치가 됩니다. 큰 해석 폴더는 탐색기로 <span className="font-mono">00_Inbox</span> 에 복사해도 됩니다.</p>
        <div className="mt-1 flex gap-2">
          <input ref={fileRef} type="file" multiple hidden aria-label="파일 선택" disabled={disabled || busy}
                 onChange={(e) => { start(collectFromInput(e.target.files)); e.target.value = ''; }} />
          <input ref={dirRef} type="file" hidden webkitdirectory="" aria-label="폴더 선택" disabled={disabled || busy}
                 onChange={(e) => { start(collectFromInput(e.target.files)); e.target.value = ''; }} />
          <Button variant="secondary" disabled={disabled || busy} onClick={() => fileRef.current?.click()}><UploadCloud size={14} aria-hidden="true" />파일 선택</Button>
          <Button variant="secondary" disabled={disabled || busy} onClick={() => dirRef.current?.click()}><FolderUp size={14} aria-hidden="true" />폴더 선택</Button>
        </div>
        {disabled && <p className="text-xs text-err">999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.</p>}
      </div>
      {progress && (
        <div className="mt-3" aria-live="polite">
          <div className="flex justify-between text-xs text-zinc-600"><span>올리는 중…</span>
            <span className="font-mono">{formatBytes(progress.sent)} / {formatBytes(progress.total)} · {pct}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="올리기 진행률">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {result && result.uploaded > 0 && (
        <p role="status" className="mt-3 text-[13px] text-ok">{result.uploaded}개 파일을 올렸습니다. 잠시 뒤 아래에 묶음 제안이 나타납니다.</p>
      )}
      {notice && busy && <p className="mt-2 text-xs text-wait">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {result?.rejected?.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-wait">
          <p className="font-semibold">DRM 암호화 파일 {result.rejected.length}개는 올리지 않았습니다 — 탐색기로 00_Inbox 에 복사해 주세요(복사하면 암호가 풀립니다).</p>
          <ul className="mt-1 font-mono">{result.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
