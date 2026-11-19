import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { api } from '../api/client.js';
import { IssueChip } from '../components/comments/EntryComments.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { errorText, formatDateTime } from '../lib/labels.js';

/**
 * 63 — 새 의견(`/comments`, 계정 메뉴에서 연다). 내가 올린 자료에 남이 쓴 글과 내 글에 남이 단 답글, 최근 것부터.
 * 열면 읽은 시각을 저장한다(목록의 '새 글' 표시는 연 순간의 값으로 남긴다).
 */
export default function CommentsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    api('/me/comments?limit=100')
      .then((d) => {
        if (!live) return;
        setData(d);
        api('/me/comments/seen', { method: 'POST' })
          .then(() => window.dispatchEvent(new Event('logbook:comments-seen'))).catch(() => {});
      })
      .catch((err) => { if (live) setError(errorText(err, '의견을 불러오지 못했습니다.')); });
    return () => { live = false; };
  }, [attempt]);

  const items = data?.items || [];
  const fresh = items.filter((i) => i.is_new).length;
  return (
    <Page>
      <PageHeader title="새 의견" description="내가 올린 자료에 다른 사람이 남긴 의견과 이슈, 내 글에 달린 답글입니다." />
      {error && (
        <ErrorNote action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>{error}</ErrorNote>
      )}
      {!data && !error && <BlockSkeleton className="h-40" />}
      {data && items.length === 0 && (
        <EmptyState icon={MessageSquare} title="아직 받은 의견이 없습니다">다른 사람이 내 자료에 의견을 남기면 여기에 모입니다.</EmptyState>
      )}
      {items.length > 0 && (
        <>
          {fresh > 0 && <p className="mb-3 text-ui text-n-700">지난번에 본 뒤 새로 온 글 <span className="font-mono font-semibold">{fresh}</span>건</p>}
          <ul aria-label="받은 의견" className="flex flex-col divide-y divide-n-100 rounded-lg border border-n-200 bg-n-0">
            {items.map((c) => (
              <li key={c.id} className={`px-3.5 py-3 ${c.is_new ? 'bg-brand-subtle' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {c.is_new && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="새 글" />}
                  <span className="text-ui font-medium text-n-900" title={c.author.employee_id}>{c.author.name || c.author.employee_id}</span>
                  <span className="text-meta text-n-600">{c.reply_to_me ? '내 글에 답글' : c.reason === 'assigned' ? '담당 자료에' : '내 자료에'}</span>
                  <IssueChip status={c.status} />
                  <span className="ml-auto font-mono text-meta text-n-500">{formatDateTime(c.created_at)}</span>
                </div>
                <Link to={`/e/${c.entry.entry_id}`}
                      className="mt-1 inline-flex max-w-full items-baseline gap-1.5 text-meta text-n-700 hover:text-brand hover:underline underline-offset-2">
                  <span className="font-mono text-n-500">{c.entry.entry_id}</span><span className="truncate">{c.entry.title}</span>
                </Link>
                <p className="mt-1 whitespace-pre-wrap break-words text-ui leading-5 text-n-800">{c.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
