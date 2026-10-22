import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Link2, Search, SearchX, ScrollText } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { inputClass } from '../../components/ui/Field.jsx';
import { TermHighlight } from '../../components/ui/Highlight.jsx';
import { ErrorNote, Page, PageHeader } from '../../components/ui/Page.jsx';
import { RowsSkeleton } from '../../components/ui/Skeleton.jsx';
import { Segmented } from '../../components/ui/Tabs.jsx';
import { errorText } from '../../lib/labels.js';
import {
  KINDS, RECENT_PERIODS, anchorOf, groupByMonth, itemKey, listMonths, listYears, matchesUpdate, newIndexes,
  validPeriod, viewYearFor,
} from '../../lib/updateHistory.js';

/**
 * 46 — 업데이트 이력(관리 › 업데이트 이력, LV3). LogBook 에 더해지고 바뀐 것을 최근 것부터 — 달 묶음 점 타임라인.
 * 기간 두 단(전체 · 최근 7일 · 최근 30일 · 해 / 보고 있는 해의 달), 분류, 찾기, 운영 확인 전, 새 항목(이 브라우저 기준).
 * 예전 독립 페이지 주소 /updates 는 서버가 이 화면으로 넘긴다.
 */

const SEEN_KEY = 'logbook_updates_seen';

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}
function writeSeen(v) {
  try { localStorage.setItem(SEEN_KEY, v); } catch { /* 저장 못 해도 화면은 그대로 */ }
}

/** 기간 단추 — 건수가 0 이면 눌러도 빈 화면이라 막는다(지금 고른 것은 풀 수 있게 둔다). */
function PeriodButton({ label, count, active, onClick }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} disabled={!count && !active}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-meta font-medium transition-colors duration-150 ease-out
              disabled:cursor-default disabled:border-n-200 disabled:bg-n-50 disabled:text-n-500
              ${active ? 'border-n-300 bg-n-100 text-n-900' : 'border-n-200 bg-n-0 text-n-700 hover:border-n-250 hover:bg-n-50'}`}>
      {label}<span className="font-mono text-micro text-n-500">{count}</span>
    </button>
  );
}

function Badge({ tone = 'plain', children }) {
  const tones = { plain: 'bg-n-100 text-n-700', wait: 'bg-wait-bg text-wait', new: 'bg-n-900 text-n-0' };
  return <span className={`inline-flex h-[18px] shrink-0 items-center rounded-xs px-1.5 text-micro font-medium ${tones[tone]}`}>{children}</span>;
}

/** 사내 http 주소는 clipboard API 가 막혀 있을 수 있다 — 임시 입력칸으로 복사한다. */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 아래로 */ }
  }
  const t = document.createElement('textarea');
  t.value = text; t.style.position = 'fixed'; t.style.left = '-9999px';
  document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

function Item({ it, index, showDate, isNew, q, targeted }) {
  const [copied, setCopied] = useState('');
  const id = anchorOf(it, index);
  const terms = q.trim() ? [q.trim()] : [];
  async function copy(e) {
    e.preventDefault();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
    const ok = await copyText(`${window.location.origin}${window.location.pathname}${window.location.search}#${id}`);
    setCopied(ok ? '복사됨' : '주소 표시줄의 주소를 쓰세요');
    setTimeout(() => setCopied(''), 1500);
  }
  return (
    <li id={id} className="group grid scroll-mt-6 grid-cols-[88px_20px_minmax(0,1fr)] max-[640px]:grid-cols-[20px_minmax(0,1fr)]">
      <span className="pt-3.5 font-mono text-meta text-n-500 max-[640px]:col-start-2 max-[640px]:row-start-1 max-[640px]:pl-1.5 max-[640px]:pt-3 max-[640px]:empty:hidden">
        {showDate ? it.date : ''}
      </span>
      {/* 점 타임라인 — 새 항목은 채운 점(글자 '새 항목' 배지와 함께, 색만으로 말하지 않는다) */}
      <span aria-hidden="true" className="relative max-[640px]:col-start-1 max-[640px]:row-span-2 max-[640px]:row-start-1
        before:absolute before:bottom-0 before:left-[9px] before:top-0 before:w-px before:bg-n-200
        group-first:before:top-[19px] group-last:before:bottom-auto group-last:before:h-[19px] group-only:before:hidden">
        <span className={`absolute left-[5px] top-[15px] h-[9px] w-[9px] rounded-full border-[1.5px] ${isNew ? 'border-n-900 bg-n-900' : 'border-n-300 bg-n-0'}`} />
      </span>
      <div className={`rounded-md py-3 pl-1.5 pr-2 max-[640px]:col-start-2 ${targeted ? 'bg-brand-subtle' : ''}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-semibold text-n-900"><TermHighlight text={it.title} terms={terms} /></span>
          <span className="inline-flex flex-wrap gap-1">
            {isNew && <Badge tone="new">새 항목</Badge>}
            <Badge>{it.kind}</Badge>
            {it.status && <Badge tone="wait">{it.status}</Badge>}
          </span>
        </div>
        {it.summary && <p className="mt-0.5 text-ui text-n-700"><TermHighlight text={it.summary} terms={terms} /></p>}
        {it.points?.length > 0 && (
          <ul className="mt-1.5 list-disc pl-4 text-meta text-n-600 marker:text-n-400">
            {it.points.map((p) => <li key={p} className="mt-0.5 first:mt-0"><TermHighlight text={p} terms={terms} /></li>)}
          </ul>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-n-500">
          {it.no && <span className="font-mono" title="계획 문서 번호(docs/plans)">#{it.no}</span>}
          {it.requester && <span>요청 <TermHighlight text={it.requester} terms={terms} /></span>}
          {it.path && (
            <Link to={it.path} className="inline-flex items-center gap-0.5 font-medium text-brand underline-offset-2 hover:underline">
              {it.screen || '화면'} 열기<ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          )}
          <a href={`#${id}`} onClick={copy} title="이 항목 주소 복사"
             className="inline-flex items-center gap-0.5 underline-offset-2 opacity-0 transition-opacity duration-150 ease-out hover:text-n-900 hover:underline focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <Link2 size={12} aria-hidden="true" />{copied || '링크 복사'}
          </a>
        </div>
      </div>
    </li>
  );
}

