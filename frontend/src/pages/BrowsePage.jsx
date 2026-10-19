import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Link2, ListTree, Search } from 'lucide-react';
import { api } from '../api/client.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { buttonClass } from '../components/ui/Button.jsx';
import { inputClass } from '../components/ui/Field.jsx';
import { ErrorNote, Page, PageHeader } from '../components/ui/Page.jsx';
import { RowsSkeleton } from '../components/ui/Skeleton.jsx';
import { Segmented, Tabs } from '../components/ui/Tabs.jsx';
import { isMonoValue, matchesFilter, valueLabel } from '../components/search/FacetPanel.jsx';
import { FACET_LABELS, errorText } from '../lib/labels.js';
import { writeSearch } from '../lib/search.js';

/** 분류 화면의 속성 순서(09) — 검색 필터 차원 전부. */
export const BROWSE_KEYS = ['zone', 'analysis_type', 'target', 'hull', 'ship_type', 'tag', 'kind', 'uploaded_by'];
const DEFAULT_KEY = 'zone';
const SORTS = [{ id: 'count', label: '건수순' }, { id: 'name', label: '이름순' }];
const VOCAB_KEYS = new Set(['zone', 'analysis_type', 'target']);
const COLS = 'grid grid-cols-[minmax(0,1fr)_minmax(80px,200px)_56px] items-center gap-4';

/** 값 하나로 거른 검색 주소 — '미확정 포함'으로 셌으면 검색도 같은 조건으로 연다. */
const valueHref = (key, value, drafts) => `/?${writeSearch({ filters: { [key]: [value] }, drafts })}`;

/** 이름순 — 한글 순(숫자는 크기 순). */
function byName(key) {
  return (a, b) => valueLabel(key, a).localeCompare(valueLabel(key, b), 'ko', { numeric: true });
}

/** 거르기 — 값·라벨(선종·이름)·동의어(공백·대소문자 무시). 19 — 검색 필터 칸 안 찾기와 같은 함수(FacetPanel). */
export { matchesFilter };

function ValueRow({ field, f, max, drafts }) {
  const label = valueLabel(field, f);
  const empty = f.count === 0;
  const pct = max > 0 ? Math.max(2, Math.round((f.count / max) * 100)) : 0;
  const secondary = field === 'hull' ? f.label : field === 'uploaded_by' && f.label ? f.value : null;
  return (
    <li className={`${COLS} min-h-10 border-b border-n-200 px-3 py-1.5 text-ui last:border-0 ${empty ? '' : 'transition-colors duration-150 hover:bg-n-50'}`}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {empty ? (
          <span className={`text-n-500 ${isMonoValue(field, f.value) ? 'font-mono' : ''}`} title="아직 이 값을 쓴 자료가 없습니다">{label}</span>
        ) : (
          <Link to={valueHref(field, f.value, drafts)} title={`${FACET_LABELS[field]} ‘${label}’ 로 찾기`}
                className={`min-w-0 truncate rounded-xs font-medium text-n-900 underline-offset-2 hover:text-brand hover:underline ${isMonoValue(field, f.value) ? 'font-mono' : ''}`}>
            {label}
          </Link>
        )}
        {secondary && <span className={`text-meta text-n-500 ${field === 'uploaded_by' ? 'font-mono' : ''}`}>{secondary}</span>}
        {f.aliases?.length > 0 && (
          <span className="min-w-0 truncate text-meta text-n-500" title={f.aliases.join(', ')}>동의어 {f.aliases.join(', ')}</span>
        )}
        {VOCAB_KEYS.has(field) && f.listed === false && (
          <span className="text-meta text-n-500" title="분류 목록에 없는 값 — 관리자가 분류 목록에서 합칠 수 있습니다">목록 밖</span>
        )}
      </span>
      {/* 건수 막대 — 한 색(옅은 남색), 수치는 오른쪽 글자로 함께 보인다 */}
      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-n-100">
        <span className="block h-full rounded-full bg-brand/35" style={{ width: `${pct}%` }} />
      </span>
      <span className={`text-right font-mono text-meta ${empty ? 'text-n-500' : 'text-n-700'}`}>{f.count}</span>
    </li>
  );
}

/**
 * 분류(09) — 속성(호선·선종·구역·해석 종류·파일 종류·태그·올린 사람)마다 모든 값과 자료 수.
 * 값을 누르면 그 값으로 거른 검색으로 간다. 구역·해석 종류는 대표 값으로 세고(동의어는 함께 보인다),
 * 관리(용어·동의어)는 관리자의 '분류 목록', 자유 태그 동의어는 '태그 동의어' 화면에서 한다.
 */
