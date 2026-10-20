import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Grid2x2Check, Info, ScanSearch, Waypoints } from 'lucide-react';
import Logo from '../src/components/ui/Logo.jsx';
import { ToastProvider } from '../src/components/ui/Toast.jsx';
import { CompareBasketProvider } from '../src/components/compare/CompareBasket.jsx';
import { DEMO_SIMILAR_FILE, DEMO_STATS } from './mockApi.js';

/**
 * 설명회 데모 셸 — 실제 앱(AppShell)과 같은 네이비 크롬에 '활용' 세 화면만 둔다.
 * 화면 자체는 실제 앱 코드(src/pages)를 그대로 쓰고, 서버만 예시 데이터(mockApi)로 바꿨다.
 */
const NAV = [
  { to: '/graph', label: '관계 지도', icon: Waypoints, note: '무엇이 이어져 있나' },
  { to: '/coverage', label: '갖춤 현황', icon: Grid2x2Check, note: '무엇이 비어 있나' },
  // 첫 기준 = 같은 설계가 여러 척에 있는 예(주소의 file) — 화면에서 다른 BDF 로 바꿀 수 있다
  { to: `/similar?file=${DEMO_SIMILAR_FILE}`, label: '선례 찾기', icon: ScanSearch, note: '무엇을 다시 쓰나' },
];

const linkClass = ({ isActive }) =>
  `group flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-ui font-medium transition-colors duration-150 ease-out ${isActive
    ? 'bg-navy-700 text-on-navy'
    : 'text-on-navy-muted hover:bg-navy-800 hover:text-on-navy active:bg-navy-700'}`;

const n = (v) => v.toLocaleString('ko-KR');

export default function DemoShell() {
  return (
    <ToastProvider>
      <CompareBasketProvider>
        <div className="flex h-full flex-col bg-navy-900">
          <header className="on-navy flex h-12 shrink-0 items-center gap-3 bg-navy-900 px-3">
            <div className="flex w-[196px] shrink-0 items-center pl-1"><Logo tone="navy" /></div>
            <span className="rounded-sm bg-navy-700 px-2 py-0.5 text-meta font-medium text-on-navy">설명회 데모</span>
            <span className="truncate text-meta text-on-navy-muted">
              예시 데이터 — 호선 {DEMO_STATS.hulls}척 · 자료 {n(DEMO_STATS.entries)}건 · 파일 {n(DEMO_STATS.files)}개(BDF {n(DEMO_STATS.models)})가 쌓였을 때
            </span>
          </header>
          <div className="flex min-h-0 flex-1">
            <nav aria-label="주 메뉴" className="on-navy flex w-[208px] shrink-0 flex-col overflow-y-auto bg-navy-900 px-2 pb-3 pt-1">
              <div className="px-2.5 pb-1 pt-3 text-meta font-medium text-on-navy-subtle">활용</div>
              <div className="flex flex-col gap-0.5">
                {NAV.map(({ to, label, icon: Icon, note }) => (
                  <NavLink key={to} to={to} className={linkClass}>
                    {({ isActive }) => (
                      <>
                        <Icon size={16} strokeWidth={1.75} aria-hidden="true"
                              className={`shrink-0 ${isActive ? 'text-on-navy' : 'text-on-navy-icon group-hover:text-on-navy-muted'}`} />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span>{label}</span>
                          <span className={`text-micro font-normal ${isActive ? 'text-on-navy-muted' : 'text-on-navy-subtle'}`}>{note}</span>
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
              <div className="min-h-4 flex-1" />
              <p className="mx-1 rounded-md bg-navy-700 px-2.5 py-2 text-micro leading-relaxed text-on-navy-muted">
                실제 LogBook 화면 코드에 예시 데이터를 넣었습니다. 운영 데이터가 아니며, 저장되지 않습니다.
              </p>
            </nav>
            <main className="min-w-0 flex-1 overflow-auto rounded-tl-xl bg-n-0">
              <Outlet />
            </main>
          </div>
        </div>
      </CompareBasketProvider>
    </ToastProvider>
  );
}

/** 데모에 없는 화면(자료 상세·호선·3D 뷰어) — 실제 LogBook 에서 열린다고 알리고 돌아간다. */
export function DemoMissing() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const what = pathname.startsWith('/e/') ? `자료 ${pathname.slice(3)}`
    : pathname.startsWith('/h/') ? `${pathname.slice(3)} 호선` : pathname.startsWith('/v/') ? '3D 뷰어' : '이 화면';
  return (
    <div className="flex h-full items-start justify-center px-6" style={{ paddingTop: 96 }}>
      <div className="flex max-w-[440px] flex-col items-center gap-3 text-center">
        <Info size={28} strokeWidth={1.5} className="text-n-400" aria-hidden="true" />
        <h1 className="text-body font-semibold text-n-900">{what}은(는) 데모에 넣지 않았습니다</h1>
        <p className="text-ui text-n-600">실제 LogBook 에서는 여기서 자료 상세(파일 · 3D 미리보기 · 보고서 · 이력)가 열립니다.</p>
        <button type="button" onClick={() => navigate(-1)}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-n-250 px-3 text-ui font-medium text-n-800 hover:bg-n-50">
          <ArrowLeft size={14} aria-hidden="true" />돌아가기
        </button>
      </div>
    </div>
  );
}
