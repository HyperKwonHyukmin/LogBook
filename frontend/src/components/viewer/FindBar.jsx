import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { FIND_KINDS, FIND_KIND_LABEL, parseFindQuery, runFind } from '../../lib/findQuery.js';

const num = (n) => Number(n).toLocaleString('ko-KR');
const PREFIX = { node: 'n', element: 'e', rigid: 'r' };

/**
 * 찾기 상태(04c) — 뷰포트 위 바(Ctrl+F)와 점검 탭의 찾기 칸이 같은 상태를 쓴다.
 * Enter = 찾기 / 다음 · Shift+Enter = 이전. 찾으면 선택하고 그 자리로 화면을 옮긴다.
 */
export function useFind(viewer) {
  const [kind, setKind] = useState('node');
  const [text, setText] = useState('');
  const [search, setSearch] = useState(null);
  const [index, setIndex] = useState(0);
  const model = viewer.model;

  // 모델이 바뀌면 지난 결과는 의미가 없다.
  useEffect(() => { setSearch(null); setIndex(0); }, [model]);

  const go = (hit) => viewer.select({ kind: hit.kind === 'rigid' ? 'rbe' : hit.kind, index: hit.index }, { frame: true });

  const run = (raw = text, kindOverride = null) => {
    if (!model) return;
    const r = runFind(model.index, raw, kindOverride ?? kind);
    if (r.kind !== kind) setKind(r.kind);   // 머리글자(n/e/r)가 종류를 바꾼다
    setSearch({ ...r, key: `${r.kind}|${raw.trim()}` });
    setIndex(0);
    if (r.found.length) go(r.found[0]);
  };
  const step = (delta) => {
    const n = search?.found.length || 0;
    if (!n) return;
    const next = (index + delta + n) % n;
    setIndex(next);
    go(search.found[next]);
  };
  const submit = (backward = false) => {
    const key = `${parseFindQuery(text, kind).kind}|${text.trim()}`;
    if (search && search.key === key && search.found.length) step(backward ? -1 : 1);
    else run();
  };
  const changeKind = (k) => {
    setKind(k);
    // 이미 찾았으면 같은 숫자를 새 종류로 바로 다시 찾는다(머리글자 없는 입력만).
    if (search && text.trim() && !/^[nerNER]\s*\d/.test(text.trim())) run(text, k);
  };
  const range = search && !search.empty && search.found.length === 0 && model ? model.index.range(search.kind) : null;
  return { kind, text, setText, search, index, run, step, submit, changeKind, range };
}

const TONES = {
  dark: {
    box: 'bg-viewer-raised border border-viewer-line text-on-viewer shadow-md',
    seg: 'bg-viewer', segOn: 'bg-viewer-active text-on-viewer', segOff: 'text-on-viewer-muted hover:text-on-viewer',
    field: 'border-viewer-line bg-viewer text-on-viewer placeholder:text-on-viewer-subtle focus-within:border-on-navy-ring',
    icon: 'text-on-viewer-subtle', text: 'text-on-viewer', muted: 'text-on-viewer-muted', subtle: 'text-on-viewer-subtle',
    btn: 'text-on-viewer-muted hover:bg-viewer-hover hover:text-on-viewer active:bg-viewer-active',
    warn: 'text-wait-on-dark', err: 'text-err-on-navy',
  },
  light: {
    box: '',
    seg: 'bg-n-100', segOn: 'bg-n-0 text-n-900 shadow-sm', segOff: 'text-n-600 hover:text-n-900',
    field: 'field border-n-250 bg-n-0 text-n-900 hover:border-n-300',
    icon: 'text-n-400', text: 'text-n-900', muted: 'text-n-600', subtle: 'text-n-500',
    btn: 'text-n-600 hover:bg-n-100 hover:text-n-900 active:bg-n-150',
    warn: 'text-wait', err: 'text-err',
  },
};

/**
 * 찾기 칸. tone='dark' = 뷰포트 오른쪽 위에 뜨는 바(닫기 단추 있음), 'light' = 점검 탭 안의 칸.
 * 같은 숫자가 절점이면서 요소일 수 있어 종류를 고른다(입력 앞 n·e·r 로도 바꾼다).
 */
