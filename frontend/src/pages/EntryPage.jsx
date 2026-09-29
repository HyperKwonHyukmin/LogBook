import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileQuestion, Folder, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client.js';
import FilePreview from '../components/preview/FilePreview.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import Button from '../components/ui/Button.jsx';
import ChipInput from '../components/ui/ChipInput.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import InlineText from '../components/ui/InlineText.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import { ACTION_LABELS, errorText, formatDateTime } from '../lib/labels.js';
import { buildTree } from '../lib/tree.js';
import { useEntry } from '../lib/useEntry.js';

const STATUS = { confirmed: ['확정', 'text-ok'], draft: ['미확정', 'text-wait'], trashed: ['휴지통', 'text-err'] };
const FIELD_LABELS = { title: '제목', analysis_type: '해석 종류', analysis_period: '해석 시기', description: '설명',
  hulls: '호선', zones: '구역', tags: '태그' };
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';
const periodRule = (v) => (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? '해석 시기는 YYYY-MM 형식입니다.' : '');
const show = (v) => (Array.isArray(v) ? v.join(', ') : v) || '(없음)';
const HISTORY_FILES_SHOWN = 5;

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
        style={{ paddingLeft: depth * 14 + 8 }}
        className={`flex h-7 cursor-pointer items-center gap-2 rounded-md pr-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${n.file.id === selectedId ? 'bg-brand-tint font-semibold text-brand' : 'hover:bg-zinc-100'}`}>
      <KindBadge kind={n.file.kind} name={n.name} /><span className="truncate">{n.name}</span>
    </li>
  ) : (
    <li key={n.path} role="treeitem" aria-expanded={!closed[n.path]} aria-label={n.name} tabIndex={-1}
        onKeyDown={activate(() => toggle(n.path))}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-ring">
      <div onClick={() => toggle(n.path)} style={{ paddingLeft: depth * 14 + 4 }}
           className="flex h-7 cursor-pointer items-center gap-1 rounded-md text-[13px] text-zinc-700 hover:bg-zinc-100">
        {closed[n.path] ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        <Folder size={14} className="text-zinc-400" aria-hidden="true" />{n.name}
      </div>
      {!closed[n.path] && <ul role="group"><TreeNodes nodes={n.children} selectedId={selectedId} onPick={onPick} depth={depth + 1} /></ul>}
    </li>
  )));
}

