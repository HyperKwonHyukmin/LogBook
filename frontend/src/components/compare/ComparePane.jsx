import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Maximize2, Minimize2, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { isModelPending, modelStateMessage } from '../../lib/modelState.js';
import ModelNote from '../preview/ModelNote.jsx';
import { SolveBadge } from '../preview/SolveCheckCard.jsx';
import Button from '../ui/Button.jsx';
import { Bar } from '../ui/Skeleton.jsx';
import { HullChip } from '../ui/Status.jsx';
import { useModelViewer } from '../viewer/useModelViewer.js';
import { SelectionInfo, selectionTitle } from '../viewer/ViewerPanels.jsx';
import { SectionProgress } from '../viewer/ViewportOverlays.jsx';

const POLL_MS = 4000;
const POLL_MAX = 30;

/**
 * 파일 메타 → (모델이면) 변환 요약 → (호선을 모르면) 소속 자료의 대표 호선.
 * 변환 대기 중이면 잠시 뒤 다시 묻는다(상한 있음). @returns { file, summary, hull, error }
 */
function usePaneInfo(id, knownHull) {
  const [st, setSt] = useState({ file: null, summary: null, hull: '', error: '', polls: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const file = await api(`/files/${id}`);
        if (!alive) return;
        setSt((s) => ({ ...s, file, error: '' }));
        let hull = knownHull || '';
        if (!hull && file.entry_id) {
          try {
            const entry = await api(`/entries/${encodeURIComponent(file.entry_id)}`);
            hull = entry?.hulls?.[0]?.hull_no || '';
          } catch { /* 호선은 없어도 비교할 수 있다 */ }
          if (alive) setSt((s) => ({ ...s, hull }));
        }
        if (file.kind !== 'model' || file.drm_encrypted) return;
        const summary = await api(`/files/${id}/model`);
        if (alive) setSt((s) => ({ ...s, summary }));
      } catch (err) {
        if (alive) setSt((s) => ({ ...s, error: errorText(err, '파일을 불러오지 못했습니다.') }));
      }
    })();
    return () => { alive = false; };
  }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 변환 대기(이전 결과도 없음)면 다시 묻는다.
  const waiting = st.summary && isModelPending(st.summary) && !st.summary.has_lbm && st.polls < POLL_MAX;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setTimeout(() => { setSt((s) => ({ ...s, polls: s.polls + 1 })); setTick((n) => n + 1); }, POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, st.summary]);
  return { file: st.file, summary: st.summary, hull: knownHull || st.hull, error: st.error };
}

/** 칸 안 오른쪽 아래 — 누른 요소·절점·RBE 정보(떠 있는 카드). */
function InfoCard({ v }) {
  return (
    <section aria-label={selectionTitle(v.selection)} aria-live="polite"
             className="absolute bottom-3 right-3 z-10 flex max-h-[calc(100%-24px)] w-[248px] max-w-[calc(100%-24px)] animate-pop flex-col rounded-lg border border-n-200 bg-n-0 shadow-md">
      <div className="flex h-8 shrink-0 items-center border-b border-n-200 pl-2.5 pr-1">
        <h3 className="text-meta font-semibold text-n-700">{selectionTitle(v.selection)}</h3>
        <Button variant="ghost" size="icon-sm" className="ml-auto h-6 w-6" onClick={() => v.select(null)} aria-label="선택 해제" title="선택 해제 (Esc)">
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto px-2.5 py-2"><SelectionInfo v={v} /></div>
    </section>
  );
}

/**
 * 칸 하나의 3D — 기존 뷰어 엔진·상태 훅(useModelViewer)을 그대로 쓴다.
 * hub(비교 화면이 준 고정 함수 묶음)에 자신을 알리고, 공통 툴바 값(shared)을 따라간다.
 */
