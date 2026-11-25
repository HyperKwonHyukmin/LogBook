import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { errorText } from '../../lib/labels.js';
import { announceNews } from '../../lib/news.js';
import { OTHER_TERM, loadVocab } from '../../lib/vocab.js';

/** 켜고 끄는 작은 칩(여러 개 고르기). */
function Chip({ on, onClick, children, title }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
            className={`inline-flex h-7 items-center rounded-md border px-2 text-meta transition-colors duration-150 ease-out
              ${on ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-n-200 bg-n-0 text-n-700 hover:border-n-300 hover:text-n-900'}`}>
      {children}
    </button>
  );
}

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * 72 — 새 자료 표시 설정: 켜기, 관심 대상(묶음이면 하위 포함), 관심 선종. 비우면 모든 자료.
 * 저장하면 PUT /api/me/prefs 후 NEWS_EVENT(메뉴 숫자와 검색 줄이 다시 센다).
 */
export default function NewsSettingsDialog({ onClose }) {
  const id = useId();
  const boxRef = useRef(null);
  const [form, setForm] = useState(null);
  const [targets, setTargets] = useState([]);
  const [shipTypes, setShipTypes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api('/me/news'), loadVocab('target'), api('/search/browse').catch(() => null)])
      .then(([n, terms, browse]) => {
        if (!alive) return;
        setForm({ enabled: n.enabled, targets: n.targets || [], ship_types: n.ship_types || [] });
        setTargets(terms.filter((t) => t.value !== OTHER_TERM && t.active !== false));
        setShipTypes((browse?.facets?.ship_type || []).map((f) => f.value).filter(Boolean));
      })
      .catch((err) => { if (alive) setError(errorText(err, '설정을 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const prev = document.activeElement;
    boxRef.current?.focus();
    return () => { if (prev && typeof prev.focus === 'function') prev.focus(); };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/me/prefs', { method: 'PUT', body: {
        'news.enabled': form.enabled,
        'news.targets': form.targets.length ? form.targets : null,
        'news.shipTypes': form.ship_types.length ? form.ship_types : null,
      } });
      announceNews({ settings: true });
      onClose();
    } catch (err) {
      setError(errorText(err, '설정을 저장하지 못했습니다.'));
      setBusy(false);
    }
  }

  // 묶음 아래에 하위 대상을 들여 쓴다(71)
  const groups = targets.filter((t) => !t.parent);
  const childrenOf = (v) => targets.filter((t) => t.parent === v);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 animate-fade"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}
           onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
           className="flex max-h-[85vh] w-full max-w-[560px] animate-pop flex-col rounded-xl bg-n-0 shadow-lg outline-none">
        <div className="border-b border-n-200 px-5 py-4">
          <h2 id={`${id}-t`} className="text-[16px] leading-6 font-semibold text-n-900">새 자료 표시 설정</h2>
          <p className="mt-1 text-meta text-n-600">다른 사람이 새로 확정한 자료를 검색 위 'N건'과 행의 New 로 보여 줍니다. 자료를 열거나 [모두 확인]을 누르면 사라집니다.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {!form && !error && <p className="text-ui text-n-600">불러오는 중…</p>}
          {form && (
            <div className="flex flex-col gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-ui text-n-900">
                <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 accent-brand" />
                새 자료 표시 켜기
              </label>
              <fieldset disabled={!form.enabled} className="disabled:opacity-50">
                <legend className="text-ui font-semibold text-n-800">관심 대상</legend>
                <p className="mb-2 text-meta text-n-600">고르지 않으면 모든 대상. 묶음을 고르면 하위 대상도 들어갑니다.</p>
                <div className="flex flex-col gap-1.5">
                  {groups.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-center gap-1.5">
                      <Chip on={form.targets.includes(g.value)} onClick={() => set('targets', toggle(form.targets, g.value))}
                            title={g.children?.length ? `하위 포함: ${g.children.join(', ')}` : undefined}>
                        {g.value}{g.children?.length > 0 && <span className="ml-1 text-n-500">묶음</span>}
                      </Chip>
                      {childrenOf(g.value).map((c) => (
                        <Chip key={c.id} on={form.targets.includes(c.value)} onClick={() => set('targets', toggle(form.targets, c.value))}>{c.value}</Chip>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={!form.enabled} className="disabled:opacity-50">
                <legend className="text-ui font-semibold text-n-800">관심 선종</legend>
                <p className="mb-2 text-meta text-n-600">고르지 않으면 모든 선종.</p>
                <div className="flex flex-wrap gap-1.5">
                  {shipTypes.map((s) => (
                    <Chip key={s} on={form.ship_types.includes(s)} onClick={() => set('ship_types', toggle(form.ship_types, s))}>{s}</Chip>
                  ))}
                  {!shipTypes.length && <span className="text-meta text-n-500">선종 목록이 없습니다.</span>}
                </div>
              </fieldset>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-meta text-err">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-n-200 px-5 py-3">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save} disabled={!form || busy}>저장</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
