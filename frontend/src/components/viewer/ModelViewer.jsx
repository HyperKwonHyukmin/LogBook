import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { CircleAlert, Expand, Scan } from 'lucide-react';
import { apiArrayBuffer } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { parseLbm } from '../../lib/lbm.js';
import { buildGeometry } from '../../lib/modelGeometry.js';
import { elementInfo, sectionLabel } from '../../lib/elementInfo.js';
import { MARKER_COLORS } from '../../lib/pidPalette.js';
import { VIEW_PRESETS } from '../../lib/viewFrame.js';
import Button, { buttonClass } from '../ui/Button.jsx';
import { Segmented } from '../ui/Tabs.jsx';
import { ViewerEngineContext } from './ViewerEngineContext.js';

/** 요소가 이보다 많으면 경계선을 기본으로 끈다(설계 §7.3 대형 모델). */
const EDGE_LIMIT = 200_000;
/** 누른 자리와 뗀 자리가 이 안이면 클릭(드래그 회전이 아님). */
const CLICK_SLOP = 4;
const MARKER_KEYS = [['rbe2', 'RBE2'], ['rbe3', 'RBE3'], ['conm2', 'CONM2'], ['spc', 'SPC']];
const VIEW_ITEMS = Object.entries(VIEW_PRESETS).map(([id, p]) => ({ id, label: p.label }));
const KEY_VIEWS = Object.fromEntries(Object.entries(VIEW_PRESETS).map(([id, p]) => [p.key, id]));
const num = (n) => Number(n).toLocaleString('ko-KR');

/** RBE 개수 — 머리말 counts 가 기준이고, 없으면 rigid_lines 의 서로 다른 EID 로 센다. */
function rigidCount(lbm, kind, card) {
  const c = lbm.header.counts?.[card];
  if (c != null) return c;
  const lines = lbm.blocks.rigid_lines || [];
  const kinds = lbm.blocks.rigid_kinds || [];
  const eids = new Set();
  for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === kind) eids.add(lines[i * 3]);
  return eids.size;
}

