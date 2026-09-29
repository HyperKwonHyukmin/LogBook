import { Link, NavLink, useLocation } from 'react-router-dom';
import { Anchor, History, Inbox, Search, SlidersHorizontal, Tag, Trash2 } from 'lucide-react';

const ITEMS = [
  { to: '/', label: '검색', icon: Search, end: true },
  { to: '/hulls', label: '호선', icon: Anchor, also: ['/h/'] }, // 호선 화면(/h/9999)도 '호선' 메뉴 아래
  { to: '/inbox', label: '정리 대기', icon: Inbox },
  { to: '/tags', label: '태그', icon: Tag },
  { to: '/trash', label: '휴지통', icon: Trash2 },
  { to: '/log', label: '활동 로그', icon: History },
];

const linkClass = ({ isActive }) =>
  `flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm ${isActive ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-700 hover:bg-zinc-100'}`;

export default function SideNav({ isAdmin, storage }) {
  const reachable = storage?.reachable !== false;
  const { pathname } = useLocation();
  return (
    <nav aria-label="주 메뉴" className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-zinc-50 px-2.5 py-3">
      {ITEMS.map(({ to, label, icon: Icon, end, also }) => {
        const body = <><Icon size={18} strokeWidth={1.75} aria-hidden="true" />{label}</>;
        // NavLink 는 자기 경로가 아닐 때 aria-current 를 지우므로, also 로만 활성인 경우는 Link 에 직접 단다.
        if (also?.some((p) => pathname.startsWith(p))) {
          return <Link key={to} to={to} aria-current="page" className={linkClass({ isActive: true })}>{body}</Link>;
        }
        return <NavLink key={to} to={to} end={end} className={linkClass}>{body}</NavLink>;
      })}
      <div className="flex-1" />
      {isAdmin && (
        <NavLink to="/admin/users" className={linkClass}>
          <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />관리
        </NavLink>
      )}
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-xs text-zinc-700">
        <span className={`h-[7px] w-[7px] rounded-full ${reachable ? 'bg-ok' : 'bg-err'}`} />
        {reachable ? '999_LogBook 연결됨' : '999_LogBook 연결 끊김'}
      </div>
    </nav>
  );
}
