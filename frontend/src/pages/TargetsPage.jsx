import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Library } from 'lucide-react';
import { api } from '../api/client.js';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import ModelThumb from '../components/viewer/ModelThumb.jsx';
import { targetHref } from '../lib/targets.js';

/**
 * 69 — 업무별 모음 첫 화면: 대상 카드 목록(자료 수 순, '기타'는 맨 뒤). 카드를 누르면 대상 화면(/t/Unit).
 * 숫자는 보는 사람이 볼 수 있는 확정 자료만(GET /api/targets).
 */
export default function TargetsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api('/targets').then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setError('업무 목록을 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, []);
  const cards = data?.targets || [];
  return (
    <Page>
      <PageHeader title="업무별 모음"
        description="대상(업무)마다 지난 실적, 모델, 기초 자료, 담당자를 한 화면에 모았습니다. 처음 맡은 해석이나 복습할 때 여기서 시작하세요." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <BlockSkeleton className="h-40" />}
      {data && cards.length === 0 && (
        <EmptyState icon={Library} title="아직 모을 자료가 없습니다">자료에 대상을 넣으면 여기에 업무별로 모입니다.</EmptyState>
      )}
      <ul aria-label="업무 목록" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {cards.map((c) => (
          <li key={c.value}>
            <Link to={targetHref(c.value)}
                  className={`group flex h-full flex-col overflow-hidden rounded-lg border border-n-200 bg-n-0 transition-colors duration-150 hover:border-brand-ring ${c.other ? 'opacity-80' : ''}`}>
              {c.thumb ? (
                <ModelThumb fileId={c.thumb.file_id} modelKey={c.thumb.model_key} alt="" className="aspect-[16/9] w-full" />
              ) : (
                <div aria-hidden="true" className="flex aspect-[16/9] w-full items-center justify-center bg-n-50 text-n-400"><Box size={22} strokeWidth={1.5} /></div>
              )}
              <div className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="text-body font-semibold text-n-900 group-hover:text-brand">{c.value}</span>
                <span className="text-meta text-n-600">
                  자료 <span className="font-mono">{c.entries}</span>건, 호선 <span className="font-mono">{c.hulls}</span>척
                </span>
                {c.latest && <span className="font-mono text-micro text-n-500">최근 {c.latest.slice(0, 10)}</span>}
                {c.other && <span className="text-micro text-n-500">여러 업무가 섞인 분류라 검색으로 봅니다</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
