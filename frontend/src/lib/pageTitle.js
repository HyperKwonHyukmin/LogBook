/**
 * 브라우저 탭 제목 — 화면마다 다르게(2026-11-18 설명회 전 검토).
 * 예전엔 모든 화면이 'Hi-TESS LogBook' 이라 탭 여러 개와 방문 기록에서 어느 화면인지 구분이 안 됐다.
 * 메뉴 이름을 바꾸면 여기도 같이 바꾼다(사이드 메뉴 SideNav.jsx 의 label, 관리 탭 ADMIN_TABS).
 */
export const APP_NAME = 'Hi-TESS LogBook';

const EXACT = {
  '/': '검색',
  '/reports': '문서 본문 검색',
  '/hulls': '호선',
  '/similar': '비슷한 모델 찾기',
  '/graph': '관계 지도',
  '/coverage': '갖춤 현황',
  '/inbox': '올리기와 확정',
  '/browse': '분류로 찾기',
  '/tags/manage': '태그 관리',
  '/trash': '휴지통',
  '/compare': '모델 비교',
  '/compares': '최근 비교',
  '/comments': '새 의견',   // 63
  '/notes': '나의 메모',    // 64
  '/targets': '업무별 모음',   // 69
  '/update-notes': '업데이트 안내',   // 70
};

/** pathname(+ 화면이 아는 이름) → 탭 제목. name 은 자료 제목·파일 이름처럼 그 화면만 아는 값(없으면 번호로). */
export function pageTitle(pathname, name = '') {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  let label = EXACT[path] || '';
  if (!label) {
    const hull = path.match(/^\/h\/([^/]+)$/);
    const entry = path.match(/^\/e\/([^/]+)$/);
    const file = path.match(/^\/v\/([^/]+)$/);
    const person = path.match(/^\/p\/([^/]+)$/);   // 67 — 담당자 프로필 카드
    const target = path.match(/^\/t\/([^/]+)$/);   // 69 — 업무별 모음
    const note = path.match(/^\/update-notes\/([^/]+)$/);   // 70 — 업데이트 안내 한 건
    if (hull) label = `${decodeURIComponent(hull[1])} 호선`;
    else if (entry) label = name || decodeURIComponent(entry[1]);
    else if (file) label = name || '파일 보기';
    else if (person) label = name ? `${name} 담당자` : '담당자';
    else if (target) label = `${decodeURIComponent(target[1])} 업무`;
    else if (note) label = name || '업데이트 안내';
    else if (path.startsWith('/admin')) label = '관리';
  }
  return label ? `${label} - ${APP_NAME}` : APP_NAME;
}
