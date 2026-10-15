import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, CircleAlert, Crosshair, EyeOff, X } from 'lucide-react';
import { api, apiArrayBuffer } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { parseLbm } from '../../lib/lbm.js';
import { computeGroups } from '../../lib/modelGroups.js';
import { modelStateMessage } from '../../lib/modelState.js';
import { diffErrorText } from '../../lib/revisions.js';
import {
  DEFAULT_LAYERS, STATUS_LABELS, STATUS_LAYER, buildDiffSpec, detailReasons, elementIdAt, focusFromItem,
  hasDrawn, itemRows, toggleLayer,
} from '../../lib/revisionDiff3d.js';
import { usePaneInfo } from '../compare/ComparePane.jsx';
import ModelNote from '../preview/ModelNote.jsx';
import Button from '../ui/Button.jsx';
import { Bar } from '../ui/Skeleton.jsx';
import Spinner from '../ui/Spinner.jsx';
import { HullChip } from '../ui/Status.jsx';
import { useModelViewer } from '../viewer/useModelViewer.js';
import { SectionProgress } from '../viewer/ViewportOverlays.jsx';
import { useDetail, useDiff } from './RevisionDiffPanel.jsx';

const num = (n) => Number(n || 0).toLocaleString('ko-KR');

/** 범례 색 칸 — 색과 함께 모양으로도 갈린다(채운 칸 · 반투명+점선 · 원 · 네모 · 흐린 칸). */
const SWATCH = {
  added: 'h-2.5 w-2.5 rounded-xs bg-diff-add',
  changed: 'h-2.5 w-2.5 rounded-xs bg-diff-chg',
  removed: 'h-2.5 w-2.5 rounded-xs border border-dashed border-diff-del bg-diff-del/30',
  moved: 'h-2.5 w-2.5 rounded-full bg-diff-chg',
  spc: 'h-2 w-2 bg-diff-chg',
  unchanged: 'h-2.5 w-2.5 rounded-xs bg-diff-same',
};

export function Swatch({ layer }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 ${SWATCH[layer] || SWATCH.unchanged}`} />;
}

const LEGEND_KEY = 'lb.diff.legend.collapsed.v1';
const readCollapsed = () => {
  try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; }
};
/** 개수 아래 '요소 3 · 강체 1' 을 보일 범주(절점만 있는 범주는 같은 숫자라 뺀다). */
const PART_KEYS = new Set(['added', 'changed', 'removed']);

/** 범례(뷰포트 왼쪽 위) — 범주마다 켜기/끄기 · 개수 · 잘림 · 3D 에 없는 수, 아래에 '바뀐 것만 보기'·'바뀐 곳으로 맞춤'. 제목을 누르면 접힌다. */
export function DiffLegend({ legend, layers, onToggle, onFrame }) {
  const any = hasDrawn(legend);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(LEGEND_KEY, c ? '0' : '1'); } catch { /* 저장 못 해도 그만 */ }
    return !c;
  });
  return (
    <section aria-label="변경 범례"
             className="absolute left-3 top-3 z-10 w-[248px] max-w-[calc(100%-24px)] rounded-lg border border-viewer-line bg-viewer-raised px-2.5 py-2 text-meta text-on-viewer-muted shadow-md">
      <h3>
        <button type="button" onClick={toggle} aria-expanded={!collapsed}
                className="-mx-1 flex w-[calc(100%+8px)] items-center gap-1 rounded-sm px-1 text-left font-medium text-on-viewer transition-colors duration-150 ease-out hover:bg-viewer-hover">
          {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}변경 보기
        </button>
      </h3>
      {!collapsed && (
      <>
      <ul role="list" className="mt-1.5 flex max-h-[min(46vh,360px)] flex-col gap-1 overflow-y-auto">
        {legend.map((r) => {
          const on = r.key === 'unchanged' ? layers.unchanged && !layers.onlyChanged : !!layers[r.key];
          const empty = r.count === 0 && r.key !== 'unchanged';
          return (
            <li key={r.key}>
              <label className={`flex min-h-6 cursor-pointer items-center gap-2 ${empty ? 'cursor-default' : ''}`}>
                <input type="checkbox" checked={on} disabled={empty} onChange={() => onToggle(r.key)}
                       aria-label={`${r.label} 표시`} className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-default" />
                <Swatch layer={r.key} />
                <span className={`min-w-0 flex-1 truncate ${on && !empty ? 'text-on-viewer' : 'text-on-viewer-subtle'}`}>{r.label}</span>
                <span className="shrink-0 font-mono text-on-viewer-subtle">{num(r.count)}</span>
              </label>
              {(r.parts && PART_KEYS.has(r.key) && r.count > 0) && <p className="ml-[42px] text-micro text-on-viewer-subtle">{r.parts}</p>}
              {r.notes.map((t) => <p key={t} className="ml-[42px] text-micro text-wait-on-dark">{t}</p>)}
              {r.missing > 0 && <p className="ml-[42px] text-micro text-on-viewer-subtle">3D 에 없는 {num(r.missing)}개(솔리드·스프링 등)</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-viewer-line pt-2">
        <button type="button" aria-pressed={layers.onlyChanged} onClick={() => onToggle('onlyChanged')}
                className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 font-medium transition-colors duration-150
                  ${layers.onlyChanged ? 'bg-viewer-active text-on-viewer' : 'text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer'}`}>
          <EyeOff size={14} aria-hidden="true" />바뀐 것만 보기
        </button>
        <button type="button" onClick={onFrame} disabled={!any}
                className="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 font-medium text-on-viewer-muted transition-colors duration-150 hover:bg-viewer-hover hover:text-on-viewer disabled:cursor-not-allowed disabled:text-on-viewer-subtle disabled:hover:bg-transparent">
          <Crosshair size={14} aria-hidden="true" />바뀐 곳으로 맞춤
        </button>
      </div>
      </>
      )}
    </section>
  );
}

