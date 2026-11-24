import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CornerDownRight, MessageSquare, NotebookPen, Search } from 'lucide-react';
import { COMMENTS_ANCHOR, IssueChip } from '../components/comments/EntryComments.jsx';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { HullChip } from '../components/ui/Status.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { errorText, formatDateTime } from '../lib/labels.js';
import { renderMarkdown } from '../lib/markdown.js';

const SEARCH_DELAY_MS = 250;

/** 접힌 메모 — 높이를 넘으면 [펼치기]. 변환된 HTML 은 renderMarkdown 이 DOMPurify 로 거른 것이다. */
function NoteBody({ body }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [body]);
  return (
    <>
      <div ref={ref} className={`md-body mt-2 ${open ? '' : 'max-h-40 overflow-hidden'}`}
           dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      {(overflow || open) && (
        <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '접기' : '펼치기'}
        </Button>
      )}
    </>
  );
}

/** 줄 머리 — 호선 칩(공용), 자료 번호 + 제목 링크. */
function EntryHead({ entry, to, children }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {entry.hulls.map((h) => <HullChip key={h} hull={h} />)}
      {!entry.hulls.length && entry.no_hull && <span className="text-meta text-n-600">공용</span>}
      <Link to={to}
            className="inline-flex min-w-0 items-baseline gap-2 text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">
        <span className="font-mono text-meta font-normal text-n-500">{entry.entry_id}</span>
        <span className="truncate">{entry.title}</span>
      </Link>
      {children}
    </div>
  );
}

/** 찾기 칸 + 건수 줄(두 탭 공용). q 는 쓰는 중인 글자, 서버에는 250ms 뒤에 보낸다. */
function useDebounced(value) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

function SearchBox({ value, onChange, label, placeholder, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="relative flex w-full max-w-[420px] items-center">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-n-500" />
        <input type="search" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
               placeholder={placeholder} className={inputClass('w-full pl-8')} />
      </label>
      {children}
    </div>
  );
}

function Loading({ error, data, retry }) {
  if (error) {
    return <ErrorNote action={<Button variant="ghost" size="sm" className="-my-1" onClick={retry}>다시 시도</Button>}>{error}</ErrorNote>;
  }
  return !data ? <BlockSkeleton className="h-40" /> : null;
}

