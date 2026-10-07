import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { ErrorNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';

const TABS = [
  { id: 'pending', label: '승인 대기' },
  { id: 'active', label: '활성' },
  { id: 'disabled', label: '비활성' },
];

// 다른 관리자가 먼저 처리했거나, 화면을 열어 둔 사이 대상 사용자의 상태가 바뀌었거나
// (경쟁 상태), 아예 삭제된 경우 — 모두 같은 방식(안내 + 목록 새로 고침)으로 다룬다.
const STALE_TARGET_DETAILS = new Set(['not_pending', 'not_disabled', 'not_active', 'user_not_found']);
const STALE_TARGET_MESSAGE = '이미 처리된 사용자입니다. 목록을 새로 고칩니다.';

/** 되돌리기 어려운 동작은 확인 대화상자를 거친다. */
const CONFIRMS = {
  reject: (u) => ({ title: `${u.name} 님의 가입 신청을 거절할까요?`, body: '거절한 사번은 다시 가입 신청을 해야 합니다.', confirmLabel: '거절' }),
  disable: (u) => ({ title: `${u.name} 님을 비활성화할까요?`, body: '즉시 로그인이 차단됩니다. 비활성 탭에서 다시 활성화할 수 있습니다.', confirmLabel: '비활성화' }),
};

const th = 'h-9 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const td = 'h-12 border-b border-n-200 px-3 text-ui';

export default function UsersPage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirm, dialog] = useConfirm();
  // 탭을 빠르게 넘나들 때 먼저 나간 요청이 나중에 응답해 화면을 덮어쓰지 않도록,
  // 매 요청에 순번을 매겨 "가장 최근에 보낸 요청"의 응답만 반영한다.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const data = await api(`/admin/users?status=${tab}`);
      if (seq === requestSeq.current) setRows(data);
    } catch {
      if (seq === requestSeq.current) {
        setError('사용자 목록을 불러오지 못했습니다.');
        setRows([]);
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function act(user, path, method = 'POST', body) {
    const employeeId = user.employee_id;
    if (CONFIRMS[path] && !(await confirm(CONFIRMS[path](user)))) return;
    setBusyId(employeeId);
    try {
      await api(`/admin/users/${employeeId}/${path}`, { method, body });
      await load();
    } catch (err) {
      if (err.detail === 'cannot_change_self') {
        setError('자기 자신은 변경할 수 없습니다.');
      } else if (STALE_TARGET_DETAILS.has(err.detail)) {
        // load() 는 시작할 때 setError('') 를 하므로, 안내 메시지는 load() 가 끝난 뒤에 설정한다.
        await load();
        setError(STALE_TARGET_MESSAGE);
      } else {
        setError('처리하지 못했습니다.');
      }
    } finally {
      setBusyId(null);
    }
  }

  const dateHeader = tab === 'pending' ? '신청일' : '가입일';

  return (
    <Page>
      {dialog}
      <PageHeader title="사용자 관리" description="사번으로 가입을 신청한 사람을 승인하고, 권한과 활성 상태를 관리합니다." />
      <Tabs label="사용자 상태" items={TABS} value={tab} onChange={setTab} className="mb-4" />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      <div className="overflow-hidden rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>이름</th><th className={th}>부서</th>
              <th className={th}>{dateHeader}</th><th className={th}>권한</th><th className={th}><span className="sr-only">동작</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const busy = busyId === u.employee_id;
              return (
                <tr key={u.employee_id} className="group transition-colors duration-150 last:[&>td]:border-0 hover:bg-n-50">
                  <td className={td}>
                    <div className="font-medium text-n-900">{u.name}</div>
                    <div className="font-mono text-meta text-n-500">{u.employee_id}</div>
                  </td>
                  <td className={`${td} ${u.department ? 'text-n-700' : 'text-n-500'}`}>{u.department || '—'}</td>
                  <td className={`${td} font-mono text-meta text-n-600`}>{u.created_at?.slice(0, 10)}</td>
                  <td className={td}>
                    {u.is_admin
                      ? <span className="inline-flex h-5 items-center rounded-xs bg-brand-subtle px-1.5 text-micro font-semibold text-brand">관리자</span>
                      : <span className="text-n-600">일반</span>}
                  </td>
                  <td className={td}>
                    <div className="flex justify-end gap-1.5">
                      {u.status === 'pending' && (<>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(u, 'reject')}>거절</Button>
                        <Button size="sm" disabled={busy} onClick={() => act(u, 'approve')}>승인</Button>
                      </>)}
                      {u.status === 'active' && (<>
                        <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => act(u, 'admin', 'PUT', { is_admin: !u.is_admin })}>
                          {u.is_admin ? '관리자 해제' : '관리자 지정'}
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => act(u, 'disable')}>비활성화</Button>
                      </>)}
                      {u.status === 'disabled' && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(u, 'enable')}>재활성화</Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-ui text-n-500">해당하는 사용자가 없습니다.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-ui text-n-500"><span className="appear-late">불러오는 중…</span></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
