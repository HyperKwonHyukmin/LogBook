import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, ChevronRight, Library, Search } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import ModelThumb from '../components/viewer/ModelThumb.jsx';
import { targetHref } from '../lib/targets.js';

/** 행 요약 문장 — "자료 44건, 호선 15척, 기초 자료 14건, 주 담당 권혁민". */
export function cardSentence(c) {
  const parts = [`자료 ${c.entries}건`];
  if (c.hulls) parts.push(`호선 ${c.hulls}척`);
  if (c.base_docs) parts.push(`기초 자료 ${c.base_docs}건`);
  if (c.lead && c.lead.count > 1) parts.push(`주 담당 ${c.lead.name}`);
  return parts.join(', ');
}

/**
 * 69 — 업무별 모음 첫 화면: 업무(대상) 행 목록. 행 = 3D 그림 + 이름 + 요약 문장 + 최근 날짜. 위에 거르기 칸.
 * '기타'는 여러 업무가 섞인 분류라 목록 아래 글 링크 한 줄로(검색으로 본다). 숫자는 볼 수 있는 확정 자료만(GET /api/targets).
 */
export default function TargetsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    api('/targets').then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setError('업무 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); });
    return () => { alive = false; };
  }, []);
  const all = data?.targets || [];
  const other = all.find((c) => c.other);
  const key = q.trim().toLowerCase();
  const rows = all.filter((c) => !c.other && (!key || c.value.toLowerCase().includes(key)));
  return (
    <Page>
      <PageHeader title="업무별 모음"
        description="업무(대상)마다 기준 문서, 먼저 볼 예제, 지난 실적, 물어볼 사람을 한 화면에 모았습니다. 처음 맡은 해석이나 복습할 때 여기서 시작하세요." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <BlockSkeleton className="h-40" />}
      {data && all.length === 0 && (
        <EmptyState icon={Library} title="아직 모을 자료가 없습니다">자료에 대상을 넣으면 여기에 업무별로 모입니다.</EmptyState>
      )}
      {data && all.length > 0 && (
        <div className="flex max-w-[960px] flex-col gap-3">
          <label className="relative w-full max-w-[320px]">
            <span className="sr-only">업무 찾기</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-500" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="업무 이름으로 찾기" className={inputClass('w-full pl-8')} />
          </label>
          <ul aria-label="업무 목록" className="divide-y divide-n-200 border-y border-n-200">
            {rows.map((c) => (
              <li key={c.value}>
                <Link to={targetHref(c.value)} className="group grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 px-1 py-3 transition-colors duration-150 hover:bg-n-50">
                  {c.thumb ? <ModelThumb fileId={c.thumb.file_id} modelKey={c.thumb.model_key} alt="" className="h-[60px] w-24 rounded-sm" />
                    : <span aria-hidden="true" className="flex h-[60px] w-24 items-center justify-center rounded-sm border border-n-200 bg-n-0 text-n-400"><Box size={18} strokeWidth={1.5} /></span>}
                  <span className="min-w-0">
                    <span className="block text-body font-semibold text-n-900 group-hover:text-brand">{c.value}</span>
                    <span className="block truncate text-meta text-n-600">{cardSentence(c)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-meta text-n-500">
                    {c.latest && <span className="font-mono">최근 {c.latest.slice(0, 10)}</span>}
                    <ChevronRight size={14} aria-hidden="true" className="text-n-400" />
                  </span>
                </Link>
              </li>
            ))}
            {rows.length === 0 && <li className="px-1 py-6 text-center text-ui text-n-600">‘{q}’ 에 맞는 업무가 없습니다.</li>}
          </ul>
          {other && (
            <p className="text-meta text-n-600">
              '기타' <span className="font-mono">{other.entries}</span>건은 여러 업무가 섞인 분류라{' '}
              <Link to={targetHref(other.value)} className="text-brand hover:underline">검색에서 봅니다</Link>.
            </p>
          )}
        </div>
      )}
    </Page>
  );
}
