import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import Logo from '../components/ui/Logo.jsx';
import { ApiError, LOGOUT_REASON_KEY } from '../api/client.js';
import { SAVED_EMPLOYEE_ID_KEY, useAuth } from '../auth/AuthContext.jsx';

// 15 — 사용자는 HiTESS WorkBench 가입자다. LogBook 자체 가입·승인 대기는 없다
const MESSAGES = {
  not_registered: 'WorkBench 에 가입된 사번이 아닙니다. HiTESS WorkBench 에서 가입·승인받은 뒤 들어오세요.',
  wb_inactive: 'WorkBench 에서 승인 대기 중이거나 비활성화된 계정입니다. WorkBench 관리자에게 문의하세요.',
  wb_unavailable: 'WorkBench 사용자 정보를 읽을 수 없어 로그인할 수 없습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.',
  invalid_employee_id: '사번 형식이 올바르지 않습니다. (예: A123456)',
};
const VALIDATION_ERROR_MESSAGE = '입력값을 확인해 주세요.';
const GENERIC_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다.';
// 18 — 세션이 끊긴 이유(client.js 가 sessionStorage 에 남긴다). 한 번 보여 주고 지운다
const LOGOUT_REASONS = {
  wb_logout: 'WorkBench에서 로그아웃되어 LogBook도 로그아웃되었습니다.',
};

function readLogoutReason() {
  try { return LOGOUT_REASONS[sessionStorage.getItem(LOGOUT_REASON_KEY)] || ''; } catch { return ''; }
}

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
  const [employeeId, setEmployeeId] = useState(() => localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice] = useState(readLogoutReason);
  // 읽는 것과 지우는 것을 나눈다 — 렌더 중 지우면 개발 모드의 이중 초기화가 빈 값을 읽는다
  useEffect(() => {
    try { sessionStorage.removeItem(LOGOUT_REASON_KEY); } catch { /* 없어도 그만 */ }
  }, []);

  // 세션 복원 중에는 로그인/비로그인 여부를 아직 모르므로 아무것도 그리지 않는다.
  if (loading) return null;
  // 이미 로그인돼 있으면(예: 다른 화면에서 왔다가 리다이렉트) 원래 가려던 곳으로 보낸다.
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
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
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <label htmlFor="employee-id" className="flex flex-col gap-1 text-meta font-medium text-n-600">
              사번
              <input
                id="employee-id" value={employeeId} placeholder="A123456" maxLength={20} aria-required autoFocus
                autoComplete="username" autoCapitalize="characters" spellCheck={false}
                aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-error' : undefined}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={inputClass('h-9 text-body font-mono placeholder:font-mono')}
              />
            </label>
            {error && (
              <p id="auth-error" role="alert" className="flex items-start gap-2 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-1 w-full" loading={busy} disabled={busy}>로그인</Button>
          </form>
          <p className="mt-6 border-t border-n-200 pt-4 text-meta text-n-500">
            따로 가입하지 않습니다. WorkBench 에서 가입·승인된 사번이면 바로 들어오고, 처음에는 LV1(게스트)로 공유 자료를 봅니다.
          </p>
        </div>
      </section>
    </main>
  );
}
