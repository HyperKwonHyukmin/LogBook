import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Search, Upload } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Logo from '../ui/Logo.jsx';

export default function TopBar({ user, onLogout }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

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

  function onSubmit(e) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`/?q=${encodeURIComponent(query)}`);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-white pl-5 pr-4">
      <div className="w-44"><Logo /></div>
      <form role="search" className="flex-1" onSubmit={onSubmit}>
        <label className="flex h-[38px] max-w-[640px] items-center gap-2.5 rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-zinc-500 focus-within:border-brand focus-within:bg-white focus-within:ring-3 focus-within:ring-brand-ring">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input ref={inputRef} aria-label="검색어" value={q} onChange={(e) => setQ(e.target.value)}
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
