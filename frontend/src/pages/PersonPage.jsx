import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, UserRound } from 'lucide-react';
import { api } from '../api/client.js';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import Distribution from '../components/ui/Distribution.jsx';
import { Segmented, Tabs } from '../components/ui/Tabs.jsx';
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
const RAIL_LIMIT = 6;
const NO_TARGET = '대상 없음';
const NO_HULL = '공용(호선 없음)';
// 2026-11-23 — '기타'는 분류를 못 한 값이라 그 사람의 주력을 말해 주지 못한다. 주력 칩에서만 빼고 오른쪽 분포에는 그대로 둔다
const VAGUE = new Set(['기타']);
// 2026-11-23 — 묶는 기준. 과거 자료를 한 달에 몰아 올려 월별은 한 덩어리가 되기 쉬워 기본은 대상별(사용자 결정)
const GROUPS = [{ id: 'target', label: '대상별' }, { id: 'hull', label: '호선별' }, { id: 'month', label: '월별' }];

/** 목록을 고른 기준으로 묶는다. 대상과 호선은 건수 많은 순(없음은 맨 뒤), 월은 최근 순. 묶음 안은 서버 순서(최근 확정 순). */
function groupRows(timeline, by) {
  if (by === 'month') return timeline.map((m) => ({ key: m.month, label: monthLabel(m.month), rows: m.entries }));
  const map = new Map();
  for (const m of timeline) {
    for (const e of m.entries) {
      const key = by === 'hull' ? (e.hulls[0] || NO_HULL) : (e.target || NO_TARGET);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
  }
  const empty = by === 'hull' ? NO_HULL : NO_TARGET;
  return [...map.entries()]
    .sort(([ka, a], [kb, b]) => (ka === empty) - (kb === empty) || b.length - a.length || ka.localeCompare(kb, 'ko'))
    .map(([key, rows]) => ({ key, label: key, hull: by === 'hull' && key !== NO_HULL, rows }));
}

/** 남긴 결론과 주의점 — 퇴사자 카드에서는 맨 위(인수인계 묶음), 그 밖에는 목록 아래. 퇴사자인데 비면 채우는 법을 안내한다. */
function Handover({ rows, hintWhenEmpty }) {
  const [all, setAll] = useState(false);
  if (!rows.length) {
    if (!hintWhenEmpty) return null;
    return (
      <section aria-label="남긴 결론과 주의점" className="rounded-lg border border-n-200 bg-n-50 px-4 py-3">
        <SectionTitle>남긴 결론과 주의점</SectionTitle>
        <p className="mt-1 text-ui text-n-600">아직 결론을 남긴 자료가 없습니다. 자료 화면의 [변경하기]에서 결론 한 줄과 주의점을 남기면 여기에 모여 인수인계 자료가 됩니다.</p>
      </section>
    );
  }
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

/** 명함 영역의 '자료로 본 주력' 칩 하나. 검색 칸과 값이 같은 것(대상)만 링크. */
function FocusChip({ label, count, to }) {
  const inner = (
    <>
      <span className="truncate">{label}</span>
      <span className="font-mono text-meta text-n-500">{count}</span>
    </>
  );
  const cls = 'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-sm bg-n-100 px-2.5 text-ui text-n-800';
  return to
    ? <Link to={to} title={`${label} 자료 ${count}건 검색`} className={`${cls} transition-colors duration-150 hover:bg-n-150 hover:text-n-900`}>{inner}</Link>
    : <span className={cls}>{inner}</span>;
}

/** 67 — 담당자 프로필 카드(/p/{명부 번호 또는 사번}). 숫자는 보는 사람이 볼 수 있는 확정 자료로만 센다. 순위나 비교는 없다.
 * 2026-11-23 — 명함형 머리말(이니셜, 이름, 소속, 자료로 본 주력, 수치 한 줄)과 대상별 목록(/design). */
export default function PersonPage() {
  const { personKey } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('assigned');
  const [by, setBy] = useState('target');

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

  // 담당한 자료와 작성한 자료가 둘 다 있고 서로 다를 때만 탭을 보인다
  const showTabs = !!d && d.in_roster && d.counts.assigned > 0 && d.counts.authored > 0 && !d.counts.same_sets;
  const timeline = useMemo(() => {
    if (!d) return [];
    if (!showTabs) return d.timeline;
    const want = (e) => (tab === 'authored' ? e.roles.includes('author') : e.roles.some((r) => r !== 'author'));
    return d.timeline.map((m) => ({ ...m, entries: m.entries.filter(want) })).filter((m) => m.entries.length);
  }, [d, showTabs, tab]);
  const rows = useMemo(() => timeline.flatMap((m) => m.entries), [timeline]);
  const groups = useMemo(() => groupRows(timeline, by), [timeline, by]);

  if (missing) return <Page><EmptyState icon={UserRound} title="담당자를 찾지 못했습니다">담당자 명부나 LogBook 사용자에 없는 사람입니다.</EmptyState></Page>;
  if (!d) {
    return (
      <Page>
        {error ? <ErrorNote>{error}</ErrorNote> : (
          <div role="status" aria-label="담당자 정보를 불러오는 중" className="appear-late">
            <div className="flex items-center gap-5"><Bar className="h-16 w-16 rounded-full" /><div className="flex-1"><Bar className="h-7 w-40" /><Bar className="mt-2 h-3 w-64" /></div></div>
            <Bar className="mt-8 h-64" />
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
  // 역할이 모든 행에서 같으면(예: 89건 모두 주 담당) 행마다 쓰지 않는다
  const roleText = (e) => e.roles.filter((r) => !(c.same_sets && r === 'author')).map((r) => ROLE_LABEL[r]).join(', ');
  const mixedRoles = new Set(rows.map(roleText)).size > 1;
  const hullCount = new Set(d.timeline.flatMap((m) => m.entries.flatMap((e) => e.hulls))).size;
  const focus = [
    ...t.targets.filter((r) => !VAGUE.has(r.value)).slice(0, 3).map((r) => ({ label: r.value, count: r.count, to: searchBy('target')(r) })),
    ...t.ship_kinds.slice(0, 2).map((r) => ({ label: r.value, count: r.count, to: null })),
  ];
  const meta = [p.department, p.position].filter(Boolean);
  const stat = (n, label, unit = '건') => (
    <span key={label}><span className="mr-1 text-n-500">{label}</span><span className="font-mono font-medium text-n-900">{n}</span>{unit}</span>
  );
  const stats = [
    d.in_roster && stat(c.assigned, '담당'),
    (!d.in_roster || (c.authored > 0 && !c.same_sets)) && stat(c.authored, '작성'),
    hullCount > 0 && stat(hullCount, '다룬 호선', '척'),
    t.ship_kinds.length > 0 && stat(t.ship_kinds.length, '선종', '종'),
    stat(k.conclusions, '결론'),
    k.caveats > 0 && stat(k.caveats, '주의점'),
    k.reviewed > 0 && stat(k.reviewed, '검토 서명'),
    k.resolved_issues > 0 && stat(k.resolved_issues, '해결한 이슈'),
  ].filter(Boolean);

  return (
    <Page>
      <header className="border-b border-n-200 pb-6">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <BackButton className="-ml-1.5 mt-4" />
          {/* 이니셜 — 위쪽 바 계정 아바타와 같은 모양(navy-700 + navy-500 링 + 흰 글자) */}
          <span aria-hidden="true"
                className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-navy-700 text-[26px] font-semibold text-on-navy ring-1 ring-navy-500">
            {(p.name || '?').slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-entry font-semibold tracking-[-0.02em] text-n-900">{p.name}</h1>
              {retired && (
                <span className="inline-flex h-5 items-center gap-1.5 rounded-xs bg-n-100 px-1.5 text-micro font-semibold text-n-700">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-n-500" />퇴사
                </span>
              )}
            </div>
            {(meta.length > 0 || p.employee_id) && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-ui text-n-600">
                {meta.map((m) => <span key={m}>{m}</span>)}
                {p.employee_id && <span className="font-mono text-meta text-n-500">{p.employee_id}</span>}
              </p>
            )}
            <p className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-ui text-n-600">{stats}</p>
            {focus.length > 0 && (
              <div aria-label="자료로 본 주력" role="group" className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-meta font-medium text-n-600">자료로 본 주력</span>
                {focus.map((f) => <FocusChip key={f.label} {...f} />)}
              </div>
            )}
            {c.same_sets && <p className="mt-3 text-meta text-n-500">담당한 자료를 모두 직접 올렸습니다.</p>}
            {!d.in_roster && <p className="mt-3 text-meta text-n-500">담당자 명부에 없는 사람이라 작성한 자료만 보입니다.</p>}
          </div>
          <Link to={`/?${base}`} className={`${buttonClass('secondary', 'sm')} mt-3`}>
            <Search size={14} aria-hidden="true" />{d.in_roster ? '담당 자료 검색' : '작성 자료 검색'}
          </Link>
        </div>
      </header>
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

      <div className="mt-6 grid grid-cols-1 gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_272px]">
        <div className="flex min-w-0 flex-col gap-8">
          {retired && <Handover rows={d.handover} hintWhenEmpty />}
          <section aria-label="자료 목록">
            {showTabs && (
              <Tabs label="자료 보기" value={tab} onChange={setTab} className="mb-3"
                    items={[{ id: 'assigned', label: '담당한 자료', count: c.assigned }, { id: 'authored', label: '작성한 자료', count: c.authored }]} />
            )}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-ui text-n-600"><span className="font-mono font-medium text-n-900">{rows.length}</span>건</p>
              <Segmented label="묶는 기준" items={GROUPS} value={by} onChange={setBy} />
            </div>
            {by === 'month' && <p className="mb-3 text-meta text-n-500">날짜는 LogBook 에 확정한 달입니다. 실제로 해석한 시기와 다를 수 있습니다.</p>}
            <ol aria-label="자료 묶음" className="flex flex-col gap-6">
              {groups.length === 0 && <li className="text-ui text-n-500">볼 수 있는 확정 자료가 없습니다.</li>}
              {groups.map((g) => (
                <li key={g.key}>
                  <h2 className="mb-2 flex items-baseline gap-2 text-ui font-semibold text-n-800">
                    {g.hull
                      ? <Link to={`/h/${encodeURIComponent(g.key)}`} className="font-mono text-body font-medium text-brand hover:underline">{g.label}</Link>
                      : <span>{g.label}</span>}
                    <span className="font-mono text-meta font-normal text-n-500">{g.rows.length}</span>
                  </h2>
                  <ul className="overflow-hidden rounded-lg border border-n-200">
                    {g.rows.map((e) => (
                      <li key={e.entry_id} onClick={() => navigate(`/e/${e.entry_id}`)}
                          className="group/row grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto_64px_40px_28px] items-center gap-3 border-b border-n-200 px-3 py-1.5 text-ui transition-colors duration-150 last:border-0 hover:bg-n-50">
                        <span className="flex min-w-0 items-center gap-2">
                          <Link to={`/e/${e.entry_id}`} onClick={(ev) => ev.stopPropagation()} title={e.title}
                                className="min-w-0 truncate font-semibold text-n-900 hover:underline">{e.title}</Link>
                          <AccessBadge item={e} compact />
                          {mixedRoles && <span className="shrink-0 text-micro text-n-500">{roleText(e)}</span>}
                        </span>
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
          {t.targets.length > 0 && <Distribution title="대상" rows={t.targets} hrefOf={searchBy('target')} limit={RAIL_LIMIT} />}
          {t.ship_kinds.length > 0 && <Distribution title="선종" rows={t.ship_kinds} limit={RAIL_LIMIT} />}
          <Distribution title="구역" rows={t.zones} hrefOf={searchBy('zone')} limit={RAIL_LIMIT} />
          {t.ship_sizes.length > 0 && <Distribution title="크기급" rows={t.ship_sizes} limit={RAIL_LIMIT} />}
          {t.sols.length > 0 && <Distribution title="해석 유형(SOL)" rows={t.sols} limit={RAIL_LIMIT} />}
          {t.programs.length > 0 && <Distribution title="WorkBench 프로그램" rows={t.programs} limit={RAIL_LIMIT} />}
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
