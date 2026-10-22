import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RotateCcw, Search, Wand2 } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import { useConfirm } from '../../components/ui/ConfirmDialog.jsx';
import { inputClass, selectClass } from '../../components/ui/Field.jsx';
import { ErrorNote, OkNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { REQUIRED_LABELS, errorText, formatDateTime, requiredText } from '../../lib/labels.js';

const th = 'h-9 border-b border-n-200 bg-n-50 px-3 text-left text-meta font-medium text-n-600';
const td = 'border-b border-n-200 px-3 py-2 align-top text-ui';
const PAGE = 100;

const VIEWS = [
  { id: 'missing', label: '빠진 필수 분류' },
  { id: 'titles', label: '제목 형식' },
  { id: 'applied', label: '바꾼 기록' },
];
const SKIP_REASONS = {
  version_conflict: '그사이 다른 사람이 고침', proposal_changed: '제안 제목이 바뀜(다시 미리보기)',
  already_formatted: '이미 형식대로', blocked: '필수 분류 빠짐', not_found: '자료 없음',
};

function EntryCell({ id, title }) {
  return (
    <>
      <Link to={`/e/${id}`} className="font-mono text-meta font-medium text-brand hover:underline">{id}</Link>
      <div className="min-w-0 break-words text-n-900">{title}</div>
    </>
  );
}

const who = (it) => it.uploader_name || it.uploaded_by || '—';

/** (a) 필수 분류가 빠진 확정 BDF 자료 — 무엇이 빠졌는지·올린 사람, 고치기는 자료 화면 [변경하기]. */
function MissingView() {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState('');
  const [uploader, setUploader] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams({ limit: String(limit) });
    if (missing) p.set('missing', missing);
    if (uploader) p.set('uploader', uploader);
    if (q.trim()) p.set('q', q.trim());
    const t = setTimeout(() => {
      api(`/admin/cleanup/missing?${p}`)
        .then((r) => { if (alive) { setData(r); setError(''); } })
        .catch((err) => { if (alive) setError(errorText(err, '목록을 불러오지 못했습니다.')); });
    }, q ? 200 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [missing, uploader, q, limit]);

  const tabs = [{ id: '', label: '전체', count: data?.all },
    ...Object.keys(REQUIRED_LABELS).map((k) => ({ id: k, label: REQUIRED_LABELS[k], count: data?.counts?.[k] }))];
  return (
    <section aria-label="빠진 필수 분류">
      <p className="mb-3 text-meta text-n-600">
        BDF 가 있는 확정 자료 중 호선(또는 '호선 없음(공용)')이나 구역·대상이 빠진 것입니다. 자료는 그대로 보이고,
        작성자와 관리자에게만 ‘보완 필요’ 표시가 붙습니다. 번호를 눌러 자료 화면의 [변경하기]로 채워 주세요.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs label="빠진 칸으로 거르기" items={tabs} value={missing} onChange={(v) => { setMissing(v); setLimit(PAGE); }} />
        <select aria-label="작성자" value={uploader} className={selectClass('h-8 text-meta')}
                onChange={(e) => { setUploader(e.target.value); setLimit(PAGE); }}>
          <option value="">작성자 전체</option>
          {(data?.uploaders || []).map((u) => (
            <option key={u.employee_id || '-'} value={u.employee_id || ''}>{u.name || u.employee_id || '—'} ({u.count})</option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1.5">
          <Search size={14} className="text-n-400" aria-hidden="true" />
          <input aria-label="자료 찾기" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                 placeholder="번호 또는 제목" className={inputClass('h-8 w-[220px]')} />
        </label>
      </div>
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
      <div className="overflow-x-auto rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>자료</th><th className={th}>빠진 칸</th><th className={th}>지금 값</th><th className={th}>작성자</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((it) => (
              <tr key={it.entry_id} className="last:[&>td]:border-0 hover:bg-n-50">
                <td className={td}><EntryCell id={it.entry_id} title={it.title} /></td>
                <td className={`${td} font-medium text-wait`}>{requiredText(it.missing)}</td>
                <td className={`${td} text-meta text-n-600`}>
                  호선 {it.hulls.join(', ') || (it.no_hull ? '공용' : '—')} · 구역 {it.zones.join(', ') || '—'} · 대상 {it.target || '—'}
                </td>
                <td className={`${td} text-meta text-n-700`}>{who(it)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-ui text-n-500">빠진 필수 분류가 있는 자료가 없습니다.</td></tr>
            )}
            {!data && !error && (
              <tr><td colSpan={4} className="py-10 text-center text-ui text-n-500"><span className="appear-late">불러오는 중…</span></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > data.items.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((n) => n + PAGE)}>
          더 보기 <span className="text-n-500">남은 <span className="font-mono">{data.total - data.items.length}</span>건</span>
        </Button>
      )}
    </section>
  );
}

/** (b) 제목을 새 형식으로 — 미리보기 → 행별·일괄 선택 적용(감사 기록, '바꾼 기록' 에서 되돌리기). */
function TitlesView({ onApplied }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('ready');
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, dialog] = useConfirm();

  const load = useCallback(() => {
    const p = new URLSearchParams({ status, limit: String(limit) });
    return api(`/admin/cleanup/titles?${p}`)
      .then((r) => { setData(r); setError(''); })
      .catch((err) => setError(errorText(err, '미리보기를 불러오지 못했습니다.')));
  }, [status, limit]);
  useEffect(() => { load(); }, [load]);

  const ready = useMemo(() => (data?.items || []).filter((p) => p.status === 'ready'), [data]);
  const allOn = ready.length > 0 && ready.every((p) => picked.has(p.entry_id));
  const toggle = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function apply(items) {
    if (!items.length) return;
    const ok = await confirm({
      title: `제목 ${items.length}건을 새 형식으로 바꿀까요?`,
      body: '자료 편집과 같이 기록되며, ‘바꾼 기록’ 에서 한 건씩 원래 제목으로 되돌릴 수 있습니다.',
      confirmLabel: '바꾸기', tone: 'primary',
    });
    if (!ok) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api('/admin/cleanup/titles/apply', { method: 'POST', body: {
        items: items.map((p) => ({ entry_id: p.entry_id, version: p.version, new_title: p.new_title })) } });
      const skipped = r.skipped.map((s) => `${s.entry_id} ${SKIP_REASONS[s.reason] || s.reason}`);
      setNotice(`제목 ${r.applied.length}건을 바꿨습니다.${skipped.length ? ` 건너뜀 ${skipped.length}건: ${skipped.join(', ')}` : ''}`);
      setPicked(new Set());
      await load();
      onApplied?.();
    } catch (err) {
      setError(errorText(err, '제목을 바꾸지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  const tabs = [{ id: 'ready', label: '바꿀 수 있음', count: data?.counts?.ready },
    { id: 'blocked', label: '제외(사유)', count: data?.counts?.blocked }];
  const chosen = ready.filter((p) => picked.has(p.entry_id));
  return (
    <section aria-label="제목 형식">
      {dialog}
      <p className="mb-3 text-meta text-n-600">
        제목 형식 = 호선 · 구역 · 대상 · 구별자(원래 폴더/파일 이름에서 호선·분류·잡음(final·최종·copy 등)을 뺀 나머지).
        원래 파일 이름은 그대로입니다. 필수 분류가 빠진 BDF 자료와 분류 값이 하나도 없는 자료는 바꾸지 않습니다.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs label="미리보기 거르기" items={tabs} value={status}
              onChange={(v) => { setStatus(v); setLimit(PAGE); setPicked(new Set()); }} />
        {status === 'ready' && (
          <Button size="sm" className="ml-auto" disabled={busy || chosen.length === 0} loading={busy} onClick={() => apply(chosen)}>
            {!busy && <Wand2 size={14} aria-hidden="true" />}선택한 <span className="font-mono">{chosen.length}</span>건 바꾸기
          </Button>
        )}
      </div>
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
      {notice && <OkNote className="mb-3">{notice}</OkNote>}
      <div className="overflow-x-auto rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {status === 'ready' && (
                <th className={`${th} w-9`}>
                  <input type="checkbox" aria-label="이 쪽 모두 고르기" className="h-3.5 w-3.5 accent-brand" checked={allOn}
                         disabled={!ready.length || busy}
                         onChange={() => setPicked(allOn ? new Set() : new Set(ready.map((p) => p.entry_id)))} />
                </th>
              )}
              <th className={th}>자료 · 지금 제목</th>
              <th className={th}>{status === 'ready' ? '새 제목' : '제외 사유'}</th>
              <th className={th}>원래 이름</th>
              {status === 'ready' && <th className={th}><span className="sr-only">한 건 바꾸기</span></th>}
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((p) => (
              <tr key={p.entry_id} className="last:[&>td]:border-0 hover:bg-n-50">
                {status === 'ready' && (
                  <td className={td}>
                    <input type="checkbox" aria-label={`${p.entry_id} 고르기`} className="h-3.5 w-3.5 accent-brand"
                           checked={picked.has(p.entry_id)} disabled={busy} onChange={() => toggle(p.entry_id)} />
                  </td>
                )}
                <td className={td}><EntryCell id={p.entry_id} title={p.title} /></td>
                <td className={td}>
                  {p.status === 'ready'
                    ? <span className="inline-flex items-start gap-1.5 font-medium text-n-900"><ArrowRight size={14} className="mt-0.5 shrink-0 text-n-400" aria-hidden="true" />{p.new_title}</span>
                    : <span className="text-meta text-wait">{p.reason}</span>}
                </td>
                <td className={`${td} break-all font-mono text-meta text-n-500`}>{p.source || '—'}</td>
                {status === 'ready' && (
                  <td className={`${td} text-right`}>
                    <Button variant="ghost" size="sm" disabled={busy} aria-label={`${p.entry_id} 제목 바꾸기`} onClick={() => apply([p])}>
                      바꾸기
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-ui text-n-500">
                {status === 'ready' ? '바꿀 제목이 없습니다 — 모두 형식대로입니다.' : '제외된 자료가 없습니다.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > data.items.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((n) => n + PAGE)}>
          더 보기 <span className="text-n-500">남은 <span className="font-mono">{data.total - data.items.length}</span>건</span>
        </Button>
      )}
    </section>
  );
}

/** 바꾼 기록 — 제목 정비(감사 ENTRY_RETITLE)를 한 건씩 원래 제목으로 되돌린다. */
function AppliedView({ stamp }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/admin/cleanup/titles/applied?limit=200')
    .then((r) => { setRows(r); setError(''); })
    .catch((err) => setError(errorText(err, '기록을 불러오지 못했습니다.'))), []);
  useEffect(() => { load(); }, [load, stamp]);

  async function revert(r) {
    setBusyId(r.audit_id); setError('');
    try {
      await api('/admin/cleanup/titles/revert', { method: 'POST', body: { entry_id: r.entry_id } });
      await load();
    } catch (err) {
      setError(errorText(err, '되돌리지 못했습니다.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="바꾼 기록">
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
      <div className="overflow-x-auto rounded-lg border border-n-200">
        <table className="w-full border-collapse">
          <thead>
            <tr><th className={th}>언제 · 누가</th><th className={th}>자료</th><th className={th}>원래 제목 → 바꾼 제목</th>
              <th className={th}><span className="sr-only">되돌리기</span></th></tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.audit_id} className="last:[&>td]:border-0 hover:bg-n-50">
                <td className={`${td} whitespace-nowrap font-mono text-meta text-n-600`}>{formatDateTime(r.at).slice(0, 16)} · {r.employee_id || '-'}</td>
                <td className={td}><Link to={`/e/${r.entry_id}`} className="font-mono text-meta font-medium text-brand hover:underline">{r.entry_id}</Link></td>
                <td className={td}>
                  <div className="text-n-600 line-through decoration-n-300">{r.old_title}</div>
                  <div className="font-medium text-n-900">{r.new_title}</div>
                  {!r.can_revert && !r.reverted && <div className="text-meta text-n-500">이후 제목이 다시 바뀜: {r.current_title}</div>}
                </td>
                <td className={`${td} text-right`}>
                  {r.reverted ? <span className="text-meta text-n-500">되돌림</span> : (
                    <Button variant="ghost" size="sm" disabled={!r.can_revert || busyId === r.audit_id} loading={busyId === r.audit_id}
                            aria-label={`${r.entry_id} 원래 제목으로 되돌리기`} onClick={() => revert(r)}>
                      {busyId !== r.audit_id && <RotateCcw size={13} aria-hidden="true" />}되돌리기
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-ui text-n-500">아직 바꾼 제목이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 관리자(LV3) '자료 정비'(20) — 기존 자료를 새 규칙(필수 분류·제목 형식)에 맞춘다. 같은 기능의 CLI: naming-cleanup. */
export default function CleanupPage() {
  const [view, setView] = useState('missing');
  const [stamp, setStamp] = useState(0);
  return (
    <Page>
      <PageHeader title="자료 정비"
                  description="BDF 자료의 필수 분류(호선 또는 공용)가 빠진 확정 자료를 찾고, 제목을 새 형식(호선 · 구역 · 대상 · 구별자)으로 맞춥니다. 확정 자료를 숨기거나 상태를 바꾸지 않습니다." />
      <Tabs label="정비 보기" items={VIEWS} value={view} onChange={setView} className="mb-4" />
      {view === 'missing' && <MissingView />}
      {view === 'titles' && <TitlesView onApplied={() => setStamp((n) => n + 1)} />}
      {view === 'applied' && <AppliedView stamp={stamp} />}
    </Page>
  );
}
