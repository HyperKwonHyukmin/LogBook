import { Link, NavLink, useLocation } from 'react-router-dom';
import { Anchor, Grid2x2Check, History, Inbox, ScanSearch, Search, Settings, Trash2 } from 'lucide-react';
import Spinner from '../ui/Spinner.jsx';
import { useInboxSummary } from './InboxSummary.jsx';

// 48 — 문서 본문 검색(/reports)·분류(/browse, 태그 동의어 /tags)는 검색 화면 안에서 들어가므로 '검색' 아래에서 강조한다
const IN_SEARCH = ['/reports', '/browse', '/tags'];

// 48 — 업무별 묶음(찾기 9 → 6). 문서·분류·최근 비교는 메뉴에서 빼고 화면 안 단추로 옮겼다(옛 주소는 그대로 열린다).
// 2026-11-05 — 즐겨찾기는 검색 머리말의 '즐겨찾기만'(fav=1)으로, 갖춤 현황·관계 지도는 '살펴보기' 하나(위쪽 탭)로,
// 한 항목뿐이던 '기록' 묶음은 '등록·정리' 로 합쳤다(메뉴 9 → 7).
const GROUPS = [
  { label: '찾아 쓰기', items: [
    { to: '/', label: '검색', icon: Search,
      match: (path) => path === '/' || IN_SEARCH.some((p) => path.startsWith(p)) },
    { to: '/hulls', label: '호선', icon: Anchor, also: ['/h/'] }, // 호선 화면(/h/9999)도 '호선' 메뉴 아래
    { to: '/similar', label: '선례 찾기', icon: ScanSearch }, // 27 — 기준 BDF 와 비슷한 확정 모델
    { to: '/graph', label: '살펴보기', icon: Grid2x2Check, also: ['/coverage'] }, // 25 관계 지도 · 26 갖춤 현황(첫 탭이 관계 지도, 2026-11-06)
  ] },
  { label: '등록·정리', items: [
    { to: '/inbox', label: '정리 대기', icon: Inbox, badge: 'inbox' }, // 48 — 손볼 자료 탭 포함 · 62 배지
    { to: '/trash', label: '휴지통', icon: Trash2 },
    { to: '/log', label: '활동 로그', icon: History },
  ] },
];

// 네이비 크롬 위 메뉴 — 현재 메뉴는 한 단계 밝은 네이비 채움 + 흰 글자·아이콘(측면 띠 없음).
const linkClass = ({ isActive }) =>
  `flex h-8 items-center gap-2.5 rounded-md px-2.5 text-ui font-medium transition-colors duration-150 ease-out ${isActive
    ? 'bg-navy-700 text-on-navy'
    : 'text-on-navy-muted hover:bg-navy-800 hover:text-on-navy active:bg-navy-700'}`;

/**
 * 62 — '정리 대기' 배지: 확정하지 않은 내 초안 수, 올리는 중·정리 중이면 작은 스피너.
 * 다른 화면에 있어도 '아직 확정할 것이 남았다'·'아직 처리 중이다'가 보이게(확정을 잊고 쌓이거나 다시 올리는 일).
 */
function InboxBadge() {
  const { summary } = useInboxSummary();
  if (!summary) return null;
  const working = (summary.staged || 0) + (summary.uploading || 0);
  const n = summary.drafts || 0;
  if (!n && !working) return null;
  const tip = [working ? `처리 중 ${working}묶음` : '', n ? `확정할 초안 ${n}건` : ''].filter(Boolean).join(' · ');
  return (
    <span title={tip} className="ml-auto inline-flex items-center gap-1.5">
      {working > 0 && <Spinner size={12} className="text-on-navy-muted" />}
      {n > 0 && (
        <span className="min-w-5 rounded-full bg-wait px-1.5 text-center font-mono text-micro leading-5 text-n-0">
          {n > 99 ? '99+' : n}
        </span>
      )}
      <span className="sr-only">({tip})</span>
    </span>
  );
}

function Item({ to, label, icon: Icon, end, also, match, pathname, search, badge }) {
  const body = (active) => (
    <>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true"
            className={`shrink-0 transition-colors duration-150 ease-out ${active ? 'text-on-navy' : 'text-on-navy-icon group-hover:text-on-navy-muted'}`} />
      {label}
      {badge === 'inbox' && <InboxBadge />}
    </>
  );
  // 주소 질의까지 봐야 하는 메뉴(검색·즐겨찾기)는 NavLink 대신 직접 판정한다(NavLink 는 질의를 보지 않는다).
  if (match) {
    const active = match(pathname, search);
    return (
      <Link to={to} aria-current={active ? 'page' : undefined} className={`group ${linkClass({ isActive: active })}`}>{body(active)}</Link>
    );
  }
  // NavLink 는 자기 경로가 아닐 때 aria-current 를 지우므로, also 로만 활성인 경우는 Link 에 직접 단다.
  if (also?.some((p) => pathname.startsWith(p))) {
    return <Link to={to} aria-current="page" className={`group ${linkClass({ isActive: true })}`}>{body(true)}</Link>;
  }
  return (
    <NavLink to={to} end={end} className={(s) => `group ${linkClass(s)}`}>{({ isActive }) => body(isActive)}</NavLink>
  );
}

function GroupLabel({ children, first = false }) {
  return <div className={`px-2.5 pb-1 ${first ? 'pt-2' : 'pt-5'} text-meta font-medium text-on-navy-subtle`}>{children}</div>;
}

export default function SideNav({ isAdmin, storage }) {
  const reachable = storage?.reachable !== false;
  const { pathname, search } = useLocation();
  return (
    <nav aria-label="주 메뉴" className="on-navy flex w-[208px] shrink-0 flex-col overflow-y-auto bg-navy-900 px-2 pb-3 pt-1">
      {GROUPS.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {g.label && <GroupLabel first={gi === 0}>{g.label}</GroupLabel>}
          {g.items.map((it) => <Item key={it.to} {...it} pathname={pathname} search={search} />)}
        </div>
      ))}
      <div className="min-h-4 flex-1" />
      {isAdmin && (
        <div className="mb-2 flex flex-col gap-0.5">
          <GroupLabel>관리</GroupLabel>
          {/* 2026-11-05 — 관리 6화면(사용자·운영·분류 목록·WorkBench 연결 규칙·자료 정비·업데이트 이력)은 위쪽 탭으로 */}
          <Item to="/admin/users" label="관리" icon={Settings} also={['/admin/']} pathname={pathname} />
        </div>
      )}
      <div role="status" title={reachable ? '공유 폴더에 연결되어 있습니다' : '공유 폴더에 연결할 수 없습니다'}
           className={`flex h-8 items-center gap-2 border-t border-navy-700 px-2.5 pt-1 text-meta ${reachable ? 'text-on-navy-subtle' : 'text-err-on-navy'}`}>
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${reachable ? 'bg-ok-on-navy' : 'bg-err-on-navy'}`} />
        <span className="font-mono">999_LogBook</span>
        <span className={`ml-auto ${reachable ? 'text-on-navy-muted' : ''}`}>{reachable ? '연결됨' : '끊김'}</span>
      </div>
    </nav>
  );
}
