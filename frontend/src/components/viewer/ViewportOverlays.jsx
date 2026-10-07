import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FlipHorizontal2, Focus, Keyboard, Scan, Scissors, Search, X } from 'lucide-react';
import { legendItems } from '../../lib/legend.js';
import { NODE_CLASS_KEYS, NODE_CLASS_LABELS } from '../../lib/nodeCheck.js';
import { NODE_CLASS_COLORS } from '../../lib/pidPalette.js';
import { VIEW_PRESETS } from '../../lib/viewFrame.js';

const num = (n) => Number(n).toLocaleString('ko-KR');
const VIEW_ITEMS = Object.entries(VIEW_PRESETS).map(([id, p]) => ({ id, label: p.label, keys: p.keys }));
export const RENDER_ITEMS = [{ id: 'line', label: '선' }, { id: 'section', label: '3D 단면' }];
const PROJECTION_ITEMS = [{ id: 'ortho', label: '직교' }, { id: 'persp', label: '원근' }];

/** 어두운 뷰포트 위의 단추. pressed 가 있으면 켜고 끄는 단추. */
export function VButton({ pressed, onClick, title, label, icon: Icon, children, disabled = false, keys }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={label} aria-pressed={pressed}
            aria-keyshortcuts={keys} disabled={disabled}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-meta font-medium
              transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:text-on-viewer-subtle disabled:hover:bg-transparent
              ${pressed ? 'bg-viewer-active text-on-viewer' : 'text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer active:bg-viewer-active'}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {/* 좁은 뷰포트(도크를 연 1366 등)에서는 글자를 접고 아이콘만 — 이름은 화면 읽기에 남는다. */}
      {children && <span className={Icon ? '@max-[820px]:sr-only' : ''}>{children}</span>}
    </button>
  );
}

