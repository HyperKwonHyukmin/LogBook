import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, ChevronRight, History, Trash2 } from 'lucide-react';
import Button, { buttonClass } from '../ui/Button.jsx';
import ModelThumb from '../viewer/ModelThumb.jsx';
import { NOTE_LABELS, listRecent, openHref, whenLabel } from '../../lib/recentCompares.js';
import { formatDateTime } from '../../lib/labels.js';

/** 모델 하나의 작은 그림 — 변환된 모델만 썸네일, 나머지는 빈 상자(사유는 글자 줄이 맡는다). */
function Thumb({ f, className }) {
  if (f.available && f.model_key) return <ModelThumb fileId={f.id} modelKey={f.model_key} alt="" className={className} />;
  return (
    <div aria-hidden="true" className={`flex items-center justify-center bg-n-50 text-n-400 ${className}`}>
      <Box size={18} strokeWidth={1.5} />
    </div>
  );
}

/** '9002_선미.bdf 9002 · 9003_선미.bdf 9003' — 이름 + 호선(mono). */
function FileName({ f }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className={`min-w-0 truncate ${f.note === 'trashed' ? 'text-n-500 line-through' : ''}`} title={f.name}>{f.name}</span>
      {f.hull && <span className="shrink-0 font-mono text-meta text-n-500">{f.hull}</span>}
    </span>
  );
}

const visits = (n) => `${n}번 열어 봄`;

/**
 * 최근 비교 한 장(/compares) — 모델 썸네일 2~4개, 이름·호선·자료, 열 수 없는 모델 안내, [열기]·[삭제].
 */
export function RecentCompareCard({ item, onRemove, removing = false }) {
  const href = openHref(item);
  const notes = item.files.filter((f) => f.note);
  return (
    <article aria-label={`비교 ${item.files.map((f) => f.name).join(', ')}`}
             className="flex w-full min-w-0 flex-col rounded-lg border border-n-200 bg-n-0">
      {/* 모델 수만큼 나눈다(2~4) — 높이는 같게 두어 카드가 가지런하다 */}
      <div className="grid gap-1.5 border-b border-n-200 p-2" style={{ gridTemplateColumns: `repeat(${item.files.length}, minmax(0, 1fr))` }}>
        {item.files.map((f) => <Thumb key={f.id} f={f} className="h-24 w-full rounded-sm" />)}
      </div>
      <ul className="flex flex-col gap-1 px-3 pt-2.5 text-ui text-n-800">
        {item.files.map((f) => (
          <li key={f.id} className="flex min-w-0 items-baseline gap-2">
            <FileName f={f} />
            {f.entry_id && (
              <Link to={`/e/${f.entry_id}`} className="ml-auto shrink-0 font-mono text-meta text-n-500 hover:text-brand hover:underline"
                    title={f.entry_title || undefined}>{f.entry_id}</Link>
            )}
          </li>
        ))}
      </ul>
      {(notes.length > 0 || item.dropped > 0) && (
        <ul className="mt-1.5 flex flex-col gap-0.5 px-3 text-meta text-wait">
          {notes.map((f) => <li key={f.id} className="truncate">{f.name} — {NOTE_LABELS[f.note] || f.note}</li>)}
          {item.dropped > 0 && <li>영구 삭제된 모델 {item.dropped}개는 빠졌습니다</li>}
        </ul>
      )}
      <div className="mt-auto flex items-center gap-2 px-3 pb-2.5 pt-3">
        <span className="tnum min-w-0 truncate text-meta text-n-500" title={formatDateTime(item.last_opened_at)}>
          {whenLabel(item.last_opened_at)} · {visits(item.open_count)}
        </span>
        <Button variant="ghost" size="icon-sm" className="ml-auto hover:text-err" onClick={() => onRemove(item)} disabled={removing}
                aria-label="이 비교 기록 삭제" title="기록에서 지웁니다(모델·자료는 그대로)">
          <Trash2 size={14} aria-hidden="true" />
        </Button>
        {href ? <Link to={href} className={buttonClass('primary', 'sm')}>열기</Link>
          : <Button size="sm" disabled title="열 수 있는 모델이 없습니다">열기</Button>}
      </div>
    </article>
  );
}

