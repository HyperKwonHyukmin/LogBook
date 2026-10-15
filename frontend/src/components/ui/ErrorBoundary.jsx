import { Component, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, RefreshCw } from 'lucide-react';
import Button, { buttonClass } from './Button.jsx';
import Spinner from './Spinner.jsx';
import { isChunkLoadError, reloadOnce } from '../../lib/chunkReload.js';

/**
 * 그리기 오류 경계 — 아래 화면이 던지면 fallback(error, reset)을 그린다.
 * resetKey 가 바뀌면(예: 주소 이동) 오류 상태를 풀고 다시 그린다.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: props.resetKey };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    // 다른 화면으로 옮겼다 — 그 화면은 새로 그려 본다
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

/**
 * 나중 묶음(재배포로 사라진 파일) 실패면 한 번 새로 고침한다.
 * → 'reloading'(새로 고침 시작) | 'stale'(방금 해 봤는데 또 실패 — 안내만) | null(묶음 오류 아님)
 */
export function useChunkRecovery(error) {
  const chunk = isChunkLoadError(error);
  const [result, setResult] = useState(chunk ? 'reloading' : null);
  const tried = useRef(false);
  useEffect(() => {
    // StrictMode 의 두 번 실행에도 새로 고침 판단은 한 번만
    if (!chunk || tried.current) return;
    tried.current = true;
    if (!reloadOnce()) setResult('stale');
  }, [chunk]);
  return result;
}

const reloadPage = () => window.location.reload();

/** 기술 정보(접힘) — 관리자·개발자가 원인을 볼 수 있게. 오류 문장은 한글일 수 있어 모노를 걸지 않는다. */
function TechDetail({ error }) {
  const stack = String(error?.stack || '').split('\n').slice(0, 12).join('\n');
  return (
    <details className="mt-5 w-full text-left">
      <summary className="cursor-pointer text-meta text-n-600 hover:text-n-900">기술 정보</summary>
      <div className="mt-2 rounded-md border border-n-200 bg-n-50 p-3">
        <p className="text-meta text-n-800 [overflow-wrap:anywhere]">{String(error?.message || error)}</p>
        {stack && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-micro text-n-600 [overflow-wrap:anywhere]">{stack}</pre>}
      </div>
    </details>
  );
}

/**
 * 화면 하나가 통째로 실패했을 때의 복구 면(셸 안 작업면 · 최상위 오류 화면 공통).
 * onRetry: [다시 시도](없으면 새로 고침). plainLinks: [검색으로]를 a 태그로(라우터 상태를 믿을 수 없는 최상위 오류).
 * showDetail: 접힌 '기술 정보'(오류 문장·스택)를 보일까.
 */
export function RecoveryPanel({ error, onRetry, showDetail = true, plainLinks = false }) {
  const chunk = useChunkRecovery(error);
  const searchLink = plainLinks
    ? <a href="/" className={buttonClass('secondary', 'md')}>검색으로</a>
    : <Link to="/" className={buttonClass('secondary', 'md')}>검색으로</Link>;
  if (chunk === 'reloading') {
    return (
      <div role="status" className="mx-auto mt-12 flex max-w-[440px] items-center justify-center gap-2 text-ui text-n-600">
        <Spinner size={14} />새 버전을 불러오는 중…
      </div>
    );
  }
  const title = chunk ? '새 버전이 배포되었습니다' : '이 화면을 표시하지 못했습니다';
  const line = chunk
    ? '화면 파일이 바뀌어 이 부분을 불러오지 못했습니다. 새로 고침하면 최신 버전으로 열립니다.'
    : '화면을 그리는 중에 문제가 생겼습니다. 다시 시도하거나 검색으로 돌아가 주세요.';
  return (
    <div role="alert" className="mx-auto mt-12 flex max-w-[480px] flex-col items-center px-6 text-center">
      <CircleAlert size={20} strokeWidth={1.75} className="text-err" aria-hidden="true" />
      <h2 className="mt-3 text-body font-semibold text-n-900">{title}</h2>
      <p className="mt-1 text-ui text-n-600">{line}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {chunk || !onRetry
          ? <Button onClick={reloadPage}><RefreshCw size={14} aria-hidden="true" />{chunk ? '새로 고침' : '다시 시도'}</Button>
          : <Button onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />다시 시도</Button>}
        {searchLink}
      </div>
      {showDetail && !chunk && <TechDetail error={error} />}
    </div>
  );
}

/**
 * 무거운 조각(3D 뷰어·비교·판 변경 3D) 하나가 터져도 화면은 살리는 작은 경계.
 * what: '3D 뷰어' 같은 이름('… 표시 중에 문제가 생겼습니다'에 들어간다). tone='dark' 는 뷰어 바탕(bg-viewer) 위.
 */
export function WidgetBoundary({ children, what = '이 부분', tone = 'light', resetKey, className = '' }) {
  return (
    <ErrorBoundary resetKey={resetKey} fallback={(error, reset) => (
      <WidgetFallback error={error} reset={reset} what={what} tone={tone} className={className} />
    )}>
      {children}
    </ErrorBoundary>
  );
}

function WidgetFallback({ error, reset, what, tone, className }) {
  const chunk = useChunkRecovery(error);
  const dark = tone === 'dark';
  const text = chunk === 'reloading' ? '새 버전을 불러오는 중…'
    : chunk ? '새 버전이 배포되었습니다. 새로 고침하면 다시 볼 수 있습니다.'
      : `${what} 표시 중에 문제가 생겼습니다.`;
  return (
    <div className={`flex h-full min-h-[120px] w-full items-center justify-center p-6 ${dark ? 'bg-viewer' : ''} ${className}`}>
      <div role="alert" className={`flex max-w-[420px] flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-ui ${dark ? 'text-n-150' : 'text-n-700'}`}>
        <span className="inline-flex items-start gap-2">
          {chunk === 'reloading' ? <Spinner size={14} className="mt-[3px] shrink-0" />
            : <CircleAlert size={14} className={`mt-[3px] shrink-0 ${dark ? 'text-n-300' : 'text-err'}`} aria-hidden="true" />}
          {text}
        </span>
        {chunk === 'stale' && <Button variant="secondary" size="sm" onClick={reloadPage}>새로 고침</Button>}
        {!chunk && <Button variant="secondary" size="sm" onClick={reset}>다시 시도</Button>}
      </div>
    </div>
  );
}
