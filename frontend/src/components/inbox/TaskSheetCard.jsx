import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText } from '../../lib/labels.js';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { ErrorNote } from '../ui/Page.jsx';
import { useConfirm } from '../ui/ConfirmDialog.jsx';
import { useToast } from '../ui/Toast.jsx';

const defaults = (rows) => new Set(rows.filter((r) => r.checked).map((r) => r.index));

/**
 * 68 3단계 — 과제 엑셀 묶음(review). 행마다 담당자 대조, 호선 추정, 알림(이미 있음, 명부에 없는 이름, 목록 밖 값)을 보고
 * 고른 행만 [초안 n건 만들기](LV2 이상인 올린 사람). 기본 체크는 완료, 진행 중, 자체수행이고 이미 있는 행은 고르지 못한다.
 * 만든 뒤에는 결과(만든 수, 건너뜀, 실패)만 보인다.
 */
export default function TaskSheetCard({ batch, onChanged }) {
  const ts = batch.task_sheet || {};
  const rows = useMemo(() => ts.rows || [], [ts.rows]);
  const [picked, setPicked] = useState(() => defaults(rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm();
  const toast = useToast();
  const review = batch.state === 'review';
  const can = !!ts.can_create;
  const toggle = (i, on) => setPicked((cur) => {
    const next = new Set(cur);
    if (on) next.add(i); else next.delete(i);
    return next;
  });
  const n = rows.filter((r) => picked.has(r.index) && !r.exists).length;

  async function create() {
    const ok = await confirm({
      title: `초안 ${n}건을 만들까요?`,
      body: '파일 없는 초안이 만들어집니다. 담당자가 파일을 넣고 확정합니다. 같은 과제의뢰서 NO. 의 자료가 이미 있으면 건너뜁니다.',
      confirmLabel: `${n}건 만들기`, tone: 'primary',
    });
    if (!ok) return;
    setBusy(true); setError('');
    try {
      const res = await api(`/batches/${encodeURIComponent(batch.key)}/task-drafts`, {
        method: 'POST', body: { rows: rows.filter((r) => picked.has(r.index) && !r.exists).map((r) => r.index) } });
      toast.show({ tone: 'ok', message: `초안 ${res.created.length}건을 만들었습니다${res.failed.length ? `, 실패 ${res.failed.length}건` : ''}` });
      onChanged?.();
    } catch (err) { setError(errorText(err, '초안을 만들지 못했습니다.')); } finally { setBusy(false); }
  }
  async function discard() {
    const ok = await confirm({ title: '이 과제 엑셀을 버릴까요?', body: '초안을 만들지 않고 묶음을 끝냅니다. 원본 엑셀은 휴지통 폴더로 옮깁니다.',
      confirmLabel: '버리기' });
    if (!ok) return;
    setBusy(true); setError('');
    try { await api(`/batches/${encodeURIComponent(batch.key)}/task-discard`, { method: 'POST' }); onChanged?.(); }
    catch (err) { setError(errorText(err, '버리지 못했습니다.')); } finally { setBusy(false); }
  }

  const result = ts.result;
  return (
    <section aria-label={`과제 엑셀 ${ts.file || batch.original_name}`} className="flex flex-col gap-3 rounded-lg border border-n-200 bg-n-0 p-4">
      {dialog}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FileSpreadsheet size={16} className="text-ok" aria-hidden="true" />
        <h2 className="text-body font-semibold text-n-900">과제 엑셀</h2>
        <span className="min-w-0 truncate text-ui text-n-800">{ts.file || batch.original_name}</span>
        {ts.sheet && <span className="text-meta text-n-500">시트 {ts.sheet}</span>}
        {ts.year && <span className="text-meta text-n-500">{ts.year}년</span>}
        <span className="text-meta text-n-500">과제 <span className="font-mono">{ts.total ?? rows.length}</span>행</span>
      </header>
      {ts.error && (
        <ErrorNote action={review && ts.can_discard ? <Button variant="secondary" size="sm" disabled={busy} onClick={discard}>이 묶음 버리기</Button> : null}>
          {ts.error} 과제 엑셀 양식(통합과제)인지 확인해 주세요. 일반 자료로 올리려면 다른 파일과 함께 올리세요.
        </ErrorNote>
      )}
      {result && (
        <p role="status" className="rounded-md bg-ok-bg px-3 py-2 text-ui text-ok">
          {result.rebuilt ? '재구축으로 초안을 되살렸습니다.' : <>초안 <span className="font-mono">{result.created.length}</span>건을 만들었습니다.</>}
          {result.skipped?.length > 0 && <> 이미 있어 건너뛴 행 <span className="font-mono">{result.skipped.length}</span>개.</>}
          {result.failed?.length > 0 && <> 실패 {result.failed.map((f) => `NO.${f.no}(${f.reason})`).join(', ')}.</>}
          {' '}만든 초안은 왼쪽 목록에서 '파일 기다림'으로 보입니다. 파일을 줄에 끌어 놓으면 첨부됩니다.
        </p>
      )}
      {review && !ts.error && (
        <>
          <div className="flex flex-col gap-1 text-meta text-n-600">
            {ts.skipped?.length > 0 && <p>넣지 않는 열: {ts.skipped.join(', ')} (금액, 기여도, M/H 는 LogBook 에 넣지 않습니다)</p>}
            {ts.unread?.length > 0 && <p>읽지 않은 열: {ts.unread.join(', ')}</p>}
            {!can && <p className="text-wait">LV2 이상인 올린 사람만 초안을 만들 수 있습니다.{!batch.uploader && " 폴더에 직접 넣은 묶음은 먼저 [내가 올렸어요]로 가져가세요."}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-n-700"><span className="font-mono">{n}</span>건 고름</span>
            <Button variant="ghost" size="sm" onClick={() => setPicked(defaults(rows))}>기본 선택으로</Button>
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(rows.filter((r) => !r.exists).map((r) => r.index)))}>모두 고르기</Button>
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>모두 해제</Button>
            <span className="flex-1" />
            {ts.can_discard && <Button variant="ghost" size="sm" disabled={busy} onClick={discard}>이 묶음 버리기</Button>}
            <Button size="sm" disabled={!can || busy || n === 0} onClick={create}>
              {busy && <Spinner size={12} />}초안 {n}건 만들기
            </Button>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="overflow-x-auto rounded-md border border-n-200">
            <table className="w-full min-w-[860px] text-left text-ui">
              <thead className="bg-n-50 text-meta text-n-600">
                <tr>
                  <th className="w-8 px-2 py-1.5"><span className="sr-only">고르기</span></th>
                  <th className="px-2 py-1.5">NO.</th><th className="px-2 py-1.5">과제 이름</th><th className="px-2 py-1.5">상태</th>
                  <th className="px-2 py-1.5">담당자</th><th className="px-2 py-1.5">호선</th><th className="px-2 py-1.5">대상</th>
                  <th className="px-2 py-1.5">알림</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index} className={`border-t border-n-200 align-top ${r.exists ? 'text-n-500' : ''}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" className="h-4 w-4 accent-brand" aria-label={`NO.${r.no} 고르기`} disabled={!!r.exists || !can}
                             checked={picked.has(r.index) && !r.exists} onChange={(e) => toggle(r.index, e.target.checked)} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-meta">{r.no}</td>
                    <td className="px-2 py-1.5">{r.name}<span className="block font-mono text-micro text-n-500">{r.request_no}</span></td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.status || '-'}</td>
                    <td className="px-2 py-1.5">
                      {r.assignees.length ? r.assignees.map((a) => (
                        <span key={a.name} className={`block ${a.ref ? '' : 'text-wait'}`}>{a.label || a.name}</span>
                      )) : <span className="text-n-500">-</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{r.hull || '-'}</td>
                    <td className="px-2 py-1.5">{r.target || (r.target_text ? <span className="text-n-500">{r.target_text}</span> : '-')}</td>
                    <td className="px-2 py-1.5 text-meta text-wait">{r.notices.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
