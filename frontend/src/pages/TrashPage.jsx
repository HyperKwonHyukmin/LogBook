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
import { Segmented } from '../components/ui/Tabs.jsx';
import { errorText } from '../lib/labels.js';

// 2026-11-25 — 내가 버린 자료는 누구나 영구 삭제할 수 있어 동작 칸은 늘 두 단추 폭. 관리자가 '모두'를 보면 버린 사람 칸이 붙는다
const COLS = 'grid grid-cols-[minmax(0,1fr)_88px_136px_232px] items-center gap-3 px-3';
const COLS_ALL = 'grid grid-cols-[minmax(0,1fr)_88px_112px_136px_232px] items-center gap-3 px-3';
const SCOPES = [{ id: 'mine', label: '내가 버린 것' }, { id: 'all', label: '모두' }];
const reveal = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

/**
 * 휴지통 — 삭제한 Entry 를 복원한다(설계 §8). 자료는 95_Trash 에 있다. 복원은 되돌릴 수 있는 동작이라 확인을 묻지 않는다.
 * 2026-11-25 — 휴지통은 버린 사람의 것: 자기가 버린 것만 보이고, 자기가 버린 자기 자료는 영구 삭제할 수 있다(can_purge, 위험 확인).
 * 관리자는 [모두]로 남이 버린 것까지 보고 지운다. 인증 문맥이 없으면 일반 사용자로 본다.
 * [휴지통 비우기]는 보이는 자료를 한 건씩 같은 영구 삭제 API 로 지운다 — 건마다 잠금·재확인·감사 기록이 그대로 남는다.
 */