/** 64 — 메모 탭: 자료마다 남긴 내 메모를 최근 고친 순으로. */
function MemoTab() {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    api(`/me/notes?${new URLSearchParams({ q: query, limit: '500' })}`)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(errorText(err, '메모를 불러오지 못했습니다.')); });
    return () => { live = false; };
  }, [query, attempt]);

  const items = data?.items || [];
  return (
    <>
      <SearchBox value={q} onChange={setQ} label="메모 찾기" placeholder="메모 내용, 자료 제목, 자료 번호로 찾기">
        {data && (
          <span className="text-meta text-n-600">
            {query ? <>찾은 메모 <span className="font-mono text-n-800">{items.length}</span> / </> : '메모 '}
            <span className="font-mono text-n-800">{data.total}</span>개
          </span>
        )}
      </SearchBox>
      <Loading error={error} data={data} retry={() => setAttempt((n) => n + 1)} />
      {data && data.total === 0 && (
        <EmptyState icon={NotebookPen} title="아직 메모가 없습니다">
          자료 화면 오른쪽의 '나의 메모'에 적으면 여기에 모입니다. 다른 사람에게는 보이지 않습니다.
        </EmptyState>
      )}
      {data && data.total > 0 && items.length === 0 && (
        <p className="mt-6 text-ui text-n-600">'{query}' 가 들어간 메모가 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul aria-label="나의 메모 목록" className="flex flex-col divide-y divide-n-200 rounded-lg border border-n-200 bg-n-0">
          {items.map((n) => (
            <li key={n.entry.entry_id} className="px-4 py-3.5">
              <EntryHead entry={n.entry} to={`/e/${n.entry.entry_id}`}>
                {n.entry.status === 'draft' && <span className="text-meta text-wait">확정 전</span>}
                <span className="ml-auto font-mono text-meta text-n-500" title="고친 시각">{formatDateTime(n.updated_at)}</span>
              </EntryHead>
              <NoteBody body={n.body} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// 2026-11-25 — 의견과 이슈 탭의 거르기. 숫자는 서버 counts(거르기 전 전체)
const FILTERS = [
  { id: 'all', label: '전체', count: (c) => c.total, params: {} },
  { id: 'comment', label: '의견', count: (c) => c.comment, params: { kind: 'comment' } },
  { id: 'issue', label: '이슈', count: (c) => c.issue, params: { kind: 'issue' } },
  { id: 'open', label: '열린 이슈', count: (c) => c.open, params: { status: 'open' } },
];

/** 답글이면 어느 글에 단 것인지 한 줄. */
function ReplyTo({ to }) {
  if (!to) return null;
  const who = to.mine ? '내' : to.name ? `${to.name} 님의` : '다른 사람의';
  return (
    <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-meta text-n-600">
      <CornerDownRight size={12} aria-hidden="true" className="shrink-0 translate-y-0.5 text-n-400" />
      <span className="shrink-0">{who} {to.kind === 'issue' ? '이슈' : '의견'}에 단 답글</span>
      {to.body && <span className="min-w-0 truncate text-n-500">"{to.body}"</span>}
    </p>
  );
}

/** 2026-11-25 — 의견과 이슈 탭: 내가 자료에 남긴 의견, 이슈, 답글. 줄을 누르면 그 자료의 '의견과 이슈' 칸으로 간다. */
function CommentsTab() {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    api(`/me/comments/written?${new URLSearchParams({ q: query, limit: '500', ...f.params })}`)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(errorText(err, '의견과 이슈를 불러오지 못했습니다.')); });
    return () => { live = false; };
  }, [query, filter, attempt]);

  const items = data?.items || [];
  const counts = data?.counts;
  return (
    <>
      <SearchBox value={q} onChange={setQ} label="의견과 이슈 찾기" placeholder="글 내용, 자료 제목, 자료 번호로 찾기">
        {counts && counts.total > 0 && (
          <Segmented label="종류" value={filter} onChange={setFilter}
                     items={FILTERS.map((f) => ({ id: f.id, label: <>{f.label} <span className="font-mono">{f.count(counts)}</span></> }))} />
        )}
      </SearchBox>
      <Loading error={error} data={data} retry={() => setAttempt((n) => n + 1)} />
      {counts && counts.total === 0 && (
        <EmptyState icon={MessageSquare} title="아직 쓴 의견이나 이슈가 없습니다">
          자료 화면 아래 '의견과 이슈'에 쓴 글과 답글이 여기에 모입니다.
        </EmptyState>
      )}
      {counts && counts.total > 0 && items.length === 0 && (
        <p className="mt-6 text-ui text-n-600">조건에 맞는 글이 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul aria-label="내가 쓴 의견과 이슈" className="flex flex-col divide-y divide-n-200 rounded-lg border border-n-200 bg-n-0">
          {items.map((c) => (
            <li key={c.id} className="px-4 py-3.5">
              <EntryHead entry={c.entry} to={`/e/${c.entry.entry_id}#${COMMENTS_ANCHOR}`}>
                {c.kind === 'issue' ? <IssueChip status={c.status} />
                  : <span className="inline-flex h-5 shrink-0 items-center rounded-xs bg-n-100 px-1.5 text-micro font-semibold text-n-700">{c.reply_to ? '답글' : '의견'}</span>}
                <span className="ml-auto font-mono text-meta text-n-500" title="쓴 시각">{formatDateTime(c.created_at)}</span>
              </EntryHead>
              <ReplyTo to={c.reply_to} />
              <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-ui leading-5 text-n-800">{c.body}</p>
              {(c.replies > 0 || c.resolved) && (
                <p className="mt-1 text-meta text-n-500">
                  {c.replies > 0 && <>답글 <span className="font-mono">{c.replies}</span></>}
                  {c.replies > 0 && c.resolved && ', '}
                  {c.resolved && <>{c.resolved.name ? `${c.resolved.name} 님이 ` : ''}해결함 {formatDateTime(c.resolved.at)}</>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const TABS = [{ id: 'memo', label: '메모' }, { id: 'comments', label: '의견과 이슈' }];

/**
 * 64 — 나의 메모(`/notes`, 왼쪽 메뉴). 2026-11-25 — 탭 둘: [메모] 나만 보는 메모, [의견과 이슈] 내가 자료에 쓴 의견, 이슈, 답글.
 * 탭은 주소에 남긴다(`?tab=comments`) — 새로 고쳐도, 링크로 보내도 같은 탭.
 */
export default function NotesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'comments' ? 'comments' : 'memo';
  const pick = (id) => setParams(id === 'memo' ? {} : { tab: id }, { replace: true });
  return (
    <Page>
      <PageHeader title="나의 메모"
                  description={tab === 'memo'
                    ? "자료마다 남긴 나만 보는 메모입니다. 자료 화면 오른쪽 '나의 메모'에서 쓰고, 마크다운을 쓸 수 있습니다."
                    : '내가 자료에 남긴 의견, 이슈, 답글입니다. 누르면 그 자료의 의견과 이슈 칸으로 갑니다. 다른 사람도 보는 글입니다.'} />
      <Segmented role="tablist" label="나의 기록" size="lg" className="mb-4" value={tab} onChange={pick}
                 items={TABS.map((t) => ({ ...t, tabId: `notes-tab-${t.id}`, controls: 'notes-panel' }))} />
      <div id="notes-panel" role="tabpanel" aria-labelledby={`notes-tab-${tab}`}>
        {tab === 'memo' ? <MemoTab /> : <CommentsTab />}
      </div>
    </Page>
  );
}
