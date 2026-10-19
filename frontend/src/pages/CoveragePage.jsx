import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Grid2x2Check, X } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { HullChip } from '../components/ui/Status.jsx';
import { Segmented, Tabs } from '../components/ui/Tabs.jsx';
import { errorText } from '../lib/labels.js';
import { titleWithoutHull } from '../lib/similar.js';
import {
  ALL, buildGrid, cellKey, cellSentence, headerLines, LIST_TABS, listRows, rowsOf, sortRows, STATE_INFO, STATES, todoCells, atypesOf,
} from '../lib/coverage.js';

const SORTS = [{ id: 'hull', label: '호선 번호' }, { id: 'recent', label: '최근 확정' }, { id: 'gaps', label: '빈 구역 많은 순' }];
const LIST_LIMIT = 12;

function RowChip({ row }) {
  if (row.kind === 'hull') return <HullChip hull={row.label} />;
  return <span className="inline-flex h-5 items-center rounded-sm bg-n-100 px-1.5 text-meta font-medium text-n-800">{row.label}</span>;
}

function Swatch({ state }) {
  return <span aria-hidden="true" className={`cov-cell cov-${state}`} style={{ width: 22, height: 16 }} />;
}

function SolveText({ solve }) {
  if (solve === 'pass') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" />검증 통과</span>;
  if (solve === 'fail') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-err"><span className="h-1.5 w-1.5 rounded-full bg-err" />검증 실패</span>;
  if (solve === 'none') return <span className="text-meta text-n-600">검증 전</span>;
  return null;
}

// 옆에 호선 칩이 있는 자리에서는 제목 머리의 같은 호선을 뺀다
const shortTitle = (e) => titleWithoutHull(e.title, (e.rows || []).filter((k) => k.startsWith('h:')).map((k) => k.slice(2)));
const fileText = (e) => [e.models ? `BDF ${e.models}` : null, e.reports ? `문서 ${e.reports}` : null].filter(Boolean).join(' · ') || '파일 없음';

function EntryLine({ e }) {
  return (
    <div className="border-t border-n-100 py-2.5 first:border-t-0">
      <Link to={`/e/${e.id}`} className="text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">{shortTitle(e)}</Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-600">
        <span className="font-mono">{e.id}</span><span>{fileText(e)}</span><SolveText solve={e.solve} />
      </div>
      <div className="mt-0.5 text-meta text-n-600">
        <span title={e.uploaded_by || undefined}>{e.uploader_name || e.uploaded_by || '올린 사람 모름'}</span>
        {e.confirmed_at && <> · <span className="font-mono">{e.confirmed_at}</span></>}
        {e.doc_linked && ' · 다른 자료의 문서가 이 모델을 씀'}
        {e.model_linked && ' · 다른 자료의 모델과 연결됨'}
      </div>
    </div>
  );
}

/**
 * 갖춤 현황(26, `/coverage`) — 확정 자료를 호선(·공용) × 구역 칸에 놓고, 칸마다 무엇을 갖췄는지 보인다.
 * 칸 상태·목록은 lib/coverage.js(순수 함수). 해석 종류 거르기는 다시 부르지 않고 그 자리에서 다시 센다.
 */