const KIND_LABEL = { element: '요소', node: '절점', rigid: '강체' };

/** 전후 값 카드(뷰포트 오른쪽 아래) — 범주 배지 · ID · 앞/뒤 표 · 바뀐 이유. */
export function DiffInfoCard({ target, item, loading, error, onClose }) {
  const title = target ? `${KIND_LABEL[target.kind]} ${target.id}` : '';
  const rows = itemRows(item);
  const reasons = detailReasons(item?.detail);
  return (
    <section aria-label={`${title} 전후 값`} aria-live="polite"
             className="absolute bottom-3 right-3 z-10 flex max-h-[calc(100%-24px)] w-[320px] max-w-[calc(100%-24px)] animate-pop flex-col rounded-lg border border-n-200 bg-n-0 shadow-md">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-n-200 pl-2.5 pr-1">
        <h3 className="text-meta font-semibold text-n-800"><span className="font-mono">{title}</span></h3>
        {item && (
          <span className="inline-flex items-center gap-1 text-meta text-n-700">
            <Swatch layer={STATUS_LAYER[item.status]} />{STATUS_LABELS[item.status]}
          </span>
        )}
        <Button variant="ghost" size="icon-sm" className="ml-auto h-6 w-6" onClick={onClose} aria-label="선택 해제" title="선택 해제 (Esc)">
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto px-2.5 py-2 text-meta">
        {loading && <p className="flex items-center gap-1.5 text-n-600"><Spinner size={12} />전후 값을 읽는 중…</p>}
        {error && <p role="alert" className="text-err">{error}</p>}
        {item && (
          <>
            <table className="w-full table-fixed">
              <thead className="text-n-600">
                <tr><th className="w-[74px] pb-1 text-left font-medium">항목</th><th className="pb-1 text-left font-medium">앞 판</th>
                  <th className="pb-1 text-left font-medium">뒤 판</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-n-200 align-top">
                    <td className="py-1 pr-1 text-n-600">
                      <span className="inline-flex items-center gap-1">
                        {r.changed && <Swatch layer="changed" />}{r.label}
                      </span>
                      {r.changed && <span className="sr-only"> (바뀜)</span>}
                    </td>
                    <td className="break-words py-1 pr-1 font-mono text-n-600">{r.a}</td>
                    <td className={`break-words py-1 font-mono ${r.changed ? 'font-medium text-n-900' : 'text-n-600'}`}>{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {item.kind === 'node' && item.move > 0 && (
              <p className="mt-1.5 text-n-700">이동 거리 <span className="font-mono">{item.move}</span></p>
            )}
            {reasons.length > 0 && <p className="mt-1.5 text-n-700">비교 결과: {reasons.join(' · ')}</p>}
            {item.status === 'same' && <p className="mt-1.5 text-n-600">두 판에서 값이 같습니다.</p>}
            {!item.diff_ready && <p className="mt-1.5 text-n-500">비교 상세가 아직 없어 lbm 값만 보입니다.</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** 선택(엔진 피킹 결과) → 전후 값 API 대상 { kind, id }. */
function targetOf(sel, model, spec) {
  if (!sel || !model) return null;
  if (sel.kind === 'element') return { kind: 'element', id: elementIdAt(model.lbm, model.geometry, sel.index) };
  if (sel.kind === 'node') return { kind: 'node', id: model.lbm.blocks.node_ids[sel.index] };
  if (sel.kind === 'rbe') return { kind: 'rigid', id: model.rigids.eid[sel.index] };
  const gh = spec?.ghost;
  if (sel.kind === 'ghost' && gh?.items[sel.index]) {
    const it = gh.items[sel.index];
    return { kind: it.type === 'rigid' ? 'rigid' : 'element', id: it.id };
  }
  if (sel.kind === 'ghost-node' && gh?.nodeIds[sel.index] != null) return { kind: 'node', id: gh.nodeIds[sel.index] };
  return null;
}

/** 앞 판(a) lbm — 삭제된 것(고스트)과 비교표의 PID 수에 쓴다. 못 읽어도 변경 보기는 연다(삭제만 빠진다). */
function useLbmA(a) {
  const [st, setSt] = useState({ lbm: null, failed: false });
  useEffect(() => {
    let live = true;
    setSt({ lbm: null, failed: false });
    apiArrayBuffer(`/files/${a}/model.lbm`)
      .then((buf) => { if (live) setSt({ lbm: parseLbm(buf), failed: false }); })
      .catch(() => { if (live) setSt({ lbm: null, failed: true }); });
    return () => { live = false; };
  }, [a]);
  return st;
}

function pidCount(lbm) {
  const s = new Set();
  for (const [name, w] of [['beams', 4], ['tris', 5], ['quads', 6]]) {
    const rows = lbm.blocks[name] || [];
    for (let r = 0; r < rows.length / w; r += 1) s.add(rows[r * w + 1]);
  }
  return s.size;
}

/**
 * 뷰포트 — 뒤 판(b)을 기존 엔진으로 그리고 변경을 칠한다. 공통 툴바(표시·투영·자르기·시점)는 비교 화면 hub 를 그대로 쓴다.
 */
function DiffViewer({ a, b, summaryB, diffState, detail, shared, hub, highlightPid, resetTick }) {
  const v = useModelViewer({ fileId: b, formatVersion: summaryB.format_version ?? null });
  const ready = v.ready;
  const { lbm: lbmA, failed: lbmAFailed } = useLbmA(a);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [info, setInfo] = useState({ target: null, item: null, loading: false, error: '' });

  useEffect(() => { hub.register(b, v); });
  useEffect(() => () => hub.unregister(b), [b, hub]);
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => { if (ready && v.renderMode !== shared.renderMode) v.setRenderMode(shared.renderMode); }, [ready, shared.renderMode]);
  useEffect(() => { if (ready && v.projection !== shared.projection) v.setProjection(shared.projection); }, [ready, shared.projection]);
  useEffect(() => { if (ready) v.setClip(shared.clip); }, [ready, shared.clip]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // 비교표(아래 패널) — 뒤 판은 엔진 모델에서, 앞 판은 따로 받은 lbm 에서
  const model = v.model;
  useEffect(() => {
    if (model) hub.onModel(b, { pidCount: model.geometry.groups.length, groupCount: model.groups.count, properties: model.lbm.header.properties || {} });
  }, [model, b, hub]);
  useEffect(() => {
    if (lbmA) hub.onModel(a, { pidCount: pidCount(lbmA), groupCount: computeGroups(lbmA).count, properties: lbmA.header.properties || {} });
  }, [lbmA, a, hub]);

  // 칠할 자료 — 상세(ID 목록) + 두 모델이 다 오면 한 번
  const lbmAReady = !!lbmA || lbmAFailed;
  const built = useMemo(() => (model && detail && lbmAReady ? buildDiffSpec(model, lbmA, detail) : null), [model, detail, lbmA, lbmAReady]);
  useEffect(() => {
    const eng = v.engineRef.current;
    if (!ready || !eng?.setDiff) return;
    eng.setDiff(built ? built.spec : null);
    if (built) eng.setDiffLayers(layers);
  }, [ready, built]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && built) v.engineRef.current?.setDiffLayers(layers); }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // 초기화(R) — 범주·바뀐 것만 보기를 처음으로
  useEffect(() => { if (resetTick) setLayers(DEFAULT_LAYERS); }, [resetTick]);

  // 속성 행 PID 강조(비교 패널)
  const [pidFound, setPidFound] = useState(null);
  useEffect(() => {
    if (!ready) return;
    const n = v.engineRef.current?.setPidHighlight?.(highlightPid != null ? [highlightPid] : null);
    setPidFound(highlightPid != null ? (n ?? 0) > 0 : null);
  }, [ready, highlightPid, v.engineRef]);

  // 선택 → 전후 값
  const target = useMemo(() => targetOf(v.selection, model, built?.spec), [v.selection, model, built]);
  const tKey = target ? `${target.kind}:${target.id}` : '';
  useEffect(() => {
    const eng = v.engineRef.current;
    eng?.setDiffFocus?.(null);
    if (!target) { setInfo({ target: null, item: null, loading: false, error: '' }); return undefined; }
    let live = true;
    setInfo({ target, item: null, loading: true, error: '' });
    api(`/files/${a}/diff/${b}/item?kind=${target.kind}&id=${target.id}`)
      .then((item) => {
        if (!live) return;
        setInfo({ target, item, loading: false, error: '' });
        if (model && built) eng?.setDiffFocus?.(focusFromItem(item, model.geometry.center));
      })
      .catch((err) => { if (live) setInfo({ target, item: null, loading: false, error: errorText(err, '전후 값을 읽지 못했습니다.') }); });
    return () => { live = false; };
  }, [tKey, a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = () => v.engineRef.current?.frameDiff?.();
  const diffMsg = diffNote(diffState, detail, built);

  return (
    <div className="on-viewer relative min-h-0 flex-1 overflow-hidden bg-viewer" data-diff-ready={built ? 'true' : 'false'}
         data-diff-ms={built?.ms ?? ''}>
      <div ref={v.surfaceRef} data-testid={`diff-canvas-${b}`} tabIndex={0} role="application"
           aria-label="변경 보기 3D 모델. 누르면 전후 값, F 화면 맞춤, A·S·D·I 시점"
           onPointerDown={v.onPointerDown} onPointerUp={v.onPointerUp}
           className="absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-navy-ring">
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
          <p role="alert" className="flex max-w-[360px] items-start gap-2 text-ui text-n-150">
            <CircleAlert size={14} className="mt-[3px] shrink-0 text-n-300" aria-hidden="true" />{v.state.error}
          </p>
        </div>
      )}
      <SectionProgress value={v.sectionProgress} />
      {ready && built && (
        <DiffLegend legend={built.legend} layers={layers} onFrame={frame}
                    onToggle={(k) => setLayers((cur) => toggleLayer(cur, k))} />
      )}
      {ready && diffMsg && (
        <p role="status" className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1.5 rounded-md border border-viewer-line bg-viewer-raised px-2.5 py-1 text-meta text-on-viewer-muted shadow-md">
          {diffMsg.busy && <Spinner size={12} />}{diffMsg.text}
        </p>
      )}
      {ready && built && lbmAFailed && (
        <p className="absolute bottom-3 left-3 z-10 max-w-[300px] rounded-md border border-viewer-line bg-viewer-raised px-2.5 py-1 text-meta text-wait-on-dark">
          앞 판 모델을 열지 못해 삭제된 것은 보이지 않습니다.
        </p>
      )}
      {ready && highlightPid != null && pidFound != null && (
        <p role="status" className="pointer-events-none absolute right-3 top-3 z-10 inline-flex h-6 items-center gap-1.5 rounded-md border border-viewer-line bg-viewer-raised px-2 text-meta text-on-viewer-muted">
          PID <span className="font-mono text-on-viewer">{highlightPid}</span>{pidFound ? ' 강조' : ' 없음'}
        </p>
      )}
      {v.selection && info.target && (
        <DiffInfoCard target={info.target} item={info.item} loading={info.loading} error={info.error} onClose={() => v.select(null)} />
      )}
    </div>
  );
}

/** 비교 상태 → 뷰포트 위 한 줄(없으면 null). */
function diffNote(d, detail, built) {
  if (!d) return { busy: true, text: '비교 결과를 읽는 중…' };
  if (d.state === 'waiting') return { text: '두 모델의 변환이 끝나면 비교합니다.' };
  if (d.state === 'queued' || d.state === 'running' || d.stale) return { busy: true, text: '비교 중입니다. 큰 모델은 1분 가까이 걸릴 수 있습니다.' };
  if (d.state === 'error') return { text: `비교하지 못했습니다: ${diffErrorText(d.error)}` };
  if (d.state === 'done' && d.summary?.identical) return { text: '두 판의 모델 내용이 같습니다. 바뀐 것이 없습니다.' };
  if (d.state === 'done' && !detail) return { busy: true, text: '바뀐 ID 목록을 읽는 중…' };
  if (built && !hasDrawn(built.legend)) return { text: '3D 로 그릴 변경이 없습니다(속성·재료·하중 값만 바뀜). 아래 비교 패널·변경 요약을 보세요.' };
  return null;
}

/**
 * 판 변경 보기 칸(16) — 비교 화면(/compare?ids=a,b&view=diff) 안 한 칸. 머리줄(앞 판 → 뒤 판 · 호선 · 자료) + 3D.
 * 비교가 없으면 요청하고(이미 있으면 그대로), 끝날 때까지 기다린다.
 */
export default function DiffPane({ a, b, knownHull = '', onInfo, shared, hub, highlightPid, resetTick }) {
  const ia = usePaneInfo(a, knownHull);
  const ib = usePaneInfo(b, knownHull);
  useEffect(() => { onInfo(a, { file: ia.file, summary: ia.summary, hull: ia.hull }); }, [a, ia.file, ia.summary, ia.hull, onInfo]);
  useEffect(() => { onInfo(b, { file: ib.file, summary: ib.summary, hull: ib.hull }); }, [b, ib.file, ib.summary, ib.hull, onInfo]);
  const { diff, error: diffError } = useDiff(a, b, { request: true });
  const { detail, failed: detailFailed } = useDetail(a, b, diff?.state === 'done' && !diff.stale);

  const file = ib.file;
  const isModel = file?.kind === 'model';
  const msg = isModel ? modelStateMessage(ib.summary, file) : null;
  let body;
  if (ib.error || diffError) body = <Note>{ib.error || diffError}</Note>;
  else if (!file || (isModel && !ib.summary && !msg)) body = <div className="min-h-0 flex-1 bg-viewer" />;
  else if (!isModel) body = <Note>3D 로 볼 수 있는 모델 파일이 아닙니다.</Note>;
  else if (msg) body = <Note title={msg.title} busy={msg.busy}>{msg.text}</Note>;
  else {
    body = (
      <DiffViewer key={ib.summary.key || 'model'} a={a} b={b} summaryB={ib.summary} diffState={diff}
                  detail={detailFailed ? null : detail} shared={shared} hub={hub} highlightPid={highlightPid} resetTick={resetTick} />
    );
  }
  const hull = ib.hull || ia.hull;
  return (
    <article aria-label="변경 보기" data-pane={b} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-n-200 bg-n-0">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-n-200 pl-3 pr-2">
        {ia.file && ib.file ? (
          <h2 className="flex min-w-0 items-center gap-1.5 text-ui text-n-900">
            <span title={ia.file.rel_path} className="min-w-0 truncate text-n-600">{ia.file.name}</span>
            <ArrowRight size={14} className="shrink-0 text-n-400" aria-hidden="true" /><span className="sr-only">에서</span>
            <span title={ib.file.rel_path} className="min-w-0 truncate font-semibold">{ib.file.name}</span>
          </h2>
        ) : !(ia.error || ib.error) && <Bar className="h-3 w-56" />}
        {hull && <HullChip hull={hull} />}
        {file?.entry_id && (
          <Link to={`/e/${file.entry_id}?file=${b}`} title={file.entry_title || undefined}
                className="shrink-0 font-mono text-meta text-n-600 hover:text-brand hover:underline @max-[460px]:hidden">
            {file.entry_id}
          </Link>
        )}
        <span className="ml-auto shrink-0 text-meta text-n-500 @max-[640px]:hidden">뒤 판 기준 · 삭제는 앞 판 위치에 겹쳐 그림</span>
      </header>
      {detailFailed && <p className="border-b border-n-200 bg-err-bg px-3 py-1 text-meta text-err">바뀐 ID 목록을 읽지 못했습니다. 숫자 요약은 아래 비교 패널에 있습니다.</p>}
      {body}
    </article>
  );
}

function Note({ children, title, busy = false }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-n-50 p-4">
      <div className="w-full max-w-[420px]"><ModelNote title={title} busy={busy}>{children}</ModelNote></div>
    </div>
  );
}

