import { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { useConfirm } from '../components/ui/ConfirmDialog.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, OkNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { errorText } from '../lib/labels.js';

const COLS = 'grid grid-cols-[minmax(0,1fr)_88px_136px_148px] items-center gap-3 px-3';
// 관리자는 행마다 '영구 삭제' 가 더 붙어 동작 칸이 넓다.
const COLS_ADMIN = 'grid grid-cols-[minmax(0,1fr)_88px_136px_232px] items-center gap-3 px-3';
const reveal = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

/**
 * 휴지통 — 삭제한 Entry 를 복원한다(설계 §8). 자료는 95_Trash 에 있다. 복원은 되돌릴 수 있는 동작이라 확인을 묻지 않는다.
 * 관리자는 영구 삭제도 할 수 있다(되돌릴 수 없어 위험 확인을 거친다). 인증 문맥이 없으면 일반 사용자로 본다.
 */
export default function TrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [purged, setPurged] = useState('');
  const [busyId, setBusyId] = useState('');
  const isAdmin = useContext(AuthContext)?.isAdmin === true;
  const [confirm, dialog] = useConfirm();
  const cols = isAdmin ? COLS_ADMIN : COLS;

  const load = useCallback(() => api('/trash').then(setRows)
    .catch(() => setError('휴지통을 불러오지 못했습니다.')).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);

  async function restore(r) {
    setBusyId(r.entry_id); setError(''); setNotice(null); setPurged('');
    try {
      await api(`/entries/${r.entry_id}/restore`, { method: 'POST' });
      setNotice(r.entry_id);
      load();
    } catch (err) { setError(errorText(err, '복원하지 못했습니다.')); } finally { setBusyId(''); }
  }

  async function purge(r) {
    const ok = await confirm({ title: `${r.entry_id} 을 영구 삭제할까요?`,
      body: '되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다.', confirmLabel: '영구 삭제' });
    if (!ok) return;
    setBusyId(r.entry_id); setError(''); setNotice(null); setPurged('');
    try {
      await api(`/admin/trash/${r.entry_id}`, { method: 'DELETE' });
      setRows((cur) => cur.filter((x) => x.entry_id !== r.entry_id));
      setPurged(r.entry_id);
    } catch (err) { setError(errorText(err, '영구 삭제하지 못했습니다.')); } finally { setBusyId(''); }
  }

  return (
    <Page>
      {dialog}
      <PageHeader title="휴지통"
        description={<>삭제한 자료는 <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원할 수 있습니다.</>} />
      {notice && (
        <OkNote className="mb-4">
          {notice} 을 복원했습니다. <Link to={`/e/${notice}`} className="font-medium underline underline-offset-2 hover:no-underline">열기</Link>
        </OkNote>
      )}
      {purged && <OkNote className="mb-4">{purged} 을 영구 삭제했습니다. 95_Trash 폴더에서도 지웠습니다.</OkNote>}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!loading && rows.length === 0 && !error && <EmptyState icon={Trash2} title="휴지통이 비어 있습니다">삭제한 자료가 여기에 모입니다.</EmptyState>}
      {(loading || rows.length > 0) && (
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className={`${cols} h-9 border-b border-n-200 bg-n-50 text-meta font-medium text-n-600`}>
            <span>제목</span><span>Entry</span><span>보낸 시각</span><span />
          </div>
          {loading && <RowsSkeleton rows={3} dense label="휴지통을 불러오는 중" />}
          <ul>
            {rows.map((r) => (
              <li key={r.entry_id} className={`group ${cols} h-11 border-b border-n-200 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50`}>
                <Link to={`/e/${r.entry_id}`} className="truncate font-medium text-n-900 hover:underline">{r.title}</Link>
                <span className="font-mono text-meta text-n-600">{r.entry_id}</span>
                <span className="font-mono text-meta text-n-500">{r.updated_at ? r.updated_at.replace('T', ' ').slice(0, 16) : '—'}</span>
                <span className="flex items-center justify-end gap-1.5">
                  {r.restorable ? (
                    <Button variant="ghost" size="sm" className={busyId === r.entry_id ? '' : reveal} disabled={busyId === r.entry_id}
                            loading={busyId === r.entry_id} onClick={() => restore(r)}>
                      {busyId !== r.entry_id && <RotateCcw size={14} aria-hidden="true" />}복원
                    </Button>
                  ) : <span className="text-meta text-n-500">초안이라 복원할 수 없음</span>}
                  {isAdmin && (
                    <Button variant="danger" size="sm" className={busyId === r.entry_id ? '' : reveal}
                            disabled={busyId === r.entry_id} onClick={() => purge(r)}>
                      <Trash2 size={14} aria-hidden="true" />영구 삭제
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Page>
  );
}
