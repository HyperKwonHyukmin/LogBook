import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, useNavigate } from 'react-router-dom';

export const LEAVE_TEXT = {
  title: '저장하지 않은 변경이 있습니다',
  body: '이 화면을 떠나면 고친 내용이 사라집니다.',
  confirmLabel: '버리고 떠나기',
  cancelLabel: '계속 고치기',
};

/**
 * 저장하지 않은 변경이 있을 때 화면을 떠나지 못하게 묻는다(11).
 * - 창 닫기·새로 고침: beforeunload(브라우저 기본 확인).
 * - 앱 안 이동: 데이터 라우터(main.jsx)면 useBlocker 로 모든 이동(링크·검색·뒤로 가기)을 막고 confirm 으로 묻는다.
 *   데이터 라우터가 아니면(단독 렌더 테스트 등) 앱 안 링크 누르기만 가로챈다.
 * confirm: useConfirm() 의 confirm — Promise<boolean>.
 */
export function useUnsavedGuard(dirty, confirm) {
  const dataRouter = !!useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  // 라우터 종류는 화면이 사는 동안 바뀌지 않는다 — 훅 호출 순서가 렌더마다 같다
  /* eslint-disable react-hooks/rules-of-hooks */
  if (dataRouter) useBlockerGuard(dirty, confirm);
  else useLinkGuard(dirty, confirm);
  /* eslint-enable react-hooks/rules-of-hooks */
}

function useBlockerGuard(dirty, confirm) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    confirm(LEAVE_TEXT).then((ok) => {
      asking.current = false;
      if (ok) blocker.proceed(); else blocker.reset();
    });
  }, [blocker, confirm]);
}

function useLinkGuard(dirty, confirm) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!dirty) return undefined;
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      confirm(LEAVE_TEXT).then((ok) => { if (ok) navigate(url.pathname + url.search + url.hash); });
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, confirm, navigate]);
}
