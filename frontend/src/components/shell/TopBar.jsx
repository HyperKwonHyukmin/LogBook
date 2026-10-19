import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Search, Upload, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Logo from '../ui/Logo.jsx';
import Menu from '../ui/Menu.jsx';
import { canWriteLevel, levelName, levelOf } from '../../lib/levels.js';
import { api } from '../../api/client.js';
import { FACET_LABELS } from '../../lib/labels.js';

const DEBOUNCE_MS = 200;
// 19 — 자동완성: 종류마다 몇 개까지, 순서는 호선 · 구역 · 태그
const SUGGEST_LIMIT = 5;
const SUGGEST_KINDS = ['hull', 'zone', 'tag'];

/** /api/suggest/all 응답 → 한 줄 목록 [{key, value}] (종류 순서대로). */
export function suggestOptions(res) {
  return SUGGEST_KINDS.flatMap((key) => (Array.isArray(res?.[key]) ? res[key] : []).map((value) => ({ key, value })));
}

/**
 * 후보를 고른 검색 주소(19) — 지금 검색 화면의 다른 필터는 두고 그 칸에 값을 더한다. 입력한 글자(q)는 뺀다
 * (그 글자로 후보를 찾은 것이라, 남기면 '선수' 글자 검색과 구역 '선수부' 가 겹쳐 결과가 좁아진다).
 */
export function suggestionSearch(currentSearch, { key, value }) {
  const p = new URLSearchParams(currentSearch);
  p.delete('q');
  if (!p.getAll(key).includes(value)) p.append(key, value);
  return p.toString();
}

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
  // 19 — 자동완성(ARIA combobox). options = [{key, value}], active = ↑/↓ 로 고른 후보(-1 = 없음)
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [options, setOptions] = useState([]);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);   // Esc 로 닫았다 — 다시 입력할 때까지 숨긴다
  const suggestReq = useRef(0);
  const open = focused && !dismissed && options.length > 0;

  // 입력이 멈추면 호선·구역·태그 후보를 한 번에 묻는다. 늦게 온 옛 응답은 버린다. 실패하면 후보 없이 그냥 검색창이다
  useEffect(() => {
    const text = q.trim();
    const id = ++suggestReq.current;
    if (!focused || !text) { setOptions([]); setActive(-1); return undefined; }
    const t = setTimeout(() => {
      api(`/suggest/all?${new URLSearchParams({ q: text, limit: String(SUGGEST_LIMIT) })}`)
        .then((res) => { if (id === suggestReq.current) { setOptions(suggestOptions(res)); setActive(-1); } })
        .catch(() => { if (id === suggestReq.current) setOptions([]); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, focused]);

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
    setDismissed(false);
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
    setDismissed(true);
    go(q, { replace: false });
  }

  /** 후보를 고른다 — 그 필터로 검색 화면에 간다(19). 입력칸은 비운다(글자 대신 필터로 찾았다). */
  function pick(opt) {
    clearTimeout(timerRef.current);
    const loc = locRef.current;
    const search = suggestionSearch(loc.pathname === '/' ? loc.search : '', opt);
    pushedRef.current = '';
    setQ('');
    setOptions([]);
    setActive(-1);
    navigate(search ? `/?${search}` : '/');
  }

  function onKeyDown(e) {
    if (e.nativeEvent?.isComposing) return;   // 한글 조합 중의 ↑/↓/Enter 는 입력기 몫
    if (e.key === 'ArrowDown' && options.length && !dismissed) {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length && !dismissed) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setDismissed(true);
      setActive(-1);
    }
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
      <form role="search" className="relative min-w-0 max-w-[560px] flex-1" onSubmit={onSubmit}>
        {/* 네이비 위의 흰 검색칸 — 화면의 첫 진입점이라 크롬에서 가장 밝은 면이다 */}
        <label className="field group flex h-9 w-full items-center gap-2 rounded-md border border-n-0 bg-n-0 px-2.5 shadow-xs
                          transition-[box-shadow] duration-150 ease-out hover:shadow-[0_0_0_3px_var(--color-navy-600)]">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-brand" aria-hidden="true" />
          {/* 19 — 자동완성(ARIA combobox): ↑/↓ 로 후보, Enter 로 그 필터 검색, 그냥 Enter 는 글자 검색, Esc 로 닫기 */}
          <input ref={inputRef} aria-label="검색어" value={q} onChange={onChange} onKeyDown={onKeyDown}
                 role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
                 aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
                 onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActive(-1); }}
                 placeholder="호선, 제목, 문서 내용 검색…"
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
        {open && (
          <ul id={listId} role="listbox" aria-label="검색 후보"
              className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 animate-pop overflow-auto rounded-lg bg-n-0 py-1 shadow-md">
            {options.map((o, i) => (
              <li key={`${o.key}:${o.value}`} id={`${listId}-opt-${i}`} role="option" aria-selected={i === active} tabIndex={-1}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-ui ${i === active ? 'bg-brand-subtle text-brand' : 'text-n-800'}`}>
                <span className="w-9 shrink-0 text-meta text-n-500">{FACET_LABELS[o.key]}</span>
                <span className={`min-w-0 flex-1 truncate ${o.key === 'hull' ? 'font-mono' : ''}`}>{o.value}</span>
              </li>
            ))}
            <li role="presentation" className="border-t border-n-200 px-2.5 pt-1.5 pb-1 text-micro text-n-500">
              Enter = 글자로 검색 · ↑↓ 로 후보 고르기
            </li>
          </ul>
        )}
      </form>
      {/* 15 — 올리기는 LV1 이상 모두(로그인한 누구나) */}
      {canWriteLevel(user) && (
        <Button variant="inverse" size="md" onClick={() => navigate('/inbox')}><Upload size={14} aria-hidden="true" />올리기</Button>
      )}
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
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-meta text-n-600">
              <span>등급</span>
              <span className="inline-flex h-5 items-center rounded-xs bg-n-100 px-1.5 text-micro font-semibold text-n-800"
                    data-testid="my-level">{levelName(levelOf(user))}</span>
              {user.wb_admin && <span className="text-micro text-n-500">WorkBench 관리자</span>}
            </div>
          </div>
        )}
        items={[{ label: '로그아웃', icon: LogOut, onSelect: onLogout }]}
      />
    </header>
  );
}
