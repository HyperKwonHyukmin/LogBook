import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiArrayBuffer } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { MARKER_COLORS } from '../../lib/pidPalette.js';
import { beamExtras, lbmVersion, parseLbm } from '../../lib/lbm.js';
import { buildGeometry } from '../../lib/modelGeometry.js';
import { computeGroups } from '../../lib/modelGroups.js';
import { classifyNodes } from '../../lib/nodeCheck.js';
import { createIdIndex, elementNodeIndices, elementTable, listRigids, rigidNodes } from '../../lib/modelIndex.js';
import { planSections } from '../../lib/sectionPlan.js';
import { VIEW_KEYS } from '../../lib/viewFrame.js';
import { ViewerEngineContext } from './ViewerEngineContext.js';

/** 요소가 이보다 많으면 경계선을 기본으로 끈다(설계 §7.3 대형 모델). */
export const EDGE_LIMIT = 200_000;
/** 누른 자리와 뗀 자리가 이 안이면 클릭(드래그 회전이 아님). */
const CLICK_SLOP = 4;
const DEFAULT_MARKERS = { rbe2: true, rbe3: true, conm2: true, spc: true };
const DEFAULT_NODES = { visible: false, classes: [true, true, true] };
const DEFAULT_CLIP = { on: false, axis: 'x', position: 0.5, flip: false };

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

/** 엔진 결과(옛 계약은 순번만 돌려준다)를 { kind, index } 로 맞춘다. */
const normSel = (r) => (r == null ? null : typeof r === 'number' ? { kind: 'element', index: r } : r);

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * BDF 뷰어 상태와 엔진 연결(04c). 작은 뷰어(미리보기)와 전체 화면 뷰어가 같이 쓴다.
 * three 는 ViewerEngineContext 의 공장으로만 만난다(테스트는 가짜 엔진).
 */
