import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp, Maximize, SlidersHorizontal, Waypoints } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { createGraphView, GRAPH_COLORS as K } from '../components/graph/graphView.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { errorText } from '../lib/labels.js';
import {
  aggregate, aggText, buildModel, diffShort, GROUP, GROUP_KEYS, isReportOnly, JOSA, membersOf, pairsOf, pivotHubs,
  primaryOf, searchNodes, stepText,
} from '../lib/graphModel.js';

// 44 — 대상 기준 추가, 순서 = 호선 · 대상 · 선종 · 구역 · 크기급
const PIVOT_ITEMS = [{ id: 'hull', label: '호선' }, { id: 'target', label: '대상' }, { id: 'kind', label: '선종' },
  { id: 'zone', label: '구역' }, { id: 'size', label: '크기급' }];
// 42 — 해석 종류 색은 없앴다
const COLOR_ITEMS = [{ id: 'none', label: '없음' }, { id: 'ship', label: '선종' }];
// 32 — 자료 사이 선의 층: 모델(형상만 같음·똑같은 BDF) · 문서(사용한 모델·보고서 다른 판·본문 비슷함)
const LAYER_ITEMS = [{ id: 'all', label: '모두' }, { id: 'model', label: '모델' }, { id: 'doc', label: '문서' }];
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 관계 지도(25, `/graph`) — 확정 자료를 고른 기준(호선·구역) 둘레에 모으고, 기준 사이 관계를 굵은 곡선으로,
 * 자료 사이 모델 관계(형상만 같음·똑같은 BDF)와 문서 관계(32 — 사용한 모델·보고서 다른 판·본문 비슷함)를 선으로 보인다.
 * 모든 선은 올리면 왜 이어졌는지 문장으로 설명한다. 보고서만 있는 자료는 속이 빈 점이다.
 * 그리기·배치·움직임은 components/graph/graphView.js, 묶기·설명 문장은 lib/graphModel.js.
 */
export default function GraphPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pivot, setPivot] = useState('hull');
  const [color, setColor] = useState('none');
  const [sel, setSel] = useState(null);
  const [hl, setHl] = useState(null);
  const [opts, setOpts] = useState({ agg: true, secondary: true, alwaysPairs: false, rings: [], layer: 'all' });
  const [pop, setPop] = useState(null);       // 'help' | 'show' | null
  const [view, setView] = useState(null);     // Stage 가 만든 캔버스 엔진(모델이 바뀌면 새로 만든다)

  useEffect(() => {
    let alive = true;
    api('/graph').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '관계 지도를 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);
  const model = useMemo(() => (data ? buildModel(data) : null), [data]);

  useEffect(() => { view?.setPivot(pivot); }, [view, pivot]);
  useEffect(() => { view?.setColor(color); }, [view, color]);
  useEffect(() => { view?.setOptions(opts); }, [view, opts]);
  useEffect(() => { view?.setSelection(sel); }, [view, sel]);
  useEffect(() => { view?.setHighlight(hl); }, [view, hl]);

  function changePivot(p) {
    setPivot(p); setSel(null);
    setOpts((o) => ({ ...o, rings: o.rings.filter((g) => g !== p) }));
    if (hl && model?.byId.get(hl)?.g === p) setHl(null);
  }
  const goTo = (id) => view?.goTo(id);
  const onSelect = (id) => { setSel(id); if (id) setHl(null); };

  const counts = model && (
    <span className="text-ui text-n-600 tabular-nums">
      자료 <b className="font-semibold text-n-900">{model.entries.length}</b>
      {' · '}{GROUP[pivot]} <b className="font-semibold text-n-900">{pivotHubs(model, pivot).filter((h) => !h.none).length}</b>
      {model.NONE[pivot].cnt > 0 && <>{' · '}{GROUP[pivot]} 없음 <b className="font-semibold text-n-900">{model.NONE[pivot].cnt}</b></>}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-n-200 px-6 pb-3.5 pt-5">
        <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">관계 지도</h1>
        {counts}
        {model?.truncated && <span className="text-meta text-n-500">최근 확정 {model.entries.length}건만 그렸습니다.</span>}
        <DocIndexNote index={model?.docIndex} layer={opts.layer} isAdmin={isAdmin} />
        {model?.unsigned > 0 && (
          <span className="ml-auto rounded-sm bg-wait-bg px-2 py-0.5 text-meta text-wait"
                title={isAdmin ? 'app.cli enqueue-convert --missing-signature 로 서명을 채우면 관계에 들어갑니다.' : undefined}>
            내용 서명이 없는 BDF {model.unsigned}개는 모델 관계에서 빠졌습니다
          </span>
        )}
      </header>
      {error && <ErrorNote className="m-6">{error}</ErrorNote>}
      {!model && !error && <div className="p-6"><RowsSkeleton rows={5} label="관계 지도를 불러오는 중" /></div>}
      {model && model.entries.length === 0 && (
        <div className="p-6"><EmptyState icon={Waypoints} title="볼 수 있는 확정 자료가 없습니다">자료를 확정하면 호선·구역별로 이어져 여기에 나타납니다.</EmptyState></div>
      )}
      {model && model.entries.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-[224px_minmax(0,1fr)_288px] max-[1100px]:grid-cols-1 max-[1100px]:overflow-y-auto">
          <FilterColumn model={model} pivot={pivot} onPivot={changePivot} color={color} onColor={setColor} onGo={goTo}
                        layer={opts.layer} onLayer={(v) => setOpts((o) => ({ ...o, layer: v }))} />
          <Stage model={model} view={view} setView={setView} pivot={pivot} hl={hl} setHl={setHl} onSelect={onSelect}
                 opts={opts} setOpts={setOpts} pop={pop} setPop={setPop} focused={!!sel || !!hl} />
          <DetailColumn model={model} pivot={pivot} sel={sel} onGo={goTo} layer={opts.layer} />
        </div>
      )}
    </div>
  );
}

