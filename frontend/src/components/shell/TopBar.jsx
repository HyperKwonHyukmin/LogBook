import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Search, Upload } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Logo from '../ui/Logo.jsx';

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

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-white pl-5 pr-4">
      <div className="w-44"><Logo /></div>
      <form role="search" className="flex-1" onSubmit={onSubmit}>
        <label className="flex h-[38px] max-w-[640px] items-center gap-2.5 rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-zinc-500 focus-within:border-brand focus-within:bg-white focus-within:ring-3 focus-within:ring-brand-ring">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input ref={inputRef} aria-label="검색어" value={q} onChange={onChange}
                 placeholder="호선, 제목, 보고서 내용 검색…"
                 className="flex-1 bg-transparent text-sm text-zinc-900 outline-none" />
          <kbd className="rounded border border-b-2 border-zinc-300 bg-white px-1.5 font-mono text-[11px] text-zinc-600">Ctrl K</kbd>
        </label>
      </form>
      <Button onClick={() => navigate('/inbox')}><Upload size={14} aria-hidden="true" />올리기</Button>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-[13px] font-semibold text-white"
              title={`${user.name} (${user.employee_id})`}>{user.name.slice(0, 1)}</span>
        <Button variant="ghost" size="sm" onClick={onLogout} aria-label="로그아웃"><LogOut size={16} aria-hidden="true" /></Button>
      </div>
    </header>
  );
}
