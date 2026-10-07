import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Anchor, Search } from 'lucide-react';
import { api } from '../api/client.js';
import { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { ErrorNote, Page, SectionTitle } from '../components/ui/Page.jsx';
import { Bar } from '../components/ui/Skeleton.jsx';
import { errorText } from '../lib/labels.js';

/** '2026-09' → '2026년 9월' */
const monthLabel = (m) => {
  const [y, mo] = (m || '').split('-');
  return y && mo ? `${y}년 ${Number(mo)}월` : m || '날짜 없음';
};
const mmdd = (iso) => (iso ? iso.slice(5, 10) : '—');

/** 분포 목록 — 값을 누르면 그 필터로 이 호선을 검색한다. 막대는 중립색. */
function Distribution({ title, rows, hullNo, filterKey }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section aria-label={title}>
      <SectionTitle className="mb-2">{title}</SectionTitle>
      {rows.length === 0 && <p className="text-meta text-n-500">없음</p>}
      <ul className="flex flex-col gap-px">
        {rows.map((r) => (
          <li key={r.value}>
            <Link to={`/?hull=${encodeURIComponent(hullNo)}&${filterKey}=${encodeURIComponent(r.value)}`}
                  className="grid h-7 grid-cols-[minmax(0,1fr)_64px_24px] items-center gap-2 rounded-md px-1.5 text-ui text-n-700 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
              <span className="truncate" title={r.value}>{r.value}</span>
              <span className="h-1.5 rounded-full bg-n-100">
                <span className="block h-full rounded-full bg-n-300" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-meta text-n-600">{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 호선 화면(설계 §6.1 `/h/{hull}`) — 한 줄 요약, 월별 타임라인, 분포, 참여자. */
export default function HullPage() {
  const { hullNo } = useParams();
  const navigate = useNavigate();
  const [hull, setHull] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true; // 다른 호선으로 옮겨 간 뒤 온 옛 응답은 버린다
    setHull(null); setMissing(false); setError('');
    api(`/hulls/${encodeURIComponent(hullNo)}`).then((h) => { if (live) setHull(h); }).catch((err) => {
      if (!live) return;
      if (err.status === 404) setMissing(true); else setError(errorText(err, '호선 정보를 불러오지 못했습니다.'));
    });
    return () => { live = false; };
  }, [hullNo]);

  // 선종·메모는 누구나 고친다(기록된다). 응답으로 머리말만 갱신한다.
  async function saveHull(patch) {
    try {
      const h = await api(`/hulls/${encodeURIComponent(hullNo)}`, { method: 'PATCH', body: patch });
      setHull((cur) => ({ ...cur, ship_type: h.ship_type, memo: h.memo }));
      setError('');
      return true;
    } catch (err) { setError(errorText(err, '저장하지 못했습니다.')); return false; }
  }

  if (missing) return <Page><EmptyState icon={Anchor} title="등록된 호선이 아닙니다">확정된 자료가 있는 호선만 볼 수 있습니다.</EmptyState></Page>;
  if (!hull) {
    return (
      <Page>
        {error ? <ErrorNote>{error}</ErrorNote> : (
          <div role="status" aria-label="호선 정보를 불러오는 중" className="appear-late">
            <Bar className="h-8 w-28" /><Bar className="mt-3 h-3 w-64" /><Bar className="mt-8 h-64" />
          </div>
        )}
      </Page>
    );
  }

  const s = hull.stats;
  const stat = (n, label, unit = '') => (
    <span><span className="mr-1 text-n-500">{label}</span><span className="font-mono font-medium text-n-900">{n}</span>{unit}</span>
  );
  return (
    <Page>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-n-200 pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="font-mono text-hull font-medium tracking-[-0.03em] text-brand">{hull.hull_no}<span className="sr-only"> 호선</span></h1>
            <span aria-hidden="true" className="text-body font-medium text-n-600">호선</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-ui">
            <span className="flex items-center gap-1.5"><span className="text-n-500">선종</span>
              <InlineText label="선종" value={hull.ship_type} onSave={(v) => saveHull({ ship_type: v || null })} className="text-n-900" /></span>
            <span className="flex min-w-0 items-center gap-1.5"><span className="text-n-500">메모</span>
              <InlineText label="메모" value={hull.memo} onSave={(v) => saveHull({ memo: v || null })} className="text-n-900" /></span>
          </div>
          <p className="tnum mt-2 flex flex-wrap items-center gap-x-2 text-ui text-n-600">
            {stat(s.entries, '자료')}<span aria-hidden="true" className="text-n-300">·</span>
            {stat(s.files, '파일')}<span aria-hidden="true" className="text-n-300">·</span>
            {stat(s.analysis_types.length, '해석 종류')}<span aria-hidden="true" className="text-n-300">·</span>
            {stat(s.people.length, '참여자', '명')}
            {hull.drafts > 0 && (
              <>
                <span aria-hidden="true" className="text-n-300">·</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-wait">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-wait" /><span>미확정 {hull.drafts}건</span>
                </span>
              </>
            )}
          </p>
        </div>
        <Link to={`/?hull=${hull.hull_no}`} className={buttonClass('secondary', 'sm')}>
          <Search size={14} aria-hidden="true" />이 호선 자료 검색
        </Link>
      </header>
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

      <div className="mt-6 grid grid-cols-1 gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_272px]">
        <ol aria-label="월별 타임라인" className="flex min-w-0 flex-col gap-6">
          {hull.timeline.length === 0 && <li className="text-ui text-n-500">확정된 자료가 없습니다.</li>}
          {hull.timeline.map((m) => (
            <li key={m.month}>
              <h2 className="mb-2 text-ui font-semibold text-n-700">{monthLabel(m.month)}</h2>
              <ul className="overflow-hidden rounded-lg border border-n-200">
                {m.entries.map((e) => (
                  <li key={e.entry_id} onClick={() => navigate(`/e/${e.entry_id}`)}
                      className="grid h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_72px_44px] items-center gap-3 border-b border-n-200 px-3 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50">
                    <span className="flex min-w-0 items-center gap-2">
                      <Link to={`/e/${e.entry_id}`} onClick={(ev) => ev.stopPropagation()}
                            className="truncate font-semibold text-n-900 hover:underline">{e.title}</Link>
                      {e.analysis_type && <span className="shrink-0 text-meta text-n-500">{e.analysis_type}</span>}
                    </span>
                    <span className="truncate text-meta text-n-500">{e.zones.join(', ')}</span>
                    <span className="flex gap-1">{e.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
                    <span className="text-right font-mono text-meta text-n-500">{e.entry_id}</span>
                    <span className="text-right font-mono text-meta text-n-500">{mmdd(e.confirmed_at)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <aside className="flex min-w-0 flex-col gap-6">
          <Distribution title="구역 분포" rows={s.zones} hullNo={hull.hull_no} filterKey="zone" />
          <Distribution title="해석 종류" rows={s.analysis_types} hullNo={hull.hull_no} filterKey="analysis_type" />
          <section aria-label="참여자">
            <SectionTitle className="mb-2">참여자</SectionTitle>
            {s.people.length === 0 && <p className="text-meta text-n-500">없음</p>}
            <ul className="flex flex-col gap-px">
              {s.people.map((p) => (
                <li key={p.employee_id} className="flex h-7 items-center justify-between px-1.5 text-ui text-n-700">
                  <span title={p.employee_id}>{p.name || <span className="font-mono">{p.employee_id}</span>}</span>
                  <span className="text-meta text-n-500"><span className="font-mono">{p.count}</span>건</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Page>
  );
}
