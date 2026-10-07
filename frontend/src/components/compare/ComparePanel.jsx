import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { characteristicRows, formatDelta, propertyDiffRows } from '../../lib/compareTable.js';
import Button from '../ui/Button.jsx';
import { Segmented, Tabs } from '../ui/Tabs.jsx';

const HEIGHT_KEY = 'lb.compare.panel.v1';
const MIN_H = 120;
/** 처음 높이 — 창 높이의 28%(최대 240). 1366×768 에서 칸이 너무 낮아지지 않게. */
const defaultHeight = () => Math.round(Math.min(240, Math.max(MIN_H, (window.innerHeight || 800) * 0.28)));
const num = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 });

/** 패널 높이·접힘(이 브라우저 편의 상태). */
function readPanel() {
  try {
    const v = JSON.parse(localStorage.getItem(HEIGHT_KEY) || 'null');
    return { height: Number(v?.height) > 0 ? Number(v.height) : defaultHeight(), open: v?.open !== false };
  } catch { return { height: defaultHeight(), open: true }; }
}
function writePanel(p) {
  try { localStorage.setItem(HEIGHT_KEY, JSON.stringify(p)); } catch { /* 저장 못 해도 그만 */ }
}

const TABS = [{ id: 'traits', label: '특성 비교표' }, { id: 'props', label: '속성 차이' }];
const DIFF_ITEMS = [{ id: 'diff', label: '다른 것만' }, { id: 'all', label: '모두 보기' }];

/** 열 머리 — 모델 이름 · 호선 + 기준 모델 표시/바꾸기. */
function ModelHead({ m, index, baseline, onBaseline }) {
  const on = index === baseline;
  return (
    <th scope="col" className={`min-w-[148px] border-b border-l border-n-200 px-2.5 py-1.5 text-left align-top font-normal ${on ? 'bg-n-100' : 'bg-n-50'}`}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-meta font-semibold text-n-800" title={m.name}>{m.name || `파일 ${m.id}`}</span>
        {m.hull && <span className="shrink-0 font-mono text-meta text-n-600">{m.hull}</span>}
      </div>
      {on ? (
        <span className="mt-1 inline-flex h-5 items-center rounded-xs bg-n-0 px-1.5 text-micro font-semibold text-n-800 shadow-xs">기준</span>
      ) : (
        <button type="button" onClick={() => onBaseline(index)}
                className="mt-1 h-5 rounded-xs px-1 text-micro font-medium text-n-600 transition-colors duration-150 ease-out hover:bg-n-150 hover:text-n-900">
          기준으로
        </button>
      )}
    </th>
  );
}

