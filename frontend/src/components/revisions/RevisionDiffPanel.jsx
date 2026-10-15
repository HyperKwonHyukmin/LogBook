import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ChevronDown, ChevronRight, Columns2, Copy, X } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { useToast } from '../ui/Toast.jsx';
import { copyText } from '../../lib/files.js';
import { compareHref } from '../../lib/compareBasket.js';
import { errorText } from '../../lib/labels.js';
import { arrow, diffErrorText, formatMass } from '../../lib/revisions.js';
import { diffHref } from '../../lib/revisionDiff3d.js';

const POLL_MS = 3000;
const ID_SHOWN = 60;

/** 두 판(a → b) 비교 상태를 읽고, 기다리는 중이면 다시 읽는다. request=true 면 먼저 비교를 요청한다(두 판 고르기). */
export function useDiff(a, b, { request = false } = {}) {
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let timer = null;
    setDiff(null); setError('');
    async function load(first) {
      try {
        const d = first && request
          ? await api(`/files/${a}/diff/${b}`, { method: 'POST' })
          : await api(`/files/${a}/diff/${b}`);
        if (!live) return;
        setDiff(d);
        if (d.state === 'queued' || d.state === 'running') timer = setTimeout(() => load(false), POLL_MS);
      } catch (err) {
        if (live) setError(err?.detail === 'model_not_ready' ? '두 모델의 변환이 끝나야 비교할 수 있습니다.' : errorText(err, '비교를 불러오지 못했습니다.'));
      }
    }
    load(true);
    return () => { live = false; clearTimeout(timer); };
  }, [a, b, request]);
  return { diff, error };
}

export function useDetail(a, b, ready) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    setDetail(null); setFailed(false);
    api(`/files/${a}/diff/${b}/detail`)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [a, b, ready]);
  return { detail, failed };
}

/** 접히는 ID 목록 + 복사. truncated 면 '앞 N개만'. */
function IdList({ label, ids, total, truncated }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (!ids || ids.length === 0) return null;
  const count = truncated ?? total ?? ids.length;
  async function copy() {
    const ok = await copyText(ids.join(' '));
    toast.show(ok ? { message: `${label} ID ${ids.length.toLocaleString('ko-KR')}개를 복사했습니다.` } : { tone: 'err', message: '복사하지 못했습니다.' });
  }
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                aria-label={`${label} ID ${count.toLocaleString('ko-KR')}개${truncated ? ` (앞 ${ids.length.toLocaleString('ko-KR')}개만 저장)` : ''}`}
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1 text-meta text-n-700 transition-colors duration-150 hover:bg-n-100">
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          {label} ID <span className="font-mono">{count.toLocaleString('ko-KR')}</span>개
          {truncated ? <span className="text-n-500">(앞 {ids.length.toLocaleString('ko-KR')}개만 저장)</span> : null}
        </button>
        <button type="button" onClick={copy} aria-label={`${label} ID 복사`} title="ID 복사(공백으로 구분)"
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-n-500 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
          <Copy size={12} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <p className="ml-5 mt-0.5 break-words font-mono text-meta text-n-700">
          {ids.slice(0, ID_SHOWN).join(' ')}{ids.length > ID_SHOWN ? ` … 외 ${(ids.length - ID_SHOWN).toLocaleString('ko-KR')}개(복사로 전체)` : ''}
        </p>
      )}
    </div>
  );
}

function Section({ title, changed: raw, children }) {
  const changed = Boolean(raw);     // 0 을 그대로 그리지 않게
  return (
    <section className="border-t border-n-200 py-2.5 first:border-t-0">
      <h4 className="flex items-center gap-2 text-ui font-semibold text-n-800">
        {title}
        {!changed && <span className="text-meta font-normal text-n-500">변경 없음</span>}
      </h4>
      {changed && <div className="mt-1 text-meta text-n-700">{children}</div>}
    </section>
  );
}

const Line = ({ children }) => <p className="mt-0.5">{children}</p>;

