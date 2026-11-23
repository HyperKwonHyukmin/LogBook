import { AlertCircle, CheckCheck, ChevronRight, FolderInput, Globe, Paperclip, Search } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { inputClass, selectClass } from '../ui/Field.jsx';
import { BATCH_STATE_LABELS } from '../../lib/labels.js';
import { stagedStatus } from '../../lib/inboxStatus.js';
import { DRAFT_STATES, DRAFT_STATE_LABELS, DRAFT_STATE_TONES, rowMeta } from '../../lib/inboxRows.js';
import { DROP_ZONE_ATTR } from './UploadZone.jsx';

const when = (s) => (s ? s.replace('T', ' ').slice(5, 16) : '—');
const readyRows = (rows) => rows.filter((r) => r.state === 'ready' && r.can_confirm);

/** 상태 칩 하나(줄 안). */
export function StateChip({ state }) {
  const busy = state === 'processing' || state === 'attaching';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-micro font-medium ${DRAFT_STATE_TONES[state] || 'text-n-600'}`}>
      {busy ? <Spinner size={10} /> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {DRAFT_STATE_LABELS[state] || state}
    </span>
  );
}

/** 위쪽 거르기 — 상태 칩(눌러서 거르기, 다시 누르면 풀림), 찾기, 담당(내가 올린 묶음 탭만). */
function Filters({ counts, total, stateFilter, onState, q, onQ, who, onWho }) {
  const chip = (active) => `inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta transition-colors duration-150 ${
    active ? 'border-brand bg-brand-subtle font-medium text-brand' : 'border-n-200 bg-n-0 text-n-700 hover:bg-n-50'}`;
  const all = DRAFT_STATES.reduce((n, s) => n + (counts?.[s] || 0), 0);
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="상태로 거르기" className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!stateFilter} className={chip(!stateFilter)} onClick={() => onState(null)}>
          전체 <span className="font-mono">{all}</span>
        </button>
        {DRAFT_STATES.filter((s) => counts?.[s]).map((s) => (
          <button key={s} type="button" aria-pressed={stateFilter === s} className={chip(stateFilter === s)}
                  onClick={() => onState(stateFilter === s ? null : s)}>
            {DRAFT_STATE_LABELS[s]} <span className="font-mono">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">초안 찾기</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-n-500" />
          <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="제목, 호선, 자료 번호"
                 className={inputClass('w-full pl-8')} />
        </label>
        {onWho && (
          <select aria-label="누구의 초안" value={who} onChange={(e) => onWho(e.target.value)} className={selectClass('w-auto')}>
            <option value="all">전체</option>
            <option value="uploaded">내가 올린 것</option>
            <option value="assigned">내가 담당한 것</option>
          </select>
        )}
      </div>
      {total != null && stateFilter && <p className="text-meta text-n-600">{DRAFT_STATE_LABELS[stateFilter]} 초안만 보는 중</p>}
    </div>
  );
}

/** 묶음 머리 줄 — 누르면 상세 칸에 묶음(진행, 제외 파일, 결과)이 열린다. */
function GroupHead({ g, selected, onSelect, canWrite, onClaim, onBulk, bulkBusy }) {
  const b = g.batch;
  const staged = b && b.state === 'staged' ? stagedStatus(b) : null;
  const ready = readyRows(g.rows);
  const SourceIcon = g.source === 'web' ? Globe : FolderInput;
  const title = (
    <>
      <SourceIcon size={13} className="shrink-0 text-n-500" aria-hidden="true" />
      <span className="min-w-0 truncate font-semibold text-n-900">{g.name}</span>
    </>
  );
  return (
    <div className={`flex flex-col gap-1 rounded-md px-2 py-1.5 ${selected ? 'bg-brand-subtle' : ''}`}>
      <div className="flex min-h-7 items-center gap-2">
        {b ? (
          <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-ui hover:underline">
            {title}
          </button>
        ) : <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui">{title}</span>}
        {g.rows.length > 0 && <span className="shrink-0 text-meta text-n-500"><span className="font-mono">{g.rows.length}</span>건</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-meta text-n-600">
        <span className="font-mono text-n-500">{when(g.received_at)}</span>
        {staged ? (
          <span className={`inline-flex min-w-0 items-center gap-1 ${staged.tone === 'wait' ? 'text-wait' : 'text-n-700'}`}>
            <Spinner size={11} className="shrink-0" /><span className="truncate">{staged.line}</span>
          </span>
        ) : g.state === 'failed' ? (
          <span className="inline-flex items-center gap-1 text-err"><AlertCircle size={12} aria-hidden="true" />처리 실패</span>
        ) : g.state === 'review' ? (
          <span className="text-wait">과제 엑셀 <span className="font-mono">{b?.task_sheet?.total ?? 0}</span>행, 초안 만들기를 기다림</span>
        ) : g.state === 'done' && b?.auto_result ? (
          <span className="text-ok">자동 확정 끝</span>
        ) : g.state !== 'processed' ? <span>{BATCH_STATE_LABELS[g.state] || g.state}</span> : null}
        {b?.excluded?.length > 0 && <span>제외 <span className="font-mono">{b.excluded.length}</span>개</span>}
        <span className="flex-1" />
        {!g.uploader && canWrite && b && <Button size="sm" onClick={() => onClaim(g.key)}>내가 올렸어요</Button>}
        {ready.length >= 2 && (
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => onBulk(g.rows, `묶음 ‘${g.name}’`)}>
            <CheckCheck size={14} aria-hidden="true" />이 묶음 모두 확정
          </Button>
        )}
      </div>
    </div>
  );
}

/** 초안 한 줄 — 체크(확정 가능만), 상태, 제목, 자료 번호와 호선, 담당자, 파일 수. 탐색기 파일을 놓으면 그 초안에 첨부. */
function Row({ r, selected, checked, onCheck, onSelect, drop, dragging }) {
  const canCheck = r.state === 'ready' && r.can_confirm;
  const zone = r.can_edit;
  const over = drop.over === r.entry_id;
  return (
    <li {...(zone ? { [DROP_ZONE_ATTR]: '' } : {})}
        onDragOver={zone ? (e) => drop.onOver(e, r) : undefined}
        onDragLeave={zone ? (e) => drop.onLeave(e, r) : undefined}
        onDrop={zone ? (e) => drop.onDrop(e, r) : undefined}
        className={`flex items-start gap-2 rounded-md border px-2 py-2 transition-[border-color,background-color,box-shadow] duration-150 ${
          over ? 'border-brand bg-brand-subtle ring-3 ring-brand-muted'
            : selected ? 'border-brand-ring bg-brand-subtle'
              : dragging && zone ? 'border-brand-ring bg-n-0' : 'border-transparent hover:bg-n-50'}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand" aria-label={`${r.entry_id} 고르기`}
             checked={checked} disabled={!canCheck} onChange={(e) => onCheck(r.entry_id, e.target.checked)}
             title={canCheck ? undefined : '확정 가능한 초안만 한꺼번에 확정할 수 있습니다'} />
      <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left">
        <span className="flex min-w-0 items-center gap-2">
          <StateChip state={r.state} />
          <span className={`min-w-0 truncate text-ui font-medium ${r.title ? 'text-n-900' : 'italic text-n-500'}`}>{r.title || '(제목 없음)'}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 text-meta text-n-600">
          <span className="font-mono text-n-500">{r.entry_id}</span>
          {rowMeta(r).map((t) => <span key={t} className="min-w-0 truncate">{t}</span>)}
        </span>
        {r.reason && <span className="text-meta text-wait">{r.reason}</span>}
        {over && (
          <span role="status" className="inline-flex items-center gap-1 text-meta font-medium text-brand">
            <Paperclip size={12} aria-hidden="true" />놓으면 이 초안에 첨부합니다
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * 68 — 목록 칸: 거르기 + 묶음별 줄 + 한꺼번에 확정 도구 줄 + 끝난 묶음 접힌 줄.
 * sel = { kind: 'draft', id } | { kind: 'batch', key } | null.
 */
export default function InboxList({ groups, settled, counts, total, stateFilter, onState, q, onQ, who, onWho,
  sel, onSelect, checked, onCheck, onClearChecks, onBulk, bulkBusy, canWrite, onClaim, drop, dragging, children }) {
  const visible = groups.flatMap((g) => g.rows);
  const checkedRows = visible.filter((r) => checked.has(r.entry_id));
  const allReady = readyRows(visible);
  return (
    <div className="flex flex-col gap-3">
      <Filters counts={counts} total={total} stateFilter={stateFilter} onState={onState} q={q} onQ={onQ} who={who} onWho={onWho} />
      {allReady.length > 0 && (
        <div className="flex min-h-8 flex-wrap items-center gap-2 rounded-md border border-n-200 bg-n-25 px-2.5 py-1.5 text-meta text-n-700">
          {checkedRows.length > 0 ? (
            <>
              <span><span className="font-mono">{checkedRows.length}</span>건 고름</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClearChecks}>고르기 해제</Button>
              <Button size="sm" disabled={bulkBusy} onClick={() => onBulk(checkedRows, '고른 초안')}>
                {bulkBusy ? <Spinner size={12} /> : <CheckCheck size={14} aria-hidden="true" />}고른 것 확정
              </Button>
            </>
          ) : (
            <>
              <span>확정 가능 <span className="font-mono">{allReady.length}</span>건</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => allReady.forEach((r) => onCheck(r.entry_id, true))}>모두 고르기</Button>
            </>
          )}
        </div>
      )}
      {children}
      <ul aria-label="초안 목록" className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.key} className="flex flex-col gap-1">
            <GroupHead g={g} selected={sel?.kind === 'batch' && sel.key === g.key} onSelect={() => onSelect({ kind: 'batch', key: g.key })}
                       canWrite={canWrite} onClaim={onClaim} onBulk={onBulk} bulkBusy={bulkBusy} />
            {g.rows.length > 0 && (
              <ul aria-label={`묶음 ${g.name}의 초안`} className="flex flex-col gap-0.5">
                {g.rows.map((r) => (
                  <Row key={r.entry_id} r={r} selected={sel?.kind === 'draft' && sel.id === r.entry_id}
                       checked={checked.has(r.entry_id)} onCheck={onCheck} drop={drop} dragging={dragging}
                       onSelect={() => onSelect({ kind: 'draft', id: r.entry_id })} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {/* 2026-11-06 — 같은 BDF 뿐이라 초안 없이 끝난 묶음(서버가 3일 보인다, 17)은 할 일이 아니라 맨 아래 접힌 한 줄로 */}
      {settled.length > 0 && (
        <details className="group rounded-lg border border-n-200">
          <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-lg px-3 py-2 text-ui text-n-700 hover:bg-n-50 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="text-n-500 transition-transform duration-150 group-open:rotate-90" />
            같은 BDF 뿐이라 초안 없이 끝난 묶음 <span className="font-mono text-n-500">{settled.length}</span>개
            <span className="text-meta text-n-500">· 이미 있는 자료와 같아 올리지 않았습니다. 3일 뒤 사라집니다</span>
          </summary>
          <ul className="flex flex-col gap-0.5 border-t border-n-200 p-2">
            {settled.map((b) => (
              <li key={b.key}>
                <button type="button" onClick={() => onSelect({ kind: 'batch', key: b.key })}
                        aria-current={sel?.kind === 'batch' && sel.key === b.key ? 'true' : undefined}
                        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui text-n-800 hover:bg-n-50">
                  <span className="min-w-0 flex-1 truncate">{b.original_name}</span>
                  <span className="font-mono text-meta text-n-500">{when(b.received_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