/** 특성 비교표 — 행 = 항목, 열 = 모델. 기준 모델과 다른 칸은 강조하고 숫자는 차이(+n/−n)도 보인다. */
function TraitsTable({ models, baseline, onBaseline }) {
  const rows = useMemo(() => characteristicRows(models, baseline), [models, baseline]);
  const groups = [['elements', '요소 종류별 개수'], ['model', '모델']];
  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-meta">
      <thead className="sticky top-0 z-[1]">
        <tr>
          <th scope="col" className="sticky left-0 z-[2] w-[136px] border-b border-n-200 bg-n-50 px-3 py-1.5 text-left font-medium text-n-600">항목</th>
          {models.map((m, i) => <ModelHead key={m.id} m={m} index={i} baseline={baseline} onBaseline={onBaseline} />)}
        </tr>
      </thead>
      {groups.map(([g, title]) => {
        const list = rows.filter((r) => r.group === g);
        if (!list.length) return null;
        return (
          <tbody key={g}>
            <tr>
              <th scope="rowgroup" colSpan={models.length + 1}
                  className="sticky left-0 border-b border-n-200 bg-n-0 px-3 pb-1 pt-2.5 text-left text-meta font-semibold text-n-800">
                {title}
              </th>
            </tr>
            {list.map((r) => (
              <tr key={r.key}>
                <th scope="row" className={`sticky left-0 border-b border-n-200 bg-n-0 px-3 py-1 text-left font-normal text-n-700 ${r.group === 'elements' ? 'font-mono' : ''}`}>
                  {r.label}
                </th>
                {r.cells.map((c, i) => (
                  <td key={models[i].id}
                      className={`border-b border-l border-n-200 px-2.5 py-1 ${c.differs ? 'bg-wait-bg' : i === baseline ? 'bg-n-25' : ''}`}>
                    {c.value == null ? <span className="text-n-500">…</span> : (
                      <span className="flex items-baseline gap-2">
                        <span className={`${r.kind === 'number' ? 'tnum font-mono' : ''} ${c.differs ? 'font-medium text-n-900' : 'text-n-800'}`}>
                          {r.kind === 'number' ? num(c.value) : c.value}
                        </span>
                        {c.differs && c.delta != null && <span className="font-mono text-micro text-wait">{formatDelta(c.delta)}</span>}
                        {c.differs && c.delta == null && <span className="text-micro text-wait">다름</span>}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

/** 속성 차이 — PID 합집합 × 모델. 행을 누르면 모든 칸에서 그 PID 를 강조(다시 누르면 해제). */
function PropsTable({ models, baseline, onBaseline, highlightPid, onHighlight }) {
  const [mode, setMode] = useState('diff');
  const diff = useMemo(() => propertyDiffRows(models, { baseline, diffOnly: mode === 'diff' }), [models, baseline, mode]);
  const loading = models.some((m) => !m.properties);
  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky left-0 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
        <Segmented label="보기" items={DIFF_ITEMS} value={mode} onChange={setMode} />
        <span className="tnum text-meta text-n-600">
          PID {num(diff.total)}개 중 다른 것 {num(diff.changed)}개{loading ? ' · 모델 여는 중' : ''}
        </span>
        <span className="text-meta text-n-500">행을 누르면 모든 칸에서 그 PID 를 강조합니다</span>
      </div>
      {diff.rows.length === 0 ? (
        <p className="px-3 py-3 text-meta text-n-500">
          {diff.total === 0 ? (loading ? '속성을 불러오는 중입니다' : '속성 카드가 없습니다') : '모든 PID 의 속성이 같습니다'}
        </p>
      ) : (
        <table className="w-max min-w-full border-separate border-spacing-0 text-meta">
          <thead className="sticky top-0 z-[1]">
            <tr>
              <th scope="col" className="sticky left-0 z-[2] w-[96px] border-b border-n-200 bg-n-50 px-3 py-1.5 text-left font-medium text-n-600">PID</th>
              {models.map((m, i) => <ModelHead key={m.id} m={m} index={i} baseline={baseline} onBaseline={onBaseline} />)}
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((r) => {
              const on = highlightPid === r.pid;
              return (
                <tr key={r.pid} aria-selected={on} onClick={() => onHighlight(on ? null : r.pid)}
                    className={`cursor-pointer ${on ? 'bg-brand-subtle' : 'hover:bg-n-50'}`}>
                  <th scope="row" className={`sticky left-0 border-b border-n-200 px-1.5 py-0.5 text-left font-normal ${on ? 'bg-brand-subtle' : 'bg-n-0'}`}>
                    <button type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onHighlight(on ? null : r.pid); }}
                            title={on ? '강조 해제' : '모든 칸에서 이 PID 강조'}
                            className={`h-6 rounded-sm px-1.5 font-mono transition-colors duration-150 ease-out
                              ${on ? 'font-medium text-brand' : 'text-n-900 hover:bg-n-100'}`}>
                      {r.pid}
                    </button>
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={models[i].id}
                        className={`border-b border-l border-n-200 px-2.5 py-1 ${c?.differs && !on ? 'bg-wait-bg' : ''}`}>
                      {!c ? <span className="text-n-500">…</span> : !c.present ? <span className="text-n-500">없음</span> : (
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className={`font-mono ${c.differs ? 'font-medium text-n-900' : 'text-n-800'}`}>{c.text}</span>
                          {c.mid != null && <span className="text-n-600">재료 <span className="font-mono">{c.mid}</span></span>}
                          {c.approx && <span className="text-micro text-n-500">근사</span>}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * 비교 패널(07 §3) — 아래 접이식, 탭 2개(특성 비교표 · 속성 차이), 위 가장자리를 끌어 높이를 바꾼다.
 * models = [{ id, name, hull, summary, pidCount, groupCount, properties }]
 */
export default function ComparePanel({ models, baseline, onBaseline, highlightPid, onHighlight, maxHeight = 600 }) {
  const [tab, setTab] = useState('traits');
  const [panel, setPanel] = useState(readPanel);
  const panelId = useId();
  const dragRef = useRef(null);
  useEffect(() => { writePanel(panel); }, [panel]);
  const height = Math.min(Math.max(panel.height, MIN_H), Math.max(maxHeight, MIN_H));

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { y: e.clientY, h: height };
    const move = (ev) => {
      const d = dragRef.current;
      if (d) setPanel((p) => ({ ...p, open: true, height: Math.round(d.h - (ev.clientY - d.y)) }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onSepKey = (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowUp') { e.preventDefault(); setPanel((p) => ({ ...p, open: true, height: height + step })); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setPanel((p) => ({ ...p, height: Math.max(MIN_H, height - step) })); }
  };

  const changed = useMemo(() => propertyDiffRows(models).changed, [models]);
  const tabs = TABS.map((t) => (t.id === 'props' ? { ...t, count: changed || null } : t));

  return (
    <section aria-label="비교 패널" className="relative flex shrink-0 flex-col border-t border-n-200 bg-n-0"
             style={panel.open ? { height } : undefined}>
      {panel.open && (
        <div role="separator" aria-orientation="horizontal" aria-label="비교 패널 높이" tabIndex={0}
             aria-valuenow={height} aria-valuemin={MIN_H} aria-valuemax={maxHeight}
             onPointerDown={onPointerDown} onKeyDown={onSepKey}
             className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none hover:bg-n-200 focus-visible:bg-brand-ring" />
      )}
      <div className="relative shrink-0 px-4">
        <Tabs label="비교 패널" items={tabs} value={tab} controls={panelId} className="pr-24"
              onChange={(t) => { setTab(t); if (!panel.open) setPanel((p) => ({ ...p, open: true })); }} />
        <Button variant="ghost" size="sm" className="absolute right-2 top-1" aria-expanded={panel.open} aria-controls={panelId}
                onClick={() => setPanel((p) => ({ ...p, open: !p.open }))}>
          {panel.open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
          {panel.open ? '접기' : '펼치기'}
        </Button>
      </div>
      {panel.open && (
        <div id={panelId} role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          {tab === 'traits'
            ? <TraitsTable models={models} baseline={baseline} onBaseline={onBaseline} />
            : <PropsTable models={models} baseline={baseline} onBaseline={onBaseline} highlightPid={highlightPid} onHighlight={onHighlight} />}
        </div>
      )}
    </section>
  );
}