/** 속성·재료 전후 값 표. */
function ChangeTable({ kind, rows }) {
  const flat = [];
  for (const r of rows) {
    if (!r.changes?.length) flat.push({ key: `${r.id}`, id: r.id, card: r.card, field: '', a: '', b: '', text: r.text });
    else r.changes.forEach((c, k) => flat.push({ key: `${r.id}:${k}`, id: r.id, card: r.card, ...c }));
  }
  if (flat.length === 0) return null;
  return (
    <div className="mt-1.5 max-h-64 overflow-auto rounded-md border border-n-200">
      <table className="w-full text-meta">
        <thead className="sticky top-0 bg-n-50 text-n-600">
          <tr><th className="px-2 py-1 text-left font-medium">{kind}</th><th className="px-2 py-1 text-left font-medium">카드</th>
            <th className="px-2 py-1 text-left font-medium">칸</th><th className="px-2 py-1 text-left font-medium">앞</th>
            <th className="px-2 py-1 text-left font-medium">뒤</th></tr>
        </thead>
        <tbody>
          {flat.map((r) => (
            <tr key={r.key} className="border-t border-n-200">
              <td className="px-2 py-1 font-mono">{r.id}</td>
              <td className="px-2 py-1">{r.card}</td>
              {r.text ? <td colSpan={3} className="px-2 py-1">{r.text}</td> : (
                <>
                  <td className="px-2 py-1">{r.field}</td>
                  <td className="px-2 py-1 font-mono text-n-600">{r.a}</td>
                  <td className="px-2 py-1 font-mono font-medium text-n-900">{r.b}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const T = (d, name) => d?.truncated?.[name];

/** 요약(summary)과 상세(detail)로 범주별 섹션을 그린다. */
export function DiffBody({ summary: s, detail: d }) {
  const nd = s.nodes, el = s.elements, rg = s.rigids, pr = s.properties, mt = s.materials, lo = s.loads, ms = s.mass, ct = s.control;
  const cards = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v.toLocaleString('ko-KR')}`).join(', ');
  return (
    <div>
      <Section title="절점" changed={nd.added || nd.removed || nd.moved}>
        <Line>절점 수 {arrow(nd.a, nd.b)}{nd.added ? ` · 추가 ${nd.added.toLocaleString('ko-KR')}` : ''}{nd.removed ? ` · 삭제 ${nd.removed.toLocaleString('ko-KR')}` : ''}</Line>
        {nd.moved > 0 && <Line>이동 {nd.moved.toLocaleString('ko-KR')}개 · 최대 <span className="font-mono">{formatMass(nd.max_move)}</span> · 평균 <span className="font-mono">{formatMass(nd.mean_move)}</span> (허용오차 <span className="font-mono">{formatMass(nd.tol)}</span>)</Line>}
        {d?.nodes?.top_moved?.length > 0 && <Line>가장 많이 움직인 절점: <span className="font-mono">{d.nodes.top_moved.slice(0, 5).map(([g, x]) => `${g}(${formatMass(x)})`).join(', ')}</span></Line>}
        <IdList label="추가 절점" ids={d?.nodes?.added} truncated={T(d, 'nodes.added')} />
        <IdList label="삭제 절점" ids={d?.nodes?.removed} truncated={T(d, 'nodes.removed')} />
        <IdList label="이동 절점" ids={d?.nodes?.moved} truncated={T(d, 'nodes.moved')} />
      </Section>
      <Section title="요소" changed={el.added || el.removed || el.conn_changed || el.card_changed || el.pid_changed || el.other_changed}>
        <Line>요소 수 {arrow(el.a, el.b)}</Line>
        {el.added > 0 && <Line>추가 {el.added.toLocaleString('ko-KR')} ({cards(el.added_by_card)})</Line>}
        {el.removed > 0 && <Line>삭제 {el.removed.toLocaleString('ko-KR')} ({cards(el.removed_by_card)})</Line>}
        {(el.conn_changed > 0 || el.card_changed > 0 || el.pid_changed > 0 || el.other_changed > 0) && (
          <Line>연결 변경 {el.conn_changed} · 카드 종류 변경 {el.card_changed} · PID 변경 {el.pid_changed} · 방향·오프셋 등 {el.other_changed}</Line>
        )}
        <IdList label="추가 요소" ids={d?.elements?.added} truncated={T(d, 'elements.added')} />
        <IdList label="삭제 요소" ids={d?.elements?.removed} truncated={T(d, 'elements.removed')} />
        <IdList label="연결 변경 요소" ids={d?.elements?.conn} truncated={T(d, 'elements.conn')} />
        <IdList label="PID 변경 요소" ids={d?.elements?.pid?.map((x) => x.eid)} truncated={T(d, 'elements.pid')} />
        <IdList label="카드 변경 요소" ids={d?.elements?.card?.map((x) => x.eid)} truncated={T(d, 'elements.card')} />
        <IdList label="방향·오프셋 변경 요소" ids={d?.elements?.other} truncated={T(d, 'elements.other')} />
      </Section>
      <Section title="강체" changed={rg.added || rg.removed || rg.indep_changed || rg.dep_changed || rg.other_changed}>
        <Line>강체 수 {arrow(rg.a, rg.b)} · 추가 {rg.added} · 삭제 {rg.removed} · 독립 절점 변경 {rg.indep_changed} · 종속 절점 변경 {rg.dep_changed}{rg.other_changed ? ` · 그 밖 ${rg.other_changed}` : ''}</Line>
        {d?.rigids?.dep?.slice(0, 10).map((x) => (
          <Line key={x.eid}><span className="font-mono">{x.card} {x.eid}</span>: 종속 절점 +{x.added} −{x.removed}</Line>
        ))}
        <IdList label="추가 강체" ids={d?.rigids?.added} truncated={T(d, 'rigids.added')} />
        <IdList label="삭제 강체" ids={d?.rigids?.removed} truncated={T(d, 'rigids.removed')} />
      </Section>
      <Section title="속성" changed={pr.added || pr.removed || pr.changed}>
        <Line>속성 수 {arrow(pr.a, pr.b)} · 추가 {pr.added} · 삭제 {pr.removed} · 값 변경 {pr.changed}{pr.thickness ? ` (두께 ${pr.thickness})` : ''}{pr.section ? ` (단면 ${pr.section})` : ''}</Line>
        {d && <ChangeTable kind="PID" rows={[...(d.properties?.changed || []), ...(d.properties?.added || []), ...(d.properties?.removed || [])]} />}
      </Section>
      <Section title="재료" changed={mt.added || mt.removed || mt.changed}>
        <Line>재료 수 {arrow(mt.a, mt.b)} · 추가 {mt.added} · 삭제 {mt.removed} · 값 변경 {mt.changed}</Line>
        {d && <ChangeTable kind="MID" rows={[...(d.materials?.changed || []), ...(d.materials?.added || []), ...(d.materials?.removed || [])]} />}
      </Section>
      <Section title="하중·경계조건" changed={lo.sets_changed || lo.spc_added || lo.spc_removed || lo.spc_changed}>
        {lo.sets_changed > 0 && <Line>바뀐 하중 세트 {lo.sets_changed} (세트 수 {arrow(lo.sets_a, lo.sets_b)})</Line>}
        {d?.loads?.sets?.slice(0, 20).map((x) => <Line key={x.sid + x.text}>{x.text}</Line>)}
        {(lo.spc_added || lo.spc_removed || lo.spc_changed) > 0 && (
          <Line>구속(SPC) 절점 수 {arrow(lo.spc_nodes_a, lo.spc_nodes_b)} · 추가 {lo.spc_added} · 삭제 {lo.spc_removed} · 성분 변경 {lo.spc_changed}</Line>
        )}
        <IdList label="구속이 바뀐 절점" ids={d?.loads?.spc_nodes} truncated={T(d, 'loads.spc_nodes')} />
      </Section>
      <Section title="질량" changed={ms.added || ms.removed || ms.changed}>
        <Line>질량 합 <span className="font-mono">{formatMass(ms.total_a)} → {formatMass(ms.total_b)}</span> · 질량 요소 {arrow(ms.a, ms.b)} · 추가 {ms.added} · 삭제 {ms.removed} · 변경 {ms.changed}</Line>
        {d?.mass?.changed?.slice(0, 10).map((x) => <Line key={x.eid}><span className="font-mono">{x.card} {x.eid}</span>: {x.a} → {x.b}</Line>)}
      </Section>
      <Section title="해석 설정" changed={ct.changed || ct.other_added || ct.other_removed}>
        {ct.sol_a !== ct.sol_b && <Line>SOL <span className="font-mono">{ct.sol_a || '—'} → {ct.sol_b || '—'}</span></Line>}
        {d?.control?.removed?.map((x) => <Line key={`r${x}`}><span className="text-err">−</span> {x}</Line>)}
        {d?.control?.added?.map((x) => <Line key={`a${x}`}><span className="text-ok">+</span> {x}</Line>)}
        {d?.control?.other_removed?.slice(0, 20).map((x) => <Line key={`or${x}`}><span className="text-err">−</span> <span className="font-mono">{x}</span></Line>)}
        {d?.control?.other_added?.slice(0, 20).map((x) => <Line key={`oa${x}`}><span className="text-ok">+</span> <span className="font-mono">{x}</span></Line>)}
      </Section>
    </div>
  );
}

/**
 * 변경 요약 패널(14 D) — 두 판(a → b) 비교. 제자리에 열리고 [닫기]로 접는다.
 * names = { a: '판 이름 · 파일 이름', b: … }
 */
export default function RevisionDiffPanel({ a, b, names, request = false, onClose }) {
  const navigate = useNavigate();
  const { diff, error } = useDiff(a, b, { request });
  const done = diff?.state === 'done';
  const { detail, failed } = useDetail(a, b, done);
  return (
    <section aria-label="변경 요약" className="mb-3 rounded-lg border border-n-200 bg-n-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-n-200 px-3 py-2">
        <h3 className="min-w-0 text-ui font-semibold text-n-900">
          변경 요약 <span className="font-normal text-n-600">{names?.a} → {names?.b}</span>
        </h3>
        <div className="flex-1" />
        {done && diff.summary && !diff.summary.identical && (
          <Button variant="secondary" size="sm" onClick={() => navigate(diffHref(a, b))}
                  title="뒤 판에 추가·변경·삭제를 색으로 칠해 한 화면에서 봅니다">
            <Box size={14} aria-hidden="true" />3D로 변경 보기
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => navigate(compareHref([a, b]))} title="두 판을 비교 화면에서 나란히 엽니다">
          <Columns2 size={14} aria-hidden="true" />두 판 3D 나란히 보기
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="변경 요약 닫기"><X size={14} aria-hidden="true" /></Button>
      </header>
      <div className="max-h-[520px] overflow-auto px-3 py-1">
        {error && <p role="alert" className="py-2 text-meta text-err">{error}</p>}
        {!error && !diff && <p className="flex items-center gap-1.5 py-2 text-meta text-n-600"><Spinner size={12} />불러오는 중…</p>}
        {diff?.state === 'waiting' && <p className="py-2 text-meta text-wait">두 모델의 변환이 끝나면 비교합니다.</p>}
        {(diff?.state === 'queued' || diff?.state === 'running') && (
          <p role="status" className="flex items-center gap-1.5 py-2 text-meta text-n-600"><Spinner size={12} />비교 중입니다. 큰 모델은 1분 가까이 걸릴 수 있습니다.</p>
        )}
        {diff?.state === 'error' && <p role="alert" className="py-2 text-meta text-err">비교하지 못했습니다: {diffErrorText(diff.error)}</p>}
        {done && diff.summary?.identical && <p className="py-2 text-ui text-n-700">두 판의 모델 내용이 같습니다(표기·순서·주석 차이만 있음).</p>}
        {done && diff.summary && !diff.summary.identical && (
          <>
            {failed && <p className="pt-2 text-meta text-n-500">상세(ID 목록·전후 값)를 불러오지 못했습니다. 숫자 요약만 보입니다.</p>}
            <DiffBody summary={diff.summary} detail={detail} />
          </>
        )}
      </div>
    </section>
  );
}
