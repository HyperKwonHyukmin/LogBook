import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, Shield } from 'lucide-react';
import { api } from '../api/client.js';
import ResultList from '../components/search/ResultList.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader, SectionTitle } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { pageTitle } from '../lib/pageTitle.js';

const PAGE = 50;

/**
 * 74 3단계 — 팀 공간(/team/:id). 그 팀원과 관리자만 열린다(그 밖에는 서버가 없는 팀처럼 404).
 * 팀 자료(공개 범위 '팀 전용') 목록과 공간 안 찾기, 확정 전 팀 초안 수, 팀원 명단. 목록은 검색 API 의 team= 거르기.
 */
export default function TeamSpacePage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [res, setRes] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { if (team?.name) document.title = pageTitle(`/team/${teamId}`, team.name); }, [teamId, team]);

  useEffect(() => {
    let alive = true;
    setTeam(null); setError('');
    api(`/teams/${encodeURIComponent(teamId)}`)
      .then((t) => { if (alive) setTeam(t); })
      .catch((err) => { if (alive) setError(err?.status === 404 ? '없는 팀이거나 이 팀의 팀원이 아닙니다.' : '팀 공간을 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [teamId]);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!team) return undefined;
    let alive = true;
    const p = new URLSearchParams({ team: String(team.id), limit: String(limit) });
    if (term) p.set('q', term);
    api(`/search?${p}`)
      .then((r) => { if (alive) setRes(r); })
      .catch(() => { if (alive) setRes({ items: [], total: 0, failed: true }); });
    return () => { alive = false; };
  }, [team, term, limit]);

  const open = (item) => navigate(`/e/${encodeURIComponent(item.entry_id)}`);
  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!team) return <Page><BlockSkeleton className="h-40" /></Page>;
  return (
    <Page>
      <PageHeader title={`${team.name} 팀 공간`}
        description={team.description || '팀 자료는 이 팀원과 관리자만 봅니다. 팀원 누구나 고치고 확정합니다.'} />
      <div className="grid max-w-[1200px] gap-6 lg:grid-cols-[minmax(0,1fr)_272px]">
        <section aria-label="팀 자료" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="relative w-full max-w-[360px]">
              <span className="sr-only">팀 자료에서 찾기</span>
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-500" />
              <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                     placeholder="제목, 파일 이름, 본문으로 찾기" className={inputClass('w-full pl-8')} />
            </label>
            <span className="text-meta text-n-600">
              팀 자료 <span className="font-mono">{res ? res.total : team.entries}</span>건{term ? ` (‘${term}’)` : ''}
            </span>
          </div>
          {res?.failed && <ErrorNote>팀 자료를 불러오지 못했습니다.</ErrorNote>}
          {res && !res.failed && res.items.length === 0 && (
            <EmptyState icon={Shield} title={term ? '맞는 팀 자료가 없습니다' : '아직 팀 자료가 없습니다'}>
              {term ? '다른 낱말로 찾아 보세요.' : '팀원이 올리는 자료는 처음부터 팀 전용으로 이 공간에 모입니다.'}
            </EmptyState>
          )}
          {res && res.items.length > 0 && (
            <ResultList unit="entry" items={res.items} onSelect={open} onOpen={open} terms={res.terms} filters={{}} />
          )}
          {res && res.items.length < res.total && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE)}
                    className="mt-3 text-ui text-brand hover:underline">더 보기</button>
          )}
        </section>
        <aside aria-label="팀 정보" className="flex flex-col gap-5">
          <div>
            <SectionTitle>확정 전 팀 초안</SectionTitle>
            <p className="mt-1 text-ui text-n-800">
              <span className="font-mono">{team.drafts}</span>건
              {team.drafts > 0 && <Link to="/inbox" className="ml-2 text-brand hover:underline">올리기와 확정에서 보기</Link>}
            </p>
            <p className="mt-0.5 text-meta text-n-500">확정해야 팀 자료 목록과 검색에 나옵니다.</p>
          </div>
          <div>
            <SectionTitle>팀원 <span className="font-mono font-normal text-n-500">{team.members.length}</span></SectionTitle>
            <ul aria-label="팀원 명단" className="mt-1.5 flex flex-col gap-1">
              {team.members.map((m) => (
                <li key={m.employee_id} className="text-ui text-n-800">
                  {m.name || m.employee_id}
                  {m.department && <span className="ml-1.5 text-meta text-n-500">{m.department}</span>}
                </li>
              ))}
              {!team.members.length && <li className="text-meta text-n-500">아직 팀원이 없습니다.</li>}
            </ul>
            <p className="mt-1.5 text-meta text-n-500">팀원은 관리자가 정합니다.</p>
          </div>
        </aside>
      </div>
    </Page>
  );
}
