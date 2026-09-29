import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const ACTION_LABELS = {
  USER_REGISTER: '가입 신청', USER_APPROVE: '가입 승인', USER_REJECT: '가입 거절',
  USER_DISABLE: '계정 비활성화', USER_ENABLE: '계정 재활성화',
  USER_ADMIN_GRANT: '관리자 지정', USER_ADMIN_REVOKE: '관리자 해제', ADMIN_BOOTSTRAP: '관리자 초기 설정',
};

export default function AuditLogPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api('/audit?limit=200')
      .then(setRows)
      .catch(() => setError('활동 로그를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold tracking-tight">활동 로그</h1>
      <p className="mt-1 text-[13px] text-zinc-600">누가, 언제, 무엇을 바꿨는지 기록합니다. 기록은 삭제되지 않습니다.</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-4 px-4 py-2.5 text-[13px]">
            <span className="w-36 shrink-0 font-mono text-zinc-500">{r.at.replace('T', ' ')}</span>
            <span className="w-24 shrink-0 font-mono">{r.employee_id || 'system'}</span>
            <span className="font-medium">{ACTION_LABELS[r.action] || r.action}</span>
            <span className="font-mono text-zinc-600">{r.target.id}</span>
          </li>
        ))}
        {!loading && rows.length === 0 && !error && <li className="px-4 py-8 text-center text-[13px] text-zinc-500">아직 기록이 없습니다.</li>}
      </ul>
    </div>
  );
}
