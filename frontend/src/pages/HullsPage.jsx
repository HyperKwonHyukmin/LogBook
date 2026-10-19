import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Anchor, Search, Ship } from 'lucide-react';
import { api } from '../api/client.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { canWriteShared } from '../lib/levels.js';
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
  const me = useContext(AuthContext)?.user;
  const canFill = !me || canWriteShared(me);   // 15 — 호선 선종은 공용 정보라 LV2 이상
  const [filling, setFilling] = useState(false);
  const [reload, setReload] = useState(0);
  const toast = useToast();

  useEffect(() => {
    const id = ++reqRef.current; // 늦게 온 옛 응답은 버린다
    api(`/hulls?q=${encodeURIComponent(q)}`)
      .then((r) => { if (id === reqRef.current) { setRows(r); setError(''); } })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '호선 목록을 불러오지 못했습니다.')); });
  }, [q, reload]);

  // 30 — 선종이 비었거나 PLM 에서 찾지 못한 호선을 한 번에 조회한다(사람이 적은 선종은 그대로)
  async function fillFromPlm() {
    setFilling(true);
    try {
      const r = await api('/hulls/plm-fill', { method: 'POST' });
      toast.show({ tone: 'ok', message: r.checked === 0 ? '채울 호선이 없습니다.'
        : `PLM 조회 ${r.checked}건 — 찾음 ${r.found} · 없음 ${r.not_found} · 선종 채움 ${r.filled}` });
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorText(err, 'PLM 에서 선박 정보를 가져오지 못했습니다.'));
    } finally { setFilling(false); }
  }
  const unfilled = (rows || []).filter((r) => !r.ship_type && r.plm_status !== 'not_found').length;
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
          <div className="flex flex-wrap items-center gap-2">
          {canFill && (
            <Button variant="secondary" size="sm" loading={filling} disabled={filling} onClick={fillFromPlm}
                    title="선종이 비었거나 PLM 에서 찾지 못한 호선을 사내 PLM 에서 한 번에 조회합니다. 사람이 적은 선종은 바꾸지 않습니다.">
              <Ship size={14} aria-hidden="true" />선종 채우기(PLM){unfilled > 0 && <span className="font-mono">{unfilled}</span>}
            </Button>
          )}
          <label className={inputClass('flex w-56 items-center gap-2 px-2')}>
            <Search size={14} className="shrink-0 text-n-500" aria-hidden="true" />
            <input aria-label="호선 번호" value={text} onChange={onChange} onKeyDown={onKeyDown} placeholder="호선 번호로 거르기" inputMode="numeric"
                   className="min-w-0 flex-1 bg-transparent font-mono text-ui outline-none placeholder:font-sans focus-visible:outline-none" />
          </label>
          </div>
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
          <div role="row" className={`${COLS} h-9 border-b border-n-200 bg-n-50 text-meta font-medium text-n-600`}>
            <span role="columnheader">호선</span><span role="columnheader">선종</span>
            <span role="columnheader" className="text-right">자료</span><span role="columnheader" className="text-right">최근 확정</span>
          </div>
          {rows.length === 0 && (
            <p className="py-10 text-center text-ui text-n-500"><span className="font-mono">{q}</span> 로 시작하는 호선이 없습니다.</p>
          )}
          {rows.map((r) => (
            <div key={r.hull_no} role="row" onClick={() => navigate(`/h/${encodeURIComponent(r.hull_no)}`)}
                 className={`${COLS} h-11 cursor-pointer border-b border-n-200 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50`}>
              <span role="cell">
                <Link to={`/h/${encodeURIComponent(r.hull_no)}`} onClick={(e) => e.stopPropagation()}
                      className="font-mono text-body font-medium text-brand hover:underline">{r.hull_no}</Link>
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
