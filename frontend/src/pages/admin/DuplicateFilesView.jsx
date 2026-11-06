import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { inputClass } from '../../components/ui/Field.jsx';
import { ErrorNote, OkNote } from '../../components/ui/Page.jsx';
import { StatusDot } from '../../components/ui/Status.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { errorText, formatBytes, formatDateTime } from '../../lib/labels.js';

const th = 'h-8 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const td = 'border-b border-n-200 px-3 py-2 align-top text-ui';
const PAGE = 50;
const CATEGORIES = [['', '전체'], ['report', '보고서'], ['excel', '엑셀'], ['model', '모델']];
const SKIP_REASONS = {
  file_not_found: '파일 없음', already_removed: '이미 정리됨', entry_not_active: '자료가 확정·정리 대기가 아님',
  not_uploader: '권한 없음', file_not_in_vault: '파일 자리가 맞지 않음', entry_trashed: '이미 휴지통',
};

const SIG_LABELS = { geometry: '형상', property: '속성', material: '재료', load: '하중' };
const num = (n) => n.toLocaleString('ko-KR');
const signed = (n) => (n > 0 ? `+${num(n)}` : `−${num(-n)}`);
const safe = (g) => g.same_content || g.same_model;   // 정리해도 되는 묶음

/** 모델 파일의 '남길 것' 과 비교 한 줄 — 범주별 같음/다름 · 카드 개수 차. */
function CompareLine({ c }) {
  if (c.same_model) return <div className="mt-1 text-meta font-medium text-ok">남길 것과 모델 내용 같음(주석·줄 형식만 다름)</div>;
  const counts = Object.entries(c.counts).map(([k, v]) => `${k} ${signed(v)}`);
  return (
    <div className="mt-1 text-meta text-n-600">
      남길 것과 비교: {Object.keys(SIG_LABELS).map((k, i) => (
        <span key={k}>{i > 0 && ' · '}
          <span className={c.diff.includes(k) ? 'font-medium text-wait' : ''}>{SIG_LABELS[k]} {c.diff.includes(k) ? '다름' : '같음'}</span>
        </span>
      ))}
      {counts.length > 0 && <span className="font-mono"> · {counts.join(' · ')}</span>}
    </div>
  );
}

/** 한 파일이 정리되면 어떻게 되는지 — 자료의 마지막 파일이면 자료째 휴지통. */
function outcome(f, pickedInEntry) {
  return f.entry_file_count - pickedInEntry <= 0 ? '자료째 휴지통' : '이 파일만 빼기';
}

