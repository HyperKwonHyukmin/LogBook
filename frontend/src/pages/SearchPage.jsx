import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SearchX, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api/client.js';
import FacetPanel, { FacetList } from '../components/search/FacetPanel.jsx';
import EntryPreviewPanel from '../components/search/EntryPreviewPanel.jsx';
import ResultList, { itemKey } from '../components/search/ResultList.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText } from '../lib/labels.js';
import { apiQuery, readSearch, writeSearch } from '../lib/search.js';

const PAGE = 50;
const PREVIEW_DELAY_MS = 200;

/** 이어 붙일 때 이미 있는 항목은 빼고 더한다(그 사이 순위가 바뀌어 겹칠 수 있다). */
function appendUnique(items, more) {
  const seen = new Set(items.map(itemKey));
  return [...items, ...more.filter((it) => !seen.has(itemKey(it)))];
}

const detailPath = (it) => `/e/${it.entry_id}${it.file_id ? `?file=${it.file_id}` : ''}`;

/** 검색(홈) — 주소가 검색 상태의 원본이다(설계 §6.1·§6.2). */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // 순서만 다른 주소(상단 바는 q 를 뒤에 붙인다)나 모르는 질의는 같은 검색으로 본다.
  const key = writeSearch(readSearch(params)).toString();
  const state = useMemo(() => readSearch(new URLSearchParams(key)), [key]);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  // selected = 목록의 강조(바로 옮겨 감), preview = 패널에 여는 항목(키보드는 잠시 멈춘 뒤에만 연다)
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const reqRef = useRef(0);
  const previewTimer = useRef(null);

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  useEffect(() => {
    const id = ++reqRef.current; // 늦게 온 옛 응답은 버린다
    setLoading(true); setMore(false); setError('');
    clearTimeout(previewTimer.current); setSelected(null); setPreview(null);
    api(apiQuery(state, { limit: PAGE, offset: 0 }))
      .then((r) => { if (id === reqRef.current) setRes({ ...r, nextOffset: r.items.length }); })
      .catch((err) => { if (id === reqRef.current) { setRes(null); setError(errorText(err, '검색하지 못했습니다.')); } })
      .finally(() => { if (id === reqRef.current) setLoading(false); });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ↑/↓ 로 훑을 때마다 미리보기(Entry·PDF)를 다시 받지 않게, 멈춘 항목만 연다. 마우스는 바로 연다. */
  function select(it, { immediate = false } = {}) {
    setSelected(it);
    clearTimeout(previewTimer.current);
    if (immediate) setPreview(it);
    else previewTimer.current = setTimeout(() => setPreview(it), PREVIEW_DELAY_MS);
  }
  function closePreview() {
    clearTimeout(previewTimer.current);
    setSelected(null); setPreview(null); setFiltersOpen(false);
  }

  function update(patch) {
    setParams(writeSearch({ ...state, ...patch }));
  }
  function setFilter(k, v) {
    const filters = { ...state.filters };
    if (v) filters[k] = v; else delete filters[k];
    update({ filters });
  }
  async function loadMore() {
    const id = reqRef.current;
    setMore(true);
    try {
      const r = await api(apiQuery(state, { limit: PAGE, offset: res.nextOffset }));
      if (id === reqRef.current) {
        setRes((cur) => ({ ...cur, items: appendUnique(cur.items, r.items), total: r.total, nextOffset: cur.nextOffset + r.items.length }));
      }
    } catch (err) {
      if (id === reqRef.current) setError(errorText(err, '검색하지 못했습니다.'));
    } finally {
      if (id === reqRef.current) setMore(false);
    }
  }
  const open = (it) => navigate(detailPath(it));
  const sug = res?.hull_suggestion;
  const curHull = state.filters.hull;
  const facetProps = { facets: res?.facets, filters: state.filters, applied: res?.applied_filters, onChange: setFilter };

  return (
    <div className="relative flex h-full min-h-0">
      {/* 미리보기가 열린 좁은 화면(<1280px)에서는 필터를 접고 버튼으로 펼친다. */}
      <FacetPanel {...facetProps} className={preview ? 'hidden xl:block' : ''} />
      {preview && filtersOpen && (
        <div role="dialog" aria-label="필터" aria-modal="true" className="absolute inset-0 z-20 flex xl:hidden">
          <div className="w-60 overflow-auto border-r border-line bg-white px-3 shadow-lg">
            <div className="flex items-center justify-between pt-3">
              <span className="text-xs font-semibold text-zinc-700">필터</span>
              <button type="button" aria-label="필터 닫기" onClick={() => setFiltersOpen(false)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><X size={15} aria-hidden="true" /></button>
            </div>
            <FacetList {...facetProps} />
          </div>
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setFiltersOpen(false)} className="flex-1 bg-zinc-900/20" />
        </div>
      )}
      <section className="min-w-0 flex-1 overflow-auto p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {preview && (
            <Button variant="secondary" size="sm" className="xl:hidden" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen}>
              <SlidersHorizontal size={13} aria-hidden="true" />필터
            </Button>
          )}
          <h1 className="text-sm font-semibold text-zinc-800">{res ? `결과 ${res.total}건` : '검색'}</h1>
          <div role="radiogroup" aria-label="보기 단위" className="flex rounded-md border border-line bg-white p-0.5 text-xs">
            {[['entry', 'Entry'], ['file', '파일']].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={state.unit === v} onClick={() => update({ unit: v })}
                      className={`h-6 rounded px-2.5 ${state.unit === v ? 'bg-brand text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-700">
            <input type="checkbox" checked={state.drafts} onChange={(e) => update({ drafts: e.target.checked })} className="accent-brand" />
            미확정 포함
          </label>
          {sug && curHull !== sug.hull_no && (
            <Button variant="secondary" size="sm" onClick={() => setFilter('hull', sug.hull_no)}>
              호선 <span className="font-mono">{sug.hull_no}</span> 로 {curHull ? '바꾸기' : '좁히기'}{!sug.known && ' (등록 안 된 번호)'}
            </Button>
          )}
        </div>
        {error && <p role="alert" className="mb-3 text-[13px] text-err">{error}</p>}
        {loading && !res && (
          <div aria-hidden="true" className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-200/60" />)}</div>
        )}
        {res && res.items.length === 0 && !loading && (
          <EmptyState icon={SearchX} title="찾는 자료가 없습니다">검색어를 줄이거나 필터를 해제해 보세요. 띄어 쓴 낱말은 모두 맞아야 합니다.</EmptyState>
        )}
        {res && res.items.length > 0 && (
          <div className={loading ? 'opacity-60' : ''}>
            <ResultList unit={res.unit} items={res.items} selectedKey={selected && itemKey(selected)}
                        onSelect={select} onOpen={open} />
            {res.nextOffset < res.total && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" onClick={loadMore} disabled={more || loading}>더 보기</Button>
              </div>
            )}
          </div>
        )}
      </section>
      {preview && (
        <EntryPreviewPanel entryId={preview.entry_id} fileId={preview.file_id} onClose={closePreview} />
      )}
    </div>
  );
}