function History({ entryId, version }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; // 늦게 온 옛 이력은 버린다
    api(`/entries/${encodeURIComponent(entryId)}/history`)
      .then((r) => { if (live) { setRows(r); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [entryId, version]);
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold text-zinc-500">변경 이력</h2>
      <ul aria-label="변경 이력" className="space-y-2 text-xs">
        {failed && !rows && <li className="text-err">이력을 불러오지 못했습니다.</li>}
        {rows?.length === 0 && <li className="text-zinc-500">기록이 없습니다.</li>}
        {rows?.map((r, i) => (
          <li key={i} className="border-l-2 border-line pl-2.5">
            <div className="flex gap-2 text-zinc-500">
              <span className="font-mono">{formatDateTime(r.at)}</span><span>{r.name || r.employee_id || '시스템'}</span>
            </div>
            <div className="font-medium text-zinc-800">{ACTION_LABELS[r.action] || r.action}</div>
            {detailLines(r).map((c) => <div key={c} className="break-all text-zinc-600">{c}</div>)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Entry 상세(설계 §6.1 `/e/{entryId}`) — 인라인 수정 머리말, 파일 트리, 미리보기, 변경 이력. */
export default function EntryPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const fileParam = Number(params.get('file')) || null; // 검색의 파일 결과에서 왔으면 그 파일부터 본다
  const navigate = useNavigate();
  const storage = useOutletContext()?.storage;
  const { entry, status, error, setError, save } = useEntry(entryId);
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
    setChips({}); setPicked(fileParam); setAdding(false); setNotice('');
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'missing') return <EmptyState icon={FileQuestion} title="자료를 찾을 수 없습니다">주소의 Entry 번호를 확인해 주세요.</EmptyState>;
  if (!entry) {
    return error ? <p role="alert" className="p-6 text-[13px] text-err">{error}</p>
      : <div className="m-6 h-40 animate-pulse rounded-lg bg-zinc-200/60" />;
  }

  // 확정 자료는 누구나 고친다(설계 §8). 미확정은 정리 대기에서, 휴지통은 복원 뒤에 고친다.
  const editable = entry.status === 'confirmed';
  const trashed = entry.status === 'trashed';
  const offline = storage?.reachable === false;
  const [statusLabel, statusCls] = STATUS[entry.status] || [entry.status, ''];
  const file = entry.files.find((f) => f.id === picked) || entry.files.find((f) => f.kind === 'report') || entry.files[0];
  const field = (name, props = {}) => (
    <InlineText label={FIELD_LABELS[name]} value={entry[name]} disabled={!editable}
                onSave={(v) => save({ [name]: v || null })} {...props} />
  );
  const serverChips = { hulls: entry.hulls.map((h) => h.hull_no), zones: entry.zones, tags: entry.tags };
  const chipValues = (name) => chips[name] ?? serverChips[name];

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

  async function onTrash() {
    if (!window.confirm(`${entry.entry_id} ‘${entry.title}’ 을 휴지통으로 보낼까요? 휴지통에서 복원할 수 있습니다.`)) return;
    try {
      await api(`/entries/${encodeURIComponent(entry.entry_id)}`, { method: 'DELETE' });
      navigate('/trash');
    } catch (err) { setError(errorText(err, '휴지통으로 보내지 못했습니다.')); }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-zinc-500">{entry.entry_id}</span>
          <span className={`inline-flex items-center gap-1 font-semibold ${statusCls}`}>
            <span aria-hidden="true">●</span><span>{statusLabel}</span>
          </span>
          <div className="flex-1" />
          {editable && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setAdding(!adding)} aria-expanded={adding}>
                <Upload size={13} aria-hidden="true" />파일 추가
              </Button>
              <Button variant="danger" size="sm" onClick={onTrash}><Trash2 size={13} aria-hidden="true" />휴지통으로</Button>
            </>
          )}
        </div>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {field('title', { validate: (v) => (!v ? '제목을 입력해 주세요.' : '') })}
        </h1>
        {entry.status === 'draft' && (
          <p className="mt-2 text-[13px] text-wait">미확정 자료는 <Link to="/inbox" className="font-semibold underline">정리 대기에서 고치고 확정합니다</Link>.</p>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] text-err">{error}</p>}
        <dl className="mt-4 grid grid-cols-[88px_1fr] gap-x-4 gap-y-2 text-[13px] md:grid-cols-[88px_1fr_88px_1fr]">
          <dt className="text-zinc-500">호선</dt>
          <dd>
            {editable && <ChipInput label="호선" kind="hull" values={chipValues('hulls')} validate={hullRule}
                                    onChange={(v) => saveChips('hulls', v)} />}
            <span className="mt-1 flex flex-wrap gap-1">
              {entry.hulls.length === 0 && !editable && <span className="text-zinc-400">—</span>}
              {entry.hulls.map((h) => (
                <Link key={h.hull_no} to={`/h/${h.hull_no}`} title={h.ship_type || undefined}
                      className="rounded bg-brand-tint px-1.5 font-mono text-xs font-semibold text-brand hover:underline">{h.hull_no}</Link>
              ))}
            </span>
          </dd>
          <dt className="text-zinc-500">구역</dt>
          <dd>{editable ? <ChipInput label="구역" kind="zone" values={chipValues('zones')} onChange={(v) => saveChips('zones', v)} /> : entry.zones.join(', ') || '—'}</dd>
          <dt className="text-zinc-500">해석 종류</dt><dd>{field('analysis_type')}</dd>
          <dt className="text-zinc-500">해석 시기</dt><dd className="font-mono">{field('analysis_period', { validate: periodRule, placeholder: 'YYYY-MM' })}</dd>
          <dt className="text-zinc-500">태그</dt>
          <dd>{editable ? <ChipInput label="태그" kind="tag" values={chipValues('tags')} onChange={(v) => saveChips('tags', v)} /> : entry.tags.join(', ') || '—'}</dd>
          <dt className="text-zinc-500">올린 사람</dt>
          <dd className="font-mono text-xs text-zinc-600">{entry.uploaded_by || '—'} · 확정 {entry.confirmed_by || '—'} {formatDateTime(entry.confirmed_at)}</dd>
          <dt className="text-zinc-500">설명</dt>
          <dd className="md:col-span-3">{field('description', { multiline: true, placeholder: '설명 없음' })}</dd>
        </dl>
        {adding && editable && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs text-zinc-600">여기 올린 파일은 정리 대기에서 확정하면 이 자료에 추가됩니다.</p>
            <UploadZone targetEntryId={entry.entry_id} disabled={offline} showSuccess={false}
                        onUploaded={() => setNotice('올렸습니다. 정리 대기에서 확정하면 이 자료에 추가됩니다.')} />
            {notice && <p role="status" className="mt-2 text-xs text-ok">{notice} <Link to="/inbox" className="underline">정리 대기로</Link></p>}
          </div>
        )}
      </header>

      <div className="mt-5 flex gap-5">
        <div className="w-80 shrink-0">
          <h2 className="mb-2 text-xs font-semibold text-zinc-500">파일 <span className="font-mono">{entry.files.length}</span>개</h2>
          <ul role="tree" aria-label="파일" onKeyDown={onTreeKeyDown} className="rounded-lg border border-line bg-white p-1.5">
            <TreeNodes nodes={buildTree(entry.files)} selectedId={file?.id} onPick={setPicked} />
          </ul>
          <History entryId={entry.entry_id} version={entry.version} />
        </div>
        <div className="min-w-0 flex-1">
          {file ? <FilePreview key={file.id} file={file} vaultUnc={entry.vault_unc} trashed={trashed} />
            : <p className="text-[13px] text-zinc-500">파일이 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}
