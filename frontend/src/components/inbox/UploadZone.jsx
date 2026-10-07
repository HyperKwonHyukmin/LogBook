import { useEffect, useRef, useState } from 'react';
import { FolderUp, Upload, UploadCloud } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { collectFromDrop, collectFromInput, uploadBatch } from '../../lib/upload.js';
import { errorText, formatBytes } from '../../lib/labels.js';

const BUSY_NOTICE = '올리는 중입니다. 지금 올리기가 끝난 뒤 다시 놓아 주세요.';
const isOsFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

/**
 * 폴더·여러 파일 → 한 배치로 올리는 상태. DRM 파일은 거부하고 탐색기 경로를 안내한다.
 * targetEntryId: 기존 Entry 에 추가로 올릴 때.
 */
export function useUploader({ onUploaded, disabled = false, targetEntryId }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  // 올리는 동안: 영역 밖에 떨어뜨린 파일을 브라우저가 열어 페이지를 떠나지 않게 하고, 창 닫기를 경고한다.
  useEffect(() => {
    if (!busy) return undefined;
    // 바깥(탐색기)에서 끌어 온 파일만 다룬다. 화면 안의 끌기(초안 카드 파일 옮기기)나 이미 처리된 놓기는 그대로 둔다.
    const outside = (e) => !e.defaultPrevented && isOsFileDrag(e);
    const block = (e) => { if (outside(e)) e.preventDefault(); };
    const onDrop = (e) => { if (outside(e)) { e.preventDefault(); setNotice(BUSY_NOTICE); } };
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
      const res = await uploadBatch(items, { onProgress: setProgress, targetEntryId });
      setResult(res);
      onUploaded(res.key);
    } catch (err) {
      if (err.code === 'all_drm') setResult({ uploaded: 0, rejected: err.rejected });
      setError(err.code === 'all_drm' ? '모든 파일이 DRM 암호화 상태라 올리지 않았습니다.' : errorText(err, '올리기에 실패했습니다. 다시 시도해 주세요.'));
    } finally {
      setBusy(false); setProgress(null);
    }
  }
  async function onDrop(dataTransfer) {
    if (disabled) return;
    if (busy) { setNotice(BUSY_NOTICE); return; }
    start(await collectFromDrop(dataTransfer));
  }
  return { busy, progress, result, error, notice, disabled, fileRef, dirRef, start, onDrop };
}

/** 파일 선택·폴더 선택 단추(숨은 input 포함). */
export function UploadButtons({ u, size = 'sm' }) {
  const off = u.disabled || u.busy;
  return (
    <>
      <input ref={u.fileRef} type="file" multiple hidden aria-label="파일 선택" disabled={off}
             onChange={(e) => { u.start(collectFromInput(e.target.files)); e.target.value = ''; }} />
      <input ref={u.dirRef} type="file" hidden webkitdirectory="" aria-label="폴더 선택" disabled={off}
             onChange={(e) => { u.start(collectFromInput(e.target.files)); e.target.value = ''; }} />
      <Button variant="secondary" size={size} disabled={off} onClick={() => u.fileRef.current?.click()}>
        <Upload size={14} aria-hidden="true" />파일 선택
      </Button>
      <Button variant="secondary" size={size} disabled={off} onClick={() => u.dirRef.current?.click()}>
        <FolderUp size={14} aria-hidden="true" />폴더 선택
      </Button>
    </>
  );
}

