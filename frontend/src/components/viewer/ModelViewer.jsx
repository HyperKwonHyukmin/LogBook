import { useEffect, useId, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { ChevronDown, ChevronRight, CircleAlert, Expand, Focus, Info, LocateFixed, PanelRightClose, Scan, X } from 'lucide-react';
import { COLOR_MODES, COLOR_MODE_LABELS } from '../../lib/legend.js';
import { MARKER_COLORS } from '../../lib/pidPalette.js';
import { VIEW_PRESETS } from '../../lib/viewFrame.js';
import SolveCheckCard from '../preview/SolveCheckCard.jsx';
import Button, { buttonClass } from '../ui/Button.jsx';
import { Segmented, Tabs } from '../ui/Tabs.jsx';
import FindBar, { useFind } from './FindBar.jsx';
import { useModelViewer } from './useModelViewer.js';
import { GroupList, NodeCheck, PidList, SelectionInfo, selectionTitle } from './ViewerPanels.jsx';
import {
  ClipPanel, OrientationNote, RENDER_ITEMS, SectionProgress, ShortcutHelp, ViewportLegend, ViewportToolbar,
} from './ViewportOverlays.jsx';

const MARKER_KEYS = [['rbe2', 'RBE2'], ['rbe3', 'RBE3'], ['conm2', 'CONM2'], ['spc', 'SPC']];
const VIEW_ITEMS = Object.entries(VIEW_PRESETS).map(([id, p]) => ({ id, label: p.label }));
const COLOR_ITEMS = COLOR_MODES.map((id) => ({ id, label: id === 'section' ? '단면' : id === 'type' ? '요소' : COLOR_MODE_LABELS[id] }));
const num = (n) => Number(n).toLocaleString('ko-KR');

/** 도구줄 켜고 끄기 단추 — 켜짐은 세그먼트 선택과 같은 흰 바탕 + 그림자(파란 채움 없음). */
function ToggleChip({ pressed, onClick, children, title, swatch, disabled = false }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} title={title} disabled={disabled}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-meta font-medium
              transition-[background-color,border-color,color,box-shadow] duration-150 ease-out
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

/** 3D 캔버스 자리 + 불러오기·오류 상태. 뷰포트 위 조각(children)은 캔버스 형제로 둔다(피킹·포커스와 섞이지 않게). */
function Viewport({ v, onKeyDown, children, label }) {
  return (
    <div className="on-viewer @container relative min-w-0 flex-1 overflow-hidden bg-viewer">
      <div ref={v.surfaceRef} data-testid="viewer-canvas" tabIndex={0} role="application" aria-label={label}
           onPointerDown={v.onPointerDown} onPointerUp={v.onPointerUp} onKeyDown={onKeyDown}
           className="absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-navy-ring">
        {/* 엔진이 캔버스를 붙이는 자리 — React 자식을 두지 않는다. */}
        <div ref={v.mountRef} className="absolute inset-0" />
      </div>
      {v.state.status === 'loading' && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="text-meta text-n-300">모델 여는 중…</span>
          <div aria-hidden="true" className="h-0.5 w-40 overflow-hidden rounded-full bg-viewer-line">
            <div className="progress-indeterminate h-full w-[30%] animate-progress bg-link-on-dark" />
          </div>
        </div>
      )}
      {v.state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p role="alert" className="flex max-w-[400px] items-start gap-2 text-ui text-n-150">
            <CircleAlert size={14} className="mt-[3px] shrink-0 text-n-300" aria-hidden="true" />
            {v.state.error}
          </p>
        </div>
      )}
      <SectionProgress value={v.sectionProgress} />
      {children}
    </div>
  );
}

const CANVAS_LABEL = '3D 모델. F 화면 맞춤, A·S·D·I 시점, E 경계선, N 절점, P 직교·원근, Esc 선택 해제';

