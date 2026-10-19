import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Copy, FileQuestion, Folder, Link2, Lock, MoreHorizontal, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import FilePreview from '../components/preview/FilePreview.jsx';
import { SendToWorkbenchButton } from '../components/workbench/WorkbenchSend.jsx';
import { SameModelNotice, sameInfo } from '../components/preview/SameModel.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import { DuplicateTargets } from '../components/inbox/DuplicateBlocked.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import ChipInput from '../components/ui/ChipInput.jsx';
import VocabInput from '../components/ui/VocabInput.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useConfirm } from '../components/ui/ConfirmDialog.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import Menu from '../components/ui/Menu.jsx';
import { FavoriteToggle } from '../components/favorites/Favorites.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { ErrorNote, Page, SectionTitle } from '../components/ui/Page.jsx';
import { Bar } from '../components/ui/Skeleton.jsx';
import { FilterLink, StatusDot, TagLink } from '../components/ui/Status.jsx';
import { filterHref } from '../lib/search.js';
import { useToast } from '../components/ui/Toast.jsx';
import { copyText } from '../lib/files.js';
import { ACTION_LABELS, errorText, formatBytes, formatDateTime } from '../lib/labels.js';
import { buildTree } from '../lib/tree.js';
import { useEntry } from '../lib/useEntry.js';
import { useAddFilesWatch } from '../lib/useAddFilesWatch.js';
import { changedFields, editErrors, editValues, patchBody, sameEditable } from '../lib/entryEdit.js';
import { useUnsavedGuard } from '../lib/useUnsavedGuard.js';
import AccessPanel, { AccessBadge } from '../components/access/AccessPanel.jsx';
import { canWriteLevel } from '../lib/levels.js';
import RevisionSection from '../components/revisions/RevisionSection.jsx';
import HullPlmLookup from '../components/hull/HullPlmLookup.jsx';
import NeedsFixBadge from '../components/ui/NeedsFixBadge.jsx';

// 15 — 해석 시기는 없앴다(옛 이력의 해석 시기 변경 줄은 보이지 않는다)
// 21 — 프로젝트(있을 때만 기록). 29 — 칸은 없앴지만 옛 이력 줄을 읽을 수 있게 이름은 남긴다
const FIELD_LABELS = { title: '제목', analysis_type: '해석 종류', description: '설명',
  hulls: '호선', no_hull: '호선 없음(공용)', project: '프로젝트', zones: '구역', tags: '태그' };
// 감사 기록에서 '참/값일 때만' 실리는 칸 — before 에만 있으면 지운 것이다
const OPTIONAL_KEYS = new Set(['no_hull', 'project']);
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';
const show = (v) => (v === true ? '예' : (Array.isArray(v) ? v.join(', ') : v) || '(없음)');
const HISTORY_FILES_SHOWN = 5;
const HISTORY_SHOWN = 5;

