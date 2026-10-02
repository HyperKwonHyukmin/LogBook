import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText, formatBytes, formatDateTime } from '../../lib/labels.js';
import FilePreview, { FileActions } from '../preview/FilePreview.jsx';
import { buttonClass } from '../ui/Button.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { Bar } from '../ui/Skeleton.jsx';
import { HullChip, StatusDot } from '../ui/Status.jsx';

/** 오른쪽 미리보기 패널(설계 §6.4 "떠나지 않고 본다"). 파일을 고르면 그 파일을 미리 본다. */
export default function EntryPreviewPanel({ entryId, fileId, onClose }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(fileId || null);
  const idRef = useRef(0);

  useEffect(() => {
    const id = ++idRef.current;
    setEntry(null); setError('');
    api(`/entries/${encodeURIComponent(entryId)}`).then((e) => { if (id === idRef.current) setEntry(e); })
      .catch((err) => { if (id === idRef.current) setError(errorText(err, '자료를 불러오지 못했습니다.')); });
  }, [entryId]);
  useEffect(() => { setPicked(fileId || null); }, [entryId, fileId]);

  const file = entry?.files.find((f) => f.id === picked) || entry?.files.find((f) => f.kind === 'report') || entry?.files[0];
  const detailHref = `/e/${entryId}${file || fileId ? `?file=${file?.id ?? fileId}` : ''}`;

  return (
    <aside aria-label="미리보기"
           className="flex w-[clamp(360px,34vw,480px)] shrink-0 animate-panel flex-col border-l border-n-200 bg-n-0">
      <div className="border-b border-n-200 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2">
          <h2 className="line-clamp-2 min-w-0 flex-1 pt-0.5 text-body font-semibold tracking-[-0.005em] text-n-900">
            {entry?.title || (!error && <Bar className="mt-1 h-3.5 w-3/4" />)}
          </h2>
          <Link to={detailHref} aria-label="상세 열기" title="상세 열기 (Enter)" className={buttonClass('ghost', 'icon-sm')}>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <button type="button" onClick={onClose} aria-label="미리보기 닫기" title="닫기 (Esc)" className={buttonClass('ghost', 'icon-sm')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {entry && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-n-600">
            {entry.hulls.map((h) => <HullChip key={h.hull_no} hull={h.hull_no} title={h.ship_type || undefined} />)}
            {entry.zones?.length > 0 && <span>{entry.zones.join(', ')}</span>}
            <StatusDot status={entry.status} />
            <span className="font-mono text-n-500">{entry.entry_id}</span>
            {entry.confirmed_at && <span className="font-mono text-n-500">{formatDateTime(entry.confirmed_at).slice(0, 10)}</span>}
          </div>
        )}
      </div>
      {error && <p role="alert" className="m-4 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">{error}</p>}
      {!entry && !error && (
        <div className="appear-late space-y-2 p-4" aria-hidden="true">
          <Bar className="h-7" /><Bar className="h-7 w-4/5" /><Bar className="mt-3 aspect-[1/1.2] w-full" />
        </div>
      )}
      {entry && entry.files.length > 0 && (
        <ul aria-label="파일" className="flex flex-col gap-px border-b border-n-200 px-2 py-2">
          {entry.files.map((f) => {
            const on = f.id === file?.id;
            return (
              <li key={f.id}>
                <button type="button" onClick={() => setPicked(f.id)} aria-pressed={on} title={f.rel_path}
                        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui transition-colors duration-120 ease-out
                          ${on ? 'bg-brand-subtle text-brand' : 'text-n-800 hover:bg-n-100 active:bg-n-150'}`}>
                  <KindBadge kind={f.kind} name={f.name} />
                  <span className={`min-w-0 flex-1 truncate ${on ? 'font-medium' : ''}`}>{f.name}</span>
                  <span className="shrink-0 font-mono text-meta text-n-500">{formatBytes(f.size)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {entry && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} toolbar={false} hideTitles={[entry.title]} />
            : <p className="p-2 text-ui text-n-500">파일이 없습니다.</p>}
        </div>
      )}
      {entry && file && (
        <div className="flex min-h-11 shrink-0 items-center border-t border-n-200 px-3 py-2">
          <FileActions key={file.id} file={file} vaultUnc={entry.vault_unc} showPath className="w-full" />
        </div>
      )}
    </aside>
  );
}
