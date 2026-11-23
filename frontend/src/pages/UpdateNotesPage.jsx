import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { api } from '../api/client.js';
import NoteArticle from '../components/updates/NoteArticle.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { errorText } from '../lib/labels.js';
import { pageTitle } from '../lib/pageTitle.js';
import { groupByMonth, notePath, writeSeen } from '../lib/updateNotes.js';

/**
 * 70 — 업데이트 안내(/update-notes, /update-notes/:noteId). 로그인한 누구나 읽는다.
 * 왼쪽 달별 목록, 오른쪽 고른 안내. 주소가 곧 공유 링크다 — 없는 id 면 최신 안내를 보이며 알린다(죽은 링크 없음).
 */
export default function UpdateNotesPage() {
  const { noteId } = useParams();
  const [list, setList] = useState(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState('');           // 목록 오류
  const [noteError, setNoteError] = useState('');   // 고른 안내 오류(다른 안내를 고르면 지운다)
  const [retry, setRetry] = useState(0);

  function loadList() {
    setError(''); setList(null);
    api('/update-notes')
      .then((r) => { const items = r?.items || []; setList(items); writeSeen(items[0]?.id); })
      .catch((err) => { setError(errorText(err, '업데이트 안내를 불러오지 못했습니다.')); setList([]); });
  }
  useEffect(loadList, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const found = Boolean(noteId && list?.some((it) => it.id === noteId));
  const missing = Boolean(noteId && list && list.length && !found);
  const currentId = found ? noteId : list?.[0]?.id;

  useEffect(() => {
    if (!currentId) return undefined;
    let alive = true;
    setNoteError('');
    setNote((n) => (n?.id === currentId ? n : null));
    api(`/update-notes/${encodeURIComponent(currentId)}`)
      .then((n) => { if (alive) setNote(n); })
      .catch((err) => { if (alive) setNoteError(errorText(err, '안내를 불러오지 못했습니다.')); });
    return () => { alive = false; };   // 늦게 온 앞 안내의 응답은 버린다
  }, [currentId, retry]);

  useEffect(() => {
    if (note?.id === currentId && note?.title) document.title = pageTitle(notePath(note.id), note.title);
  }, [note, currentId]);

  // 목록에서 다른 안내를 고르면 본문 머리로(처음 열 때는 그대로)
  const topRef = useRef(null);
  const firstId = useRef(null);
  useEffect(() => {
    if (!currentId) return;
    if (firstId.current === null) { firstId.current = currentId; return; }
    topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [currentId]);

  return (
    <Page className="max-w-[1120px]">
      <PageHeader title="업데이트 안내"
        description="LogBook 에 새로 생기거나 바뀐 사용법을 안내합니다. 안내마다 주소가 있어 그대로 공유할 수 있습니다." />
      {error && <ErrorNote className="mb-4" action={<Button size="sm" variant="secondary" onClick={loadList}>다시 시도</Button>}>{error}</ErrorNote>}
      {list === null && <RowsSkeleton rows={4} label="업데이트 안내를 불러오는 중" />}
      {list !== null && !error && list.length === 0 && (
        <EmptyState icon={Megaphone} title="아직 올라온 안내가 없습니다">새 기능이 배포되면 여기에 사용법 안내가 쌓입니다.</EmptyState>
      )}
      {list?.length > 0 && (
        <div className="grid grid-cols-[232px_minmax(0,1fr)] gap-10 max-[900px]:grid-cols-1 max-[900px]:gap-6">
          <nav aria-label="안내 목록" className="self-start min-[901px]:sticky min-[901px]:top-4">
            {groupByMonth(list).map((g) => (
              <div key={g.month} className="mb-4">
                <h2 className="mb-1 text-meta font-semibold text-n-600">{g.label}</h2>
                <ul>
                  {g.items.map((it) => {
                    const on = it.id === currentId;
                    return (
                      <li key={it.id}>
                        <Link to={notePath(it.id)} aria-current={on ? 'page' : undefined}
                              className={`block rounded-md px-2 py-1.5 text-ui leading-5 transition-colors duration-150 ease-out
                                ${on ? 'bg-n-100 font-medium text-n-900' : 'text-n-700 hover:bg-n-50 hover:text-n-900'}`}>
                          <span className="block font-mono text-micro text-n-500">{it.date}</span>
                          {it.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div ref={topRef} className="min-w-0 max-w-[760px] scroll-mt-4">
            {missing && (
              <p role="status" className="mb-4 rounded-md bg-wait-bg px-3 py-2 text-meta text-wait">
                찾는 안내가 없어 최신 안내를 보여 줍니다. 주소가 바뀌었거나 지워진 안내일 수 있습니다.
              </p>
            )}
            {noteError ? (
              <ErrorNote action={<Button size="sm" variant="secondary" onClick={() => setRetry((r) => r + 1)}>다시 시도</Button>}>{noteError}</ErrorNote>
            ) : note?.id === currentId ? <NoteArticle note={note} /> : <RowsSkeleton rows={5} label="안내를 불러오는 중" />}
          </div>
        </div>
      )}
    </Page>
  );
}