/**
 * BDF 3D 뷰어(설계 §7.3·§7.4, 04c).
 *  · variant='compact'(기본) — 검색·Entry 미리보기 속 작은 뷰어: 밝은 도구줄 + 캔버스 + 오른쪽 240px(PID | 그룹, 선택 정보).
 *  · variant='full' — 전체 화면(/v/:id): Model Builder Studio 를 본뜬 왼쪽 패널(모델·그룹·점검) + 어두운 뷰포트
 *    (도구줄·찾기·자르기·범례·축 표시) + 오른쪽 정보 도크.
 * formatVersion = API 가 준 변환 형식 버전(없으면 lbm 머리의 version).
 * full 전용: solve = /model 응답의 해석 검증 요약, modelDone = 변환이 끝났는가(검증 단추), fileName = f06 이름.
 */
export default function ModelViewer({ fileId, fullscreenHref, className = '', variant = 'compact', formatVersion = null,
                                      solve = null, modelDone = true, fileName = '' }) {
  const v = useModelViewer({ fileId, formatVersion });
  return variant === 'full'
    ? <FullViewer v={v} className={className} fileId={fileId} fileName={fileName} solve={solve} modelDone={modelDone} />
    : <CompactViewer v={v} fullscreenHref={fullscreenHref} className={className} />;
}

/* ── 작은 뷰어 ─────────────────────────────────────────────────────────────────────── */

function CompactViewer({ v, fullscreenHref, className }) {
  const inRouter = useInRouterContext();
  const infoId = useId();
  const panelId = useId();
  const [tab, setTab] = useState('pid');
  const ready = v.ready;
  const fullscreenClass = buttonClass('ghost', 'sm', 'ml-auto');
  // 탭이 곧 색 기준이다 — 목록의 색 칸과 3D 색이 늘 같다.
  const changeTab = (t) => {
    setTab(t);
    if (ready) v.setColorMode(t === 'group' ? 'group' : 'pid');
  };
  return (
    <div onKeyDown={(e) => v.handleKey(e, { allowFind: false })}
         className={`flex min-h-0 flex-col overflow-hidden bg-n-0 ${className}`}>
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-n-200 bg-n-50 px-2 py-1.5">
        <Segmented label="시점" items={VIEW_ITEMS} value={v.view} onChange={v.changeView} disabled={!ready} />
        <Button variant="ghost" size="sm" onClick={v.fit} disabled={!ready} title="화면 맞춤 (F)" aria-keyshortcuts="F">
          <Scan size={14} aria-hidden="true" />화면 맞춤
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-n-200" />
        <Segmented label="표시 방식" items={RENDER_ITEMS} value={v.renderMode} onChange={v.setRenderMode} disabled={!ready} />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-n-200" />
        <ToggleChip pressed={v.edges} onClick={v.toggleEdges} title="요소 경계선 (E)" disabled={!ready}>경계선</ToggleChip>
        {MARKER_KEYS.filter(([key]) => v.markerCounts[key] > 0).map(([key, label]) => (
          <ToggleChip key={key} pressed={v.markers[key]} onClick={() => v.toggleMarker(key)} swatch={MARKER_COLORS[key]} disabled={!ready}
                      title={`${label} 표시`}>
            {label} <span className="font-mono font-normal text-n-500">{num(v.markerCounts[key])}</span>
          </ToggleChip>
        ))}
        {fullscreenHref && (inRouter
          ? <Link to={fullscreenHref} className={fullscreenClass}><Expand size={14} aria-hidden="true" />전체 화면</Link>
          : <a href={fullscreenHref} className={fullscreenClass}><Expand size={14} aria-hidden="true" />전체 화면</a>)}
      </div>

      <div className="flex min-h-0 flex-1">
        <Viewport v={v} label={CANVAS_LABEL}>
          <OrientationNote v={v} className="absolute bottom-3 left-[104px] right-3" />
        </Viewport>

        <aside className="flex w-60 shrink-0 flex-col border-l border-n-200 bg-n-0">
          <Tabs label="목록" items={[{ id: 'pid', label: 'PID' }, { id: 'group', label: '그룹' }]} value={tab} onChange={changeTab}
                controls={panelId} className="shrink-0 px-3" />
          <div id={panelId} role="tabpanel" className="flex min-h-0 flex-1 flex-col">
            {tab === 'pid' ? <PidList v={v} /> : <GroupList v={v} />}
          </div>
          <section aria-labelledby={infoId} aria-live="polite" className="shrink-0 border-t border-n-200 px-3 py-2.5">
            <h3 id={infoId} className="mb-1.5 text-ui font-semibold text-n-700">선택 요소</h3>
            <SelectionInfo v={v} />
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── 전체 화면 ─────────────────────────────────────────────────────────────────────── */

/** 접히는 구역(Studio TabPanel 의 아코디언). 제목 13/600. */
function Section({ title, children, defaultOpen = true, aside = null, grow = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`flex flex-col border-b border-n-200 ${grow && open ? 'min-h-0 flex-1' : 'shrink-0'}`}>
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}
                className="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 text-ui font-semibold text-n-800 hover:bg-n-100">
          {open ? <ChevronDown size={14} aria-hidden="true" className="text-n-400" />
            : <ChevronRight size={14} aria-hidden="true" className="text-n-400" />}
          {title}
        </button>
        {aside && <div className="ml-auto flex items-center">{aside}</div>}
      </div>
      {open && <div id={id} className={grow ? 'flex min-h-0 flex-1 flex-col' : 'px-3 pb-3'}>{children}</div>}
    </section>
  );
}

