import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';

const TABS = [
  { key: 'pending', label: '승인 대기' },
  { key: 'active', label: '활성' },
  { key: 'disabled', label: '비활성' },
];

// 다른 관리자가 먼저 처리했거나, 화면을 열어 둔 사이 대상 사용자의 상태가 바뀌었거나
// (경쟁 상태), 아예 삭제된 경우 — 모두 같은 방식(안내 + 목록 새로 고침)으로 다룬다.
const STALE_TARGET_DETAILS = new Set(['not_pending', 'not_disabled', 'not_active', 'user_not_found']);
const STALE_TARGET_MESSAGE = '이미 처리된 사용자입니다. 목록을 새로 고칩니다.';

const CONFIRM_MESSAGES = {
  reject: '이 사용자의 가입 신청을 거절할까요?',
  disable: '이 사용자를 비활성화할까요? 즉시 로그인이 차단됩니다.',
};

export default function UsersPage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
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

  async function act(employeeId, path, method = 'POST', body) {
    if (CONFIRM_MESSAGES[path] && !window.confirm(CONFIRM_MESSAGES[path])) return;
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
    <div className="p-6">
      <h1 className="text-lg font-bold tracking-tight">사용자 관리</h1>
      <div role="tablist" className="mt-4 flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={`h-9 border-b-2 text-[13px] ${tab === t.key ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-500'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      <table className="mt-4 w-full border-collapse rounded-lg bg-white text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-zinc-500">
            <th className="px-3 py-2 font-medium">사번</th><th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">부서</th><th className="px-3 py-2 font-medium">{dateHeader}</th>
            <th className="px-3 py-2 font-medium">권한</th><th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const busy = busyId === u.employee_id;
            return (
              <tr key={u.employee_id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-mono">{u.employee_id}</td>
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2 text-zinc-600">{u.department || '—'}</td>
                <td className="px-3 py-2 font-mono text-zinc-600">{u.created_at?.slice(0, 10)}</td>
                <td className="px-3 py-2">{u.is_admin ? '관리자' : '일반'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    {u.status === 'pending' && (<>
                      <Button size="sm" disabled={busy} onClick={() => act(u.employee_id, 'approve')}>승인</Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => act(u.employee_id, 'reject')}>거절</Button>
                    </>)}
                    {u.status === 'active' && (<>
                      <Button size="sm" variant="secondary" disabled={busy}
                              onClick={() => act(u.employee_id, 'admin', 'PUT', { is_admin: !u.is_admin })}>
                        {u.is_admin ? '관리자 해제' : '관리자 지정'}
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => act(u.employee_id, 'disable')}>비활성화</Button>
                    </>)}
                    {u.status === 'disabled' && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(u.employee_id, 'enable')}>재활성화</Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-500">해당하는 사용자가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
