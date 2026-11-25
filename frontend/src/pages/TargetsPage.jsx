import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, ChevronRight, Library, Search, Shield } from 'lucide-react';
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
 * 71 — 대상 묶음: 하위 업무를 묶음 행 바로 아래로 모은다(묶음이 목록에 없으면 제자리). 찾는 중이면 평평하게.
 * 반환: [{card, child}] — child 면 들여 쓴다.
 */
export function nestRows(cards) {
  const byValue = new Map(cards.map((c) => [c.value, c]));
  const out = [];
  for (const c of cards) {
    if (c.group && byValue.has(c.group)) continue;
    out.push({ card: c, child: false });
    for (const v of c.children || []) if (byValue.has(v)) out.push({ card: byValue.get(v), child: true });
  }
  return out;
}

/**
 * 69 — 업무별 모음 첫 화면: 업무(대상) 행 목록. 행 = 3D 그림 + 이름 + 요약 문장 + 최근 날짜. 위에 거르기 칸.
 * '기타'는 여러 업무가 섞인 분류라 목록 아래 글 링크 한 줄로(검색으로 본다). 숫자는 볼 수 있는 확정 자료만(GET /api/targets).
 */
export default function TargetsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [teams, setTeams] = useState([]);   // 74 — 팀 공간 줄(팀원은 자기 팀, 관리자는 모든 팀, 그 밖에는 없음)
  useEffect(() => {
    let alive = true;
    api('/targets').then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setError('업무 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); });
    api('/teams').then((r) => { if (alive) setTeams(r || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const all = data?.targets || [];
  const other = all.find((c) => c.other);
  const key = q.trim().toLowerCase();
  const listed = all.filter((c) => !c.other);
  const rows = key ? listed.filter((c) => c.value.toLowerCase().includes(key) || (c.group || '').toLowerCase().includes(key))
    .map((card) => ({ card, child: false })) : nestRows(listed);
  return (
    <Page>
      <PageHeader title="업무별 모음"
        description="업무(대상)마다 기준 문서, 먼저 볼 예제, 지난 실적, 물어볼 사람을 한 화면에 모았습니다. 처음 맡은 해석이나 복습할 때 여기서 시작하세요." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <BlockSkeleton className="h-40" />}
      {teams.length > 0 && (
        <ul aria-label="팀 공간" className="mb-4 flex max-w-[960px] flex-col gap-2">
          {teams.map((t) => (
            <li key={t.id}>
              <Link to={`/team/${t.id}`}
                    className="group grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-n-200 bg-n-0 py-3 pl-1 pr-3 transition-colors duration-150 hover:bg-n-50">
                <span aria-hidden="true" className="flex h-[60px] w-24 items-center justify-center rounded-sm bg-brand-subtle text-brand">
                  <Shield size={20} strokeWidth={1.5} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-body font-semibold text-n-900 group-hover:text-brand">
                    {t.name}
                    <span className="inline-flex h-5 items-center rounded-xs bg-n-100 px-1.5 text-micro font-medium text-n-700">팀 전용</span>
                  </span>
                  <span className="block truncate text-meta text-n-600">
                    {`팀 자료 ${t.entries}건, 팀원 ${t.members}명${t.drafts ? `, 확정 전 초안 ${t.drafts}건` : ''}`}
                    {t.description ? `, ${t.description}` : ''}
                  </span>
                </span>
                <ChevronRight size={14} aria-hidden="true" className="text-n-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
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
            {rows.map(({ card: c, child }) => (
              <li key={c.value}>
                <Link to={targetHref(c.value)}
                      className={`group grid items-center gap-4 py-3 pr-1 transition-colors duration-150 hover:bg-n-50
                        ${child ? 'grid-cols-[64px_minmax(0,1fr)_auto] pl-10' : 'grid-cols-[96px_minmax(0,1fr)_auto] pl-1'}`}>
                  {c.thumb ? <ModelThumb fileId={c.thumb.file_id} modelKey={c.thumb.model_key} alt="" className={`${child ? 'h-10 w-16' : 'h-[60px] w-24'} rounded-sm`} />
                    : <span aria-hidden="true" className={`flex ${child ? 'h-10 w-16' : 'h-[60px] w-24'} items-center justify-center rounded-sm border border-n-200 bg-n-0 text-n-400`}><Box size={child ? 15 : 18} strokeWidth={1.5} /></span>}
                  <span className="min-w-0">
                    <span className={`block font-semibold text-n-900 group-hover:text-brand ${child ? 'text-ui' : 'text-body'}`}>
                      {c.value}
                      {!child && c.children?.length > 0 && <span className="ml-2 text-meta font-normal text-n-500">하위 업무 {c.children.length}개 포함</span>}
                      {key && c.group && <span className="ml-2 text-meta font-normal text-n-500">묶음 {c.group}</span>}
                    </span>
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
