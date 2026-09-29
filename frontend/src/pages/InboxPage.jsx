import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import BatchCard from '../components/inbox/BatchCard.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import { errorText } from '../lib/labels.js';

const TABS = [{ id: 'mine', label: '내 배치' }, { id: 'unclaimed', label: '주인 없는 배치' }];
const tabId = (id) => `inbox-tab-${id}`;
const PANEL_ID = 'inbox-tabpanel';
const POLL_MS = 5000;

export default function InboxPage() {
  const { user, isAdmin } = useAuth();
  const storage = useOutletContext()?.storage;
  const [tab, setTab] = useState('mine');
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const requestRef = useRef(0);
  const tabRefs = useRef([]);

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
  // 분석 중(staged) 배치가 있으면 워커가 끝낼 때까지 주기적으로 다시 부른다.
  const waiting = batches.some((b) => b.state === 'staged');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  function onUploaded() {
    if (latestRef.current.tab === 'mine') reload();
    else setTab('mine'); // 탭이 바뀌면 effect 가 내 배치를 부른다
  }

  function onTabKeyDown(e, idx) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  async function claim(key) {
    let message = '';
    try { await api(`/batches/${key}/claim`, { method: 'POST' }); } catch (err) { message = errorText(err); }
    await reload(); // 성공한 새로 부르기가 오류를 지우므로 사유는 그 뒤에 보인다
    if (message) setError(message);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight">정리 대기</h1>
        <p className="mt-1 text-[13px] text-zinc-600">올린 자료의 묶음 제안을 확인하고 확정하세요. 확정 전에도 검색에는 ‘미분류’로 보입니다.</p>
      </div>
      <UploadZone onUploaded={onUploaded} disabled={storage?.reachable === false} />
      <div role="tablist" aria-label="배치 구분" className="flex gap-1 border-b border-line">
        {TABS.map((t, idx) => (
          <button key={t.id} ref={(el) => { tabRefs.current[idx] = el; }} type="button" role="tab" id={tabId(t.id)}
                  aria-selected={tab === t.id} aria-controls={PANEL_ID} tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKeyDown(e, idx)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === t.id ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-600 hover:text-zinc-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="flex flex-col gap-5">
        {error && <p role="alert" className="text-[13px] text-err">{error}</p>}
        {loading && <div className="h-24 animate-pulse rounded-lg bg-zinc-200/60" aria-label="불러오는 중" />}
        {!loading && batches.length === 0 && !error && (
          <EmptyState icon={Inbox} title="정리할 자료가 없습니다">
            {tab === 'mine' ? '위에서 올리거나, 탐색기로 999_LogBook\\00_Inbox 에 복사하면 1~2분 뒤 여기에 나타납니다.' : '주인을 찾지 못한 배치가 없습니다.'}
          </EmptyState>
        )}
        {batches.map((b) => (
          <BatchCard key={b.key} batch={b} me={user.employee_id} isAdmin={isAdmin} onChanged={reload} onClaim={claim} />
        ))}
      </div>
    </div>
  );
}
