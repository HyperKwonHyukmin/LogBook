import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Play, RefreshCw } from 'lucide-react';
import { api, apiBlob } from '../../api/client.js';
import { errorText, formatDateTime } from '../../lib/labels.js';
import {
  formatElapsed, hasSolveResult, isSolvePending, solveBadge, solveSummary, solveTypeLabel,
} from '../../lib/solveCheck.js';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';

const POLL_MS = 3000;
/** 해석은 몇 분 걸릴 수 있다 — 5분(100번)까지 묻고, 그 뒤는 '다시 확인' 으로 넘긴다. */
const POLL_MAX = 100;
/** 이어진 오류가 이만큼이면 확인을 멈춘다(ModelPreview 와 같다). */
const ERROR_MAX = 3;
const ORIGINAL_NOTE = '원본 파일은 바뀌지 않습니다. 해석용 사본으로만 확인합니다.';

const TONE_CLASS = {
  none: ['bg-n-400', 'text-n-600'],
  ok: ['bg-ok', 'text-ok'],
  err: ['bg-err', 'text-err'],
  wait: ['bg-wait', 'text-wait'],
};

/** 배지 = 점 + 글자(색만으로 구분하지 않는다). 검증 중은 스피너. */
export function SolveBadge({ solve }) {
  const { tone, text } = solveBadge(solve);
  if (tone === 'busy') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-meta font-medium text-n-600">
        <Spinner size={12} className="text-n-400" />{text}
      </span>
    );
  }
  const [dot, color] = TONE_CLASS[tone];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-meta font-medium ${color}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 truncate" title={text}>{text}</span>
    </span>
  );
}

