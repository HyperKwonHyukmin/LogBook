import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ship } from 'lucide-react';
import { api } from '../api/client.js';
import ShipSide2D from '../components/shipmap/ShipSide2D.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { selectClass } from '../components/ui/Field.jsx';
import { errorText } from '../lib/labels.js';
import { filterHref } from '../lib/search.js';
import {
  entriesIn, filterEntries, HEAT, heatColor, kindOptions, SHIP_ZONES, targetOptions, UNPLACED, UNPLACED_LABEL, zoneCounts,
} from '../lib/shipZones.js';

const VIEW_ITEMS = [{ id: 'iso', label: '입체' }, { id: 'side', label: '측면' }, { id: 'top', label: '위' }, { id: 'bow', label: '선수 쪽' }];
const LIST_MAX = 200;
const hullsOf = (e) => (e.rows || []).filter((k) => k.startsWith('h:')).map((k) => k.slice(2));
const zoneLabel = (z) => (z === UNPLACED ? UNPLACED_LABEL : z);

/** 3D 장면 — three.js 묶음은 이 화면을 열 때만 받는다. WebGL 이 안 되면 failed 로 알린다. */
function ShipCanvas({ counts, max, selected, view, onPick, onFail }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const sceneRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const stateRef = useRef({ counts, max, selected, view });
  stateRef.current = { counts, max, selected, view };

  useEffect(() => {
    let alive = true;
    let ro = null;
    import('../components/shipmap/shipScene.js').then(({ createShipScene }) => {
      if (!alive) return;
      try {
        const s = createShipScene({ canvas: canvasRef.current, overlay: overlayRef.current, onPick: (z) => pickRef.current(z) });
        sceneRef.current = s;
        const st = stateRef.current;
        s.setCounts(st.counts, st.max); s.select(st.selected); s.setView(st.view);
        if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => s.resize()); ro.observe(wrapRef.current); }
      } catch (err) {
        onFail(err);
      }
    }).catch(onFail);
    return () => { alive = false; ro?.disconnect(); sceneRef.current?.dispose(); sceneRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sceneRef.current?.setCounts(counts, max); }, [counts, max]);
  useEffect(() => { sceneRef.current?.select(selected); }, [selected]);
  useEffect(() => { sceneRef.current?.setView(view); }, [view]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-lg border border-n-200 bg-n-50">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="선박 지도 3D. 끌어서 돌리고, 휠로 확대하고, 구역을 누르면 그 자료가 오른쪽에 나옵니다." />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}

function Legend({ max }) {
  const steps = max > 1 ? [1, Math.round((1 + max) / 2), max] : [max || 1];
  return (
    <div className="flex items-center gap-2 text-meta text-n-600" aria-label="색 범례">
      <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-4 rounded-[3px] border border-n-200" style={{ background: HEAT.empty }} />0건</span>
      <span aria-hidden="true" className="inline-block h-3 w-24 rounded-[3px]"
            style={{ background: `linear-gradient(to right, ${steps.map((n) => heatColor(n, max)).join(', ')})` }} />
      <span className="tabular-nums">1 → {max}건</span>
    </div>
  );
}

function EntryRow({ e }) {
  const hulls = hullsOf(e);
  return (
    <li className="border-t border-n-100 py-2.5 first:border-t-0">
      <Link to={`/e/${e.id}`} className="text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">{e.title}</Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-600">
        <span className="font-mono">{e.id}</span>
        {e.target && <span>{e.target}</span>}
        {hulls.length > 0 && <span className="font-mono">{hulls.slice(0, 3).join(', ')}{hulls.length > 3 ? ` 외 ${hulls.length - 3}` : ''}</span>}
        {(e.zones || []).length > 1 && <span>구역 {e.zones.join(', ')}</span>}
        {e.confirmed_at && <span className="font-mono">{e.confirmed_at}</span>}
      </div>
    </li>
  );
}

/**
 * 선박 지도(73, `/ship-map`) — 확정 자료의 구역(배 안의 위치)을 단순화한 선체 위에 건수 색으로 칠한다.
 * 실제 선형, 프레임 위치가 아니라 구역 칸만 뜻한다. 구역을 누르면 오른쪽에 그 칸의 자료.
 * 재료는 갖춤 현황과 같은 GET /api/coverage(볼 수 있는 확정 자료). 셈은 lib/shipZones.js.
 */
export default function ShipMapPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState('iso');
  const kind = params.get('kind') || '';
  const target = params.get('target') || '';
  const zone = params.get('zone') || null;

  useEffect(() => {
    let alive = true;
    api('/coverage').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '자료를 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const entries = useMemo(() => (data ? filterEntries(data.entries, { kind, target }, data.hull_kinds) : []), [data, kind, target]);
  const stat = useMemo(() => zoneCounts(entries), [entries]);
  const kinds = useMemo(() => (data ? kindOptions(data.entries, data.hull_kinds) : []), [data]);
  const targets = useMemo(() => (data ? targetOptions(data.entries) : []), [data]);
  const list = useMemo(() => (zone ? entriesIn(entries, zone) : []), [entries, zone]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const pick = (z) => setParam('zone', z && z !== zone ? z : '');

  if (error) return <div className="px-6 py-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return <div className="px-6 py-6"><RowsSkeleton rows={8} /></div>;
  if (!data.entries.length) {
    return (
      <div className="px-6 py-6">
        <EmptyState icon={Ship} title="확정한 자료가 아직 없습니다">자료를 확정하면 구역별로 배 위에 칠해집니다.</EmptyState>
      </div>
    );
  }

  const zoneRows = [...SHIP_ZONES.map((z) => ({ id: z.name, n: stat.counts[z.name] })), { id: UNPLACED, n: stat.unplaced }];
  const selectCls = selectClass('w-auto min-w-[9rem]');

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-6 pt-5 min-[1441px]:px-8">
      <header className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-n-200 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">선박 지도</h1>
          <p className="mt-1 max-w-[72ch] text-ui text-n-600">
            확정 자료가 배의 어느 구역을 다뤘는지 단순화한 선체 위에 건수로 칠했습니다. 실제 선형과 프레임 위치가 아니라 구역 칸만 뜻합니다.
            구역을 누르면 오른쪽에 그 자료가 나옵니다.
          </p>
        </div>
        <span className="text-ui text-n-600 tabular-nums">자료 <b className="font-semibold text-n-900">{stat.total}</b>건</span>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-ui text-n-600">선종
          <select className={selectCls} value={kind} onChange={(e) => setParam('kind', e.target.value)}>
            <option value="">전체</option>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.value} ({k.count})</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-ui text-n-600">대상
          <select className={selectCls} value={target} onChange={(e) => setParam('target', e.target.value)}>
            <option value="">전체</option>
            {targets.map((t) => <option key={t.value} value={t.value}>{t.value} ({t.count})</option>)}
          </select>
        </label>
        {!failed && <Segmented label="시점" items={VIEW_ITEMS} value={view} onChange={setView} />}
        <span className="ml-auto"><Legend max={stat.max} /></span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[420px]">
          {failed ? (
            <div className="flex h-full flex-col justify-center gap-4 rounded-lg border border-n-200 bg-n-0 p-6">
              <ErrorNote>이 브라우저에서 3D 를 그릴 수 없어 옆모습으로 보입니다.</ErrorNote>
              <ShipSide2D zones={zone && zone !== UNPLACED ? [zone] : []} idPrefix="shipmap" />
            </div>
          ) : (
            <ShipCanvas counts={stat.counts} max={stat.max} selected={zone === UNPLACED ? null : zone} view={view}
                        onPick={pick} onFail={() => setFailed(true)} />
          )}
          <p className="pointer-events-none absolute bottom-2 left-3 text-meta text-n-500">끌어서 돌리기, 휠로 확대, 오른쪽 끌기로 옮기기</p>
        </div>

        <aside aria-label="구역 자료" className="flex min-h-0 flex-col rounded-lg border border-n-200 bg-n-0">
          {zone ? (
            <>
              <div className="flex items-start gap-3 border-b border-n-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-body font-semibold text-n-900">{zoneLabel(zone)}</h2>
                  <p className="mt-0.5 text-meta text-n-600">
                    자료 {list.length}건{zone === UNPLACED ? '. 구역이 기타이거나 비어 있어 배 위에 자리가 없습니다' : ''}
                  </p>
                </div>
                <button type="button" onClick={() => pick(null)} className="shrink-0 text-meta text-brand hover:underline">구역 목록</button>
              </div>
              <ul className="min-h-0 flex-1 overflow-auto px-4">
                {list.slice(0, LIST_MAX).map((e) => <EntryRow key={e.id} e={e} />)}
                {list.length === 0 && <li className="py-6 text-ui text-n-500">이 조건에 맞는 자료가 없습니다.</li>}
              </ul>
              {zone !== UNPLACED && (
                <div className="border-t border-n-100 px-4 py-2.5">
                  <Link to={filterHref('zone', zone)} className="text-meta text-brand hover:underline">검색에서 {zone} 자료 모두 보기</Link>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-n-100 px-4 py-3">
                <h2 className="text-body font-semibold text-n-900">구역별 자료</h2>
                <p className="mt-0.5 text-meta text-n-600">구역이 여럿인 자료는 칸마다 셉니다.</p>
              </div>
              <table className="w-full text-ui">
                <caption className="sr-only">구역별 자료 수</caption>
                <tbody>
                  {zoneRows.map((r) => (
                    <tr key={r.id} className="border-t border-n-100 first:border-t-0">
                      <td className="px-4 py-0">
                        <button type="button" onClick={() => pick(r.id)} className="flex w-full items-center gap-2 py-2 text-left text-n-900 hover:text-brand">
                          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] border border-n-200"
                                style={{ background: r.id === UNPLACED ? 'transparent' : heatColor(r.n, stat.max) }} />
                          <span className="flex-1">{zoneLabel(r.id)}</span>
                          <span className="tabular-nums font-semibold">{r.n}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
