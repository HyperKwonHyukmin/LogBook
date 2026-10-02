import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';

const ToastContext = createContext(null);
const DURATION_MS = 5000;

/**
 * 화면 하단 가운데 토스트 하나(새 토스트가 앞의 것을 바꾼다).
 * show({ message, tone: 'ok'|'err'|'info', action: { label, onClick } })
 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => { clearTimeout(timerRef.current); setToast(null); }, []);
  const show = useCallback((t) => {
    clearTimeout(timerRef.current);
    const id = ++idRef.current;
    setToast({ ...t, id });
    timerRef.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), t.duration ?? DURATION_MS);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const Icon = toast?.tone === 'err' ? CircleAlert : Check;
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {toast && (
          <div key={toast.id} role="status"
               className="pointer-events-auto flex h-9 max-w-[560px] animate-toast items-center gap-2.5 rounded-md bg-n-900 pl-3 pr-1 text-ui text-n-0 shadow-lg">
            <Icon size={14} aria-hidden="true" className={toast.tone === 'err' ? 'text-err-line' : 'text-ok-on-dark'} />
            <span className="min-w-0 truncate">{toast.message}</span>
            {toast.action && (
              <button type="button" onClick={() => { dismiss(); toast.action.onClick(); }}
                      className="h-7 rounded-sm px-2 font-medium text-link-on-dark transition-colors duration-120 ease-out hover:bg-n-800 hover:text-n-0 active:bg-n-700">
                {toast.action.label}
              </button>
            )}
            <button type="button" aria-label="알림 닫기" onClick={dismiss}
                    className="flex h-7 w-7 items-center justify-center rounded-sm text-n-400 transition-colors duration-120 ease-out hover:bg-n-800 hover:text-n-0">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** 토스트 함수. 공급자가 없으면(단독 렌더 테스트 등) 아무것도 하지 않는다. */
export function useToast() {
  return useContext(ToastContext) || NOOP;
}
const NOOP = { show: () => {}, dismiss: () => {} };
