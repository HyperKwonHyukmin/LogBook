import { useEffect } from 'react';
import { PREVIEW_MIN, writeStoredWidth } from './panelWidth.js';
import { PREF_KEYS, flushPrefs, loadPrefs, subscribePrefs } from './prefs.js';
import { writeStoredGroup } from './searchGroup.js';

/**
 * 로그인한 셸이 뜰 때 한 번 서버 설정(10)을 받아 localStorage 사본에 옮긴다 — 그 화면(검색)이 아직
 * 열리지 않았어도 나중에 열 때 서버 값으로 시작하게. 열려 있는 화면은 subscribePrefs 로 직접 받는다.
 * 창을 닫거나 새로 고칠 때는 대기 중인 변경을 바로 보낸다(못 보내도 다음 시작 때 다시 보낸다).
 */
export default function usePrefsSync(employeeId) {
  useEffect(() => {
    if (!employeeId) return undefined;
    const off = subscribePrefs((key, value) => {
      if (key === PREF_KEYS.searchGroup) { writeStoredGroup(value); return; }   // 11 — 보기 기준
      if (key !== PREF_KEYS.previewWidth) return;
      const n = Number(value);
      writeStoredWidth(value != null && Number.isFinite(n) && n >= PREVIEW_MIN ? Math.round(n) : null);
    });
    loadPrefs();
    const onHide = () => { flushPrefs(); };
    window.addEventListener('pagehide', onHide);
    return () => { off(); window.removeEventListener('pagehide', onHide); };
  }, [employeeId]);
}
