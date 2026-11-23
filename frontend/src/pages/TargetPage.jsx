import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Box, ChevronRight, FileText, Search } from 'lucide-react';
import { api } from '../api/client.js';
import { buttonClass } from '../components/ui/Button.jsx';
import { ErrorNote, Page, PageHeader, SectionTitle } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import ModelThumb from '../components/viewer/ModelThumb.jsx';
import { filterHref } from '../lib/search.js';
import { profileHref } from '../lib/people.js';
import { pageTitle } from '../lib/pageTitle.js';

const day = (s) => (s ? s.slice(0, 10) : '');
const SOLVE = { pass: '검증 통과', fail: '검증 실패', error: '검증 오류', stale: '다시 검증 필요', pending: '검증 중' };

/** 작은 그림 — 3D 썸네일, 없으면(모델 없는 자료) 보고서 그림, 그것도 없으면 아이콘. */
function Thumb({ r, className }) {
  if (r.thumb) return <ModelThumb fileId={r.thumb.file_id} modelKey={r.thumb.model_key} alt="" className={className} />;
  const icon = <div aria-hidden="true" className={`flex items-center justify-center bg-n-50 text-n-400 ${className}`}>
    {(r.kind_counts?.model ? <Box size={18} strokeWidth={1.5} /> : <FileText size={18} strokeWidth={1.5} />)}</div>;
  if (r.cover) return <ModelThumb kind="cover" fileId={r.cover.file_id} modelKey={r.cover.key} alt="" className={className} fallback={icon} />;
  return icon;
}

/** 자료 한 줄(그림, 제목, 호선, 담당자, 날짜, 결론). */
function EntryRow({ r }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <Thumb r={r} className="h-12 w-20 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/e/${r.entry_id}`} className="text-ui font-medium text-n-900 hover:text-brand hover:underline">{r.title}</Link>
        <p className="flex flex-wrap gap-x-2.5 text-meta text-n-600">
          <span className="font-mono text-n-500">{r.entry_id}</span>
          {r.hulls?.length > 0 && <span className="font-mono">{r.hulls.join(', ')}</span>}
          {r.assignees?.length > 0 && <span>담당 {r.assignees.map((a) => a.name).join(', ')}</span>}
          {r.posted_at && <span className="font-mono">{day(r.posted_at)}</span>}
        </p>
        {r.conclusion && <p className="mt-0.5 text-meta text-n-800"><span className="mr-1.5 text-n-500">결론</span>{r.conclusion}</p>}
      </div>
    </li>
  );
}