/** 진행률·결과·오류·DRM 거부 목록. */
export function UploadFeedback({ u, showSuccess = true }) {
  const { progress, result, error, notice, busy, disabled } = u;
  const pct = progress ? Math.floor((progress.sent / Math.max(progress.total, 1)) * 100) : 0;
  const any = disabled || progress || (showSuccess && result?.uploaded > 0) || (notice && busy) || error || result?.rejected?.length > 0;
  if (!any) return null;
  return (
    <div className="flex flex-col gap-2">
      {disabled && <p className="text-meta text-err">999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.</p>}
      {progress && (
        <div aria-live="polite">
          <div className="flex justify-between text-meta text-n-600"><span>올리는 중…</span>
            <span className="font-mono">{formatBytes(progress.sent)} / {formatBytes(progress.total)} · {pct}%</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-n-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="올리기 진행률">
            <div className="h-full bg-brand transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {showSuccess && result && result.uploaded > 0 && (
        <p role="status" className="rounded-md bg-ok-bg px-3 py-2 text-ui text-ok">{result.uploaded}개 파일을 올렸습니다. 잠시 뒤 아래에 묶음 제안이 나타납니다.</p>
      )}
      {notice && busy && <p className="text-meta text-wait">{notice}</p>}
      {error && <p role="alert" className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">{error}</p>}
      {result?.rejected?.length > 0 && (
        <div className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-meta text-wait">
          <p className="font-semibold">DRM 암호화 파일 {result.rejected.length}개는 올리지 않았습니다. 탐색기로 00_Inbox 에 복사해 주세요(복사하면 암호가 풀립니다).</p>
          <ul className="mt-1">{result.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/**
 * 화면 전체를 놓는 곳으로 — 바깥에서 파일을 끌고 들어오면 덮개를 띄운다(평소에는 보이지 않는다).
 */
export function PageDropOverlay({ u }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const enter = (e) => { if (!isOsFileDrag(e) || u.busy) return; depth.current += 1; setOver(true); };
    const leave = (e) => { if (!isOsFileDrag(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); };
    const end = () => { depth.current = 0; setOver(false); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, [u.busy]);
  if (!over) return null;
  return (
    <div className="fixed inset-0 z-40 flex animate-fade items-center justify-center bg-scrim p-6"
         onDragOver={(e) => { e.preventDefault(); }}
         onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); u.onDrop(e.dataTransfer); }}>
      <div className="pointer-events-none flex h-full max-h-[420px] w-full max-w-[720px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-ring bg-brand-subtle text-center">
        <UploadCloud size={24} className="text-brand" aria-hidden="true" />
        <p className="text-body font-semibold text-brand">{u.disabled ? '지금은 올릴 수 없습니다' : '여기에 놓아 올리기'}</p>
        <p className="text-ui text-n-600">{u.disabled ? '999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.' : '한 번에 놓은 것이 한 배치가 됩니다.'}</p>
      </div>
    </div>
  );
}

/**
 * 기본 올리기 칸(기존 Entry 에 파일 추가 등) — 단추 한 줄 + 이 칸에 끌어 놓기.
 * showSuccess=false 면 성공 문구를 부모가 대신 보인다.
 */
export default function UploadZone({ onUploaded, disabled = false, targetEntryId, showSuccess = true }) {
  const u = useUploader({ onUploaded, disabled, targetEntryId });
  const [over, setOver] = useState(false);
  return (
    <section aria-label="자료 올리기" className="flex flex-col gap-2">
      <div onDragOver={(e) => { if (!disabled && isOsFileDrag(e)) { e.preventDefault(); if (!u.busy) setOver(true); } }}
           onDragLeave={() => setOver(false)}
           onDrop={(e) => { if (!isOsFileDrag(e) && !e.dataTransfer?.files?.length) return; e.preventDefault(); setOver(false); u.onDrop(e.dataTransfer); }}
           className={`flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5 transition-colors duration-150
             ${over ? 'border-brand-ring bg-brand-subtle' : 'border-n-250 bg-n-25'}`}>
        <UploadButtons u={u} />
        <span className="text-meta text-n-500">또는 여기에 폴더·파일을 끌어 놓으세요. 큰 해석 폴더는 탐색기로 <span className="font-mono">00_Inbox</span> 에 복사해도 됩니다.</span>
      </div>
      <UploadFeedback u={u} showSuccess={showSuccess} />
    </section>
  );
}
