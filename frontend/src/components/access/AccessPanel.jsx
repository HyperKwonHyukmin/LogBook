import { useEffect, useId, useRef, useState } from 'react';
import { Ban, Globe, Lock, UserPlus, Users, X } from 'lucide-react';
import { api } from '../../api/client.js';
import Button from '../ui/Button.jsx';
import { useConfirm } from '../ui/ConfirmDialog.jsx';
import { inputClass, selectClass } from '../ui/Field.jsx';
import { SectionTitle } from '../ui/Page.jsx';
import { errorText } from '../../lib/labels.js';
import { ACCESS_OPTIONS, accessLabel, accessOf, levelName } from '../../lib/levels.js';

export { ACCESS_OPTIONS };

const ICONS = { shared: Users, normal: Globe, blocked: Ban };

/** 공개 단계 배지(15) — 공유(사람들)·블록(금지 표시). 일반은 그리지 않는다. 볼 수 있는 사람에게만 실린다. */
export function AccessBadge({ item, compact = false }) {
  const label = accessLabel(item);
  if (!label) return null;
  const Icon = accessOf(item) === 'blocked' ? Lock : Users;
  return (
    <span title={label} data-testid="access-badge" data-access={accessOf(item)}
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs bg-n-100 px-1.5 text-micro font-medium text-n-700">
      <Icon size={11} aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/**
 * 공개 단계 고르기(정리 대기 초안 카드·상세 패널 공용).
 * canBlock 이 거짓이면 '블록' 선택지를 뺀다(LV3 만 지정한다). 이미 블록이면 보이기만 한다.
 */
export function AccessSelect({ value, onChange, disabled, id, className = '', canBlock = false }) {
  const options = ACCESS_OPTIONS.filter((o) => o.value !== 'blocked' || canBlock || value === 'blocked');
  return (
    <select id={id} aria-label="공개 범위" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
            className={selectClass(className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * Entry 상세 레일의 '공개 범위' 패널(13 구조, 15 단계).
 * 공개 범위는 [변경하기] 흐름과 분리한다 — 누가 볼 수 있는지가 바로 바뀌는 동작이라 확인을 묻고 그 자리에서 적용하며,
 * 감사 기록도 '공개 범위 변경' 한 줄로 따로 남는다. 공유/일반은 올린 사람·LV3, 블록은 LV3 만 고른다.
 */
export default function AccessPanel({ entry, onChanged, disabled = false }) {
  const current = accessOf(entry);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm();
  const selectId = useId();
  useEffect(() => { setValue(current); }, [current]);

  const manage = !!entry.can_manage_access && entry.status !== 'trashed';
  const opt = ACCESS_OPTIONS.find((o) => o.value === current);
  const next = ACCESS_OPTIONS.find((o) => o.value === value) || opt;
  const Icon = ICONS[current];

  async function apply() {
    if (value === current || busy) return;
    const ok = await confirm({
      title: `공개 범위를 ‘${next.label}’ 으로 바꿀까요?`,
      body: `${next.help} 바꾸는 즉시 검색·호선·즐겨찾기 등 모든 화면에 반영되고 변경 이력에 남습니다.`,
      confirmLabel: '바꾸기', tone: 'primary',
    });
    if (!ok) { setValue(current); return; }
    setBusy(true); setError('');
    try {
      await api(`/entries/${encodeURIComponent(entry.entry_id)}/access`, {
        method: 'PUT', body: { access: value, version: entry.version },
      });
      await onChanged?.();
    } catch (err) {
      setError(errorText(err, '공개 범위를 바꾸지 못했습니다.'));
      setValue(current);
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="공개 범위" className="mt-6 border-t border-n-200 pt-4">
      {dialog}
      <SectionTitle className="mb-2">공개 범위</SectionTitle>
      <p className="flex items-center gap-1.5 text-ui text-n-900">
        <Icon size={14} className="text-n-400" aria-hidden="true" />
        <span>{opt.label}</span>
      </p>
      <p className="mt-0.5 text-meta text-n-500">{opt.help}</p>
      {current === 'blocked' && !manage && entry.can_edit && (
        <p className="mt-1 text-meta text-n-600">관리자가 블록한 자료입니다. 공개 범위와 열람 허락은 관리자만 바꿉니다.</p>
      )}
      {manage && (
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor={selectId} className="sr-only">공개 범위 바꾸기</label>
          <AccessSelect id={selectId} value={value} onChange={setValue} disabled={busy || disabled}
                        canBlock={!!entry.can_block} className="min-w-0 flex-1" />
          <Button size="sm" variant="secondary" disabled={value === current || busy || disabled} loading={busy} onClick={apply}>
            적용
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-meta text-err">{error}</p>}
      {/* 공유 자료는 누구나 보므로 개별 허락이 필요 없다(행은 남아 있다가 단계를 바꾸면 다시 효력이 난다) */}
      {manage && current !== 'shared' && (
        <Grants entry={entry} onChanged={onChanged} disabled={disabled} />
      )}
    </section>
  );
}

/** 고르기 칸 상태 — 이미 허락받았거나 고를 필요가 없는 사람은 잠근다. */
function pickState(u, have, uploader) {
  if (have.has(u.employee_id)) return { locked: true, checked: true, note: '허락됨' };
  if (u.employee_id === uploader) return { locked: true, checked: false, note: '올린 사람' };
  if (u.level === 3) return { locked: true, checked: false, note: '관리자 — 이미 봄' };
  return { locked: false, checked: false, note: '' };
}

/**
 * 열람 허락(13 구조, 15 규칙, 31 화면) — 허락받은 사람 목록 + WorkBench 가입자 목록에서 여러 명 골라 한 번에 허락.
 * 찾기 칸을 누르면 가입자 전체가 뜨고, 이름·사번·부서 글자로 좁힌다. 고른 사람은 검색어를 바꿔도 남는다.
 */
function Grants({ entry, onChanged, disabled }) {
  const grants = entry.grants || [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [result, setResult] = useState({ term: null, rows: [], failed: false });   // 받은 목록과 그 검색어
  const [picked, setPicked] = useState(() => new Map());                         // 사번 → 사용자
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const boxRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    const id = ++seq.current;
    const t = setTimeout(() => {
      api(`/users/lookup?q=${encodeURIComponent(term)}`)
        .then((rows) => { if (id === seq.current) setResult({ term, rows: rows || [], failed: false }); })
        .catch(() => { if (id === seq.current) setResult({ term, rows: [], failed: true }); });
    }, term ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  // 바깥을 누르거나 Esc 면 닫는다(고른 사람은 남겨 둔다)
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const have = new Set(grants.map((g) => g.employee_id));
  const loading = open && result.term !== q.trim();
  const rows = loading ? [] : result.rows;

  function toggle(u) {
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(u.employee_id)) next.delete(u.employee_id); else next.set(u.employee_id, u);
      return next;
    });
  }

  async function run(fn, fallback) {
    setBusy(true); setError('');
    try { await fn(); await onChanged?.(); } catch (err) { setError(errorText(err, fallback)); } finally { setBusy(false); }
  }
  const addPicked = () => run(async () => {
    await api(`/entries/${encodeURIComponent(entry.entry_id)}/grants`,
      { method: 'POST', body: { employee_ids: [...picked.keys()] } });
    setPicked(new Map()); setQ(''); setOpen(false);
  }, '열람을 허락하지 못했습니다.');
  const revoke = (g) => run(() => api(`/entries/${encodeURIComponent(entry.entry_id)}/grants/${encodeURIComponent(g.employee_id)}`,
    { method: 'DELETE' }), '허락을 회수하지 못했습니다.');

  return (
    <div className="mt-4">
      <h3 className="text-meta font-medium text-n-700">열람 허락 <span className="font-mono font-normal text-n-500">{grants.length}</span></h3>
      <p className="mt-0.5 text-meta text-n-500">공개 범위와 상관없이 이 자료를 볼 수 있게 할 사람(WorkBench 사용자).</p>
      {grants.length > 0 ? (
        <ul aria-label="열람 허락 목록" className="mt-2 flex flex-col">
          {grants.map((g) => (
            <li key={g.employee_id} className="group flex min-h-8 items-center gap-2 border-b border-n-200 py-1 text-ui last:border-0">
              <span className="min-w-0 flex-1" title={g.employee_id}>
                <span className="block truncate">
                  {g.name || <span className="font-mono">{g.employee_id}</span>}
                  {g.level && <span className="ml-1.5 text-meta text-n-500">{levelName(g.level)}</span>}
                  {g.effective === false && <span className="ml-1.5 text-meta text-wait">효력 없음</span>}
                </span>
                <span className="block truncate text-meta text-n-500">
                  <span className="font-mono">{g.employee_id}</span>{g.department && ` · ${g.department}`}
                </span>
              </span>
              <Button variant="ghost" size="sm" disabled={busy || disabled} aria-label={`${g.name || g.employee_id} 허락 회수`}
                      onClick={() => revoke(g)}>
                <X size={14} aria-hidden="true" />회수
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-meta text-n-500">아직 허락받은 사람이 없습니다.</p>
      )}
      <div ref={boxRef} className="relative mt-2">
        <label className="flex items-center gap-1.5">
          <UserPlus size={14} className="shrink-0 text-n-400" aria-hidden="true" />
          <input aria-label="열람 허락할 사람 찾기" value={q} disabled={busy || disabled}
                 onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                 onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
                 placeholder="눌러서 고르기 · 이름·사번·부서 검색" aria-expanded={open} aria-controls={open ? listId : undefined}
                 className={inputClass('h-7 min-w-0 flex-1 text-meta')} />
        </label>
        {open && (
          <div id={listId} className="absolute left-0 right-0 top-full z-30 mt-1 animate-pop rounded-lg bg-n-0 shadow-md">
            <ul aria-label="허락할 사람 후보" className="max-h-72 overflow-y-auto py-1">
              {rows.map((u) => {
                const st = pickState(u, have, entry.uploaded_by);
                const checked = st.locked ? st.checked : picked.has(u.employee_id);
                return (
                  <li key={u.employee_id}>
                    <label className={`flex items-center gap-2 px-3 py-1.5 text-ui ${st.locked ? 'cursor-default text-n-500' : 'cursor-pointer text-n-800 hover:bg-n-50'}`}>
                      <input type="checkbox" checked={checked} disabled={st.locked || busy} onChange={() => toggle(u)}
                             aria-label={`${u.name || u.employee_id} 고르기`} className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{u.name || u.employee_id}</span>
                        <span className="block truncate text-meta text-n-500">
                          <span className="font-mono">{u.employee_id}</span>{u.department && ` · ${u.department}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-n-500">{st.note || levelName(u.level)}</span>
                    </label>
                  </li>
                );
              })}
              {loading && <li className="px-3 py-2 text-meta text-n-500">불러오는 중…</li>}
              {!loading && result.failed && <li role="alert" className="px-3 py-2 text-meta text-err">사용자 목록을 읽지 못했습니다.</li>}
              {!loading && !result.failed && rows.length === 0 && <li className="px-3 py-2 text-meta text-n-500">찾는 사람이 없습니다.</li>}
            </ul>
            <div className="flex items-center gap-2 border-t border-n-200 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-meta text-n-600"
                    title={[...picked.values()].map((u) => u.name || u.employee_id).join(', ')}>
                {picked.size ? `${picked.size}명 선택` : '허락할 사람을 체크하세요'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>닫기</Button>
              <Button size="sm" variant="primary" disabled={!picked.size || busy || disabled} loading={busy} onClick={addPicked}>
                {picked.size ? `${picked.size}명 허락` : '허락'}
              </Button>
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-meta text-err">{error}</p>}
    </div>
  );
}
