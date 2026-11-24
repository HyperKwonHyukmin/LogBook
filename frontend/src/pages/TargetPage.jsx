import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Box, ChevronRight, FileText, Rotate3d, Search } from 'lucide-react';
import { api } from '../api/client.js';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import Distribution from '../components/ui/Distribution.jsx';
import { ErrorNote, Page, SectionTitle } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { HullChip } from '../components/ui/Status.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import ModelThumb from '../components/viewer/ModelThumb.jsx';
import { filterHref } from '../lib/search.js';
import { profileHref } from '../lib/people.js';
import { pageTitle } from '../lib/pageTitle.js';
import { targetHref } from '../lib/targets.js';
import { introSentence, pickReasons, reportText, shipTypeCounts, steps } from '../lib/targetPage.js';

const day = (s) => (s ? s.slice(0, 10) : '');
const SOLVE = { pass: ['검증 통과', 'text-n-700'], fail: ['검증 실패', 'text-err'], error: ['검증 오류', 'text-err'],
  stale: ['다시 검증 필요', 'text-wait'], pending: ['검증 중', 'text-n-600'] };
const BASE_SHOWN = 5;
const RECORDS_SHOWN = 10;

/** 그림 — 3D 썸네일, 없으면(모델 없는 자료) 보고서 그림, 그것도 없으면 종류 아이콘. 바탕과 구분되게 테두리를 준다. */
function Thumb({ r, className }) {
  const icon = (
    <div aria-hidden="true" className={`flex items-center justify-center border border-n-200 bg-n-0 text-n-400 ${className}`}>
      {r.kind_counts?.model || r.kind_counts?.model_view ? <Box size={18} strokeWidth={1.5} /> : <FileText size={18} strokeWidth={1.5} />}
    </div>
  );
  if (r.thumb) return <ModelThumb fileId={r.thumb.file_id} modelKey={r.thumb.model_key} alt="" className={className} />;
  if (r.cover) return <ModelThumb kind="cover" fileId={r.cover.file_id} modelKey={r.cover.key} alt="" className={className} fallback={icon} />;
  return icon;
}

function Solve({ status }) {
  const [label, tone] = SOLVE[status] || [];
  return label ? <span className={tone}>{label}</span> : <span className="text-n-500">검증 전</span>;
}

