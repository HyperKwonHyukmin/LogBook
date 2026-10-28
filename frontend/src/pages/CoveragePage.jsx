import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Grid2x2Check } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { RowChip, SolveText, fileText } from '../components/coverage/FixList.jsx';
import { errorText } from '../lib/labels.js';
import { titleWithoutHull } from '../lib/similar.js';
import {
  buildGrid, cellKey, cellSentence, COL_AXES, DEFAULT_AXES, headerLines, ROW_AXES, sortRows, STATE_INFO, STATES, todoCells,
} from '../lib/coverage.js';

// 44 — 행 순서: 기본은 행 기준의 자연 순서(호선 번호 · 호선 많은 선종 먼저)
const sortsFor = (grid) => [
  { id: 'hull', label: grid.axes.rows === 'hull' ? '호선 번호' : '호선 많은 순' },
  { id: 'recent', label: '최근 확정' },
  { id: 'gaps', label: `빈 ${grid.colLabel} 많은 순` },
];
const axisOf = (list, v, d) => (list.some((a) => a.id === v) ? v : d);

function Swatch({ state }) {
  return <span aria-hidden="true" className={`cov-cell cov-${state}`} style={{ width: 22, height: 16 }} />;
}

// 옆에 호선 칩이 있는 자리에서는 제목 머리의 같은 호선을 뺀다
const shortTitle = (e) => titleWithoutHull(e.title, (e.rows || []).filter((k) => k.startsWith('h:')).map((k) => k.slice(2)));

function EntryLine({ e }) {
  return (
    <div className="border-t border-n-100 py-2.5 first:border-t-0">
      <Link to={`/e/${e.id}`} className="text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">{shortTitle(e)}</Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-600">
        <span className="font-mono">{e.id}</span><span>{fileText(e)}</span><SolveText solve={e.solve} />
      </div>
      <div className="mt-0.5 text-meta text-n-600">
        <span title={e.uploaded_by || undefined}>{e.uploader_name || e.uploaded_by || '작성자 모름'}</span>
        {e.confirmed_at && <> · <span className="font-mono">{e.confirmed_at}</span></>}
        {e.doc_linked && ' · 다른 자료의 문서가 이 모델을 씀'}
        {e.model_linked && ' · 다른 자료의 모델과 연결됨'}
      </div>
    </div>
  );
}

/**
 * 갖춤 현황(26, `/coverage`) — 확정 자료를 행 × 열 칸에 놓고, 칸마다 무엇을 갖췄는지 보인다.
 * 44 — 행 기준(호선 · 선종 · 크기급) × 열 기준(구역 · 대상)을 고른다(주소 ?rows=kind&cols=target, 기본 호선 × 구역).
 * 칸 상태·목록은 lib/coverage.js(순수 함수). 42 — 해석 종류 거르기는 없앴다.
 */
