import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Columns2, LogOut, Plus, RotateCcw } from 'lucide-react';
import ComparePane from '../components/compare/ComparePane.jsx';
import ComparePanel from '../components/compare/ComparePanel.jsx';
import CompareToolbar from '../components/compare/CompareToolbar.jsx';
import { useCompareBasket } from '../components/compare/CompareBasket.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { BASKET_MAX, compareHref, parseIds } from '../lib/compareBasket.js';
import { compareLayout } from '../lib/compareLayout.js';
import { syncCamera } from '../lib/cameraSync.js';
import { VIEW_KEYS } from '../lib/viewFrame.js';

/** 네 모델의 요소 수 합이 이보다 크면 3D 단면이 느릴 수 있다고 알린다(시작은 늘 '선'). */
export const HEAVY_ELEMENTS = 2_000_000;
const NOT_ELEMENTS = new Set(['GRID', 'CONM2', 'RBE2', 'RBE3']);
const DEFAULT_SHARED = {
  colorMode: 'pid', renderMode: 'line', projection: 'ortho', view: 'iso',
  clip: { on: false, axis: 'x', position: 0.5, flip: false },
  sync: { on: true, mode: 'scale' },
};
const num = (n) => Number(n).toLocaleString('ko-KR');
const raf = (cb) => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(cb) : setTimeout(cb, 16));
const cancelRaf = (h) => (typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame(h) : clearTimeout(h));
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

function useWindowSize() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/**
 * 모델 화면분할 비교(/compare?ids=…, 07). 주소가 원본이고 바구니는 그것을 따라간다.
 * 칸마다 기존 뷰어 엔진 하나(최대 4) + 공통 툴바 + 카메라 동기화 + 아래 비교 패널.
 */
