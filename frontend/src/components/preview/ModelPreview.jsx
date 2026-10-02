import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Rotate3d } from 'lucide-react';
import { api } from '../../api/client.js';
import { MODEL_STATE_LABELS, errorText } from '../../lib/labels.js';
import { isModelPending, modelStaleNote, modelStateMessage } from '../../lib/modelState.js';
import Button, { buttonClass } from '../ui/Button.jsx';
import { Bar } from '../ui/Skeleton.jsx';
import Spinner from '../ui/Spinner.jsx';
import ModelThumb from '../viewer/ModelThumb.jsx';
import ModelNote from './ModelNote.jsx';

// three 가 든 뷰어는 따로 묶는다 — 검색 화면 번들에 섞이지 않게.
const ModelViewer = lazy(() => import('../viewer/ModelViewer.jsx'));

const POLL_MS = 3000;
const POLL_MAX = 20;
/** 이어진 오류가 이만큼이면 확인을 멈춘다(한두 번의 503 같은 일시 오류는 넘긴다). */
const ERROR_MAX = 3;
const VIEWER_HEIGHT = 'h-[min(70vh,640px)]';
const num = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
/** 4xx(파일 없음·권한)는 다시 물어도 같다. */
const isFatal = (err) => err?.status >= 400 && err?.status < 500;

/** 요소 종류별 개수(많은 순 4개, GRID 제외) · 크기 · SOL. BDF 에는 단위가 없어 크기에 mm 를 붙이지 않는다. */
function SummaryLine({ summary }) {
  const counts = Object.entries(summary.counts || {}).filter(([card]) => card !== 'GRID')
    .sort((a, b) => b[1] - a[1]).slice(0, 4);
  const box = summary.bbox;
  const size = box && [0, 1, 2].map((k) => num(box.max[k] - box.min[k])).join('×');
  const parts = [
    ...counts.map(([card, n]) => `${card} ${num(n)}`),
    size && `크기 ${size}`,
    summary.sol && `SOL ${summary.sol}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-n-600">
      {parts.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-n-300">·</span>}
          <span className="tnum">{t}</span>
        </span>
      ))}
    </p>
  );
}

const INITIAL = { data: null, error: '', errors: 0, fatal: false, polls: 0, seq: 0 };

function ModelPreviewBody({ file, inline }) {
  const [st, setSt] = useState(INITIAL);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api(`/files/${file.id}/model`)
      .then((data) => { if (alive) setSt((s) => ({ ...s, data, error: '', errors: 0, fatal: false, seq: s.seq + 1 })); })
      .catch((err) => {
        if (!alive) return;
        setSt((s) => ({ ...s, error: errorText(err, '3D 변환 상태를 불러오지 못했습니다.'), errors: s.errors + 1,
                        fatal: isFatal(err), seq: s.seq + 1 }));
      });
    return () => { alive = false; };
  }, [file.id, tick]);

  const pending = isModelPending(st.data);
  const gaveUp = st.fatal || st.errors >= ERROR_MAX;
  const capped = st.errors === 0 && pending && st.polls >= POLL_MAX;
  // 응답이 올 때마다(seq) 다음 확인을 정한다: 변환 대기면 3초 뒤(최대 20번), 일시 오류면 같은 간격으로 다시.
  useEffect(() => {
    const retry = st.errors > 0 && !gaveUp;
    const wait = st.errors === 0 && pending && st.polls < POLL_MAX;
    if (!retry && !wait) return undefined;
    const t = setTimeout(() => {
      setSt((s) => ({ ...s, polls: s.polls + 1 }));
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [st.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const recheck = () => {
    setSt((s) => ({ ...s, polls: 0, errors: 0, error: '', fatal: false }));
    setTick((n) => n + 1);
  };
  const recheckButton = (
    <Button variant="secondary" size="sm" onClick={recheck}><RefreshCw size={14} aria-hidden="true" />다시 확인</Button>
  );

  if (gaveUp) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
        <span className="min-w-0 flex-1">{st.error}</span>
        {recheckButton}
      </div>
    );
  }
  const data = st.data;
  if (!data) return <div className="appear-late" aria-hidden="true"><Bar className="aspect-[16/10] w-full" /></div>;

  const msg = modelStateMessage(data);
  if (msg?.busy) {
    return capped ? <ModelNote action={recheckButton}>{MODEL_STATE_LABELS.slow}</ModelNote>
      : <ModelNote busy>{msg.text}</ModelNote>;
  }
  if (msg) return <ModelNote title={msg.title}>{msg.text}</ModelNote>;

  const stale = modelStaleNote(data);
  const missing = data.missing || [];
  const warnings = data.warnings || [];
  return (
    <div className="flex flex-col gap-3">
      {stale && (
        <div className="flex items-center gap-2 rounded-md bg-n-50 px-3 py-2 text-ui text-n-700">
          {pending && !capped && <Spinner size={14} className="text-n-400" />}
          <span className="min-w-0 flex-1" title={data.state === 'failed' ? data.error || undefined : undefined}>
            {capped ? `${stale} · ${MODEL_STATE_LABELS.slow}` : stale}
          </span>
          {capped && recheckButton}
        </div>
      )}
      {missing.length > 0 && (
        <p className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui text-wait">
          {`INCLUDE 파일 ${missing.join(', ')} 이 없습니다. 같은 자료에 추가하면 자동으로 다시 변환합니다.`}
        </p>
      )}
      <SummaryLine summary={data} />
      {warnings.length > 0 && (
        <details className="group text-meta">
          <summary className="w-fit cursor-pointer select-none rounded-sm text-n-600 hover:text-n-900">{`경고 ${warnings.length}`}</summary>
          <ul className="mt-1.5 flex flex-col gap-0.5 rounded-md bg-n-50 px-3 py-2">
            {warnings.map((w, i) => <li key={i} className="break-words font-mono text-micro text-n-600">{w}</li>)}
          </ul>
        </details>
      )}
      {inline ? (
        <div className={VIEWER_HEIGHT}>
          <Suspense fallback={<div className="appear-late h-full" aria-hidden="true"><Bar className="h-full" /></div>}>
            {/* 다시 변환되면(key 바뀜) 뷰어를 새로 띄워 새 결과를 불러온다. */}
            <ModelViewer key={data.key || 'model'} fileId={file.id} fullscreenHref={`/v/${file.id}`}
                         className="h-full rounded-lg border border-n-200" />
          </Suspense>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <ModelThumb fileId={file.id} modelKey={data.key} alt={`${file.name} 3D 미리보기`}
                      className="aspect-[16/10] w-full rounded-md" />
          <Link to={`/v/${file.id}`} className={buttonClass('secondary', 'sm')}>
            <Rotate3d size={14} aria-hidden="true" />3D 로 보기
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * 모델 파일 미리보기(설계 §7.7) — 변환 상태에 따라 안내, 요약, 뷰어(inline) 또는 썸네일 + 3D 로 보기.
 * inline=false 는 좁은 검색 미리보기 패널용이다. 파일이 바뀌면 상태를 통째로 새로 시작한다.
 */
export default function ModelPreview({ file, inline = true }) {
  return <ModelPreviewBody key={file.id} file={file} inline={inline} />;
}
