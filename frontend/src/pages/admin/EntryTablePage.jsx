import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { inputClass, selectClass } from '../../components/ui/Field.jsx';
import { ErrorNote, OkNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import BulkClassifyDialog, { bulkDoneText } from '../../components/search/BulkClassifyDialog.jsx';
import VocabInput from '../../components/ui/VocabInput.jsx';
import AssigneeInput from '../../components/people/AssigneeInput.jsx';
import { errorText } from '../../lib/labels.js';

const th = 'sticky top-0 z-[1] h-9 border-b border-n-200 bg-n-50 px-2 text-left text-meta font-medium text-n-600 whitespace-nowrap';
const td = 'border-b border-n-200 px-2 py-1.5 align-top text-ui';
const PAGE = 200;
const ACCESS = { shared: '공유', normal: '일반', blocked: '블록' };
// 빠진 칸 거르개 — 공용(호선 없음) 표시가 있으면 호선이 없어도 빠진 것이 아니다
const MISSING = [
  { id: 'zones', label: '구역 없음', test: (r) => !r.zones.length },
  { id: 'target', label: '대상 없음', test: (r) => !r.target },
  { id: 'assignees', label: '담당자 없음', test: (r) => !r.assignees.length },
  { id: 'hulls', label: '호선 없음(공용 아님)', test: (r) => !r.hulls.length && !r.no_hull },
];
// 파일 열 — 묶음 키 → 짧은 이름
const FILE_SHORT = [['nastran', 'Nastran'], ['abaqus', 'Abaqus'], ['report', '보고서'], ['excel', '엑셀'], ['result', '결과']];

const Missing = () => <span className="rounded bg-err-bg px-1.5 py-0.5 text-meta font-medium text-err">빠짐</span>;
const personRef = (p) => (p.id ? { id: p.id } : { employee_id: p.employee_id });
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const personKeys = (xs) => xs.map((p) => (p.id ? `#${p.id}` : p.employee_id));

/** 고친 칸 중 원래 값과 다른 것만 남긴다(되돌려 놓으면 변경이 아니다). */
function realChanges(row, edit) {
  const out = {};
  if ('zones' in edit && !sameList(edit.zones, row.zones)) out.zones = edit.zones;
  if ('target' in edit && (edit.target || null) !== (row.target || null)) out.target = edit.target || null;
  if ('assignees' in edit && !sameList(personKeys(edit.assignees), personKeys(row.assignees))) out.assignees = edit.assignees;
  if ('access' in edit && edit.access !== row.access) out.access = edit.access;
  return out;
}

/** 한 자료 저장 — 분류·담당자는 PATCH(version), 확정 자료의 공개 범위는 PUT access(다음 version). 자료마다 기록이 남는다. */
async function saveRow(row, ch) {
  let version = row.version;
  const patch = {};
  if ('zones' in ch) patch.zones = ch.zones;
  if ('target' in ch) patch.target = ch.target || '';   // 빈 값 = 대상 지우기
  if ('assignees' in ch) patch.assignees = ch.assignees.map(personRef);
  const accessViaPatch = 'access' in ch && row.status === 'draft';   // 초안의 공개 범위는 PATCH 로(15)
  if (accessViaPatch) patch.access = ch.access;
  if (Object.keys(patch).length) {
    const d = await api(`/entries/${row.entry_id}`, { method: 'PATCH', body: { ...patch, version } });
    version = d.version;
  }
  if ('access' in ch && !accessViaPatch) {
    await api(`/entries/${row.entry_id}/access`, { method: 'PUT', body: { access: ch.access, version } });
  }
}

function matches(r, q) {
  if (!q) return true;
  const hay = [r.entry_id, r.title, ...r.hulls, ...r.zones, r.target, r.uploaded_by, r.uploader_name,
    ...r.assignees.map((p) => p.name)].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

/**
 * 57 — 관리 › 자료 목록(LV3). 모든 확정 자료(원하면 정리 대기 초안도)를 한 줄씩 보며 구역·대상·담당자·공개 범위가
 * 빠지거나 잘못된 것을 눈으로 찾고 고친다.
 * - 표 안에서 바로: 구역·대상(눌러서 목록에서 고르기)·담당자·공개(콤보). 고친 줄은 표시만 하고 [변경 N건 저장]으로 한 번에.
 * - 같은 값을 여러 자료에: 골라서 [고른 N건 바꾸기](54 일괄 분류 + 공개 범위).
 * 어느 쪽이든 자료마다 바뀐 기록이 남는다. 빠진 칸 거르개는 저장된 값으로 거른다(고치는 동안 줄이 사라지지 않게).
 */
export default function EntryTablePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState(false);
  const [q, setQ] = useState('');
  const [missing, setMissing] = useState(() => new Set());
  const [accessFilter, setAccessFilter] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [edits, setEdits] = useState({});          // entry_id → 고친 칸
  const [rowErrors, setRowErrors] = useState({});  // entry_id → 저장 실패 사유
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api(`/admin/entry-table${drafts ? '?drafts=true' : ''}`)
    .then((r) => { setData(r); setError(''); })
    .catch((err) => setError(errorText(err, '자료 목록을 불러오지 못했습니다.'))), [drafts]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.entry_id, r])), [rows]);
  const dirtyIds = Object.keys(edits).filter((id) => byId[id] && Object.keys(realChanges(byId[id], edits[id])).length);
  const edit = (id, field) => (v) => {
    setEdits((cur) => ({ ...cur, [id]: { ...cur[id], [field]: v } }));
    setRowErrors((cur) => { if (!cur[id]) return cur; const n = { ...cur }; delete n[id]; return n; });
  };
  const val = (r, field) => (edits[r.entry_id] && field in edits[r.entry_id] ? edits[r.entry_id][field] : r[field]);

  // 저장하지 않은 변경이 있으면 창을 닫거나 새로 고칠 때 묻는다
  useEffect(() => {
    if (!dirtyIds.length) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds.length]);

  async function saveAll() {
    setSaving(true); setNotice(''); setError('');
    const failed = {};
    let ok = 0;
    for (const id of dirtyIds) {
      try {
        await saveRow(byId[id], realChanges(byId[id], edits[id]));
        ok += 1;
      } catch (err) {
        failed[id] = errorText(err, '저장하지 못했습니다.');
      }
    }
    setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => failed[id])));
    setRowErrors(failed);
    const nFail = Object.keys(failed).length;
    if (ok) setNotice(`${ok}건을 저장했습니다.`);
    if (nFail) setError(`${nFail}건은 저장하지 못했습니다. 빨간 줄의 사유를 보고 다시 고쳐 주세요.`);
    setSaving(false);
    load();
  }
  const counts = useMemo(() => Object.fromEntries(MISSING.map((m) => [m.id, rows.filter(m.test).length])), [rows]);
  const shown = useMemo(() => rows.filter((r) => matches(r, q.trim())
    && (!accessFilter || r.access === accessFilter)
    && MISSING.every((m) => !missing.has(m.id) || m.test(r))), [rows, q, accessFilter, missing]);
  const visible = shown.slice(0, limit);
  const allPicked = visible.length > 0 && visible.every((r) => picked.has(r.entry_id));

  const toggleMissing = (id) => setMissing((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePick = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickAll = () => setPicked((cur) => {
    const n = new Set(cur);
    visible.forEach((r) => (allPicked ? n.delete(r.entry_id) : n.add(r.entry_id)));
    return n;
  });

  return (
    // 열이 많은 표라 표준 폭(1200px)보다 넓게 쓴다
    <Page className="max-w-[1600px]">
      <PageHeader title="자료 목록"
        description="모든 자료의 호선·구역·대상·담당자·공개 범위를 한눈에 봅니다. 빠진 칸은 빨갛게 보입니다. 표에서 바로 고치고 [저장], 같은 값을 여러 자료에 넣을 때는 골라서 [고른 N건 바꾸기]"
        actions={(
          <>
            <Button variant="secondary" size="sm" disabled={!picked.size || saving} onClick={() => setBulkOpen(true)}>
              고른 {picked.size}건 바꾸기
            </Button>
            <Button variant="secondary" size="sm" disabled={!dirtyIds.length || saving}
                    onClick={() => { setEdits({}); setRowErrors({}); }}>
              되돌리기
            </Button>
            <Button variant="primary" size="sm" disabled={!dirtyIds.length || saving} loading={saving} onClick={saveAll}>
              변경 {dirtyIds.length}건 저장
            </Button>
          </>
        )} />
      {notice && <OkNote className="mb-4">{notice}</OkNote>}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-n-500" />
          <input aria-label="자료 거르기" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                 placeholder="번호·제목·호선·분류·사람" className={inputClass('h-8 w-64 pl-8 text-ui')} />
        </label>
        {MISSING.map((m) => (
          <button key={m.id} type="button" aria-pressed={missing.has(m.id)} onClick={() => { toggleMissing(m.id); setLimit(PAGE); }}
                  className={`h-8 rounded-md border px-2.5 text-meta font-medium transition-colors ${missing.has(m.id)
                    ? 'border-err-line bg-err-bg text-err' : 'border-n-200 text-n-700 hover:bg-n-50'}`}>
            {m.label} <span className="font-mono">{counts[m.id] ?? 0}</span>
          </button>
        ))}
        <select aria-label="공개 범위 거르기" value={accessFilter} onChange={(e) => setAccessFilter(e.target.value)}
                className={selectClass('h-8 w-auto text-meta')}>
          <option value="">공개 범위 전체</option>
          {Object.entries(ACCESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-meta text-n-700">
          <input type="checkbox" checked={drafts} onChange={(e) => { setDrafts(e.target.checked); setPicked(new Set()); }} />
          정리 대기 초안 포함
        </label>
        <span className="ml-auto text-meta text-n-600">
          <span className="font-mono">{shown.length}</span> / <span className="font-mono">{rows.length}</span>건
        </span>
      </div>

      {!data && !error && <RowsSkeleton rows={6} label="자료 목록을 불러오는 중" />}
      {data && (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-n-200">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-8`}><input type="checkbox" aria-label="보이는 자료 모두 고르기" checked={allPicked} onChange={pickAll} /></th>
                <th className={th}>자료</th><th className={th}>호선</th><th className={th}>구역</th><th className={th}>대상</th>
                <th className={th}>담당자</th><th className={th}>공개</th><th className={th}>파일</th>
                <th className={th}>올린 사람</th><th className={th}>확정</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const dirty = dirtyIds.includes(r.entry_id);
                const failed = rowErrors[r.entry_id];
                const zones = val(r, 'zones');
                const target = val(r, 'target');
                const assignees = val(r, 'assignees');
                const miss = (empty) => (empty ? 'bg-err-bg' : '');
                const rowClass = failed ? 'bg-err-bg' : dirty ? 'bg-wait-bg' : picked.has(r.entry_id) ? 'bg-brand-subtle' : 'hover:bg-n-50';
                return (
                <tr key={r.entry_id} className={rowClass}>
                  <td className={td}>
                    <input type="checkbox" aria-label={`${r.entry_id} 고르기`} checked={picked.has(r.entry_id)}
                           onChange={() => togglePick(r.entry_id)} />
                  </td>
                  <td className={`${td} min-w-[220px]`}>
                    <Link to={`/e/${r.entry_id}`} className="font-mono text-meta font-medium text-brand hover:underline">{r.entry_id}</Link>
                    {r.status === 'draft' && <span className="ml-1.5 text-meta text-n-500">초안</span>}
                    {dirty && <span className="ml-1.5 text-meta font-medium text-wait">고침</span>}
                    <div className="break-words text-n-900">{r.title}</div>
                    {failed && <div role="alert" className="mt-0.5 text-meta text-err">{failed}</div>}
                  </td>
                  <td className={`${td} font-mono whitespace-nowrap`}>
                    {r.hulls.length ? r.hulls.join(', ') : r.no_hull ? <span className="text-n-600">공용</span> : <Missing />}
                  </td>
                  <td className={`${td} min-w-[150px] ${miss(!zones.length)}`}>
                    <VocabInput compact multiple kind="zone" label={`${r.entry_id} 구역`} values={zones}
                                onChange={edit(r.entry_id, 'zones')} disabled={saving} />
                  </td>
                  <td className={`${td} min-w-[130px] ${miss(!target)}`}>
                    <VocabInput compact kind="target" label={`${r.entry_id} 대상`} value={target}
                                onChange={(v) => edit(r.entry_id, 'target')(v || null)} disabled={saving} />
                  </td>
                  <td className={`${td} min-w-[190px] ${miss(!assignees.length)}`}>
                    <AssigneeInput label={`${r.entry_id} 담당자`} values={assignees}
                                   onChange={edit(r.entry_id, 'assignees')} disabled={saving} />
                  </td>
                  <td className={td}>
                    <select aria-label={`${r.entry_id} 공개 범위`} value={val(r, 'access')} disabled={saving}
                            onChange={(e) => edit(r.entry_id, 'access')(e.target.value)}
                            className={selectClass('h-7 w-auto text-meta')}>
                      {Object.entries(ACCESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className={`${td} whitespace-nowrap text-meta text-n-700`}>
                    {FILE_SHORT.filter(([k]) => r.files[k]).map(([k, label]) => `${label} ${r.files[k]}`).join(' · ') || '—'}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{r.uploader_name || r.uploaded_by || '—'}</td>
                  <td className={`${td} font-mono text-meta whitespace-nowrap text-n-600`}>{r.confirmed_at ? r.confirmed_at.slice(0, 10) : '—'}</td>
                </tr>
                );
              })}
              {!visible.length && (
                <tr><td colSpan={10} className={`${td} py-6 text-center text-n-500`}>조건에 맞는 자료가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > limit && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
            {Math.min(PAGE, shown.length - limit)}건 더 보기
          </Button>
        </div>
      )}
      {bulkOpen && (
        <BulkClassifyDialog allowAccess entryIds={[...picked]} onCancel={() => setBulkOpen(false)}
          onDone={(r) => { setBulkOpen(false); setNotice(bulkDoneText(r)); setPicked(new Set()); load(); }} />
      )}
    </Page>
  );
}