/** 어두운 세그먼트(값 전환). */
export function VSegmented({ items, value, onChange, label, disabled = false }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5">
      {items.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={t.id === value} disabled={disabled}
                onClick={() => onChange(t.id)} title={t.keys ? `${t.label} (${t.keys.map((k) => k.toUpperCase()).join('·')})` : undefined}
                className={`h-7 whitespace-nowrap rounded-[5px] px-2 text-meta font-medium transition-colors duration-150 ease-out
                  disabled:cursor-not-allowed disabled:text-on-viewer-subtle
                  ${t.id === value ? 'bg-viewer-active text-on-viewer' : 'text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const Sep = () => <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-viewer-line" />;

/** 뷰포트 왼쪽 위 도구줄(전체 화면) — 시점 · 맞춤 · 투영 · 표시 방식 · 자르기 · 찾기 · 선택만 보기 · 단축키. */
export function ViewportToolbar({ v, helpOpen, onHelp }) {
  const ready = v.ready;
  return (
    <div role="toolbar" aria-label="뷰 도구"
         className="flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-viewer-line bg-viewer-raised p-0.5 shadow-md">
      <VSegmented label="시점" items={VIEW_ITEMS} value={v.view} onChange={v.changeView} disabled={!ready} />
      <Sep />
      <VButton onClick={v.fit} title="화면 맞춤 (F)" keys="F" icon={Scan} disabled={!ready}>맞춤</VButton>
      <Sep />
      <VSegmented label="투영" items={PROJECTION_ITEMS} value={v.projection} onChange={v.setProjection} disabled={!ready} />
      <Sep />
      <VSegmented label="표시 방식" items={RENDER_ITEMS} value={v.renderMode} onChange={v.setRenderMode} disabled={!ready} />
      <Sep />
      <VButton pressed={v.clip.on} onClick={() => v.setClip({ on: !v.clip.on })} title="축 평면으로 자르기" icon={Scissors} disabled={!ready}>
        자르기
      </VButton>
      <VButton pressed={!!v.findOpen} onClick={() => v.setFindOpen(v.findOpen ? 0 : 1)} title="ID 로 찾기 (Ctrl+F)" keys="Control+F"
               icon={Search} disabled={!ready}>
        찾기
      </VButton>
      <VButton pressed={v.isolated} onClick={() => v.setIsolate(!v.isolated)} icon={Focus} disabled={!ready || !v.selection}
               title={v.selection ? '선택한 것만 보기' : '먼저 요소나 절점을 누르세요'}>
        선택만 보기
      </VButton>
      <Sep />
      <VButton pressed={helpOpen} onClick={onHelp} label="단축키" title="단축키 (?)" icon={Keyboard} />
    </div>
  );
}

const AXES = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }];

/** 축 평면 자르기 — 축 · 위치 · 뒤집기. 위치는 모델 범위 안 비율(0~100%). */
export function ClipPanel({ v, className = '' }) {
  // ⚠ 좌표 표시는 원래 모델 좌표(뷰어 좌표 + 중심)
  const b = v.model?.geometry.bounds;
  const c = v.model?.geometry.center;
  const k = { x: 0, y: 1, z: 2 }[v.clip.axis];
  const coord = b && c ? c[k] + b.min[k] + (b.max[k] - b.min[k]) * v.clip.position : null;
  return (
    <div role="group" aria-label="자르기"
         className={`flex w-[300px] flex-col gap-2 rounded-lg border border-viewer-line bg-viewer-raised p-2.5 text-meta text-on-viewer shadow-md ${className}`}>
      <div className="flex items-center gap-2">
        <span className="font-medium">자르기</span>
        <VSegmented label="자르는 축" items={AXES} value={v.clip.axis} onChange={(axis) => v.setClip({ axis })} />
        <span className="ml-auto" />
        <VButton pressed={v.clip.flip} onClick={() => v.setClip({ flip: !v.clip.flip })} icon={FlipHorizontal2}
                 title="남기는 쪽 뒤집기">뒤집기</VButton>
        <button type="button" onClick={() => v.setClip({ on: false })} aria-label="자르기 끄기" title="끄기"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min="0" max="1000" step="1" value={Math.round(v.clip.position * 1000)}
               onChange={(e) => v.setClip({ position: Number(e.target.value) / 1000 })}
               aria-label={`${v.clip.axis.toUpperCase()} 자르기 위치`}
               className="h-1 min-w-0 flex-1 cursor-pointer accent-link-on-dark" />
        <span className="w-20 shrink-0 text-right font-mono text-on-viewer-muted">
          {coord != null ? `${v.clip.axis.toUpperCase()} ${num(Math.round(coord))}` : ''}
        </span>
      </div>
      <p className="text-micro text-on-viewer-subtle">
        {v.clip.flip ? `${v.clip.axis.toUpperCase()} 가 이 위치보다 큰 쪽을 남깁니다` : `${v.clip.axis.toUpperCase()} 가 이 위치보다 작은 쪽을 남깁니다`}
      </p>
    </div>
  );
}

const SHORTCUTS = [
  ['F', '화면 맞춤'], ['A', '평면'], ['S', '정면'], ['D', '측면'], ['I', '등각'], ['1 · 2 · 3', '정면 · 측면 · 평면'],
  ['E', '경계선'], ['N', '절점'], ['P', '직교 · 원근'], ['Ctrl F', 'ID 찾기'], ['Esc', '선택 해제'], ['?', '이 도움말'],
];
const MOUSE = [['왼쪽 끌기', '회전'], ['오른쪽 끌기', '이동'], ['휠 · 가운데', '확대'], ['누르기', '요소·절점·RBE 선택']];

/** 단축키 도움말 — 도구줄 아래 팝오버. */
export function ShortcutHelp({ onClose }) {
  return (
    <div role="dialog" aria-label="단축키"
         className="w-[320px] animate-pop rounded-lg border border-viewer-line bg-viewer-raised p-3 text-meta text-on-viewer shadow-lg">
      <div className="mb-2 flex items-center">
        <h3 className="text-ui font-semibold">단축키</h3>
        <button type="button" onClick={onClose} aria-label="단축키 닫기"
                className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="contents">
            <dt><kbd className="rounded-sm bg-viewer px-1.5 font-mono text-micro text-on-viewer-muted">{k}</kbd></dt>
            <dd className="text-on-viewer-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <div className="my-2 h-px bg-viewer-line" />
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1">
        {MOUSE.map(([k, d]) => (
          <div key={k} className="contents">
            <dt className="text-on-viewer-subtle">{k}</dt>
            <dd className="text-on-viewer-muted">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const LEGEND_KEY = 'lb.viewer.legend.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; } };

/** 범례(오른쪽 아래) — 색 기준 항목·개수, 숨긴 항목은 취소선 + '숨김' 글자. 절점이 켜져 있으면 절점 분류도. */
export function ViewportLegend({ v }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const m = v.model;
  const legend = useMemo(() => (m ? legendItems({
    mode: v.colorMode, table: m.table, elemGroup: m.groups.elemGroup, groupCount: m.groups.count,
    hiddenPids: v.hidden, hiddenGroups: v.groupHidden,
  }) : null), [m, v.colorMode, v.hidden, v.groupHidden]);
  // 선택만 보기 중에는 색 기준 범례가 뜻이 없다(그 대상만 남는다).
  if (!legend || v.isolated || (!legend.items.length && !v.nodes.visible)) return null;
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(LEGEND_KEY, c ? '0' : '1'); } catch { /* 저장 못 해도 그만 */ }
    return !c;
  });
  return (
    <div role="group" aria-label="범례"
         className="absolute bottom-3 right-3 z-10 w-[208px] rounded-lg border border-viewer-line bg-viewer-raised px-2.5 py-2 text-meta text-on-viewer-muted shadow-md">
      <button type="button" onClick={toggle} aria-expanded={!collapsed}
              className="flex w-full items-center gap-1 rounded-sm text-left font-medium text-on-viewer">
        {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        {legend.title}
      </button>
      {!collapsed && (
        <ul role="list" className="mt-1.5 flex max-h-[min(34vh,280px)] flex-col gap-0.5 overflow-y-auto">
          {legend.items.map((it) => (
            <li key={it.key} className="flex h-5 items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-xs"
                    style={{ background: it.color, opacity: it.hidden ? 0.3 : 1 }} />
              <span className={`min-w-0 flex-1 truncate ${it.hidden ? 'text-on-viewer-subtle line-through' : ''}`}>{it.label}</span>
              {it.hidden && <span className="shrink-0 text-micro text-on-viewer-subtle">숨김</span>}
              <span className="shrink-0 font-mono text-on-viewer-subtle">{num(it.count)}</span>
            </li>
          ))}
          {legend.rest && (
            <li className="flex h-5 items-center pl-[18px] text-on-viewer-subtle">
              외 {num(legend.rest.count)}개 · 요소 {num(legend.rest.elements)}
            </li>
          )}
          {v.nodes.visible && (
            <>
              <li aria-hidden="true" className="my-1 h-px shrink-0 bg-viewer-line" />
              {NODE_CLASS_KEYS.map((key, c) => {
                const off = !v.nodes.classes[c];
                return (
                  <li key={key} className="flex h-5 items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: NODE_CLASS_COLORS[c], opacity: off ? 0.3 : 1 }} />
                    <span className={`min-w-0 flex-1 truncate ${off ? 'text-on-viewer-subtle line-through' : ''}`}>
                      {NODE_CLASS_LABELS[key]} 절점
                    </span>
                    {off && <span className="shrink-0 text-micro text-on-viewer-subtle">숨김</span>}
                    <span className="shrink-0 font-mono text-on-viewer-subtle">{num(m.check.counts[key])}</span>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

/** 3D 단면을 만드는 동안 — 진행률 막대. 300ms 안에 끝나면 보이지 않는다(appear-late). */
export function SectionProgress({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  return (
    <div role="status" className="appear-late pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2">
      <span className="rounded-md bg-viewer-raised px-2 py-0.5 text-meta text-on-viewer-muted">단면 만드는 중 {pct}%</span>
      <div aria-hidden="true" className="h-0.5 w-48 overflow-hidden rounded-full bg-viewer-line">
        <div className="h-full bg-link-on-dark" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** v1 파일 + 3D 단면 — 방향 벡터가 없어 단면 회전이 임의라는 조용한 한 줄. */
export function OrientationNote({ v, className = '' }) {
  const show = v.ready && v.renderMode === 'section' && v.model?.beams > 0 && (v.model.version < 2 || !v.model.orient);
  if (!show) return null;
  return <p className={`text-meta text-on-viewer-subtle ${className}`}>다시 변환하면 단면 방향이 정확해집니다</p>;
}
