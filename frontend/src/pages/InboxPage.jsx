import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import BatchCard from '../components/inbox/BatchCard.jsx';
import { PageDropOverlay, UploadButtons, UploadFeedback, useUploader } from '../components/inbox/UploadZone.jsx';
import { errorText } from '../lib/labels.js';
import { hasPendingConvert } from '../lib/inboxStatus.js';

const tabId = (id) => `inbox-tab-${id}`;
const TABS = [{ id: 'mine', label: '내 배치', tabId: tabId('mine') }, { id: 'unclaimed', label: '주인 없는 배치', tabId: tabId('unclaimed') }];
const PANEL_ID = 'inbox-tabpanel';
const POLL_MS = 5000;
/** BDF 3D 변환만 기다릴 때는 느긋하게 — 변환은 한 건에 수십 초~분 걸린다. */
const CONVERT_POLL_MS = 15000;

export default function InboxPage() {
  const { user, isAdmin } = useAuth();
  const storage = useOutletContext()?.storage;
  const [tab, setTab] = useState('mine');
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const requestRef = useRef(0);

  // 가장 마지막 요청의 응답만 쓴다 — 탭을 빨리 바꾸면 늦게 온 이전 탭 응답이 목록을 덮을 수 있다.
  const load = useCallback(() => {
    const id = ++requestRef.current;
    const latest = () => id === requestRef.current;
    return api(`/batches?scope=${tab}`)
      .then((rows) => { if (latest()) { setBatches(rows); setError(''); } })
      .catch(() => { if (latest()) setError('정리 대기 목록을 불러오지 못했습니다.'); })
      .finally(() => { if (latest()) setLoading(false); });
  }, [tab]);
  // 올리기는 오래 걸린다 — 끝났을 때의 탭·load 를 쓰도록 ref 로 들고 있는다.
  const latestRef = useRef({ tab, load });
  latestRef.current = { tab, load };
  // 비동기 작업(가져가기·초안 수정)이 끝난 뒤에는 그때의 탭으로 다시 부른다.
  const reload = useCallback(() => latestRef.current.load(), []);

  useEffect(() => { setLoading(true); load(); }, [load]);
  // 분석 중(staged) 배치가 있으면 워커가 끝낼 때까지 주기적으로 다시 부른다(진행 단계·n/N 도 함께 바뀐다).
  // 초안의 BDF 3D 변환만 남았으면 더 느리게 부른다.
  const waiting = batches.some((b) => b.state === 'staged');
  const converting = !waiting && batches.some(hasPendingConvert);
  const pollMs = waiting ? POLL_MS : converting ? CONVERT_POLL_MS : 0;
  useEffect(() => {
    if (!pollMs) return undefined;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [pollMs, load]);

  function onUploaded() {
    if (latestRef.current.tab === 'mine') reload();
    else setTab('mine'); // 탭이 바뀌면 effect 가 내 배치를 부른다
  }
  const uploader = useUploader({ onUploaded, disabled: storage?.reachable === false });

  async function claim(key) {
    let message = '';
    try { await api(`/batches/${key}/claim`, { method: 'POST' }); } catch (err) { message = errorText(err); }
    await reload(); // 성공한 새로 부르기가 오류를 지우므로 사유는 그 뒤에 보인다
    if (message) setError(message);
  }

  return (
    <Page>
      <PageDropOverlay u={uploader} />
      <PageHeader title="정리 대기"
        description="올린 자료의 묶음 제안을 확인하고 확정하세요. 확정 전에도 검색에는 미분류로 보입니다. 이 화면 어디에나 폴더를 끌어 놓아도 올라갑니다."
        actions={<UploadButtons u={uploader} />} />
      <div className="mb-4 empty:hidden"><UploadFeedback u={uploader} /></div>
      <Tabs label="배치 구분" items={TABS} value={tab} onChange={setTab} controls={PANEL_ID} />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="flex flex-col gap-8 pt-5">
        {error && <ErrorNote>{error}</ErrorNote>}
        {loading && <BlockSkeleton className="h-32" />}
        {!loading && batches.length === 0 && !error && (
          <EmptyState icon={Inbox} title="정리할 자료가 없습니다">
            {tab === 'mine'
              ? <>폴더나 파일을 이 화면에 끌어 놓거나 위의 단추로 고르세요. 탐색기로 <span className="font-mono">999_LogBook\00_Inbox</span> 에 복사하면 1~2분 뒤 여기에 나타납니다.</>
              : '주인을 찾지 못한 배치가 없습니다.'}
          </EmptyState>
        )}
        {batches.map((b) => (
          <BatchCard key={b.key} batch={b} me={user.employee_id} isAdmin={isAdmin} onChanged={reload} onClaim={claim} />
        ))}
      </div>
    </Page>
  );
}
