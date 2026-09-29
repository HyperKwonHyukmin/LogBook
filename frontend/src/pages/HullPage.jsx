import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Anchor, Search } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { errorText } from '../lib/labels.js';

/** 가로 막대 분포 — 최대값 대비 폭. */
function Bars({ title, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold text-zinc-500">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-zinc-400">없음</p>}
      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.value} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-zinc-700" title={r.value}>{r.value}</span>
            <span className="min-w-0 flex-1">
              <span className="block h-2 rounded-full bg-brand/70" style={{ width: `${(r.count / max) * 100}%`, minWidth: 4 }} />
            </span>
            <span className="font-mono tabular-nums text-zinc-500">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 호선 화면(설계 §6.1 `/h/{hull}`) — 통계, 월별 타임라인, 구역 분포, 참여자. */
export default function HullPage() {
  const { hullNo } = useParams();
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
    } catch (err) { setError(errorText(err, '저장하지 못했습니다.')); }
  }

  if (missing) return <EmptyState icon={Anchor} title="등록된 호선이 아닙니다">확정된 자료가 있는 호선만 볼 수 있습니다.</EmptyState>;
  if (!hull) return error ? <p role="alert" className="p-6 text-[13px] text-err">{error}</p> : <div className="m-6 h-40 animate-pulse rounded-lg bg-zinc-200/60" />;

  const s = hull.stats;
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="font-mono text-3xl font-bold tracking-tight text-brand">{hull.hull_no}<span className="sr-only"> 호선</span></h1>
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="text-zinc-500">선종 <InlineText label="선종" value={hull.ship_type} onSave={(v) => saveHull({ ship_type: v || null })} className="text-zinc-900" /></span>
          <span className="text-zinc-500">메모 <InlineText label="메모" value={hull.memo} onSave={(v) => saveHull({ memo: v || null })} className="text-zinc-900" /></span>
        </div>
        <div className="flex-1" />
        {hull.drafts > 0 && <span className="text-xs font-semibold text-wait">미확정 {hull.drafts}건</span>}
        <Link to={`/?hull=${hull.hull_no}`} className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">
          <Search size={14} aria-hidden="true" />이 호선 자료 검색
        </Link>
      </header>
      {error && <p role="alert" className="mt-2 text-[13px] text-err">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="자료" value={s.entries} /><Stat label="파일" value={s.files} />
        <Stat label="해석 종류" value={s.analysis_types.length} /><Stat label="참여자" value={s.people.length} />
      </div>
      <div className="mt-5 flex gap-5">
        <ol aria-label="월별 타임라인" className="min-w-0 flex-1 space-y-4">
          {hull.timeline.length === 0 && <li className="text-[13px] text-zinc-500">확정된 자료가 없습니다.</li>}
          {hull.timeline.map((m) => (
            <li key={m.month}>
              <h2 className="mb-1.5 font-mono text-xs font-semibold text-zinc-500">{m.month}</h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                {m.entries.map((e) => (
                  <li key={e.entry_id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="w-20 shrink-0 font-mono text-xs text-zinc-500">{e.entry_id}</span>
                    <Link to={`/e/${e.entry_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand hover:underline">{e.title}</Link>
                    {e.analysis_type && <span className="text-xs text-zinc-600">{e.analysis_type}</span>}
                    {e.zones.length > 0 && <span className="text-xs text-zinc-500">{e.zones.join(', ')}</span>}
                    <span className="flex gap-1">{e.kinds.map((k) => <KindBadge key={k} kind={k} />)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="w-72 shrink-0 space-y-3">
          <Bars title="구역 분포" rows={s.zones} />
          <Bars title="해석 종류" rows={s.analysis_types} />
          <section aria-label="참여자" className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold text-zinc-500">참여자</h2>
            {s.people.length === 0 && <p className="text-xs text-zinc-400">없음</p>}
            <ul className="space-y-1 text-xs">
              {s.people.map((p) => (
                <li key={p.employee_id} className="flex justify-between"><span>{p.name || p.employee_id}</span>
                  <span className="font-mono text-zinc-500">{p.count}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
