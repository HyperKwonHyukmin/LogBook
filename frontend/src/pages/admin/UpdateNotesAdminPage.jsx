import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { api } from '../../api/client.js';
import { CopyLinkButton, KindBadge } from '../../components/updates/NoteArticle.jsx';
import Button, { buttonClass } from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { errorText } from '../../lib/labels.js';
import { notePath, noteUrl } from '../../lib/updateNotes.js';

/**
 * 70 — 관리 › 업데이트 안내. 안내마다 공유 주소를 보이고 복사한다(메일, 메신저로 사용자에게).
 * 작성 화면은 없다 — 안내는 서버 app/update_notes/notes.json 에 더하고 배포한다(WorkBench 와 같은 방식).
 */
export default function UpdateNotesAdminPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setError(''); setList(null);
    api('/update-notes')
      .then((r) => setList(r?.items || []))
      .catch((err) => { setError(errorText(err, '업데이트 안내를 불러오지 못했습니다.')); setList([]); });
  }
  useEffect(load, []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page className="max-w-[1120px]">
      <PageHeader title="업데이트 안내"
        description="사용자에게 보낼 사용법 안내와 공유 주소입니다. 주소를 메일이나 메신저에 붙여 넣으면 받는 사람이 로그인한 뒤 그 안내로 바로 갑니다."
        actions={<Link to="/update-notes" className={buttonClass('secondary', 'sm')}>사용자 화면으로 보기</Link>} />
      {error && <ErrorNote className="mb-4" action={<Button size="sm" variant="secondary" onClick={load}>다시 시도</Button>}>{error}</ErrorNote>}
      {list === null && <RowsSkeleton rows={4} label="업데이트 안내를 불러오는 중" />}
      {list !== null && !error && list.length === 0 && (
        <EmptyState icon={Megaphone} title="아직 안내가 없습니다">backend/app/update_notes/notes.json 에 첫 안내를 더하고 배포하세요.</EmptyState>
      )}
      {list?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b border-n-200 text-left text-meta font-medium text-n-600">
                <th scope="col" className="py-2 pr-3 font-medium">날짜</th>
                <th scope="col" className="py-2 pr-3 font-medium">제목</th>
                <th scope="col" className="py-2 pr-3 font-medium">공유 주소</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">동작</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-n-200">
              {list.map((it) => (
                <tr key={it.id} className="align-top">
                  <td className="whitespace-nowrap py-3 pr-3 font-mono text-meta text-n-600">{it.date}</td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link to={notePath(it.id)} className="font-medium text-n-900 hover:text-brand">{it.title}</Link>
                      <KindBadge kind={it.kind} />
                    </div>
                    {it.summary && <p className="mt-0.5 text-meta text-n-600">{it.summary}</p>}
                  </td>
                  <td className="py-3 pr-3 font-mono text-meta text-n-600 break-all">{noteUrl(it.id)}</td>
                  <td className="py-3"><CopyLinkButton id={it.id} label="복사" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-10 border-t border-n-200 pt-3 text-meta text-n-500">
        새 안내는 backend/app/update_notes/notes.json 맨 앞에 더하고 배포합니다(145 Update, 프런트 빌드 불필요). 작은 수정은 업데이트 이력에만 적습니다.
      </p>
    </Page>
  );
}
