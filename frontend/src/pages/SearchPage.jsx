import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SearchX, SlidersHorizontal, Star, X } from 'lucide-react';
import { api } from '../api/client.js';
import FacetPanel, { FacetList, isMonoValue, valueLabel } from '../components/search/FacetPanel.jsx';
import EntryPreviewPanel from '../components/search/EntryPreviewPanel.jsx';
import usePreviewWidth, { PreviewResizer } from '../components/search/usePreviewWidth.jsx';
import ResultList, { itemKey } from '../components/search/ResultList.jsx';
import ResultSummary from '../components/search/ResultSummary.jsx';
import GroupedResults, { slotItems } from '../components/search/GroupedResults.jsx';
import { useBasketBarVisible } from '../components/compare/CompareBasket.jsx';
import Button, { buttonClass } from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { ErrorNote } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented } from '../components/ui/Tabs.jsx';
import { FACET_LABELS, errorText } from '../lib/labels.js';
import {
  FILTER_KEYS, GROUPS, apiQuery, defaultSort, filterValues, readSearch, sortsFor, toggleFilterValue, writeSearch,
} from '../lib/search.js';
import { useSearchGroupPref } from '../lib/searchGroup.js';
import { selectClass } from '../components/ui/Field.jsx';

const PAGE = 50;
const GROUP_ROWS = 5;     // 묶음마다 처음에 보이는 행(11)
const GROUP_PAGE = 30;    // 한 번에 받는 묶음 수
const GROUP_MORE = 20;    // 묶음 '더 보기' 한 번에 더하는 행
const PREVIEW_DELAY_MS = 200;
const UNITS = [{ id: 'entry', label: '문서' }, { id: 'file', label: '파일' }];

/** 이어 붙일 때 이미 있는 항목은 빼고 더한다(그 사이 순위가 바뀌어 겹칠 수 있다). */
function appendUnique(items, more) {
  const seen = new Set(items.map(itemKey));
  return [...items, ...more.filter((it) => !seen.has(itemKey(it)))];
}

const detailPath = (it) => `/e/${it.entry_id}${it.file_id ? `?file=${it.file_id}` : ''}`;

/**
 * 적용된 필터 칩 한 줄 — 필터 열을 접어도 무엇이 걸려 있는지 보인다.
 * 19 — 값마다 칩 하나(눌러 그 값만 해제). 같은 칸의 값 사이에는 '또는' 을 넣어 OR 임을 보인다.
 */
function AppliedFilters({ filters, applied, facets, onClear, onClearAll }) {
  // 서버가 정리한 값(동의어 → 대표 값)이 있으면 그것으로 — 칸마다 목록
  const chips = FILTER_KEYS.flatMap((k) => {
    const vs = filterValues(applied?.[k] != null ? applied : filters, k);
    return vs.map((v, i) => ({ k, v, first: i === 0 }));
  });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-n-200 px-5 py-2">
      {chips.map(({ k, v, first }) => {
        const label = valueLabel(k, facets?.[k]?.find((f) => f.value === v) || { value: v });
        return (
          <span key={`${k}:${v}`} className="inline-flex items-center gap-1.5">
            {!first && <span className="text-meta text-n-500">또는</span>}
            <button type="button" onClick={() => onClear(k, v)} aria-label={`${FACET_LABELS[k]} ${label} 필터 해제`}
                    className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-n-100 pl-2 pr-1 text-meta text-n-700 transition-colors duration-150 ease-out hover:bg-n-150 hover:text-n-900 active:bg-n-200">
              <span className="text-n-500">{FACET_LABELS[k]}</span>
              <span className={isMonoValue(k, v) ? 'font-mono' : ''}>{label}</span>
              <X size={12} aria-hidden="true" className="text-n-500" />
            </button>
          </span>
        );
      })}
      {chips.length > 1 && (
        <button type="button" onClick={onClearAll}
                className="h-6 rounded-sm px-1.5 text-meta text-n-600 transition-colors duration-150 hover:bg-n-100 hover:text-n-900">모두 지우기</button>
      )}
    </div>
  );
}

/** 묶어 보기 응답(11)이면 묶음마다 행에 자리 열쇠를 붙인다. */
function withGroups(r) {
  if (!Array.isArray(r.groups)) return r;
  return { ...r, groups: r.groups.map((g, gi) => ({ ...g, items: slotItems(g.items, gi) })) };
}

