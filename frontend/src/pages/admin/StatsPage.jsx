import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { ErrorNote, Page, PageHeader, SectionTitle } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { errorText, formatBytes } from '../../lib/labels.js';

const th = 'h-9 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const thNum = `${th} text-right`;
const td = 'border-b border-n-200 px-3 py-2 text-ui';
const tdNum = `${td} text-right font-mono tabular-nums`;
const num = (n) => (n ?? 0).toLocaleString('ko-KR');

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-n-200 px-4 py-3">
      <div className="text-meta text-n-600">{label}</div>
      <div className="mt-1 font-mono text-[22px] leading-7 font-semibold tabular-nums text-n-900">{value}</div>
      {hint && <div className="mt-0.5 text-meta text-n-500">{hint}</div>}
    </div>
  );
}

/** 형식 묶음별 표 — 묶음을 누르면 확장자별로 펼친다. */
function CategoryTable({ categories }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (!categories.length) return <p className="text-ui text-n-500">확정 자료에 파일이 없습니다.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-n-200">
      <table className="w-full border-collapse">
        <thead>
          <tr><th className={th}>형식</th><th className={thNum}>파일 수</th><th className={thNum}>자료 수</th><th className={thNum}>용량</th></tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <Fragment key={c.key}>
              <tr className="hover:bg-n-50">
                <td className={td}>
                  <button type="button" onClick={() => toggle(c.key)} aria-expanded={open.has(c.key)}
                          className="flex items-center gap-1 font-medium text-n-900">
                    {open.has(c.key) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    {c.label}
                  </button>
                </td>
                <td className={tdNum}>{num(c.files)}</td>
                <td className={tdNum}>{num(c.entries)}</td>
                <td className={tdNum}>{formatBytes(c.bytes)}</td>
              </tr>
              {open.has(c.key) && c.exts.map((x) => (
                <tr key={`${c.key}${x.ext}`} className="bg-n-25 text-n-700">
                  <td className={`${td} pl-9 font-mono text-meta`}>{x.ext}</td>
                  <td className={tdNum}>{num(x.files)}</td>
                  <td className={tdNum}>{num(x.entries)}</td>
                  <td className={tdNum}>{formatBytes(x.bytes)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 월별 확정 자료 수 막대(파일 수는 숫자로). */
function Monthly({ monthly }) {
  if (!monthly.length) return <p className="text-ui text-n-500">확정 시각이 있는 자료가 없습니다.</p>;
  const max = Math.max(...monthly.map((m) => m.entries), 1);
  return (
    <ul aria-label="월별 확정 자료" className="flex flex-col gap-1.5">
      {monthly.map((m) => (
        <li key={m.month} className="grid grid-cols-[72px_minmax(0,1fr)_140px] items-center gap-3 text-ui">
          <span className="font-mono text-meta text-n-600">{m.month}</span>
          <span className="h-3 rounded-sm bg-n-100">
            <span className="block h-3 rounded-sm bg-brand" style={{ width: `${(m.entries / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-meta tabular-nums text-n-700">자료 {num(m.entries)} · 파일 {num(m.files)}</span>
        </li>
      ))}
    </ul>
  );
}

function TopList({ title, items }) {
  return (
    <div className="rounded-lg border border-n-200 p-3">
      <div className="mb-2 text-meta font-medium text-n-600">{title}</div>
      {items.length ? (
        <ol className="flex flex-col gap-1">
          {items.map((t) => (
            <li key={t.value} className="flex items-baseline justify-between gap-2 text-ui">
              <span className="truncate text-n-900">{t.value}</span>
              <span className="shrink-0 font-mono text-meta tabular-nums text-n-600">{num(t.entries)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="text-meta text-n-500">없음</p>}
    </div>
  );
}

/** 57 — 관리 › 자료 현황(LV3). 확정 자료 기준 통계 — 형식 묶음(Nastran·Abaqus 모델·결과·보고서·엑셀 등)·월별·분류 상위. */
export default function StatsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/stats').then(setData).catch((err) => setError(errorText(err, '자료 현황을 불러오지 못했습니다.')));
  }, []);
  const s = data?.summary;
  return (
    <Page>
      <PageHeader title="자료 현황" description="확정된 자료 기준입니다. 정리 대기 초안과 휴지통은 건수만 따로 보입니다." />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!data && !error && <RowsSkeleton rows={4} label="자료 현황을 불러오는 중" />}
      {data && (
        <div className="flex flex-col gap-8">
          <section aria-label="요약" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="확정 자료" value={num(s.confirmed)} hint={`정리 대기 ${num(s.drafts)} · 휴지통 ${num(s.trashed)}`} />
            <Stat label="파일" value={num(s.files)} />
            <Stat label="용량" value={formatBytes(s.bytes)} />
            <Stat label="호선" value={num(s.hulls)} />
            <Stat label="해석 모델"
                  value={num(data.categories.filter((c) => c.key === 'nastran' || c.key === 'abaqus').reduce((a, c) => a + c.files, 0))}
                  hint="Nastran + Abaqus 파일" />
          </section>
          <section>
            <SectionTitle className="mb-3">형식별</SectionTitle>
            <CategoryTable categories={data.categories} />
          </section>
          <section>
            <SectionTitle className="mb-3">월별 확정</SectionTitle>
            <Monthly monthly={data.monthly} />
          </section>
          <section>
            <SectionTitle className="mb-3">많이 쓰인 분류</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-3">
              <TopList title="구역" items={data.top.zones} />
              <TopList title="대상" items={data.top.targets} />
              <TopList title="호선" items={data.top.hulls} />
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
