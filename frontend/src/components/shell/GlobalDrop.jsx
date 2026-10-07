import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageDropOverlay, UploadFeedback, useUploader } from '../inbox/UploadZone.jsx';
import { useToast } from '../ui/Toast.jsx';
import { useBasketBarVisible } from '../compare/CompareBasket.jsx';

const isOsFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

// 자기 올리기 칸이 있는 화면 — 정리 대기는 화면 전체 덮개, Entry 는 '파일 추가' 칸이 따로 있다
const OWN_UPLOAD = [/^\/inbox\/?$/, /^\/e\/[^/]+\/?$/];

/**
 * 앱 어디서든 탐색기에서 끌어 온 파일을 놓으면 새 배치로 올린다(정리 대기와 같은 동작).
 * 아무도 받지 않은 놓기는 막아, 브라우저가 파일을 열어 화면이 BDF 본문으로 바뀌지 않게 한다.
 */
export default function GlobalDrop({ storage }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const ownUpload = OWN_UPLOAD.some((re) => re.test(pathname));
  // 비교 바구니 띠(bottom-16, 높이 48)가 떠 있으면 그 위로 올려 서로 가리지 않게 한다.
  const basketBar = useBasketBarVisible();

  const uploader = useUploader({
    disabled: storage?.reachable === false,
    onUploaded: () => toast.show({
      message: '올렸습니다. 정리 대기에서 묶음 제안을 확인하세요.',
      tone: 'ok',
      duration: 8000,
      action: { label: '정리 대기로', onClick: () => navigate('/inbox') },
    }),
  });

  // 받는 곳이 없는 놓기의 기본 동작(파일 열기)을 막는다. 덮개·올리기 칸이 먼저 처리한 놓기는 건드리지 않는다.
  useEffect(() => {
    const over = (e) => { if (!e.defaultPrevented && isOsFileDrag(e)) e.preventDefault(); };
    const drop = (e) => {
      if (e.defaultPrevented || !isOsFileDrag(e)) return;
      e.preventDefault();
      if (ownUpload) toast.show({ message: '올리기 칸에 놓아 주세요.', tone: 'info' });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [ownUpload, toast]);

  if (ownUpload && !uploader.busy) return null;
  return (
    <>
      {!ownUpload && <PageDropOverlay u={uploader} />}
      {/* 진행률·오류·DRM 거부는 오른쪽 아래에 띄운다(성공은 토스트) */}
      <div className={`pointer-events-none fixed ${basketBar ? 'bottom-32' : 'bottom-16'} right-5 z-40 w-[360px] max-w-[calc(100vw-2.5rem)] empty:hidden`}>
        <FloatingFeedback u={uploader} />
      </div>
    </>
  );
}

function FloatingFeedback({ u }) {
  // 닫은 오류·거부 목록은 다음 올리기 결과가 나올 때까지 숨긴다
  const [closed, setClosed] = useState(null);
  const outcome = u.error || u.result;
  const show = u.progress || ((u.error || u.result?.rejected?.length > 0) && closed !== outcome);
  if (!show) return null;
  return (
    <div className="pointer-events-auto relative rounded-lg border border-n-200 bg-n-0 p-3 pr-9 shadow-lg">
      <UploadFeedback u={{ ...u, disabled: false }} showSuccess={false} />
      {!u.progress && (
        <button type="button" aria-label="닫기" onClick={() => setClosed(outcome)}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-sm text-n-500 transition-colors duration-150 ease-out hover:bg-n-100 hover:text-n-900">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
