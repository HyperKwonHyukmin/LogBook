import { useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, Search } from 'lucide-react';
import { api } from '../api/client.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { ACTION_LABELS } from '../lib/labels.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026-09-29' → '2026년 9월 29일 (화)' */
function dayLabel(d) {
  const [y, m, day] = d.split('-').map(Number);
  const wd = DAYS[new Date(y, m - 1, day).getDay()];
  return `${y}년 ${m}월 ${day}일 (${wd})`;
}

/** 대상 — Entry 는 링크, 호선은 호선 화면, 나머지는 번호만. */
function Target({ target }) {
  if (!target?.id) return <span className="text-n-500">—</span>;
  if (target.type === 'entry') {
    return <Link to={`/e/${target.id}`} className="font-mono text-meta text-brand hover:underline">{target.id}</Link>;
  }
  if (target.type === 'hull') {
    return <Link to={`/h/${target.id}`} className="font-mono text-meta text-brand hover:underline">{target.id}</Link>;
  }
  return <span className="font-mono text-meta text-n-600">{target.id}</span>;
}

/** 활동 로그 — 날짜별 묶음. 사람은 알 수 있으면 이름으로(나), 아니면 사번으로 보인다. */
export default function AuditLogPage() {
  const me = useContext(AuthContext)?.user;
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api('/audit?limit=200')
      .then(setRows)
      .catch(() => setError('활동 로그를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const who = (id) => (!id ? '시스템' : id === me?.employee_id && me?.name ? me.name : id);
  const days = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = f ? rows.filter((r) => [r.employee_id, who(r.employee_id), ACTION_LABELS[r.action] || r.action, r.target?.id]
      .some((v) => (v || '').toLowerCase().includes(f))) : rows;
    const map = new Map();
    for (const r of shown) {
      const d = r.at.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(r);
    }
    return [...map.entries()];
  }, [rows, filter, me]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page>
      <PageHeader title="활동 로그" description="누가, 언제, 무엇을 바꿨는지 기록합니다. 기록은 삭제되지 않습니다."
        actions={(
          <label className={inputClass('flex w-56 items-center gap-2 px-2')}>
            <Search size={14} className="shrink-0 text-n-500" aria-hidden="true" />
            <input type="search" aria-label="활동 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="사람, 동작, 대상으로 거르기"
                   className="min-w-0 flex-1 bg-transparent text-ui outline-none focus-visible:outline-none" />
          </label>
        )} />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {loading && <RowsSkeleton rows={6} dense label="활동 로그를 불러오는 중" />}
      {!loading && rows.length === 0 && !error && (
        <EmptyState icon={History} title="아직 기록이 없습니다.">자료를 올리거나 고치면 여기에 남습니다.</EmptyState>
      )}
      {!loading && rows.length > 0 && days.length === 0 && (
        <p className="py-10 text-center text-ui text-n-500">맞는 기록이 없습니다.</p>
      )}
      {days.map(([d, list]) => (
        <section key={d} aria-label={dayLabel(d)} className="mb-4">
          <h2 className="sticky top-0 z-10 border-b border-n-200 bg-n-0 py-2 text-ui font-semibold text-n-700">{dayLabel(d)}</h2>
          <ul>
            {list.map((r) => (
              <li key={r.id} className="grid h-9 grid-cols-[72px_120px_112px_minmax(0,1fr)] items-center gap-3 border-b border-n-200 px-1 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50">
                <span className="font-mono text-meta text-n-500">{r.at.slice(11, 19)}</span>
                <span className={`truncate ${r.employee_id && who(r.employee_id) === r.employee_id ? 'font-mono text-meta text-n-700' : 'text-n-800'}`}
                      title={r.employee_id || undefined}>{who(r.employee_id)}</span>
                <span className="truncate font-medium text-n-700">{ACTION_LABELS[r.action] || r.action}</span>
                <span className="min-w-0 truncate"><Target target={r.target} /></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  );
}
