import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, OkNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { errorText } from '../lib/labels.js';

const COLS = 'grid grid-cols-[minmax(0,1fr)_88px_136px_148px] items-center gap-3 px-3';
const reveal = 'opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

/** 휴지통 — 삭제한 Entry 를 복원한다(설계 §8). 자료는 95_Trash 에 있다. 복원은 되돌릴 수 있는 동작이라 확인을 묻지 않는다. */
export default function TrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => api('/trash').then(setRows)
    .catch(() => setError('휴지통을 불러오지 못했습니다.')).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);

  async function restore(r) {
    setBusyId(r.entry_id); setError(''); setNotice(null);
    try {
      await api(`/entries/${r.entry_id}/restore`, { method: 'POST' });
      setNotice(r.entry_id);
      load();
    } catch (err) { setError(errorText(err, '복원하지 못했습니다.')); } finally { setBusyId(''); }
  }

  return (
    <Page>
      <PageHeader title="휴지통"
        description={<>삭제한 자료는 <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원할 수 있습니다.</>} />
      {notice && (
        <OkNote className="mb-4">
          {notice} 을 복원했습니다. <Link to={`/e/${notice}`} className="font-medium underline underline-offset-2 hover:no-underline">열기</Link>
        </OkNote>
      )}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!loading && rows.length === 0 && !error && <EmptyState icon={Trash2} title="휴지통이 비어 있습니다">삭제한 자료가 여기에 모입니다.</EmptyState>}
      {(loading || rows.length > 0) && (
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className={`${COLS} h-8 border-b border-n-200 bg-n-25 text-meta font-medium text-n-500`}>
            <span>제목</span><span>Entry</span><span>보낸 시각</span><span />
          </div>
          {loading && <RowsSkeleton rows={3} dense label="휴지통을 불러오는 중" />}
          <ul>
            {rows.map((r) => (
              <li key={r.entry_id} className={`group ${COLS} h-10 border-b border-n-200 text-ui transition-colors duration-120 last:border-0 hover:bg-n-25`}>
                <Link to={`/e/${r.entry_id}`} className="truncate font-medium text-n-900 hover:underline">{r.title}</Link>
                <span className="font-mono text-meta text-n-600">{r.entry_id}</span>
                <span className="font-mono text-meta text-n-500">{r.updated_at ? r.updated_at.replace('T', ' ').slice(0, 16) : '—'}</span>
                <span className="flex justify-end">
                  {r.restorable ? (
                    <Button variant="ghost" size="sm" className={busyId === r.entry_id ? '' : reveal} disabled={busyId === r.entry_id}
                            loading={busyId === r.entry_id} onClick={() => restore(r)}>
                      {busyId !== r.entry_id && <RotateCcw size={14} aria-hidden="true" />}복원
                    </Button>
                  ) : <span className="text-meta text-n-500">초안이라 복원할 수 없음</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Page>
  );
}