/** f06 은 인증 머리가 필요한 GET 이라 받아서 저장한다(썸네일과 같은 방식). */
async function downloadF06(fileId, name) {
  const blob = await apiBlob(`/files/${fileId}/solve-check.f06`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || `file-${fileId}`).replace(/\.[^.]+$/, '')}.f06`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Details({ solve, fileId, fileName }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fatals = solve.fatals || [];
  const summary = solveSummary(solve);
  const elapsed = formatElapsed(solve.elapsed);
  const who = solve.requested_by_name || solve.requested_by;
  const save = async () => {
    setErr(''); setBusy(true);
    try { await downloadF06(fileId, fileName); } catch (e) { setErr(errorText(e, 'f06 을 내려받지 못했습니다.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-n-50 px-3 py-2.5 text-meta">
      {solve.state === 'error' && solve.message && <p className="break-words text-n-700">{solve.message}</p>}
      {fatals.length > 0 && (
        <ul aria-label="FATAL 목록" className="flex flex-col gap-1.5">
          {fatals.map((f, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="text-n-900">
                {f.code != null && <span className="font-mono">FATAL {f.code}</span>}
                {f.code != null && ' · '}
                {solveTypeLabel(f.type, [f])}
              </span>
              {f.message && <span className="break-words font-mono text-micro text-n-600">{f.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {solve.state === 'pass' && (solve.warning_count || 0) > 0 && (
        <p className="text-n-700">{`WARNING ${solve.warning_count}건 — 해석은 끝까지 돌았습니다.`}</p>
      )}
      {summary && <p className="tnum text-n-700">{summary}</p>}
      <p className="text-n-500">
        {who && <span title={solve.requested_by || undefined}>{who}</span>}
        {who && ' · '}
        <span className="font-mono">{formatDateTime(solve.finished_at || solve.requested_at)}</span>
        {elapsed && <> · 소요 <span className="tnum">{elapsed}</span></>}
      </p>
      {solve.has_f06 && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={save} loading={busy} disabled={busy}>
            {!busy && <Download size={14} aria-hidden="true" />}f06 받기
          </Button>
          {err && <span role="alert" className="text-err">{err}</span>}
        </div>
      )}
    </div>
  );
}

const INITIAL = { data: null, error: '', errors: 0, fatal: false, polls: 0, seq: 0 };

/**
 * 해석 검증 카드(설계 06 §6) — 배지 + [해석 검증]/[다시 검증] + 펼치면 FATAL·경계조건·실행 정보·f06.
 *  · initial: /model 응답의 solve 요약({ state, error_types, stale }). 결과가 있으면 자세한 행을 한 번 받아 온다.
 *  · ready: 모델 변환이 끝났는가(아니면 단추를 잠근다 — 서버도 409 model_not_ready 로 막는다).
 *  · compact: 전체 화면 뷰어 왼쪽 패널(좁은 폭)용 세로 배치.
 *  · onData(solve): 자세한 행이 바뀔 때마다 알린다(뷰어의 고정 노드 표시).
 */
export default function SolveCheckCard({ fileId, fileName, initial = null, ready = true, compact = false, onData }) {
  const [st, setSt] = useState(() => ({ ...INITIAL, data: initial || null }));
  const [tick, setTick] = useState(initial?.state ? 1 : 0);
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [reqError, setReqError] = useState('');
  const detailsId = useId();

  // tick 0 = 아직 묻지 않는다(미검증이면 요약만으로 충분). 1 이상이면 자세한 행을 받는다.
  useEffect(() => {
    if (!tick) return undefined;
    let alive = true;
    api(`/files/${fileId}/solve-check`)
      .then((data) => { if (alive) setSt((s) => ({ ...s, data, error: '', errors: 0, fatal: false, seq: s.seq + 1 })); })
      .catch((err) => {
        if (!alive) return;
        setSt((s) => ({ ...s, error: errorText(err, '해석 검증 상태를 불러오지 못했습니다.'), errors: s.errors + 1,
                        fatal: err?.status >= 400 && err?.status < 500, seq: s.seq + 1 }));
      });
    return () => { alive = false; };
  }, [fileId, tick]);

  const data = st.data;
  const pending = isSolvePending(data);
  const gaveUp = st.fatal || st.errors >= ERROR_MAX;
  const capped = st.errors === 0 && pending && st.polls >= POLL_MAX;
  // ModelPreview 와 같은 규칙: 응답마다(seq) 다음 확인을 정한다 — 검증 중이면 3초 뒤, 일시 오류면 같은 간격으로.
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

  useEffect(() => { if (data && onData) onData(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const recheck = () => {
    setSt((s) => ({ ...s, polls: 0, errors: 0, error: '', fatal: false }));
    setTick((n) => n + 1);
  };

  async function request() {
    if (requesting || pending) return;
    setRequesting(true);
    setReqError('');
    try {
      const res = await api(`/files/${fileId}/solve-check`, { method: 'POST' });
      // 응답이 곧 GET 모양이다 — 검증 중이면 seq 가 바뀌며 확인이 이어진다.
      setSt((s) => ({ ...s, data: res, polls: 0, error: '', errors: 0, fatal: false, seq: s.seq + 1 }));
    } catch (err) {
      // 409 model_not_ready 는 '아직 3D 변환이 끝나지 않았습니다.' 로 보인다.
      setReqError(errorText(err, '해석 검증을 요청하지 못했습니다.'));
    } finally {
      setRequesting(false);
    }
  }

  const done = hasSolveResult(data);
  const label = data?.state ? '다시 검증' : '해석 검증';
  const button = (
    <Button variant="secondary" size="sm" onClick={request} loading={requesting}
            disabled={!ready || pending || requesting}
            title={!ready ? '3D 변환이 끝나면 검증할 수 있습니다' : undefined}>
      {!requesting && (data?.state ? <RefreshCw size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />)}
      {label}
    </Button>
  );
  const toggle = done && (
    <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-meta text-n-600 transition-colors duration-150 ease-out hover:bg-n-100 hover:text-n-900 active:bg-n-150">
      {open ? <ChevronDown size={14} aria-hidden="true" className="text-n-400" />
        : <ChevronRight size={14} aria-hidden="true" className="text-n-400" />}
      자세히
    </button>
  );

  return (
    <section aria-label="해석 검증" className="flex flex-col gap-2">
      <div className={compact ? 'flex flex-col items-start gap-2' : 'flex flex-wrap items-center gap-x-3 gap-y-1.5'}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-meta text-n-500">해석 검증</span>
          <SolveBadge solve={data} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {button}
          {toggle}
        </div>
        <p className="text-meta text-n-500">{ORIGINAL_NOTE}</p>
      </div>
      {reqError && <p role="alert" className="text-meta text-err">{reqError}</p>}
      {!reqError && gaveUp && st.error && (
        <div role="alert" className="flex items-center gap-2 text-meta text-err">
          <span className="min-w-0 flex-1">{st.error}</span>
          <Button variant="ghost" size="sm" onClick={recheck}><RefreshCw size={14} aria-hidden="true" />다시 확인</Button>
        </div>
      )}
      {capped && (
        <div className="flex items-center gap-2 text-meta text-n-600">
          <span className="min-w-0 flex-1">검증이 오래 걸리고 있습니다.</span>
          <Button variant="ghost" size="sm" onClick={recheck}><RefreshCw size={14} aria-hidden="true" />다시 확인</Button>
        </div>
      )}
      {done && open && (
        <div id={detailsId}><Details solve={data} fileId={fileId} fileName={fileName} /></div>
      )}
    </section>
  );
}
