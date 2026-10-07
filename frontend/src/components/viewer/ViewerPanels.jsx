import { Focus, LocateFixed } from 'lucide-react';
import { beamOrientInfo, elementInfo, nodeInfo, rigidInfo, sectionLabel } from '../../lib/elementInfo.js';
import { NODE_CLASS_KEYS, NODE_CLASS_LABELS, nodesOfClass } from '../../lib/nodeCheck.js';
import { NODE_CLASS_COLORS, groupColor } from '../../lib/pidPalette.js';
import Button from '../ui/Button.jsx';

const num = (n) => Number(n).toLocaleString('ko-KR');
/** 행 hover·포커스 때만 보이는 부차 동작(DESIGN §목록과 표). 터치에서는 늘 보인다. */
const reveal = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';

/** 목록 머리 — 제목 + 개수 + 모두 보이기/숨기기. */
function ListHead({ title, count, onAll, noneHidden, allHidden, ready }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-n-200 px-3">
      <h3 className="text-ui font-semibold text-n-700">{title}</h3>
      {ready && <span className="font-mono text-meta text-n-500">{num(count)}</span>}
      <div className="ml-auto flex items-center">
        <Button variant="ghost" size="sm" className="px-1.5" disabled={!ready || noneHidden} onClick={() => onAll(true)}>
          모두 보이기
        </Button>
        <Button variant="ghost" size="sm" className="px-1.5" disabled={!ready || allHidden} onClick={() => onAll(false)}>
          모두 숨기기
        </Button>
      </div>
    </div>
  );
}