function Section({ title, hint, count, children }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <SectionTitle>{title}</SectionTitle>
        {count != null && <span className="font-mono text-meta text-n-500">{count}</span>}
        {hint && <span className="text-meta text-n-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }) => <p className="rounded-md border border-dashed border-n-200 px-3 py-4 text-meta text-n-600">{children}</p>;

/**
 * 69 — 대상 화면(/t/Unit): 처음이면 여기부터, 기초 자료와 참고 문서(공용 자료), 결론과 주의점(있을 때만), 실적 표, 모델 모음,
 * 누구에게 물을까, 빈 곳. 확정 자료만, 보는 사람의 열람 권한대로(GET /api/targets/page).
 */
export default function TargetPage() {
  const { value: raw } = useParams();
  const value = decodeURIComponent(raw || '');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setD(null); setError('');
    api(`/targets/page?value=${encodeURIComponent(value)}`)
      .then((r) => { if (alive) setD(r); })
      .catch(() => { if (alive) setError('이 업무의 자료를 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [value]);
  useEffect(() => { document.title = pageTitle(`/t/${encodeURIComponent(d?.value || value)}`); }, [d, value]);

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!d) return <Page><BlockSkeleton className="h-64" /></Page>;
  const c = d.counts;
  const gaps = [
    ['no_conclusion', '결론 없음', '결론 한 줄을 남기면 이 화면의 결론 모음과 검색 결과에 보입니다'],
    ['no_report', '보고서 없음', '모델은 있는데 보고서가 없습니다'],
    ['no_model', '모델 없음', '보고서는 있는데 모델이 없습니다'],
  ];
  return (
    <Page>
      <PageHeader title={d.value}
        description={<>업무별 모음{d.synonyms.length > 0 && <>, 같은 말: {d.synonyms.join(', ')}</>}</>}
        actions={<Link to={filterHref('target', d.value)} className={buttonClass('secondary', 'sm')}><Search size={14} aria-hidden="true" />검색에서 모두 보기</Link>}>
        <p className="mt-2 flex flex-wrap gap-x-4 text-ui text-n-700">
          <span>자료 <span className="font-mono">{c.entries}</span>건</span>
          <span>호선 <span className="font-mono">{c.hulls}</span>척</span>
          <span>담당자 <span className="font-mono">{c.assignees}</span>명</span>
          {c.latest && <span>최근 <span className="font-mono">{day(c.latest)}</span></span>}
        </p>
      </PageHeader>
      {c.entries === 0 ? <Empty>볼 수 있는 확정 자료가 없습니다.</Empty> : (
        <div className="flex flex-col gap-8">
          <Section title="처음이면 여기부터" hint="모델과 보고서가 다 있는 자료, 결론이 있는 것 먼저">
            {d.start.length ? <ul className="divide-y divide-n-200">{d.start.map((r) => <EntryRow key={r.entry_id} r={r} />)}</ul>
              : <Empty>아직 고를 자료가 없습니다.</Empty>}
          </Section>
          <Section title="기초 자료와 참고 문서" count={d.base_docs.length} hint="호선 없이 올린 공용 자료">
            {d.base_docs.length ? <ul className="divide-y divide-n-200">{d.base_docs.map((r) => <EntryRow key={r.entry_id} r={r} />)}</ul>
              : <Empty>공용 자료가 없습니다. 지침, 사내 기준, 참고 논문 등을 '호선 없음(공용)'으로 올리면 여기에 모입니다.</Empty>}
          </Section>
          {d.conclusions.length > 0 && (
            <Section title="결론과 주의점" count={d.conclusions.length}>
              <ul className="divide-y divide-n-200">{d.conclusions.map((r) => <EntryRow key={r.entry_id} r={r} />)}</ul>
            </Section>
          )}
          <Section title="실적" count={d.records.length} hint="호선이 있는 자료, 최근 순">
            <div className="overflow-x-auto rounded-md border border-n-200">
              <table className="w-full min-w-[760px] text-left text-ui">
                <thead className="bg-n-50 text-meta text-n-600">
                  <tr><th className="px-3 py-1.5">호선</th><th className="px-3 py-1.5">선종</th><th className="px-3 py-1.5">자료</th>
                    <th className="px-3 py-1.5">담당자</th><th className="px-3 py-1.5">날짜</th><th className="px-3 py-1.5">해석 검증</th></tr>
                </thead>
                <tbody>
                  {d.records.map((r) => (
                    <tr key={r.entry_id} className="border-t border-n-200 align-top">
                      <td className="px-3 py-1.5 font-mono">{r.hulls.map((h) => <Link key={h} to={`/h/${h}`} className="mr-1.5 hover:text-brand hover:underline">{h}</Link>)}</td>
                      <td className="px-3 py-1.5 text-n-700">{(r.ship_types || []).join(', ') || '-'}</td>
                      <td className="px-3 py-1.5">
                        <Link to={`/e/${r.entry_id}`} className="font-medium text-n-900 hover:text-brand hover:underline">{r.title}</Link>
                        {r.conclusion && <span className="block text-meta text-n-600">{r.conclusion}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-n-700">{(r.assignees || []).map((a) => a.name).join(', ') || '-'}</td>
                      <td className="px-3 py-1.5 font-mono text-meta text-n-600">{day(r.posted_at)}</td>
                      <td className="px-3 py-1.5 text-meta text-n-600">{SOLVE[r.solve] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="모델 모음" count={d.models.length} hint="내용이 같은 모델은 한 칸">
            {d.models.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {d.models.map((m) => (
                  <li key={m.model_key}>
                    <Link to={`/e/${m.entry_id}`} className="group flex flex-col overflow-hidden rounded-md border border-n-200 hover:border-brand-ring">
                      <ModelThumb fileId={m.file_id} modelKey={m.model_key} alt="" className="aspect-[16/10] w-full" />
                      <span className="truncate px-2 pt-1.5 text-meta font-medium text-n-900 group-hover:text-brand">{m.title}</span>
                      <span className="px-2 pb-1.5 text-micro text-n-500">
                        {m.hulls?.join(', ')}{m.elements != null && <>  요소 <span className="font-mono">{m.elements.toLocaleString()}</span></>}
                        {m.same > 0 && <>  같은 모델 {m.same}건 더</>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty>3D 로 볼 수 있는 모델이 아직 없습니다.</Empty>}
          </Section>
          <Section title="누구에게 물을까" hint="이 업무를 맡은 자료 수 순">
            {d.people.length ? (
              <ul className="flex flex-wrap gap-2">
                {d.people.map((p) => (
                  <li key={p.id}>
                    <Link to={profileHref(p)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-n-200 bg-n-0 px-3 text-ui hover:border-brand-ring hover:text-brand">
                      {p.name}{!p.employed && <span className="text-meta text-n-500">(퇴사)</span>}
                      <span className="font-mono text-meta text-n-500">{p.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty>담당자를 넣은 자료가 없습니다.</Empty>}
          </Section>
          <Section title="빈 곳" hint="채우면 이 화면이 더 쓸모 있어집니다">
            <div className="grid gap-2 min-[900px]:grid-cols-3">
              {gaps.map(([k, label, help]) => (
                <details key={k} className="group rounded-md border border-n-200 bg-n-0">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-ui [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} aria-hidden="true" className="text-n-500 transition-transform duration-150 group-open:rotate-90" />
                    {label} <span className="font-mono text-n-600">{d.gaps[k].count}</span>건
                  </summary>
                  <div className="border-t border-n-200 px-3 py-2 text-meta">
                    <p className="text-n-600">{help}</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {d.gaps[k].items.map((it) => (
                        <li key={it.entry_id}><Link to={`/e/${it.entry_id}`} className="hover:text-brand hover:underline">
                          <span className="font-mono text-n-500">{it.entry_id}</span> {it.title}</Link></li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </Section>
        </div>
      )}
    </Page>
  );
}
