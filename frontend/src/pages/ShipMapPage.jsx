import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, RotateCw, Ship } from 'lucide-react';
import { api } from '../api/client.js';
import ShipSide2D from '../components/shipmap/ShipSide2D.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { selectClass } from '../components/ui/Field.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { errorText } from '../lib/labels.js';
import { filterHref } from '../lib/search.js';
import {
  breadthOf, entriesIn, filterEntries, HEAT, kindOptions, SHIP_ZONES, targetOptions, UNPLACED, UNPLACED_LABEL, zoneCounts,
} from '../lib/shipZones.js';

const VIEW_ITEMS = [{ id: 'iso', label: '입체' }, { id: 'side', label: '측면' }, { id: 'top', label: '위' }, { id: 'bow', label: '선수 쪽' }];
const LIST_MAX = 200;
const hullsOf = (e) => (e.rows || []).filter((k) => k.startsWith('h:')).map((k) => k.slice(2));
const zoneLabel = (z) => (z === UNPLACED ? UNPLACED_LABEL : z);
const topTargets = (list, limit) => {
  const all = targetOptions(list);
  return { top: all.slice(0, limit), rest: all.length - Math.min(limit, all.length), kinds: all.length };
};

/** 3D 장면 — three.js 묶음은 이 화면을 열 때만 받는다. WebGL 이 안 되면 onFail 로 알린다. */
function ShipCanvas({ counts, max, selected, view, spin, onPick, onHover, onFail }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const sceneRef = useRef(null);
  const cb = useRef({ onPick, onHover });
  cb.current = { onPick, onHover };
  const stateRef = useRef({ counts, max, selected, view, spin });
  stateRef.current = { counts, max, selected, view, spin };
  const firstView = useRef(true);

  useEffect(() => {
    let alive = true;
    let ro = null;
    import('../components/shipmap/shipScene.js').then(({ createShipScene }) => {
      if (!alive) return;
      try {
        const s = createShipScene({ canvas: canvasRef.current, overlay: overlayRef.current,
          onPick: (z) => cb.current.onPick(z), onHover: (z, p) => cb.current.onHover(z, p) });
        sceneRef.current = s;
        const st = stateRef.current;
        s.setCounts(st.counts, st.max); s.select(st.selected); s.setAutoRotate(st.spin);
        if (st.view !== 'iso') s.setView(st.view);
        if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => s.resize()); ro.observe(wrapRef.current); }
      } catch (err) {
        onFail(err);
      }
    }).catch(onFail);
    return () => { alive = false; ro?.disconnect(); sceneRef.current?.dispose(); sceneRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sceneRef.current?.setCounts(counts, max); }, [counts, max]);
  useEffect(() => { sceneRef.current?.select(selected); }, [selected]);
  useEffect(() => { sceneRef.current?.setAutoRotate(spin); }, [spin]);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }   // 처음 시점은 장면이 스스로 들어온다
    sceneRef.current?.setView(view);
  }, [view]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden rounded-lg" style={{ background: '#0E1A2B' }}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none"
              aria-label="선박 지도 3D. 끌어서 돌리고, 휠로 확대하고, 구역을 누르면 그 자료가 오른쪽에 나옵니다." />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}

/** 뷰어 위 한 줄 — 얼마나 넓게 검토했나. */
function Breadth({ stat, breadth }) {
  const items = [['자료', stat.total, '건'], ['호선', breadth.hulls, '척'], ['선종', breadth.kinds, '종'], ['대상', breadth.targets, '종'],
    ['자료가 있는 구역', `${stat.covered}/${SHIP_ZONES.length}`, '']];
  return (
    <dl className="pointer-events-none absolute left-4 top-3.5 flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([k, v, unit]) => (
        <div key={k} className="flex items-baseline gap-1.5">
          <dt className="text-meta text-on-navy-subtle">{k}</dt>
          <dd className="font-mono text-body font-medium text-on-navy">{v}<span className="ml-0.5 font-sans text-meta font-normal text-on-navy-muted">{unit}</span></dd>
        </div>
      ))}
    </dl>
  );
}

function Legend({ max }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-3 text-meta text-on-navy-muted" aria-label="색 범례">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] border border-dashed border-on-navy-icon" />자료 없음
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span>1건</span>
        <span aria-hidden="true" className="inline-block h-2.5 w-24 rounded-[3px]" style={{ background: `linear-gradient(to right, ${HEAT.stops.join(', ')})` }} />
        <span className="font-mono">{max}건</span>
      </span>
    </div>
  );
}