function PaneViewer({ id, name, summary, shared, hub, highlightPid }) {
  const v = useModelViewer({ fileId: id, formatVersion: summary.format_version ?? null });
  const ready = v.ready;

  // 비교 화면이 이 칸에 명령(시점·맞춤·선택 해제)을 내리고 카메라를 읽을 수 있게 늘 최신 v 를 맡긴다.
  useEffect(() => { hub.register(id, v); });
  useEffect(() => () => hub.unregister(id), [id, hub]);

  // 공통 툴바 → 이 칸. v 의 함수는 렌더마다 새로 만들어지므로 값이 바뀔 때만 부른다.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => { if (ready && v.colorMode !== shared.colorMode) v.setColorMode(shared.colorMode); }, [ready, shared.colorMode]);
  useEffect(() => { if (ready && v.renderMode !== shared.renderMode) v.setRenderMode(shared.renderMode); }, [ready, shared.renderMode]);
  useEffect(() => { if (ready && v.projection !== shared.projection) v.setProjection(shared.projection); }, [ready, shared.projection]);
  useEffect(() => { if (ready) v.setClip(shared.clip); }, [ready, shared.clip]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // 카메라 바뀜 → 비교 화면의 동기화(마지막으로 조작한 칸이 주인).
  useEffect(() => {
    const eng = v.engineRef.current;
    if (!ready || !eng?.onCameraChange) return undefined;
    const off = eng.onCameraChange(() => hub.onCamera(id));
    hub.onReady(id);
    return off;
  }, [ready, id, hub, v.engineRef]);

  // 비교표에 쓸 모델 값(lbm 에서) — PID 수·독립 그룹 수·속성 카드.
  const model = v.model;
  useEffect(() => {
    if (model) {
      hub.onModel(id, {
        pidCount: model.geometry.groups.length,
        groupCount: model.groups.count,
        properties: model.lbm.header.properties || {},
      });
    }
  }, [model, id, hub]);

  // 속성 차이 행을 누르면 모든 칸에서 그 PID 를 강조한다. 이 모델에 없으면 칸 위에 '없음' 으로 알린다.
  const [pidFound, setPidFound] = useState(null);
  useEffect(() => {
    if (!ready) return;
    const n = v.engineRef.current?.setPidHighlight?.(highlightPid != null ? [highlightPid] : null);
    setPidFound(highlightPid != null ? (n ?? 0) > 0 : null);
  }, [ready, highlightPid, v.engineRef]);

  return (
    <div className="on-viewer relative min-h-0 flex-1 overflow-hidden bg-viewer">
      <div ref={v.surfaceRef} data-testid={`compare-canvas-${id}`} tabIndex={0} role="application"
           aria-label={`${name || `파일 ${id}`} 3D 모델. 누르면 정보, F 화면 맞춤, A·S·D·I 시점`}
           onPointerDown={v.onPointerDown} onPointerUp={v.onPointerUp}
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
          <p role="alert" className="flex max-w-[360px] items-start gap-2 text-ui text-n-150">
            <CircleAlert size={14} className="mt-[3px] shrink-0 text-n-300" aria-hidden="true" />
            {v.state.error}
          </p>
        </div>
      )}
      <SectionProgress value={v.sectionProgress} />
      {ready && highlightPid != null && pidFound != null && (
        <p role="status" className="pointer-events-none absolute left-3 top-3 z-10 inline-flex h-6 items-center gap-1.5 rounded-md border border-viewer-line bg-viewer-raised px-2 text-meta text-on-viewer-muted">
          PID <span className="font-mono text-on-viewer">{highlightPid}</span>{pidFound ? ' 강조' : ' 없음'}
        </p>
      )}
      {v.selection && <InfoCard v={v} />}
    </div>
  );
}

/**
 * 비교 칸(07 §2) — 머리줄(파일 이름 · 호선 · Entry · 해석 검증 · 크게 보기 · 빼기) + 3D.
 * 볼 수 없는 상태(변환 대기·실패·DRM·모델 아님)는 칸 안에 기존 ModelNote 문구.
 */
export default function ComparePane({ id, knownHull = '', maximized = false, hidden = false, onToggleMax, onRemove,
                                      onInfo, onHover, shared, hub, highlightPid }) {
  const { file, summary, hull, error } = usePaneInfo(id, knownHull);
  useEffect(() => { onInfo(id, { file, summary, hull }); }, [id, file, summary, hull, onInfo]);

  const isModel = file?.kind === 'model';
  const msg = isModel ? modelStateMessage(summary, file) : null;
  const viewable = isModel && summary && !msg;
  const name = file?.name || '';

  let body;
  if (error) body = <PaneNote>{error}</PaneNote>;
  else if (!file || (isModel && !summary && !msg)) body = <div className="min-h-0 flex-1 bg-viewer" />;
  else if (!isModel) body = <PaneNote>3D 로 볼 수 있는 모델 파일이 아닙니다. BDF 파일만 비교할 수 있습니다.</PaneNote>;
  else if (msg) body = <PaneNote title={msg.title} busy={msg.busy}>{msg.text}</PaneNote>;
  else {
    body = (
      <PaneViewer key={summary.key || 'model'} id={id} name={name} summary={summary} shared={shared} hub={hub}
                  highlightPid={highlightPid} />
    );
  }

  return (
    <article aria-label={name || `파일 ${id}`} data-pane={id}
             onPointerEnter={() => onHover(id)} onPointerLeave={() => onHover(null)}
             className={`@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-n-200 bg-n-0 ${hidden ? 'hidden' : ''}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-n-200 pl-3 pr-1">
        {file ? (
          <h2 title={file.rel_path} className="min-w-0 truncate text-ui font-semibold text-n-900">{name}</h2>
        ) : !error && <Bar className="h-3 w-40" />}
        {hull && <HullChip hull={hull} />}
        {file?.entry_id && (
          <Link to={`/e/${file.entry_id}?file=${id}`} title={file.entry_title || undefined}
                className="shrink-0 font-mono text-meta text-n-600 hover:text-brand hover:underline @max-[460px]:hidden">
            {file.entry_id}
          </Link>
        )}
        {isModel && summary && <span className="min-w-0 shrink @max-[560px]:hidden"><SolveBadge solve={summary.solve} /></span>}
        <span className="ml-auto" />
        <Button variant="ghost" size="sm" onClick={() => onToggleMax(id)} aria-pressed={maximized}
                title={maximized ? '나란히 보기 (Esc)' : '이 칸만 크게 보기'}>
          {maximized ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          <span className="@max-[640px]:sr-only">{maximized ? '나란히 보기' : '크게 보기'}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onRemove(id)} title="비교에서 빼기">
          <X size={14} aria-hidden="true" /><span className="@max-[640px]:sr-only">빼기</span>
        </Button>
      </header>
      {body}
    </article>
  );
}

function PaneNote({ children, title, busy = false }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-n-50 p-4">
      <div className="w-full max-w-[420px]"><ModelNote title={title} busy={busy}>{children}</ModelNote></div>
    </div>
  );
}
