import { Link, NavLink, useLocation } from 'react-router-dom';
import { Activity, Anchor, History, Inbox, ListTree, Search, Tag, Trash2, Users } from 'lucide-react';

const GROUPS = [
  { items: [
    { to: '/', label: '검색', icon: Search, end: true },
    { to: '/hulls', label: '호선', icon: Anchor, also: ['/h/'] }, // 호선 화면(/h/9999)도 '호선' 메뉴 아래
    { to: '/tags', label: '태그', icon: Tag },
  ] },
  { label: '작업', items: [
    { to: '/inbox', label: '정리 대기', icon: Inbox },
    { to: '/trash', label: '휴지통', icon: Trash2 },
  ] },
  { label: '기록', items: [
    { to: '/log', label: '활동 로그', icon: History },
  ] },
];

// 네이비 크롬 위 메뉴 — 현재 메뉴는 한 단계 밝은 네이비 채움 + 흰 글자·아이콘(측면 띠 없음).
const linkClass = ({ isActive }) =>
  `flex h-8 items-center gap-2.5 rounded-md px-2.5 text-ui font-medium transition-colors duration-150 ease-out ${isActive
    ? 'bg-navy-700 text-on-navy'
    : 'text-on-navy-muted hover:bg-navy-800 hover:text-on-navy active:bg-navy-700'}`;

function Item({ to, label, icon: Icon, end, also, pathname }) {
  const body = (active) => (
    <>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true"
            className={`shrink-0 transition-colors duration-150 ease-out ${active ? 'text-on-navy' : 'text-on-navy-icon group-hover:text-on-navy-muted'}`} />
      {label}
    </>
  );
  // NavLink 는 자기 경로가 아닐 때 aria-current 를 지우므로, also 로만 활성인 경우는 Link 에 직접 단다.
  if (also?.some((p) => pathname.startsWith(p))) {
    return <Link to={to} aria-current="page" className={`group ${linkClass({ isActive: true })}`}>{body(true)}</Link>;
  }
  return (
    <NavLink to={to} end={end} className={(s) => `group ${linkClass(s)}`}>{({ isActive }) => body(isActive)}</NavLink>
  );
}

function GroupLabel({ children }) {
  return <div className="px-2.5 pb-1 pt-5 text-meta font-medium text-on-navy-subtle">{children}</div>;
}

export default function SideNav({ isAdmin, storage }) {
  const reachable = storage?.reachable !== false;
  const { pathname } = useLocation();
  return (
    <nav aria-label="주 메뉴" className="on-navy flex w-[208px] shrink-0 flex-col overflow-y-auto bg-navy-900 px-2 pb-3 pt-1">
      {GROUPS.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {g.label && <GroupLabel>{g.label}</GroupLabel>}
          {g.items.map((it) => <Item key={it.to} {...it} pathname={pathname} />)}
        </div>
      ))}
      <div className="min-h-4 flex-1" />
      {isAdmin && (
        <div className="mb-2 flex flex-col gap-0.5">
          <GroupLabel>관리</GroupLabel>
          <Item to="/admin/users" label="사용자 관리" icon={Users} pathname={pathname} />
          <Item to="/admin/ops" label="운영" icon={Activity} pathname={pathname} />
          <Item to="/admin/vocab" label="분류 목록" icon={ListTree} pathname={pathname} />
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
