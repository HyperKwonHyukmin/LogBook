import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SearchX, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api/client.js';
import FacetPanel, { FacetList, valueLabel } from '../components/search/FacetPanel.jsx';
import EntryPreviewPanel from '../components/search/EntryPreviewPanel.jsx';
import ResultList, { itemKey } from '../components/search/ResultList.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { FACET_LABELS, errorText } from '../lib/labels.js';
import { FILTER_KEYS, apiQuery, readSearch, writeSearch } from '../lib/search.js';

const PAGE = 50;
const PREVIEW_DELAY_MS = 200;
const UNITS = [{ id: 'entry', label: '문서' }, { id: 'file', label: '파일' }];

/** 이어 붙일 때 이미 있는 항목은 빼고 더한다(그 사이 순위가 바뀌어 겹칠 수 있다). */
function appendUnique(items, more) {
  const seen = new Set(items.map(itemKey));
  return [...items, ...more.filter((it) => !seen.has(itemKey(it)))];
}

const detailPath = (it) => `/e/${it.entry_id}${it.file_id ? `?file=${it.file_id}` : ''}`;

/** 적용된 필터 칩 한 줄 — 필터 열을 접어도 무엇이 걸려 있는지 보인다. */
function AppliedFilters({ filters, applied, facets, onClear, onClearAll }) {
  const keys = FILTER_KEYS.filter((k) => filters[k]);
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-n-200 px-5 py-2">
      {keys.map((k) => {
        const v = applied?.[k] ?? filters[k];
        const label = valueLabel(k, facets?.[k]?.find((f) => f.value === v) || { value: v });
        return (
          <button key={k} type="button" onClick={() => onClear(k)} aria-label={`${FACET_LABELS[k]} ${label} 필터 해제`}
                  className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-n-100 pl-2 pr-1 text-meta text-n-700 transition-colors duration-120 ease-out hover:bg-n-150 hover:text-n-900 active:bg-n-200">
            <span className="text-n-500">{FACET_LABELS[k]}</span>
            <span className={k === 'hull' || k === 'year' ? 'font-mono' : ''}>{label}</span>
            <X size={12} aria-hidden="true" className="text-n-500" />
          </button>
        );
      })}
      {keys.length > 1 && (
        <button type="button" onClick={onClearAll}
                className="h-6 rounded-sm px-1.5 text-meta text-n-600 transition-colors duration-120 hover:bg-n-100 hover:text-n-900">모두 지우기</button>
      )}
    </div>
  );
}

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
  const [attempt, setAttempt] = useState(0); // '다시 시도' 로 같은 검색을 다시 보낸다
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
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Esc 로 미리보기를 닫는다(입력칸·대화상자 안에서 누른 Esc 는 그쪽 몫).
  useEffect(() => {
    if (!preview) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || filtersOpen) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"]'))) return;
      closePreview();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, filtersOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const filterCount = FILTER_KEYS.filter((k) => state.filters[k]).length;
  // 미리보기가 열리면 1600px 미만에서는 필터 열을 접고 머리말의 '필터' 단추로 펼친다(1366 에서 결과 열 확보).
  const collapse = !!preview;

  return (
    <div className="relative flex h-full min-h-0">
      <FacetPanel {...facetProps} className={collapse ? 'hidden min-[1600px]:block' : ''} />
      {preview && filtersOpen && (
        <div role="dialog" aria-label="필터" aria-modal="true" className="absolute inset-0 z-20 flex min-[1600px]:hidden"
             onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setFiltersOpen(false); } }}>
          <div className="w-[248px] animate-panel overflow-auto bg-n-50 px-2 pb-3 shadow-lg">
            <div className="flex h-12 items-center justify-between px-2">
              <span className="text-ui font-semibold text-n-900">필터</span>
              <button type="button" aria-label="필터 닫기" onClick={() => setFiltersOpen(false)} className={buttonClass('ghost', 'icon-sm')}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <FacetList {...facetProps} />
          </div>
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setFiltersOpen(false)} className="flex-1 animate-fade bg-scrim" />
        </div>
      )}
      <section aria-label="결과" className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-n-200 px-5">
          {collapse && (
            <Button variant="secondary" size="sm" className="min-[1600px]:hidden" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen}>
              <SlidersHorizontal size={14} aria-hidden="true" />필터
              {filterCount > 0 && <span aria-hidden="true" className="font-mono text-micro text-brand">{filterCount}</span>}
            </Button>
          )}
          <h1 className="tnum text-ui font-semibold text-n-900">{res ? `결과 ${res.total}건` : '검색'}</h1>
          <Segmented label="보기 단위" items={UNITS} value={state.unit} onChange={(v) => update({ unit: v })} />
          <label className="flex cursor-pointer items-center gap-1.5 text-meta text-n-700 hover:text-n-900">
            <input type="checkbox" checked={state.drafts} onChange={(e) => update({ drafts: e.target.checked })}
                   className="h-3.5 w-3.5 cursor-pointer accent-brand" />
            미확정 포함
          </label>
        </div>
        {loading && res && (
          <div role="progressbar" aria-label="검색 중" className="absolute inset-x-0 top-12 z-10 h-0.5 overflow-hidden">
            <div className="progress-indeterminate h-full w-[30%] animate-progress bg-brand" />
          </div>
        )}
        {sug && curHull !== sug.hull_no && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-n-200 bg-n-25 px-5 py-2 text-meta text-n-600">
            <span>검색어의 <span className="font-mono text-n-900">{sug.hull_no}</span> 는 호선 번호로 보입니다{!sug.known && ' (등록 안 된 번호)'}.</span>
            <Button variant="secondary" size="sm" onClick={() => setFilter('hull', sug.hull_no)}>
              호선 <span className="font-mono">{sug.hull_no}</span> 로 {curHull ? '바꾸기' : '좁히기'}
            </Button>
          </div>
        )}
        <AppliedFilters filters={state.filters} applied={res?.applied_filters} facets={res?.facets}
                        onClear={(k) => setFilter(k, null)} onClearAll={() => update({ filters: {} })} />
        <div className="min-h-0 flex-1 overflow-auto">
          {error && (
            <ErrorNote className="mx-5 mt-4"
                       action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>
              {error}
            </ErrorNote>
          )}
          {loading && !res && <RowsSkeleton rows={5} label="검색 중" />}
          {res && res.items.length === 0 && !loading && (
            <EmptyState icon={SearchX} title="찾는 자료가 없습니다">검색어를 줄이거나 필터를 해제해 보세요. 띄어 쓴 낱말은 모두 맞아야 합니다.</EmptyState>
          )}
          {res && res.items.length > 0 && (
            <>
              <ResultList unit={res.unit} items={res.items} selectedKey={selected && itemKey(selected)}
                          onSelect={select} onOpen={open} terms={res.terms} />
              {res.nextOffset < res.total && (
                <div className="flex justify-center py-4">
                  <Button variant="secondary" onClick={loadMore} disabled={loading} loading={more}>더 보기</Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {preview && (
        <EntryPreviewPanel entryId={preview.entry_id} fileId={preview.file_id} onClose={closePreview} />
      )}
    </div>
  );
}