/** 검색(홈) — 주소가 검색 상태의 원본이다(설계 §6.1·§6.2). */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // 11 — 주소에 보기 기준이 없으면 마지막으로 고른 기준(사용자 설정)으로 묶는다
  const [prefGroup, choosePrefGroup] = useSearchGroupPref();
  // 순서만 다른 주소(상단 바는 q 를 뒤에 붙인다)나 모르는 질의는 같은 검색으로 본다.
  const parsed = readSearch(params);
  const key = writeSearch(parsed.group ? parsed : { ...parsed, group: prefGroup, gsort: '' }).toString();
  const state = useMemo(() => readSearch(new URLSearchParams(key)), [key]);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  // selected = 목록의 강조(바로 옮겨 감), preview = 패널에 여는 항목(키보드는 잠시 멈춘 뒤에만 연다)
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set()); // 접은 묶음 번호(11)
  const [attempt, setAttempt] = useState(0); // '다시 시도' 로 같은 검색을 다시 보낸다
  const basketBar = useBasketBarVisible();
  const reqRef = useRef(0);
  const previewTimer = useRef(null);
  const areaRef = useRef(null);
  const facetRef = useRef(null);

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // 기억한 보기 기준을 주소에도 적는다(그대로 복사해 보내면 같은 묶음으로 열린다). 검색은 다시 하지 않는다(key 같음).
  useEffect(() => {
    if (state.group && !params.get('group')) setParams(writeSearch(state), { replace: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = ++reqRef.current; // 늦게 온 옛 응답은 버린다
    setLoading(true); setMore(false); setError('');
    clearTimeout(previewTimer.current); setSelected(null); setPreview(null); setCollapsed(new Set());
    api(apiQuery(state, { limit: PAGE, offset: 0, groupRows: GROUP_ROWS, groupLimit: GROUP_PAGE }))
      .then((r) => { if (id === reqRef.current) setRes(withGroups({ ...r, nextOffset: r.items.length })); })
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
  /** 칸 하나를 값 하나로 바꾸거나(v) 비운다(null) — 호선 제안 배너·묶음 머리 '거르기'. */
  function setFilter(k, v) {
    const filters = { ...state.filters };
    if (v) filters[k] = [v]; else delete filters[k];
    update({ filters });
  }
  /**
   * 칸 안 값 하나를 켜고 끈다(19 — 같은 칸 안은 OR). 필터 열·요약 띠·칩 해제.
   * 화면은 서버가 정리한 대표 값(applied_filters: ER → Engine Room)을 보이므로, 그 칸은 대표 값 기준으로 켜고 끈다 —
   * 주소의 동의어 값을 그대로 두면 대표 값을 '해제' 해도 동의어가 남는다.
   */
  function toggleFilter(k, v) {
    const base = { ...state.filters };
    const cur = filterValues(state.filters, k);
    const applied = filterValues(res?.applied_filters, k);
    // 응답이 지금 주소와 같은 값 수일 때만(빠르게 연달아 누르면 옛 응답의 값으로 덮지 않게)
    if (applied.length && applied.length === cur.length && cur.some((x) => !applied.includes(x))) base[k] = applied;
    update({ filters: toggleFilterValue(base, k, v) });
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
  /** 묶음 하나 더 보기 — 같은 정렬로 그 묶음의 다음 행(11). */
  async function moreInGroup(gi) {
    const id = reqRef.current;
    const g = res.groups[gi];
    const patchGroup = (p) => setRes((cur) => ({ ...cur, groups: cur.groups.map((x, i) => (i === gi ? { ...x, ...p(x) } : x)) }));
    patchGroup(() => ({ loading: true }));
    try {
      const r = await api(apiQuery(state, { limit: GROUP_MORE, offset: g.items.length, groupValue: g.value }));
      if (id === reqRef.current) {
        patchGroup((x) => ({ items: appendUnique(x.items, slotItems(r.items, gi)), count: r.total, loading: false }));
      }
    } catch (err) {
      if (id === reqRef.current) { patchGroup(() => ({ loading: false })); setError(errorText(err, '검색하지 못했습니다.')); }
    }
  }
  /** 묶음이 많을 때 다음 묶음들. */
  async function moreGroups() {
    const id = reqRef.current;
    setMore(true);
    try {
      const r = await api(apiQuery(state, { limit: PAGE, groupRows: GROUP_ROWS, groupLimit: GROUP_PAGE, groupOffset: res.groups.length }));
      if (id === reqRef.current) {
        setRes((cur) => ({ ...cur, group_total: r.group_total,
          groups: [...cur.groups, ...r.groups.map((g, i) => ({ ...g, items: slotItems(g.items, cur.groups.length + i) }))] }));
      }
    } catch (err) {
      if (id === reqRef.current) setError(errorText(err, '검색하지 못했습니다.'));
    } finally {
      if (id === reqRef.current) setMore(false);
    }
  }
  /** 보기 기준을 고른다 — 주소에 적고, 다음에 검색을 열 때도 이 기준으로 묶이게 사용자 설정에 남긴다. */
  function chooseGroup(v) {
    choosePrefGroup(v);
    update({ group: v, gsort: '' });
  }
  const toggleGroup = (gi) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(gi)) next.delete(gi); else next.add(gi);
    return next;
  });
  const open = (it) => navigate(detailPath(it));
  const sug = res?.hull_suggestion;
  const curHulls = filterValues(state.filters, 'hull');
  const facetProps = { facets: res?.facets, filters: state.filters, applied: res?.applied_filters, onChange: toggleFilter };
  const filterCount = FILTER_KEYS.reduce((n, k) => n + filterValues(state.filters, k).length, 0);
  // 미리보기가 열리면 1600px 미만에서는 필터 열을 접고 머리말의 '필터' 단추로 펼친다(1366 에서 결과 열 확보).
  const collapse = !!preview;
  // 정렬(08·15) — 주소에 없으면 검색어가 있을 때 관련도, 없을 때 최신순(올린 날짜)
  const sortValue = state.sort || defaultSort(state.q, state.fav);
  const sorts = sortsFor(state.fav);
  // 미리보기 폭(09) — 결과 열 480px·작업 영역 70% 안에서 사용자가 끌어 바꾼다
  const pane = usePreviewWidth({ areaRef, reservedRef: facetRef, active: !!preview });
  const grouped = Array.isArray(res?.groups) ? res : null;
  const shownCount = grouped ? grouped.groups.length : (res?.items.length || 0);

  return (
    <div ref={areaRef} className="relative flex h-full min-h-0">
      <FacetPanel ref={facetRef} {...facetProps} className={collapse ? 'hidden min-[1600px]:block' : ''} />
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
      <section aria-label="결과" className="@container/results relative flex min-w-0 flex-1 flex-col">
        {/* 결과 열이 좁으면(미리보기를 넓게 끌었을 때) 머리말이 두 줄로 접힌다 — 정렬이 잘리지 않게(10) */}
        <div className="relative flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-n-200 px-5 py-2">
          {collapse && (
            <Button variant="secondary" size="sm" className="min-[1600px]:hidden" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen}>
              <SlidersHorizontal size={14} aria-hidden="true" />필터
              {filterCount > 0 && <span aria-hidden="true" className="font-mono text-micro text-brand">{filterCount}</span>}
            </Button>
          )}
          <h1 className="tnum whitespace-nowrap text-ui font-semibold text-n-900">
            {/* 건수는 지금 보기와 같은 종류의 응답일 때만 — 즐겨찾기로 바꾼 직전의 옛 검색 건수를 '즐겨찾기 N건' 으로 보이지 않게 */}
            {state.fav ? (res?.favorites_only ? `즐겨찾기 ${res.total}건` : '즐겨찾기')
              : (res && !res.favorites_only ? `결과 ${res.total}건` : '검색')}
            {grouped && <span className="font-normal text-n-500"> · 묶음 {grouped.group_total}개</span>}
          </h1>
          <Segmented label="보기 단위" items={UNITS} value={state.unit} onChange={(v) => update({ unit: v })} />
          {/* 10 — 내 즐겨찾기만. 켜면 미확정도 함께 보이므로 '미확정 포함' 은 숨긴다 */}
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-meta text-n-700 hover:text-n-900">
            <input type="checkbox" checked={state.fav} onChange={(e) => update({ fav: e.target.checked })}
                   className="h-3.5 w-3.5 cursor-pointer accent-brand" />
            즐겨찾기만
          </label>
          {!state.fav && (
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-meta text-n-700 hover:text-n-900">
              <input type="checkbox" checked={state.drafts} onChange={(e) => update({ drafts: e.target.checked })}
                     className="h-3.5 w-3.5 cursor-pointer accent-brand" />
              미확정 포함
            </label>
          )}
          {/* 11 — 보기 기준: 결과를 호선·구역·대상·올린 사람 값으로 묶는다(문서 보기에서만) */}
          <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-meta text-n-600"
                 title={state.unit === 'file' ? '파일 보기에서는 묶지 않습니다' : '결과를 속성 값으로 묶어 봅니다'}>
            보기
            <select aria-label="보기 기준" value={state.unit === 'file' ? '' : state.group} disabled={state.unit === 'file'}
                    onChange={(e) => chooseGroup(e.target.value)} className={selectClass('h-7 text-meta')}>
              <option value="">묶지 않음</option>
              {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          {grouped && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-meta text-n-600">
              묶음
              <select aria-label="묶음 순서" value={state.gsort || 'count'} onChange={(e) => update({ gsort: e.target.value === 'name' ? 'name' : '' })}
                      className={selectClass('h-7 text-meta')}>
                <option value="count">건수순</option>
                <option value="name">이름순</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 whitespace-nowrap text-meta text-n-600">
            정렬
            <select aria-label="정렬" value={sortValue} onChange={(e) => update({ sort: e.target.value === defaultSort(state.q, state.fav) ? '' : e.target.value })}
                    className={selectClass('h-7 text-meta')}>
              {sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          {loading && res && (
            <div role="progressbar" aria-label="검색 중" className="absolute inset-x-0 -bottom-px z-10 h-0.5 overflow-hidden">
              <div className="progress-indeterminate h-full w-[30%] animate-progress bg-brand" />
            </div>
          )}
        </div>
        {sug && !curHulls.includes(sug.hull_no) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-n-200 bg-n-25 px-5 py-2 text-meta text-n-600">
            <span>검색어의 <span className="font-mono text-n-900">{sug.hull_no}</span> 는 호선 번호로 보입니다{!sug.known && ' (등록 안 된 번호)'}.</span>
            <Button variant="secondary" size="sm" onClick={() => setFilter('hull', sug.hull_no)}>
              호선 <span className="font-mono">{sug.hull_no}</span> 로 {curHulls.length ? '바꾸기' : '좁히기'}
            </Button>
          </div>
        )}
        <AppliedFilters filters={state.filters} applied={res?.applied_filters} facets={res?.facets}
                        onClear={toggleFilter} onClearAll={() => update({ filters: {} })} />
        <div className="min-h-0 flex-1 overflow-auto">
          {error && (
            <ErrorNote className="mx-5 mt-4"
                       action={<Button variant="ghost" size="sm" className="-my-1" onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>
              {error}
            </ErrorNote>
          )}
          {loading && !res && <RowsSkeleton rows={5} label="검색 중" />}
          {res && shownCount === 0 && !loading && (
            state.fav && !state.q && filterCount === 0 ? (
              <EmptyState icon={Star} title="즐겨찾기한 자료가 없습니다"
                          action={<Link to="/" className={buttonClass('secondary', 'sm')}>검색으로 가기</Link>}>
                검색 결과나 자료 화면에서 별 단추를 누르면 여기에 모입니다. 다른 PC에서 로그인해도 같은 목록이 보입니다.
              </EmptyState>
            ) : (
              <EmptyState icon={SearchX} title={state.fav ? '즐겨찾기 중 맞는 자료가 없습니다' : '찾는 자료가 없습니다'}>
                검색어를 줄이거나 필터를 해제해 보세요. 띄어 쓴 낱말은 모두 맞아야 합니다.
              </EmptyState>
            )
          )}
          {res && shownCount > 0 && (
            <>
              {/* 09 — 맞은 자료 전체 요약(문서 보기에서만 — 요약은 자료 단위다) */}
              {res.unit === 'entry' && (
                <ResultSummary summary={res.summary} filters={res.applied_filters || state.filters} onFilter={toggleFilter} />
              )}
              {grouped ? (
                <>
                  <GroupedResults by={grouped.group} groups={grouped.groups} collapsed={collapsed} onToggle={toggleGroup}
                                  onMore={moreInGroup} onFilter={(v) => setFilter(grouped.group, v)} multiValued={grouped.multi_valued}
                                  selectedKey={selected && itemKey(selected)} onSelect={select} onOpen={open}
                                  terms={res.terms} filters={res.applied_filters || state.filters} />
                  {grouped.groups.length < grouped.group_total && (
                    <div className="flex justify-center py-4">
                      <Button variant="secondary" onClick={moreGroups} disabled={loading} loading={more}>
                        묶음 더 보기 <span className="tnum text-n-500">남은 <span className="font-mono">{grouped.group_total - grouped.groups.length}</span>개</span>
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <ResultList unit={res.unit} items={res.items} selectedKey={selected && itemKey(selected)}
                            onSelect={select} onOpen={open} terms={res.terms} filters={res.applied_filters || state.filters} />
              )}
              {!grouped && res.nextOffset < res.total && (
                <div className="flex justify-center py-4">
                  <Button variant="secondary" onClick={loadMore} disabled={loading} loading={more}>더 보기</Button>
                </div>
              )}
              {/* 비교 바구니 띠(07)가 마지막 행·'더 보기' 를 가리지 않게 */}
              {basketBar && <div aria-hidden="true" className="h-24" />}
            </>
          )}
        </div>
      </section>
      {preview && (
        <EntryPreviewPanel entryId={preview.entry_id} fileId={preview.file_id} onClose={closePreview}
                           width={pane.width} panelRef={pane.panelRef} resizer={<PreviewResizer handleProps={pane.handleProps} />} />
      )}
    </div>
  );
}
