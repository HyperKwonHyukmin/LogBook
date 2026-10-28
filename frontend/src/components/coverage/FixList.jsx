import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { ErrorNote } from '../ui/Page.jsx';
import { RowsSkeleton } from '../ui/Skeleton.jsx';
import { HullChip } from '../ui/Status.jsx';
import { Segmented } from '../ui/Tabs.jsx';
import { errorText } from '../../lib/labels.js';
import { buildGrid, LIST_TABS, listRows } from '../../lib/coverage.js';

const LIST_LIMIT = 12;

/** 행 칩 — 호선 행(같은 시리즈면 호선 칩을 나란히) · 선종 · 크기급 · 공용. 갖춤 현황 격자와 손볼 자료가 같이 쓴다. */
export function RowChip({ row }) {
  if (row.kind === 'hull') {
    if ((row.members?.length || 0) < 2) return <HullChip hull={row.label} />;
    // 45 — 같은 시리즈 호선은 한 행: 호선 칩을 나란히(각각 호선 화면으로)
    return (
      <span className="inline-flex flex-wrap items-center gap-1" title={`${row.label} 시리즈 — 같은 설계 ${row.members.length}척`}>
        {row.members.map((h) => <HullChip key={h} hull={h} />)}
      </span>
    );
  }
  return <span className="inline-flex h-5 items-center rounded-sm bg-n-100 px-1.5 text-meta font-medium text-n-800">{row.label}</span>;
}

export function SolveText({ solve }) {
  if (solve === 'pass') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" />검증 통과</span>;
  if (solve === 'fail') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-err"><span className="h-1.5 w-1.5 rounded-full bg-err" />검증 실패</span>;
  if (solve === 'none') return <span className="text-meta text-n-600">검증 전</span>;
  return null;
}

export const fileText = (e) => [e.models ? `BDF ${e.models}` : null, e.reports ? `문서 ${e.reports}` : null].filter(Boolean).join(' · ') || '파일 없음';

/**
 * 손볼 자료(26 → 48 정리 대기 탭) — 확정 자료 중 문서 없는 모델·모델 없는 문서 등 LIST_TABS 종류별 목록.
 * 갖춤 현황과 같은 /coverage 응답을 쓰고, 행은 호선 기준(같은 시리즈는 한 칩 묶음)으로 보인다. 등급 제한 없음.
 */
export default function FixList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState(LIST_TABS[0].id);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setError('');
    api('/coverage').then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(errorText(err, '손볼 자료를 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, [attempt]);

  const grid = useMemo(() => (data ? buildGrid(data) : null), [data]);
  const lists = useMemo(() => (data ? listRows(data, null, grid.keysOf) : null), [data, grid]);

  if (error) {
    return <ErrorNote action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>{error}</ErrorNote>;
  }
  if (!lists) return <RowsSkeleton rows={5} label="손볼 자료를 불러오는 중" />;

  const list = lists[tab];
  const shown = showAll ? list : list.slice(0, LIST_LIMIT);
  const items = LIST_TABS.map((t) => ({ id: t.id, label: `${t.label} ${lists[t.id].length}` }));
  return (
    <section aria-label="손볼 자료 목록">
      <Segmented label="손볼 자료 종류" role="tablist" items={items} value={tab} onChange={(v) => { setTab(v); setShowAll(false); }} />
      <p className="py-2.5 text-ui text-n-600">{LIST_TABS.find((t) => t.id === tab).note}</p>
      {list.length ? (
        <div className="overflow-auto rounded-lg border border-n-200">
          <table className="w-full border-collapse text-ui">
            <thead>
              <tr className="h-9 bg-n-50 text-left text-meta font-medium text-n-600">
                {['자료', '호선', '구역', '파일 · 검증', '작성자', '등록일'].map((h) => (
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
                  <td className="px-2.5 py-2"><span className="flex flex-wrap gap-1">{grid.keysOf(e).slice(0, 3).map((k) => {
                    const r = grid.rows.find((x) => x.key === k);
                    return r ? <RowChip key={k} row={r} /> : null;
                  })}</span></td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-n-700">
                    {(e.zones[0] || '구역 없음')}{e.zones.length > 1 ? ` 외 ${e.zones.length - 1}` : ''}
                  </td>
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
      ) : <p className="py-6 text-ui text-n-600">이 종류에 해당하는 자료가 없습니다.</p>}
    </section>
  );
}
