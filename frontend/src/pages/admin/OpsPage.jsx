import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { ErrorNote, OkNote, Page, PageHeader, SectionTitle } from '../../components/ui/Page.jsx';
import { BlockSkeleton } from '../../components/ui/Skeleton.jsx';
import { JOB_STATE_LABELS, JOB_TYPE_LABELS, errorText, formatBytes, formatDateTime } from '../../lib/labels.js';

/** 상태를 다시 불러오는 주기(설계 §6.1 워커 상태). */
export const REFRESH_MS = 30_000;

/** 시각이 없으면 기호 대신 말로 쓴다. */
const when = (iso) => (iso ? formatDateTime(iso) : '기록 없음');

/** 백엔드가 준 '멈춤' 기준(초)을 분 단위 문구로. 없으면 null. */
function aliveLimitText(worker) {
  const sec = worker?.alive_seconds ?? worker?.alive_after_seconds;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`;
}

const th = 'h-8 border-b border-n-200 bg-n-25 px-3 text-left text-meta font-medium text-n-500';
const thNum = `${th} text-right`;
const td = 'h-10 border-b border-n-200 px-3 text-ui';
const tdNum = `${td} text-right font-mono`;

/** 일괄 작업 두 가지. force 체크는 "이미 끝난 것도 모두". */
const BULK = [
  { id: 'reextract', label: '본문 다시 추출', title: '본문을 다시 추출할까요?',
    body: (force) => (force
      ? '이미 추출한 보고서까지 모두 작업 큐에 넣습니다. 파일이 많으면 오래 걸립니다.'
      : '아직 추출하지 않은 보고서만 작업 큐에 넣습니다.') },
  { id: 'reconvert', label: 'BDF 다시 변환', title: 'BDF 를 다시 변환할까요?',
    body: (force) => (force
      ? '이미 변환한 BDF 까지 모두 작업 큐에 넣습니다. 큰 모델이 많으면 오래 걸립니다.'
      : '아직 변환하지 않은 BDF 만 작업 큐에 넣습니다.') },
];

const QUEUE_STATES = ['queued', 'running', 'failed'];

/** 상태 = 점 + 글자(색만으로 구분하지 않는다). */
function Dot({ ok, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-ui font-medium ${ok ? 'text-ok' : 'text-err'}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-ok' : 'bg-err'}`} />
      <span>{children}</span>
    </span>
  );
}

function StatusCell({ label, children }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="text-meta font-medium text-n-500">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-col gap-0.5">{children}</dd>
    </div>
  );
}

function StatusRow({ status }) {
  const { worker, storage, backup } = status;
  return (
    <dl className="grid grid-cols-1 divide-y divide-n-200 rounded-lg border border-n-200 md:grid-cols-3 md:divide-x md:divide-y-0">
      <StatusCell label="워커">
        <Dot ok={worker?.alive}>{worker?.alive ? '동작 중' : '멈춤'}</Dot>
        <span className="text-meta text-n-500">
          마지막 응답 <span className="font-mono">{when(worker?.at)}</span>
        </span>
        {aliveLimitText(worker) && (
          <span className="text-meta text-n-500">{aliveLimitText(worker)} 넘게 응답이 없으면 멈춤으로 봅니다.</span>
        )}
      </StatusCell>
      <StatusCell label="공유 폴더">
        <Dot ok={storage?.reachable}>{storage?.reachable ? '연결됨' : '끊김'}</Dot>
        <span className="font-mono text-meta text-n-500">999_LogBook</span>
      </StatusCell>
      <StatusCell label="마지막 백업">
        {!backup && <span className="text-ui text-n-500">기록 없음</span>}
        {backup && backup.ok && (<>
          <span className="text-ui text-n-800">
            <span className="font-mono">{when(backup.at)}</span>
            {' · '}<span className="font-mono">{formatBytes(backup.size ?? 0)}</span>
          </span>
          <span className="truncate font-mono text-meta text-n-500" title={backup.file}>{backup.file}</span>
        </>)}
        {backup && !backup.ok && (<>
          <Dot ok={false}>실패</Dot>
          <span className="text-meta text-n-500">
            <span className="font-mono">{when(backup.at)}</span>
            {backup.error && <> · <span className="break-all font-mono">{backup.error}</span></>}
          </span>
        </>)}
      </StatusCell>
    </dl>
  );
}

