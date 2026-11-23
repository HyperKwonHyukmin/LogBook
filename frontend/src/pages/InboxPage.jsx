import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { BlockSkeleton } from '../components/ui/Skeleton.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import BatchCard from '../components/inbox/BatchCard.jsx';
import DraftDetail from '../components/inbox/DraftDetail.jsx';
import InboxList from '../components/inbox/InboxList.jsx';
import FixList from '../components/coverage/FixList.jsx';
import { PageDropOverlay, UploadButtons, UploadCenterCard, UploadCenterStack, UploadFeedback, isOsFileDrag,
  useOsFileDragActive, useUploader } from '../components/inbox/UploadZone.jsx';
import { errorText } from '../lib/labels.js';
import { READ_ONLY_REASON } from '../lib/levels.js';
import { bulkPick, flatRows, groupRows } from '../lib/inboxRows.js';
import { useConfirm } from '../components/ui/ConfirmDialog.jsx';
import { LEAVE_TEXT, useUnsavedGuard } from '../lib/useUnsavedGuard.js';
import { useToast } from '../components/ui/Toast.jsx';
import { useInboxSummary } from '../components/shell/InboxSummary.jsx';
import { useUploadSnapshot, useUploadStore } from '../components/inbox/UploadProvider.jsx';

const tabId = (id) => `inbox-tab-${id}`;
// 48 — 손볼 자료(갖춤 현황에서 옮김)는 확정 자료 목록이라 배치를 부르지 않는다. /inbox?tab=fix 로 바로 연다
const TABS = [
  { id: 'mine', label: '내가 올린 묶음', tabId: tabId('mine') },
  { id: 'fix', label: '보완할 자료', tabId: tabId('fix') },
  { id: 'unclaimed', label: '폴더에 직접 넣은 묶음', tabId: tabId('unclaimed') },
];
const tabOf = (v) => (TABS.some((t) => t.id === v) ? v : 'mine');
const PANEL_ID = 'inbox-tabpanel';
// 올리던 중에 이 화면을 떠났다가 끝나면 셸이 띄우는 토스트(올리기는 셸 저장소에서 계속된다)
const INBOX_AWAY = { title: '올리기', message: '올렸습니다. 다음 단계는 올리기와 확정에서 이어집니다.', to: '/inbox', label: '올리기와 확정으로' };
const POLL_MS = 5000;
const Q_DELAY = 300;
/** 68 — 이 폭 이상이면 목록과 상세를 나란히, 좁으면 목록만 보이고 줄을 누르면 상세가 화면 전체로. */
const WIDE_QUERY = '(min-width: 1100px)';

function useMedia(query) {
  const get = () => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(query).matches);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return match;
}

/**
 * 올리기와 확정 — 68 목록 + 상세. 왼쪽은 초안 1건 = 한 줄(묶음별, 서버가 정한 상태), 오른쪽은 고른 초안의 카드
 * (예전 DraftCard) 또는 고른 묶음(진행, 제외 파일, 결과). 줄은 GET /api/inbox/drafts, 묶음 머리는 GET /api/batches?lite=1.
 */
