import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageDropOverlay, UploadFeedback, uploaderView, useUploader } from '../inbox/UploadZone.jsx';
import { isOsFileDrag, useUploadSnapshot, useUploadStore } from '../inbox/UploadProvider.jsx';
import { useToast } from '../ui/Toast.jsx';
import { useBasketBarVisible } from '../compare/CompareBasket.jsx';
import { READ_ONLY_REASON } from '../../lib/levels.js';

// 자기 올리기 칸이 있는 화면 — 정리 대기는 화면 전체 덮개, Entry 는 '파일 추가' 칸이 따로 있다
const OWN_UPLOAD = [/^\/inbox\/?$/, /^\/e\/[^/]+\/?$/];
const GLOBAL_SCOPE = 'global';
const DEFAULT_AWAY = { message: '올렸습니다. 정리 대기에서 묶음 제안을 확인하세요.', to: '/inbox', label: '정리 대기로' };

/**
 * 앱 어디서든 탐색기에서 끌어 온 파일을 놓으면 새 배치로 올린다(정리 대기와 같은 동작).
 * 아무도 받지 않은 놓기는 막아, 브라우저가 파일을 열어 화면이 BDF 본문으로 바뀌지 않게 한다.
 * 다른 화면에서 시작한 올리기가 그 화면을 떠난 뒤에도 이어지면(셸 저장소), 그 진행률·[취소]·[이어 올리기]도
 * 오른쪽 아래 같은 자리에 띄우고, 끝나면 토스트로 알린다.
 */
export default function GlobalDrop({ storage, readOnly = false }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const store = useUploadStore();
  const snap = useUploadSnapshot(store);
  const ownUpload = OWN_UPLOAD.some((re) => re.test(pathname));
  // 비교 바구니 띠(bottom-16, 높이 48)가 떠 있으면 그 위로 올려 서로 가리지 않게 한다.
  const basketBar = useBasketBarVisible();

  const uploader = useUploader({
    scope: GLOBAL_SCOPE,
    disabled: readOnly || storage?.reachable === false,
    onUploaded: () => toast.show({
      message: DEFAULT_AWAY.message,
      tone: 'ok',
      duration: 8000,
      action: { label: DEFAULT_AWAY.label, onClick: () => navigate(DEFAULT_AWAY.to) },
    }),
  });

  // 맡은 화면이 떠난 뒤 끝난 올리기 — 그 화면이 알려 주던 대로 토스트를 띄운다
  useEffect(() => store?.onOrphanDone(({ away }) => {
    const a = { ...DEFAULT_AWAY, ...away };
    toast.show({ message: a.message, tone: 'ok', duration: 8000, action: { label: a.label, onClick: () => navigate(a.to) } });
  }), [store, toast, navigate]);

  // 받는 곳이 없는 놓기의 기본 동작(파일 열기)을 막는다. 덮개·올리기 칸이 먼저 처리한 놓기는 건드리지 않는다.
  useEffect(() => {
    const over = (e) => { if (!e.defaultPrevented && isOsFileDrag(e)) e.preventDefault(); };
    const drop = (e) => {
      if (e.defaultPrevented || !isOsFileDrag(e)) return;
      e.preventDefault();
      if (readOnly) toast.show({ message: READ_ONLY_REASON, tone: 'info' });
      else if (ownUpload) toast.show({ message: '올리기 칸에 놓아 주세요.', tone: 'info' });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [ownUpload, readOnly, toast]);

  // 맡은 화면이 없는(떠난) 올리기 — 올리는 중이거나 남길 결과가 있는 것만
  const orphans = snap ? Object.entries(snap.jobs)
    .filter(([scope]) => scope !== GLOBAL_SCOPE && !snap.attached[scope])
    .map(([scope, job]) => uploaderView(store, scope, job, { opts: store.optionsOf?.(scope) })) : [];
  const showGlobal = !readOnly && (!ownUpload || uploader.busy || uploader.resumable);
  if (!showGlobal && !orphans.length) return null;
  return (
    <>
      {!ownUpload && !readOnly && <PageDropOverlay u={uploader} />}
      {/* 진행률·오류·DRM 거부는 오른쪽 아래에 띄운다(성공은 토스트) */}
      <div className={`pointer-events-none fixed ${basketBar ? 'bottom-32' : 'bottom-16'} right-5 z-40 flex w-[400px] max-w-[calc(100vw-2.5rem)] flex-col gap-2 empty:hidden`}>
        {orphans.map((u) => <FloatingFeedback key={u.scope} u={u} title={store.optionsOf?.(u.scope)?.away?.title} />)}
        {showGlobal && <FloatingFeedback u={uploader} />}
      </div>
    </>
  );
}

function FloatingFeedback({ u, title }) {
  // 17 — 동일 BDF 로 받지 않은 목록도 닫을 때까지 띄운다(성공 토스트와 별개, 모두 막히면 토스트 없이 이것만)
  const show = u.busy || u.resumable || u.info || u.error
    || u.result?.rejected?.length > 0 || u.result?.skipped?.length > 0 || u.result?.blocked?.length > 0;
  if (!show) return null;
  // 올리는 중이거나 이어 올릴 수 있으면 닫지 않는다([취소]로 끝낸다)
  const closable = !u.busy && !u.resumable;
  return (
    <div className="pointer-events-auto relative max-h-[60vh] overflow-y-auto rounded-lg border border-n-200 bg-n-0 p-3 pr-9 shadow-lg">
      {title && <p className="mb-1.5 text-meta font-medium text-n-700">{title}</p>}
      <UploadFeedback u={{ ...u, disabled: false }} showSuccess={false} />
      {closable && (
        <button type="button" aria-label="닫기" onClick={u.dismiss}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-sm text-n-500 transition-colors duration-150 ease-out hover:bg-n-100 hover:text-n-900">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