/** 본문 구역 — 제목(위 여백이 아래보다 크다) + 내용. id 는 시작 순서 줄이 가리킨다. */
function Section({ id, title, hint, count, action, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-n-200 pb-2">
        <h2 id={`${id}-h`} className="text-body font-semibold text-n-900">{title}</h2>
        {count != null && <span className="font-mono text-meta text-n-500">{count}</span>}
        {hint && <span className="text-meta text-n-600">{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** 자료 한 줄 — 그림, 제목, 호선, 담당, 날짜, (고른 이유), 결론. */
function EntryRow({ r, reasons = false, big = false }) {
  const why = reasons ? pickReasons(r) : [];
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Thumb r={r} className={`${big ? 'h-[75px] w-[120px]' : 'h-12 w-20'} shrink-0 rounded-sm`} />
      <div className="min-w-0 flex-1">
        <Link to={`/e/${r.entry_id}`} className="text-body font-medium text-n-900 hover:text-brand hover:underline">{r.title}</Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-n-600">
          {r.hulls?.map((h) => <HullChip key={h} hull={h} />)}
          {r.assignees?.length > 0 && <span>담당 {r.assignees.map((a) => a.name).join(', ')}</span>}
          {r.posted_at && <span className="font-mono">{day(r.posted_at)}</span>}
          {reportText(r.report) && <span className="min-w-0 truncate">보고서 {reportText(r.report)}</span>}
        </p>
        {why.length > 0 && <p className="mt-0.5 text-meta text-n-600">고른 이유: {why.join(', ')}</p>}
        {r.conclusion && <p className="mt-1 text-ui text-n-800"><span className="mr-1.5 text-meta text-n-500">결론</span>{r.conclusion}</p>}
      </div>
    </li>
  );
}

/** 먼저 볼 예제 한 건(자동으로 고름, 2단계에서 사람이 고정하면 그것이 대표 예제) — 왼쪽 3D 그림, 오른쪽 사실 목록과 동작. 카드가 아니라 헤어라인으로 나눈 영역. */
function Featured({ r }) {
  const facts = [
    ['호선', r.hulls?.length ? <span className="flex flex-wrap gap-1.5">{r.hulls.map((h) => <HullChip key={h} hull={h} />)}</span> : '공용'],
    ['선종', r.ship_types?.join(', ') || '-'],
    ['담당', r.assignees?.map((a) => a.name).join(', ') || '-'],
    ['날짜', <span className="font-mono">{day(r.posted_at) || '-'}</span>],
    ['모델', r.elements != null ? <>요소 <span className="font-mono">{r.elements.toLocaleString()}</span>개</> : '-'],
    ['해석 검증', <Solve status={r.solve} />],
    ['보고서', reportText(r.report) || '-'],
  ];
  const reasons = pickReasons(r);
  return (
    <section id="example" aria-labelledby="example-h" className="scroll-mt-4 grid gap-5 border-y border-n-200 py-5 min-[900px]:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
      <Thumb r={r} className="aspect-[16/10] w-full rounded-md" />
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 id="example-h" className="text-meta font-medium text-n-600">먼저 볼 예제</h2>
          <Link to={`/e/${r.entry_id}`} className="mt-1 block text-[18px] leading-7 font-semibold tracking-[-0.01em] text-n-900 hover:text-brand">{r.title}</Link>
          {reasons.length > 0 && <p className="mt-0.5 text-meta text-n-600">고른 이유: {reasons.join(', ')}</p>}
        </div>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ui">
          {facts.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-n-600">{k}</dt><dd className="min-w-0 text-n-900">{v}</dd></div>
          ))}
        </dl>
        <p className="text-ui text-n-800">
          {r.conclusion ? <><span className="mr-1.5 text-meta text-n-500">결론</span>{r.conclusion}</> : <span className="text-n-600">결론이 아직 없습니다. 보고서에서 확인하세요.</span>}
        </p>
        <div className="mt-auto flex flex-wrap gap-2">
          <Link to={`/e/${r.entry_id}`} className={buttonClass('primary', 'sm')}>자료 열기</Link>
          {r.thumb && <Link to={`/v/${r.thumb.file_id}`} className={buttonClass('secondary', 'sm')}><Rotate3d size={14} aria-hidden="true" />3D 로 보기</Link>}
        </div>
      </div>
    </section>
  );
}

/** 실적 — 선종 거르기, 처음 10행 + 펼치기, [표 | 그림] 전환(그림 보기가 따로 있던 모델 모음을 대신한다). */
function Records({ rows }) {
  const [ship, setShip] = useState('');
  const [view, setView] = useState('table');
  const [all, setAll] = useState(false);
  const ships = useMemo(() => shipTypeCounts(rows), [rows]);
  const shown = ship ? rows.filter((r) => (r.ship_types?.length ? r.ship_types : ['선종 모름']).includes(ship)) : rows;
  const cut = all ? shown : shown.slice(0, RECORDS_SHOWN);
  const chip = (on) => `inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta transition-colors duration-150 ${
    on ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-n-200 bg-n-0 text-n-700 hover:bg-n-50'}`;
  return (
    <Section id="records" title="실적" count={rows.length} hint="호선이 있는 자료, 최근 순"
             action={<Segmented label="실적 보기" size="sm" value={view} onChange={setView}
                                items={[{ id: 'table', label: '표' }, { id: 'grid', label: '그림' }]} />}>
      {ships.length > 1 && (
        <div role="group" aria-label="선종으로 거르기" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!ship} className={chip(!ship)} onClick={() => setShip('')}>전체 <span className="font-mono">{rows.length}</span></button>
          {ships.map((s) => (
            <button key={s.value} type="button" aria-pressed={ship === s.value} className={chip(ship === s.value)}
                    onClick={() => setShip(ship === s.value ? '' : s.value)}>{s.value} <span className="font-mono">{s.count}</span></button>
          ))}
        </div>
      )}
      {view === 'table' ? (
        <div className="overflow-x-auto rounded-md border border-n-200">
          <table className="w-full min-w-[720px] text-left text-ui">
            <thead className="bg-n-50 text-meta text-n-600">
              <tr><th className="w-[80px] px-3 py-1.5"><span className="sr-only">그림</span></th><th className="px-3 py-1.5">호선</th>
                <th className="px-3 py-1.5">자료</th><th className="px-3 py-1.5">담당</th><th className="px-3 py-1.5">날짜</th><th className="px-3 py-1.5">해석 검증</th></tr>
            </thead>
            <tbody>
              {cut.map((r) => (
                <tr key={r.entry_id} className="border-t border-n-200 align-middle">
                  <td className="px-3 py-1.5"><Thumb r={r} className="h-10 w-16 rounded-xs" /></td>
                  <td className="px-3 py-1.5"><span className="flex flex-wrap gap-1">{r.hulls.map((h) => <HullChip key={h} hull={h} />)}</span>
                    {r.ship_types?.length > 0 && <span className="mt-0.5 block text-micro text-n-600">{r.ship_types.join(', ')}</span>}</td>
                  <td className="max-w-[420px] px-3 py-1.5"><Link to={`/e/${r.entry_id}`} className="font-medium text-n-900 hover:text-brand hover:underline">{r.title}</Link></td>
                  <td className="px-3 py-1.5 text-n-700">{(r.assignees || []).map((a) => a.name).join(', ') || '-'}</td>
                  <td className="px-3 py-1.5 font-mono text-meta text-n-600">{day(r.posted_at)}</td>
                  <td className="px-3 py-1.5 text-meta"><Solve status={r.solve} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="실적 그림" className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-4 gap-y-5">
          {cut.map((r) => (
            <li key={r.entry_id}>
              <Link to={`/e/${r.entry_id}`} className="group flex flex-col gap-1.5">
                <Thumb r={r} className="aspect-[16/10] w-full rounded-md" />
                <span className="truncate text-ui font-medium text-n-900 group-hover:text-brand">{r.title}</span>
                <span className="font-mono text-micro text-n-600">{r.hulls.join(', ')}{r.elements != null && `  요소 ${r.elements.toLocaleString()}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shown.length > RECORDS_SHOWN && (
        <div><Button variant="ghost" size="sm" onClick={() => setAll(!all)}>{all ? '처음 10건만 보기' : `모두 보기 ${shown.length}`}</Button></div>
      )}
    </Section>
  );
}

/** 레일 — 누구에게 물을까, 선종 분포, 자료 갖춤(고칠 수 있는 사람에게만 목록을 펼친다). */
function Rail({ d }) {
  const recs = d.records;
  const gaps = [['no_conclusion', '결론 없음'], ['no_report', '보고서 빠짐'], ['no_model', '모델 빠짐']];
  return (
    <aside aria-label="업무 정보" className="flex flex-col gap-7 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:self-start">
      <section id="people" aria-labelledby="people-h" className="scroll-mt-4">
        <SectionTitle as="h2" className="mb-2"><span id="people-h">누구에게 물을까</span></SectionTitle>
        {d.people.length ? (
          <ul className="flex flex-col">
            {d.people.map((p, i) => (
              <li key={p.id}>
                <Link to={profileHref(p)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-n-50">
                  <span className="min-w-0">
                    <span className="text-ui font-medium text-n-900">{p.name}</span>
                    {!p.employed && <span className="ml-1 text-meta text-n-500">(퇴사)</span>}
                    {i === 0 && p.count > 1 && <span className="ml-1.5 text-meta text-brand">주 담당</span>}
                    {p.department && <span className="block truncate text-meta text-n-600">{p.department}</span>}
                  </span>
                  <span className="font-mono text-meta text-n-600">{p.count}건</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-meta text-n-600">담당자를 넣은 자료가 없습니다.</p>}
      </section>
      {recs.length > 0 && (
        <Distribution title="선종" rows={shipTypeCounts(recs)} limit={6}
                      hrefOf={(r) => (r.value === '선종 모름' ? filterHref('target', d.value) : `${filterHref('target', d.value)}&ship_type=${encodeURIComponent(r.value)}`)} />
      )}
      <section aria-labelledby="gaps-h">
        <SectionTitle as="h2" className="mb-1.5"><span id="gaps-h">자료 갖춤</span></SectionTitle>
        <p className="text-ui text-n-700">
          결론 <span className="font-mono">{d.counts.entries - d.gaps.no_conclusion.count}/{d.counts.entries}</span>
          {d.gaps.no_report.count > 0 && <>, 보고서 빠짐 <span className="font-mono">{d.gaps.no_report.count}</span></>}
          {d.gaps.no_model.count > 0 && <>, 모델 빠짐 <span className="font-mono">{d.gaps.no_model.count}</span></>}
        </p>
        {d.can_fix && (
          <div className="mt-2 flex flex-col gap-1">
            {gaps.filter(([k]) => d.gaps[k].count > 0).map(([k, label]) => (
              <details key={k} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-meta text-n-700 hover:text-n-900 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={13} aria-hidden="true" className="text-n-500 transition-transform duration-150 group-open:rotate-90" />
                  {label} 자료 보기 <span className="font-mono">{d.gaps[k].count}</span>
                </summary>
                <ul className="mt-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto pl-4">
                  {d.gaps[k].items.map((it) => (
                    <li key={it.entry_id} className="truncate text-meta">
                      <Link to={`/e/${it.entry_id}`} className="hover:text-brand hover:underline"><span className="font-mono text-n-500">{it.entry_id}</span> {it.title}</Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

/**
 * 69 — 대상 화면(/t/Unit): 업무 안내. 머리(이름, 소개 문장, 시작 순서) → 먼저 볼 예제 → 본문(기준 문서, 비슷한 최근 예제, 결론, 실적) + 레일(사람, 선종, 갖춤).
 * 한 자료는 한 곳에서만 크게 보인다. 확정 자료만, 보는 사람의 열람 권한대로(GET /api/targets/page).
 */
export default function TargetPage() {
  const { value: raw } = useParams();
  const value = decodeURIComponent(raw || '');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [baseAll, setBaseAll] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setD(null); setError('');
    api(`/targets/page?value=${encodeURIComponent(value)}`)
      .then((r) => { if (alive) setD(r); })
      .catch(() => { if (alive) setError('이 업무의 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); });
    return () => { alive = false; };
  }, [value, tick]);
  useEffect(() => { document.title = pageTitle(`/t/${encodeURIComponent(d?.value || value)}`); }, [d, value]);

  const back = <Link to="/targets" className="inline-flex items-center gap-1 text-meta text-n-600 hover:text-brand"><ArrowLeft size={13} aria-hidden="true" />업무별 모음</Link>;
  if (error) return <Page>{back}<ErrorNote className="mt-3" action={<Button variant="secondary" size="sm" onClick={() => setTick((t) => t + 1)}>다시 시도</Button>}>{error}</ErrorNote></Page>;
  if (!d) return <Page>{back}<BlockSkeleton className="mt-3 h-64" /></Page>;
  const featured = d.start[0];
  const examples = d.start.slice(1);
  const base = baseAll ? d.base_docs : d.base_docs.slice(0, BASE_SHOWN);
  const flow = steps(d);
  const intro = introSentence(d);
  return (
    <Page>
      {back}
      <header className="mt-2 mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">{d.value}</h1>
          {d.synonyms.length > 0 && <span className="pb-1 text-ui text-n-600">같은 말 {d.synonyms.join(', ')}</span>}
          {d.group && (
            <span className="pb-1 text-ui text-n-600">묶음 <Link to={targetHref(d.group)} className="text-brand hover:underline">{d.group}</Link></span>
          )}
          <Link to={filterHref('target', d.value)} className={`${buttonClass('ghost', 'sm')} ml-auto`}><Search size={14} aria-hidden="true" />검색에서 모두 보기</Link>
        </div>
        {intro && <p className="max-w-[72ch] text-body text-n-700 [text-wrap:pretty]">{intro}</p>}
        {/* 71 — 묶음이면 하위 업무 자료까지 이 화면에 모인다. 하위 업무 화면으로 바로 가는 줄 */}
        {d.children?.length > 0 && (
          <nav aria-label="하위 업무" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-ui">
            <span className="mr-1.5 text-meta text-n-600">하위 업무 자료도 모았습니다</span>
            {d.children.map((c) => (
              <Link key={c.value} to={targetHref(c.value)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 px-2 text-n-800 hover:border-n-300 hover:text-brand">
                {c.value}<span className="font-mono text-meta text-n-500">{c.entries}</span>
              </Link>
            ))}
          </nav>
        )}
        {flow.length > 1 && (
          <nav aria-label="처음이면 이 순서로">
            <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-ui">
              <li className="mr-1.5 text-meta text-n-600">처음이면 이 순서로</li>
              {flow.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={13} aria-hidden="true" className="text-n-400" />}
                  <a href={`#${s.id}`} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-n-800 hover:bg-n-50 hover:text-brand">
                    <span className="font-mono text-meta text-n-500">{i + 1}</span>{s.label}
                    {s.count != null && <span className="font-mono text-meta text-n-500">{s.count}</span>}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </header>
      {d.counts.entries === 0 ? (
        <p className="rounded-md border border-dashed border-n-200 px-4 py-8 text-center text-ui text-n-600">볼 수 있는 확정 자료가 없습니다.</p>
      ) : (
        <>
          {featured && <Featured r={featured} />}
          <div className="mt-8 grid grid-cols-1 gap-10 min-[1100px]:grid-cols-[minmax(0,1fr)_272px]">
            <div className="flex min-w-0 flex-col gap-10">
              <Section id="base" title="기준부터 읽기" count={d.base_docs.length} hint="호선 없이 올린 지침, 기준, 참고 문서">
                {d.base_docs.length ? (
                  <>
                    <ul className="divide-y divide-n-200">{base.map((r) => <EntryRow key={r.entry_id} r={r} />)}</ul>
                    {d.base_docs.length > BASE_SHOWN && (
                      <div><Button variant="ghost" size="sm" onClick={() => setBaseAll(!baseAll)}>
                        {baseAll ? '처음 5건만 보기' : `나머지 ${d.base_docs.length - BASE_SHOWN}건 더 보기`}</Button></div>
                    )}
                  </>
                ) : <p className="text-meta text-n-600">아직 없습니다. 지침, 사내 기준, 참고 논문을 '호선 없음(공용)'으로 올리면 여기에 모입니다.</p>}
              </Section>
              {examples.length > 0 && (
                <Section id="examples" title="비슷한 최근 예제" hint="같은 기준으로 고른 다음 자료">
                  <ul className="divide-y divide-n-200">{examples.map((r) => <EntryRow key={r.entry_id} r={r} reasons big />)}</ul>
                </Section>
              )}
              {d.conclusions.length >= 3 && (
                <Section id="conclusions" title="결론과 주의점" count={d.conclusions.length} hint="지난 해석에서 알게 된 것">
                  <ul className="divide-y divide-n-200">{d.conclusions.map((r) => <EntryRow key={r.entry_id} r={r} />)}</ul>
                </Section>
              )}
              {d.records.length > 0 && <Records rows={d.records} />}
            </div>
            <Rail d={d} />
          </div>
        </>
      )}
    </Page>
  );
}