function QueueTable({ jobs }) {
  const [showDone, setShowDone] = useState(false);
  const counts = {};
  for (const j of jobs) counts[`${j.type}:${j.state}`] = (counts[`${j.type}:${j.state}`] || 0) + j.count;
  // 알려진 종류는 늘 같은 순서로, 모르는 종류는 뒤에 붙인다.
  const types = [...Object.keys(JOB_TYPE_LABELS), ...new Set(jobs.map((j) => j.type).filter((t) => !JOB_TYPE_LABELS[t]))];
  const states = showDone ? [...QUEUE_STATES, 'done'] : QUEUE_STATES;
  const doneTotal = jobs.filter((j) => j.state === 'done').reduce((n, j) => n + j.count, 0);
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <SectionTitle>작업 큐</SectionTitle>
        <Button variant="ghost" size="sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
          {showDone ? '완료 숨기기' : `완료 보기 (${doneTotal})`}
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-n-200">
        <table aria-label="작업 큐" className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>종류</th>
              {states.map((s) => <th key={s} className={`${thNum} w-[112px]`}>{JOB_STATE_LABELS[s]}</th>)}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t} className="transition-colors duration-120 last:[&>td]:border-0 hover:bg-n-25">
                <td className={`${td} text-n-900`}>{JOB_TYPE_LABELS[t] || t}</td>
                {states.map((s) => {
                  const n = counts[`${t}:${s}`] || 0;
                  const tone = n === 0 ? 'text-n-500' : s === 'failed' ? 'text-err' : 'text-n-800';
                  return <td key={s} className={`${tdNum} ${tone}`}>{n}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 마지막 오류: 첫 줄만 잘라 보이고, 누르면 첫 줄을 다 펼치고 나머지 줄을 아래에 보인다. */
function ErrorText({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-n-500">기록 없음</span>;
  const [first, ...rest] = text.split('\n');
  return (
    <div className="min-w-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
              className={`block max-w-full rounded-sm px-1 -mx-1 text-left font-mono text-meta text-n-700 transition-colors duration-120 ease-out hover:bg-n-100 hover:text-n-900 active:bg-n-150 ${open ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>
        {first}
      </button>
      {open && rest.length > 0 && (
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-n-50 px-2 py-1.5 font-mono text-meta text-n-700">
          {rest.join('\n')}
        </pre>
      )}
    </div>
  );
}

function FailedTable({ failed, retrying, onRetry }) {
  return (
    <section className="mt-8">
      <SectionTitle className="mb-2">실패한 작업</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-n-200">
        <table aria-label="실패한 작업" className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className={`${th} w-[28%]`}>대상</th>
              <th className={`${th} w-[136px]`}>종류</th>
              <th className={`${thNum} w-[64px]`}>시도</th>
              <th className={th}>마지막 오류</th>
              <th className={`${th} w-[112px]`}><span className="sr-only">동작</span></th>
            </tr>
          </thead>
          <tbody>
            {failed.map((j) => (
              <tr key={j.id} className="align-top transition-colors duration-120 last:[&>td]:border-0 hover:bg-n-25">
                <td className={`${td} py-2.5`}>
                  <div className="truncate font-medium text-n-900" title={j.label}>{j.label}</div>
                  <div className="font-mono text-meta text-n-500">{when(j.updated_at)}</div>
                </td>
                <td className={`${td} py-2.5 text-n-700`}>{JOB_TYPE_LABELS[j.type] || j.type}</td>
                <td className={`${tdNum} py-2.5 text-n-700`}>{j.attempts}</td>
                <td className={`${td} py-2.5`}><ErrorText text={j.last_error} /></td>
                <td className={`${td} py-2`}>
                  <div className="flex justify-end">
                    <Button variant="secondary" size="sm" aria-label={`${j.label} 다시 시도`}
                            disabled={!!retrying[j.id]} loading={!!retrying[j.id]} onClick={() => onRetry(j)}>
                      {!retrying[j.id] && <RotateCcw size={14} aria-hidden="true" />}다시 시도
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {failed.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-ui text-n-500">실패한 작업이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 관리자 운영 화면(설계 §6.1·§12): 워커·공유 폴더·백업 상태, 작업 큐, 실패 작업 재시도, 일괄 작업, 휴지통 요약. */
export default function OpsPage() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  // 동작마다 따로 잠근다. 하나로 두면 백업 중에 다른 동작이 끝나며 백업 단추가 다시 열려 두 번 실행될 수 있다.
  const [busy, setBusy] = useState({ backup: false, reextract: false, reconvert: false, retry: {} });
  const setFlag = (key, on) => setBusy((cur) => ({ ...cur, [key]: on }));
  const setRetrying = (id, on) => setBusy((cur) => {
    const retry = { ...cur.retry };
    if (on) retry[id] = true; else delete retry[id];
    return { ...cur, retry };
  });
  const [force, setForce] = useState({ reextract: false, reconvert: false });
  const [confirm, dialog] = useConfirm();
  // 주기 재조회와 동작 뒤 재조회가 겹칠 때, 가장 최근에 보낸 요청의 응답만 반영한다.
  const seq = useRef(0);
  const alive = useRef(true);
  const backupRunning = useRef(false);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const data = await api('/admin/ops/status');
      if (alive.current && n === seq.current) { setStatus(data); setLoadError(''); }
    } catch {
      if (alive.current && n === seq.current) setLoadError('운영 상태를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);

  async function retry(job) {
    if (busy.retry[job.id]) return;
    setRetrying(job.id, true); setError(''); setNotice(null);
    try {
      await api(`/admin/ops/jobs/${job.id}/retry`, { method: 'POST' });
      setNotice(<><span className="font-medium">{job.label}</span> 작업을 다시 대기열에 넣었습니다.</>);
    } catch (err) {
      setError(errorText(err, '다시 시도하지 못했습니다.'));
    } finally {
      setRetrying(job.id, false);
      load();
    }
  }

  async function runBulk(b) {
    const f = force[b.id];
    if (!(await confirm({ title: b.title, body: b.body(f), confirmLabel: '실행', tone: 'primary' }))) return;
    if (busy[b.id]) return;
    setFlag(b.id, true); setError(''); setNotice(null);
    try {
      const res = await api(`/admin/ops/${b.id}`, { method: 'POST', body: { force: f } });
      setNotice(`${res?.queued ?? 0}건을 넣었습니다.`);
      load();
    } catch (err) {
      setError(errorText(err, `${b.label}을 시작하지 못했습니다.`));
    } finally {
      setFlag(b.id, false);
    }
  }

  async function backupNow() {
    // 단추가 잠기기 전(다음 렌더 전)의 연속 클릭도 막는다.
    if (backupRunning.current) return;
    backupRunning.current = true;
    setFlag('backup', true); setError(''); setNotice(null);
    try {
      const res = await api('/admin/ops/backup', { method: 'POST' });
      setNotice(<>백업했습니다. <span className="font-mono">{res.file}</span>
        {res.size != null && <> · <span className="font-mono">{formatBytes(res.size)}</span></>}</>);
    } catch (err) {
      const reason = typeof err?.detail === 'object' ? err.detail?.message : null;
      setError(<>{errorText(err, '백업하지 못했습니다.')}
        {reason && <> 사유: <span className="font-mono">{reason}</span></>}</>);
    } finally {
      backupRunning.current = false;
      setFlag('backup', false);
      load();
    }
  }

  const trash = status?.trash;
  return (
    <Page>
      {dialog}
      <PageHeader title="운영" description="워커·작업 큐·백업 상태를 보고, 실패한 작업을 다시 시도합니다. 30초마다 새로 고칩니다." />
      {loadError && (
        <ErrorNote className="mb-4" action={<Button variant="ghost" size="sm" onClick={load}>다시 시도</Button>}>
          {loadError}
        </ErrorNote>
      )}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {notice && <OkNote className="mb-4">{notice}</OkNote>}

      {!status && !loadError && <BlockSkeleton className="h-20" label="운영 상태를 불러오는 중" />}
      {status && (<>
        <StatusRow status={status} />
        {status.daily?.at && (
          <p className="mt-2 text-meta text-n-500">
            매일 작업 마지막 실행 <span className="font-mono">{formatDateTime(status.daily.at)}</span>
          </p>
        )}

        <QueueTable jobs={status.jobs || []} />
        <FailedTable failed={status.failed || []} retrying={busy.retry} onRetry={retry} />

        <section className="mt-8">
          <SectionTitle className="mb-2">일괄 작업</SectionTitle>
          <div className="divide-y divide-n-200 rounded-lg border border-n-200">
            {BULK.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Button variant="secondary" disabled={busy[b.id]} loading={busy[b.id]} onClick={() => runBulk(b)}>
                  {b.label}
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-2 text-ui text-n-700">
                  <input type="checkbox" className="h-4 w-4 accent-brand" aria-label={`${b.label}: 이미 끝난 것도 모두`}
                         checked={force[b.id]} onChange={(e) => setForce((cur) => ({ ...cur, [b.id]: e.target.checked }))} />
                  이미 끝난 것도 모두
                </label>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Button variant="secondary" disabled={busy.backup} loading={busy.backup} onClick={backupNow}>
                지금 백업
              </Button>
              <span className="text-meta text-n-500">
                {busy.backup ? '백업하는 중입니다…' : <>DB 를 <span className="font-mono">80_Backup</span> 에 바로 덤프합니다.</>}
              </span>
            </div>
          </div>
        </section>

        {trash && (
          <section className="mt-8">
            <SectionTitle className="mb-2">휴지통</SectionTitle>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-n-700">
              <span>{`휴지통 ${trash.count}건 · 7일 안에 비워질 것 ${trash.expiring}건 · 보관 ${trash.days}일`}</span>
              <Link to="/trash" className="font-medium text-brand underline-offset-2 hover:underline">휴지통 열기</Link>
            </p>
          </section>
        )}
      </>)}
    </Page>
  );
}
