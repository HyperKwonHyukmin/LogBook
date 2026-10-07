import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, FileQuestion, Folder, Link2, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import FilePreview from '../components/preview/FilePreview.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import ChipInput from '../components/ui/ChipInput.jsx';
import VocabInput from '../components/ui/VocabInput.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import Menu from '../components/ui/Menu.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { ErrorNote, Page, SectionTitle } from '../components/ui/Page.jsx';
import { Bar } from '../components/ui/Skeleton.jsx';
import { StatusDot, TagLink, tagHref } from '../components/ui/Status.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { copyText } from '../lib/files.js';
import { ACTION_LABELS, errorText, formatBytes, formatDateTime } from '../lib/labels.js';
import { buildTree } from '../lib/tree.js';
import { useEntry } from '../lib/useEntry.js';
import { useAddFilesWatch } from '../lib/useAddFilesWatch.js';

const FIELD_LABELS = { title: '제목', analysis_type: '해석 종류', analysis_period: '해석 시기', description: '설명',
  hulls: '호선', zones: '구역', tags: '태그' };
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';
const periodRule = (v) => (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? '해석 시기는 YYYY-MM 형식입니다.' : '');
const show = (v) => (Array.isArray(v) ? v.join(', ') : v) || '(없음)';
const HISTORY_FILES_SHOWN = 5;
const HISTORY_SHOWN = 5;

/** 감사 기록의 before/after → "제목: a → b" 줄들. */
function changes(before, after) {
  if (!before || !after) return [];
  return Object.keys(FIELD_LABELS)
    .filter((k) => k in after && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => `${FIELD_LABELS[k]}: ${show(before[k])} → ${show(after[k])}`);
}

/** 이력 한 줄의 자세한 내용 — 파일 추가는 파일 이름, 확정은 파일 수, 수정은 바뀐 칸. */
function detailLines(r) {
  const files = r.after?.files;
  if (r.action === 'ENTRY_FILES_ADDED' && Array.isArray(files)) {
    const more = files.length - HISTORY_FILES_SHOWN;
    return [files.slice(0, HISTORY_FILES_SHOWN).join(', ') + (more > 0 ? ` 외 ${more}개` : '')];
  }
  if (r.action === 'ENTRY_CONFIRM') return typeof files === 'number' ? [`파일 ${files}개`] : [];
  return changes(r.before, r.after);
}

