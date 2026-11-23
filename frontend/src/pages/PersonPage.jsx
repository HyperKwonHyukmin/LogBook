import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, UserRound } from 'lucide-react';
import { api } from '../api/client.js';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import Distribution from '../components/ui/Distribution.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import { FavoriteToggle } from '../components/favorites/Favorites.jsx';
import { AccessBadge } from '../components/access/AccessPanel.jsx';
import { ErrorNote, Page, SectionTitle } from '../components/ui/Page.jsx';
import { Bar } from '../components/ui/Skeleton.jsx';
import BackButton from '../components/ui/BackButton.jsx';
import { errorText } from '../lib/labels.js';
import { pageTitle } from '../lib/pageTitle.js';
import { profileApi, profileHref, ROLE_LABEL } from '../lib/people.js';

const monthLabel = (m) => {
  const [y, mo] = (m || '').split('-');
  return y && mo ? `${y}년 ${Number(mo)}월` : m || '날짜 없음';
};
const mmdd = (iso) => (iso ? iso.slice(5, 10) : '—');
const HANDOVER_FIRST = 5;

/** 남긴 결론과 주의점 — 퇴사자 카드에서는 맨 위(인수인계 묶음), 그 밖에는 목록 아래. */
function Handover({ rows }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, HANDOVER_FIRST);
  return (
    <section aria-label="남긴 결론과 주의점">
      <SectionTitle className="mb-2">남긴 결론과 주의점 <span className="font-mono text-meta font-normal text-n-500">{rows.length}</span></SectionTitle>
      <ul className="flex flex-col gap-2">
        {shown.map((e) => (
          <li key={e.entry_id} className="rounded-lg border border-n-200 px-3 py-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <Link to={`/e/${e.entry_id}`} className="truncate text-ui font-semibold text-n-900 hover:underline">{e.title}</Link>
              <span className="shrink-0 font-mono text-meta text-n-500">{e.entry_id}</span>
            </div>
            {e.conclusion && <p className="mt-1 text-ui text-n-800">{e.conclusion}</p>}
            {e.caveats && (
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-n-50 px-2 py-1 text-meta text-n-700">
                <span className="mr-2 font-medium text-n-500">주의점</span>{e.caveats}
              </p>
            )}
          </li>
        ))}
      </ul>
      {rows.length > HANDOVER_FIRST && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
          {all ? '접기' : `${rows.length - HANDOVER_FIRST}건 더 보기`}
        </Button>
      )}
    </section>
  );
}