export default function CoveragePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [atype, setAtype] = useState(ALL);
  const [sort, setSort] = useState('hull');
  const [focus, setFocus] = useState(null);     // 범례로 고른 상태만 남기기
  const [sel, setSel] = useState(null);         // { rowKey, colKey }
  const [tab, setTab] = useState('no_report');
  const [scoped, setScoped] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tip, setTip] = useState(null);         // { x, y, text }
  const [cursor, setCursor] = useState(null);   // 방향키 이동 위치(행·열 번호)
  const gridRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api('/coverage').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '갖춤 현황을 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);

  const grid = useMemo(() => (data ? buildGrid(data, atype) : null), [data, atype]);
  const rows = useMemo(() => (grid ? sortRows(grid, data, sort) : []), [grid, data, sort]);
  const atypes = useMemo(() => (data ? atypesOf(data) : []), [data]);
  const selRow = grid && sel ? grid.rows.find((r) => r.key === sel.rowKey) : null;
  const selCol = grid && sel ? grid.cols.find((c) => c.key === sel.colKey) : null;
  const selCell = selRow && selCol ? grid.cells.get(cellKey(selRow.key, selCol.key)) : null;
  const lists = useMemo(() => (data ? listRows(data, atype, scoped && selRow && selCol ? { rowKey: selRow.key, col: selCol } : null) : null),
    [data, atype, scoped, selRow, selCol]);
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

  const pick = (rowKey, colKey) => { setSel({ rowKey, colKey }); setShowAll(false); setTip(null); };
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
  const list = lists[tab];
  const shown = showAll ? list : list.slice(0, LIST_LIMIT);

  return (
    <div className="px-6 pb-10 pt-5 min-[1441px]:px-8">
      <header className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-n-200 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">갖춤 현황</h1>
          <p className="mt-1 text-ui text-n-600">호선과 구역마다 확정 자료가 무엇을 갖췄는지 봅니다. 칸에 올리거나 포커스하면 이유가 나오고, 누르면 오른쪽에 그 칸의 자료가 열립니다.</p>
        </div>
        <span className="text-ui text-n-600 tabular-nums">
          자료 <b className="font-semibold text-n-900">{data.entries.length}</b> · 행 <b className="font-semibold text-n-900">{grid.rows.length}</b> · 구역 <b className="font-semibold text-n-900">{grid.cols.length}</b>
          {data.truncated && ' · 최근 확정 자료만 셌습니다'}
        </span>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-n-600">해석 종류</span>
          <Segmented label="해석 종류" items={[ALL, ...atypes].map((a) => ({ id: a, label: a }))} value={atype}
                     onChange={(v) => { setAtype(v); setShowAll(false); }} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-n-600">행 순서</span>
          <Segmented label="행 순서" items={SORTS} value={sort} onChange={setSort} />
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
        {atype !== ALL && grid.counts.na > 0 && (
          <span className="inline-flex h-[30px] items-center gap-2 rounded-md border border-n-200 px-2.5 pl-1.5 text-ui">
            <Swatch state="na" />해당 없음 <b className="font-mono font-medium">{grid.counts.na}</b><span className="text-meta text-n-600">칸</span>
          </span>
        )}
      </div>

      <div className="grid items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div ref={gridRef} className={`max-h-[min(640px,calc(100vh-290px))] min-h-[320px] overflow-auto rounded-lg border border-n-200 ${focus ? 'cov-dim' : ''}`}>
            <table role="grid" aria-label="호선별 구역 자료 현황" className="border-separate border-spacing-0 text-ui">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-30 min-w-[138px] border-b border-r border-n-200 bg-n-50 px-2.5 pb-2 text-left align-bottom text-meta font-medium text-n-600">
                    호선<br /><span className="font-normal">채운 구역</span>
                  </th>
                  {grid.cols.map((c) => (
                    <th key={c.key} scope="col" title={c.label}
                        className={`sticky top-0 z-20 w-[45px] min-w-[45px] max-w-[45px] border-b border-n-200 px-px pb-1.5 pt-2 text-center align-bottom text-meta font-medium leading-tight
                          ${sel?.colKey === c.key ? 'bg-n-100 text-n-900' : 'bg-n-50 text-n-700'}`}>
                      <span className="block">{headerLines(c.label).map((l, k) => <span key={k} className={`block ${/[가-힣]/.test(l) ? 'whitespace-nowrap' : 'break-all'}`}>{l}</span>)}</span>
                      <span className="mx-[7px] mt-1.5 block h-[3px] overflow-hidden rounded-full bg-n-150" aria-hidden="true">
                        <span className="block h-full bg-n-400" style={{ width: `${(grid.colFilled.get(c.key) / grid.rows.length) * 100}%` }} />
                      </span>
                      <span className="mt-0.5 block font-mono text-meta text-n-600" title="이 구역에 자료가 있는 행 수">{grid.colFilled.get(c.key)}</span>
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
                        <span className="ml-auto font-mono text-meta text-n-600" title="자료가 있는 구역 수">{grid.rowFilled.get(r.key)}/{grid.applicableCols}</span>
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
                          {cell.state === 'na' ? (
                            <span className={cls} aria-label={label} role="gridcell" />
                          ) : (
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
                          )}
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

          <section className="mt-6" aria-label="손볼 자료 목록">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-ui font-semibold text-n-800">손볼 자료 목록{atype !== ALL ? ` · ${atype}` : ''}</h2>
              {selRow && selCol && (scoped ? (
                <span className="inline-flex h-[26px] items-center gap-1 rounded-full bg-brand-subtle pl-2.5 pr-1 text-ui text-brand">
                  {selRow.label} · {selCol.label}만
                  <button type="button" aria-label="칸 거르기 풀기" onClick={() => setScoped(false)}
                          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full hover:bg-brand-muted"><X size={13} /></button>
                </span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setScoped(true)}>{selRow.label} · {selCol.label}만 보기</Button>
              ))}
            </div>
            <Tabs label="손볼 자료 종류" items={LIST_TABS.map((t) => ({ id: t.id, label: t.label, count: `${lists[t.id].length}건` }))}
                  value={tab} onChange={(v) => { setTab(v); setShowAll(false); }} />
            <p className="py-2.5 text-ui text-n-600">{LIST_TABS.find((t) => t.id === tab).note}</p>
            {list.length ? (
              <div className="overflow-auto rounded-lg border border-n-200">
                <table className="w-full border-collapse text-ui">
                  <thead>
                    <tr className="h-9 bg-n-50 text-left text-meta font-medium text-n-600">
                      {['자료', '호선', '구역 · 해석 종류', '파일 · 검증', '올린 사람', '확정'].map((h) => (
                        <th key={h} className="whitespace-nowrap border-b border-n-200 px-2.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} className="border-b border-n-100 hover:bg-n-50">
                        <td className="px-2.5 py-2">
                          <Link to={`/e/${e.id}`} className="font-medium text-n-900 hover:text-brand hover:underline underline-offset-2">{e.title}</Link>
                          <div className="font-mono text-meta text-n-600">{e.id}</div>
                        </td>
                        <td className="px-2.5 py-2"><span className="flex flex-wrap gap-1">{rowsOf(e).slice(0, 3).map((k) => {
                          const r = grid.rows.find((x) => x.key === k);
                          return r ? <RowChip key={k} row={r} /> : null;
                        })}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-n-700">{(e.zones[0] || '구역 없음')}{e.zones.length > 1 ? ` 외 ${e.zones.length - 1}` : ''} · {e.analysis_type || '해석 종류 없음'}</td>
                        <td className="whitespace-nowrap px-2.5 py-2"><span className="mr-2 text-n-700">{fileText(e)}</span><SolveText solve={e.solve} /></td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-n-700" title={e.uploaded_by || undefined}>{e.uploader_name || e.uploaded_by || '—'}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 font-mono text-meta text-n-600">{e.confirmed_at || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {list.length > shown.length && (
                  <div className="border-t border-n-100 p-2 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>나머지 {list.length - shown.length}건 더 보기</Button>
                  </div>
                )}
              </div>
            ) : <p className="py-6 text-ui text-n-600">이 조건에 해당하는 자료가 없습니다.</p>}
          </section>
        </div>

        <aside aria-label="칸 상세" aria-live="polite"
               className="rounded-lg border border-n-200 p-4 min-[1180px]:sticky min-[1180px]:top-4 min-[1180px]:max-h-[calc(100vh-100px)] min-[1180px]:overflow-auto">
          {selCell ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex flex-wrap items-center gap-2 text-body font-semibold text-n-900"><RowChip row={selRow} />{selCol.label}</h2>
                <Button variant="ghost" size="sm" onClick={() => { setSel(null); setScoped(false); }}>닫기</Button>
              </div>
              <p className="text-meta text-n-600">{selRow.sub}{atype !== ALL ? ` · ${atype}만` : ''}</p>
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
                <NearBy data={data} grid={grid} row={selRow} col={selCol} atype={atype} />
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
              {todos.length > 9 && <p className="mt-2 text-meta text-n-600">그 밖에 {todos.length - 9}칸은 아래 목록 탭에서 자료 단위로 볼 수 있습니다.</p>}
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

/** 빈 칸 — 같은 선종 다른 호선의 같은 구역, 같은 행의 다른 구역 자료를 참고로. */
function NearBy({ data, grid, row, col, atype }) {
  const ship = row.kind === 'hull' ? row.sub : null;
  const sameCol = data.entries.filter((e) => e.zones.includes(col.key) && (atype === ALL || e.analysis_type === atype)
    && !rowsOf(e).includes(row.key)
    && (!ship || rowsOf(e).some((k) => grid.rows.find((r) => r.key === k)?.sub === ship))).slice(0, 4);
  const sameRow = data.entries.filter((e) => rowsOf(e).includes(row.key) && (atype === ALL || e.analysis_type === atype)).slice(0, 4);
  return (
    <>
      <h3 className="text-ui font-semibold text-n-800">참고할 자료 · {ship ? `같은 선종(${ship}) ` : ''}다른 행의 {col.label}</h3>
      {sameCol.length ? sameCol.map((e) => <EntryLine key={e.id} e={e} />) : <p className="py-2 text-meta text-n-600">없습니다.</p>}
      <h3 className="mt-4 text-ui font-semibold text-n-800">참고할 자료 · {row.label}의 다른 구역</h3>
      {sameRow.length ? sameRow.map((e) => <EntryLine key={e.id} e={e} />) : <p className="py-2 text-meta text-n-600">이 행에는 아직 자료가 없습니다.</p>}
    </>
  );
}