export default function InboxPage() {
  const { user, isAdmin, canWrite: ctxCanWrite } = useAuth();
  // 15 — 올리기는 로그인한 누구나(LV1 이상). canWrite 가 거짓인 경우는 안전한 기본값으로만 남겼다
  const canWrite = ctxCanWrite !== false;
  const storage = useOutletContext()?.storage;
  // 주소는 처음 열 때만 읽는다 — 탭 전환까지 주소로 하면 저장 안 한 변경 확인(useUnsavedGuard)이 한 번 더 묻는다
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => tabOf(params.get('tab')));
  const isFix = tab === 'fix';
  const wide = useMedia(WIDE_QUERY);

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stateFilter, setStateFilter] = useState(null);
  const [q, setQ] = useState('');
  const [qSent, setQSent] = useState('');
  const [who, setWho] = useState('all');
  const [sel, setSel] = useState(null);           // { kind: 'draft', id } | { kind: 'batch', key }
  const [narrowDetail, setNarrowDetail] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [bulk, setBulk] = useState({ busy: false, message: '', failed: false });
  const [dropNote, setDropNote] = useState('');
  // 11 — 상세 카드의 저장하지 않은 변경. 있으면 다른 줄·탭·화면으로 갈 때 묻는다
  const [dirtyId, setDirtyId] = useState(null);
  const detailRef = useRef(null);
  const lastIndex = useRef(0);

  // 62 — 메뉴 배지·'다른 창에서 올리는 중' 안내. 목록을 다시 부를 때 같이 맞춘다
  const { summary, refresh: refreshSummary } = useInboxSummary();
  const uploadSnap = useUploadSnapshot(useUploadStore());
  const localUploads = uploadSnap ? Object.values(uploadSnap.jobs).filter((j) => j.busy || j.resumable).length : 0;
  const elsewhere = Math.max(0, (summary?.uploading || 0) - localUploads);
  const requestRef = useRef(0);
  const [confirm, dialog] = useConfirm();
  const onDirtyChange = useCallback((id, dirty) => setDirtyId((cur) => (dirty ? id : cur === id ? null : cur)), []);
  useUnsavedGuard(!!dirtyId, confirm);

  useEffect(() => {
    const t = setTimeout(() => setQSent(q.trim()), Q_DELAY);
    return () => clearTimeout(t);
  }, [q]);

  // 가장 마지막 요청의 응답만 쓴다 — 탭을 빨리 바꾸면 늦게 온 이전 탭 응답이 목록을 덮을 수 있다.
  const inFlight = useRef(false);
  const load = useCallback(() => {
    const id = ++requestRef.current;
    inFlight.current = true;
    if (tab === 'fix') { setRows([]); setBatches([]); setLoading(false); return Promise.resolve(); }
    const latest = () => id === requestRef.current;
    const query = `scope=${tab}${tab === 'mine' && who !== 'all' ? `&who=${who}` : ''}${qSent ? `&q=${encodeURIComponent(qSent)}` : ''}`;
    return Promise.all([api(`/inbox/drafts?${query}`), api(`/batches?scope=${tab}&lite=1`)])
      .then(([d, b]) => {
        if (!latest()) return;
        setRows(d.rows || []); setCounts(d.counts || null); setBatches(b || []); setError(''); refreshSummary();
      })
      .catch(() => { if (latest()) setError('올린 자료 목록을 불러오지 못했습니다.'); })
      .finally(() => { if (latest()) { setLoading(false); inFlight.current = false; } });
  }, [tab, who, qSent]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshSummary 는 바뀌지 않는다
  // 올리기는 오래 걸린다 — 끝났을 때의 탭·load 를 쓰도록 ref 로 들고 있는다.
  const latestRef = useRef({ tab, load });
  latestRef.current = { tab, load };
  const reload = useCallback(() => latestRef.current.load(), []);
  // 첫 화면(탭을 바꿀 때)만 뼈대를 보인다 — 찾기, 담당 거르기로 다시 부를 때 뼈대로 바꾸면 상세 카드가 내려가 고친 값이 사라진다
  useEffect(() => { setLoading(true); }, [tab]);
  useEffect(() => { load(); }, [load]);

  // 분석 중 묶음이나 처리 중·첨부 중 초안이 있으면 끝날 때까지 다시 부른다(BDF 3D 변환은 상세 칸이 따로 본다)
  const waiting = batches.some((b) => b.state === 'staged') || rows.some((r) => r.state === 'processing' || r.state === 'attaching');
  useEffect(() => {
    if (!waiting) return undefined;
    // 앞 요청이 아직이면 건너뛴다(늦은 응답이 늘 버려져 목록이 멈추지 않게)
    const t = setInterval(() => { if (!inFlight.current) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  const filter = useMemo(() => (stateFilter ? new Set([stateFilter]) : null), [stateFilter]);
  const { groups, settled } = useMemo(() => groupRows(rows, batches, filter), [rows, batches, filter]);
  const flat = useMemo(() => flatRows(groups), [groups]);

  // 고른 것이 사라지면(확정·버림·다른 사람이 가져감) 같은 자리의 다음 줄을 고른다. 넓은 화면에서는 처음에 첫 줄을 연다
  useEffect(() => {
    if (loading || isFix) return;
    const ids = new Set(rows.map((r) => r.entry_id));
    const keys = new Set([...groups.map((g) => g.key), ...settled.map((b) => b.key)]);
    if (sel && (sel.kind === 'draft' ? ids.has(sel.id) || dirtyId === sel.id : keys.has(sel.key))) return;
    const pick = flat[Math.min(lastIndex.current, flat.length - 1)];
    if (pick && (wide || sel)) setSel({ kind: 'draft', id: pick.entry_id });
    else if (!pick && wide && groups[0]?.batch) setSel({ kind: 'batch', key: groups[0].key });
    else setSel(null);
  }, [rows, batches, loading, wide]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sel?.kind !== 'draft') return;
    const i = flat.findIndex((r) => r.entry_id === sel.id);
    if (i >= 0) lastIndex.current = i;
  }, [sel, flat]);

  /** 상세를 떠나도 되는가 — 저장하지 않은 변경이 있으면 [저장하고 이동] [버리고 이동] [머무르기]. */
  async function leaveDetail() {
    if (!dirtyId) return true;
    const r = await confirm({
      title: '저장하지 않은 변경이 있습니다', body: '이 초안에서 고친 내용을 어떻게 할까요?',
      confirmLabel: '저장하고 이동', altLabel: '버리고 이동', cancelLabel: '머무르기', tone: 'primary',
    });
    if (r === 'alt') return true;
    if (r === true) return (await detailRef.current?.saveForLeave?.()) === true;
    return false;
  }
  async function select(next) {
    const same = sel && sel.kind === next.kind && (next.kind === 'draft' ? sel.id === next.id : sel.key === next.key);
    if (!same && !(await leaveDetail())) return;
    setSel(next);
    setNarrowDetail(true);
  }
  async function backToList() {
    if (!(await leaveDetail())) return;
    setNarrowDetail(false);
  }

  async function changeTab(next) {
    if (next === tab) return;
    if (dirtyId && !(await confirm(LEAVE_TEXT))) return;
    setTab(next); setSel(null); setChecked(new Set()); setStateFilter(null); setBulk({ busy: false, message: '', failed: false });
    lastIndex.current = 0;
  }

  function onUploaded() {
    if (latestRef.current.tab === 'mine') reload();
    else setTab('mine'); // 탭이 바뀌면 effect 가 내 배치를 부른다
  }
  const uploader = useUploader({ scope: 'inbox', onUploaded, disabled: !canWrite || storage?.reachable === false, away: INBOX_AWAY });

  // 68 — 줄에 탐색기 파일을 놓으면 그 초안에 첨부(24). 줄 위로 끄는 동안 대상 초안을 정해 두고, 놓을 때 그 칸의 올리기로 보낸다.
  // scope 가 상세 카드의 첨부(DraftAttachments)와 같아 상세를 열면 같은 진행이 보인다.
  const dragging = useOsFileDragActive();
  const [dropTo, setDropTo] = useState(null);
  const [overRow, setOverRow] = useState(null);
  const rowUploader = useUploader({
    scope: dropTo ? `draft:${dropTo}` : 'inbox-row', targetEntryId: dropTo || undefined, targetEntryStatus: 'draft',
    onUploaded: () => reload(), disabled: !dropTo || !canWrite || storage?.reachable === false,
    away: { title: '초안에 첨부', message: '초안에 붙일 파일을 올렸습니다. 올리기와 확정에서 첨부 결과를 확인하세요.', to: '/inbox', label: '올리기와 확정으로' },
  });
  const rowUploaderRef = useRef(rowUploader);
  rowUploaderRef.current = rowUploader;
  const drop = {
    over: overRow,
    onOver(e, r) {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      // 열린 초안의 줄이면 상세 카드의 첨부가 받는다 — 같은 올리기 칸(draft:E…)을 이 화면이 다시 붙잡으면 카드의 완료 처리를 덮는다
      if (dropTo !== r.entry_id && !(sel?.kind === 'draft' && sel.id === r.entry_id)) setDropTo(r.entry_id);
      if (overRow !== r.entry_id) setOverRow(r.entry_id);
    },
    onLeave(e, r) { if (!e.currentTarget.contains(e.relatedTarget)) setOverRow((c) => (c === r.entry_id ? null : c)); },
    onDrop(e, r) {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      setOverRow(null);
      const u = rowUploaderRef.current;
      if (r.state === 'attaching' || r.state === 'processing') {
        setDropNote(`${r.entry_id} 은 첨부나 정리가 끝난 뒤 다시 놓아 주세요.`);
        return;
      }
      if (sel?.kind === 'draft' && sel.id === r.entry_id && detailRef.current?.dropFiles) {
        setDropNote('');
        detailRef.current.dropFiles(e.dataTransfer);
        return;
      }
      if (u.busy) {
        setDropNote(`${r.entry_id} 은 첨부나 정리가 끝난 뒤 다시 놓아 주세요.`);
        return;
      }
      if (u.scope !== `draft:${r.entry_id}` || u.disabled) { setDropNote('지금은 이 초안에 첨부할 수 없습니다. 잠시 뒤 다시 놓아 주세요.'); return; }
      setDropNote('');
      u.onDrop(e.dataTransfer);
      select({ kind: 'draft', id: r.entry_id });
    },
  };

  // 62 — 확정하면 줄이 목록에서 사라진다. 어디로 갔는지 토스트로 알리고 자료로 바로 가게 한다
  const navigate = useNavigate();
  const toast = useToast();
  const onConfirmed = useCallback(({ entry_id: id, title, merged }) => toast.show({
    tone: 'ok', duration: 8000,
    message: merged ? `${id} ‘${title}’ 에 파일을 추가했습니다` : `확정했습니다: ${id} ‘${title}’`,
    action: { label: '자료 보기', onClick: () => navigate(`/e/${id}`) },
  }), [toast, navigate]);

  async function claim(key) {
    let message = '';
    try { await api(`/batches/${key}/claim`, { method: 'POST' }); } catch (err) { message = errorText(err); }
    await reload(); // 성공한 새로 부르기가 오류를 지우므로 사유는 그 뒤에 보인다
    if (message) setError(message);
  }

  /** 52·68 — 여러 초안을 차례로 확정. 확정 가능하고 권한 있는 줄만 보내고 나머지는 이유와 함께 남긴다. */
  async function runBulk(list, label) {
    const { go, skip } = bulkPick(list, dirtyId);
    const skipText = skip.length ? ` 건너뛰는 초안 ${skip.length}건: ${skip.map((s) => `${s.row.title || s.row.entry_id}(${s.reason})`).join(', ')}.` : '';
    if (!go.length) {
      setBulk({ busy: false, failed: true, message: `한 번에 확정할 수 있는 초안이 없습니다.${skipText} 하나씩 열어 확정하세요.` });
      return;
    }
    const ok = await confirm({
      title: `초안 ${go.length}건을 확정할까요?`,
      body: `${label}. 파일이 보관소로 옮겨집니다. 호선이 없는 초안은 '보완 필요'로 확정됩니다.${skipText}`,
      confirmLabel: `${go.length}건 확정`, tone: 'primary',
    });
    if (!ok) return;
    setBulk({ busy: true, message: '', failed: false });
    const errors = [];
    for (const r of go) {
      try { await api(`/entries/${r.entry_id}/confirm`, { method: 'POST' }); } catch (err) {
        errors.push(`${r.title || r.entry_id}: ${errorText(err, '확정하지 못했습니다.')}`);
      }
    }
    setBulk({ busy: false, failed: errors.length > 0,
      message: [`${go.length - errors.length}건을 확정했습니다.`, ...errors, skip.length ? `건너뛴 ${skip.length}건은 하나씩 열어 확정하세요.` : ''].filter(Boolean).join(' ') });
    setChecked(new Set());
    reload();
  }
  const onCheck = useCallback((id, on) => setChecked((cur) => {
    if (cur.has(id) === on) return cur;
    const next = new Set(cur);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);

  const selRow = sel?.kind === 'draft' ? rows.find((r) => r.entry_id === sel.id) : null;
  const selBatch = sel?.kind === 'batch' ? batches.find((b) => b.key === sel.key) : null;
  const siblings = selRow ? rows.filter((r) => r.batch.key === selRow.batch.key && r.entry_id !== selRow.entry_id)
    .map((r) => ({ entry_id: r.entry_id, title: r.title })) : [];
  const filtersOn = !!(stateFilter || qSent || who !== 'all');
  const nothing = !loading && !error && rows.length === 0 && groups.length === 0;
  // 좁은 화면: 고친 채 저장하지 않은 초안이 열려 있으면 창을 좁혀도 상세를 내리지 않는다(내리면 고친 값이 사라진다)
  const detailOpen = !!sel && (narrowDetail || (sel.kind === 'draft' && dirtyId === sel.id));
  const showList = wide || !detailOpen;
  const showDetail = wide || detailOpen;

  const detail = sel?.kind === 'draft' ? (
    <DraftDetail ref={detailRef} entryId={sel.id} siblings={siblings} batchName={selRow?.batch.name}
                 onShowBatch={selRow && batches.some((b) => b.key === selRow.batch.key) ? () => select({ kind: 'batch', key: selRow.batch.key }) : null}
                 onBack={wide ? null : backToList} onChanged={reload} onDirtyChange={onDirtyChange} onConfirmed={onConfirmed}
                 onGone={reload} />
  ) : selBatch ? (
    <div className="flex flex-col gap-3">
      {!wide && <div><button type="button" onClick={backToList} className="text-ui text-brand hover:underline">목록으로</button></div>}
      <BatchCard batch={selBatch} me={user.employee_id} isAdmin={isAdmin} canWrite={canWrite} onChanged={reload} onClaim={claim}
                 onDirtyChange={onDirtyChange} dirtyIds={new Set()} onConfirmed={onConfirmed} />
    </div>
  ) : null;

  return (
    <Page wide>
      {dialog}
      {canWrite && <PageDropOverlay u={uploader} />}
      <PageHeader title="올리기와 확정"
        description={canWrite
          ? '올린 자료의 초안을 왼쪽 목록에서 골라 확인하고 확정하세요. 확정 전에도 검색에는 미분류로 보입니다. 이 화면에 폴더를 끌어 놓으면 새로 올리고, 목록의 초안 줄에 놓으면 그 초안에 첨부합니다.'
          : READ_ONLY_REASON}
        actions={canWrite ? <UploadButtons u={uploader} /> : null} />
      {/* 52 — 올리는 중·멈춤은 화면 가운데 카드로(어디까지 왔는지 바로 보이게), 끝난 결과는 이 자리에 */}
      {canWrite && (uploader.busy || uploader.resumable) && (
        <UploadCenterStack><UploadCenterCard u={uploader} title="올리기" /></UploadCenterStack>
      )}
      {canWrite && !uploader.busy && !uploader.resumable && <div className="mb-4 empty:hidden"><UploadFeedback u={uploader} /></div>}
      {/* 62 — 이 창이 아닌 곳(다른 탭·PC, 닫은 창)에서 보내는 중인 묶음 — 목록에는 다 보낸 뒤에야 나타난다 */}
      {canWrite && elsewhere > 0 && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-ui text-n-700">
          <Spinner size={12} className="shrink-0 text-n-500" />
          <span>다른 창(또는 다른 PC)에서 올리는 중인 묶음이 <span className="font-mono">{elsewhere}</span>개 있습니다. 다 보내면 아래에 나타납니다.
            창을 닫아 멈춘 올리기는 하루 안에 자동으로 지워지니, 그때는 다시 올려 주세요.</span>
        </p>
      )}
      <Tabs label="올린 자료 구분" items={TABS} value={tab} onChange={changeTab} controls={PANEL_ID} />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="pt-5">
        {isFix && <FixList />}
        {!isFix && error && <ErrorNote className="mb-4">{error}</ErrorNote>}
        {!isFix && loading && <BlockSkeleton className="h-32" />}
        {!isFix && nothing && !filtersOn && (
          <EmptyState icon={Inbox} title="정리할 자료가 없습니다">
            {tab === 'mine' && !canWrite
              ? '올린 자료가 없습니다.'
              : tab === 'mine'
              ? <>폴더나 파일을 이 화면에 끌어 놓거나 위의 단추로 고르세요. 탐색기로 <span className="font-mono">999_LogBook\00_Inbox</span> 에 복사하면 1~2분 뒤 여기에 나타납니다.</>
              : '폴더에 직접 넣은 묶음이 없습니다.'}
          </EmptyState>
        )}
        {!isFix && !loading && (!nothing || filtersOn || settled.length > 0) && (
          <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
            {showList && (
              <aside aria-label="초안 목록과 거르기"
                     className="min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:max-h-[calc(100vh-2rem)] min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
                <InboxList groups={groups} settled={settled} counts={counts} total={flat.length}
                           stateFilter={stateFilter} onState={setStateFilter} q={q} onQ={setQ}
                           who={who} onWho={tab === 'mine' ? setWho : null}
                           sel={sel} onSelect={select} checked={checked} onCheck={onCheck} onClearChecks={() => setChecked(new Set())}
                           onBulk={runBulk} bulkBusy={bulk.busy} canWrite={canWrite} onClaim={claim} drop={drop} dragging={dragging}>
                  {bulk.message && (
                    <p role={bulk.failed ? 'alert' : 'status'}
                       className={`rounded-md px-3 py-2 text-ui ${bulk.failed ? 'border border-wait-line bg-wait-bg text-wait' : 'border border-n-200 bg-n-0 text-n-800'}`}>{bulk.message}</p>
                  )}
                  {dropNote && <p role="status" className="text-meta text-wait">{dropNote}</p>}
                  {groups.length === 0 && filtersOn && <p className="px-1 py-6 text-center text-ui text-n-600">조건에 맞는 초안이 없습니다.</p>}
                </InboxList>
              </aside>
            )}
            {showDetail && (
              <section aria-label="고른 초안" className="min-w-0">
                {detail || (
                  <p className="rounded-lg border border-dashed border-n-200 px-4 py-10 text-center text-ui text-n-600">
                    왼쪽 목록에서 초안이나 묶음을 고르세요.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