/** 58 — 파일명이 같은 보고서·엑셀·모델(서로 다른 자료 2건 이상) 찾기와 정리. 휴지통으로만 옮긴다(복원 가능). */
export default function DuplicateFilesView() {
  const [data, setData] = useState(null);
  const [category, setCategory] = useState('');
  const [same, setSame] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, dialog] = useConfirm();

  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (category) p.set('category', category);
    if (same) p.set('same', same);
    if (q.trim()) p.set('q', q.trim());
    return api(`/admin/cleanup/duplicates?${p}`)
      .then((r) => { setData(r); setError(''); })
      .catch((err) => setError(errorText(err, '중복 파일을 불러오지 못했습니다.')));
  }, [category, same, q, limit]);
  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const files = useMemo(() => (data?.items || []).flatMap((g) => g.files), [data]);
  // 같은 자료에서 몇 개를 골랐는지 — 자료의 파일을 모두 고르면 자료째 휴지통
  const pickedByEntry = useMemo(() => {
    const m = {};
    for (const f of files) if (picked.has(f.file_id)) m[f.entry_id] = (m[f.entry_id] || 0) + 1;
    return m;
  }, [files, picked]);
  const chosen = files.filter((f) => picked.has(f.file_id));
  const trashEntries = Object.keys(pickedByEntry).filter((eid) => {
    const f = files.find((x) => x.entry_id === eid);
    return f && f.entry_file_count - pickedByEntry[eid] <= 0;
  });

  const toggle = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reset = (fn) => (v) => { fn(v); setLimit(PAGE); setPicked(new Set()); };

  /** 내용까지 같은 묶음(모델은 서명까지 같음)에서 '남길 것' 이외를 모두 고른다(이름만 같은 묶음은 사람이 본다). */
  function pickSameContent() {
    const n = new Set(picked);
    for (const g of data?.items || []) if (safe(g)) for (const f of g.files) if (!f.keep) n.add(f.file_id);
    setPicked(n);
  }

  async function resolve() {
    if (!chosen.length) return;
    const ok = await confirm({
      title: `파일 ${chosen.length}개를 정리할까요?`,
      body: `자료에 다른 파일이 남으면 그 파일만 빼고, 마지막 파일이면 자료를 휴지통으로 옮깁니다${trashEntries.length ? `(자료째 휴지통 ${trashEntries.length}건: ${trashEntries.join(', ')})` : ''}. 영구 삭제가 아니며 자료 화면·휴지통에서 되돌릴 수 있습니다.`,
      confirmLabel: '정리하기',
    });
    if (!ok) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api('/admin/cleanup/duplicates/resolve', { method: 'POST', body: { file_ids: chosen.map((f) => f.file_id) } });
      const removed = r.results.filter((x) => x.status === 'file_removed').length;
      const trashed = new Set(r.results.filter((x) => x.status === 'entry_trashed').map((x) => x.entry_id)).size;
      const skipped = r.results.filter((x) => x.status === 'skipped')
        .map((x) => `${x.entry_id || x.file_id} ${SKIP_REASONS[x.reason] || x.reason}`);
      setNotice(`파일 ${removed}개를 뺐고, 자료 ${trashed}건을 휴지통으로 옮겼습니다.${skipped.length ? ` 건너뜀 ${skipped.length}개: ${skipped.join(', ')}` : ''}`);
      setPicked(new Set());
      await load();
    } catch (err) {
      setError(errorText(err, '정리하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  const catTabs = CATEGORIES.map(([id, label]) => ({ id, label, count: id ? data?.counts?.[id] : data?.all }));
  const sameTabs = [{ id: '', label: '전체' },
    { id: 'content', label: '내용도 같음', count: data?.same_counts?.content },
    { id: 'name', label: '이름만 같음', count: data?.same_counts?.name }];
  return (
    <section aria-label="중복 파일">
      {dialog}
      <p className="mb-3 text-meta text-n-600">
        파일 이름(대소문자 무시)이 같은 보고서·엑셀·모델이 서로 다른 자료에 있는 것입니다. ‘내용도 같음’ 은 파일 내용(sha256)까지 같고, 모델은
        형상·속성·재료·하중 서명이 모두 같으면(주석·줄 형식만 다름) 같은 것으로 봅니다. 한쪽을 지워도 되는 경우가 많고, ‘이름만 같음’ 은 판이 다른 자료일 수 있어 열어 보고 정하세요. ‘남길 것’ 은 확정 자료 중 먼저 올린 쪽입니다.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs label="종류로 거르기" items={catTabs} value={category} onChange={reset(setCategory)} />
        <span aria-hidden="true" className="h-5 w-px bg-n-250" />
        <Tabs label="내용으로 거르기" items={sameTabs} value={same} onChange={reset(setSame)} />
        <label className="ml-auto flex items-center gap-1.5">
          <Search size={14} className="text-n-400" aria-hidden="true" />
          <input aria-label="파일 찾기" value={q} onChange={(e) => reset(setQ)(e.target.value)}
                 placeholder="파일명·자료 번호·제목" className={inputClass('h-8 w-[220px]')} />
        </label>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy || !(data?.items || []).some(safe)} onClick={pickSameContent}>
          <Wand2 size={14} aria-hidden="true" />내용도 같은 것 고르기(남길 것 빼고)
        </Button>
        {picked.size > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>고른 것 풀기</Button>}
        <Button size="sm" variant="danger" className="ml-auto" disabled={busy || chosen.length === 0} loading={busy} onClick={resolve}>
          {!busy && <Trash2 size={14} aria-hidden="true" />}고른 <span className="font-mono">{chosen.length}</span>개 정리
        </Button>
      </div>
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
      {notice && <OkNote className="mb-3">{notice}</OkNote>}
      {!data && !error && <p className="py-10 text-center text-ui text-n-500"><span className="appear-late">불러오는 중…</span></p>}
      {data && data.items.length === 0 && (
        <p className="rounded-lg border border-n-200 py-10 text-center text-ui text-n-500">파일명이 같은 자료가 없습니다.</p>
      )}
      <div className="space-y-4">
        {(data?.items || []).map((g) => (
          <div key={g.key} className="overflow-x-auto rounded-lg border border-n-200" role="group" aria-label={g.name}>
            <div className="flex flex-wrap items-center gap-2 border-b border-n-200 bg-n-50 px-3 py-2">
              <span className="break-all font-mono text-ui font-medium text-n-900">{g.name}</span>
              <span className={`rounded-xs px-1.5 text-micro font-semibold ${safe(g) ? 'bg-ok-bg text-ok' : 'bg-wait-bg text-wait'}`}>
                {g.same_content ? '내용도 같음' : g.same_model ? '모델 내용 같음(형식만 다름)' : '이름만 같음(내용 다름)'}
              </span>
              <span className="text-meta text-n-500">자료 <span className="font-mono">{new Set(g.files.map((f) => f.entry_id)).size}</span>건</span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-8`}><span className="sr-only">고르기</span></th>
                  <th className={th}>자료</th><th className={th}>파일 위치</th><th className={th}>크기·내용</th>
                  <th className={th}>올린 사람</th><th className={th}>정리하면</th>
                </tr>
              </thead>
              <tbody>
                {g.files.map((f) => (
                  <tr key={f.file_id} className={`last:[&>td]:border-0 ${picked.has(f.file_id) ? 'bg-err-bg/40' : 'hover:bg-n-50'}`}>
                    <td className={td}>
                      <input type="checkbox" aria-label={`${f.entry_id} ${f.rel_path} 고르기`} className="h-3.5 w-3.5 accent-brand"
                             checked={picked.has(f.file_id)} onChange={() => toggle(f.file_id)} />
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Link to={`/e/${f.entry_id}`} className="font-mono text-meta font-medium text-brand hover:underline">{f.entry_id}</Link>
                        <StatusDot status={f.status} />
                        {f.keep && <span className="rounded-xs bg-brand/10 px-1.5 text-micro font-semibold text-brand">남길 것</span>}
                      </div>
                      <div className="min-w-0 break-words text-n-900">{f.title}</div>
                      {f.compare && <CompareLine c={f.compare} />}
                    </td>
                    <td className={`${td} break-all text-meta text-n-600`}>{f.rel_path}</td>
                    <td className={`${td} whitespace-nowrap text-meta text-n-600`}>
                      {formatBytes(f.size)} · <span className="font-mono" title={f.sha256}>{f.sha256.slice(0, 8)}</span>
                      {f.counts && (
                        <div className="font-mono text-micro text-n-500">
                          {Object.entries(f.counts).map(([k, v]) => `${k} ${num(v)}`).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className={`${td} text-meta text-n-700`}>
                      {f.uploader_name || f.uploaded_by || '—'}
                      <div className="text-n-500">{f.created_at ? formatDateTime(f.created_at) : ''}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-meta text-n-600`}>
                      {outcome(f, (pickedByEntry[f.entry_id] || 0) + (picked.has(f.file_id) ? 0 : 1))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {data && data.total > data.items.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((n) => n + PAGE)}>
          더 보기 <span className="text-n-500">남은 <span className="font-mono">{data.total - data.items.length}</span>묶음</span>
        </Button>
      )}
    </section>
  );
}
