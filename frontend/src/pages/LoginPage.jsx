import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import Logo from '../components/ui/Logo.jsx';
import { api, ApiError, LOGOUT_REASON_KEY } from '../api/client.js';
import { SAVED_EMPLOYEE_ID_KEY, useAuth } from '../auth/AuthContext.jsx';

// 15 — 사용자는 HiTESS WorkBench 가입자다. LogBook 자체 가입·승인 대기는 없다
const MESSAGES = {
  not_registered: 'WorkBench 에 가입된 사번이 아닙니다. HiTESS WorkBench 에서 가입·승인받은 뒤 들어오세요.',
  wb_inactive: 'WorkBench 에서 승인 대기 중이거나 비활성화된 계정입니다. WorkBench 관리자에게 문의하세요.',
  wb_unavailable: 'WorkBench 사용자 정보를 읽을 수 없어 로그인할 수 없습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.',
  invalid_employee_id: '사번 형식이 올바르지 않습니다. (예: A123456)',
  employee_id_login_disabled: '지금은 이 서버에서 사번을 확인할 수 없습니다. 관리자에게 알려 주세요.',
};
// 55 — 로그인 단추는 이 PC 의 Windows 계정으로 사번을 확인한다(/auth/windows 가 /login?windows=<사유> 로 돌려보낸다).
// 화면에는 Windows 이야기를 꺼내지 않고 사번 기준으로만 알린다(2026-11-06 사용자 의견)
const WINDOWS_MESSAGES = {
  unavailable: '이 PC 에서 사번을 확인하지 못했습니다. 회사 PC 의 크롬에서 열어 주세요.',
  windows_auth_failed: '사번 확인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
  windows_account_not_employee: '이 PC 는 사번 계정으로 로그인돼 있지 않습니다. 본인 PC 에서 로그인해 주세요.',
  windows_account_mismatch: '입력한 사번이 이 PC 에 로그인한 사번과 다릅니다. 본인 PC 에서 로그인해 주세요.',
  too_many_attempts: '확인 실패가 여러 번 있어 잠시 막혔습니다. 15분 뒤 다시 시도해 주세요.',
  windows_login_disabled: '지금은 이 서버에서 사번을 확인할 수 없습니다. 관리자에게 알려 주세요.',
  busy: '지금 로그인 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.',
};
const EMPTY_EMPLOYEE_ID_MESSAGE = '사번을 입력해 주세요.';
const VALIDATION_ERROR_MESSAGE = '입력값을 확인해 주세요.';
const GENERIC_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다.';
// 18 — 세션이 끊긴 이유(client.js 가 sessionStorage 에 남긴다). 한 번 보여 주고 지운다
const LOGOUT_REASONS = {
  wb_logout: 'WorkBench에서 로그아웃되어 LogBook도 로그아웃되었습니다.',
  logged_out: '로그아웃했습니다.',
};

function readLogoutReason() {
  try { return LOGOUT_REASONS[sessionStorage.getItem(LOGOUT_REASON_KEY)] || ''; } catch { return ''; }
}

function windowsMessage(reason) {
  return WINDOWS_MESSAGES[reason] || MESSAGES[reason] || GENERIC_ERROR_MESSAGE;
}

/** 55 — Windows 계정 확인 경로로 최상위 이동한다(크롬이 계정을 자동으로 보낸다). employeeId 를 주면 그 사번이어야 한다.
 * 테스트가 바꿔 끼운다. */
export const windowsLogin = {
  go(next, employeeId) {
    const q = new URLSearchParams();
    if (next && next !== '/') q.set('next', next);
    if (employeeId) q.set('employee_id', employeeId);
    const qs = q.toString();
    window.location.replace(`/auth/windows${qs ? `?${qs}` : ''}`);
  },
};