/** 문서 관계가 덜 그려진 이유 — 본문 색인을 열 수 없거나, 색인 전 보고서가 있을 때. */
function DocIndexNote({ index, layer, isAdmin }) {
  if (!index || layer === 'model' || !index.reports) return null;
  if (!index.available) {
    return (
      <span className="rounded-sm bg-wait-bg px-2 py-0.5 text-meta text-wait">
        보고서 본문 색인을 열 수 없어 문서 관계는 ‘사용한 모델’과 파일 이름으로만 그렸습니다
      </span>
    );
  }
  const missing = index.reports - index.indexed;
  if (missing <= 0) return null;
  return (
    <span className="text-meta text-n-500" title={isAdmin ? '보고서 색인 워커(Logbook Report Index)가 처리하면 본문 관계에 들어갑니다.' : undefined}>
      본문 색인 전 보고서 {missing}개는 본문 관계에서 빠졌습니다
    </span>
  );
}

function SecTitle({ children }) {
  return <h2 className="text-meta font-semibold text-n-600">{children}</h2>;
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-meta text-n-700">
          <i aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: it.color }} />{it.label}
        </span>
      ))}
    </div>
  );
}

function FilterColumn({ model, pivot, onPivot, color, onColor, onGo, layer, onLayer }) {
  const [q, setQ] = useState('');
  const [hint, setHint] = useState('');
  const hits = useRef({ list: [], idx: 0 });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function onChange(e) {
    const v = e.target.value;
    setQ(v); clearTimeout(timer.current);
    const list = searchNodes(model, v, pivot);
    hits.current = { list, idx: 0 };
    if (!v.trim()) { setHint(''); return; }
    setHint(list.length ? `${list.length}개 일치. Enter 로 다음 결과.` : '일치하는 호선·태그·자료가 없습니다. 호선 번호는 4자리로 찾아 보세요.');
    if (list.length) timer.current = setTimeout(() => onGo(list[0].id), 300);
  }
  function onKeyDown(e) {
    const { list } = hits.current;
    if (e.key !== 'Enter' || !list.length) return;
    e.preventDefault(); clearTimeout(timer.current);
    hits.current.idx = (hits.current.idx + (e.shiftKey ? -1 : 1) + list.length) % list.length;
    setHint(`${hits.current.idx + 1} / ${list.length}`);
    onGo(list[hits.current.idx].id);
  }
  const legend = color === 'ship' ? model.colors.ship.items : null;
  return (
    <aside aria-label="보기 설정" className="flex min-w-0 flex-col gap-6 overflow-y-auto border-r border-n-200 px-4 py-5
                                         max-[1100px]:order-2 max-[1100px]:border-r-0 max-[1100px]:border-t">
      <section className="flex flex-col gap-2">
        <SecTitle>모으는 기준</SecTitle>
        <Segmented items={PIVOT_ITEMS} value={pivot} onChange={onPivot} label="모으는 기준" stretch dense className="w-full" />
      </section>
      <section className="flex flex-col gap-2">
        <SecTitle>자료 사이 관계</SecTitle>
        <Segmented items={LAYER_ITEMS} value={layer} onChange={onLayer} label="자료 사이 관계" stretch className="w-full" />
        <p className="text-meta text-n-500">
          {layer === 'model' ? 'BDF 내용 서명으로 이은 선만 봅니다.'
            : layer === 'doc' ? '보고서로 이은 선만 봅니다. 모델이 없는 자료도 이어집니다.'
              : '모델 선(남색)과 문서 선(청록)을 함께 봅니다.'}
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <SecTitle>자료 점 색</SecTitle>
        <Segmented items={COLOR_ITEMS} value={color} onChange={onColor} label="자료 점 색" stretch className="w-full" />
        {legend && <Legend items={legend} />}
      </section>
      <section className="flex flex-col gap-2">
        <SecTitle>찾기</SecTitle>
        <input type="search" value={q} onChange={onChange} onKeyDown={onKeyDown} aria-label="지도에서 찾기" autoComplete="off"
               placeholder="호선 번호, 태그, 자료 번호·제목" className={inputClass('h-8 w-full px-2.5')} />
        <p className="text-meta text-n-500" aria-live="polite">{hint || '입력을 멈추면 첫 결과로 이동합니다. Enter 로 다음 결과.'}</p>
      </section>
    </aside>
  );
}

const toolClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-n-250 bg-n-0 px-2.5 text-meta font-medium text-n-700 shadow-xs '
  + 'transition-colors duration-150 hover:border-n-300 hover:bg-n-50 aria-expanded:border-brand aria-expanded:text-brand';

function Stage({ model, view, setView, pivot, hl, setHl, onSelect, opts, setOpts, pop, setPop, focused }) {
  const canvasRef = useRef(null), stageRef = useRef(null), tipRef = useRef(null);
  const cb = useRef({});
  cb.current = { onSelect, onHighlight: (id) => { setHl(id); if (id) onSelect(null); } };

  useEffect(() => {
    const v = createGraphView({
      canvas: canvasRef.current, stage: stageRef.current, tip: tipRef.current, reducedMotion: reduced(),
      on: { onSelect: (id) => cb.current.onSelect(id), onHighlight: (id) => cb.current.onHighlight(id) },
    });
    v.setPivot(pivot);
    v.setModel(model);
    setView(v);   // 부모의 동기화 effect(색·선 옵션·선택·강조)가 새 엔진에 값을 넣는다
    return () => { v.destroy(); setView(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    if (!pop) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('[data-pop]')) setPop(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [pop, setPop]);

  const hlNode = hl && model.byId.get(hl);
  const g = GROUP[pivot];
  const shown = pairsOf(model, opts.layer);
  const has = (t) => shown.some((p) => p.type === t);
  const showModel = opts.layer !== 'doc', showDoc = opts.layer !== 'model';
  // 2026-10-20 — 범례는 지금 그려진 선만. 형상만 같음·사용한 모델·본문 비슷함·함께 등록은 점을 고르거나 '늘 보기'일 때만 그린다
  const quiet = focused || opts.alwaysPairs;
  return (
    <div ref={stageRef} className="relative min-h-0 min-w-0 overflow-hidden bg-n-0 max-[1100px]:order-1 max-[1100px]:h-[64vh] max-[1100px]:min-h-[380px]">
      <canvas ref={canvasRef} tabIndex={0} className="absolute inset-0 block h-full w-full cursor-grab touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring"
              aria-label="자료 관계 지도. 화살표로 점을 옮겨 다니고 Esc 로 선택을 풉니다." />
      <div className="absolute left-3.5 top-3.5 flex items-center gap-2" data-pop>
        <button type="button" className={toolClass} aria-expanded={pop === 'help'} onClick={() => setPop(pop === 'help' ? null : 'help')}>
          <CircleHelp size={14} aria-hidden="true" />읽는 법
        </button>
        <div className="rounded-md border border-n-200 bg-n-0 px-2.5 py-1 text-meta text-n-600 max-[560px]:hidden">
          {hlNode ? (
            <><b className="font-semibold text-brand">{hlNode.label}</b> 자료 {hlNode.cnt}건 강조
              <button type="button" onClick={() => setHl(null)} className="ml-1.5 text-brand underline underline-offset-2">해제</button></>
          ) : `${g} 기준`}
        </div>
        {pop === 'help' && <HelpPop pivot={pivot} />}
      </div>
      <div className="absolute right-3.5 top-3.5 flex items-center gap-2" data-pop>
        <button type="button" className={toolClass} aria-expanded={pop === 'show'} onClick={() => setPop(pop === 'show' ? null : 'show')}>
          <SlidersHorizontal size={14} aria-hidden="true" />표시
        </button>
        <button type="button" className={toolClass} onClick={() => view?.fit()}>
          <Maximize size={14} aria-hidden="true" />전체 맞춤
        </button>
        {pop === 'show' && <ShowPop model={model} pivot={pivot} opts={opts} setOpts={setOpts} hl={hl} setHl={setHl} />}
      </div>
      <div className="absolute bottom-3 left-3.5 flex flex-wrap gap-x-3.5 gap-y-1 rounded-md bg-n-0/90 px-2 py-0.5 text-meta text-n-600 max-[1100px]:hidden">
        {opts.agg && <KeyLine style={{ borderTop: '3px solid rgba(52,72,102,.55)' }}>{g} 사이 관계(굵기 = 건수)</KeyLine>}
        <KeyLine style={{ borderTop: '1.5px solid rgba(19,23,28,.35)' }}>{g} → 자료</KeyLine>
        {quiet && opts.secondary && <KeyLine style={{ borderTop: '1.5px solid rgba(19,23,28,.2)' }}>함께 등록</KeyLine>}
        {quiet && showModel && <KeyLine style={{ borderTop: `1.5px dashed ${K.accent}` }}>형상만 같음</KeyLine>}
        {showModel && has('dup') && <KeyLine style={{ borderTop: `2px solid ${K.warn}` }}>똑같은 BDF</KeyLine>}
        {quiet && showDoc && has('uses') && <KeyLine style={{ borderTop: `1.5px solid ${K.doc}` }}>사용한 모델</KeyLine>}
        {showDoc && has('rrev') && <KeyLine style={{ borderTop: `2.5px solid ${K.doc}` }}>보고서 다른 판</KeyLine>}
        {quiet && showDoc && has('text') && <KeyLine style={{ borderTop: `1.5px dotted ${K.doc}` }}>본문 비슷함</KeyLine>}
        {showDoc && model.entries.some(isReportOnly) && (
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2 w-2 rounded-full border-[1.5px] border-n-500" />보고서만 있는 자료</span>
        )}
        <span className="text-n-500">{quiet ? '선에 올리면 설명' : '점을 고르면 약한 관계와 나머지 선이 보입니다'}</span>
      </div>
      <div ref={tipRef} hidden role="tooltip"
           className="pointer-events-none absolute z-10 max-w-[320px] whitespace-pre-line rounded-sm bg-n-900 px-2.5 py-1.5 text-meta text-n-0 shadow-md" />
    </div>
  );
}

function KeyLine({ style, children }) {
  return <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block w-[18px]" style={style} />{children}</span>;
}

const popClass = 'absolute top-9 z-20 flex max-h-[calc(100vh-220px)] w-[288px] flex-col gap-3.5 overflow-y-auto rounded-lg border border-n-200 bg-n-0 p-3.5 shadow-md animate-pop';

function HelpPop({ pivot }) {
  const g = GROUP[pivot];
  return (
    <div className={`${popClass} left-0`} role="dialog" aria-label="읽는 법">
      <div className="flex flex-col gap-2 text-ui leading-relaxed text-n-700">
        <h3 className="text-meta font-semibold text-n-600">읽는 법</h3>
        <p>큰 남색 점이 {g}, 둘레의 작은 점이 거기 붙은 자료입니다.</p>
        <p><b className="font-semibold text-n-900">굵은 곡선</b> — {g} 사이 관계. 굵을수록 아래 연결이 많고, 관계가 많은 {g}끼리 가까이 놓입니다.</p>
        <p><b className="font-semibold text-n-900">함께 등록</b> — 자료 하나에 {g}{JOSA[pivot]} 둘 이상 달림(자매선 공통 검토 등).</p>
        <p><b className="font-semibold text-n-900">형상만 같음</b>(남색 점선) — 서로 다른 자료의 BDF가 형상은 같고 물성·재료·하중 중 일부가 다름. 한쪽 모델을 가져다 다시 푼 경우입니다.</p>
        <p><b className="font-semibold text-n-900">똑같은 BDF</b>(주황 실선) — 네 가지가 모두 같음. 업로드에서 막히는 경우라 강제 업로드 같은 예외에만 나타납니다.</p>
        <p><b className="font-semibold text-n-900">문서 관계</b>(청록) — 보고서로 이은 선입니다. 모델이 없는 자료(속이 빈 점)도 이어집니다.</p>
        <p className="pl-3">실선 <b className="font-semibold text-n-900">사용한 모델</b> — 보고서에 ‘사용한 모델’로 연결한 BDF가 다른 자료에 있음.
          굵은 실선 <b className="font-semibold text-n-900">보고서 다른 판</b> — 같은 보고서의 개정본이 다른 자료에 있음(이름 계열·본문 겹침).
          점선 <b className="font-semibold text-n-900">본문 비슷함</b> — 본문 의미가 가까운 보고서(추천 수준).</p>
        <p>모델 판(R0·R1…)과 보고서 판(Rev.A·Rev.B…)은 자료 안 파일끼리의 순서라 선으로 그리지 않고, 자료를 고르면 오른쪽에 나옵니다.</p>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-meta font-semibold text-n-600">조작</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ui text-n-700">
          {[['끌기', '빈 곳은 지도 이동, 점은 점 옮기기'], ['Shift + 놓기', '그 자리에 점 고정, 더블클릭으로 해제'],
            ['휠', '확대(최대 12배). 2배부터 자료 번호, 4.5배부터 자료 제목'], ['선에 올리기', '무엇으로 이어졌는지 문장으로 설명'],
            ['← →', '고른 점의 이웃을 차례로 고르기'], ['Esc', '선택·강조 풀기']].map(([k, v]) => (
            <div key={k} className="contents"><dt className="h-fit whitespace-nowrap rounded-xs bg-n-100 px-1.5 text-meta text-n-800">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-ui text-n-800">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand" />{children}
    </label>
  );
}

function ShowPop({ model, pivot, opts, setOpts, hl, setHl }) {
  const others = GROUP_KEYS.filter((g) => g !== pivot);
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  return (
    <div className={`${popClass} right-0`} role="dialog" aria-label="표시">
      <div className="flex flex-col gap-2">
        <h3 className="text-meta font-semibold text-n-600">선</h3>
        <Check checked={opts.agg} onChange={(v) => set({ agg: v })}>{GROUP[pivot]} 사이 관계 곡선</Check>
        <Check checked={opts.secondary} onChange={(v) => set({ secondary: v })}>함께 등록된 자료의 둘째 {GROUP[pivot]} 선</Check>
        <Check checked={opts.alwaysPairs} onChange={(v) => set({ alwaysPairs: v })}>형상만 같음·사용한 모델·본문 비슷함 선 늘 보기</Check>
        <span className="pt-1 text-meta text-n-500">태그로 잇기(흐린 고리 점)</span>
        {others.map((g) => (
          <Check key={g} checked={opts.rings.includes(g)}
                 onChange={(v) => set({ rings: v ? [...opts.rings, g] : opts.rings.filter((x) => x !== g) })}>{GROUP[g]}</Check>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-meta font-semibold text-n-600">강조해서 보기</h3>
        <p className="text-meta text-n-500">하나를 누르면 그 값이 붙은 자료만 밝아집니다.</p>
        {others.map((g) => {
          const hs = [...model.hubs.values()].filter((h) => h.g === g && h.cnt > 0).sort((a, b) => b.cnt - a.cnt).slice(0, 40);
          if (!hs.length) return null;
          return (
            <div key={g} className="flex flex-col gap-1.5">
              <span className="text-meta text-n-500">{GROUP[g]}</span>
              <div className="flex flex-wrap gap-1">
                {hs.map((h) => (
                  <button key={h.id} type="button" aria-pressed={hl === h.id} onClick={() => setHl(hl === h.id ? null : h.id)}
                          className={`inline-flex items-center gap-1 border px-2 text-meta transition-colors duration-150
                            ${g === 'hull' ? 'rounded-sm font-mono' : 'rounded-full'}
                            ${hl === h.id ? 'border-brand bg-brand-subtle font-semibold text-brand' : 'border-n-200 bg-n-0 text-n-800 hover:border-n-300 hover:bg-n-50'}`}>
                    {h.label}<span className="font-sans font-normal tabular-nums text-n-500">{h.cnt}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 오른쪽 상세 열 ──
function EntryRow({ e, note, color, onGo }) {
  return (
    <li>
      <button type="button" onClick={() => onGo(e.id)}
              className="grid w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 border-b border-n-100 px-1 py-1.5 text-left hover:bg-n-50">
        <span aria-hidden="true" className="row-span-2 h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="truncate text-ui text-n-900">{e.label}</span>
        <span className="truncate font-mono text-meta text-n-500">{e.eid} · {note ?? e.raw.confirmed_at ?? ''}</span>
      </button>
    </li>
  );
}

function HubChip({ h, onGo }) {
  const hull = h.g === 'hull';
  return (
    <button type="button" onClick={() => onGo(h.id)}
            className={`inline-flex items-center border px-2 text-meta transition-colors duration-150 ${hull
              ? 'rounded-sm border-brand bg-brand font-mono text-n-0 hover:bg-brand-hover'
              : 'rounded-full border-n-200 bg-n-0 text-n-800 hover:border-n-300 hover:bg-n-50'}`}>{h.label}</button>
  );
}

function DetailColumn({ model, pivot, sel, onGo, layer }) {
  const n = sel && model.byId.get(sel);
  const dot = (e) => model.colors.ship.colorOf(e);
  const aggs = useMemo(() => aggregate(model, pivot, layer), [model, pivot, layer]);
  let body;
  if (!n) {
    // '○○ 없음' 은 늘 맨 아래(건수가 많아도)
    const hs = pivotHubs(model, pivot).sort((a, b) => (a.none ? 1 : 0) - (b.none ? 1 : 0) || b.cnt - a.cnt);
    body = (
      <>
        <section className="flex flex-col gap-2">
          <SecTitle>{GROUP[pivot]}별 자료</SecTitle>
          <ul>
            {hs.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onGo(h.id)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-n-100 px-1 py-1.5 text-left hover:bg-n-50">
                  <span className="truncate">
                    <span className={`font-semibold ${h.none ? 'text-n-600' : 'text-brand'} ${h.g === 'hull' && !h.none ? 'font-mono font-medium' : ''}`}>{h.label}</span>
                    {h.ship && <span className="ml-1.5 text-n-500">{h.ship}</span>}
                  </span>
                  <span className="tabular-nums text-n-600">{h.cnt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-meta text-n-500">점을 누르면 그 {GROUP[pivot]}의 자료 구성과 이어진 {GROUP[pivot]}{JOSA[pivot]} 여기에 나옵니다.</p>
      </>
    );
  } else if (n.hub) {
    const ents = membersOf(model, n).sort((a, b) => (b.raw.confirmed_at || '').localeCompare(a.raw.confirmed_at || ''));
    const pal = model.colors.ship;
    const mix = new Map();
    for (const e of ents) { const c = pal.colorOf(e); const key = e.ship || '없음'; const v = mix.get(key) || [c, 0]; v[1] += 1; mix.set(key, v); }
    const mixArr = [...mix.entries()].sort((a, b) => b[1][1] - a[1][1]);
    const rel = n.g === pivot ? aggs.filter((a) => a.a === n || a.b === n).map((a) => [a.a === n ? a.b : a.a, a]).sort((x, y) => y[1].c - x[1].c) : [];
    const others = GROUP_KEYS.filter((g) => g !== n.g).map((g) => {
      const m = new Map(); ents.forEach((e) => e.of[g].forEach((h) => m.set(h, (m.get(h) || 0) + 1)));
      return [g, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)];
    }).filter(([, arr]) => arr.length);
    body = (
      <>
        <section className="flex flex-col gap-1">
          <span className="text-meta text-n-600">{n.none ? '기준 없음' : GROUP[n.g]}</span>
          <div className={n.g === 'hull' && !n.none ? 'font-mono text-[20px] font-medium text-brand' : 'text-[17px] font-semibold text-n-900'}>{n.label}</div>
          <div className="text-ui text-n-600">{n.ship ? `${n.ship} · ` : ''}자료 {ents.length}건</div>
          {n.g === 'hull' && !n.none && <Link to={`/h/${encodeURIComponent(n.id.slice('hull:'.length))}`} className="text-ui text-brand underline underline-offset-2">호선 화면 열기</Link>}
        </section>
        <section className="flex flex-col gap-2">
          <SecTitle>선종 구성</SecTitle>
          <div className="flex h-2 gap-px overflow-hidden rounded-full bg-n-150">
            {mixArr.map(([k, [c, v]]) => <i key={k} className="block h-full" style={{ width: `${(v / ents.length) * 100}%`, background: c }} />)}
          </div>
          <Legend items={mixArr.map(([k, [c, v]]) => ({ label: `${k} ${v}`, color: c }))} />
        </section>
        {rel.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>이어진 {GROUP[n.g]}</SecTitle>
            <ul>
              {rel.map(([o, a]) => (
                <li key={o.id}>
                  <button type="button" onClick={() => onGo(o.id)}
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-n-100 px-1 py-1.5 text-left hover:bg-n-50">
                    <span className="truncate"><span className={`text-brand ${o.g === 'hull' && !o.none ? 'font-mono font-medium' : 'font-semibold'}`}>{o.label}</span>
                      <span className="ml-1.5 text-meta text-n-500">{aggText(a)}</span></span>
                    <span className="tabular-nums text-n-600">{a.c}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {others.map(([g, arr]) => {
          const max = arr[0][1];
          return (
            <section key={g} className="flex flex-col gap-2">
              <SecTitle>함께 붙은 {GROUP[g]}</SecTitle>
              <div className="flex flex-col gap-1.5">
                {arr.map(([h, c]) => (
                  <div key={h.id} className="grid grid-cols-[84px_minmax(0,1fr)_24px] items-center gap-2 text-meta">
                    <span className="truncate text-n-700">{h.label}</span>
                    <em className="block h-1.5 rounded-full bg-brand-ring" style={{ width: `${(c / max) * 100}%` }} />
                    <span className="text-right tabular-nums text-n-600">{c}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        <section className="flex flex-col gap-2">
          <SecTitle>최근 자료</SecTitle>
          <ul>{ents.slice(0, 8).map((e) => <EntryRow key={e.id} e={e} color={dot(e)} onGo={onGo} />)}</ul>
          {ents.length > 8 && <p className="text-meta text-n-500">외 {ents.length - 8}건은 지도에서 점을 눌러 보거나 검색 화면에서 찾아 주세요.</p>}
        </section>
      </>
    );
  } else {
    const mine = (t) => pairsOf(model, layer).filter((p) => p.type === t && (p.a === n || p.b === n)).map((p) => [p.a === n ? p.b : p.a, p]);
    const geom = mine('geom'), dup = mine('dup'), rrev = mine('rrev'), text = mine('text');
    const uses = mine('uses'), usesOut = uses.filter(([, p]) => p.from === n), usesIn = uses.filter(([, p]) => p.from !== n);
    const where = (o) => primaryOf(model, o, pivot).label;
    body = (
      <>
        <section className="flex flex-col gap-1">
          <span className="text-meta text-n-600">{n.ship || '자료'}</span>
          <div className="text-[17px] font-semibold leading-snug text-n-900 [text-wrap:balance]">{n.label}</div>
          <div className="font-mono text-meta text-n-500">{n.eid}</div>
        </section>
        <dl className="grid grid-cols-[64px_1fr] gap-x-2.5 gap-y-1.5 text-ui">
          <dt className="text-n-500">파일</dt>
          <dd>{n.raw.files}개{(n.raw.models > 0 || n.raw.reports > 0) && (
            <span className="text-n-500"> · 모델 {n.raw.models || 0} · 보고서 {n.raw.reports || 0}</span>
          )}</dd>
          <dt className="text-n-500">확정</dt><dd>{n.raw.confirmed_at || '—'}</dd>
        </dl>
        {GROUP_KEYS.map((g) => (n.of[g].length > 0 && (
          <section key={g} className="flex flex-col gap-2">
            <SecTitle>{GROUP[g]}</SecTitle>
            <div className="flex flex-wrap gap-1">{n.of[g].map((h) => <HubChip key={h.id} h={h} onGo={onGo} />)}</div>
          </section>
        )))}
        {dup.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-meta font-semibold text-wait">똑같은 BDF가 있는 자료</h2>
            <p className="rounded-md bg-wait-bg px-2 py-1.5 text-meta text-wait">같은 BDF는 업로드에서 막히는데 강제 업로드나 이전 자료로 들어왔습니다. 하나로 정리할지 확인해 주세요.</p>
            <ul>{dup.map(([o, p]) => <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo} note={`${primaryOf(model, o, pivot).label} · ${p.files?.join(' ↔ ') || ''}`} />)}</ul>
          </section>
        )}
        {geom.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>형상이 같은 자료</SecTitle>
            <p className="text-meta text-n-500">한쪽 모델을 가져다 물성·하중을 바꿔 다시 푼 자료입니다.</p>
            <ul>{geom.map(([o, p]) => <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo} note={`${primaryOf(model, o, pivot).label} · ${diffShort(p.differs)}`} />)}</ul>
          </section>
        )}
        {rrev.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>같은 보고서의 다른 판이 있는 자료</SecTitle>
            <p className="text-meta text-n-500">같은 일의 개정본이면 한 자료로 모아 보고서 판으로 두는 것이 좋습니다.</p>
            <ul>{rrev.map(([o, p]) => (
              <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo}
                        note={`${where(o)} · ${p.score != null ? `본문 ${Math.round(p.score * 100)}% 겹침` : '이름 계열 같음'}`} />
            ))}</ul>
          </section>
        )}
        {usesOut.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>이 자료 보고서가 사용한 모델</SecTitle>
            <ul>{usesOut.map(([o, p]) => <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo} note={`${where(o)} · ${p.files?.[1] || ''}`} />)}</ul>
          </section>
        )}
        {usesIn.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>이 자료의 모델을 사용한 보고서</SecTitle>
            <ul>{usesIn.map(([o, p]) => <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo} note={`${where(o)} · ${p.files?.[0] || ''}`} />)}</ul>
          </section>
        )}
        {text.length > 0 && (
          <section className="flex flex-col gap-2">
            <SecTitle>본문이 비슷한 보고서가 있는 자료</SecTitle>
            <p className="text-meta text-n-500">의미가 가까운 보고서를 추천합니다. 원문으로 확인해 주세요.</p>
            <ul>{text.map(([o, p]) => <EntryRow key={o.id} e={o} color={dot(o)} onGo={onGo} note={`${where(o)} · 유사도 ${p.score?.toFixed(2) ?? '—'}`} />)}</ul>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <SecTitle>모델 판</SecTitle>
          {n.raw.revisions?.length ? n.raw.revisions.map((s) => (
            <div key={s.name} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1 font-mono text-meta">
                {Array.from({ length: s.count }, (_, i) => (
                  <span key={i} className="contents">
                    {i > 0 && <span aria-hidden="true" className="text-n-400">→</span>}
                    <span className={`rounded-xs border px-1.5 ${i === s.count - 1 ? 'border-brand bg-brand text-n-0' : 'border-n-250 text-n-600'}`}>R{i}</span>
                  </span>
                ))}
              </div>
              <span className="truncate text-meta text-n-500" title={s.name}>최신판 {s.name}</span>
            </div>
          )) : <p className="text-meta text-n-500">판이 둘 이상인 모델 계열이 없습니다.</p>}
        </section>
        <section className="flex flex-col gap-2">
          <SecTitle>보고서 판</SecTitle>
          {n.raw.report_revisions?.length ? n.raw.report_revisions.map((s) => (
            <div key={s.items[0].file_id} className="flex flex-col gap-1">
              <ol className="flex flex-col">
                {s.items.map((it, i) => (
                  <li key={it.file_id} className="flex flex-col gap-0.5 border-b border-n-100 py-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`shrink-0 rounded-xs border px-1.5 font-mono text-meta ${it.is_latest ? 'border-brand bg-brand text-n-0' : 'border-n-250 text-n-600'}`}>{it.display}</span>
                      <span className="truncate text-meta text-n-800" title={it.name}>{it.name}</span>
                    </span>
                    {i > 0 && (
                      <span className="pl-1 text-meta text-n-500">↳ 앞 판보다 {stepText(s.steps?.[i - 1]) || '본문 색인 전'}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )) : <p className="text-meta text-n-500">판이 둘 이상인 보고서 계열이 없습니다.</p>}
          <p className="text-meta text-n-500">판은 자료 안 파일끼리의 순서라 지도에 선으로 그리지 않습니다.</p>
        </section>
        <Link to={`/e/${n.eid}`} className="inline-flex h-9 items-center justify-center rounded-md bg-brand px-3 text-ui font-semibold text-n-0 hover:bg-brand-hover">자료 열기</Link>
      </>
    );
  }
  return (
    <aside aria-label="상세" aria-live="polite"
           className="flex min-w-0 flex-col gap-5 overflow-y-auto border-l border-n-200 px-4 py-5 max-[1100px]:order-3 max-[1100px]:border-l-0 max-[1100px]:border-t">
      {body}
    </aside>
  );
}
