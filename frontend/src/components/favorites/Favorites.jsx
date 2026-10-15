import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import { useToast } from '../ui/Toast.jsx';

/**
 * 즐겨찾기(10) — 서버(사용자별)에 두고, 화면은 응답의 `favorite` 를 처음 값으로 쓴다.
 * 별을 누르면 바로 바꿔 보이고(낙관적) 실패하면 되돌린 뒤 토스트로 알린다. 같은 Entry 의 별이 결과 행·
 * 미리보기·상세에 함께 있어도 같은 값을 보이게, 누른 값은 셸 전체에서 하나(overrides)로 기억한다.
 */
const FavoritesContext = createContext(null);

export function FavoritesProvider({ children }) {
  const toast = useToast();
  const [overrides, setOverrides] = useState(() => new Map());
  const seq = useRef(new Map()); // Entry 마다 마지막 요청 번호 — 늦게 온 옛 실패가 새 값을 되돌리지 않게

  const set = useCallback((id, value) => {
    setOverrides((m) => { const next = new Map(m); next.set(id, value); return next; });
  }, []);

  const toggle = useCallback(async (entryId, current) => {
    const next = !current;
    const n = (seq.current.get(entryId) || 0) + 1;
    seq.current.set(entryId, n);
    set(entryId, next);
    try {
      await api(`/favorites/${encodeURIComponent(entryId)}`, { method: next ? 'PUT' : 'DELETE' });
    } catch (err) {
      if (seq.current.get(entryId) !== n) return;
      set(entryId, current);
      toast.show({ tone: 'err', message: errorText(err, next ? '즐겨찾기에 넣지 못했습니다.' : '즐겨찾기에서 빼지 못했습니다.') });
    }
  }, [set, toast]);

  const value = useMemo(() => ({
    isFavorite: (entryId, fallback = false) => (overrides.has(entryId) ? overrides.get(entryId) : !!fallback),
    toggle,
  }), [overrides, toggle]);
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

const LOCAL = { isFavorite: (_id, fallback = false) => !!fallback, toggle: null };

/** 공급자가 없으면(단독 렌더 테스트) 응답 값만 보이고 누를 때 이 컴포넌트 안에서만 바꾼다. */
export function useFavorites() {
  return useContext(FavoritesContext) || LOCAL;
}

const SIZES = { sm: { box: 'h-7 w-7', icon: 15 }, md: { box: 'h-8 w-8', icon: 16 } };

/**
 * 별 단추. initial = 서버 응답의 favorite. stop 이면 눌러도 바깥 행(선택·미리보기·이동)이 반응하지 않는다.
 * reveal 이면 꺼진 별은 바깥 `group/row` 에 마우스를 올리거나 포커스가 있을 때만 보인다(켜진 별은 늘 보인다).
 */
export function FavoriteToggle({ entryId, initial = false, size = 'sm', stop = false, reveal = false, disabled = false,
                                 className = '' }) {
  const fav = useFavorites();
  const [local, setLocal] = useState(null);
  const on = fav.toggle ? fav.isFavorite(entryId, initial) : (local ?? !!initial);
  const s = SIZES[size] || SIZES.sm;
  const label = on ? '즐겨찾기 해제' : '즐겨찾기 추가';
  function onClick(e) {
    if (stop) e.stopPropagation();
    if (disabled) return;
    if (fav.toggle) fav.toggle(entryId, on);
    else setLocal(!on);
  }
  const hide = reveal && !on
    ? 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
    : '';
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} disabled={disabled}
            onClick={onClick}
            className={`inline-flex shrink-0 items-center justify-center rounded-md transition-[background-color,color,opacity] duration-150 ease-out
              ${s.box} ${on ? 'text-fav hover:bg-n-100' : 'text-n-400 hover:bg-n-100 hover:text-n-600'} active:bg-n-150
              disabled:cursor-not-allowed disabled:bg-transparent disabled:text-n-300 ${hide} ${className}`}>
      <Star size={s.icon} strokeWidth={1.75} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