/** 트리에서 ↑/↓ 로 보이는 항목 사이를 옮겨 다닌다(접힌 폴더의 속은 그려지지 않아 건너뛴다). */
function onTreeKeyDown(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  const items = [...e.currentTarget.querySelectorAll('[role="treeitem"]')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = { ArrowDown: Math.min(items.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: items.length - 1 }[e.key];
  items[next]?.focus();
}

const activate = (fn) => (e) => {
  if (e.target !== e.currentTarget) return; // 안쪽 항목의 키는 그 항목이 처리한다
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};

/**
 * 파일 트리 한 층. 재귀 컴포넌트라 층마다 접힘 상태가 따로 있다(의도된 동작).
 * 로빙 tabindex — 고른 파일만 0, 나머지는 -1 이라 Tab 한 번으로 트리에 들어온다.
 */
function TreeNodes({ nodes, selectedId, onPick, depth = 0 }) {
  const [closed, setClosed] = useState({});
  const toggle = (path) => setClosed((c) => ({ ...c, [path]: !c[path] }));
  return nodes.map((n) => (n.file ? (
    <li key={n.path} role="treeitem" aria-selected={n.file.id === selectedId} aria-label={n.name}
        tabIndex={n.file.id === selectedId ? 0 : -1}
        onClick={() => onPick(n.file.id)} onKeyDown={activate(() => onPick(n.file.id))}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={`flex h-8 cursor-pointer items-center gap-2 rounded-md pr-2 text-ui outline-none transition-colors duration-150 ease-out
          focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring
          ${n.file.id === selectedId ? 'bg-brand-subtle text-brand' : 'text-n-800 hover:bg-n-100 active:bg-n-150'}`}>
      <KindBadge kind={n.file.kind} name={n.name} />
      <span className={`min-w-0 flex-1 truncate ${n.file.id === selectedId ? 'font-medium' : ''}`} title={n.file.rel_path}>{n.name}</span>
      <span className="shrink-0 font-mono text-meta text-n-500">{formatBytes(n.file.size)}</span>
    </li>
  ) : (
    <li key={n.path} role="treeitem" aria-expanded={!closed[n.path]} aria-label={n.name} tabIndex={-1}
        onKeyDown={activate(() => toggle(n.path))}
        className="rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ring">
      <div onClick={() => toggle(n.path)} style={{ paddingLeft: depth * 12 + 4 }}
           className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md text-ui text-n-700 transition-colors duration-150 hover:bg-n-100">
        {closed[n.path] ? <ChevronRight size={14} className="text-n-400" aria-hidden="true" /> : <ChevronDown size={14} className="text-n-400" aria-hidden="true" />}
        <Folder size={14} className="text-n-400" aria-hidden="true" />{n.name}
      </div>
      {!closed[n.path] && <ul role="group"><TreeNodes nodes={n.children} selectedId={selectedId} onPick={onPick} depth={depth + 1} /></ul>}
    </li>
  )));
}

/** 변경 이력 — 점 타임라인(세로 띠 없이, 점 사이만 가는 선으로 잇는다). */
function History({ rows, failed }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows?.slice(0, HISTORY_SHOWN);
  return (
    <section className="mt-6 border-t border-n-200 pt-5">
      <SectionTitle className="mb-3">변경 이력</SectionTitle>
      <ul aria-label="변경 이력" className="flex flex-col">
        {failed && !rows && <li className="text-meta text-err">이력을 불러오지 못했습니다.</li>}
        {!failed && !rows && <li aria-hidden="true" className="appear-late space-y-2"><Bar className="h-3 w-3/4" /><Bar className="h-3 w-1/2" /></li>}
        {rows?.length === 0 && <li className="text-meta text-n-500">기록이 없습니다.</li>}
        {shown?.map((r, i) => (
          <li key={i} className="relative grid grid-cols-[12px_1fr] gap-x-2 pb-4 last:pb-0">
            {i < shown.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[5.5px] top-[14px] w-px bg-n-200" />}
            <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 justify-self-center rounded-full ${i === 0 ? 'bg-n-600' : 'bg-n-300'}`} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-ui font-medium text-n-800">{ACTION_LABELS[r.action] || r.action}</span>
                <span className="min-w-0 truncate text-meta text-n-500" title={r.employee_id || undefined}>{r.name || r.employee_id || '시스템'}</span>
                <span className="ml-auto shrink-0 font-mono text-meta text-n-500">{formatDateTime(r.at).slice(5)}</span>
              </div>
              {detailLines(r).map((c) => <div key={c} className="mt-0.5 text-meta text-n-600">{c}</div>)}
            </div>
          </li>
        ))}
      </ul>
      {rows?.length > HISTORY_SHOWN && (
        <button type="button" onClick={() => setAll(!all)}
                className="mt-2 h-6 rounded-sm px-1 text-meta text-n-600 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">
          {all ? '접기' : `전체 보기 ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function useHistory(entryId, version) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; // 늦게 온 옛 이력은 버린다
    api(`/entries/${encodeURIComponent(entryId)}/history`)
      .then((r) => { if (live) { setRows(r); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [entryId, version]);
  return { rows, failed };
}

/** 속성 레일 한 줄. */
/** [파일 추가] 뒤 진행 — 워커가 파일을 확인해 이 자료에 붙일 때까지. */
function AddFilesStatus({ watch }) {
  const { state, excluded = 0, message, workerDown } = watch;
  if (state === 'idle') return null;
  // 제외 = 임시·잠금 파일(~$ 등)이나 DRM 암호화 파일 — 올리기 칸이 DRM 거부 목록을 따로 보인다
  const skipped = excluded > 0 ? ` (제외된 파일 ${excluded}개)` : '';
  if (state === 'working') {
    return (
      <p role="status" className="mt-2 flex items-center gap-1.5 text-meta text-n-600">
        <Spinner size={12} />
        {workerDown ? '처리 프로그램(워커)이 꺼져 있어 기다리는 중입니다 — 관리자에게 알려 주세요.'
          : '파일을 확인하고 이 자료에 붙이는 중입니다…'}
      </p>
    );
  }
  if (state === 'done') return <p role="status" className="mt-2 text-meta text-ok">파일을 이 자료에 추가했습니다.{skipped}</p>;
  if (state === 'inbox') {
    return (
      <p role="status" className="mt-2 text-meta text-wait">
        이 자료에 바로 붙이지 못해 정리 대기에 두었습니다.{skipped} <Link to="/inbox" className="underline underline-offset-2">정리 대기로</Link>
      </p>
    );
  }
  if (state === 'slow') {
    return <p role="status" className="mt-2 text-meta text-wait">처리가 오래 걸리고 있습니다. 잠시 뒤 새로 고쳐 확인해 주세요.</p>;
  }
  return <p role="alert" className="mt-2 text-meta text-err">{message}</p>;
}

function Prop({ label, children }) {
  return (
    <>
      <dt className="flex h-8 items-center text-meta text-n-500">{label}</dt>
      <dd className="flex min-h-8 min-w-0 items-center text-ui text-n-900">{children}</dd>
    </>
  );
}

/** Entry 상세(설계 §6.1 `/e/{entryId}`) — 머리, 파일·미리보기, 속성 레일과 변경 이력. */
export default function EntryPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const fileParam = Number(params.get('file')) || null; // 검색의 파일 결과에서 왔으면 그 파일부터 본다
  const navigate = useNavigate();
  const storage = useOutletContext()?.storage;
  const { user } = useAuth();
  const toast = useToast();
  const { entry, status, error, setError, save, reload } = useEntry(entryId);
  const adder = useAddFilesWatch({ onMerged: () => { reload().catch(() => {}); } });
  const history = useHistory(entryId, entry?.version);
  const [picked, setPicked] = useState(fileParam);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  // 칩(호선·구역·태그)의 낙관적 값 — 응답을 기다리지 않고 바로 반영해, 연달아 고쳐도 앞 값이 사라지지 않게 한다.
  const [chips, setChips] = useState({});
  const pendingRef = useRef({});
  const genRef = useRef(0);

  useEffect(() => {
    genRef.current += 1;
    pendingRef.current = {};
    setChips({}); setPicked(fileParam); setAdding(false); setNotice(''); adder.reset();
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'missing') {
    return <Page><EmptyState icon={FileQuestion} title="자료를 찾을 수 없습니다">주소의 Entry 번호를 확인해 주세요.</EmptyState></Page>;
  }
  if (!entry) {
    return (
      <Page>
        {error ? <ErrorNote>{error}</ErrorNote> : (
          <div role="status" aria-label="자료를 불러오는 중" className="appear-late">
            <Bar className="h-3 w-32" /><Bar className="mt-3 h-6 w-2/3" />
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)_272px] gap-8"><Bar className="h-72" /><Bar className="h-48" /></div>
          </div>
        )}
      </Page>
    );
  }

  // 확정 자료는 누구나 고친다(설계 §8). 미확정은 정리 대기에서, 휴지통은 복원 뒤에 고친다.
  const editable = entry.status === 'confirmed';
  const trashed = entry.status === 'trashed';
  const offline = storage?.reachable === false;
  const file = entry.files.find((f) => f.id === picked) || entry.files.find((f) => f.kind === 'report') || entry.files[0];
  const field = (name, props = {}) => (
    <InlineText label={FIELD_LABELS[name]} value={entry[name]} disabled={!editable}
                onSave={(v) => save({ [name]: v || null })} {...props} />
  );
  const serverChips = { hulls: entry.hulls.map((h) => h.hull_no), zones: entry.zones, tags: entry.tags };
  const chipValues = (name) => chips[name] ?? serverChips[name];

  // 사번 → 이름: 이 화면이 이미 받은 자료(변경 이력의 이름, 로그인한 나)에서만 찾는다.
  const names = new Map((history.rows || []).filter((r) => r.name).map((r) => [r.employee_id, r.name]));
  if (user?.employee_id && user?.name) names.set(user.employee_id, user.name);
  const person = (id) => (id ? <span title={id}>{names.get(id) || <span className="font-mono">{id}</span>}</span> : <span className="text-n-500">—</span>);

  /** 칩 변경 — 화면에 바로 반영하고 그 값을 저장 줄에 세운다. 실패·충돌이면 서버 값으로 되돌린다. */
  function saveChips(name, values) {
    const gen = genRef.current;
    setChips((c) => ({ ...c, [name]: values }));
    pendingRef.current[name] = (pendingRef.current[name] || 0) + 1;
    save({ [name]: values }).then((ok) => {
      if (gen !== genRef.current) return;
      pendingRef.current[name] -= 1;
      // 마지막 저장까지 끝났거나 실패했으면 서버 값(응답으로 이미 반영됨)을 보인다.
      if (ok !== true || pendingRef.current[name] === 0) {
        setChips((c) => { const next = { ...c }; delete next[name]; return next; });
      }
    });
  }

  /** 휴지통으로 — 되돌릴 수 있는 동작이라 확인 없이 보내고, 토스트의 '되돌리기'로 복원한다. */
  async function onTrash() {
    const id = entry.entry_id;
    try {
      await api(`/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) { setError(errorText(err, '휴지통으로 보내지 못했습니다.')); return; }
    navigate('/trash');
    toast.show({
      message: `${id} 을 휴지통으로 보냈습니다.`,
      action: {
        label: '되돌리기',
        onClick: async () => {
          try {
            await api(`/entries/${encodeURIComponent(id)}/restore`, { method: 'POST' });
            navigate(`/e/${id}`);
            toast.show({ message: `${id} 을 복원했습니다.` });
          } catch (err) {
            toast.show({ tone: 'err', message: errorText(err, '복원하지 못했습니다. 휴지통에서 다시 시도해 주세요.') });
          }
        },
      },
    });
  }
  async function copy(text, what) {
    const ok = await copyText(text);
    toast.show(ok ? { message: `${what}를 복사했습니다.` } : { tone: 'err', message: '복사하지 못했습니다.' });
  }

  const menuItems = [
    { label: '링크 복사', icon: Link2, onSelect: () => copy(window.location.href, '링크') },
    ...(entry.vault_unc ? [{ label: '폴더 경로 복사', icon: Copy, onSelect: () => copy(entry.vault_unc, '폴더 경로') }] : []),
    ...(editable ? [{ divider: true }, { label: '휴지통으로 보내기', icon: Trash2, tone: 'danger', onSelect: onTrash }] : []),
  ];

  return (
    <Page>
      <header className="border-b border-n-200 pb-5">
        <div className="flex h-7 items-center gap-3">
          <span className="font-mono text-meta text-n-500">{entry.entry_id}</span>
          <StatusDot status={entry.status} />
          <div className="flex-1" />
          <Menu items={menuItems} trigger={(p) => (
            <button type="button" {...p} aria-label="자료 동작" className={buttonClass('ghost', 'icon-sm')}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )} />
        </div>
        <h1 className="mt-1 text-entry font-semibold tracking-[-0.02em] text-n-900">
          {field('title', { validate: (v) => (!v ? '제목을 입력해 주세요.' : '') })}
        </h1>
        <div className="mt-1 text-body text-n-700">
          {field('description', { multiline: true, placeholder: editable ? '설명 추가' : '설명 없음' })}
        </div>
        {entry.status === 'draft' && (
          <p className="mt-3 rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui text-wait">
            미확정 자료는 <Link to="/inbox" className="font-medium underline underline-offset-2 hover:no-underline">정리 대기에서 고치고 확정합니다</Link>.
          </p>
        )}
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-8 min-[1200px]:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0">
          <div className="mb-2 flex h-7 items-center gap-2">
            <SectionTitle>파일 <span className="font-mono font-normal text-n-500">{entry.files.length}</span></SectionTitle>
            {editable && (
              <Button variant="ghost" size="sm" onClick={() => setAdding(!adding)} aria-expanded={adding} className="ml-auto">
                <Upload size={14} aria-hidden="true" />파일 추가
              </Button>
            )}
          </div>
          {adding && editable && (
            <div className="mb-3 rounded-lg border border-n-200 p-3">
              <p className="mb-2 text-meta text-n-600">여기 올린 파일은 정리 대기를 거치지 않고 이 자료에 바로 추가됩니다.</p>
              <UploadZone targetEntryId={entry.entry_id} disabled={offline} showSuccess={false}
                          onUploaded={(key) => adder.start(key)} />
              <AddFilesStatus watch={adder.watch} />
              {notice && <p role="status" className="mt-2 text-meta text-ok">{notice}</p>}
            </div>
          )}
          <ul role="tree" aria-label="파일" onKeyDown={onTreeKeyDown} className="flex flex-col gap-px">
            <TreeNodes nodes={buildTree(entry.files)} selectedId={file?.id} onPick={setPicked} />
          </ul>
          <div className="mt-4">
            {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} trashed={trashed} hideTitles={[entry.title]}
                                    hull={entry.hulls[0]?.hull_no || ''} />
              : <p className="text-ui text-n-500">파일이 없습니다.</p>}
          </div>
        </div>

        <aside aria-label="속성" className="min-w-0">
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3">
            <Prop label="호선">
              <ChipInput compact mono label="호선" kind="hull" values={chipValues('hulls')} validate={hullRule} disabled={!editable}
                         chipHref={(h) => `/h/${encodeURIComponent(h)}`} onChange={(v) => saveChips('hulls', v)} />
            </Prop>
            <Prop label="구역">
              <VocabInput compact multiple kind="zone" label="구역" values={chipValues('zones')} disabled={!editable} onChange={(v) => saveChips('zones', v)} />
            </Prop>
            <Prop label="해석 종류">
              <VocabInput compact kind="atype" label="해석 종류" value={entry.analysis_type} disabled={!editable}
                          onChange={(v) => save({ analysis_type: v || null })} />
            </Prop>
            <Prop label="해석 시기">{field('analysis_period', { validate: periodRule, inputPlaceholder: 'YYYY-MM', mono: true })}</Prop>
            <Prop label="태그">
              {editable ? <ChipInput compact label="태그" kind="tag" values={chipValues('tags')} onChange={(v) => saveChips('tags', v)}
                                     chipHref={tagHref} />
                : entry.tags.length ? <span className="flex flex-wrap gap-1">{entry.tags.map((t) => <TagLink key={t} tag={t} />)}</span>
                  : <span className="text-n-500">—</span>}
            </Prop>
            <Prop label="올린 사람">{person(entry.uploaded_by)}</Prop>
            <Prop label="확정자">
              {entry.confirmed_by ? (
                <span className="min-w-0 truncate">{person(entry.confirmed_by)}
                  {/* 08 — 날짜는 '해석 시기' 하나로 보이고, 확정일은 여기(상세)·미리보기에서만 */}
                  <span className="ml-1.5 font-mono text-meta text-n-500" title={formatDateTime(entry.confirmed_at)}>{formatDateTime(entry.confirmed_at).slice(0, 10)}</span>
                </span>
              ) : <span className="text-n-500">—</span>}
            </Prop>
          </dl>
          <History rows={history.rows} failed={history.failed} />
        </aside>
      </div>
    </Page>
  );
}
