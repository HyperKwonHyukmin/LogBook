import { useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import Logo from '../components/ui/Logo.jsx';
import { api, ApiError } from '../api/client.js';
import { SAVED_EMPLOYEE_ID_KEY, useAuth } from '../auth/AuthContext.jsx';

const MESSAGES = {
  not_registered: '등록되지 않은 사번입니다. 가입 신청을 해 주세요.',
  pending_approval: '관리자 승인을 기다리는 중입니다. 승인되면 로그인할 수 있습니다.',
  account_disabled: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
  invalid_employee_id: '사번 형식이 올바르지 않습니다. (예: A123456)',
  already_registered: '이미 가입 신청된 사번입니다.',
};
const NAME_REQUIRED_MESSAGE = '이름을 입력해 주세요.';
const VALIDATION_ERROR_MESSAGE = '입력값을 확인해 주세요.';
const GENERIC_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다.';

/** ApiError(HTTP 오류)와 네트워크 오류(fetch 자체 실패)를 구분해 한국어 안내로 바꾼다. */
function messageFor(err) {
  if (err instanceof ApiError) {
    if (typeof err.detail === 'string' && MESSAGES[err.detail]) return MESSAGES[err.detail];
    if (err.status === 422) return VALIDATION_ERROR_MESSAGE;
    return GENERIC_ERROR_MESSAGE;
  }
  return NETWORK_ERROR_MESSAGE;
}

const TABS = [
  { key: 'login', label: '로그인', id: 'auth-tab-login' },
  { key: 'register', label: '가입 신청', id: 'auth-tab-register' },
];

function Field({
  id, label, value, onChange, placeholder, mono = false, maxLength,
  autoComplete, autoCapitalize, spellCheck, invalid = false, describedBy, ariaRequired = false,
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700">
      {label}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        aria-required={ariaRequired || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [employeeId, setEmployeeId] = useState(() => localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const tabRefs = useRef([]);

  // 세션 복원 중에는 로그인/비로그인 여부를 아직 모르므로 아무것도 그리지 않는다.
  if (loading) return null;
  // 이미 로그인돼 있으면(예: 다른 화면에서 왔다가 리다이렉트) 원래 가려던 곳으로 보낸다.
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  function switchMode(nextMode) {
    setMode(nextMode);
    setError('');
    setDone('');
  }

  function onTabKeyDown(e, idx) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const nextIdx = e.key === 'ArrowRight'
      ? (idx + 1) % TABS.length
      : (idx - 1 + TABS.length) % TABS.length;
    switchMode(TABS[nextIdx].key);
    tabRefs.current[nextIdx]?.focus();
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setDone('');
    if (mode === 'register' && !name.trim()) {
      setError(NAME_REQUIRED_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(employeeId.trim());
        // 로그인 성공 후 이동은 user 상태 변화로 위의 <Navigate> 가 처리한다(중복 내비게이션 방지).
      } else {
        await api('/auth/register', {
          method: 'POST',
          auth: false,
          body: { employee_id: employeeId.trim(), name: name.trim(), department: department.trim() || null },
        });
        setDone('가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.');
        // 사번은 남겨 둔 채 로그인 탭으로 돌아가 바로 로그인을 시도할 수 있게 한다.
        setMode('login');
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const activeTab = TABS.find((t) => t.key === mode) ?? TABS[0];
  const employeeIdInvalid = !!error && error !== NAME_REQUIRED_MESSAGE;
  const nameInvalid = mode === 'register' && error === NAME_REQUIRED_MESSAGE;

  const tabClass = (active) =>
    `h-9 flex-1 border-b-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-500'}`;

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-8 shadow-sm">
        <Logo size={36} />
        <div role="tablist" aria-label="로그인 방식" className="mt-8 flex border-b border-line">
          {TABS.map((tab, idx) => (
            <button
              key={tab.key}
              ref={(el) => { tabRefs.current[idx] = el; }}
              role="tab"
              id={tab.id}
              aria-selected={mode === tab.key}
              aria-controls="auth-panel"
              tabIndex={mode === tab.key ? 0 : -1}
              disabled={busy}
              className={tabClass(mode === tab.key)}
              onClick={() => switchMode(tab.key)}
              onKeyDown={(e) => onTabKeyDown(e, idx)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={onSubmit}
          role="tabpanel"
          id="auth-panel"
          aria-labelledby={activeTab.id}
          className="mt-6 flex flex-col gap-4"
        >
          <Field
            id="employee-id" label="사번" value={employeeId} onChange={setEmployeeId}
            placeholder="A123456" mono maxLength={20} ariaRequired
            autoComplete="username" autoCapitalize="characters" spellCheck={false}
            invalid={employeeIdInvalid} describedBy={employeeIdInvalid ? 'auth-error' : undefined}
          />
          {mode === 'register' && (
            <>
              <Field
                id="name" label="이름" value={name} onChange={setName} maxLength={50} ariaRequired
                autoComplete="name"
                invalid={nameInvalid} describedBy={nameInvalid ? 'auth-error' : undefined}
              />
              <Field
                id="department" label="부서" value={department} onChange={setDepartment}
                maxLength={100} autoComplete="organization"
              />
            </>
          )}
          {error && (
            <p id="auth-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-err">
              {error}
            </p>
          )}
          {done && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-[13px] text-ok">{done}</p>}
          <Button type="submit" size="lg" disabled={busy}>{mode === 'login' ? '로그인' : '가입 신청'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-500">사번으로 가입 신청 → 관리자 승인 후 사용할 수 있습니다.</p>
      </div>
    </main>
  );
}
