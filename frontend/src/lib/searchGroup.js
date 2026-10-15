import { useCallback, useEffect, useState } from 'react';
import { PREF_KEYS, savePref, subscribePrefs } from './prefs.js';
import { isGroup } from './search.js';

/**
 * 마지막으로 고른 '보기 기준'(11) — 서버 설정(search.group)이 원본이고 localStorage 는 빠른 사본이다.
 * 주소에 group 이 없으면 검색 화면이 이 값으로 묶는다(주소에도 적어 공유되게 한다).
 */
export const GROUP_STORE_KEY = 'logbook.searchGroup.v1';

export function readStoredGroup() {
  try {
    const v = globalThis.localStorage?.getItem(GROUP_STORE_KEY);
    return isGroup(v) ? v : '';
  } catch {
    return '';
  }
}

export function writeStoredGroup(v) {
  try {
    if (isGroup(v)) globalThis.localStorage?.setItem(GROUP_STORE_KEY, v);
    else globalThis.localStorage?.removeItem(GROUP_STORE_KEY);
  } catch { /* 저장소가 막혀도 이번 화면에서는 동작한다 */ }
}

/** [기억한 보기 기준, 고르기(값|'' = 묶지 않음)] — 고르면 이 브라우저와 서버에 함께 남긴다. */
export function useSearchGroupPref() {
  const [group, setGroup] = useState(readStoredGroup);
  useEffect(() => subscribePrefs((key, value) => {
    if (key === PREF_KEYS.searchGroup) setGroup(isGroup(value) ? value : '');
  }), []);
  const choose = useCallback((v) => {
    const g = isGroup(v) ? v : '';
    writeStoredGroup(g);
    setGroup(g);
    savePref(PREF_KEYS.searchGroup, g || null);
  }, []);
  return [group, choose];
}
