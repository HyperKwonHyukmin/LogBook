import { Link, NavLink, useLocation } from 'react-router-dom';
import { Anchor, History, Inbox, Search, Tag, Trash2, Users } from 'lucide-react';

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

const linkClass = ({ isActive }) =>
  `flex h-8 items-center gap-2 rounded-md px-2 text-ui font-medium transition-colors duration-120 ease-out ${isActive
    ? 'bg-brand-subtle text-brand'
    : 'text-n-600 hover:bg-n-100 hover:text-n-900 active:bg-n-150'}`;

function Item({ to, label, icon: Icon, end, also, pathname }) {
  const body = (active) => (
    <><Icon size={16} strokeWidth={1.75} aria-hidden="true" className={active ? 'text-brand' : 'text-n-500'} />{label}</>
  );
  // NavLink 는 자기 경로가 아닐 때 aria-current 를 지우므로, also 로만 활성인 경우는 Link 에 직접 단다.
  if (also?.some((p) => pathname.startsWith(p))) {
    return <Link to={to} aria-current="page" className={linkClass({ isActive: true })}>{body(true)}</Link>;
  }
  return <NavLink to={to} end={end} className={linkClass}>{({ isActive }) => body(isActive)}</NavLink>;
}

function GroupLabel({ children }) {
  return <div className="px-2 pb-1 pt-4 text-meta font-medium text-n-500">{children}</div>;
}

export default function SideNav({ isAdmin, storage }) {
  const reachable = storage?.reachable !== false;
  const { pathname } = useLocation();
  return (
    <nav aria-label="주 메뉴" className="flex w-[208px] shrink-0 flex-col bg-n-50 px-2 pb-3 pt-1">
      {GROUPS.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-px">
          {g.label && <GroupLabel>{g.label}</GroupLabel>}
          {g.items.map((it) => <Item key={it.to} {...it} pathname={pathname} />)}
        </div>
      ))}
      <div className="flex-1" />
      {isAdmin && (
        <div className="mb-2 flex flex-col gap-px">
          <GroupLabel>관리</GroupLabel>
          <Item to="/admin/users" label="사용자 관리" icon={Users} pathname={pathname} />
        </div>
      )}
      <div role="status" title={reachable ? '공유 폴더에 연결되어 있습니다' : '공유 폴더에 연결할 수 없습니다'}
           className={`flex h-7 items-center gap-2 px-2 text-meta ${reachable ? 'text-n-500' : 'text-err'}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${reachable ? 'bg-ok' : 'bg-err'}`} />
        <span className="font-mono">999_LogBook</span>
        <span className="ml-auto">{reachable ? '연결됨' : '끊김'}</span>
      </div>
    </nav>
  );
}