/** 도구줄 켜고 끄기 단추 — 켜짐은 세그먼트 선택과 같은 흰 바탕 + 그림자(파란 채움 없음). */
function ToggleChip({ pressed, onClick, children, title, swatch, disabled = false }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} title={title} disabled={disabled}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-meta font-medium
              transition-[background-color,border-color,color,box-shadow] duration-120 ease-out
              disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-n-500 disabled:shadow-none
              ${pressed ? 'border-n-250 bg-n-0 text-n-800 shadow-xs hover:border-n-300'
                : 'border-transparent text-n-500 hover:bg-n-100 hover:text-n-800 active:bg-n-150'}`}>
      {swatch && (
        <span aria-hidden="true" className="h-2 w-2 rounded-full border"
              style={{ borderColor: swatch, background: pressed ? swatch : 'transparent' }} />
      )}
      {children}
    </button>
  );
}

function InfoRows({ info }) {
  const rows = [
    ['EID', info.eid, true],
    ['카드', info.card, true],
    ['PID', info.pid, true],
    ['단면', info.section || '—', true],
    info.thickness != null && ['두께', info.thickness, true],
    ['재료', info.material || '—', true],
    ['절점', info.nodes.join(', '), true],
    info.length != null && ['길이', info.length.toLocaleString('ko-KR', { maximumFractionDigits: 1 }), true],
  ].filter(Boolean);
  return (
    <dl className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 gap-y-1 text-meta">
      {rows.map(([k, v, mono]) => (
        <div key={k} className="contents">
          <dt className="text-n-500">{k}</dt>
          <dd className={`min-w-0 break-words text-n-900 ${mono ? 'font-mono' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * BDF 3D 뷰어 화면(설계 §7.3·§7.4) — 밝은 도구줄 + 어두운 캔버스 + 오른쪽 240px 패널(PID 목록·선택 요소).
 * three 는 ViewerEngineContext 의 공장으로만 만난다(테스트는 가짜 엔진).
 */
export default function ModelViewer({ fileId, fullscreenHref, className = '' }) {
  const factory = useContext(ViewerEngineContext);
  const inRouter = useInRouterContext();
  const mountRef = useRef(null);
  const surfaceRef = useRef(null);
  const engineRef = useRef(null);
  const downRef = useRef(null);
  const infoId = useId();
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [model, setModel] = useState(null);       // { lbm, geometry }
  const [hidden, setHidden] = useState(() => new Set());
  const [edges, setEdges] = useState(true);
  const [markers, setMarkers] = useState({ rbe2: true, rbe3: true, conm2: true, spc: true });
  const [view, setView] = useState('iso');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', error: '' });
    setModel(null); setPicked(null); setHidden(new Set()); setView('iso');
    setMarkers({ rbe2: true, rbe3: true, conm2: true, spc: true });
    // 엔진(three 묶음 불러오기 + WebGL 준비)은 모델을 받는 동안 함께 만든다.
    const enginePromise = new Promise((resolve) => { resolve(factory(mountRef.current)); });
    enginePromise.catch(() => {});
    let adopted = false;
    let released = false;
    const releaseEngine = () => {
      if (released) return;
      released = true;
      enginePromise.then((e) => e?.dispose(), () => {});
    };
    (async () => {
      try {
        let lbm;
        let geometry;
        try {
          lbm = parseLbm(await apiArrayBuffer(`/files/${fileId}/model.lbm`));
          geometry = buildGeometry(lbm);
        } catch (err) {
          releaseEngine();
          if (alive) setState({ status: 'error', error: errorText(err, '모델을 불러오지 못했습니다.') });
          return;
        }
        let engine;
        try { engine = await enginePromise; } catch {
          if (alive) setState({ status: 'error', error: '이 브라우저에서 3D 를 표시할 수 없습니다.' });
          return;
        }
        // 늦게 온 옛 응답(파일이 바뀜·언마운트)은 버린다. 엔진은 정리 함수가 해제한다.
        if (!alive) return;
        adopted = true;
        released = true;
        engineRef.current = engine;
        const withEdges = geometry.total <= EDGE_LIMIT;
        engine.setModel(geometry, { edges: withEdges });
        setEdges(withEdges);
        setModel({ lbm, geometry });
        setState({ status: 'ready', error: '' });
      } catch (err) {
        if (alive) setState({ status: 'error', error: errorText(err, '모델을 불러오지 못했습니다.') });
      }
    })();
    return () => {
      alive = false;
      if (adopted) {
        engineRef.current?.dispose();
        engineRef.current = null;
      } else {
        releaseEngine();
      }
    };
  }, [fileId, factory]);

  const groups = model?.geometry.groups || [];
  const markerCounts = useMemo(() => (model ? {
    rbe2: rigidCount(model.lbm, 0, 'RBE2'),
    rbe3: rigidCount(model.lbm, 1, 'RBE3'),
    conm2: model.geometry.masses.length,
    // 같은 절점이 여러 SPC 에 걸려도 한 번만 센다.
    spc: new Set(model.geometry.spcs).size,
  } : {}), [model]);
  const info = useMemo(() => (model && picked != null ? elementInfo(model.lbm, model.geometry, picked) : null),
    [model, picked]);

  const select = useCallback((index) => {
    setPicked(index);
    engineRef.current?.highlight(index);
  }, []);
  const toggleGroup = (pid) => {
    const next = new Set(hidden);
    const show = next.has(pid);
    if (show) next.delete(pid); else next.add(pid);
    setHidden(next);
    engineRef.current?.setGroupVisible(pid, show);
    // 보이지 않는 요소를 선택한 채 두지 않는다.
    if (!show && info?.pid === pid) select(null);
  };
  const setAll = (visible) => {
    for (const g of groups) engineRef.current?.setGroupVisible(g.pid, visible);
    setHidden(visible ? new Set() : new Set(groups.map((g) => g.pid)));
    if (!visible && picked != null) select(null);
  };
  const changeView = (id) => {
    setView(id);
    engineRef.current?.setView(id);
  };
  const fit = () => engineRef.current?.fit();
  const toggleEdges = () => {
    const next = !edges;
    setEdges(next);
    engineRef.current?.setEdges(next);
  };
  const toggleMarker = (key) => {
    const next = { ...markers, [key]: !markers[key] };
    setMarkers(next);
    engineRef.current?.setMarkers(next);
  };

  function onPointerDown(e) {
    if (e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY };
    // 캔버스는 포커스를 받지 않으므로 둘레 영역에 포커스를 줘 단축키가 바로 듣게 한다.
    surfaceRef.current?.focus({ preventScroll: true });
  }
  function onPointerUp(e) {
    const down = downRef.current;
    downRef.current = null;
    if (!down || e.button !== 0 || state.status !== 'ready') return;
    if (Math.abs(e.clientX - down.x) > CLICK_SLOP || Math.abs(e.clientY - down.y) > CLICK_SLOP) return;
    const index = engineRef.current?.pickAt(e.clientX, e.clientY) ?? null;
    select(index);
  }
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || state.status !== 'ready') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'f') fit();
    else if (KEY_VIEWS[k]) changeView(KEY_VIEWS[k]);
    else if (k === 'e') toggleEdges();
    else if (k === 'Escape') select(null);
    else return;
    e.preventDefault();
  }

  const ready = state.status === 'ready';
  const fullscreenClass = buttonClass('ghost', 'sm', 'ml-auto');
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden bg-n-0 ${className}`}>
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-n-200 bg-n-50 px-2 py-1.5">
        <Segmented label="시점" items={VIEW_ITEMS} value={view} onChange={changeView} disabled={!ready} />
        <Button variant="ghost" size="sm" onClick={fit} disabled={!ready} title="화면 맞춤 (F)" aria-keyshortcuts="F">
          <Scan size={14} aria-hidden="true" />화면 맞춤
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-n-200" />
        <ToggleChip pressed={edges} onClick={toggleEdges} title="요소 경계선 (E)" disabled={!ready}>경계선</ToggleChip>
        {MARKER_KEYS.filter(([key]) => markerCounts[key] > 0).map(([key, label]) => (
          <ToggleChip key={key} pressed={markers[key]} onClick={() => toggleMarker(key)} swatch={MARKER_COLORS[key]} disabled={!ready}
                      title={`${label} 표시`}>
            {label} <span className="font-mono font-normal text-n-500">{num(markerCounts[key])}</span>
          </ToggleChip>
        ))}
        {fullscreenHref && (inRouter
          ? <Link to={fullscreenHref} className={fullscreenClass}><Expand size={14} aria-hidden="true" />전체 화면</Link>
          : <a href={fullscreenHref} className={fullscreenClass}><Expand size={14} aria-hidden="true" />전체 화면</a>)}
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={surfaceRef} data-testid="viewer-canvas" tabIndex={0} role="application"
             aria-label="3D 모델. F 화면 맞춤, I·1·2·3 시점, E 경계선, Esc 선택 해제"
             onPointerDown={onPointerDown} onPointerUp={onPointerUp} onKeyDown={onKeyDown}
             className="relative min-w-0 flex-1 bg-viewer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring">
          {/* 엔진이 캔버스를 붙이는 자리 — React 자식을 두지 않는다. */}
          <div ref={mountRef} className="absolute inset-0" />
          {state.status === 'loading' && (
            <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <span className="text-meta text-n-300">모델 여는 중…</span>
              <div aria-hidden="true" className="h-0.5 w-40 overflow-hidden rounded-full bg-n-0/10">
                <div className="progress-indeterminate h-full w-[30%] animate-progress bg-link-on-dark" />
              </div>
            </div>
          )}
          {state.status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p role="alert" className="flex max-w-[400px] items-start gap-2 text-ui text-n-150">
                <CircleAlert size={14} className="mt-[3px] shrink-0 text-n-300" aria-hidden="true" />
                {state.error}
              </p>
            </div>
          )}
        </div>

        <aside className="flex w-60 shrink-0 flex-col border-l border-n-200 bg-n-0">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-n-200 px-3">
              <h3 className="text-ui font-semibold text-n-700">PID</h3>
              {ready && <span className="font-mono text-meta text-n-500">{num(groups.length)}</span>}
              <div className="ml-auto flex items-center">
                <Button variant="ghost" size="sm" className="px-1.5" disabled={!ready || hidden.size === 0} onClick={() => setAll(true)}>
                  모두 보이기
                </Button>
                <Button variant="ghost" size="sm" className="px-1.5" disabled={!ready || hidden.size === groups.length} onClick={() => setAll(false)}>
                  모두 숨기기
                </Button>
              </div>
            </div>
            {ready && (
              <ul role="list" aria-label="PID" className="min-h-0 flex-1 overflow-y-auto py-1">
                {groups.map((g) => {
                  const label = sectionLabel(model.lbm.header.properties?.[g.pid]);
                  const on = !hidden.has(g.pid);
                  return (
                    <li key={g.pid}>
                      <label title={label || undefined}
                             className="flex h-8 cursor-pointer items-center gap-2 px-3 text-meta hover:bg-n-25">
                        <input type="checkbox" checked={on} onChange={() => toggleGroup(g.pid)} aria-label={`PID ${g.pid} 표시`}
                               className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand" />
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-xs"
                              style={{ background: g.color, opacity: on ? 1 : 0.35 }} />
                        <span className={`w-9 shrink-0 truncate font-mono ${on ? 'text-n-900' : 'text-n-500'}`}>{g.pid}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-n-600" title={label}>{label}</span>
                        <span className="shrink-0 font-mono text-n-500">{num(g.count)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <section aria-labelledby={infoId} aria-live="polite" className="shrink-0 border-t border-n-200 px-3 py-2.5">
            <h3 id={infoId} className="mb-1.5 text-ui font-semibold text-n-700">선택 요소</h3>
            {info ? <InfoRows info={info} /> : <p className="text-meta text-n-500">요소를 누르면 정보가 보입니다</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