export default function CoveragePage() {
  const [params, setParams] = useSearchParams();
  const axes = { rows: axisOf(ROW_AXES, params.get('rows'), DEFAULT_AXES.rows), cols: axisOf(COL_AXES, params.get('cols'), DEFAULT_AXES.cols) };
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('hull');
  const [focus, setFocus] = useState(null);     // 범례로 고른 상태만 남기기
  const [sel, setSel] = useState(null);         // { rowKey, colKey }
  const [tip, setTip] = useState(null);         // { x, y, text }
  const [cursor, setCursor] = useState(null);   // 방향키 이동 위치(행·열 번호)
  const gridRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api('/coverage').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '갖춤 현황을 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const grid = useMemo(() => (data ? buildGrid(data, axes) : null), [data, axes.rows, axes.cols]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (grid ? sortRows(grid, data, sort) : []), [grid, data, sort]);
  const selRow = grid && sel ? grid.rows.find((r) => r.key === sel.rowKey) : null;
  const selCol = grid && sel ? grid.cols.find((c) => c.key === sel.colKey) : null;
  const selCell = selRow && selCol ? grid.cells.get(cellKey(selRow.key, selCol.key)) : null;
  const todos = useMemo(() => (grid ? todoCells(grid) : []), [grid]);

  if (error) return <div className="px-6 py-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!grid) return <div className="px-6 py-6"><RowsSkeleton rows={8} /></div>;
  if (!data.entries.length) {
    return (
      <div className="px-6 py-6">
        <EmptyState icon={Grid2x2Check} title="확정한 자료가 아직 없습니다">자료를 올려 확정하면 호선과 구역별로 칸이 채워집니다.</EmptyState>
      </div>
    );
  }

  const pick = (rowKey, colKey) => { setSel({ rowKey, colKey }); setTip(null); };
  // 기준을 바꾸면 고른 칸 · 칸 거르기 · 방향키 위치를 푼다(범례 상태 거르기는 그대로)
  const setAxis = (key, v) => {
    const next = new URLSearchParams(params);
    if (v === DEFAULT_AXES[key]) next.delete(key); else next.set(key, v);
    setParams(next, { replace: true });
    setSel(null); setCursor(null); setTip(null);
  };
  const { rowLabel, colLabel } = grid;
  const showTip = (el, r, c, cell) => {
    const b = el.getBoundingClientRect();
    setTip({ x: b.right + 8, y: b.bottom + 6, s: cellSentence(r, c, cell) });
  };
  const moveFocus = (ri, ci) => {
    const nr = Math.max(0, Math.min(rows.length - 1, ri));
    const nc = Math.max(0, Math.min(grid.cols.length - 1, ci));
    setCursor({ r: nr, c: nc });
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-pos="${nr}:${nc}"]`)?.focus());
  };
  const cur = cursor || { r: 0, c: 0 };

  return (
    <div className="px-6 pb-10 pt-5 min-[1441px]:px-8">
      <header className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-n-200 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">갖춤 현황</h1>
          <p className="mt-1 text-ui text-n-600">{rowLabel} × {colLabel} 칸마다 확정 자료가 무엇을 갖췄는지 봅니다. 칸에 올리거나 포커스하면 이유가 나오고, 누르면 오른쪽에 그 칸의 자료가 열립니다.</p>
        </div>
        <span className="text-ui text-n-600 tabular-nums">
          자료 <b className="font-semibold text-n-900">{data.entries.length}</b> · {rowLabel} <b className="font-semibold text-n-900">{grid.rows.length}</b> · {colLabel} <b className="font-semibold text-n-900">{grid.cols.length}</b>
          {data.truncated && ' · 최근 확정 자료만 셌습니다'}
        </span>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-n-600">행 기준</span>
          <Segmented label="행 기준" items={ROW_AXES} value={axes.rows} onChange={(v) => setAxis('rows', v)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-n-600">열 기준</span>
          <Segmented label="열 기준" items={COL_AXES} value={axes.cols} onChange={(v) => setAxis('cols', v)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-n-600">행 순서</span>
          <Segmented label="행 순서" items={sortsFor(grid)} value={sort} onChange={setSort} />
        </div>
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="칸 상태 — 누르면 그 상태 칸만 남깁니다">
        <span className="mr-1 text-meta text-n-600">칸 수 · 누르면 그 상태만</span>
        {STATES.map((s) => (
          <button key={s} type="button" aria-pressed={focus === s} onClick={() => setFocus(focus === s ? null : s)}
                  className={`inline-flex h-[30px] items-center gap-2 rounded-md border px-2.5 pl-1.5 text-ui transition-colors duration-150 ease-out hover:bg-n-50
                    ${focus === s ? 'border-n-900 bg-n-50' : 'border-n-200 bg-n-0'}`}>
            <Swatch state={s} />{STATE_INFO[s].name} <b className="font-mono font-medium">{grid.counts[s]}</b><span className="text-meta text-n-600">칸</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div ref={gridRef} className={`max-h-[min(640px,calc(100vh-290px))] min-h-[320px] overflow-auto rounded-lg border border-n-200 ${focus ? 'cov-dim' : ''}`}>
            <table role="grid" aria-label={`${rowLabel}별 ${colLabel} 자료 현황`} className="border-separate border-spacing-0 text-ui">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-30 min-w-[138px] border-b border-r border-n-200 bg-n-50 px-2.5 pb-2 text-left align-bottom text-meta font-medium text-n-600">
                    {rowLabel}<br /><span className="font-normal">채운 {colLabel}</span>
                  </th>
                  {grid.cols.map((c) => (
                    <th key={c.key} scope="col" title={c.label}
                        className={`sticky top-0 z-20 w-[45px] min-w-[45px] max-w-[45px] border-b border-n-200 px-px pb-1.5 pt-2 text-center align-bottom text-meta font-medium leading-tight
                          ${sel?.colKey === c.key ? 'bg-n-100 text-n-900' : 'bg-n-50 text-n-700'}`}>
                      <span className="block">{headerLines(c.label).map((l, k) => <span key={k} className={`block ${/[가-힣]/.test(l) ? 'whitespace-nowrap' : 'break-all'}`}>{l}</span>)}</span>
                      <span className="mx-[7px] mt-1.5 block h-[3px] overflow-hidden rounded-full bg-n-150" aria-hidden="true">
                        <span className="block h-full bg-n-400" style={{ width: `${(grid.colFilled.get(c.key) / grid.rows.length) * 100}%` }} />
                      </span>
                      <span className="mt-0.5 block font-mono text-meta text-n-600" title={`이 ${colLabel}에 자료가 있는 행 수`}>{grid.colFilled.get(c.key)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={r.key} className="group">
                    <th scope="row" className={`sticky left-0 z-10 border-r border-n-200 px-2.5 text-left font-normal group-hover:bg-n-50 ${sel?.rowKey === r.key ? 'bg-n-50' : 'bg-n-0'}`}>
                      <div className="flex h-[34px] items-center gap-2">
                        <RowChip row={r} />
                        <span className="truncate text-meta text-n-600">{r.sub}</span>
                        <span className="ml-auto font-mono text-meta text-n-600" title={`자료가 있는 ${colLabel} 수`}>{grid.rowFilled.get(r.key)}/{grid.cols.length}</span>
                      </div>
                    </th>
                    {grid.cols.map((c, ci) => {
                      const cell = grid.cells.get(cellKey(r.key, c.key));
                      const isSel = sel?.rowKey === r.key && sel?.colKey === c.key;
                      const on = focus ? focus === cell.state : true;
                      const s = cellSentence(r, c, cell);
                      const label = `${s.title}: ${s.state}${cell.entries.length ? `, 자료 ${cell.entries.length}건` : ''}`;
                      const cls = `cov-cell cov-${cell.state} ${on ? 'cov-on' : ''} ${isSel ? 'cov-sel' : ''}`;
                      return (
                        <td key={c.key} className="border-b border-n-100 p-1 text-center">
                          <button type="button" className={cls} aria-label={label} data-pos={`${ri}:${ci}`}
                                  tabIndex={cur.r === ri && cur.c === ci ? 0 : -1}
                                  onClick={() => { setCursor({ r: ri, c: ci }); pick(r.key, c.key); }}
                                  onMouseEnter={(ev) => showTip(ev.currentTarget, r, c, cell)} onMouseLeave={() => setTip(null)}
                                  onFocus={(ev) => showTip(ev.currentTarget, r, c, cell)} onBlur={() => setTip(null)}
                                  onKeyDown={(ev) => {
                                    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[ev.key];
                                    if (mv) { ev.preventDefault(); moveFocus(ri + mv[0], ci + mv[1]); }
                                    if (ev.key === 'Escape') setTip(null);
                                  }}>
                            {cell.entries.length || ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-3 text-meta text-n-600">
            <span>칸 안 숫자 = 자료 수 · 열 머리 숫자 = 자료가 있는 행 수</span>
            <span>방향키로 칸을 옮기고 Enter 로 엽니다</span>
          </div>

        </div>

        <aside aria-label="칸 상세" aria-live="polite"
               className="rounded-lg border border-n-200 p-4 min-[1180px]:sticky min-[1180px]:top-4 min-[1180px]:max-h-[calc(100vh-100px)] min-[1180px]:overflow-auto">
          {selCell ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex flex-wrap items-center gap-2 text-body font-semibold text-n-900"><RowChip row={selRow} />{selCol.label}</h2>
                <Button variant="ghost" size="sm" onClick={() => setSel(null)}>닫기</Button>
              </div>
              <p className="text-meta text-n-600">{selRow.sub}</p>
              <p className="my-3 rounded-md bg-n-50 px-3 py-2.5 text-ui text-n-700">
                <b className="font-semibold">{STATE_INFO[selCell.state].name}</b>. {STATE_INFO[selCell.state].desc}.
                {selCell.linkedOnly && ' 문서가 다른 자료의 모델과 연결되어 있어 갖춤으로 셉니다.'}
              </p>
              {selCell.entries.length ? (
                <>
                  <h3 className="text-ui font-semibold text-n-800">이 칸의 자료 {selCell.entries.length}건</h3>
                  {selCell.entries.map((e) => <EntryLine key={e.id} e={e} />)}
                </>
              ) : (
                <NearBy data={data} grid={grid} row={selRow} col={selCol} />
              )}
            </>
          ) : (
            <>
              <h2 className="text-body font-semibold text-n-900">먼저 볼 칸</h2>
              <p className="text-meta text-n-600">검증 실패 → 문서 없음 순서, 최근 확정한 자료가 있는 칸부터입니다.</p>
              <div className="mt-2.5">
                {todos.slice(0, 9).map((t) => (
                  <button key={`${t.row.key}|${t.col.key}`} type="button" onClick={() => pick(t.row.key, t.col.key)}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded border-t border-n-100 px-1 py-2 text-left hover:bg-n-50">
                    <span className={`cov-cell cov-${t.cell.state}`} style={{ width: 34, height: 22 }}>{t.cell.entries.length}</span>
                    <span><span className="flex items-center gap-1.5 text-ui text-n-900"><RowChip row={t.row} />{t.col.label}</span>
                      <span className="text-meta text-n-600">{t.why}</span></span>
                    <span className="text-meta text-n-600">열기</span>
                  </button>
                ))}
                {!todos.length && <p className="py-4 text-ui text-n-600">손볼 칸이 없습니다.</p>}
              </div>
              {todos.length > 9 && <p className="mt-2 text-meta text-n-600">그 밖에 {todos.length - 9}칸이 더 있습니다.</p>}
              {/* 48 — 손볼 자료 목록(문서 없는 모델 등)은 정리 대기로 옮겼다 */}
              <Link to="/inbox?tab=fix" className="mt-3 inline-block text-meta text-n-600 underline-offset-2 hover:text-brand hover:underline">
                손볼 자료를 자료 단위로 보기 (정리 대기)
              </Link>
            </>
          )}
        </aside>
      </div>

      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-50 max-w-[300px] rounded-md bg-n-900 px-3 py-2 text-ui leading-relaxed text-n-0 shadow-lg"
             style={{ left: Math.min(tip.x, window.innerWidth - 310), top: Math.min(tip.y, window.innerHeight - 100) }}>
          <b className="font-semibold">{tip.s.title}</b><br />{tip.s.state}. {tip.s.desc}{tip.s.parts && <><br />{tip.s.parts}</>}
        </div>
      )}
    </div>
  );
}

/** 빈 칸 — 다른 행의 같은 열(호선 행이면 같은 선종 호선만), 같은 행의 다른 열 자료를 참고로. */
function NearBy({ data, grid, row, col }) {
  const ship = row.kind === 'hull' ? row.sub : null;   // 44 — 선종 · 크기급 행은 이미 묶음이라 같은 선종 거르기를 쓰지 않는다
  const sameCol = data.entries.filter((e) => col.test(e)
    && !grid.keysOf(e).includes(row.key)
    && (!ship || grid.keysOf(e).some((k) => grid.rows.find((r) => r.key === k)?.sub === ship))).slice(0, 4);
  const sameRow = data.entries.filter((e) => grid.keysOf(e).includes(row.key)).slice(0, 4);
  return (
    <>
      <h3 className="text-ui font-semibold text-n-800">참고할 자료 · {ship ? `같은 선종(${ship}) ` : ''}다른 행의 {col.label}</h3>
      {sameCol.length ? sameCol.map((e) => <EntryLine key={e.id} e={e} />) : <p className="py-2 text-meta text-n-600">없습니다.</p>}
      <h3 className="mt-4 text-ui font-semibold text-n-800">참고할 자료 · {row.label}의 다른 {grid.colLabel}</h3>
      {sameRow.length ? sameRow.map((e) => <EntryLine key={e.id} e={e} />) : <p className="py-2 text-meta text-n-600">이 행에는 아직 자료가 없습니다.</p>}
    </>
  );
}