export default function FindBar({ find, tone = 'dark', onClose, focusKey = 0, className = '' }) {
  const t = TONES[tone];
  const inputRef = useRef(null);
  useEffect(() => {
    if (!focusKey) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);
  const { search, index } = find;
  const total = search?.found.length || 0;
  const current = total ? search.found[index] : null;
  const missingText = (list, max) => `${list.slice(0, max).join(', ')}${list.length > max ? ` 외 ${list.length - max}개` : ''}`;

  function onKeyDown(e) {
    if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      find.submit(e.shiftKey);
    }
  }

  return (
    <div role="search" aria-label="ID 로 찾기"
         className={`flex flex-col gap-2 ${tone === 'dark' ? `rounded-lg p-2 ${t.box}` : ''} ${className}`}>
      <div className="flex items-center gap-1.5">
        <div role="radiogroup" aria-label="찾을 종류" className={`inline-flex h-7 shrink-0 items-center rounded-md p-0.5 ${t.seg}`}>
          {FIND_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={find.kind === k} onClick={() => find.changeKind(k)}
                    title={`${FIND_KIND_LABEL[k]} 찾기 (입력 앞에 ${PREFIX[k]} 을 붙여도 됩니다)`}
                    className={`h-6 whitespace-nowrap rounded-[4px] px-2 text-meta font-medium transition-colors duration-150 ease-out
                      ${find.kind === k ? t.segOn : t.segOff}`}>
              {FIND_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 ${t.field}`}>
          <Search size={13} aria-hidden="true" className={`shrink-0 ${t.icon}`} />
          <input ref={inputRef} value={find.text} onChange={(e) => find.setText(e.target.value)} onKeyDown={onKeyDown}
                 aria-label={`${FIND_KIND_LABEL[find.kind]} ID`} placeholder="예) 1234, 200-210" spellCheck={false}
                 className="h-full min-w-0 flex-1 bg-transparent font-mono text-meta outline-none" />
        </label>
        <button type="button" onClick={() => find.submit(false)} title="찾기 (Enter)"
                className={`h-7 shrink-0 rounded-md px-2 text-meta font-medium transition-colors duration-150 ease-out ${t.btn}`}>
          찾기
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="찾기 닫기" title="닫기 (Esc)"
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out ${t.btn}`}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div aria-live="polite" className="flex flex-col gap-1 text-meta empty:hidden">
        {current && (
          <div className="flex items-center gap-1.5">
            <span className={`min-w-0 flex-1 truncate ${t.text}`}>
              {FIND_KIND_LABEL[current.kind]} <span className="font-mono">{current.id}</span>
              {total > 1 && <span className={t.subtle}> · {index + 1} / {total}</span>}
            </span>
            {total > 1 && (
              <>
                <button type="button" onClick={() => find.step(-1)} aria-label="이전 결과" title="이전 (Shift+Enter)"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${t.btn}`}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => find.step(1)} aria-label="다음 결과" title="다음 (Enter)"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${t.btn}`}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
        {search && !search.empty && total === 0 && (
          <p className={t.err}>
            {FIND_KIND_LABEL[search.kind]} {missingText(search.missing, 6)} 없음
            {find.range
              ? ` · 이 모델의 ${FIND_KIND_LABEL[search.kind]} 범위 ${num(find.range.min)}~${num(find.range.max)} (${num(find.range.count)}개)`
              : ` · 이 모델에 ${FIND_KIND_LABEL[search.kind]} 이 없습니다`}
          </p>
        )}
        {search && total > 0 && search.missing.length > 0 && <p className={t.subtle}>없음 {missingText(search.missing, 8)}</p>}
        {search?.invalid.length > 0 && <p className={t.warn}>인식하지 못한 입력 {search.invalid.join(' ')}</p>}
        {search?.truncated && <p className={t.warn}>범위가 커서 앞쪽 500개만 찾았습니다</p>}
      </div>
      {tone === 'dark' && <p className={`text-micro ${t.subtle}`}>Enter 다음 · Shift+Enter 이전 · Esc 닫기</p>}
    </div>
  );
}
