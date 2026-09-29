import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText } from '../lib/labels.js';

/** 휴지통 — 삭제한 Entry 를 복원한다(설계 §8). 자료는 95_Trash 에 있다. */
export default function TrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => api('/trash').then(setRows)
    .catch(() => setError('휴지통을 불러오지 못했습니다.')).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);

  async function restore(r) {
    if (!window.confirm(`${r.entry_id} ‘${r.title}’ 을 복원할까요?`)) return;
    setBusyId(r.entry_id); setError(''); setNotice('');
    try {
      await api(`/entries/${r.entry_id}/restore`, { method: 'POST' });
      setNotice(`${r.entry_id} 을 복원했습니다.`);
      load();
    } catch (err) { setError(errorText(err, '복원하지 못했습니다.')); } finally { setBusyId(''); }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-bold tracking-tight">휴지통</h1>
      <p className="mt-1 text-[13px] text-zinc-600">삭제한 자료는 <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원할 수 있습니다.</p>
      {notice && <p role="status" className="mt-3 text-[13px] text-ok">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {!loading && rows.length === 0 && !error && <EmptyState icon={Trash2} title="휴지통이 비어 있습니다">삭제한 자료가 여기에 모입니다.</EmptyState>}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {rows.map((r) => (
            <li key={r.entry_id} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
              <span className="w-20 shrink-0 font-mono text-zinc-500">{r.entry_id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
              <span className="w-36 shrink-0 font-mono text-xs text-zinc-500">{r.updated_at ? r.updated_at.replace('T', ' ').slice(0, 16) : '—'}</span>
              {r.restorable ? (
                <Button variant="secondary" size="sm" disabled={busyId === r.entry_id} onClick={() => restore(r)}>
                  <RotateCcw size={13} aria-hidden="true" />복원
                </Button>
              ) : <span className="text-xs text-zinc-500">초안이라 복원할 수 없음</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
