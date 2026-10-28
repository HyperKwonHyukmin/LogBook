import { Link } from 'react-router-dom';

/**
 * 48 — 검색 화면 위 [자료 | 문서 본문] 전환. 메뉴는 '검색' 하나이고, 두 엔진(자료 검색 / 문서 본문 색인)은 따로 둔다.
 * 옮겨 갈 때 두 화면 공통 조건인 검색어(q)만 들고 간다 — 호선·구역 등 필터는 자료 검색에만, 문서 분류·자료 소속은 문서 화면에만 있다.
 */
const MODES = [
  { id: 'entries', label: '자료', path: '/' },
  { id: 'reports', label: '문서 본문', path: '/reports', title: '보고서·발표자료 본문(그림 속 글자 포함)까지 찾습니다' },
];

export const modeHref = (path, q) => (q ? `${path}?${new URLSearchParams({ q })}` : path);

export default function SearchModeTabs({ current, q = '', className = '' }) {
  return (
    <nav aria-label="검색 대상" className={`flex gap-5 text-ui ${className}`}>
      {MODES.map((m) => {
        const on = m.id === current;
        return (
          <Link key={m.id} to={modeHref(m.path, q.trim())} aria-current={on ? 'page' : undefined} title={m.title}
                className={`-mb-px border-b-2 pb-2 transition-colors duration-150 ease-out ${on
                  ? 'border-n-900 font-medium text-n-900' : 'border-transparent text-n-600 hover:text-n-900'}`}>
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