/** 가로 막대 한 줄(흰 면) — 길이로 건수를 보인다. */
function BarRow({ label, n, max, onClick, muted = false }) {
  const body = (
    <>
      <span className={`w-[5.5rem] shrink-0 truncate text-left ${n ? 'text-n-900' : 'text-n-500'}`}>{label}</span>
      <span aria-hidden="true" className="h-2 min-w-0 flex-1 rounded-xs bg-n-100">
        <span className={`block h-full rounded-xs ${muted ? 'bg-n-300' : 'bg-brand'}`} style={{ width: `${max ? (n / max) * 100 : 0}%`, minWidth: n ? 3 : 0 }} />
      </span>
      <span className={`w-12 shrink-0 text-right font-mono ${n ? 'font-medium text-n-900' : 'text-n-500'}`}>{n}<span className="font-sans font-normal text-n-500">건</span></span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-ui hover:bg-n-50">{body}</button>
    : <div className="flex items-center gap-3 px-2 py-1 text-ui">{body}</div>;
}

function EntryRow({ e }) {
  const hulls = hullsOf(e);
  return (
    <li className="border-t border-n-100 py-2.5 first:border-t-0">
      <Link to={`/e/${e.id}`} className="text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">{e.title}</Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-600">
        <span className="font-mono">{e.id}</span>
        {e.target && <span>{e.target}</span>}
        {hulls.length > 0 && <span className="font-mono">{hulls.slice(0, 3).join(', ')}{hulls.length > 3 ? ` +${hulls.length - 3}` : ''}</span>}
        {(e.zones || []).length > 1 && <span>구역 {e.zones.join(', ')}</span>}
        {e.confirmed_at && <span className="font-mono">{e.confirmed_at}</span>}
      </div>
    </li>
  );
}

/**
 * 선박 지도(73, `/ship-map`) — 확정 자료의 구역(배 안의 위치)을 유리 선체 안의 칸으로 놓고 건수 색으로 빛나게 한다.
 * 실제 선형, 프레임 위치가 아니라 구역 칸만 뜻한다. 구역을 누르면 카메라가 다가가고 오른쪽에 그 칸의 자료.
 * 재료는 갖춤 현황과 같은 GET /api/coverage(볼 수 있는 확정 자료). 셈은 lib/shipZones.js.
 */
export default function ShipMapPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [spin, setSpin] = useState(false);
  const [tip, setTip] = useState(null);   // { zone, x, y } — 뷰어 틀 기준
  const stageRef = useRef(null);
  const kind = params.get('kind') || '';
  const target = params.get('target') || '';
  const zone = params.get('zone') || null;
  const view = VIEW_ITEMS.some((v) => v.id === params.get('view')) ? params.get('view') : 'iso';   // 시점도 주소에(링크로 같은 모습을 보낸다)

  useEffect(() => {
    let alive = true;
    api('/coverage').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '자료를 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const entries = useMemo(() => (data ? filterEntries(data.entries, { kind, target }, data.hull_kinds) : []), [data, kind, target]);
  const stat = useMemo(() => zoneCounts(entries), [entries]);
  const breadth = useMemo(() => breadthOf(entries, data?.hull_kinds), [entries, data]);
  const kinds = useMemo(() => (data ? kindOptions(data.entries, data.hull_kinds) : []), [data]);
  const targets = useMemo(() => (data ? targetOptions(data.entries) : []), [data]);
  const list = useMemo(() => (zone ? entriesIn(entries, zone) : []), [entries, zone]);
  const mix = useMemo(() => topTargets(list, 5), [list]);
  const tipInfo = useMemo(() => (tip?.zone ? topTargets(entriesIn(entries, tip.zone), 3) : null), [entries, tip?.zone]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const pick = (z) => setParam('zone', z && z !== zone ? z : '');
  const hover = (z, p) => {
    if (!z || !p || !stageRef.current) { setTip(null); return; }
    const r = stageRef.current.getBoundingClientRect();
    setTip({ zone: z, x: p.x - r.left, y: p.y - r.top });
  };

  if (error) return <div className="px-6 py-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return <div className="px-6 py-6"><RowsSkeleton rows={8} /></div>;
  if (!data.entries.length) {
    return (
      <div className="px-6 py-6">
        <EmptyState icon={Ship} title="확정한 자료가 아직 없습니다">자료를 확정하면 구역별로 배 안의 칸이 채워집니다.</EmptyState>
      </div>
    );
  }

  const selectCls = selectClass('w-auto min-w-[9rem]');
  const listMax = Math.max(stat.max, stat.unplaced, 1);

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-6 pt-5 min-[1441px]:px-8">
      <header className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">선박 지도</h1>
          <p className="mt-1 max-w-[70ch] text-ui text-n-600">
            확정 자료가 배의 어느 구역을 검토했는지 봅니다. 밝게 빛나는 칸일수록 자료가 많고, 테두리만 있는 칸은 아직 자료가 없습니다.
            단순화한 선체라 구역 칸만 뜻하며 실제 프레임 위치는 아닙니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={stageRef} className="relative min-h-[440px]">
          {failed ? (
            <div className="flex h-full flex-col justify-center gap-4 rounded-lg border border-n-200 bg-n-0 p-6">
              <ErrorNote>이 브라우저에서 3D 를 그릴 수 없어 옆모습으로 보입니다. 오른쪽 목록에서 구역을 고르세요.</ErrorNote>
              <ShipSide2D zones={zone && zone !== UNPLACED ? [zone] : []} idPrefix="shipmap" />
            </div>
          ) : (
            <>
              <ShipCanvas counts={stat.counts} max={stat.max} selected={zone === UNPLACED ? null : zone} view={view} spin={spin}
                          onPick={pick} onHover={hover} onFail={() => setFailed(true)} />
              <Breadth stat={stat} breadth={breadth} />
              <div className="absolute right-3 top-3 flex items-center gap-2">
                <Segmented label="시점" items={VIEW_ITEMS} value={view} onChange={(v) => { setSpin(false); setParam('view', v === 'iso' ? '' : v); }} />
                <button type="button" aria-pressed={spin} onClick={() => setSpin((s) => !s)} title="배를 천천히 돌립니다(설명할 때)"
                        className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-meta font-medium transition-colors duration-150 ease-out
                          ${spin ? 'bg-n-0 text-navy-900' : 'bg-navy-800 text-on-navy-muted hover:bg-navy-700 hover:text-on-navy'}`}>
                  <RotateCw size={13} aria-hidden="true" />자동 회전
                </button>
              </div>
              <p className="pointer-events-none absolute bottom-3 left-4 text-meta text-on-navy-subtle">끌어서 돌리기, 휠로 확대, 오른쪽 끌기로 옮기기</p>
              <Legend max={stat.max} />
              {tip && tipInfo && (
                <div role="tooltip" className="pointer-events-none absolute z-10 w-max max-w-[260px] rounded-md border border-navy-600 bg-navy-950/95 px-3 py-2 shadow-lg"
                     style={{ left: Math.min(tip.x + 16, (stageRef.current?.clientWidth || 9999) - 270), top: tip.y + 18 }}>
                  <div className="flex items-baseline gap-2 text-ui font-semibold text-on-navy">
                    {tip.zone}<span className="font-mono font-medium">{stat.counts[tip.zone]}<span className="font-sans font-normal text-on-navy-muted">건</span></span>
                  </div>
                  {stat.counts[tip.zone] > 0 ? (
                    <p className="mt-0.5 text-meta text-on-navy-muted">
                      {tipInfo.top.map((t) => `${t.value} ${t.count}`).join(', ')}{tipInfo.rest > 0 ? ` 외 ${tipInfo.rest}종` : ''}
                    </p>
                  ) : <p className="mt-0.5 text-meta text-on-navy-subtle">아직 확정한 자료가 없습니다</p>}
                </div>
              )}
            </>
          )}
        </div>

        <aside aria-label="구역 자료" className="flex min-h-0 flex-col rounded-lg border border-n-200 bg-n-0">
          {zone ? (
            <>
              <div className="border-b border-n-100 px-4 pb-3 pt-2.5">
                <button type="button" onClick={() => pick(null)} className="-ml-1.5 inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-meta text-n-600 hover:bg-n-50 hover:text-n-900">
                  <ChevronLeft size={14} aria-hidden="true" />구역 전체
                </button>
                <h2 className="mt-1 flex items-baseline gap-2 text-body font-semibold text-n-900">
                  {zoneLabel(zone)}
                  <span className="font-mono text-ui font-medium text-n-600">{list.length}<span className="font-sans font-normal">건</span></span>
                </h2>
                {zone === UNPLACED && <p className="mt-0.5 text-meta text-n-600">구역이 기타이거나 비어 있어 배 위에 자리가 없습니다.</p>}
                {mix.kinds > 0 && (
                  <div className="mt-2.5">
                    <h3 className="px-2 text-meta text-n-600">대상 {mix.kinds}종</h3>
                    <div className="mt-0.5">
                      {mix.top.map((t) => <BarRow key={t.value} label={t.value} n={t.count} max={mix.top[0].count} />)}
                      {mix.rest > 0 && <p className="px-2 pt-0.5 text-meta text-n-500">그 밖 {mix.rest}종</p>}
                    </div>
                  </div>
                )}
              </div>
              <ul className="min-h-0 flex-1 overflow-auto px-4">
                {list.slice(0, LIST_MAX).map((e) => <EntryRow key={e.id} e={e} />)}
                {list.length === 0 && <li className="py-6 text-ui text-n-600">이 조건에서는 이 구역의 자료가 없습니다.</li>}
              </ul>
              {zone !== UNPLACED && list.length > 0 && (
                <div className="border-t border-n-100 px-4 py-2.5">
                  <Link to={filterHref('zone', zone)} className="text-meta text-brand hover:underline">검색에서 {zone} 자료 모두 보기</Link>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-n-100 px-4 py-3">
                <h2 className="text-body font-semibold text-n-900">구역별 자료</h2>
                <p className="mt-0.5 text-meta text-n-600">
                  구역 {SHIP_ZONES.length}곳 중 {stat.covered}곳에 자료가 있습니다. 구역이 여럿인 자료는 칸마다 셉니다.
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                {SHIP_ZONES.map((z) => <BarRow key={z.name} label={z.name} n={stat.counts[z.name]} max={listMax} onClick={() => pick(z.name)} />)}
                <div className="mx-2 my-1.5 border-t border-n-100" />
                <BarRow label={UNPLACED_LABEL} n={stat.unplaced} max={listMax} muted onClick={() => pick(UNPLACED)} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
