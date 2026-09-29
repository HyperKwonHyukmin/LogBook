import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Anchor } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText, formatDateTime } from '../lib/labels.js';

/** 호선 목록(`/hulls`) — 확정 자료가 있는 호선, 최근 순. 번호 앞자리로 거른다. */
export default function HullsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const reqRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const id = ++reqRef.current; // 늦게 온 옛 응답은 버린다
    api(`/hulls?q=${encodeURIComponent(q)}`)
      .then((r) => { if (id === reqRef.current) { setRows(r); setError(''); } })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '호선 목록을 불러오지 못했습니다.')); });
  }, [q]);
  // 주소가 밖에서 바뀌면(뒤로 가기·메뉴) 입력칸을 맞춘다. 입력 중인 앞뒤 공백은 지우지 않는다.
  useEffect(() => { setText((cur) => (cur.trim() === q ? cur : q)); }, [q]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  function onChange(e) {
    setText(e.target.value);
    clearTimeout(timerRef.current);
    const v = e.target.value.trim();
    timerRef.current = setTimeout(() => setParams(v ? { q: v } : {}, { replace: true }), 200);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">호선</h1>
        <input aria-label="호선 번호" value={text} onChange={onChange} placeholder="번호 앞자리" inputMode="numeric"
               className="h-8 w-40 rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring" />
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {rows === null && !error && (
        <div role="status" aria-label="호선 목록을 불러오는 중" className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-zinc-200/60" />)}
        </div>
      )}
      {rows?.length === 0 && (
        q ? <p className="mt-6 text-[13px] text-zinc-500"><span className="font-mono">{q}</span> 로 시작하는 호선이 없습니다.</p>
          : <EmptyState icon={Anchor} title="아직 확정된 자료가 없습니다">자료를 올리고 확정하면 호선이 여기에 나타납니다.</EmptyState>
      )}
      {rows?.length > 0 && (
        <table className="mt-4 w-full overflow-hidden rounded-lg border border-line bg-white text-[13px]">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr><th className="px-4 py-2 font-medium">호선</th><th className="px-4 py-2 font-medium">선종</th>
                <th className="px-4 py-2 text-right font-medium">자료</th><th className="px-4 py-2 font-medium">최근 확정</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.hull_no} className="hover:bg-zinc-50">
                <td className="px-4 py-2"><Link to={`/h/${r.hull_no}`} className="font-mono font-semibold text-brand hover:underline">{r.hull_no}</Link></td>
                <td className="px-4 py-2 text-zinc-700">{r.ship_type || '—'}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{r.entries}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-500">{formatDateTime(r.last_at).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
