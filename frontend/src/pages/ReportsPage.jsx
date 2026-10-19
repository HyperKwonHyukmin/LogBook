import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Box, FileText, Search, X } from 'lucide-react';
import { api } from '../api/client.js';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import { Input, Labeled, Select } from '../components/ui/Field.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { useConfirm } from '../components/ui/ConfirmDialog.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import KindBadge from '../components/ui/KindBadge.jsx';
import FilePreview from '../components/preview/FilePreview.jsx';
import { SCOPE_LABELS, errorText, formatDateTime } from '../lib/labels.js';
import { highlightParts } from '../lib/search.js';
import { reportLocatorLabel } from '../lib/reportLocator.js';
import { QUICK_BULK_TYPES, bulkResultText, bulkSummary } from '../lib/reportBulk.js';

/**
 * 21 — 문서 화면(23 전 이름 '보고서'). 파일 종류 report(PDF·PPT·DOC·XLS) 파일 하나가 한 행이다(BDF 와 함께 등록된 것도 포함).
 *   주소(/reports)·API·DB 값(report)은 그대로 두고 화면 이름만 '문서'로 바꿨다.
 * - 자료 소속(호선 관련·공통 참고자료·미분류)은 자료의 호선·공용에서 파생한 값이라 여기서 바꾸지 않는다
 *   — 자료 상세 [변경하기]에서 호선·'호선 없음(공용)'을 고친다. 29 — '독립 프로젝트'와 프로젝트 거르기는 없앴다.
 * - 문서마다 저장하는 것은 문서 분류와 '문서에 사용한 모델'(API 이름은 보고서 모델 연결) 연결뿐이다(PUT /reports/{id}/catalog).
 * - 23 — 문서 분류 목록과 상단 빠른 구분(전체 / 보고서 / 발표자료 / 기타)은 서버가 목록 응답으로 내려준다
 *   (document_type_options·document_type_groups). 빠른 구분은 문서 분류 거르기 값(`document_type=` 되풀이)을 묶어서 거는
 *   바로가기라 따로 저장·거르지 않는다. 저장된 문서 분류가 없는 .ppt/.pptx 는 서버가 '발표자료'로 추정해 주고(document_type_auto)
 *   화면은 '자동'으로 표시한다 — 저장하면 확정된다.
 * - 22 — 검색은 보고서 본문 색인(OCR 포함, 쪽·시트·슬라이드 위치)까지 찾는다. 조건(모든 단어·하나 이상·문구 그대로)과
 *   '의미 추천 포함'(retrieval=hybrid)을 고를 수 있고, 키워드 일치와 의미 추천을 나눠 보인다. 근거 요약은 미리보기 패널의
 *   단추를 눌렀을 때만 요청한다. 예전 '보고서 본문 검색' 메뉴(/report-search)는 이 화면으로 합쳤다(옛 주소는 이리로 옮겨 온다).
 * - 24 — 목록 행 체크박스로 여러 문서를 골라 문서 분류를 한꺼번에 바꾼다(POST /reports/meta/bulk, 부분 성공).
 *   고칠 수 있는 행(can_edit = 올린 사람·LV3)만 고를 수 있고, 선택은 지금 보이는 쪽 안에서만 유지한다
 *   (거르기·검색·쪽이 바뀌어 안 보이게 된 행은 선택에서 빠진다).
 */
const PAGE_SIZE = 50;
const NONE = '__none__';   // 문서 분류 '미분류' 거르기 값(서버와 같다)
const LIST_KEYS = ['q', 'mode', 'retrieval', 'scope', 'model', 'sort'];
const STATUS_POLL_MS = 60000;   // 색인 상태는 화면이 보일 때만 1분마다(서버도 Ollama 확인을 60초 캐시한다)
const reportError = (e) => errorText(e, '문서 정보를 불러오지 못했습니다.');
const INDEX_STATE_LABELS = { pending: '대기', failed: '실패', partial: '일부 추출', stale: '갱신 대기', missing: '원본 없음' };
const SUMMARY_ERRORS = {
  no_indexed_sources: '이 문서에 요약할 본문 색인이 없습니다. 색인이 끝난 뒤 다시 시도해 주세요.',
  rag_busy_user: '이미 요약을 만들고 있습니다. 끝난 뒤 다시 시도해 주세요.',
  rag_busy: '다른 사용자의 요약이 진행 중이라 지금은 만들 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
};