/** PID 목록 — 색 칸 · PID · 단면 · 요소 수, 보이기/숨기기. */
export function PidList({ v, showHead = true }) {
  const groups = v.model?.geometry.groups || [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHead && (
        <ListHead title="PID" count={groups.length} ready={v.ready} onAll={v.setAllPids}
                  noneHidden={v.hidden.size === 0} allHidden={v.hidden.size === groups.length} />
      )}
      {v.ready && (
        <ul role="list" aria-label="PID" className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.map((g) => {
            const label = sectionLabel(v.model.lbm.header.properties?.[g.pid]);
            const on = !v.hidden.has(g.pid);
            return (
              <li key={g.pid}>
                <label title={label || undefined}
                       className="flex h-8 cursor-pointer items-center gap-2 px-3 text-meta hover:bg-n-50">
                  <input type="checkbox" checked={on} onChange={() => v.toggleGroup(g.pid)} aria-label={`PID ${g.pid} 표시`}
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
  );
}

/** 연결 그룹 목록 — 색 칸 · 요소·절점 수 · 보이기/숨기기 · 이 그룹만 보기 · 그룹으로 이동. */
export function GroupList({ v, showHead = true }) {
  const groups = v.model?.groups.groups || [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHead && (
        <ListHead title="그룹" count={groups.length} ready={v.ready} onAll={v.setAllConnGroups}
                  noneHidden={v.groupHidden.size === 0} allHidden={v.groupHidden.size === groups.length} />
      )}
      {v.ready && (groups.length === 0 ? (
        <p className="px-3 py-3 text-meta text-n-500">요소가 없어 그룹이 없습니다</p>
      ) : (
        <ul role="list" aria-label="그룹" className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.map((g) => {
            const on = !v.groupHidden.has(g.index);
            const name = `그룹 ${g.index + 1}`;
            return (
              <li key={g.index} className="group flex h-11 items-center gap-2 px-3 hover:bg-n-50">
                <input type="checkbox" checked={on} onChange={() => v.toggleConnGroup(g.index)} aria-label={`${name} 표시`}
                       className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand" />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-xs"
                      style={{ background: groupColor(g.index), opacity: on ? 1 : 0.35 }} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-meta ${on ? 'text-n-900' : 'text-n-500'}`}>
                    {name}{g.index === 0 && groups.length > 1 && <span className="ml-1.5 text-n-500">주 구조</span>}
                  </p>
                  <p className="tnum truncate text-micro text-n-500">
                    요소 {num(g.elements)} · 절점 {num(g.nodes)}{g.rigids > 0 && ` · RBE ${num(g.rigids)}`}
                  </p>
                </div>
                <div className={`flex shrink-0 items-center ${reveal}`}>
                  <Button variant="ghost" size="icon-sm" onClick={() => v.soloConnGroup(g.index)}
                          aria-label={`${name}만 보기`} title="이 그룹만 보기">
                    <Focus size={14} aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => v.frameConnGroup(g.index)}
                          aria-label={`${name}로 이동`} title="그룹으로 이동">
                    <LocateFixed size={14} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

const CLASS_HELP = { shared: '요소 2개 이상 또는 RBE', free: '요소 1개에만 연결', orphan: '연결된 요소 없음' };
const PREVIEW_IDS = 12;

/** 절점 점검 — 절점 표시, 분류별 보이기·개수, 자유단·고립 앞쪽 ID(누르면 그 절점으로). */
export function NodeCheck({ v }) {
  const check = v.model?.check;
  if (!check) return null;
  const ids = v.model.lbm.blocks.node_ids;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-8 cursor-pointer items-center gap-2 text-ui text-n-800">
        <input type="checkbox" checked={v.nodes.visible} onChange={() => v.setNodes({ visible: !v.nodes.visible })}
               className="h-3.5 w-3.5 cursor-pointer accent-brand" />
        절점 표시
        <kbd className="ml-auto rounded-sm bg-n-100 px-1.5 font-mono text-micro text-n-600">N</kbd>
      </label>
      <ul role="list" aria-label="절점 점검" className="flex flex-col">
        {NODE_CLASS_KEYS.map((key, c) => {
          const count = check.counts[key];
          const on = v.nodes.classes[c];
          const list = c === 0 || count === 0 ? [] : nodesOfClass(check, c, PREVIEW_IDS);
          return (
            <li key={key} className="flex flex-col gap-1 border-t border-n-200 py-2 first:border-t-0">
              <label className="flex cursor-pointer items-center gap-2 text-meta">
                <input type="checkbox" checked={on} disabled={!v.nodes.visible}
                       onChange={() => v.setNodes({ classes: v.nodes.classes.map((x, i) => (i === c ? !x : x)) })}
                       aria-label={`${NODE_CLASS_LABELS[key]} 절점 표시`}
                       className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed" />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-n-300"
                      style={{ background: NODE_CLASS_COLORS[c] }} />
                <span className="text-n-900">{NODE_CLASS_LABELS[key]}</span>
                <span className="min-w-0 flex-1 truncate text-n-500">{CLASS_HELP[key]}</span>
                <span className="shrink-0 font-mono text-n-700">{num(count)}</span>
              </label>
              {list.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-[42px]">
                  {list.map((n) => (
                    <button key={n} type="button" onClick={() => v.select({ kind: 'node', index: n }, { frame: true })}
                            title="이 절점으로 이동"
                            className={`h-6 rounded-sm px-1.5 font-mono text-micro transition-colors duration-150 ease-out
                              ${v.selection?.kind === 'node' && v.selection.index === n
                                ? 'bg-brand-subtle text-brand' : 'bg-n-50 text-n-700 hover:bg-n-100 hover:text-n-900'}`}>
                      {ids[n]}
                    </button>
                  ))}
                  {count > list.length && <span className="self-center text-micro text-n-500">외 {num(count - list.length)}개</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 정의 목록(왼쪽 라벨 · 오른쪽 값). */
function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1 text-meta">
      {rows.filter(Boolean).map(([k, val, mono]) => (
        <div key={k} className="contents">
          <dt className="text-n-500">{k}</dt>
          <dd className={`min-w-0 break-words text-n-900 ${mono ? 'font-mono' : ''}`}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

const fmtLen = (n) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

/** 선택 정보 — 요소·절점·RBE. 비었으면 안내 한 줄. */
export function SelectionInfo({ v }) {
  const sel = v.selection;
  const m = v.model;
  if (!sel || !m) return <p className="text-meta text-n-500">요소를 누르면 정보가 보입니다</p>;
  if (sel.kind === 'node') {
    const info = nodeInfo(m.lbm, m.geometry, sel.index, { check: m.check, groups: m.groups });
    return (
      <Rows rows={[
        ['절점', info.id, true],
        ['좌표', info.xyz.map(fmtLen).join(', '), true],
        ['연결', `요소 ${num(info.degree)}개`],
        ['점검', NODE_CLASS_LABELS[NODE_CLASS_KEYS[info.cls]]],
        ['그룹', info.group >= 0 ? `그룹 ${info.group + 1}` : '없음'],
        info.spc != null && ['SPC', info.spc, true],
        info.mass != null && ['CONM2', info.mass, true],
      ]} />
    );
  }
  if (sel.kind === 'rbe') {
    const info = rigidInfo(m.lbm, m.rigids, sel.index);
    const shown = info.others.slice(0, 24);
    return (
      <Rows rows={[
        ['EID', info.eid, true],
        ['카드', info.card, true],
        [info.card === 'RBE3' ? '기준' : '독립', info.center, true],
        [info.card === 'RBE3' ? '연결' : '종속', `${num(info.others.length)}개`],
        ['절점', `${shown.join(', ')}${info.others.length > shown.length ? ' …' : ''}`, true],
      ]} />
    );
  }
  const info = elementInfo(m.lbm, m.geometry, sel.index);
  const orient = beamOrientInfo(m.lbm, m.geometry, sel.index);
  const g = m.groups.elemGroup[sel.index];
  return (
    <Rows rows={[
      ['EID', info.eid, true],
      ['카드', info.card, true],
      ['PID', info.pid, true],
      ['단면', info.section || '—', true],
      info.thickness != null && ['두께', info.thickness, true],
      ['재료', info.material || '—', true],
      ['절점', info.nodes.join(', '), true],
      info.length != null && ['길이', fmtLen(info.length), true],
      orient?.v && ['방향 v', orient.v, true],
      orient?.offset && ['오프셋', orient.offset, true],
      ['그룹', `그룹 ${g + 1}`],
    ]} />
  );
}

/** 선택 종류별 제목. */
export function selectionTitle(sel) {
  if (!sel) return '선택 요소';
  return sel.kind === 'node' ? '선택 절점' : sel.kind === 'rbe' ? '선택 RBE' : '선택 요소';
}
