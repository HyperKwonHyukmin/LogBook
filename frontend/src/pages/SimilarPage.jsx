import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Database, FileUp, ScanSearch } from 'lucide-react';
import { api, apiBinary } from '../api/client.js';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { HullChip } from '../components/ui/Status.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import ModelPicker from '../components/similar/ModelPicker.jsx';
import ModelThumb from '../components/viewer/ModelThumb.jsx';
import { errorText } from '../lib/labels.js';
import {
  compareLines, likeWord, longest, MAX_UPLOAD_BYTES, mixText, orderResults, PART_LABELS, sectionUnion, sizeText, titleWithoutHull, WEAK,
} from '../lib/similar.js';
import { loadVocab } from '../lib/vocab.js';

const ORDERS = [{ id: 'like', label: '닮은 순' }, { id: 'pass', label: '검증 통과·문서 있는 것 먼저' }];
const selectClass = 'h-8 rounded-md border border-n-250 bg-n-0 px-2 text-ui text-n-800 hover:border-n-300';

function Thumb({ item, className = '' }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-viewer ${className}`}>
      {item.file_id
        ? <ModelThumb fileId={item.file_id} modelKey={item.model_key} alt="" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-meta text-on-viewer-subtle">내 PC 의 BDF</div>}
      {item.dims && <span className="absolute bottom-1 right-1.5 rounded-xs bg-viewer/80 px-1 font-mono text-meta text-on-viewer">{longest(item.dims)}</span>}
    </div>
  );
}

function SolveText({ solve }) {
  if (solve === 'pass') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" />검증 통과</span>;
  if (solve === 'fail') return <span className="inline-flex items-center gap-1.5 text-meta font-medium text-err"><span className="h-1.5 w-1.5 rounded-full bg-err" />검증 실패</span>;
  return <span className="text-meta text-n-600">검증 전</span>;
}

const Hulls = ({ hulls }) => <span className="flex flex-wrap gap-1">{hulls.slice(0, 6).map((h) => <HullChip key={h} hull={h} />)}{hulls.length > 6 && <span className="text-meta text-n-600">외 {hulls.length - 6}척</span>}</span>;

/**
 * 선례 찾기(27, `/similar?file=<id>`) — 기준 BDF 와 비슷한 확정 모델을 순위로. 같은 설계(형상 서명)는 한 줄로 묶고,
 * 점수 대신 같은 점·다른 점·검증·문서를 앞에 둔다. 기준은 LogBook 의 BDF(주소의 file) 또는 내 PC 의 BDF(저장하지 않음).
 */
export default function SimilarPage() {
  const [params, setParams] = useSearchParams();
  const fileId = params.get('file');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zone, setZone] = useState(null);       // null = 기준 자료 값, '' = 모름
  const [order, setOrder] = useState('like');
  const [selId, setSelId] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(!fileId);   // LogBook 에서 고르기 칸(기준이 없으면 처음부터 연다)
  const [vocab, setVocab] = useState({ zone: [] });
  const upload = useRef(null);                  // 마지막에 올린 파일(구역을 바꾸면 다시 보낸다)
  const fileInput = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    loadVocab('zone').then((z) => setVocab({ zone: z.map((t) => t.value) })).catch(() => {});
  }, []);

  // 42 — 해석 종류는 없앴다(구역만 보낸다)
  const query = (z) => (z != null ? `zone=${encodeURIComponent(z)}` : '');

  async function run(z = zone) {
    setBusy(true); setError('');
    try {
      let d;
      if (upload.current) {
        const f = upload.current;
        d = await apiBinary(`/similar/bdf?name=${encodeURIComponent(f.name)}${query(z) ? `&${query(z)}` : ''}`, f, { method: 'POST' });
      } else if (fileId) {
        d = await api(`/similar?file_id=${fileId}${query(z) ? `&${query(z)}` : ''}`);
      } else {
        d = null;
      }
      setData(d);
      setSelId(d?.results?.[0]?.lead.file_id ?? null);
      setOpen(new Set());
    } catch (err) {
      setError(errorText(err, '비슷한 선례를 찾지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    upload.current = null; setZone(null);
    run(null);
  }, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  function takeFile(f) {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) { setError(errorText({ detail: 'bdf_too_large' })); return; }
    upload.current = f; setZone(null);
    setPicking(false);
    if (fileId) setParams({}, { replace: true });
    run(null);
  }

  function pickFromLogbook(id) {
    setPicking(false);
    if (String(id) === String(fileId) && !upload.current) return;
    upload.current = null;
    if (String(id) === String(fileId)) { run(null); return; }
    setParams({ file: String(id) });
  }

  const results = useMemo(() => (data ? orderResults(data.results, order) : []), [data, order]);
  const weak = !!data && (!data.results.length || data.results[0].best < WEAK);
  const shown = weak ? results.slice(0, 3) : results;
  const base = data?.base;
  const sel = shown.flatMap((r) => r.members.map((m) => ({ m, r }))).find((x) => x.m.file_id === selId);

  const choose = (r) => setSelId(r.lead.file_id);
  const onListKey = (ev, i) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    const next = shown[i + step];
    if (next) { choose(next); listRef.current?.querySelector(`[data-idx="${i + step}"]`)?.focus(); }
  };

  return (
    <div className="px-6 pb-10 pt-5 min-[1441px]:px-8">
      <header className="mb-4 border-b border-n-200 pb-4">
        <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">선례 찾기</h1>
        <p className="mt-1 text-ui text-n-600">새 해석을 시작하기 전에, 비슷한 모델을 누가 해석했고 결과가 어땠는지 찾습니다. 기준 BDF 와 같은 점·다른 점을 함께 보여 줍니다.</p>
      </header>

      <section aria-label="기준 BDF"
               onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
               onDrop={(e) => { e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files?.[0]); }}
               className={`grid items-center gap-4 rounded-lg border p-3.5 transition-colors duration-150 ease-out min-[900px]:grid-cols-[168px_minmax(0,1fr)_auto]
                 ${over ? 'border-brand bg-brand-subtle' : 'border-n-200 bg-n-0'}`}>
        {base ? <Thumb item={base} className="h-[104px] w-full min-[900px]:w-[168px]" />
          : <div className="flex h-[104px] items-center justify-center rounded-md border border-dashed border-n-300 text-n-500"><FileUp size={20} aria-hidden="true" /></div>}
        <div className="min-w-0">
          {base ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-[18px] items-center rounded-xs bg-k-bdf-bg px-1.5 text-micro font-semibold text-k-bdf">BDF</span>
                <b className="text-body font-semibold text-n-900">{base.name}</b>
                <span className="text-meta text-n-600">기준 · {base.entry_id ? <Link className="text-brand hover:underline" to={`/e/${base.entry_id}`}>{base.entry_id} 자료</Link> : '내 PC 에서 읽음(저장하지 않음)'}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-ui text-n-700">
                <span><span className="mr-1 text-n-600">크기</span><span className="font-mono">{sizeText(base.dims)}</span></span>
                <span><span className="mr-1 text-n-600">요소</span><span className="font-mono">{base.elems.toLocaleString('ko-KR')}</span></span>
                <span><span className="mr-1 text-n-600">구성</span>{mixText(base.mix)}</span>
                <span><span className="mr-1 text-n-600">단면</span>{base.sections.length}개</span>
                {!base.has_signature && <span className="text-wait">형상 서명이 없어 같은 설계는 찾지 못합니다</span>}
                {base.missing_includes?.length > 0 && <span className="text-wait">INCLUDE {base.missing_includes.length}개는 읽지 않았습니다</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-meta text-n-600">구역을 고르면 더 정확해집니다</span>
                <select aria-label="구역" className={selectClass} value={zone ?? base.zone ?? ''}
                        onChange={(e) => { setZone(e.target.value); run(e.target.value); }}>
                  <option value="">구역 모름</option>
                  {[...new Set([base.zone, ...vocab.zone].filter(Boolean))].map((z) => <option key={z}>{z}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <b className="text-body font-semibold text-n-900">기준 BDF 를 정하세요</b>
              <p className="mt-1 text-ui text-n-600">LogBook 에 있는 BDF 를 아래에서 고르거나, 내 PC 의 BDF 를 이 칸에 끌어다 놓으세요(32MB 까지, 저장하지 않습니다).
                자료 화면의 BDF 미리보기에서 [선례 찾기]를 눌러도 여기로 옵니다.</p>
            </>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-1.5 min-[900px]:min-w-[160px]">
          <input ref={fileInput} type="file" accept=".bdf,.dat,.nas,.blk,.txt" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
          <Button onClick={() => setPicking((v) => !v)} aria-expanded={picking} loading={busy && !upload.current}>
            <Database size={14} aria-hidden="true" />LogBook 에서 고르기
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={busy && !!upload.current}>
            <FileUp size={14} aria-hidden="true" />내 PC 에서 고르기
          </Button>
          <span className="text-center text-meta text-n-600">또는 이 칸에 끌어다 놓기</span>
        </div>
      </section>

      {picking && (
        <div className="mt-2">
          <ModelPicker currentId={upload.current ? null : base?.file_id} onPick={pickFromLogbook}
                       onClose={base ? () => setPicking(false) : undefined} />
        </div>
      )}
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      {busy && !data && <div className="mt-4"><RowsSkeleton rows={4} /></div>}
      {!busy && !data && !error && !picking && (
        <div className="mt-6"><EmptyState icon={ScanSearch} title="아직 기준 BDF 가 없습니다">해석하려는 BDF 를 넣으면 과거 확정 자료에서 비슷한 모델을 찾습니다.</EmptyState></div>
      )}

      {data && (
        <div className="mt-4 grid items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label="선례 목록" className="min-w-0 rounded-lg border border-n-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-n-200 px-3.5 py-2.5">
              <b className="text-ui font-semibold text-n-900">{weak ? `가까운 모델 ${shown.length}개` : `선례 ${shown.length}건`}
                <span className="ml-2 font-normal text-n-600">비교한 자료 {data.candidates}건</span></b>
              <Segmented label="정렬" items={ORDERS} value={order} onChange={setOrder} />
            </div>
            {weak && (
              <div className="m-3.5 rounded-lg bg-n-50 px-4 py-3 text-ui text-n-800">
                <b className="font-semibold">충분히 비슷한 선례가 없습니다.</b> 가장 가까운 모델도 일부만 닮았습니다. 아래는 참고로만 보세요.
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Link to="/coverage" className={buttonClass('secondary', 'sm')}>갖춤 현황에서 같은 구역 보기</Link>
                </div>
              </div>
            )}
            <div ref={listRef} role="listbox" aria-label="찾은 선례">
              {shown.map((r, i) => {
                const L = r.lead;
                const c = compareLines({ ...base, zone: zone ?? base.zone }, L, r.score);
                const grp = r.member_total > 1;
                const isOpen = open.has(L.file_id);
                const hulls = [...new Set(r.members.flatMap((m) => m.hulls))];
                const active = r.members.some((m) => m.file_id === selId);
                return (
                  <div key={L.file_id} role="option" aria-selected={active} tabIndex={active || (!selId && i === 0) ? 0 : -1} data-idx={i}
                       onClick={(ev) => { if (!ev.target.closest('a,button')) choose(r); }} onKeyDown={(ev) => { onListKey(ev, i); if (ev.key === 'Enter') choose(r); }}
                       className={`grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_96px] items-start gap-3.5 border-b border-n-100 p-3.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand-ring)] min-[760px]:grid-cols-[24px_150px_minmax(0,1fr)_96px]
                         ${active ? 'bg-brand-subtle' : 'hover:bg-n-25'}`}>
                    <span className="pt-0.5 font-mono text-ui text-n-600">{i + 1}</span>
                    <Thumb item={L} className="hidden h-24 w-[150px] min-[760px]:block" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {grp ? <span className="inline-flex h-5 items-center rounded-sm bg-n-900 px-1.5 text-meta font-medium text-n-0">같은 설계 {r.member_total}개 자료</span>
                          : <Hulls hulls={L.hulls} />}
                        <Link to={`/e/${L.entry_id}`} className={`text-body font-semibold hover:underline underline-offset-2 ${active ? 'text-brand' : 'text-n-900'}`}>{grp ? L.title : titleWithoutHull(L.title, L.hulls)}</Link>
                        <span className="font-mono text-meta text-n-600">{grp ? '대표 ' : ''}{L.entry_id}</span>
                      </div>
                      {grp && <div className="mt-1.5"><Hulls hulls={hulls} /></div>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-700">
                        <SolveText solve={L.solve} />
                        <span>{L.reports ? `문서 ${L.reports}개` : '문서 없음'}</span>
                        <span title={L.uploaded_by || undefined}>{L.uploader_name || L.uploaded_by || '올린 사람 모름'} · <span className="font-mono">{L.confirmed_at}</span></span>
                      </div>
                      <dl className="mt-2 grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1">
                        <dt className="text-meta text-n-600">같은 점</dt>
                        <dd className="flex flex-wrap gap-1">{(c.same.length ? c.same : ['없음']).map((s) => <span key={s} className="rounded-sm border border-n-150 bg-n-50 px-1.5 text-meta leading-5 text-n-800">{s}</span>)}</dd>
                        {c.diff.length > 0 && <>
                          <dt className="text-meta text-n-600">다른 점</dt>
                          <dd className="flex flex-wrap gap-1">{c.diff.map((s) => <span key={s} className="rounded-sm border border-wait-line bg-wait-bg px-1.5 text-meta leading-5 text-wait">{s}</span>)}</dd>
                        </>}
                      </dl>
                      {L.solve === 'fail' && <p className="mt-2 flex items-center gap-1.5 text-meta text-err"><span className="h-1.5 w-1.5 rounded-full bg-err" />이 선례는 해석 검증에 실패했습니다. 그대로 가져다 쓰기 전에 원인을 확인하세요.</p>}
                      {grp && (
                        <button type="button" aria-expanded={isOpen} className="mt-1.5 text-meta font-medium text-brand hover:underline"
                                onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(L.file_id)) n.delete(L.file_id); else n.add(L.file_id); return n; })}>
                          {isOpen ? '자료 목록 접기' : `같은 설계 자료 ${r.member_total}개 모두 보기`}
                        </button>
                      )}
                      {grp && isOpen && (
                        <ul className="mt-1.5 border-t border-n-150">
                          {r.members.map((m) => (
                            <li key={m.file_id} className="flex flex-wrap items-center gap-2 border-b border-n-100 py-1.5 text-meta last:border-b-0">
                              <Hulls hulls={m.hulls} />
                              <Link to={`/e/${m.entry_id}`} className="text-n-900 hover:text-brand hover:underline">{titleWithoutHull(m.title, m.hulls)}</Link>
                              <span className="font-mono text-n-600">{m.entry_id}</span><SolveText solve={m.solve} />
                              <span className="ml-auto font-mono text-n-600">{m.confirmed_at}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={`text-body font-semibold ${r.best < WEAK ? 'text-n-700' : 'text-brand'}`}>{likeWord(r.best)}</div>
                      <div className="font-mono text-meta text-n-600" title="유사도 점수(0~1)">{r.best.toFixed(2)}</div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-n-150"><div className="h-full bg-brand" style={{ width: `${Math.round(r.best * 100)}%` }} /></div>
                    </div>
                  </div>
                );
              })}
              {!shown.length && <p className="p-6 text-ui text-n-600">비교할 확정 모델이 없습니다.</p>}
            </div>
          </section>

          <aside aria-label="선례 상세" aria-live="polite" className="rounded-lg border border-n-200 p-4 min-[1180px]:sticky min-[1180px]:top-4">
            {sel ? <Detail base={{ ...base, zone: zone ?? base.zone }} item={sel.m} row={sel.r} /> : <p className="text-ui text-n-600">선례를 고르면 기준과 나란히 봅니다.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function Detail({ base, item, row }) {
  const s = row.lead.file_id === item.file_id ? row.score : null;
  const diff = (a, b) => a !== b;
  const cells = [
    ['크기', sizeText(base.dims), sizeText(item.dims), s ? s.raw.size < 0.6 : false],
    ['요소', base.elems.toLocaleString('ko-KR'), item.elems.toLocaleString('ko-KR'), s ? s.raw.scale < 0.5 : false],
    ['구성', mixText(base.mix), mixText(item.mix), s ? s.raw.mix < 0.85 : false],
    ['구역', base.zone || '모름', item.zones.join(', ') || '없음', !!base.zone && !item.zones.includes(base.zone)],
    ['SOL', base.sol || '—', item.sol || '—', diff(base.sol, item.sol)],
  ];
  return (
    <>
      <h2 className="flex flex-wrap items-center gap-2 text-body font-semibold text-n-900"><Hulls hulls={item.hulls} />{titleWithoutHull(item.title, item.hulls)}</h2>
      <p className="mb-2.5 text-meta text-n-600"><span className="font-mono">{item.entry_id}</span> · {item.file_name}</p>
      <div className="grid grid-cols-2 gap-2">
        <div><Thumb item={base} className="h-[110px]" /><p className="mt-1 text-meta text-n-600">기준</p></div>
        <div><Thumb item={item} className="h-[110px]" /><p className="mt-1 text-meta text-n-600">선례</p></div>
      </div>
      {/* 닮은 정도를 썸네일 바로 아래에 — 왜 이 순위인지 먼저 보고, 그다음 값 비교·단면 */}
      {s && (
        <>
          <h3 className="mt-3 text-ui font-semibold text-n-800">닮은 정도 {s.total.toFixed(2)}{s.shape ? ' · 형상이 같아 맨 위' : ''}</h3>
          <div className="mt-1.5 grid gap-1.5">
            {Object.keys(PART_LABELS).map((k) => (
              <div key={k} className="grid grid-cols-[76px_minmax(0,1fr)_38px] items-center gap-2 text-ui">
                <span className="text-n-700">{PART_LABELS[k]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-n-150"><span className="block h-full bg-navy-600" style={{ width: `${Math.round(s.raw[k] * 100)}%` }} /></span>
                <span className="text-right font-mono text-meta text-n-700">{s.raw[k].toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <table className="mt-3 w-full border-collapse text-ui">
        <thead><tr className="text-meta text-n-600"><th className="w-[72px]" /><th className="py-1 text-left font-normal">기준</th><th className="py-1 text-left font-normal">선례 (다른 값은 주황)</th></tr></thead>
        <tbody>
          {cells.map(([k, a, b, d]) => (
            <tr key={k} className="border-t border-n-100 align-top">
              <th className="py-1.5 text-left font-medium text-n-600">{k}</th><td className="py-1.5 pr-2 text-n-800">{a}</td>
              <td className={`py-1.5 ${d ? 'font-medium text-wait' : 'text-n-800'}`}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt-3 text-ui font-semibold text-n-800">단면</h3>
      <div className="mt-1 flex flex-wrap gap-1">
        {sectionUnion(base, item).map((x) => (
          <span key={x.label} className={`rounded-xs px-1.5 font-mono text-meta ${x.where === 'both' ? 'bg-brand-muted text-brand' : 'bg-n-100 text-n-700'}`}>
            {x.label}{x.where !== 'both' && <span className="font-sans text-n-600"> {x.where === 'base' ? '기준만' : '선례만'}</span>}
          </span>
        ))}
        {!base.sections.length && !item.sections.length && <span className="text-meta text-n-600">단면 정보가 없습니다.</span>}
      </div>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        <Link to={`/e/${item.entry_id}`} className={buttonClass('primary', 'sm')}>자료 열기</Link>
        {base.file_id && <Link to={`/compare?ids=${base.file_id},${item.file_id}`} className={buttonClass('secondary', 'sm')}>나란히 비교</Link>}
        <Link to={`/v/${item.file_id}`} className={buttonClass('ghost', 'sm')}>3D 로 보기</Link>
      </div>
      {!item.reports && <p className="mt-2 text-meta text-n-600">이 선례에는 문서가 없습니다. 올린 사람에게 결과를 물어보세요.</p>}
    </>
  );
}