/** 67 — 담당자 프로필 카드(/p/{명부 번호 또는 사번}). 숫자는 보는 사람이 볼 수 있는 확정 자료로만 센다. 순위나 비교는 없다. */
export default function PersonPage() {
  const { personKey } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('assigned');

  useEffect(() => {
    let live = true;
    setD(null); setMissing(false); setError('');
    api(profileApi(personKey)).then((r) => {
      if (!live) return;
      setD(r);
      setTab(r.basis === 'authored' ? 'authored' : 'assigned');
    }).catch((err) => {
      if (!live) return;
      if (err.status === 404) setMissing(true); else setError(errorText(err, '담당자 정보를 불러오지 못했습니다.'));
    });
    return () => { live = false; };
  }, [personKey]);

  useEffect(() => { if (d?.person?.name) document.title = pageTitle(`/p/${personKey}`, d.person.name); }, [personKey, d]);

  if (missing) return <Page><EmptyState icon={UserRound} title="담당자를 찾지 못했습니다">담당자 명부나 LogBook 사용자에 없는 사람입니다.</EmptyState></Page>;
  if (!d) {
    return (
      <Page>
        {error ? <ErrorNote>{error}</ErrorNote> : (
          <div role="status" aria-label="담당자 정보를 불러오는 중" className="appear-late">
            <Bar className="h-8 w-40" /><Bar className="mt-3 h-3 w-64" /><Bar className="mt-8 h-64" />
          </div>
        )}
      </Page>
    );
  }

  const p = d.person;
  const c = d.counts;
  const k = d.knowledge;
  const t = d.traits;
  const retired = p.employed === false;
  // 검색 조건: 명부 행이 있으면 담당자, 없으면 작성자
  const base = d.in_roster ? `assignee=${p.id}` : `uploaded_by=${encodeURIComponent(p.employee_id)}`;
  const searchBy = (key) => (r) => `/?${base}&${key}=${encodeURIComponent(r.value)}`;
  // 담당한 자료와 작성한 자료가 둘 다 있고 서로 다를 때만 탭을 보인다
  const showTabs = d.in_roster && c.assigned > 0 && c.authored > 0 && !c.same_sets;
  const want = (e) => (tab === 'authored' ? e.roles.includes('author') : e.roles.some((r) => r !== 'author'));
  const timeline = showTabs
    ? d.timeline.map((m) => ({ ...m, entries: m.entries.filter(want) })).filter((m) => m.entries.length)
    : d.timeline;
  // 담당한 자료를 모두 직접 올렸으면 '작성' 표시는 군더더기라 뺀다
  const roleText = (e) => e.roles.filter((r) => !(c.same_sets && r === 'author')).map((r) => ROLE_LABEL[r]).join(', ');
  const stat = (n, label, unit = '건') => (
    <span><span className="mr-1 text-n-500">{label}</span><span className="font-mono font-medium text-n-900">{n}</span>{unit}</span>
  );
  const meta = [p.department, p.position].filter(Boolean).join(', ');

  return (
    <Page>
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-n-200 pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <BackButton className="-ml-1.5 self-center" />
            <h1 className="text-title font-semibold text-n-900">{p.name}</h1>
            {retired && <span className="text-ui text-n-500">(퇴사)</span>}
            {p.employee_id && <span className="font-mono text-meta text-n-500">{p.employee_id}</span>}
          </div>
          {meta && <p className="mt-1 text-ui text-n-600">{meta}</p>}
          <p className="tnum mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-ui text-n-600">
            {d.in_roster && stat(c.assigned, '담당한 자료')}
            {d.in_roster && c.assigned > 0 && c.primary !== c.assigned && stat(c.primary, '주 담당')}
            {(c.authored > 0 || !d.in_roster) && !c.same_sets && stat(c.authored, '작성한 자료')}
            {k.conclusions > 0 && stat(k.conclusions, '결론')}
            {k.caveats > 0 && stat(k.caveats, '주의점')}
            {k.reviewed > 0 && stat(k.reviewed, '검토 서명')}
            {k.resolved_issues > 0 && stat(k.resolved_issues, '해결한 이슈')}
          </p>
          {c.same_sets && <p className="mt-1 text-meta text-n-500">담당한 자료를 모두 직접 올렸습니다.</p>}
          {!d.in_roster && <p className="mt-1 text-meta text-n-500">담당자 명부에 없는 사람이라 작성한 자료만 보입니다.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/?${base}`} className={buttonClass('secondary', 'sm')}>
            <Search size={14} aria-hidden="true" />{d.in_roster ? '담당 자료 검색' : '작성 자료 검색'}
          </Link>
        </div>
      </header>
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

      <div className="mt-6 grid grid-cols-1 gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_272px]">
        <div className="flex min-w-0 flex-col gap-8">
          {retired && <Handover rows={d.handover} />}
          <section aria-label="자료 목록">
            {showTabs && (
              <Tabs label="자료 보기" value={tab} onChange={setTab} className="mb-3"
                    items={[{ id: 'assigned', label: '담당한 자료', count: c.assigned }, { id: 'authored', label: '작성한 자료', count: c.authored }]} />
            )}
            <p className="mb-3 text-meta text-n-500">날짜는 LogBook 에 확정한 달입니다. 실제로 해석한 시기와 다를 수 있습니다.</p>
            <ol aria-label="월별 목록" className="flex flex-col gap-6">
              {timeline.length === 0 && <li className="text-ui text-n-500">볼 수 있는 확정 자료가 없습니다.</li>}
              {timeline.map((m) => (
                <li key={m.month}>
                  <h2 className="mb-2 text-ui font-semibold text-n-700">{monthLabel(m.month)}</h2>
                  <ul className="overflow-hidden rounded-lg border border-n-200">
                    {m.entries.map((e) => (
                      <li key={e.entry_id} onClick={() => navigate(`/e/${e.entry_id}`)}
                          className="group/row grid h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto_72px_44px_28px] items-center gap-3 border-b border-n-200 px-3 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50">
                        <span className="flex min-w-0 items-center gap-2">
                          <Link to={`/e/${e.entry_id}`} onClick={(ev) => ev.stopPropagation()}
                                className="truncate font-semibold text-n-900 hover:underline">{e.title}</Link>
                          <AccessBadge item={e} compact />
                        </span>
                        <span className="truncate text-meta text-n-500">{[e.hulls[0], ...e.zones].filter(Boolean).join(', ')}</span>
                        <span className="text-micro text-n-500">{roleText(e)}</span>
                        <span className="flex gap-1">{e.kinds.map((x) => <KindBadge key={x} kind={x} />)}</span>
                        <span className="text-right font-mono text-meta text-n-500">{e.entry_id}</span>
                        <span className="text-right font-mono text-meta text-n-500">{mmdd(e.confirmed_at)}</span>
                        <FavoriteToggle entryId={e.entry_id} initial={e.favorite} stop reveal />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
          {!retired && <Handover rows={d.handover} />}
        </div>
        <aside aria-label="특성" className="flex min-w-0 flex-col gap-6">
          <Distribution title="구역" rows={t.zones} hrefOf={searchBy('zone')} />
          {t.targets.length > 0 && <Distribution title="대상" rows={t.targets} hrefOf={searchBy('target')} />}
          {t.ship_kinds.length > 0 && <Distribution title="선종" rows={t.ship_kinds} />}
          {t.ship_sizes.length > 0 && <Distribution title="크기급" rows={t.ship_sizes} />}
          {t.sols.length > 0 && <Distribution title="해석 유형(SOL)" rows={t.sols} />}
          {t.programs.length > 0 && <Distribution title="WorkBench 프로그램" rows={t.programs} />}
          {t.lifting > 0 && <p className="text-meta text-n-600">권상 Wire 모델이 있는 자료 <span className="font-mono">{t.lifting}</span>건</p>}
          {d.coworkers.length > 0 && (
            <section aria-label="함께 일한 사람">
              <SectionTitle className="mb-2">함께 일한 사람</SectionTitle>
              <ul className="flex flex-col gap-px">
                {d.coworkers.map((w) => (
                  <li key={w.id} className="flex h-7 items-center justify-between px-1.5 text-ui text-n-700">
                    <Link to={profileHref(w)} className="truncate hover:underline">{w.name}{w.employed === false && <span className="ml-1 text-n-500">(퇴사)</span>}</Link>
                    <span className="text-meta text-n-500"><span className="font-mono">{w.count}</span>건</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </Page>
  );
}