/** 짧은 목록 한 줄(빈 비교 화면·바구니 메뉴) — 이름들 + 언제. */
function RowBody({ item }) {
  const names = item.files.map((f) => f.name);
  const blocked = item.files.filter((f) => f.note).length;
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-n-800" title={names.join(' · ')}>{names.join(' · ')}</span>
        <span className="tnum truncate text-meta text-n-500">
          모델 {item.files.length}개 · {whenLabel(item.last_opened_at)}{blocked > 0 && <span className="text-wait"> · 확인할 모델 {blocked}</span>}
        </span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-n-400" />
    </>
  );
}

/** 빈 비교 화면의 최근 비교 몇 개. 없으면 그리지 않는다. */
export function RecentCompareShortList({ limit = 5 }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    listRecent(limit).then((r) => { if (live) setItems(r); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, [limit]);
  if (!items?.length) return null;
  return (
    <section aria-label="최근 비교" className="mx-auto mt-8 w-full max-w-[520px] px-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-ui font-semibold text-n-800">최근 비교</h2>
        <Link to="/compares" className="ml-auto text-meta text-n-600 hover:text-brand hover:underline">모두 보기</Link>
      </div>
      <ul className="overflow-hidden rounded-lg border border-n-200">
        {items.map((it) => {
          const href = openHref(it);
          return (
            <li key={it.id} className="border-b border-n-200 last:border-b-0">
              {href ? (
                <Link to={href} className="flex min-h-12 items-center gap-3 px-3 py-1.5 transition-colors duration-150 hover:bg-n-50">
                  <RowBody item={it} />
                </Link>
              ) : (
                <div className="flex min-h-12 items-center gap-3 px-3 py-1.5 opacity-70"><RowBody item={it} /></div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 바구니 띠의 [최근] 단추 — 누르면 최근 비교 몇 개를 띄운다(열 때마다 서버에서 받는다).
 * ↑/↓ 이동, Esc·바깥 누르기로 닫는다.
 */
export function RecentComparesMenu({ limit = 6 }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const id = useId();
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setItems(null);
    listRecent(limit).then((r) => { if (live) setItems(r); }, () => { if (live) setItems([]); });
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => { live = false; document.removeEventListener('mousedown', onDown); };
  }, [open, limit]);
  useEffect(() => {
    if (open && items) rootRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open, items]);

  function close() { setOpen(false); btnRef.current?.focus(); }
  function onKeyDown(e) {
    const els = [...rootRef.current.querySelectorAll('[role="menuitem"]')];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  }
  const go = (to) => { setOpen(false); navigate(to); };

  return (
    <div ref={rootRef} className="relative">
      <Button ref={btnRef} variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
              onClick={() => setOpen((o) => !o)} title="최근에 열어 본 비교">
        <History size={14} aria-hidden="true" />최근
      </Button>
      {open && (
        <div id={id} role="menu" aria-label="최근 비교" onKeyDown={onKeyDown}
             className="absolute bottom-full right-0 z-40 mb-2 w-[340px] origin-bottom-right animate-pop rounded-lg bg-n-0 py-1 shadow-md">
          {!items && <p className="px-3 py-2 text-meta text-n-500">불러오는 중…</p>}
          {items?.length === 0 && <p className="px-3 py-2 text-meta text-n-500">아직 연 비교가 없습니다.</p>}
          {items?.map((it) => {
            const href = openHref(it);
            return (
              <button key={it.id} type="button" role="menuitem" disabled={!href} onClick={() => href && go(href)}
                      className="flex min-h-11 w-full items-center gap-2.5 px-3 py-1 text-left outline-none transition-colors duration-150 ease-out
                        hover:bg-n-100 focus-visible:bg-n-100 active:bg-n-150 disabled:cursor-not-allowed disabled:opacity-60">
                <RowBody item={it} />
              </button>
            );
          })}
          <div role="separator" className="my-1 h-px bg-n-200" />
          <button type="button" role="menuitem" onClick={() => go('/compares')}
                  className="flex h-8 w-full items-center px-3 text-left text-ui text-n-700 outline-none transition-colors duration-150 hover:bg-n-100 focus-visible:bg-n-100">
            최근 비교 모두 보기
          </button>
        </div>
      )}
    </div>
  );
}