export default function TrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [purged, setPurged] = useState('');
  const [busyId, setBusyId] = useState('');
  // 휴지통 비우기 진행 {done, total} — 도는 동안 행 단추를 막는다
  const [emptying, setEmptying] = useState(null);
  const isAdmin = useContext(AuthContext)?.isAdmin === true;
  const [scope, setScope] = useState('mine');
  const [confirm, dialog] = useConfirm();
  const all = isAdmin && scope === 'all';
  const cols = all ? COLS_ALL : COLS;
  const purgeable = rows.filter((r) => r.can_purge);

  const load = useCallback(() => api(scope === 'all' ? '/trash?scope=all' : '/trash').then(setRows)
    .catch(() => setError('휴지통을 불러오지 못했습니다.')).finally(() => setLoading(false)), [scope]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  async function restore(r) {
    setBusyId(r.entry_id); setError(''); setNotice(null); setPurged('');
    try {
      await api(`/entries/${r.entry_id}/restore`, { method: 'POST' });
      setNotice({ id: r.entry_id, draft: r.kind === 'draft' });
      load();
    } catch (err) { setError(errorText(err, '복원하지 못했습니다.')); } finally { setBusyId(''); }
  }

  async function purge(r) {
    const ok = await confirm({ title: `${r.entry_id} 을 영구 삭제할까요?`,
      body: '되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다.', confirmLabel: '영구 삭제' });
    if (!ok) return;
    setBusyId(r.entry_id); setError(''); setNotice(null); setPurged('');
    try {
      await api(`/trash/${r.entry_id}`, { method: 'DELETE' });
      setRows((cur) => cur.filter((x) => x.entry_id !== r.entry_id));
      setPurged(`${r.entry_id} 을 영구 삭제했습니다. 95_Trash 폴더에서도 지웠습니다.`);
    } catch (err) { setError(errorText(err, '영구 삭제하지 못했습니다.')); } finally { setBusyId(''); }
  }

  async function emptyAll() {
    const targets = purgeable.slice();
    const ok = await confirm({ title: `휴지통의 자료 ${targets.length}건을 모두 영구 삭제할까요?`,
      body: '되돌릴 수 없습니다. 95_Trash 폴더에서도 지워집니다.', confirmLabel: `${targets.length}건 영구 삭제` });
    if (!ok) return;
    setError(''); setNotice(null); setPurged('');
    const failed = [];
    for (let i = 0; i < targets.length; i += 1) {
      setEmptying({ done: i, total: targets.length });
      const r = targets[i];
      try {
        await api(`/trash/${r.entry_id}`, { method: 'DELETE' });
        setRows((cur) => cur.filter((x) => x.entry_id !== r.entry_id));
      } catch (err) {
        failed.push(`${r.entry_id}(${errorText(err, '실패')})`);
      }
    }
    setEmptying(null);
    const done = targets.length - failed.length;
    if (done) setPurged(`자료 ${done}건을 영구 삭제했습니다. 95_Trash 폴더에서도 지웠습니다.`);
    if (failed.length) setError(`${failed.length}건은 지우지 못했습니다: ${failed.join(', ')}`);
    load();   // 목록은 200건까지만 오므로 남은 것이 있으면 다시 보인다
  }

  const actions = (isAdmin || purgeable.length > 0) && (
    <span className="flex items-center gap-2">
      {isAdmin && <Segmented label="보기" items={SCOPES} value={scope} onChange={setScope} />}
      {purgeable.length > 0 && (
        <Button variant="danger-solid" size="sm" disabled={!!emptying || !!busyId} loading={!!emptying} onClick={emptyAll}>
          {!emptying && <Trash2 size={14} aria-hidden="true" />}
          {emptying ? `비우는 중 ${emptying.done}/${emptying.total}` : `휴지통 비우기 (${purgeable.length}건)`}
        </Button>
      )}
    </span>
  );

  return (
    <Page>
      {dialog}
      <PageHeader title="휴지통" actions={actions}
        description={all
          ? <>모든 사람이 버린 자료입니다. 삭제한 자료는 <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원하거나 영구 삭제합니다.</>
          : <>내가 버린 자료만 보입니다. <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원하거나, 내가 올린 자료는 영구 삭제할 수 있습니다.</>} />
      {notice && (
        <OkNote className="mb-4">
          {/* 2026-11-20 — 버린 초안은 '확정 전'으로 올리기와 확정에 돌아간다 */}
          {notice.draft ? (
            <>{notice.id} 초안을 되돌렸습니다. <Link to="/inbox" className="font-medium underline underline-offset-2 hover:no-underline">올리기와 확정에서 보기</Link></>
          ) : (
            <>{notice.id} 을 복원했습니다. <Link to={`/e/${notice.id}`} className="font-medium underline underline-offset-2 hover:no-underline">열기</Link></>
          )}
        </OkNote>
      )}
      {purged && <OkNote className="mb-4">{purged}</OkNote>}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!loading && rows.length === 0 && !error && <EmptyState icon={Trash2} title="휴지통이 비어 있습니다">{all ? '아무도 버린 자료가 없습니다.' : '내가 삭제한 자료가 여기에 모입니다.'}</EmptyState>}
      {(loading || rows.length > 0) && (
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className={`${cols} h-9 border-b border-n-200 bg-n-50 text-meta font-medium text-n-600`}>
            <span>제목</span><span>Entry</span>{all && <span>버린 사람</span>}<span>보낸 시각</span><span />
          </div>
          {loading && <RowsSkeleton rows={3} dense label="휴지통을 불러오는 중" />}
          <ul>
            {rows.map((r) => (
              <li key={r.entry_id} className={`group ${cols} h-11 border-b border-n-200 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50`}>
                <span className="flex min-w-0 items-center gap-2">
                  <Link to={`/e/${r.entry_id}`} className="truncate font-medium text-n-900 hover:underline">{r.title}</Link>
                  {r.kind === 'draft' && <span className="shrink-0 rounded-xs bg-n-100 px-1.5 text-micro font-medium text-n-600">버린 초안</span>}
                </span>
                <span className="font-mono text-meta text-n-600">{r.entry_id}</span>
                {all && <span className="truncate text-meta text-n-600" title={r.trashed_by || undefined}>{r.trashed_by_name || r.trashed_by || '—'}</span>}
                <span className="font-mono text-meta text-n-500">{r.updated_at ? r.updated_at.replace('T', ' ').slice(0, 16) : '—'}</span>
                <span className="flex items-center justify-end gap-1.5">
                  {r.restorable && r.can_restore === false ? (
                    <span className="text-meta text-n-500">작성자·관리자만 복원</span>
                  ) : r.restorable ? (
                    <Button variant="ghost" size="sm" className={busyId === r.entry_id ? '' : reveal} disabled={busyId === r.entry_id}
                            loading={busyId === r.entry_id} onClick={() => restore(r)}>
                      {busyId !== r.entry_id && <RotateCcw size={14} aria-hidden="true" />}복원
                    </Button>
                  ) : <span className="text-meta text-n-500">복원할 수 없음</span>}
                  {r.can_purge && (
                    <Button variant="danger" size="sm" className={busyId === r.entry_id ? '' : reveal}
                            disabled={busyId === r.entry_id || !!emptying} onClick={() => purge(r)}>
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