export default function UpdatesPage() {
  const [items, setItems] = useState(null);       // null = 불러오는 중
  const [error, setError] = useState('');
  const [seen] = useState(readSeen);               // 이번에 열기 전의 기준(다음 방문 기준은 아래에서 새로 쓴다)
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(false);
  const [lastYear, setLastYear] = useState('');
  const inputRef = useRef(null);

  function load() {
    setError(''); setItems(null);
    api('/admin/updates')
      .then((r) => {
        const list = r?.items || [];
        setItems(list);
        if (list[0]) writeSeen(itemKey(list[0]));   // 다음 방문의 '새 항목' 기준
      })
      .catch((err) => { setError(errorText(err, '업데이트 이력을 불러오지 못했습니다.')); setItems([]); });
  }
  useEffect(load, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // / 또는 Ctrl+K 로 찾기 칸(앱의 상단 검색 Ctrl+K 보다 먼저 — 이 화면 안에서는 이력 찾기)
  useEffect(() => {
    function onKey(e) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        if (!inputRef.current) return;
        e.preventDefault(); e.stopPropagation();
        inputRef.current.focus(); inputRef.current.select();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const list = items || [];
  const fresh = useMemo(() => newIndexes(list, seen), [list, seen]);
  const months = useMemo(() => listMonths(list), [list]);
  const years = useMemo(() => listYears(list), [list]);
  const period = validPeriod(params.get('period') || '', list);
  const viewYear = viewYearFor(period, lastYear, years);
  useEffect(() => { if (viewYear && viewYear !== lastYear) setLastYear(viewYear); }, [viewYear]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 주소의 #항목 으로 왔으면 그 항목으로(목록이 그려진 뒤)
  const hash = location.hash.slice(1);
  useEffect(() => {
    if (hash && items?.length) document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [hash, items]);

  function setPeriod(p) {
    const next = new URLSearchParams(params);
    if (p) next.set('period', p); else next.delete('period');
    setParams(next, { replace: true });
  }
  function clearFilters() {
    setKind(''); setQ(''); setPending(false); setPeriod('');
    inputRef.current?.focus();
  }

  const opts = { period, kind, q, pending };
  const rows = list.map((it, index) => ({ it, index })).filter(({ it }) => matchesUpdate(it, opts));
  const periodCount = (p) => list.filter((it) => matchesUpdate(it, { ...opts, period: p })).length;
  const kindCount = (k) => list.filter((it) => matchesUpdate(it, { ...opts, kind: k })).length;
  const pendingCount = list.filter((it) => it.status).length;
  const filtering = Boolean(period || kind || pending || q.trim());
  const latest = list[0]?.date;

  return (
    <Page className="max-w-[928px]">
      <PageHeader title="업데이트 이력" description="LogBook 에 더해지고 바뀐 것을 최근 것부터 보여 줍니다.">
        {latest && (
          <p className="mt-0.5 text-meta text-n-600">
            최근 업데이트 <span className="font-mono">{latest}</span>
            {fresh.size > 0 && <> · <strong className="font-semibold text-n-900">지난번에 본 뒤 새 항목 {fresh.size}건</strong></>}
          </p>
        )}
      </PageHeader>

      {error && <ErrorNote className="mb-4" action={<Button size="sm" variant="secondary" onClick={load}>다시 시도</Button>}>{error}</ErrorNote>}
      {items === null && <RowsSkeleton rows={5} label="업데이트 이력을 불러오는 중" />}
      {items !== null && !error && list.length === 0 && (
        <EmptyState icon={ScrollText} title="아직 기록한 업데이트가 없습니다">새 기능·개선을 배포하면 여기에 최근 것부터 쌓입니다.</EmptyState>
      )}

      {list.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="relative min-w-0 flex-[1_1_240px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-400" aria-hidden="true" />
              <input ref={inputRef} type="search" aria-label="이력 찾기" value={q} placeholder="제목·설명·번호·요청자로 찾기"
                     onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); } }}
                     className={inputClass('w-full pl-8 pr-9 [&::-webkit-search-cancel-button]:hidden')} />
              <kbd aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm bg-n-50 px-1.5 font-mono text-micro text-n-600 max-[640px]:hidden">/</kbd>
            </label>
            <Segmented label="분류" value={kind} onChange={setKind} className="max-w-full overflow-x-auto"
                       items={[{ id: '', label: <>전체 <span className="font-mono text-micro text-n-500">{kindCount('')}</span></> },
                         ...KINDS.filter((k) => list.some((it) => it.kind === k)).map((k) => ({
                           id: k, label: <>{k} <span className="font-mono text-micro text-n-500">{kindCount(k)}</span></>,
                         }))]} />
            {pendingCount > 0 && (
              <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 text-ui text-n-700">
                <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                운영 확인 전만 보기 <span className="font-mono text-micro text-n-500">{pendingCount}</span>
              </label>
            )}
          </div>

          {/* 기간 두 단 — 첫 단: 전체 · 최근 7일 · 최근 30일 | 해, 둘째 단: 보고 있는 해의 달 */}
          <div className="mb-2 flex flex-col gap-1">
            <div role="group" aria-label="기간" className="flex flex-wrap items-center gap-1">
              <span className="w-11 shrink-0 text-meta font-medium text-n-600">기간</span>
              <PeriodButton label="전체" count={periodCount('')} active={period === ''} onClick={() => setPeriod('')} />
              {Object.entries(RECENT_PERIODS).map(([p, r]) => (
                <PeriodButton key={p} label={r.label} count={periodCount(p)} active={period === p} onClick={() => setPeriod(p)} />
              ))}
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-n-200" />
              {years.map((y) => <PeriodButton key={y} label={`${y}년`} count={periodCount(y)} active={period === y} onClick={() => setPeriod(y)} />)}
            </div>
            <div role="group" aria-label="달" className="flex flex-wrap items-center gap-1">
              <span className="w-11 shrink-0 text-meta font-medium text-n-600">{viewYear ? `${viewYear}년` : ''}</span>
              {months.filter((m) => m.startsWith(`${viewYear}-`)).map((m) => (
                <PeriodButton key={m} label={`${Number(m.slice(5))}월`} count={periodCount(m)} active={period === m} onClick={() => setPeriod(m)} />
              ))}
            </div>
          </div>

          <p role="status" className="mb-1 min-h-5 text-meta text-n-500">
            {filtering && <>{rows.length}건 · <button type="button" onClick={clearFilters} className="text-brand underline underline-offset-2 hover:no-underline">필터 초기화</button></>}
          </p>

          {rows.length === 0 ? (
            <EmptyState icon={SearchX} title="맞는 항목이 없습니다"
                        action={<Button size="sm" variant="secondary" onClick={clearFilters}>필터 초기화</Button>}>
              찾는 글자·분류·기간을 바꿔 보세요.
            </EmptyState>
          ) : groupByMonth(rows).map((g) => (
            <section key={g.month} aria-label={g.label} className="mt-5 first-of-type:mt-3">
              <h2 className="mb-1 text-ui font-semibold text-n-800">
                {g.label}<span className="ml-1.5 text-meta font-normal text-n-500">{g.rows.length}건</span>
              </h2>
              <ol>
                {g.rows.map(({ it, index, showDate }) => (
                  <Item key={anchorOf(it, index)} it={it} index={index} showDate={showDate} isNew={fresh.has(index)} q={q}
                        targeted={hash === anchorOf(it, index)} />
                ))}
              </ol>
            </section>
          ))}

          <p className="mt-10 border-t border-n-200 pt-3 text-meta text-n-500">
            새 항목 표시는 이 브라우저에서 지난번에 본 때를 기준으로 합니다.
          </p>
        </>
      )}
    </Page>
  );
}
