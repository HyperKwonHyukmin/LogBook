import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NotebookPen, Search } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { HullChip } from '../components/ui/Status.jsx';
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

/**
 * 64 — 나의 메모(`/notes`, 왼쪽 메뉴). 자료마다 남긴 내 메모(개인 지식 노트)를 최근 고친 순으로 모아 본다.
 * 줄 머리(자료 번호, 제목)를 누르면 그 자료 화면으로 간다. 메모는 자료 화면 오른쪽 '나의 메모'에서 쓰고 고친다.
 */
export default function NotesPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [q]);

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
    <Page>
      <PageHeader title="나의 메모"
                  description="자료마다 남긴 나만 보는 메모입니다. 자료 화면 오른쪽 '나의 메모'에서 쓰고, 마크다운을 쓸 수 있습니다." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative flex w-full max-w-[420px] items-center">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-n-500" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="메모 찾기"
                 placeholder="메모 내용, 자료 제목, 자료 번호로 찾기" className={inputClass('w-full pl-8')} />
        </label>
        {data && (
          <span className="text-meta text-n-600">
            {query ? <>찾은 메모 <span className="font-mono text-n-800">{items.length}</span> / </> : '메모 '}
            <span className="font-mono text-n-800">{data.total}</span>개
          </span>
        )}
      </div>
      {error && (
        <ErrorNote action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>{error}</ErrorNote>
      )}
      {!data && !error && <BlockSkeleton className="h-40" />}
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
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {n.entry.hulls.map((h) => <HullChip key={h} hull={h} />)}
                {!n.entry.hulls.length && n.entry.no_hull && <span className="text-meta text-n-600">공용</span>}
                <Link to={`/e/${n.entry.entry_id}`}
                      className="inline-flex min-w-0 items-baseline gap-2 text-body font-semibold text-n-900 hover:text-brand hover:underline underline-offset-2">
                  <span className="font-mono text-meta font-normal text-n-500">{n.entry.entry_id}</span>
                  <span className="truncate">{n.entry.title}</span>
                </Link>
                {n.entry.status === 'draft' && <span className="text-meta text-wait">확정 전</span>}
                <span className="ml-auto font-mono text-meta text-n-500" title="고친 시각">{formatDateTime(n.updated_at)}</span>
              </div>
              <NoteBody body={n.body} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
