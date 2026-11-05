import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import Spinner from '../ui/Spinner.jsx';
import FolderUploadDialog from './FolderUploadDialog.jsx';
import { FALLBACK_RULES, isFolderUpload, planFolder } from '../../lib/folderPlan.js';

const FolderReviewContext = createContext(null);

/** 셸의 폴더 목록 창 열기 — review(collected, send, {attach}). 없으면(단독 렌더 테스트) null → 바로 올린다. */
export const useFolderReviewer = () => useContext(FolderReviewContext);

/**
 * 52 — 폴더째 올리기 목록 창을 셸에 하나 둔다. 정리 대기·다른 화면에 놓기(GlobalDrop)·초안/자료에 파일 추가가 모두 이 창을 거친다
 * (2026-11-05 — 다른 화면에 놓은 폴더가 목록 없이 op2 까지 올라간 일). 파일만 몇 개 고른 것은 창 없이 바로 올린다.
 * collected = Promise<items>, send(items, {preset, splitTop}). attach = 기존 초안·자료에 추가(묶는 단위·공통 분류 없음).
 */
export function FolderReviewHost({ children }) {
  const [folder, setFolder] = useState(null);   // {reading: true} | {plan, items, send, attach}
  const seq = useRef(0);
  const review = useCallback((collected, send, { attach = false } = {}) => {
    const my = ++seq.current;
    const latest = () => my === seq.current;
    setFolder({ reading: true });
    Promise.resolve(collected).then(async (items) => {
      if (!latest()) return;
      if (!items.length || !isFolderUpload(items)) { setFolder(null); if (items.length) send(items); return; }
      const rules = await api('/uploads/rules').catch(() => FALLBACK_RULES);
      if (latest()) setFolder({ plan: planFolder(items, rules), items, send, attach });
    }).catch(() => { if (latest()) setFolder(null); });
  }, []);

  function submit({ relPaths, preset, splitTop }) {
    const { items, send, attach } = folder;
    setFolder(null);
    // 나누기를 고르지 않았으면 '폴더 전체를 자료 1건' 을 서버에 분명히 알린다(안 알리면 하위 폴더 호선이 다를 때 서버가 나눈다)
    send(items.filter((it) => relPaths.has(it.relPath)), attach ? {} : { preset, splitTop, whole: !splitTop });
  }

  return (
    <FolderReviewContext.Provider value={review}>
      {children}
      {folder?.reading && createPortal(
        <div role="status" className="fixed left-1/2 top-[22vh] z-50 flex -translate-x-1/2 animate-pop items-center gap-3 rounded-xl bg-n-0 px-5 py-4 text-ui text-n-800 shadow-lg">
          <Spinner size={16} className="text-brand" />폴더를 읽는 중…
        </div>,
        document.body,
      )}
      {folder?.plan && (
        <FolderUploadDialog plan={folder.plan} attach={folder.attach} onSubmit={submit}
                            onCancel={() => { seq.current += 1; setFolder(null); }} />
      )}
    </FolderReviewContext.Provider>
  );
}