export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const field = BROWSE_KEYS.includes(params.get('by')) ? params.get('by') : DEFAULT_KEY;
  const drafts = params.get('drafts') === '1';
  const isAdmin = !!useContext(AuthContext)?.user?.is_admin;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('count');
  const [attempt, setAttempt] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    setError('');
    api(`/search/browse${drafts ? '?drafts=true' : ''}`)
      .then((r) => { if (id === reqRef.current) setData(r); })
      .catch((err) => { if (id === reqRef.current) setError(errorText(err, '분류를 불러오지 못했습니다.')); });
  }, [drafts, attempt]);

  function update(patch) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  }

  const items = data?.facets?.[field] || [];
  const shown = items.filter((f) => matchesFilter(field, f, filter));
  if (sort === 'name') shown.sort(byName(field));
  const max = Math.max(0, ...items.map((f) => f.count));
  const tabs = BROWSE_KEYS.map((k) => ({ id: k, label: FACET_LABELS[k], count: data ? data.facets[k]?.filter((f) => f.count > 0).length ?? 0 : null, tabId: `browse-tab-${k}` }));

  const actions = (
    <>
      {VOCAB_KEYS.has(field) && isAdmin && (
        <Link to="/admin/vocab" className={buttonClass('secondary', 'sm')}><ListTree size={14} aria-hidden="true" />분류 목록 관리</Link>
      )}
      {field === 'tag' && (
        <Link to="/tags/manage" className={buttonClass('secondary', 'sm')}><Link2 size={14} aria-hidden="true" />태그 동의어 묶기·풀기</Link>
      )}
    </>
  );

  return (
    <Page>
      <PageHeader title="분류"
                  description="속성마다 어떤 값이 몇 건 있는지 봅니다. 값을 누르면 그 값으로 거른 검색이 열립니다. 구역·해석 종류·태그는 동의어를 대표 값으로 묶어 셉니다." />
      <Tabs label="속성" items={tabs} value={field} controls="browse-panel" onChange={(k) => { update({ by: k === DEFAULT_KEY ? null : k }); setFilter(''); }}
            className="mb-4 overflow-x-auto" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className={inputClass('flex w-60 items-center gap-2 px-2')}>
          <Search size={14} className="shrink-0 text-n-500" aria-hidden="true" />
          <input type="search" aria-label={`${FACET_LABELS[field]} 값 거르기`} value={filter} onChange={(e) => setFilter(e.target.value)}
                 placeholder="값·동의어로 거르기" className="min-w-0 flex-1 bg-transparent text-ui outline-none focus-visible:outline-none" />
        </label>
        <Segmented label="정렬" items={SORTS} value={sort} onChange={setSort} />
        <label className="flex cursor-pointer items-center gap-1.5 text-meta text-n-700 hover:text-n-900">
          <input type="checkbox" checked={drafts} onChange={(e) => update({ drafts: e.target.checked ? '1' : null })}
                 className="h-3.5 w-3.5 cursor-pointer accent-brand" />
          미확정 포함
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {error && (
        <ErrorNote className="mb-4 max-w-[880px]"
                   action={<button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass('ghost', 'sm', '-my-1')}>다시 시도</button>}>
          {error}
        </ErrorNote>
      )}
      <section id="browse-panel" role="tabpanel" aria-labelledby={`browse-tab-${field}`} className="max-w-[880px] overflow-hidden rounded-lg border border-n-200">
        <div className={`${COLS} h-9 border-b border-n-200 bg-n-50 px-3 text-meta font-medium text-n-600`}>
          <span>{FACET_LABELS[field]}{data && <span className="ml-1.5 font-normal text-n-500">{`${shown.length}개 값`}</span>}</span>
          <span aria-hidden="true" />
          <span className="text-right">자료</span>
        </div>
        {!data && !error && <RowsSkeleton rows={6} dense label="분류를 불러오는 중" />}
        {data && shown.length === 0 && (
          <p className="py-10 text-center text-ui text-n-500">{filter ? '맞는 값이 없습니다.' : '아직 값이 없습니다.'}</p>
        )}
        {shown.length > 0 && (
          <ul aria-label={`${FACET_LABELS[field]} 값`}>
            {shown.map((f) => <ValueRow key={f.value} field={field} f={f} max={max} drafts={drafts} />)}
          </ul>
        )}
      </section>
      {data && (
        <p className="mt-3 text-meta text-n-500">
          {drafts ? '확정·미확정' : '확정'} 자료 <span className="font-mono">{data.total}</span>건 기준. 한 자료가 여러 값(구역·호선·태그 등)을 가지면 값마다 셉니다.
        </p>
      )}
    </Page>
  );
}