export default function ComparePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const basket = useCompareBasket();
  const idsKey = params.get('ids') || '';
  const ids = useMemo(() => parseIds(idsKey), [idsKey]);
  const win = useWindowSize();

  // 주소로 열면 바구니를 그 목록으로 맞춘다. 주소에 목록이 없으면 바구니 목록으로 연다.
  const { syncIds } = basket;
  useEffect(() => {
    if (ids.length) syncIds(ids);
    else if (basket.ids.length) navigate(compareHref(basket.ids), { replace: true });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [shared, setShared] = useState(DEFAULT_SHARED);
  const [maximized, setMaximized] = useState(null);      // 크게 보는 파일 id
  const [infos, setInfos] = useState({});                // id → { file, summary, hull }
  const [models, setModels] = useState({});              // id → { pidCount, groupCount, properties }
  const [baselineId, setBaselineId] = useState(null);
  const [highlightPid, setHighlightPid] = useState(null);

  /* ── 칸 묶음(hub) — 칸이 자기 뷰어 상태를 맡기고 카메라 바뀜을 알린다. 함수는 고정, 값은 ref ── */
  const panesRef = useRef(new Map());                    // id → useModelViewer 결과(최신)
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const leadRef = useRef(null);                          // 카메라 주인(마지막으로 조작한 칸)
  const quietRef = useRef(false);                        // 초기화 중엔 카메라 바뀜을 동기화로 넘기지 않는다
  const frameRef = useRef(0);
  const hoverRef = useRef(null);

  const engineOf = (id) => panesRef.current.get(id)?.engineRef?.current || null;
  const readyIds = () => [...panesRef.current.entries()].filter(([, v]) => v.ready).map(([id]) => id);

  /** 주인 카메라를 나머지 칸에 옮긴다 — requestAnimationFrame 한 번에 묶는다. */
  const flush = useCallback(() => {
    frameRef.current = 0;
    const { sync } = sharedRef.current;
    if (!sync.on) return;
    const src = engineOf(leadRef.current)?.getCameraState?.();
    if (!src) return;
    for (const id of readyIds()) {
      if (id === leadRef.current) continue;
      const eng = engineOf(id);
      const dst = eng?.getCameraState?.();
      if (dst) eng.setCameraState(syncCamera(src, dst, sync.mode));
    }
  }, []);
  const schedule = useCallback(() => { if (!frameRef.current) frameRef.current = raf(flush); }, [flush]);
  useEffect(() => () => { if (frameRef.current) cancelRaf(frameRef.current); }, []);

  const hub = useMemo(() => ({
    register: (id, v) => { panesRef.current.set(id, v); },
    unregister: (id) => {
      panesRef.current.delete(id);
      if (leadRef.current === id) leadRef.current = null;
    },
    onCamera: (id) => {
      if (quietRef.current || !sharedRef.current.sync.on) return;
      leadRef.current = id;
      schedule();
    },
    /** 새로 준비된 칸 — 동기화 중이면 주인 카메라를 받고, 아니면 지금 공통 시점으로. */
    onReady: (id) => {
      const s = sharedRef.current;
      if (s.sync.on) {
        const lead = leadRef.current;
        if (lead != null && lead !== id && panesRef.current.get(lead)?.ready) schedule();
        else leadRef.current = id;
      } else if (s.view !== 'iso') {
        panesRef.current.get(id)?.changeView(s.view);
      }
    },
    onModel: (id, m) => setModels((cur) => ({ ...cur, [id]: m })),
  }), [schedule]);

  const onInfo = useCallback((id, info) => setInfos((cur) => ({ ...cur, [id]: info })), []);
  const { patch } = basket;
  // 알게 된 이름·호선을 바구니 칩에도 채운다.
  useEffect(() => {
    for (const id of ids) {
      const i = infos[id];
      if (i?.file) patch(id, { name: i.file.name, hull: i.hull });
    }
  }, [infos, ids, patch]);

  /* ── 공통 툴바 ── */
  const changeShared = (p) => {
    setShared((cur) => ({ ...cur, ...p }));
    // 동기화를 켜거나 기준을 바꾸면 지금 주인(없으면 첫 칸) 카메라를 곧바로 나눠 준다.
    if (p.sync && p.sync.on) {
      sharedRef.current = { ...sharedRef.current, ...p };
      const ready = readyIds();
      if (!ready.includes(leadRef.current)) leadRef.current = ready[0] ?? null;
      schedule();
    }
  };
  /** 명령을 받을 칸 — 마우스가 올라간 칸, 없으면 동기화 중엔 주인 칸(나머지가 따라온다), 아니면 전부. */
  const targets = () => {
    const ready = readyIds();
    const hover = hoverRef.current;
    if (hover != null && ready.includes(hover)) return [hover];
    if (shared.sync.on) {
      const lead = ready.includes(leadRef.current) ? leadRef.current : ready[0];
      return lead != null ? [lead] : [];
    }
    return ready;
  };
  const applyView = (view) => {
    setShared((cur) => ({ ...cur, view }));
    for (const id of targets()) panesRef.current.get(id)?.changeView(view);
  };
  const fitAll = () => { for (const id of targets()) panesRef.current.get(id)?.fit(); };

  /**
   * 초기화 — 처음 비교를 연 장면으로. 공통 툴바·크게 보기·PID 강조를 기본값으로 되돌리고,
   * 화면이 다시 그려진 뒤(가려졌던 칸도 크기가 잡힌 뒤) 칸마다 선택·숨김·표시를 풀고 등각으로 맞춘다.
   * 패널 탭·높이·기준 모델은 그대로 둔다.
   */
  const [resetTick, setResetTick] = useState(0);
  const resetAll = () => {
    setShared(DEFAULT_SHARED);
    sharedRef.current = DEFAULT_SHARED;
    setMaximized(null);
    setHighlightPid(null);
    setResetTick((n) => n + 1);
  };
  useEffect(() => {
    if (!resetTick) return;
    // 칸마다 제 모델 전체를 등각으로 맞춘다 — 그동안의 카메라 바뀜은 동기화로 옮기지 않는다.
    quietRef.current = true;
    try {
      for (const v of panesRef.current.values()) if (v.ready) v.resetScene();
    } finally {
      quietRef.current = false;
    }
    if (frameRef.current) { cancelRaf(frameRef.current); frameRef.current = 0; }
    leadRef.current = null;
  }, [resetTick]);

  /** 끝내기 — 비교를 열기 전 화면으로. 바구니는 그대로 두어 다시 열 수 있다. 앱 안 이전 화면이 없으면 검색으로. */
  const exit = () => {
    const idx = window.history.state?.idx;
    const canBack = typeof idx === 'number' ? idx > 0 : location.key !== 'default';
    if (canBack) navigate(-1);
    else navigate('/');
  };

  /* ── 칸 동작 ── */
  const remove = (id) => {
    const next = ids.filter((x) => x !== id);
    if (maximized === id) setMaximized(null);
    navigate(compareHref(next), { replace: true });
    if (!next.length) basket.syncIds([]);
  };
  const toggleMax = (id) => setMaximized((cur) => (cur === id ? null : id));
  const onHover = useCallback((id) => { hoverRef.current = id; }, []);

  /* ── 단축키 — 마우스가 올라간 칸(없으면 전체) ── */
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (maximized != null) setMaximized(null);
      else for (const v of panesRef.current.values()) if (v.selection) v.select(null);
    } else if (k === 'f') fitAll();
    else if (VIEW_KEYS[k]) applyView(VIEW_KEYS[k]);
    else if (k === 'p') changeShared({ projection: shared.projection === 'ortho' ? 'persp' : 'ortho' });
    else if (k === 'r') resetAll();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  /* ── 비교 패널 자료 ── */
  const rows = ids.map((id) => {
    const i = infos[id] || {};
    const m = models[id] || {};
    const known = basket.items.find((x) => x.id === id);
    return {
      id, name: i.file?.name || known?.name || '', hull: i.hull || known?.hull || '',
      summary: i.summary?.counts ? i.summary : null,
      pidCount: m.pidCount ?? null, groupCount: m.groupCount ?? null, properties: m.properties ?? null,
    };
  });
  const baseline = Math.max(0, ids.indexOf(baselineId));
  const elementSum = rows.reduce((s, r) => s + Object.entries(r.summary?.counts || {})
    .filter(([c]) => !NOT_ELEMENTS.has(c)).reduce((a, [, n]) => a + n, 0), 0);
  const heavy = elementSum > HEAVY_ELEMENTS;

  const layout = compareLayout(ids.length, { width: win.w, maximized: maximized != null ? ids.indexOf(maximized) : null });
  const hasEmpty = layout.cells.some((c) => c.kind === 'empty');

  if (!ids.length) {
    return (
      <EmptyState icon={Columns2} title="비교할 모델이 없습니다"
                  action={<Link to="/" className={buttonClass('secondary', 'sm')}>검색으로</Link>}>
        검색 결과·자료 미리보기·3D 뷰어에서 '비교에 담기'로 BDF 모델을 최대 {BASKET_MAX}개까지 담은 뒤 비교를 여세요.
      </EmptyState>
    );
  }

  const gridStyle = layout.stacked
    ? { gridTemplateColumns: '1fr', gridAutoRows: 'minmax(320px, 1fr)' }
    : { gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-n-200 px-4">
        <h1 className="text-body font-semibold tracking-[-0.005em] text-n-900">모델 비교</h1>
        <span className="font-mono text-meta text-n-500">{ids.length}/{BASKET_MAX}</span>
        {heavy && (
          <span className="text-meta text-wait">요소 합계 {num(elementSum)}개 · 3D 단면은 느릴 수 있습니다</span>
        )}
        <span className="ml-auto hidden text-meta text-n-500 lg:inline" title="시점·맞춤 단축키는 마우스가 올라간 칸에 적용됩니다">
          A·S·D·I 시점 · F 맞춤 · P 투영 · R 초기화 · Esc 크게 보기 해제
        </span>
        <Button variant="ghost" size="sm" onClick={resetAll} className="max-lg:ml-auto" aria-keyshortcuts="R"
                title="처음 비교를 연 장면으로 — 시점·투영·표시·색·자르기·동기화·숨김·선택을 되돌립니다 (R)">
          <RotateCcw size={14} aria-hidden="true" />초기화
        </Button>
        <Button variant="secondary" size="sm" onClick={exit} title="비교를 끝내고 이전 화면으로 (담은 모델은 남습니다)">
          <LogOut size={14} aria-hidden="true" />끝내기
        </Button>
      </header>
      <CompareToolbar shared={shared} onChange={changeShared} onView={applyView} onFit={fitAll} />
      <div className={`grid min-h-0 flex-1 gap-2 bg-n-50 p-2 ${layout.stacked ? 'overflow-y-auto' : ''}`} style={gridStyle}>
        {ids.map((id) => (
          <ComparePane key={id} id={id} knownHull={basket.items.find((x) => x.id === id)?.hull || ''}
                       maximized={maximized === id} hidden={maximized != null && maximized !== id}
                       onToggleMax={toggleMax} onRemove={remove} onInfo={onInfo} onHover={onHover}
                       shared={shared} hub={hub} highlightPid={highlightPid} />
        ))}
        {hasEmpty && (
          <div className="flex min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-n-250 bg-n-0 p-6 text-center">
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" className="text-n-400" />
            <p className="mt-3 max-w-[320px] text-ui text-n-600">
              검색 결과나 자료 미리보기에서 '비교에 담기'로 모델을 하나 더 담을 수 있습니다.
            </p>
            <Link to="/" className={buttonClass('secondary', 'sm', 'mt-4')}>검색으로</Link>
          </div>
        )}
      </div>
      <ComparePanel models={rows} baseline={baseline} onBaseline={(i) => setBaselineId(ids[i])}
                    highlightPid={highlightPid} onHighlight={setHighlightPid} maxHeight={Math.round(win.h * 0.6)} />
    </div>
  );
}