/** 감사 기록의 before/after → "제목: a → b" 줄들. */
function changes(before, after) {
  if (!before || !after) return [];
  return Object.keys(FIELD_LABELS)
    // 20 — no_hull 은 참일 때만 기록된다(풀면 after 에서 빠진다)
    .filter((k) => (k in after || (OPTIONAL_KEYS.has(k) && k in before)) && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
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
  // 14 — 판 정리: 계열마다 '판 이름 파일 → …'
  if (r.action === 'ENTRY_REVISIONS') {
    if (r.after?.auto) return ['자동 추정으로 되돌림'];
    const series = r.after?.series || [];
    if (!series.length) return ['묶인 판 없음'];
    return series.map((s) => s.files.join(' → ') + (s.latest ? ` (최신 ${s.latest})` : ''));
  }
  // 21 — 문서 분류·모델 연결(문서 화면에서 바꾼 것). 23 — 저장 전 확장자 추정값(발표자료)이었으면 '자동 발표자료'
  if (r.action === 'REPORT_META') {
    const before = r.before?.document_type || (r.before?.document_type_auto ? `자동 ${r.before.document_type_auto}` : '미분류');
    return [`${r.after?.report}: 문서 분류 ${before} → ${r.after?.document_type || '미분류'}`];
  }
  if (r.action === 'REPORT_LINKS') {
    const before = r.before?.models || [];
    const after = r.after?.models || [];
    const added = after.filter((m) => !before.includes(m));
    const removed = before.filter((m) => !after.includes(m));
    return [`${r.after?.report}: 사용한 모델` + (added.length ? ` 연결 ${added.join(', ')}` : '')
      + (removed.length ? ` 해제 ${removed.join(', ')}` : '')];
  }
  // 13·15 — 공개 범위 변경·열람 허락
  if (r.action === 'ENTRY_ACCESS') return [`${accessText(r.before)} → ${accessText(r.after)}`];
  if (r.action === 'ENTRY_GRANT' || r.action === 'ENTRY_REVOKE') {
    const who = (r.after || r.before)?.employee_id;
    if (!who) return [];
    return [r.subject_name ? `${r.subject_name} (${who})` : who];   // 서버가 대상 이름을 실어 준다
  }
  return changes(r.before, r.after);
}

// 15 — 공유·일반·블록. 13 이전 기록(public/private)도 읽는다
const ACCESS_TEXT = { shared: '공유', normal: '일반', blocked: '블록', public: '공개(옛 기록)' };
function accessText(v) {
  if (!v) return '일반';
  if (v.access === 'private') return v.private_min_role === 'admin' ? '비공개 · 관리자 이상(옛 기록)' : '비공개(옛 기록)';
  return ACCESS_TEXT[v.access] || '일반';
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
function TreeNodes({ nodes, selectedId, onPick, entryId, depth = 0 }) {
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
      {sameInfo(n.file.model)?.sameTotal > 0 && (
        <span title="동일 BDF 가 이미 있음" className="inline-flex shrink-0 items-center gap-0.5 rounded-xs bg-wait-bg px-1 text-micro font-medium text-wait">
          <Copy size={10} aria-hidden="true" />동일
        </span>
      )}
      <span className="shrink-0 font-mono text-meta text-n-500">{formatBytes(n.file.size)}</span>
      {/* 18 — WorkBench 가 연 창에서만 보인다 */}
      <SendToWorkbenchButton file={n.file} entryId={entryId} compact stop />
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
      {!closed[n.path] && <ul role="group"><TreeNodes nodes={n.children} selectedId={selectedId} onPick={onPick} entryId={entryId} depth={depth + 1} /></ul>}
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

function useHistory(entryId, reloadKey) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; // 늦게 온 옛 이력은 버린다
    api(`/entries/${encodeURIComponent(entryId)}/history`)
      .then((r) => { if (live) { setRows(r); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [entryId, reloadKey]);
  return { rows, failed };
}

/** [파일 추가] 뒤 진행 — 워커가 파일을 확인해 이 자료에 붙일 때까지. */
function AddFilesStatus({ watch }) {
  const { state, excluded = 0, message, workerDown, duplicates = [] } = watch;
  if (state === 'idle') return null;
  // 17 — 서버가 이어서 확인한(큰 파일 등) 완전 동일 BDF 는 추가하지 않았다
  const dupNote = duplicates.length > 0 && (state === 'done' || state === 'inbox') ? (
    <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-n-200 bg-n-50 px-3 py-2 text-meta text-n-700">
      <p className="font-semibold text-n-900">올리지 않음: 동일 BDF 가 이미 있음 <span className="font-mono font-normal text-n-600">{duplicates.length}</span></p>
      {duplicates.map((d) => (
        <div key={d.name} className="flex min-w-0 flex-col gap-0.5">
          <p className="break-all font-medium text-n-900">{d.name}</p>
          <DuplicateTargets item={d} />
        </div>
      ))}
    </div>
  ) : null;
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
  if (state === 'done') {
    return (
      <>
        <p role="status" className="mt-2 text-meta text-ok">
          {duplicates.length > 0 ? '파일 확인을 마쳤습니다. 동일 BDF 가 아닌 파일은 이 자료에 추가했습니다.' : '파일을 이 자료에 추가했습니다.'}{skipped}
        </p>
        {dupNote}
      </>
    );
  }
  if (state === 'inbox') {
    return (
      <>
        <p role="status" className="mt-2 text-meta text-wait">
          이 자료에 바로 붙이지 못해 정리 대기에 두었습니다.{skipped} <Link to="/inbox" className="underline underline-offset-2">정리 대기로</Link>
        </p>
        {dupNote}
      </>
    );
  }
  if (state === 'slow') {
    return <p role="status" className="mt-2 text-meta text-wait">처리가 오래 걸리고 있습니다. 잠시 뒤 새로 고쳐 확인해 주세요.</p>;
  }
  return <p role="alert" className="mt-2 text-meta text-err">{message}</p>;
}

/** 고친 칸 표시 — 작은 남색 점(색만으로 알리지 않게 화면 읽기용 글자를 함께 둔다). */
function ChangedMark() {
  return (
    <span title="바뀐 칸" className="inline-flex items-center">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className="sr-only">(변경됨)</span>
    </span>
  );
}

/** 속성 레일 한 줄. 고치는 중이면 바뀐 칸에 점, 잘못된 값이면 아래에 안내. */
function Prop({ label, changed = false, error, children }) {
  return (
    <>
      <dt className="flex h-8 items-center gap-1.5 text-meta text-n-500">{label}{changed && <ChangedMark />}</dt>
      <dd className="flex min-h-8 min-w-0 flex-col justify-center text-ui text-n-900">
        {children}
        {error && <span role="alert" className="mt-1 text-meta text-err">{error}</span>}
      </dd>
    </>
  );
}

const FIELD_ORDER = ['title', 'description', 'hulls', 'no_hull', 'zones', 'analysis_type', 'tags'];

/** Entry 상세(설계 §6.1 `/e/{entryId}`) — 머리, 파일·미리보기, 속성 레일과 변경 이력. */
export default function EntryPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const fileParam = Number(params.get('file')) || null; // 검색의 파일 결과에서 왔으면 그 파일부터 본다
  const navigate = useNavigate();
  const storage = useOutletContext()?.storage;
  const { user } = useAuth();
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const { entry, status, error, setError, commit, reload } = useEntry(entryId);
  const adder = useAddFilesWatch({ onMerged: () => { reload().catch(() => {}); } });
  // 열람 허락 주기·회수는 Entry version 을 올리지 않는다 — 허락 명단도 이력 다시 읽기 기준에 넣는다(13)
  // 14 — 판 정리도 version 을 올리지 않는다(이력 한 줄) — 저장 횟수(revSaved)를 기준에 넣는다
  const [revSaved, setRevSaved] = useState(0);
  const [revEditing, setRevEditing] = useState(false);
  const historyKey = `${entry?.version}|${(entry?.grants || []).map((g) => g.employee_id).join(',')}|${revSaved}`;
  const history = useHistory(entryId, historyKey);
  const [picked, setPicked] = useState(fileParam);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  // 11 — 고치기: [변경하기] 로 열고 [변경 완료] 에 바뀐 칸 전부를 한 번에 저장한다(칸마다 바로 저장하지 않는다)
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(null);          // 고치기 시작할 때의 값(바뀐 칸을 가린다)
  const [draft, setDraft] = useState(null);        // 고치는 값
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false); // 다른 사람이 먼저 고쳐 저장하지 못했다
  const baseEntryRef = useRef(null);
  const titleRef = useRef(null);

  function stopEditing() {
    setEditing(false); setBase(null); setDraft(null); setConflict(false); setSaving(false);
  }

  useEffect(() => {
    stopEditing();
    setPicked(fileParam); setAdding(false); setNotice(''); adder.reset();
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 고치는 동안 파일 추가 등으로 Entry 를 다시 불러왔다 — 고칠 칸의 서버 값이 그대로면 새 version 으로 갈아탄다
  useEffect(() => {
    if (!editing || !entry || entry.version === editVersion) return;
    if (sameEditable(baseEntryRef.current, entry)) {
      baseEntryRef.current = entry;
      setEditVersion(entry.version);
    }
  }, [entry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editing) titleRef.current?.focus(); }, [editing]);

  const changed = editing && draft ? changedFields(base, draft) : [];
  const dirty = changed.length > 0;
  const errors = editing && draft ? editErrors(draft) : {};
  const invalid = Object.keys(errors).length > 0;
  useUnsavedGuard(editing && dirty, confirm);

  // 단축키 — Ctrl+Enter 완료, Esc 취소(목록·대화상자 안의 Esc 는 그쪽 몫). 최신 함수를 ref 로 부른다
  const keysRef = useRef({});
  keysRef.current = { finish, cancel };
  useEffect(() => {
    if (!editing) return undefined;
    function onKey(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); keysRef.current.finish(); return; }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && t.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
      e.preventDefault();
      keysRef.current.cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

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

  // 13 — 확정 자료는 올린 사람 또는 관리자 이상이 고친다(서버 can_edit). Guest 는 보기만.
  // 미확정은 정리 대기에서, 휴지통은 복원 뒤에 고친다.
  const canWrite = canWriteLevel(user);
  const editable = entry.status === 'confirmed' && canWrite && entry.can_edit !== false;
  const readOnlyNote = entry.status === 'confirmed' && !editable
    ? '올린 사람·관리자(LV3)만 고칠 수 있습니다.' : '';
  const trashed = entry.status === 'trashed';
  const offline = storage?.reachable === false;
  const file = entry.files.find((f) => f.id === picked) || entry.files.find((f) => f.kind === 'report') || entry.files[0];
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const isChanged = (k) => changed.includes(k);

  // 사번 → 이름: 이 화면이 이미 받은 자료(변경 이력의 이름, 로그인한 나)에서만 찾는다.
  const names = new Map((history.rows || []).filter((r) => r.name).map((r) => [r.employee_id, r.name]));
  if (user?.employee_id && user?.name) names.set(user.employee_id, user.name);
  const person = (id) => (id ? <span title={id}>{names.get(id) || <span className="font-mono">{id}</span>}</span> : <span className="text-n-500">—</span>);

  function startEdit() {
    const v = editValues(entry);
    baseEntryRef.current = entry;
    setBase(v); setDraft(v); setEditVersion(entry.version); setConflict(false); setError('');
    setEditing(true);
  }
  /** [변경 완료] — 바뀐 칸 전부를 한 번의 PATCH 로(이력도 한 줄). 저장되면 읽기 화면으로 돌아간다. */
  async function finish() {
    if (!editing || !dirty || invalid || saving) return;
    setSaving(true); setError('');
    try {
      await commit(patchBody(base, draft), editVersion);
      stopEditing();
      toast.show({ message: '변경을 저장했습니다.' });
    } catch (err) {
      setSaving(false);
      if (err?.detail === 'version_conflict') setConflict(true);
      else setError(errorText(err, '저장하지 못했습니다.'));
    }
  }
  /** [취소] — 고친 것이 있으면 버릴지 묻는다. */
  async function cancel() {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({ title: '고친 내용을 버릴까요?', body: `저장하지 않은 변경 ${changed.length}칸이 사라집니다.`,
                                 confirmLabel: '버리기', cancelLabel: '계속 고치기' });
      if (!ok) return;
    }
    stopEditing(); setError('');
  }
  /** 충돌 — 최신 내용을 불러와 그 위에 내 변경(바뀐 칸)을 다시 얹는다. 확인한 뒤 다시 [변경 완료]. */
  async function rebase() {
    let fresh;
    try { fresh = await reload(); } catch (err) { setError(errorText(err, '자료를 불러오지 못했습니다.')); return; }
    if (!fresh) return;
    const nextBase = editValues(fresh);
    const mine = changedFields(base, draft);
    setBase(nextBase);
    setDraft({ ...nextBase, ...Object.fromEntries(mine.map((k) => [k, draft[k]])) });
    baseEntryRef.current = fresh;
    setEditVersion(fresh.version);
    setConflict(false);
  }
  async function discardAndReload() {
    stopEditing();
    await reload().catch(() => {});
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
    ...(editable && !editing ? [{ divider: true }, { label: '휴지통으로 보내기', icon: Trash2, tone: 'danger', onSelect: onTrash }] : []),
  ];
  const changedLabels = FIELD_ORDER.filter((k) => changed.includes(k)).map((k) => FIELD_LABELS[k]);

  return (
    <Page>
      {dialog}
      {editing && (
        // 고치는 중 — 화면을 내려도 완료·취소가 보이게 위에 붙는다
        <div role="region" aria-label="고치기" className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-n-200 bg-n-0 px-6 py-2 min-[1441px]:-mx-8 min-[1441px]:px-8">
          <span className="flex items-center gap-1.5 text-ui font-semibold text-n-900"><Pencil size={14} aria-hidden="true" className="text-n-500" />고치는 중</span>
          <span role="status" className="min-w-0 truncate text-meta text-n-600">
            {dirty ? <>바뀐 칸 <span className="font-mono">{changed.length}</span> · {changedLabels.join(', ')}</> : '바뀐 칸이 없습니다'}
          </span>
          <span className="ml-auto hidden whitespace-nowrap text-meta text-n-500 lg:inline">
            <kbd className="rounded-sm bg-n-50 px-1 font-mono text-micro text-n-600">Ctrl+Enter</kbd> 완료 ·
            {' '}<kbd className="rounded-sm bg-n-50 px-1 font-mono text-micro text-n-600">Esc</kbd> 취소
          </span>
          <Button variant="ghost" size="sm" onClick={cancel} disabled={saving} className="max-lg:ml-auto">취소</Button>
          <Button size="sm" onClick={finish} loading={saving} disabled={!dirty || invalid || conflict}
                  title={invalid ? '고칠 칸을 확인해 주세요' : !dirty ? '바뀐 칸이 없습니다' : undefined}>
            <Check size={14} aria-hidden="true" />변경 완료
          </Button>
        </div>
      )}
      <header className="border-b border-n-200 pb-5">
        <div className="flex h-7 items-center gap-3">
          <span className="font-mono text-meta text-n-500">{entry.entry_id}</span>
          <StatusDot status={entry.status} />
          {/* 13 — 비공개 자료(볼 수 있는 사람에게만 보인다) */}
          <AccessBadge item={entry} />
          {/* 20 — 확정 BDF 자료에 필수 분류가 빠짐(올린 사람·LV3 에게만 서버가 싣는다) */}
          {entry.needs_fix?.length > 0 && <NeedsFixBadge missing={entry.needs_fix} />}
          <div className="flex-1" />
          {readOnlyNote && !editing && (
            <span className="inline-flex items-center gap-1 text-meta text-n-500" title={readOnlyNote} data-testid="read-only-note">
              <Lock size={12} aria-hidden="true" />올린 사람만 수정
            </span>
          )}
          {editable && !editing && (
            <Button variant="secondary" size="sm" onClick={startEdit} disabled={revEditing}
                    title={revEditing ? '판 정리를 먼저 끝내 주세요' : '제목·설명·속성을 고칩니다'}>
              <Pencil size={14} aria-hidden="true" />변경하기
            </Button>
          )}
          {/* 10 — 즐겨찾기(휴지통 자료는 복원한 뒤에) */}
          <FavoriteToggle entryId={entry.entry_id} initial={entry.favorite} disabled={trashed} />
          <Menu items={menuItems} trigger={(p) => (
            <button type="button" {...p} aria-label="자료 동작" className={buttonClass('ghost', 'icon-sm')}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )} />
        </div>
        {editing ? (
          <div className="mt-2 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-meta font-medium text-n-600">제목{isChanged('title') && <ChangedMark />}</span>
              <input ref={titleRef} aria-label="제목" value={draft.title} onChange={(e) => set('title')(e.target.value)}
                     aria-invalid={errors.title ? true : undefined} maxLength={200}
                     className={inputClass('h-10 w-full text-[18px] leading-7 font-semibold tracking-[-0.01em]')} />
              {errors.title && <span role="alert" className="text-meta text-err">{errors.title}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-meta font-medium text-n-600">설명{isChanged('description') && <ChangedMark />}</span>
              <textarea aria-label="설명" rows={3} value={draft.description} onChange={(e) => set('description')(e.target.value)}
                        placeholder="이 자료가 무엇인지 한두 줄로"
                        className={inputClass('h-auto w-full py-1.5 text-body')} />
            </label>
          </div>
        ) : (
          <>
            <h1 className="mt-1 text-entry font-semibold tracking-[-0.02em] text-n-900">{entry.title}</h1>
            <p className={`mt-1 whitespace-pre-wrap text-body ${entry.description ? 'text-n-700' : 'text-n-500'}`}>
              {entry.description || '설명 없음'}
            </p>
          </>
        )}
        {entry.status === 'draft' && (
          <p className="mt-3 rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui text-wait">
            미확정 자료는 <Link to="/inbox" className="font-medium underline underline-offset-2 hover:no-underline">정리 대기에서 고치고 확정합니다</Link>.
          </p>
        )}
        {conflict && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">
            <span className="min-w-0 flex-1">다른 사람이 그 사이 이 자료를 고쳐 저장하지 못했습니다. 최신 내용을 불러와 내 변경을 그 위에 다시 얹을 수 있습니다.</span>
            <Button variant="secondary" size="sm" onClick={rebase}><RefreshCw size={14} aria-hidden="true" />최신 내용 불러오기</Button>
            <Button variant="ghost" size="sm" onClick={discardAndReload}>내 변경 버리기</Button>
          </div>
        )}
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-8 min-[1200px]:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0">
          {/* 14 — 한 자료 안 BDF 판 흐름(R0 → R1 → R2)과 변경 요약 */}
          {entry.files.filter((f) => f.kind === 'model').length >= 2 && (
            <RevisionSection entryId={entry.entry_id} selectedId={file?.id} onPick={setPicked} locked={editing}
                             onEditingChange={setRevEditing} onSaved={() => setRevSaved((n) => n + 1)} />
          )}
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
              <UploadZone targetEntryId={entry.entry_id} disabled={offline} showSuccess={false} scope={`entry:${entry.entry_id}`}
                          away={{ title: `${entry.entry_id} 파일 추가`, message: '파일을 올렸습니다. 자료에 추가되는 대로 파일 목록에 나타납니다.',
                            to: `/e/${entry.entry_id}`, label: '자료 열기' }}
                          onUploaded={(key) => adder.start(key)} />
              <AddFilesStatus watch={adder.watch} />
              {notice && <p role="status" className="mt-2 text-meta text-ok">{notice}</p>}
            </div>
          )}
          <ul role="tree" aria-label="파일" onKeyDown={onTreeKeyDown} className="flex flex-col gap-px">
            <TreeNodes nodes={buildTree(entry.files)} selectedId={file?.id} onPick={setPicked} entryId={entry.entry_id} />
          </ul>
          <div className="mt-4">
            {file && <SameModelNotice model={file.model} />}
            {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} trashed={trashed} hideTitles={[entry.title]}
                                    hull={entry.hulls[0]?.hull_no || ''} />
              : <p className="text-ui text-n-500">파일이 없습니다.</p>}
          </div>
        </div>

        <aside aria-label="속성" className="min-w-0">
          {editing ? (
            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2">
              <Prop label="호선" changed={isChanged('hulls')} error={errors.hulls}>
                <ChipInput mono label="호선" kind="hull" values={draft.hulls} validate={hullRule}
                           onChange={(v) => setDraft((d) => ({ ...d, hulls: v, no_hull: v.length ? false : d.no_hull }))}
                           placeholder="4자리 후 Enter" />
                {/* 20 — 특정 호선이 없는 공용 모델 */}
                <label className="mt-1 inline-flex w-fit items-center gap-1.5 text-meta text-n-600">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={!!draft.no_hull}
                         onChange={(e) => { const on = e.target.checked; setDraft((d) => ({ ...d, no_hull: on, hulls: on ? [] : d.hulls })); }} />
                  호선 없음(공용){isChanged('no_hull') && <ChangedMark />}
                </label>
                {/* 30 — 입력한 호선의 PLM 선박 정보(보여 주기만) */}
                <HullPlmLookup hulls={draft.hulls} />
              </Prop>
              <Prop label="구역" changed={isChanged('zones')}>
                <VocabInput multiple kind="zone" label="구역" values={draft.zones} onChange={set('zones')} />
              </Prop>
              <Prop label="해석 종류" changed={isChanged('analysis_type')}>
                <VocabInput kind="atype" label="해석 종류" value={draft.analysis_type || null} onChange={(v) => set('analysis_type')(v || '')} />
              </Prop>
              <Prop label="태그" changed={isChanged('tags')}>
                <ChipInput label="태그" kind="tag" values={draft.tags} onChange={set('tags')} />
              </Prop>
              <Prop label="올린 사람">
                {entry.uploaded_by ? <FilterLink field="uploaded_by" value={entry.uploaded_by}>{person(entry.uploaded_by)}</FilterLink> : person(null)}
              </Prop>
            </dl>
          ) : (
            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3">
              <Prop label="호선">
                <ChipInput compact disabled mono label="호선" kind="hull" values={entry.hulls.map((h) => h.hull_no)}
                           chipHref={(h) => `/h/${encodeURIComponent(h)}`} onChange={() => {}} />
                {entry.no_hull && entry.hulls.length === 0 && (
                  <span className="text-meta text-n-600">공용(호선 없음)</span>
                )}
              </Prop>
              <Prop label="구역">
                <VocabInput compact disabled multiple kind="zone" label="구역" values={entry.zones} onChange={() => {}}
                            valueHref={(v) => filterHref('zone', v)} />
              </Prop>
              <Prop label="해석 종류">
                <VocabInput compact disabled kind="atype" label="해석 종류" value={entry.analysis_type} onChange={() => {}}
                            valueHref={(v) => filterHref('analysis_type', v)} />
              </Prop>
              <Prop label="태그">
                {entry.tags.length ? <span className="flex flex-wrap gap-1">{entry.tags.map((t) => <TagLink key={t} tag={t} />)}</span>
                  : <span className="text-n-500">—</span>}
              </Prop>
              <Prop label="올린 사람">
                {entry.uploaded_by ? <FilterLink field="uploaded_by" value={entry.uploaded_by}>{person(entry.uploaded_by)}</FilterLink> : person(null)}
              </Prop>
              <Prop label="확정자">
                {entry.confirmed_by ? (
                  <span className="min-w-0 truncate">{person(entry.confirmed_by)}
                    {/* 15 — 올린 날짜(확정일)는 여기·미리보기·결과 행 오른쪽에 보인다 */}
                    <span className="ml-1.5 font-mono text-meta text-n-500" title={formatDateTime(entry.confirmed_at)}>{formatDateTime(entry.confirmed_at).slice(0, 10)}</span>
                  </span>
                ) : <span className="text-n-500">—</span>}
              </Prop>
            </dl>
          )}
          {/* 13 — 공개 범위(변경하기와 분리: 확인 후 바로 적용, 이력에 따로 남는다) */}
          {entry.status !== 'trashed' && (
            <AccessPanel entry={entry} disabled={editing} onChanged={() => reload().catch(() => {})} />
          )}
          <History rows={history.rows} failed={history.failed} />
        </aside>
      </div>
    </Page>
  );
}
