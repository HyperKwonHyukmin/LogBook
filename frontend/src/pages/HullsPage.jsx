import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Anchor, Search } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { errorText, formatDateTime } from '../lib/labels.js';

const COLS = 'grid grid-cols-[96px_minmax(0,1fr)_80px_120px] items-center gap-3 px-3';

/** 호선 목록(`/hulls`) — 확정 자료가 있는 호선, 최근 순. 번호 앞자리로 거른다. */
export default function HullsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
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
  // 한 줄만 남았으면 Enter 로 바로 연다.
  function onKeyDown(e) {
    if (e.key === 'Enter' && rows?.length === 1) navigate(`/h/${encodeURIComponent(rows[0].hull_no)}`);
  }

  return (
    <Page>
      <PageHeader title="호선" description="확정 자료가 있는 호선입니다. 최근 확정 순으로 보입니다."
        actions={(
          <label className={inputClass('flex w-56 items-center gap-2 px-2')}>
            <Search size={14} className="shrink-0 text-n-500" aria-hidden="true" />
            <input aria-label="호선 번호" value={text} onChange={onChange} onKeyDown={onKeyDown} placeholder="호선 번호로 거르기" inputMode="numeric"
                   className="min-w-0 flex-1 bg-transparent font-mono text-ui outline-none placeholder:font-sans focus-visible:outline-none" />
          </label>
        )} />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {rows === null && !error && (
        <div className="overflow-hidden rounded-lg border border-n-200"><RowsSkeleton rows={4} dense label="호선 목록을 불러오는 중" /></div>
      )}
      {rows?.length === 0 && !q && (
        <EmptyState icon={Anchor} title="아직 확정된 자료가 없습니다">자료를 올리고 확정하면 호선이 여기에 나타납니다.</EmptyState>
      )}
      {rows && (rows.length > 0 || q) && (
        <div role="table" aria-label="호선 목록" className="overflow-hidden rounded-lg border border-n-200">
          <div role="row" className={`${COLS} h-8 border-b border-n-200 bg-n-25 text-meta font-medium text-n-500`}>
            <span role="columnheader">호선</span><span role="columnheader">선종</span>
            <span role="columnheader" className="text-right">자료</span><span role="columnheader" className="text-right">최근 확정</span>
          </div>
          {rows.length === 0 && (
            <p className="py-10 text-center text-ui text-n-500"><span className="font-mono">{q}</span> 로 시작하는 호선이 없습니다.</p>
          )}
          {rows.map((r) => (
            <div key={r.hull_no} role="row" onClick={() => navigate(`/h/${encodeURIComponent(r.hull_no)}`)}
                 className={`${COLS} h-10 cursor-pointer border-b border-n-200 text-ui transition-colors duration-120 last:border-0 hover:bg-n-25`}>
              <span role="cell">
                <Link to={`/h/${encodeURIComponent(r.hull_no)}`} onClick={(e) => e.stopPropagation()}
                      className="font-mono font-medium text-n-900 hover:underline">{r.hull_no}</Link>
              </span>
              <span role="cell" className={`truncate ${r.ship_type ? 'text-n-700' : 'text-n-500'}`}>{r.ship_type || '—'}</span>
              <span role="cell" className="text-right font-mono text-n-700">{r.entries}</span>
              <span role="cell" className="text-right font-mono text-meta text-n-500">{formatDateTime(r.last_at).slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
