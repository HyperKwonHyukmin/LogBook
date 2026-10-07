import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Columns2, X } from 'lucide-react';
import {
  BASKET_FULL_TEXT, BASKET_KEY, BASKET_MAX, addItem, cleanItems, compareHref, itemsFromIds, patchItem, readBasket, removeItem,
  sameIds, writeBasket,
} from '../../lib/compareBasket.js';
import Button, { buttonClass } from '../ui/Button.jsx';
import { useToast } from '../ui/Toast.jsx';

const BasketContext = createContext(null);

/** localStorage 를 꺼내 쓴다 — 막힌 환경(사생활 모드 등)에서는 접근 자체가 던질 수 있다. */
function storage() {
  try { return window.localStorage; } catch { return null; }
}

/**
 * 비교 바구니(07) — 셸 전체에서 하나. 이 브라우저에만 저장한다(lib/compareBasket.js).
 * ToastProvider 안에 둔다(다섯 번째 담기는 알림).
 */
export function CompareBasketProvider({ children }) {
  const toast = useToast();
  const [items, setState] = useState(() => readBasket(storage()));
  // 담기 결과('full' 알림)를 바로 알아야 해서 지금 목록을 ref 로도 든다(갱신 함수는 다음 렌더에야 돈다).
  const ref = useRef(items);
  const setItems = useCallback((next) => {
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
  }, []);

  useEffect(() => { writeBasket(storage(), items); }, [items]);
  // 다른 탭에서 담거나 빼면 따라간다.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === BASKET_KEY) setItems(readBasket(storage())); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setItems]);

  const add = useCallback((item) => {
    const r = addItem(ref.current, item);
    setItems(r.items);
    if (r.result === 'full') toast.show({ message: BASKET_FULL_TEXT, tone: 'info' });
    return r.result;
  }, [toast, setItems]);
  const remove = useCallback((id) => setItems(removeItem(ref.current, id)), [setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);
  const patch = useCallback((id, p) => setItems(patchItem(ref.current, id, p)), [setItems]);
  /** 주소가 원본 — 비교 화면을 주소로 열면 바구니를 그 목록으로 맞춘다. */
  const syncIds = useCallback((ids) => {
    const cur = ref.current;
    if (!sameIds(cur.map((x) => x.id), ids)) setItems(itemsFromIds(ids, cur));
  }, [setItems]);

  const value = useMemo(() => {
    const ids = items.map((x) => x.id);
    return { items, ids, has: (id) => ids.includes(Number(id)), add, remove, clear, patch, syncIds };
  }, [items, add, remove, clear, patch, syncIds]);
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

const NOOP_BASKET = {
  items: [], ids: [], has: () => false, add: () => 'invalid', remove: () => {}, clear: () => {}, patch: () => {}, syncIds: () => {},
};

/** 바구니. 공급자가 없으면(단독 렌더 테스트 등) 빈 바구니. */
export function useCompareBasket() {
  return useContext(BasketContext) || NOOP_BASKET;
}

/** 바구니 띠가 보이는가(GlobalDrop 이 그 위로 피한다). 비교 화면에서는 화면 자체가 바구니라 띄우지 않는다. */
export function useBasketBarVisible() {
  const { items } = useCompareBasket();
  const { pathname } = useLocation();
  return items.length > 0 && !pathname.startsWith('/compare');
}

/**
 * [비교에 담기] ↔ [비교에서 빼기]. file = { id, name, hull? }.
 * 결과 행 안에 둘 때는 stop 으로 행 클릭(미리보기 열기)과 섞이지 않게 한다.
 */
export function CompareToggle({ file, variant = 'secondary', size = 'sm', className = '', stop = false }) {
  const basket = useCompareBasket();
  const on = basket.has(file.id);
  const onClick = (e) => {
    if (stop) e.stopPropagation();
    if (on) basket.remove(file.id);
    else basket.add({ id: file.id, name: file.name, hull: file.hull || '' });
  };
  return (
    <Button variant={on ? 'secondary' : variant} size={size} className={className} aria-pressed={on} onClick={onClick}
            title={on ? '비교 바구니에서 뺍니다' : `비교 바구니에 담습니다 (최대 ${BASKET_MAX}개)`}>
      {on ? <X size={14} aria-hidden="true" /> : <Columns2 size={14} aria-hidden="true" />}
      {on ? '비교에서 빼기' : '비교에 담기'}
    </Button>
  );
}

/**
 * 바구니 띠 — 화면 아래 가운데(토스트 자리 위), 담긴 것이 있을 때만. 떠 있는 표면이라 shadow-lg.
 * z-30: 토스트(z-50)·올리기 진행 상자(z-40)보다 아래.
 */
export function CompareBar() {
  const basket = useCompareBasket();
  const visible = useBasketBarVisible();
  if (!visible) return null;
  const items = cleanItems(basket.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 flex justify-center px-4">
      <section aria-label="비교 바구니"
               className="pointer-events-auto flex max-w-full animate-toast flex-wrap items-center gap-1.5 rounded-lg border border-n-200 bg-n-0 py-1.5 pl-3 pr-1.5 shadow-lg">
        <h2 className="mr-1 flex items-center gap-1.5 text-ui font-semibold text-n-800">
          <Columns2 size={14} aria-hidden="true" className="text-n-400" />비교
          <span className="font-mono text-meta font-normal text-n-500">{items.length}/{BASKET_MAX}</span>
        </h2>
        <ul role="list" className="flex min-w-0 flex-wrap items-center gap-1">
          {items.map((it) => (
            <li key={it.id} className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-sm bg-n-100 pl-2 pr-0.5 text-meta text-n-800">
              <span className="min-w-0 truncate" title={it.name || `파일 ${it.id}`}>{it.name || `파일 ${it.id}`}</span>
              {it.hull && <span className="shrink-0 font-mono text-n-600">{it.hull}</span>}
              <button type="button" onClick={() => basket.remove(it.id)} aria-label={`${it.name || `파일 ${it.id}`} 빼기`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-n-500 transition-colors duration-150 ease-out hover:bg-n-200 hover:text-n-900">
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Link to={compareHref(items.map((x) => x.id))} className={buttonClass('primary', 'sm', 'ml-1')}>비교 열기</Link>
        <Button variant="ghost" size="sm" onClick={basket.clear}>비우기</Button>
      </section>
    </div>
  );
}