/** ApiError(HTTP 오류)와 네트워크 오류(fetch 자체 실패)를 구분해 한국어 안내로 바꾼다. */
function messageFor(err) {
  if (err instanceof ApiError) {
    if (typeof err.detail === 'string' && MESSAGES[err.detail]) return MESSAGES[err.detail];
    if (err.status === 422) return VALIDATION_ERROR_MESSAGE;
    return GENERIC_ERROR_MESSAGE;
  }
  return NETWORK_ERROR_MESSAGE;
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const windowsReason = params.get('windows') || '';
  const next = location.state?.from || params.get('next') || '/';
  // 55 — undefined = 아직 모름(사번 칸은 그대로 보인다), null = 못 읽음
  const [options, setOptions] = useState(undefined);
  const [employeeId, setEmployeeId] = useState(() => localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice] = useState(readLogoutReason);
  // 읽는 것과 지우는 것을 나눈다 — 렌더 중 지우면 개발 모드의 이중 초기화가 빈 값을 읽는다
  useEffect(() => {
    try { sessionStorage.removeItem(LOGOUT_REASON_KEY); } catch { /* 없어도 그만 */ }
  }, []);

  useEffect(() => {
    let alive = true;
    api('/auth/options', { auth: false })
      .then((o) => { if (alive) setOptions(o && typeof o === 'object' ? o : null); })
      .catch(() => { if (alive) setOptions(null); });
    return () => { alive = false; };
  }, []);

  const windowsOn = !!options?.windows;
  const employeeIdOn = options?.employee_id_login !== false;
  // 들어오자마자 한 번만 자동으로 — 방금 실패했거나(?windows=) 로그아웃했으면(안내 문구) [로그인]을 누를 때까지 기다린다
  const autoTry = windowsOn && !windowsReason && !notice && !loading && !user;
  useEffect(() => {
    if (autoTry) windowsLogin.go(next);
  }, [autoTry, next]);

  // 방금 입력한 오류가 먼저, 없으면 /auth/windows 가 돌려보낸 사유
  const shownError = error || (windowsReason ? windowsMessage(windowsReason) : '');

  // 세션 복원 중에는 로그인/비로그인 여부를 아직 모르므로 아무것도 그리지 않는다.
  if (loading) return null;
  // 이미 로그인돼 있으면(예: 다른 화면에서 왔다가 리다이렉트) 원래 가려던 곳으로 보낸다.
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    const id = employeeId.trim().toUpperCase();
    if (windowsOn) {
      // 이 PC 의 Windows 계정이 입력한 사번과 같아야 들어온다 — 결과는 /login?windows=<사유> 로 돌아오거나 앱으로 넘어간다
      if (!id) {
        setError(EMPTY_EMPLOYEE_ID_MESSAGE);
        return;
      }
      try { localStorage.setItem(SAVED_EMPLOYEE_ID_KEY, id); } catch { /* 기억하지 못해도 로그인은 한다 */ }
      setBusy(true);
      windowsLogin.go(next, id);
      return;
    }
    setBusy(true);
    try {
      await login(employeeId.trim());
      // 로그인 성공 후 이동은 user 상태 변화로 위의 <Navigate> 가 처리한다(중복 내비게이션 방지).
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // 서명 화면: 왼쪽 네이비 브랜드 면(Hi-TESS 로고 + 목적 한 줄) | 오른쪽 흰 양식 면. 좁은 화면에서는 네이비 띠가 위로 간다.
    <main className="grid min-h-full grid-rows-[auto_1fr] bg-n-0 min-[900px]:grid-cols-[minmax(400px,5fr)_7fr] min-[900px]:grid-rows-1">
      <section aria-label="Hi-TESS LogBook" className="on-navy flex flex-col gap-10 bg-navy-900 px-8 py-8 min-[900px]:justify-between min-[900px]:px-14 min-[900px]:py-12">
        <Logo tone="navy" size={36} subtitle textClassName="text-[18px] leading-6" />
        <div>
          <p className="max-w-[520px] text-[26px] font-semibold leading-[36px] tracking-[-0.02em] text-on-navy [text-wrap:balance]
                        min-[900px]:text-[32px] min-[900px]:leading-[44px] min-[1600px]:text-[40px] min-[1600px]:leading-[54px]">
            지난 구조해석을 호선 번호와 문서 내용으로 바로 찾습니다.
          </p>
          <p className="mt-8 hidden border-t border-navy-700 pt-5 text-meta text-on-navy-subtle min-[900px]:block">
            문서, 결과, 모델 파일을 <span className="font-mono">999_LogBook</span> 공유 폴더 한곳에 모읍니다.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <h1 className="text-title font-semibold tracking-[-0.018em] text-n-900">사번으로 들어갑니다</h1>
          <p className="mt-1 text-ui text-n-600">HiTESS WorkBench 와 같은 사번을 씁니다.</p>
          {notice && (
            <p role="status" className="mt-4 rounded-md border border-n-200 bg-n-50 px-3 py-2 text-ui text-n-700">{notice}</p>
          )}
          {autoTry && <p role="status" className="mt-4 text-ui text-n-600">로그인하는 중…</p>}
          {(windowsOn || employeeIdOn) && (
            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <label htmlFor="employee-id" className="flex flex-col gap-1 text-meta font-medium text-n-600">
                사번
                <input
                  id="employee-id" value={employeeId} placeholder="A123456" maxLength={20} aria-required autoFocus
                  autoComplete="username" autoCapitalize="characters" spellCheck={false}
                  aria-invalid={shownError ? true : undefined} aria-describedby={shownError ? 'auth-error' : undefined}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className={inputClass('h-9 text-body font-mono placeholder:font-mono')}
                />
              </label>
              {shownError && (
                <p id="auth-error" role="alert" className="flex items-start gap-2 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
                  {shownError}
                </p>
              )}
              <Button type="submit" size="lg" className="mt-1 w-full" loading={busy} disabled={busy}>로그인</Button>
            </form>
          )}
          <p className="mt-6 border-t border-n-200 pt-4 text-meta text-n-500">
            따로 가입하지 않습니다. WorkBench 에서 가입·승인된 사번이면 바로 들어오고, 처음에는 LV1(게스트)로 공유 자료를 봅니다.
          </p>
        </div>
      </section>
    </main>
  );
}