function LayerRow({ checked, onChange, label, count, swatch, keyHint, disabled }) {
  return (
    <label className={`flex h-7 items-center gap-2 text-meta ${disabled ? 'text-n-500' : 'cursor-pointer text-n-800'}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
             className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed" />
      {swatch && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="shrink-0 font-mono text-n-500">{num(count)}</span>}
      {keyHint && <kbd className="shrink-0 rounded-sm bg-n-100 px-1.5 font-mono text-micro text-n-600">{keyHint}</kbd>}
    </label>
  );
}

const PANEL_TABS = [{ id: 'model', label: '모델' }, { id: 'group', label: '그룹' }, { id: 'check', label: '점검' }];

/** 점검 탭의 해석 검증 — 같은 카드(세로 배치) + 고정 노드 3D 표시 토글. */
function SolveCheckSection({ v, fileId, fileName, solve, modelDone, onData, fixedOn, onFixed }) {
  const ids = solve?.fixed_node_ids || [];
  return (
    <div className="flex flex-col gap-2">
      <SolveCheckCard fileId={fileId} fileName={fileName} initial={solve} ready={modelDone} compact onData={onData} />
      <LayerRow checked={fixedOn && ids.length > 0} onChange={() => onFixed(!fixedOn)} label="고정 노드 표시"
                count={ids.length || null} swatch={MARKER_COLORS.spc} disabled={!v.ready || ids.length === 0} />
    </div>
  );
}

function FullViewer({ v, className, fileId, fileName, solve: solveSummary, modelDone }) {
  const [tab, setTab] = useState('model');
  // 해석 검증 — 카드가 받아 온 자세한 행(고정 노드 ID 포함). 탭을 오가도 남긴다.
  const [solve, setSolve] = useState(solveSummary);
  const [fixedOn, setFixedOn] = useState(false);
  const fixedIds = solve?.fixed_node_ids;
  const { ready: viewerReady, highlightNodeIds } = v;
  useEffect(() => {
    if (viewerReady) highlightNodeIds(fixedOn ? fixedIds : null);
  }, [viewerReady, fixedOn, fixedIds, highlightNodeIds]);
  const [dockOpen, setDockOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const find = useFind(v);
  const panelId = useId();
  const ready = v.ready;
  const m = v.model;

  // 전체 화면은 페이지 자체가 뷰어 — 창 전체에서 단축키를 듣는다(Ctrl+F 는 브라우저 찾기 대신 ID 찾기).
  const keyRef = useRef(null);
  keyRef.current = (e) => v.handleKey(e, { onHelp: () => setHelpOpen((o) => !o) });
  useEffect(() => {
    const onKey = (e) => { if (!e.defaultPrevented) keyRef.current(e); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 무엇을 고르면 정보 도크를 연다(자동으로 닫지는 않는다 — Studio 와 같다).
  useEffect(() => { if (v.selection) setDockOpen(true); }, [v.selection]);

  const changeTab = (t) => {
    setTab(t);
    // 그룹 탭은 그룹 색으로 본다(PID 색이었을 때만 — 사용자가 고른 다른 색 기준은 존중).
    if (t === 'group' && ready && v.colorMode === 'pid') v.setColorMode('group');
  };

  const status = !m ? '' : tab === 'model'
    ? `PID ${num(m.geometry.groups.length)} · 요소 ${num(m.geometry.total)} · 절점 ${num(m.geometry.positions.length / 3)}`
    : tab === 'group'
      ? (m.groups.count > 1 ? `그룹 ${num(m.groups.count)} · 주 구조에서 떨어진 그룹 ${num(m.groups.count - 1)}` : `그룹 ${num(m.groups.count)} · 모두 이어져 있습니다`)
      : `자유단 ${num(m.check.counts.free)} · 고립 ${num(m.check.counts.orphan)}`;

  return (
    <div className={`flex min-h-0 ${className}`}>
      <aside aria-label="모델 패널" className="flex w-[clamp(256px,20vw,300px)] shrink-0 flex-col border-r border-n-200 bg-n-0">
        <Tabs label="패널" items={PANEL_TABS} value={tab} onChange={changeTab} controls={panelId} className="shrink-0 px-3" />
        <p className="tnum flex min-h-8 shrink-0 items-center border-b border-n-200 bg-n-50 px-3 text-meta text-n-600">
          {status}
        </p>
        <div id={panelId} role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {tab === 'model' && (
            <>
              <Section title="표시 방식">
                <Segmented label="표시 방식" items={RENDER_ITEMS} value={v.renderMode} onChange={v.setRenderMode}
                           disabled={!ready} stretch className="w-full" />
                {ready && v.renderMode === 'section' && m.beams > 0 && (m.version < 2 || !m.orient) && (
                  <p className="mt-2 text-meta text-n-500">다시 변환하면 단면 방향이 정확해집니다</p>
                )}
                {ready && m.beams === 0 && <p className="mt-2 text-meta text-n-500">1D 요소가 없어 단면이 없습니다</p>}
              </Section>
              <Section title="색 기준">
                <Segmented label="색 기준" items={COLOR_ITEMS} value={v.colorMode} onChange={v.setColorMode}
                           disabled={!ready} stretch className="w-full" />
              </Section>
              <Section title="레이어">
                <LayerRow checked={v.edges} onChange={v.toggleEdges} label="요소 경계선" keyHint="E" disabled={!ready} />
                <LayerRow checked={v.nodes.visible} onChange={() => v.setNodes({ visible: !v.nodes.visible })} label="절점"
                          count={m ? m.geometry.positions.length / 3 : null} keyHint="N" disabled={!ready} />
                {MARKER_KEYS.filter(([key]) => v.markerCounts[key] > 0).map(([key, label]) => (
                  <LayerRow key={key} checked={v.markers[key]} onChange={() => v.toggleMarker(key)} label={label}
                            count={v.markerCounts[key]} swatch={MARKER_COLORS[key]} disabled={!ready} />
                ))}
              </Section>
              <Section title="PID" grow
                       aside={(
                         <>
                           <Button variant="ghost" size="sm" className="px-1.5" disabled={!ready || v.hidden.size === 0}
                                   onClick={() => v.setAllPids(true)}>모두 보이기</Button>
                           <Button variant="ghost" size="sm" className="px-1.5"
                                   disabled={!ready || v.hidden.size === (m?.geometry.groups.length ?? 0)}
                                   onClick={() => v.setAllPids(false)}>모두 숨기기</Button>
                         </>
                       )}>
                <PidList v={v} showHead={false} />
              </Section>
            </>
          )}
          {tab === 'group' && (
            <>
              <p className="shrink-0 px-3 pt-2.5 text-meta text-n-600">
                부재·쉘·RBE 로 이어진 것끼리 묶었습니다. 그룹 1 이 가장 큰 덩어리입니다.
              </p>
              <GroupList v={v} />
            </>
          )}
          {tab === 'check' && (
            <>
              <Section title="해석 검증">
                <SolveCheckSection v={v} fileId={fileId} fileName={fileName} solve={solve} modelDone={modelDone}
                                   onData={setSolve} fixedOn={fixedOn} onFixed={setFixedOn} />
              </Section>
              <Section title="절점 점검"><NodeCheck v={v} /></Section>
              <Section title="ID 찾기">
                <FindBar find={find} tone="light" />
                <p className="mt-2 text-micro text-n-500">쉼표·공백으로 여러 개, 200-210 처럼 범위. 앞에 n·e·r 을 붙이면 종류가 바뀝니다.</p>
              </Section>
            </>
          )}
        </div>
        {m && (
          <p className="flex h-8 shrink-0 items-center gap-2 border-t border-n-200 px-3 text-micro text-n-500">
            <span>변환 형식 <span className="font-mono">v{m.version}</span></span>
          </p>
        )}
      </aside>

      <Viewport v={v} label={CANVAS_LABEL}>
        {/* 왼쪽 위에 위에서부터 쌓는다 — 도구줄 · 찾기 · 자르기 · 단축키(서로 겹치지 않게) */}
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-col items-start gap-2">
          <ViewportToolbar v={v} helpOpen={helpOpen} onHelp={() => setHelpOpen((o) => !o)} />
          {!!v.findOpen && (
            <FindBar find={find} tone="dark" focusKey={v.findOpen} onClose={() => v.setFindOpen(0)}
                     className="w-[360px] max-w-full animate-pop" />
          )}
          {v.clip.on && <ClipPanel v={v} />}
          {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
        </div>
        {ready && <ViewportLegend v={v} />}
      </Viewport>

      <InfoDock v={v} open={dockOpen} onOpen={setDockOpen} />
    </div>
  );
}

/** 오른쪽 정보 도크 — 세로 레일(36px) ↔ 펼침(280px). 무엇을 고르면 펼친다. */
function InfoDock({ v, open, onOpen }) {
  const titleId = useId();
  const sel = v.selection;
  return (
    <aside aria-label="정보 도크" className="flex shrink-0 border-l border-n-200 bg-n-0">
      {open && (
        <section aria-labelledby={titleId} className="flex w-[280px] flex-col border-r border-n-200">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-n-200 px-3">
            <h3 id={titleId} className="text-ui font-semibold text-n-700">{selectionTitle(sel)}</h3>
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => onOpen(false)} aria-label="정보 도크 접기" title="접기">
              <PanelRightClose size={14} aria-hidden="true" />
            </Button>
          </div>
          <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            <SelectionInfo v={v} />
          </div>
          {sel && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-n-200 px-2 py-2">
              <Button variant="ghost" size="sm" onClick={v.frameSelection}><LocateFixed size={14} aria-hidden="true" />이동</Button>
              <Button variant={v.isolated ? 'secondary' : 'ghost'} size="sm" aria-pressed={v.isolated}
                      onClick={() => v.setIsolate(!v.isolated)}>
                <Focus size={14} aria-hidden="true" />선택만 보기
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => v.select(null)}>
                <X size={14} aria-hidden="true" />해제
              </Button>
            </div>
          )}
        </section>
      )}
      <div className="flex w-9 shrink-0 flex-col items-center py-1.5">
        <Button variant={open ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={open} onClick={() => onOpen(!open)}
                aria-label="선택 정보" title="선택 정보">
          <Info size={14} aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
