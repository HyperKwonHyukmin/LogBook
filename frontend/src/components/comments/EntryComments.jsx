import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleDot, CornerDownRight, MessageSquare } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { useConfirm } from '../ui/ConfirmDialog.jsx';
import { SectionTitle } from '../ui/Page.jsx';
import { Bar } from '../ui/Skeleton.jsx';
import { Segmented } from '../ui/Tabs.jsx';
import { useToast } from '../ui/Toast.jsx';
import { errorText, formatDateTime } from '../../lib/labels.js';

export const MAX_BODY = 2000;
const KIND_ITEMS = [{ id: 'comment', label: '의견' }, { id: 'issue', label: '이슈' }];

const areaClass = 'field w-full resize-y rounded-md border border-n-250 bg-n-0 px-2.5 py-2 text-ui leading-5 text-n-900 shadow-xs outline-none '
  + 'transition-[border-color,box-shadow] duration-150 ease-out hover:border-n-300 focus-visible:outline-none disabled:bg-n-50';

/** 이슈 상태 칩 — 열림(주황) · 해결됨(초록). */
export function IssueChip({ status }) {
  if (!status) return null;
  const open = status === 'open';
  const Icon = open ? CircleDot : CircleCheck;
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 text-micro font-semibold ${open ? 'bg-wait-bg text-wait' : 'bg-ok-bg text-ok'}`}>
      <Icon size={11} aria-hidden="true" />{open ? '열린 이슈' : '해결된 이슈'}
    </span>
  );
}

/** 글 쓰기 칸 — 새 글(kind 고르기)·답글·고치기가 같이 쓴다. */
function Composer({ initial = '', withKind = false, placeholder, submitLabel, onSubmit, onCancel, autoFocus = false }) {
  const [body, setBody] = useState(initial);
  const [kind, setKind] = useState('comment');
  const [busy, setBusy] = useState(false);
  const text = body.trim();
  const over = text.length > MAX_BODY;
  async function submit(e) {
    e?.preventDefault();
    if (!text || over || busy) return;
    setBusy(true);
    try {
      await onSubmit({ body: text, kind });
      setBody('');
      setKind('comment');
    } catch { /* 부모가 알림을 띄운다 — 쓴 글은 남겨 둔다 */ } finally {
      setBusy(false);
    }
  }
  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent?.isComposing) submit(e);
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {withKind && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="글 종류" items={KIND_ITEMS} value={kind} onChange={setKind} disabled={busy} />
          <span className="text-meta text-n-600">
            {kind === 'issue' ? '고쳐야 할 점입니다. 해결될 때까지 열린 이슈로 남습니다.' : '참고할 내용이나 질문을 남깁니다.'}
          </span>
        </div>
      )}
      <textarea aria-label={placeholder} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown}
                rows={withKind ? 3 : 2} placeholder={placeholder} disabled={busy} autoFocus={autoFocus} className={areaClass} />
      <div className="flex items-center gap-2">
        <span className={`text-meta ${over ? 'text-err' : 'text-n-500'}`}>
          {over ? `${MAX_BODY}자를 넘었습니다 (${text.length}자)` : 'Ctrl+Enter 로 올리기'}
        </span>
        <span className="ml-auto flex gap-1.5">
          {onCancel && <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>취소</Button>}
          <Button type="submit" size="sm" disabled={!text || over} loading={busy}>{submitLabel}</Button>
        </span>
      </div>
    </form>
  );
}

/** 글 한 개(최상위 또는 답글). */
function CommentItem({ c, reply = false, onChanged, onReply, canReply }) {
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (err, msg) => toast.show({ tone: 'err', message: errorText(err, msg) });

  async function save({ body }) {
    try {
      await api(`/comments/${c.id}`, { method: 'PATCH', body: { body } });
      setEditing(false);
      onChanged();
    } catch (err) { fail(err, '글을 고치지 못했습니다.'); throw err; }
  }
  async function remove() {
    const ok = await confirm({ title: '이 글을 지울까요?', body: reply || !c.replies?.length ? '지운 글은 되돌릴 수 없습니다.'
      : '답글이 있어 "삭제된 글입니다" 표시는 남고, 본문만 지워집니다.', confirmLabel: '지우기' });
    if (!ok) return;
    setBusy(true);
    try { await api(`/comments/${c.id}`, { method: 'DELETE' }); onChanged(); }
    catch (err) { fail(err, '글을 지우지 못했습니다.'); } finally { setBusy(false); }
  }
  async function toggleResolved() {
    setBusy(true);
    try { await api(`/comments/${c.id}/resolve`, { method: c.status === 'open' ? 'POST' : 'DELETE' }); onChanged(); }
    catch (err) { fail(err, '이슈 상태를 바꾸지 못했습니다.'); } finally { setBusy(false); }
  }

  const who = c.author.name || c.author.employee_id;
  return (
    <div className="min-w-0">
      {dialog}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {reply && <CornerDownRight size={13} aria-hidden="true" className="text-n-400" />}
        <span className="text-ui font-medium text-n-900" title={c.author.employee_id}>{c.deleted ? '—' : who}</span>
        {!reply && !c.deleted && <IssueChip status={c.status} />}
        <span className="font-mono text-meta text-n-500">{formatDateTime(c.created_at)}</span>
        {c.edited_at && !c.deleted && <span className="text-meta text-n-500" title={`고침 ${formatDateTime(c.edited_at)}`}>(고침)</span>}
      </div>
      {editing ? (
        <div className="mt-1.5">
          <Composer initial={c.body} placeholder="글 고치기" submitLabel="저장" onSubmit={save} onCancel={() => setEditing(false)} autoFocus />
        </div>
      ) : (
        <p className={`mt-1 whitespace-pre-wrap break-words text-ui leading-5 ${c.deleted ? 'italic text-n-500' : 'text-n-800'}`}>
          {c.deleted ? '삭제된 글입니다.' : c.body}
        </p>
      )}
      {c.resolved && !c.deleted && (
        <p className="mt-1 text-meta text-ok">{c.resolved.name || c.resolved.employee_id} 님이 {formatDateTime(c.resolved.at)}에 해결함</p>
      )}
      {!editing && !c.deleted && (canReply || c.can_resolve || c.can_edit || c.can_delete) && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {canReply && <Button variant="ghost" size="sm" className="-ml-2" onClick={onReply}>답글</Button>}
          {c.can_resolve && (
            <Button variant="ghost" size="sm" onClick={toggleResolved} disabled={busy}>
              {c.status === 'open' ? '해결됨으로 표시' : '다시 열기'}
            </Button>
          )}
          {c.can_edit && <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={busy}>고치기</Button>}
          {c.can_delete && <Button variant="ghost" size="sm" className="text-err" onClick={remove} disabled={busy}>지우기</Button>}
        </div>
      )}
    </div>
  );
}

function Thread({ c, entryId, canComment, onChanged }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  async function reply({ body }) {
    try {
      await api(`/entries/${encodeURIComponent(entryId)}/comments`, { method: 'POST', body: { body, kind: 'comment', parent_id: c.id } });
      setReplying(false);
      onChanged();
    } catch (err) { toast.show({ tone: 'err', message: errorText(err, '답글을 올리지 못했습니다.') }); throw err; }
  }
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${c.status === 'open' ? 'border-wait-line' : 'border-n-200'}`}>
      <CommentItem c={c} onChanged={onChanged} canReply={canComment && !c.deleted} onReply={() => setReplying(true)} />
      {(c.replies.length > 0 || replying) && (
        <ul className="mt-2.5 flex flex-col gap-2.5 border-l-2 border-n-150 pl-3">
          {c.replies.map((r) => <li key={r.id}><CommentItem c={r} reply onChanged={onChanged} /></li>)}
          {replying && (
            <li><Composer placeholder="답글 쓰기" submitLabel="답글 올리기" onSubmit={reply} onCancel={() => setReplying(false)} autoFocus /></li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * 63 — 자료 의견과 이슈. 확정 자료 화면 아래에 다른 사람이 의견을 남기고, 고칠 점은 이슈로 올려 해결까지 따라간다.
 * 결론과 주의점(53)은 올린 사람이 정리한 글이고, 여기는 다른 사람의 목소리다.
 */
export const COMMENTS_ANCHOR = 'entry-comments';

/** 속성 칸의 '의견' 줄 — 의견 수와 열린 이슈 수, 누르면 아래 의견 구역으로 내려간다(63). */
export function CommentsLink({ counts }) {
  function go() {
    const el = document.getElementById(COMMENTS_ANCHOR);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el?.focus?.({ preventScroll: true });
  }
  const total = counts?.total || 0;
  const open = counts?.open_issues || 0;
  return (
    <button type="button" onClick={go}
            className="inline-flex min-w-0 items-baseline gap-1.5 rounded-xs text-left text-ui text-n-800 underline-offset-2 hover:text-brand hover:underline">
      {counts == null ? <span className="text-n-500">…</span> : total ? <span>의견 <span className="font-mono">{total}</span></span> : <span>의견 남기기</span>}
      {open > 0 && <span className="text-meta font-medium text-wait">열린 이슈 {open}</span>}
    </button>
  );
}

export default function EntryComments({ entryId, status, onCounts }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (status === 'draft') return undefined;
    let live = true;
    api(`/entries/${encodeURIComponent(entryId)}/comments`)
      .then((d) => { if (live) { setData(d); setFailed(false); onCounts?.({ total: d.total, open_issues: d.open_issues }); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [entryId, status, tick]);

  if (status === 'draft') return null;   // 초안은 올린 사람의 작업 공간 — 확정한 뒤에 의견을 받는다

  async function post({ body, kind }) {
    try {
      await api(`/entries/${encodeURIComponent(entryId)}/comments`, { method: 'POST', body: { body, kind } });
      reload();
    } catch (err) { toast.show({ tone: 'err', message: errorText(err, '글을 올리지 못했습니다.') }); throw err; }
  }

  const items = data?.items || [];
  return (
    <section id={COMMENTS_ANCHOR} tabIndex={-1} aria-label="의견과 이슈" className="mt-8 scroll-mt-4 border-t border-n-200 pt-5 outline-none">
      <div className="mb-1 flex items-baseline gap-2">
        <SectionTitle>의견 {data?.total > 0 && <span className="font-mono font-normal text-n-500">{data.total}</span>}</SectionTitle>
        {data?.open_issues > 0 && <span className="text-meta font-medium text-wait">열린 이슈 {data.open_issues}</span>}
      </div>
      <p className="mb-3 text-meta text-n-600">이 자료를 참고한 사람이 남기는 의견과 고칠 점입니다. 올린 사람이 정리한 내용은 오른쪽 결론과 주의점에 있습니다.</p>
      {failed && !data && <p className="text-meta text-err">의견을 불러오지 못했습니다.</p>}
      {!failed && !data && <div aria-hidden="true" className="appear-late space-y-2"><Bar className="h-3 w-2/3" /><Bar className="h-3 w-1/3" /></div>}
      {data && (
        <>
          {items.length > 0 ? (
            <ul aria-label="의견 목록" className="mb-4 flex flex-col gap-2.5">
              {items.map((c) => <Thread key={c.id} c={c} entryId={entryId} canComment={data.can_comment} onChanged={reload} />)}
            </ul>
          ) : (
            <p className="mb-3 flex items-center gap-1.5 text-ui text-n-500"><MessageSquare size={14} aria-hidden="true" />아직 의견이 없습니다.</p>
          )}
          {data.can_comment ? (
            <Composer withKind placeholder="이 자료에 대한 의견이나 고칠 점을 남겨 주세요" submitLabel="올리기" onSubmit={post} />
          ) : status === 'trashed' && <p className="text-meta text-n-500">휴지통에 있는 자료라 의견을 쓸 수 없습니다.</p>}
        </>
      )}
    </section>
  );
}