/** 22 — 예전 '보고서 본문 검색'(/report-search) 주소는 질의(q·mode·retrieval·거르기)를 그대로 들고 이 화면으로 옮겨 온다. */
export function ReportSearchRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/reports${search}`} replace />;
}

/** 색인 상태 — 화면이 보일 때만 주기적으로 묻는다(숨은 탭은 멈추고, 다시 보이면 바로 한 번). */
function useIndexStatus(refreshKey) {
  const [status, setStatus] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = () => api('/reports/index-status')
      .then((r) => { if (alive) { setStatus(r); setUnavailable(false); } })
      .catch(() => { if (alive) setUnavailable(true); });
    const start = () => { if (timer === null) timer = setInterval(load, STATUS_POLL_MS); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const onVisibility = () => { if (document.visibilityState === 'hidden') stop(); else { load(); start(); } };
    load();
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refreshKey]);
  return { status, unavailable };
}

function IndexStatus({ status, unavailable }) {
  if (unavailable || status?.index_available === false) {
    return <p className="text-meta text-n-600">본문 색인을 사용할 수 없어 제목·자료 정보와 기존 본문 추출로만 찾습니다(그림 속 글자는 찾지 못합니다).</p>;
  }
  if (!status) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-n-600" aria-label="문서 색인 상태">
      <span>본문 색인 <span className="font-mono">{status.ready ?? 0}</span> / <span className="font-mono">{status.total ?? 0}</span>개</span>
      {(status.partial ?? 0) > 0 && <span>일부 추출 {status.partial}개</span>}
      {(status.pending ?? 0) > 0 && <span>대기 {status.pending}개</span>}
      {(status.failed ?? 0) > 0 && <span>실패 {status.failed}개</span>}
      {(status.stale ?? 0) > 0 && <span>갱신 대기 {status.stale}개</span>}
      {status.last_updated && <span>최근 색인 {formatDateTime(status.last_updated)}</span>}
      <span>{status.embedding_available
        ? `의미 추천 준비 ${status.embedding_ready ?? 0} / ${status.total ?? 0}개`
        : '의미 추천 서버 연결 안 됨 · 키워드 검색은 그대로'}</span>
    </div>
  );
}

function Passage({ snippet }) {
  return (
    <span className="mt-1.5 block text-meta text-n-600">
      <span className="font-medium text-n-700" title={snippet.locator}>{reportLocatorLabel(snippet.locator)}</span>
      {' · '}
      {highlightParts(snippet.text || '', snippet.highlights).map((part, i) => (part.hit
        ? <mark key={i} className="rounded-sm bg-brand-subtle text-inherit">{part.text}</mark>
        : <span key={i}>{part.text}</span>))}
    </span>
  );
}

/** 근거 요약 — 단추를 눌렀을 때만 요청한다(자동으로 LLM 을 부르지 않는다). */
function ReportSummary({ fileId }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function summarize() {
    setBusy(true); setError(''); setSummary(null);
    try {
      setSummary(await api('/reports/answer', { method: 'POST', body: {
        question: '이 문서의 목적, 주요 결과와 제한사항을 한국어로 요약하고 근거 위치를 표시해 주세요.',
        file_ids: [fileId], retrieval: 'keyword',
      } }));
    } catch (e) {
      setError(SUMMARY_ERRORS[e?.detail] || '문서 요약을 지금 사용할 수 없습니다. 원문 미리보기는 계속 볼 수 있습니다.');
    } finally { setBusy(false); }
  }
  return (
    <section aria-label="문서 근거 요약" className="space-y-2 border-b border-n-200 pb-3">
      <Button variant="secondary" size="sm" disabled={busy} onClick={summarize}>{busy ? '근거 확인·요약 중…' : '이 문서 근거로 요약'}</Button>
      <p className="text-meta text-n-500">색인된 본문 일부를 근거로 만듭니다. 인용 위치의 원문을 함께 확인하세요.</p>
      {error && <p role="status" className="text-meta text-n-600">{error}</p>}
      {summary && <>
        <p className="whitespace-pre-wrap text-ui text-n-800">{summary.answer}</p>
        {summary.truncated && <p className="text-meta text-n-500">본문 일부만 사용한 요약입니다.</p>}
        <ul aria-label="요약 근거" className="space-y-2">{summary.citations.map((c) => (
          <li key={c.id} className="text-meta text-n-600">
            <span className="font-medium" title={c.locator}>[{c.id}] {c.name} · {reportLocatorLabel(c.locator)}</span>
            <p>{c.text}</p>
          </li>
        ))}</ul>
      </>}
    </section>
  );
}

function scopeText(c) {
  const label = SCOPE_LABELS[c.scope] || SCOPE_LABELS.unclassified;
  if (c.scope === 'hull' && c.hulls?.length) return `${label} · ${c.hulls.join(', ')}`;
  return label;
}

function ReportPanel({ fileId, options, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [docType, setDocType] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setError(''); setEditing(false);
    (async () => {
      try {
        const catalog = await api(`/reports/${fileId}/catalog`);
        const entry = await api(`/entries/${encodeURIComponent(catalog.entry_id)}`);
        const file = entry.files.find((f) => f.id === fileId);
        if (!file) throw Object.assign(new Error('report_not_found'), { detail: 'report_not_found' });
        if (alive) setData({ catalog, entry, file });
      } catch (e) { if (alive) setError(reportError(e)); }
    })();
    return () => { alive = false; };
  }, [fileId, attempt]);

  function startEdit() {
    setEditing(!editing); setSaved(false); setError(''); setCandidates([]);
    setDocType(data.catalog.document_type || '');
    setSelectedModels(data.catalog.related_models.filter((m) => m.relation === 'explicit'));
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setError(''); setSaved(false);
    try {
      const catalog = await api(`/reports/${fileId}/catalog`, { method: 'PUT', body: {
        version: data.catalog.version, document_type: docType, model_ids: selectedModels.map((m) => m.file_id),
      } });
      setData((d) => ({ ...d, catalog })); setEditing(false); setSaved(true); onSaved();
    } catch (err) { setError(reportError(err)); }
    finally { setSaving(false); }
  }

  async function findModels(e) {
    e.preventDefault(); setFinding(true); setError('');
    try {
      const p = new URLSearchParams({ unit: 'file', kind: 'model', q: modelQuery, limit: '50' });
      const r = await api(`/search?${p}`);
      setCandidates(r.items);
    } catch (err) { setError(reportError(err)); }
    finally { setFinding(false); }
  }

  const c = data?.catalog;
  return (
    <aside aria-label="문서 미리보기" className="flex min-w-0 flex-col border-l border-n-200 bg-n-0 max-[1100px]:border-l-0 max-[1100px]:border-t">
      <div className="flex items-center gap-2 border-b border-n-200 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-n-900">{data?.file.name || '문서'}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="문서 닫기" onClick={onClose}><X size={16} /></Button>
      </div>
      <div className="space-y-4 p-4">
        {error && <ErrorNote action={<Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>다시 불러오기</Button>}>{error}</ErrorNote>}
        {!data && !error && <p role="status" className="text-ui text-n-500">문서 불러오는 중…</p>}
        {data && <>
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ui">
            <dt className="text-meta text-n-500">자료</dt>
            <dd className="min-w-0 truncate">
              <Link to={`/e/${c.entry_id}?file=${fileId}`} className="text-brand underline-offset-2 hover:underline">{c.entry_title || c.entry_id}</Link>
            </dd>
            <dt className="text-meta text-n-500">자료 소속</dt>
            <dd className="min-w-0">
              <span>{scopeText(c)}</span>
              {/* 소속은 자료 값 — 자료 상세의 [변경하기]에서 바꾼다(제목 형식·필수 분류와 함께 맞물린다) */}
              {c.can_edit && (
                <Link to={`/e/${c.entry_id}?file=${fileId}`} className="ml-2 text-meta text-brand underline-offset-2 hover:underline">
                  자료 상세에서 변경
                </Link>
              )}
            </dd>
            <dt className="text-meta text-n-500">문서 분류</dt>
            <dd>{c.document_type || <span className="text-n-500">미분류</span>}
              {c.document_type_auto && <AutoMark />}</dd>
          </dl>
          {c.can_edit && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={startEdit}>{editing ? '편집 취소' : '문서 분류·모델 연결'}</Button>
          )}
          {saved && <p role="status" className="text-meta text-ok">문서 분류와 모델 연결을 저장했습니다.</p>}
          {editing && <section className="space-y-3 border-y border-n-200 py-3" aria-label="문서 정보 편집">
            <form onSubmit={save} id={`report-edit-${fileId}`}>
              <Labeled label="문서 분류"><Select value={docType} disabled={saving} onChange={(e) => setDocType(e.target.value)}>
                <option value="">미분류</option>{typeOptions(options, docType).map((t) => <option key={t}>{t}</option>)}
              </Select></Labeled>
              {c.document_type_auto && <p className="mt-1 text-meta text-n-600">파일 형식(.ppt·.pptx)으로 미리 채운 값입니다. 저장하면 이 값으로 확정되고, 다른 분류나 미분류로 바꿀 수 있습니다.</p>}
            </form>
            <p className="text-meta text-n-600">이 문서에 사용한 모델을 연결하세요. 같은 자료의 모델은 연결하지 않아도 관련 모델로 보입니다.</p>
            <ul className="space-y-1" aria-label="연결할 모델">{selectedModels.map((m) => <li key={m.file_id} className="flex items-center gap-2 text-ui">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setSelectedModels((ms) => ms.filter((v) => v.file_id !== m.file_id))}>연결 해제</Button>
            </li>)}</ul>
            <form onSubmit={findModels} className="flex gap-2">
              <Input aria-label="연결할 모델 검색" placeholder="BDF 파일 이름으로 찾기" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} className="min-w-0 flex-1" disabled={saving} />
              <Button type="submit" variant="secondary" size="sm" disabled={finding || saving}>모델 찾기</Button>
            </form>
            <ul className="max-h-48 overflow-auto" aria-label="모델 검색 결과">{candidates.map((m) => <li key={m.file_id} className="flex items-center gap-2 border-b border-n-200 py-1.5 text-ui">
              <span className="min-w-0 flex-1 truncate" title={m.entry_title}>{m.name} <span className="text-meta text-n-500">{m.entry_id}</span></span>
              <Button variant="secondary" size="sm" disabled={saving || selectedModels.some((v) => v.file_id === m.file_id)} onClick={() => setSelectedModels((ms) => [...ms, m])}>연결</Button>
            </li>)}</ul>
            <Button type="submit" form={`report-edit-${fileId}`} size="sm" disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
          </section>}
          <section aria-label="관련 모델" className="border-b border-n-200 pb-3">
            <h3 className="mb-2 text-ui font-semibold text-n-800">관련 모델 <span className="font-mono text-meta">{c.related_models.length}</span></h3>
            {!c.related_models.length && <p className="text-meta text-n-500">등록된 관련 모델이 없습니다. 문서만 있는 자료도 보관할 수 있습니다.</p>}
            <ul className="space-y-2">{c.related_models.map((m) => <li key={m.file_id} className="flex items-center gap-2 text-ui">
              <Box size={14} className="shrink-0 text-n-500" aria-hidden="true" />
              <Link to={`/v/${m.file_id}`} className="min-w-0 flex-1 truncate text-brand underline-offset-2 hover:underline">{m.name}</Link>
              <span className="shrink-0 text-meta text-n-500">{m.relation === 'explicit' ? '문서에 사용한 모델' : '같은 자료의 모델'}</span>
            </li>)}</ul>
          </section>
          <ReportSummary fileId={fileId} />
          <FilePreview file={data.file} vaultUnc={data.entry.vault_unc} hideTitles={[data.entry.title]} />
        </>}
      </div>
    </aside>
  );
}

/** 23 — 저장된 값이 아니라 파일 형식으로 추정한 문서 분류 표시. */
function AutoMark() {
  return <span title="파일 형식(.ppt·.pptx)으로 정한 값 — 저장하면 확정됩니다" className="ml-1.5 rounded-sm bg-n-100 px-1 text-meta text-n-600">자동</span>;
}

/** 고를 수 있는 문서 분류 — 서버 목록 + (목록에 없는 옛 값이면) 지금 값. */
function typeOptions(options, current) {
  const list = options || [];
  return current && !list.includes(current) ? [...list, current] : list;
}

const NO_EDIT_TITLE = '올린 사람과 관리자만 문서 분류를 바꿀 수 있습니다';

/** 24 — 머리행 '현재 목록 전체 선택'. 일부만 고르면 indeterminate. */
function SelectAll({ items, selected, disabled, onChange }) {
  const ref = useRef(null);
  const editable = items.filter((r) => r.can_edit);
  const picked = editable.filter((r) => selected.has(r.file_id)).length;
  const all = editable.length > 0 && picked === editable.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = picked > 0 && !all; }, [picked, all]);
  return (
    <label className="flex items-center gap-2 px-3 pb-2 text-meta text-n-600" title={editable.length ? undefined : NO_EDIT_TITLE}>
      <input ref={ref} type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={all} disabled={disabled || !editable.length}
             aria-label="현재 목록 전체 선택"
             onChange={() => onChange(all ? new Set() : new Set(editable.map((r) => r.file_id)))} />
      현재 목록 전체 선택{editable.length < items.length && <span className="text-n-500">(바꿀 수 있는 {editable.length}건)</span>}
    </label>
  );
}

/** 24 — 선택한 문서의 문서 분류 바꾸기 작업 바. 목록에서 고르거나 자주 쓰는 두 값을 바로 누른다. */
function BulkTypeBar({ count, options, busy, onApply, onClear }) {
  const [target, setTarget] = useState('');
  return (
    <div role="region" aria-label="선택한 문서 분류 바꾸기"
         className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-n-200 bg-n-50 px-3 py-2 text-ui">
      <span className="font-medium text-n-900"><span className="font-mono">{count}</span>건 선택</span>
      <span aria-hidden="true" className="text-n-400">·</span>
      <label className="inline-flex items-center gap-1.5 text-n-700">분류
        <Select aria-label="바꿀 문서 분류" value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
          <option value="">분류 고르기</option>
          {(options || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </label>
      <Button size="sm" disabled={busy || !target} onClick={() => onApply(target)}>{busy ? '적용 중…' : '적용'}</Button>
      {QUICK_BULK_TYPES.filter((t) => (options || []).includes(t)).map((t) => (
        <Button key={t} variant="secondary" size="sm" disabled={busy} onClick={() => onApply(t)}>{t}(으)로</Button>
      ))}
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>선택 해제</Button>
    </div>
  );
}

const sameSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v));

/** 23 — 상단 빠른 구분. 문서 분류 거르기 값을 묶어서 거는 바로가기(주소에는 document_type= 값들이 남는다).
 * 건수는 서버의 문서 분류 칸 건수(다른 거르기는 적용, 문서 분류 칸만 뺀 셈)를 묶음별로 더한 값이다. */
function QuickTypes({ groups, counts, selected, onChange }) {
  if (!groups?.length) return null;
  const count = (values) => (counts ? values.reduce((n, v) => n + (counts[v === NONE ? '' : v] || 0), 0) : null);
  const total = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : null;
  const items = [{ key: 'all', label: '전체', values: [] }, ...groups];
  return (
    <div role="group" aria-label="문서 빠른 구분" className="flex flex-wrap gap-1">
      {items.map((g) => {
        const n = g.key === 'all' ? total : count(g.values);
        const on = sameSet(selected, g.values);
        return (
          <button key={g.key} type="button" aria-pressed={on} onClick={() => onChange(g.values)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-ui transition-colors ${on ? 'bg-n-900 font-medium text-n-0' : 'text-n-700 hover:bg-n-100'}`}>
            {g.label}{n != null && <span className={`font-mono text-meta ${on ? 'text-n-200' : 'text-n-500'}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 문서 분류 거르기 — 값 여러 개(같은 칸 안은 '또는'). 빠른 구분이 거는 값도 여기 칩으로 보인다. */
function TypeFilter({ options, counts, selected, onChange }) {
  const label = (v) => (v === NONE ? '미분류' : v);
  const count = (v) => counts?.[v === NONE ? '' : v];
  const rest = [...(options || []), NONE].filter((v) => !selected.includes(v));
  return (
    <div role="group" aria-label="문서 분류 거르기" className="flex flex-wrap items-end gap-2">
      <Labeled label="문서 분류">
        <Select value="" onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]); }}>
          <option value="">{selected.length ? '또는 문서 분류 더하기' : '전체 문서 분류'}</option>
          {rest.map((v) => <option key={v} value={v}>{label(v)}{count(v) != null ? ` (${count(v)})` : ''}</option>)}
        </Select>
      </Labeled>
      {selected.map((v) => (
        <span key={v} className="inline-flex h-8 items-center gap-1 rounded-md bg-brand-subtle pl-2 text-ui text-brand">
          {label(v)}{count(v) != null && <span className="font-mono text-meta">{count(v)}</span>}
          <button type="button" aria-label={`문서 분류 ${label(v)} 거르기 해제`} onClick={() => onChange(selected.filter((x) => x !== v))}
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-brand-muted"><X size={13} aria-hidden="true" /></button>
        </span>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState(params.get('q') || '');
  const docTypes = params.getAll('document_type').filter(Boolean);
  const q = params.get('q') || '';
  const query = new URLSearchParams();
  for (const key of LIST_KEYS) if (params.get(key)) query.set(key, params.get(key));
  for (const t of docTypes) query.append('document_type', t);
  // 검색어가 있고 정렬을 고르지 않았으면 관련도순(키워드 일치 → 의미 추천)
  if (q && !params.get('sort')) query.set('sort', 'relevance');
  const parsedOffset = Number(params.get('offset'));
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
  query.set('limit', String(PAGE_SIZE)); query.set('offset', String(offset));
  const queryKey = query.toString();
  const picked = Number(params.get('file')) || null;
  const hybrid = params.get('retrieval') === 'hybrid';
  const { status: indexStatus, unavailable: statusUnavailable } = useIndexStatus(attempt);
  // 24 — 문서 분류를 한꺼번에 바꿀 행(file_id). 새 목록이 오면 그 목록에서 고칠 수 있는 행만 남긴다
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const toast = useToast();
  useEffect(() => {
    if (!data) return;
    const visible = new Set(data.items.filter((r) => r.can_edit).map((r) => r.file_id));
    setSelected((cur) => ([...cur].every((id) => visible.has(id)) ? cur : new Set([...cur].filter((id) => visible.has(id)))));
  }, [data]);
  const toggle = (id) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function applyBulk(target) {
    const items = (data?.items || []).filter((r) => selected.has(r.file_id));
    if (!items.length || !target) return;
    const { change, same, from } = bulkSummary(items, target);
    const ok = await confirm({
      title: `${items.length}건의 문서 분류를 ‘${target}’(으)로 바꿀까요?`,
      body: change
        ? `${from} → ${target}${same ? ` · 이미 ‘${target}’인 ${same}건은 건너뜁니다` : ''}. 바꾼 문서마다 자료 변경 이력에 남습니다.`
        : `고른 문서가 모두 이미 ‘${target}’입니다. 바뀌는 문서가 없습니다.`,
      confirmLabel: '바꾸기', tone: 'primary',
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const result = await api('/reports/meta/bulk', { method: 'POST', body: {
        file_ids: items.map((r) => r.file_id), document_type: target,
      } });
      toast.show({ tone: result.updated.length ? 'ok' : 'info', message: bulkResultText(result) });
      setSelected(new Set());
      setAttempt((n) => n + 1);
    } catch (e) {
      toast.show({ tone: 'err', message: errorText(e, '문서 분류를 바꾸지 못했습니다.') });
    } finally { setBulkBusy(false); }
  }
  // 23 — 문서 분류 목록·빠른 구분 묶음(서버 값). 다시 불러오는 동안에도 단추가 사라지지 않게 마지막 응답 값을 들고 있는다
  // (응답이 있으면 그 값을 바로 쓴다 — 효과(effect)가 돌기 전 첫 그림에도 목록이 비지 않게)
  const [lastTypeMeta, setLastTypeMeta] = useState(null);
  const typeMeta = data?.document_type_options
    ? { options: data.document_type_options, groups: data.document_type_groups || [] } : lastTypeMeta;
  useEffect(() => {
    if (data?.document_type_options) setLastTypeMeta({ options: data.document_type_options, groups: data.document_type_groups || [] });
  }, [data]);
  useEffect(() => { setSearch(params.get('q') || ''); }, [params.get('q')]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setData(null);
    api(`/reports?${queryKey}`).then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(reportError(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [queryKey, attempt]);

  function update(patch, keepPage = false) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v) next.set(k, String(v));
    }
    if (!keepPage) { next.delete('offset'); next.delete('file'); }
    setParams(next);
  }

  const scopeCount = (k) => (data?.scopes?.[k] != null ? ` (${data.scopes[k]})` : '');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-n-200 px-5 pt-4">
        <h1 className="text-title font-semibold text-n-900">문서</h1>
        <p className="mt-1 mb-3 text-ui text-n-600">호선 자료와 공용 자료의 보고서·발표자료·계산서 등을 본문(그림 속 글자 포함)까지 찾고, 관련 모델을 함께 확인합니다.</p>
        <nav aria-label="자료 보기" className="flex gap-5 text-ui">
          <Link to="/" className="border-b-2 border-transparent pb-2 text-n-600 hover:text-n-900">전체 자료</Link>
          <Link to="/?unit=file&kind=model" className="border-b-2 border-transparent pb-2 text-n-600 hover:text-n-900">모델</Link>
          <Link to="/reports" aria-current="page" className="border-b-2 border-n-900 pb-2 font-medium text-n-900">문서</Link>
        </nav>
      </header>
      <div className="border-b border-n-200 px-5 py-2">
        <QuickTypes groups={typeMeta?.groups} counts={data?.document_types} selected={docTypes}
                    onChange={(vs) => update({ document_type: vs })} />
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-n-200 px-5 py-3">
        <form onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }} className="flex flex-wrap items-end gap-2">
          <Labeled label="문서 검색"><Input type="search" aria-label="문서 검색어" placeholder="제목, 문서 분류, 본문" value={search} onChange={(e) => setSearch(e.target.value)} /></Labeled>
          <Labeled label="검색 조건"><Select value={params.get('mode') || 'and'} onChange={(e) => update({ mode: e.target.value === 'and' ? '' : e.target.value })}>
            <option value="and">모든 단어 포함</option><option value="or">하나 이상 포함</option><option value="phrase">입력 문구 그대로</option>
          </Select></Labeled>
          <label className="inline-flex h-8 items-center gap-1.5 text-ui text-n-700">
            <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={hybrid}
                   onChange={(e) => update({ retrieval: e.target.checked ? 'hybrid' : '' })} />
            의미 추천 포함
          </label>
          <Button type="submit" variant="secondary" size="sm"><Search size={14} aria-hidden="true" />검색</Button>
        </form>
        <Labeled label="자료 소속"><Select value={params.get('scope') || ''} onChange={(e) => update({ scope: e.target.value })}>
          <option value="">전체</option>{Object.entries(SCOPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}{scopeCount(v)}</option>)}
        </Select></Labeled>
        <TypeFilter options={typeMeta?.options} counts={data?.document_types} selected={docTypes}
                    onChange={(vs) => update({ document_type: vs })} />
        <Labeled label="관련 모델"><Select value={params.get('model') || ''} onChange={(e) => update({ model: e.target.value })}><option value="">전체</option><option value="yes">모델 있음</option><option value="no">문서만</option></Select></Labeled>
        <Labeled label="정렬"><Select value={params.get('sort') || (q ? 'relevance' : 'recent')} onChange={(e) => update({ sort: e.target.value })}><option value="recent">최신순</option><option value="title">파일 이름순</option><option value="relevance">관련도순</option></Select></Labeled>
      </div>
      <div className="space-y-1 border-b border-n-200 px-5 py-2">
        <IndexStatus status={indexStatus} unavailable={statusUnavailable} />
        <p className="text-meta text-n-500">이 화면의 검색은 그림 속 글자(OCR)까지 본문 색인으로 찾습니다. 상단 전체 자료 검색은 OCR 본문을 찾지 않아 결과가 다를 수 있습니다 — OCR 포함 본문 검색은 이 문서 화면에서 하세요. 색인 대기·실패 문서는 기존 본문 추출로 찾습니다.</p>
      </div>
      <div className={`grid min-h-0 flex-1 ${picked ? 'grid-cols-[minmax(300px,1fr)_minmax(420px,1.2fr)] max-[1100px]:grid-cols-1' : 'grid-cols-1'}`}>
        <section aria-label="문서 목록" className="min-w-0 p-5">
          {error && <ErrorNote action={<Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>{error}</ErrorNote>}
          {loading && <p role="status" className="text-ui text-n-500">문서 찾는 중…</p>}
          {data && <p className="mb-3 text-meta text-n-600">문서 <span className="font-mono">{data.total}</span>개{q && data.keyword_total != null && <> · 키워드 일치 <span className="font-mono">{data.keyword_total}</span>개{hybrid && <> · 의미 추천 <span className="font-mono">{data.semantic_total ?? 0}</span>개(관련 후보 일부)</>}</>}</p>}
          {data && q && hybrid && data.semantic_available === false && <p role="status" className="mb-3 text-meta text-n-600">의미 추천 서버를 사용할 수 없어 키워드 일치 결과만 보입니다.</p>}
          {data && selected.size > 0 && <BulkTypeBar count={selected.size} options={typeMeta?.options} busy={bulkBusy}
                                                     onApply={applyBulk} onClear={() => setSelected(new Set())} />}
          {data && data.items.length > 0 && <SelectAll items={data.items} selected={selected} disabled={bulkBusy} onChange={setSelected} />}
          {data && !data.items.length && <div className="py-10 text-center text-ui text-n-600"><FileText size={24} className="mx-auto mb-3 text-n-400" aria-hidden="true" />조건에 맞는 문서가 없습니다.<p className="mt-2 text-meta">BDF 없이 문서만 올릴 수 있습니다. 정리 대기에서 자료를 확정하면 여기에 표시됩니다.</p><Link to="/inbox" className={buttonClass('secondary', 'sm', 'mt-3')}>문서 올리기</Link></div>}
          <ul className="divide-y divide-n-200">{data?.items.map((r) => <li key={r.file_id} className="flex items-start gap-1">
            <label className="flex shrink-0 cursor-pointer items-center py-3.5 pl-3 has-[:disabled]:cursor-not-allowed" title={r.can_edit ? undefined : NO_EDIT_TITLE}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand" aria-label={`${r.name} 선택`}
                     checked={selected.has(r.file_id)} disabled={!r.can_edit || bulkBusy} onChange={() => toggle(r.file_id)} />
            </label>
            <button type="button" aria-pressed={picked === r.file_id} onClick={() => update({ file: r.file_id }, true)} className={`min-w-0 flex-1 rounded-md px-3 py-3 text-left transition-colors hover:bg-n-50 ${picked === r.file_id ? 'bg-brand-subtle' : ''}`}>
              <span className="flex items-center gap-2"><KindBadge kind="report" name={r.name} /><span className="min-w-0 truncate text-ui font-medium text-n-900">{r.name}</span></span>
              <span className="mt-1 block truncate text-meta text-n-600">{r.entry_title}</span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-n-500"><span>{SCOPE_LABELS[r.scope]}</span>{r.hulls?.length > 0 && <span>호선 {r.hulls.join(', ')}</span>}{r.document_type && <span>{r.document_type}{r.document_type_auto && <AutoMark />}</span>}<span>{r.model_count ? `관련 모델 ${r.model_count}개` : '문서만'}</span>{r.posted_at && <span>{formatDateTime(r.posted_at).slice(0, 10)}</span>}</span>
              {q && r.match_type && <span className="mt-1 block text-meta font-medium text-brand">{r.match_type === 'semantic' ? '의미상 관련 추천' : '키워드 일치'}</span>}
              {r.snippets?.slice(0, 3).map((snippet, i) => <Passage key={i} snippet={snippet} />)}
              {r.index_state && INDEX_STATE_LABELS[r.index_state] && <span className="mt-1 block text-meta text-n-500">본문 색인: {INDEX_STATE_LABELS[r.index_state]}</span>}
            </button>
          </li>)}</ul>
          {data && data.total > PAGE_SIZE && <div className="mt-4 flex items-center gap-3 text-meta">
            <Button variant="secondary" size="sm" disabled={offset === 0 || loading} onClick={() => update({ offset: Math.max(0, offset - PAGE_SIZE), file: null }, true)}>이전</Button>
            <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} / {data.total}</span>
            <Button variant="secondary" size="sm" disabled={offset + PAGE_SIZE >= data.total || loading} onClick={() => update({ offset: offset + PAGE_SIZE, file: null }, true)}>다음</Button>
          </div>}
        </section>
        {confirmDialog}
        {picked && <ReportPanel key={picked} fileId={picked} options={typeMeta?.options} onClose={() => update({ file: null }, true)} onSaved={() => setAttempt((n) => n + 1)} />}
      </div>
    </div>
  );
}
