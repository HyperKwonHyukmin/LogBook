import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { createUploadStore } from '../../lib/uploadStore.js';

const UploadStoreContext = createContext(null);
const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => null, anyBusy: () => false };

export const isOsFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

/**
 * 셸 전체에서 하나인 올리기 저장소. 화면을 옮겨도 올리기가 끊기지 않고(진행률은 GlobalDrop 이 이어 띄운다),
 * 창 닫기·바깥 놓기 막기도 올리는 동안 여기서 계속 건다.
 */
export function UploadProvider({ children, store: given }) {
  const ref = useRef(given || null);
  if (!ref.current) ref.current = createUploadStore();
  const store = ref.current;
  useUploadWindowGuards(store);
  // 셸이 사라지면(로그아웃) 보내던 요청을 끊는다
  useEffect(() => () => store.abortAll(), [store]);
  return <UploadStoreContext.Provider value={store}>{children}</UploadStoreContext.Provider>;
}

/** 셸의 저장소(없으면 null — 단독 렌더 테스트 등). */
export const useUploadStore = () => useContext(UploadStoreContext);

/** 저장소 전체 스냅숏 {jobs, attached}. store 가 없으면 null. */
export function useUploadSnapshot(store) {
  const s = store || NO_STORE;
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}

/**
 * 올리는 동안: 영역 밖에 떨어뜨린 파일을 브라우저가 열어 페이지를 떠나지 않게 하고(안내를 띄운다), 창 닫기를 경고한다.
 * store 가 null 이면 아무것도 하지 않는다.
 */
export function useUploadWindowGuards(store) {
  const snap = useUploadSnapshot(store);
  const busy = !!snap && Object.values(snap.jobs).some((j) => j.busy);
  useEffect(() => {
    if (!busy || !store) return undefined;
    // 바깥(탐색기)에서 끌어 온 파일만 다룬다. 화면 안의 끌기(초안 카드 파일 옮기기)나 이미 처리된 놓기는 그대로 둔다.
    const outside = (e) => !e.defaultPrevented && isOsFileDrag(e);
    const block = (e) => { if (outside(e)) e.preventDefault(); };
    const onDrop = (e) => { if (outside(e)) { e.preventDefault(); store.noticeBusy(); } };
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [busy, store]);
}
