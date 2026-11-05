import { NavLink, Outlet, useOutletContext } from 'react-router-dom';

/**
 * 메뉴 하나 아래 여러 화면(살펴보기·관리)을 위쪽 밑줄 탭으로 오간다(2026-11-05 메뉴 합치기).
 * 탭은 주소 링크라 옛 주소(/graph·/admin/vocab 등)도 그대로 열리고, 탭이 늘 보이도록 아래 내용만 스크롤한다.
 * contained = 관리 화면처럼 Page(최대 1200px 가운데) 안에 탭 줄을 맞춘다.
 */
export default function SectionTabs({ label, items, contained = false }) {
  const ctx = useOutletContext();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label={label} className="shrink-0 border-b border-n-200">
        <div className={`flex h-10 items-stretch gap-5 overflow-x-auto px-6 min-[1441px]:px-8 ${contained ? 'mx-auto w-full max-w-[1200px]' : ''}`}>
          {items.map((t) => (
            <NavLink key={t.to} to={t.to}
                     className={({ isActive }) => `relative -mb-px inline-flex items-center whitespace-nowrap border-b-2 px-0.5 text-ui font-medium transition-colors duration-150 ease-out
                       ${isActive ? 'border-n-900 text-n-900' : 'border-transparent text-n-500 hover:text-n-900'}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
