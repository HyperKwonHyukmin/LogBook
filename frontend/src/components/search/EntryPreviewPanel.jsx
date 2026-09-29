import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import FilePreview from '../preview/FilePreview.jsx';
import KindBadge from '../ui/KindBadge.jsx';

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

  return (
    <aside aria-label="미리보기" className="flex w-[clamp(320px,30vw,420px)] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <span className="font-mono text-xs text-zinc-500">{entryId}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry?.title}</span>
        <Link to={`/e/${entryId}${file || fileId ? `?file=${file?.id ?? fileId}` : ''}`} className="inline-flex items-center gap-0.5 text-xs text-brand hover:underline">
          상세<ArrowUpRight size={13} aria-hidden="true" />
        </Link>
        <button type="button" onClick={onClose} aria-label="미리보기 닫기" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><X size={16} aria-hidden="true" /></button>
      </div>
      {error && <p role="alert" className="p-4 text-[13px] text-err">{error}</p>}
      {!entry && !error && <div className="m-4 h-40 animate-pulse rounded-lg bg-zinc-200/60" />}
      {entry && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {/* 파일이 하나뿐이면 고를 것이 없어 목록을 생략한다(미리보기 머리줄에 이름이 있다). */}
          {entry.files.length > 1 && (
            <ul aria-label="파일" className="mb-3 space-y-0.5">
              {entry.files.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => setPicked(f.id)} aria-pressed={f.id === file?.id}
                          className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${f.id === file?.id ? 'bg-brand-tint font-semibold text-brand' : 'hover:bg-white'}`}>
                    <KindBadge kind={f.kind} name={f.name} /><span className="truncate">{f.rel_path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} />
            : <p className="text-[13px] text-zinc-500">파일이 없습니다.</p>}
        </div>
      )}
    </aside>
  );
}