export function useModelViewer({ fileId, formatVersion = null }) {
  const factory = useContext(ViewerEngineContext);
  const mountRef = useRef(null);
  const surfaceRef = useRef(null);
  const engineRef = useRef(null);
  const downRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [model, setModel] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [groupHidden, setGroupHidden] = useState(() => new Set());
  const [edges, setEdges] = useState(true);
  const [markers, setMarkers] = useState(DEFAULT_MARKERS);
  const [nodes, setNodesState] = useState(DEFAULT_NODES);
  const [view, setViewState] = useState('iso');
  const [colorMode, setColorModeState] = useState('pid');
  const [renderMode, setRenderModeState] = useState('line');
  const [sectionProgress, setSectionProgress] = useState(null);
  const [projection, setProjectionState] = useState('ortho');
  const [clip, setClipState] = useState(DEFAULT_CLIP);
  const [selection, setSelection] = useState(null);
  const [isolated, setIsolated] = useState(false);
  const isolatedRef = useRef(false);
  const [findOpen, setFindOpen] = useState(0);   // 0 = 닫힘, 숫자 = 열 때마다 늘려 입력칸에 다시 포커스

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', error: '' });
    setModel(null); setSelection(null); setHidden(new Set()); setGroupHidden(new Set()); setViewState('iso');
    setMarkers(DEFAULT_MARKERS); setNodesState(DEFAULT_NODES); setColorModeState('pid'); setRenderModeState('line');
    setSectionProgress(null); setProjectionState('ortho'); setClipState(DEFAULT_CLIP); setIsolated(false); setFindOpen(0);
    isolatedRef.current = false;
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
        let m;
        try {
          const lbm = parseLbm(await apiArrayBuffer(`/files/${fileId}/model.lbm`));
          const geometry = buildGeometry(lbm);
          const groups = computeGroups(lbm);
          const check = classifyNodes(lbm);
          const rigids = listRigids(lbm);
          const plan = planSections(lbm, geometry);
          const { orient, offsets } = beamExtras(lbm);
          m = {
            lbm, geometry, groups, check, rigids, plan, orient, offsets,
            version: lbmVersion(lbm, formatVersion),
            table: elementTable(lbm, geometry),
            index: createIdIndex(lbm, geometry, rigids),
            beams: (lbm.blocks.beams?.length || 0) / 4,
          };
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
        const withEdges = m.geometry.total <= EDGE_LIMIT;
        engine.setModel(m.geometry, {
          edges: withEdges,
          extras: {
            blocks: m.lbm.blocks, groups: m.groups, check: m.check, rigids: m.rigids, plan: m.plan,
            orient: m.orient, offsets: m.offsets,
          },
        });
        setEdges(withEdges);
        setModel(m);
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
  }, [fileId, factory, formatVersion]);

  const ready = state.status === 'ready';
  const engine = () => engineRef.current;

  const markerCounts = useMemo(() => (model ? {
    rbe2: rigidCount(model.lbm, 0, 'RBE2'),
    rbe3: rigidCount(model.lbm, 1, 'RBE3'),
    conm2: model.geometry.masses.length,
    // 같은 절점이 여러 SPC 에 걸려도 한 번만 센다.
    spc: new Set(model.geometry.spcs).size,
  } : {}), [model]);

  /** 선택 대상이 지금 보이는가(PID·그룹 숨김). */
  const visibleSel = useCallback((sel, pids, grps) => {
    if (!sel || !model) return true;
    if (sel.kind === 'element') {
      return !pids.has(model.table.pid[sel.index]) && !grps.has(model.groups.elemGroup[sel.index]);
    }
    const node = sel.kind === 'node' ? sel.index : model.rigids.center[sel.index];
    return !grps.has(model.groups.nodeGroup[node]);
  }, [model]);

  /** 선택 대상의 절점 순번(화면 맞춤용). */
  const selectionNodes = useCallback((sel) => {
    if (!sel || !model) return [];
    if (sel.kind === 'element') return elementNodeIndices(model.lbm, model.geometry, sel.index);
    if (sel.kind === 'node') return [sel.index];
    return rigidNodes(model.lbm, model.rigids, sel.index);
  }, [model]);

  const select = useCallback((raw, { frame = false } = {}) => {
    const sel = normSel(raw);
    setSelection(sel);
    engineRef.current?.highlight(sel);
    if (sel && frame) engineRef.current?.frameNodes(selectionNodes(sel));
    // 선택만 보기는 선택을 따라간다. 선택이 없으면 끈다.
    if (isolatedRef.current) {
      engineRef.current?.setIsolate(sel);
      if (!sel) { isolatedRef.current = false; setIsolated(false); }
    }
  }, [selectionNodes]);

  const dropHiddenSelection = (pids, grps) => {
    if (selection && !visibleSel(selection, pids, grps)) select(null);
  };

  const toggleGroup = (pid) => {
    const next = new Set(hidden);
    const show = next.has(pid);
    if (show) next.delete(pid); else next.add(pid);
    setHidden(next);
    engine()?.setGroupVisible(pid, show);
    // 보이지 않는 요소를 선택한 채 두지 않는다.
    if (!show) dropHiddenSelection(next, groupHidden);
  };
  const setAllPids = (visible) => {
    const groups = model?.geometry.groups || [];
    for (const g of groups) engine()?.setGroupVisible(g.pid, visible);
    const next = visible ? new Set() : new Set(groups.map((g) => g.pid));
    setHidden(next);
    if (!visible) dropHiddenSelection(next, groupHidden);
  };

  const applyGroupHidden = (next) => {
    setGroupHidden(next);
    const n = model?.groups.count || 0;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) mask[i] = next.has(i) ? 0 : 1;
    engine()?.setGroupsVisible(mask);
    dropHiddenSelection(hidden, next);
  };
  const toggleConnGroup = (i) => {
    const next = new Set(groupHidden);
    if (next.has(i)) next.delete(i); else next.add(i);
    applyGroupHidden(next);
  };
  const setAllConnGroups = (visible) => {
    const n = model?.groups.count || 0;
    applyGroupHidden(visible ? new Set() : new Set(Array.from({ length: n }, (_, i) => i)));
  };
  /** 이 그룹만 보기 */
  const soloConnGroup = (i) => {
    const n = model?.groups.count || 0;
    const next = new Set();
    for (let k = 0; k < n; k += 1) if (k !== i) next.add(k);
    applyGroupHidden(next);
  };
  /** 그룹으로 이동 */
  const frameConnGroup = (i) => {
    const ng = model?.groups.nodeGroup;
    if (ng) engine()?.frameNodes((n) => ng[n] === i);
  };

  const changeView = (id) => {
    setViewState(id);
    engine()?.setView(id);
  };
  const fit = () => engine()?.fit();
  const toggleEdges = () => {
    const next = !edges;
    setEdges(next);
    engine()?.setEdges(next);
  };
  const toggleMarker = (key) => {
    const next = { ...markers, [key]: !markers[key] };
    setMarkers(next);
    engine()?.setMarkers(next);
  };
  const setNodes = (patch) => {
    const next = { ...nodes, ...patch };
    setNodesState(next);
    engine()?.setNodes(next);
  };
  const setColorMode = (mode) => {
    setColorModeState(mode);
    engine()?.setColorMode(mode);
  };
  const setRenderMode = async (mode) => {
    if (mode === renderMode && sectionProgress == null) return;
    setRenderModeState(mode);
    const eng = engine();
    if (!eng?.setRenderMode) return;
    if (mode === 'section') setSectionProgress(0);
    try {
      await eng.setRenderMode(mode, { onProgress: (p) => setSectionProgress(p) });
    } finally {
      setSectionProgress(null);
    }
  };
  const setProjection = (mode) => {
    setProjectionState(mode);
    engine()?.setProjection(mode);
  };
  const setClip = (patch) => {
    const next = { ...clip, ...patch };
    setClipState(next);
    engine()?.setClip(next.on ? next : null);
  };
  const setIsolate = (on) => {
    const value = on && !!selection;
    isolatedRef.current = value;
    setIsolated(value);
    engine()?.setIsolate(value ? selection : null);
  };
  /**
   * 절점 ID(BDF GRID 번호) 묶음을 3D 에 강조한다(06 해석 검증의 고정 노드, SPC 색). 빈 목록·null 이면 지운다.
   * 모델에 없는 ID 는 건너뛴다. @returns {number} 실제로 찍은 절점 수
   */
  const highlightNodeIds = useCallback((ids) => {
    const eng = engineRef.current;
    if (!eng?.setNodeSet || !model) return 0;
    const idx = [];
    for (const id of ids || []) {
      const i = model.index.node(id);
      if (i != null) idx.push(i);
    }
    eng.setNodeSet(idx.length ? idx : null, { color: MARKER_COLORS.spc });
    return idx.length;
  }, [model]);
  const frameSelection = () => {
    if (selection) engine()?.frameNodes(selectionNodes(selection));
  };

  /**
   * 처음 연 장면으로 — 선택·선택만 보기·찾기를 끄고, 숨긴 PID·연결 그룹을 다시 보이고,
   * 경계선·마커·절점 표시를 기본값으로 되돌린 뒤 등각 시점으로 모델 전체를 맞춘다(07 초기화).
   * 색 기준·표시 방식·투영·자르기는 부르는 쪽이 따로 맞춘다(비교 화면은 공통 툴바 값).
   */
  const resetScene = () => {
    const eng = engine();
    isolatedRef.current = false;
    setIsolated(false);
    eng?.setIsolate(null);
    setSelection(null);
    eng?.highlight(null);
    setFindOpen(0);
    if (hidden.size) {
      for (const pid of hidden) eng?.setGroupVisible(pid, true);
      setHidden(new Set());
    }
    if (groupHidden.size) {
      setGroupHidden(new Set());
      eng?.setGroupsVisible(new Uint8Array(model?.groups.count || 0).fill(1));
    }
    const withEdges = !model || model.geometry.total <= EDGE_LIMIT;
    if (edges !== withEdges) { setEdges(withEdges); eng?.setEdges(withEdges); }
    setMarkers(DEFAULT_MARKERS);
    eng?.setMarkers(DEFAULT_MARKERS);
    setNodesState(DEFAULT_NODES);
    eng?.setNodes(DEFAULT_NODES);
    changeView('iso');
  };

  function onPointerDown(e) {
    if (e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY };
    // 캔버스는 포커스를 받지 않으므로 둘레 영역에 포커스를 줘 단축키가 바로 듣게 한다.
    if (e.target === surfaceRef.current || mountRef.current?.contains(e.target)) surfaceRef.current?.focus({ preventScroll: true });
  }
  function onPointerUp(e) {
    const down = downRef.current;
    downRef.current = null;
    if (!down || e.button !== 0 || !ready) return;
    if (Math.abs(e.clientX - down.x) > CLICK_SLOP || Math.abs(e.clientY - down.y) > CLICK_SLOP) return;
    // 도구줄·범례 같은 뷰포트 위 조각을 누른 것은 피킹이 아니다.
    if (!(e.target === surfaceRef.current || mountRef.current?.contains(e.target))) return;
    const hit = normSel(engine()?.pickAt(e.clientX, e.clientY) ?? null);
    // 선택만 보기 중에 빈 곳을 누르면 선택을 그대로 둔다.
    if (!hit && isolated) return;
    select(hit);
  }

  /**
   * 단축키 — F 화면 맞춤, I·1·2·3·A·S·D 시점, E 경계선, N 절점, P 직교/원근, Ctrl+F 찾기, Esc.
   * 입력칸 안에서는 듣지 않는다(찾기 칸에 'f' 를 쳐도 화면이 맞춰지지 않게).
   * @returns {boolean} 처리했으면 true
   */
  function handleKey(e, { allowFind = true, onHelp = null } = {}) {
    if (!ready) return false;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      if (!allowFind) return false;
      e.preventDefault();
      setFindOpen((n) => n + 1);
      return true;
    }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'f') fit();
    else if (VIEW_KEYS[k]) changeView(VIEW_KEYS[k]);
    else if (k === 'e') toggleEdges();
    else if (k === 'n') setNodes({ visible: !nodes.visible });
    else if (k === 'p') setProjection(projection === 'ortho' ? 'persp' : 'ortho');
    else if (k === '?' && onHelp) onHelp();
    else if (k === 'Escape') {
      if (findOpen) setFindOpen(0);
      else if (isolated) setIsolate(false);
      else select(null);
    } else return false;
    e.preventDefault();
    return true;
  }

  return {
    // 상태
    state, ready, model, hidden, groupHidden, edges, markers, markerCounts, nodes, view, colorMode, renderMode,
    sectionProgress, projection, clip, selection, isolated, findOpen,
    // 참조(engineRef — 비교 화면이 카메라 동기화·PID 강조에 쓴다)
    mountRef, surfaceRef, engineRef,
    // 동작
    select, toggleGroup, setAllPids, toggleConnGroup, setAllConnGroups, soloConnGroup, frameConnGroup,
    changeView, fit, toggleEdges, toggleMarker, setNodes, setColorMode, setRenderMode, setProjection, setClip,
    setIsolate, frameSelection, resetScene, highlightNodeIds, setFindOpen, handleKey, onPointerDown, onPointerUp,
  };
}
