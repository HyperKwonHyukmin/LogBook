/**
 * 인증 상태 컨텍스트. WorkBench contexts/AuthContext.jsx 의 구조를 가져왔다.
 * 차이: 사용자 정보를 localStorage 에 두지 않고 매번 /auth/me 로 확인한다
 * (관리자가 비활성화하면 즉시 반영). 사번만 편의를 위해 기억한다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, TOKEN_KEY } from '../api/client.js';

export const SAVED_EMPLOYEE_ID_KEY = 'logbook_saved_employee_id';
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let alive = true;
    api('/auth/me')
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        // 네트워크 오류·5xx 로는 토큰을 지우지 않는다 — 세션이 실제로 무효(401)면
        // client.js 가 이미 토큰을 지우고 logbook:unauthorized 를 보냈다.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('logbook:unauthorized', onUnauthorized);
    return () => window.removeEventListener('logbook:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    // 다른 탭에서 로그아웃(토큰 삭제)하면 이 탭도 로그아웃 상태로 맞춘다.
    // storage 이벤트는 변경을 일으킨 탭 자신에는 오지 않고 '다른' 탭에만 온다.
    function onStorage(e) {
      if (e.key === TOKEN_KEY && !e.newValue) setUser(null);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (employeeId) => {
    const res = await api('/auth/login', { method: 'POST', body: { employee_id: employeeId }, auth: false });
    tokenStore.set(res.token);
    localStorage.setItem(SAVED_EMPLOYEE_ID_KEY, res.user.employee_id);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // 이미 만료된 세션이어도 화면은 로그아웃 처리한다
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAdmin: user?.is_admin === true, login, logout }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
