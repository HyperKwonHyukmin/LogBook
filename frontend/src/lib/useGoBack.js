import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** 앱 안에 돌아갈 이전 화면이 있나 — 새 탭·주소 직접 입력으로 열었으면 없다. */
export function canGoBack(location) {
  const idx = window.history.state?.idx;
  return typeof idx === 'number' ? idx > 0 : location.key !== 'default';
}

/** 이전 화면으로 — 앱 안 이전 화면이 없으면 fallback(기본 검색)으로 간다. */
export function useGoBack(fallback = '/') {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (canGoBack(location)) navigate(-1);
    else if (location.pathname !== fallback) navigate(fallback);
  }, [navigate, location, fallback]);
}

/**
 * 마우스 뒤로·앞으로 버튼(엄지 버튼). 일반 브라우저는 스스로 처리하지만 WorkBench 가 연 창 등
 * 끼워 넣은 브라우저는 무시하는 경우가 있어 앱이 직접 받는다. 기본 동작은 막아 두 번 이동하지 않게 한다.
 */
export function useMouseBack() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  useEffect(() => {
    function onMouseUp(e) {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      else if (e.button === 4) { e.preventDefault(); navigate(1); }
    }
    // 눌렀을 때 브라우저가 먼저 움직이지 않게 mousedown 기본 동작도 막는다
    function onMouseDown(e) { if (e.button === 3 || e.button === 4) e.preventDefault(); }
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [goBack, navigate]);
}
