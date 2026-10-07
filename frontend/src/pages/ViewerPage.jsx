import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Box, X } from 'lucide-react';
import { api } from '../api/client.js';
import { errorText } from '../lib/labels.js';
import { modelStaleNote, modelStateMessage } from '../lib/modelState.js';
import ModelNote from '../components/preview/ModelNote.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { Bar } from '../components/ui/Skeleton.jsx';
import { DraftBadge } from '../components/ui/Status.jsx';
import { CompareToggle } from '../components/compare/CompareBasket.jsx';

// three 가 든 뷰어는 따로 묶는다.
const ModelViewer = lazy(() => import('../components/viewer/ModelViewer.jsx'));

/** 전체 화면 3D 뷰어(/v/:fileId) — 머리줄(파일 이름·소속 자료·닫기) + 남은 높이 전부 Studio 식 뷰어(04c). */
export default function ViewerPage() {
  const { fileId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [res, setRes] = useState({ id: fileId, file: null, summary: null, error: '' });

  // 파일 메타 → (모델이고 DRM 이 아니면) 변환 상태. 볼 수 없는 상태면 뷰어를 띄우지 않는다.
  useEffect(() => {
    let alive = true;
    setRes({ id: fileId, file: null, summary: null, error: '' });
    (async () => {
      try {
        const file = await api(`/files/${encodeURIComponent(fileId)}`);
        if (!alive) return;
        setRes({ id: fileId, file, summary: null, error: '' });
        if (file.kind !== 'model' || file.drm_encrypted) return;
        const summary = await api(`/files/${encodeURIComponent(fileId)}/model`);
        if (alive) setRes({ id: fileId, file, summary, error: '' });
      } catch (err) {
        if (alive) setRes((r) => ({ ...r, id: fileId, error: errorText(err, '파일을 불러오지 못했습니다.') }));
      }
    })();
    return () => { alive = false; };
  }, [fileId]);

  const { file, summary, error } = res.id === fileId ? res : { file: null, summary: null, error: '' };
  const isModel = file?.kind === 'model';
  const msg = isModel ? modelStateMessage(summary, file) : null;
  const stale = isModel && !msg ? modelStaleNote(summary) : '';
  const viewable = isModel && summary && !msg;
  const entryHref = file?.entry_id ? `/e/${file.entry_id}?file=${file.id}` : null;
  // 새 탭에서 바로 열었으면 돌아갈 곳이 없다 — 소속 자료(없으면 검색)로 간다.
  const close = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(entryHref || '/');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-n-200 px-4">
        {file ? (
          <>
            <KindBadge kind={file.kind} name={file.name} />
            <h1 title={file.rel_path} className="min-w-0 truncate text-body font-semibold tracking-[-0.005em] text-n-900">{file.name}</h1>
            {file.entry_status === 'draft' && <DraftBadge />}
            {entryHref && (
              <Link to={entryHref} className="min-w-0 truncate text-meta text-n-600 hover:text-brand hover:underline">
                <span className="font-mono">{file.entry_id}</span> · {file.entry_title}
              </Link>
            )}
          </>
        ) : !error && <Bar className="h-3.5 w-60" />}
        {stale && <span className="hidden shrink-0 text-meta text-n-500 md:inline">{stale}</span>}
        {isModel && <CompareToggle file={{ id: file.id, name: file.name }} className="ml-auto" />}
        <Button variant="ghost" size="sm" className={isModel ? '' : 'ml-auto'} onClick={close}>
          <X size={14} aria-hidden="true" />닫기
        </Button>
      </header>
      {error && <EmptyState icon={Box} title={error} />}
      {file && !isModel && (
        <EmptyState icon={Box} title="3D 로 볼 수 있는 모델 파일이 아닙니다"
                    action={entryHref && <Link to={entryHref} className="text-ui text-brand hover:underline">자료에서 열기</Link>}>
          BDF 파일만 3D 로 볼 수 있습니다.
        </EmptyState>
      )}
      {msg && <div className="mx-auto mt-12 w-full max-w-[520px] px-6"><ModelNote title={msg.title} busy={msg.busy}>{msg.text}</ModelNote></div>}
      {isModel && !msg && !summary && !error && <div className="min-h-0 flex-1 bg-viewer" />}
      {viewable && (
        <Suspense fallback={<div className="min-h-0 flex-1 bg-viewer" />}>
          <ModelViewer key={summary.key || 'model'} fileId={file.id} variant="full" formatVersion={summary.format_version ?? null}
                       solve={summary.solve || null} modelDone={summary.state === 'done'} fileName={file.name}
                       className="min-h-0 flex-1" />
        </Suspense>
      )}
    </div>
  );
}
