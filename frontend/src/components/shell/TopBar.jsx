import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Search, Upload, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Logo from '../ui/Logo.jsx';
import Menu from '../ui/Menu.jsx';

const DEBOUNCE_MS = 200;

export default function TopBar({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onHome = location.pathname === '/';
  const urlQ = onHome ? params.get('q') || '' : null;
  const [q, setQ] = useState(urlQ || '');
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  // 타이머가 늦게 불려도 그 순간의 주소(다른 필터)를 쓰게 한다.
  const locRef = useRef(location);
  locRef.current = location;
  // 입력칸에서 스스로 보낸 q — 이 값이 주소로 돌아오면 입력칸을 덮지 않는다(입력 중인 글자·공백 보존).
  const pushedRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 주소의 q 가 바뀌면(뒤로 가기·링크 공유) 입력칸을 맞춘다. 입력 중인 앞뒤 공백은 지우지 않는다.
  useEffect(() => {
    if (urlQ === null) return;
    const mine = pushedRef.current === urlQ;
    pushedRef.current = null;
    if (mine) return;
    // 밖에서 바뀐 주소가 이긴다 — 걸려 있던 입력 반영이 이 주소를 되돌리지 않게 취소한다.
    clearTimeout(timerRef.current);
    setQ((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);

  // 다른 화면으로 옮겨 가면 걸려 있던 입력 반영을 취소한다(떠난 뒤 검색 화면으로 끌려오지 않게).
  useEffect(() => () => clearTimeout(timerRef.current), [location.pathname]);

  function go(value, { replace }) {
    const loc = locRef.current;
    const home = loc.pathname === '/';
    const p = new URLSearchParams(home ? loc.search : '');
    const query = value.trim();
    if (query) p.set('q', query); else p.delete('q');
    pushedRef.current = query;
    const search = p.toString();
    navigate(search ? `/?${search}` : '/', { replace });
  }

  function onChange(e) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const home = locRef.current.pathname === '/';
      if (!home && !value.trim()) return;
      go(value, { replace: home });
    }, DEBOUNCE_MS);
  }

  function onSubmit(e) {
    e.preventDefault();
    clearTimeout(timerRef.current);
    if (!q.trim()) return;
    go(q, { replace: false });
  }

  function onClear() {
    clearTimeout(timerRef.current);
    setQ('');
    if (locRef.current.pathname === '/') go('', { replace: true });
    inputRef.current?.focus();
  }

  return (
    <header className="on-navy flex h-12 shrink-0 items-center gap-3 bg-navy-900 px-3">
      <div className="flex w-[196px] shrink-0 items-center pl-1"><Logo tone="navy" /></div>
      <form role="search" className="min-w-0 flex-1" onSubmit={onSubmit}>
        {/* 네이비 위의 흰 검색칸 — 화면의 첫 진입점이라 크롬에서 가장 밝은 면이다 */}
        <label className="field group flex h-9 w-full max-w-[560px] items-center gap-2 rounded-md border border-n-0 bg-n-0 px-2.5 shadow-xs
                          transition-[box-shadow] duration-150 ease-out hover:shadow-[0_0_0_3px_var(--color-navy-600)]">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-brand" aria-hidden="true" />
          <input ref={inputRef} aria-label="검색어" value={q} onChange={onChange}
                 placeholder="호선, 제목, 보고서 내용 검색…"
                 className="min-w-0 flex-1 bg-transparent text-body text-n-900 outline-none focus-visible:outline-none" />
          {q ? (
            <button type="button" aria-label="검색어 지우기" onClick={onClear}
                    className="flex h-5 w-5 items-center justify-center rounded-xs text-n-500 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
              <X size={14} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="inline-flex h-5 items-center rounded-sm border border-n-200 bg-n-50 px-1.5 font-mono text-micro text-n-600">Ctrl K</kbd>
          )}
        </label>
      </form>
      <Button variant="inverse" size="md" onClick={() => navigate('/inbox')}><Upload size={14} aria-hidden="true" />올리기</Button>
      <Menu
        width={232}
        trigger={(props) => (
          <button type="button" {...props} aria-label={`계정 메뉴 (${user.name})`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-ui font-semibold text-on-navy ring-1 ring-navy-500
                             transition-colors duration-150 ease-out hover:bg-navy-600 active:bg-navy-600 aria-expanded:bg-navy-600">
            {user.name.slice(0, 1)}
          </button>
        )}
        header={(
          <div className="border-b border-n-200 px-3 pb-2.5 pt-2">
            <div className="text-body font-semibold text-n-900">{user.name}</div>
            <div className="font-mono text-meta text-n-500">{user.employee_id}</div>
            {user.department && <div className="text-meta text-n-500">{user.department}</div>}
          </div>
        )}
        items={[{ label: '로그아웃', icon: LogOut, onSelect: onLogout }]}
      />
    </header>
  );
}
