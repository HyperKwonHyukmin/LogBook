import { Copy, Lock } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { EntryLink } from '../preview/SameModel.jsx';

/**
 * 17 — 완전 동일 BDF 로 받지 않은 파일 안내. 오류가 아니라 '이미 있다'는 안내라 빨강을 쓰지 않는다(중성 n-50 면).
 * 서버(ingest/duplicates.py)가 보는 사람 권한으로 대상을 거른다 — 볼 수 없는 자료는 matches 에 없고 hidden 만 온다.
 * 항목 모양: {name, scope: existing|same_upload, same_as, matches: [{file_id, entry_id, entry_title, entry_status,
 *            rel_path, uploaded_by, uploaded_by_name}], total, hidden, includes}
 */

export const ENTRY_STATUS_TEXT = { confirmed: '확정', draft: '정리 대기' };
export const HIDDEN_DUPLICATE_TEXT = '권한이 없는 자료에 같은 BDF 가 이미 있습니다. 관리자(LV3)에게 문의하세요.';
export const DUPLICATE_RULE_TEXT = '파일 이름이 달라도 형상·속성·재료·하중이 모두 같은 BDF 는 다시 올리지 않습니다.';

function Person({ id, name }) {
  if (!id) return null;
  return name ? <span title={id}>{name}</span> : <span className="font-mono">{id}</span>;
}

/** 막힌 BDF 하나가 무엇과 같은지 — 기존 자료 링크(볼 수 있을 때만)·이번 업로드 안의 짝·숨은 자료 안내. */
export function DuplicateTargets({ item }) {
  if (item.scope === 'same_upload') {
    return (
      <p className="text-n-600">
        이번 업로드 안의 <span className="break-all text-n-800">{item.same_as}</span> 와 같아 하나만 올렸습니다.
      </p>
    );
  }
  const matches = item.matches || [];
  const more = (item.total ?? matches.length) - matches.length;
  return (
    <ul aria-label="같은 BDF 가 있는 자료" className="flex flex-col gap-0.5">
      {matches.map((m) => (
        <li key={m.file_id} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-n-600">
          <EntryLink entryId={m.entry_id} className="font-mono font-medium text-brand hover:underline"
                     title={`${m.entry_id} 열기`}>{m.entry_id}</EntryLink>
          <span className="min-w-0 truncate text-n-800">{m.entry_title}</span>
          <span aria-hidden="true" className="text-n-400">·</span>
          <span className="min-w-0 break-all" title={m.rel_path}>{m.rel_path}</span>
          <span aria-hidden="true" className="text-n-400">·</span>
          <Person id={m.uploaded_by} name={m.uploaded_by_name} />
          <span className="rounded-xs bg-n-100 px-1 text-micro text-n-700">{ENTRY_STATUS_TEXT[m.entry_status] || m.entry_status}</span>
        </li>
      ))}
      {more > 0 && <li className="text-n-600">외 <span className="font-mono">{more}</span>개</li>}
      {item.hidden && (
        <li className="flex items-start gap-1.5 text-n-700">
          <Lock size={12} className="mt-[3px] shrink-0 text-n-500" aria-hidden="true" />{HIDDEN_DUPLICATE_TEXT}
        </li>
      )}
    </ul>
  );
}

/**
 * 업로드 결과의 '올리지 않음: 동일 BDF 가 이미 있음' 목록. canForce(LV3)면 [그래도 올리기].
 * uploaded = 이번에 실제로 올라간 파일 수(0 이면 모두 막힌 것).
 */
export default function DuplicateBlockedNotice({ blocked = [], uploaded = 0, canForce = false, onForce, busy = false }) {
  if (!blocked.length) return null;
  return (
    <section aria-label="올리지 않은 BDF" className="rounded-md border border-n-200 bg-n-50 px-3 py-2.5 text-meta text-n-700">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Copy size={14} className="shrink-0 text-n-500" aria-hidden="true" />
        <p className="font-semibold text-n-900">
          올리지 않음: 동일 BDF 가 이미 있음 <span className="font-mono font-normal text-n-600">{blocked.length}</span>
        </p>
        <div className="flex-1" />
        {canForce && onForce && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={onForce}>그래도 올리기</Button>
        )}
      </div>
      <p className="mt-0.5 text-n-600">
        {DUPLICATE_RULE_TEXT} {uploaded > 0 ? '나머지 파일은 올렸습니다.' : '새로 올린 파일이 없습니다.'}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {blocked.map((b) => (
          <li key={b.name} className="flex min-w-0 flex-col gap-0.5">
            <p className="break-all font-medium text-n-900">{b.name}</p>
            <DuplicateTargets item={b} />
            {b.includes?.length > 0 && (
              <p className="text-n-600">함께 빼 둔 INCLUDE 파일: <span className="break-all">{b.includes.join(', ')}</span></p>
            )}
          </li>
        ))}
      </ul>
      {canForce && onForce && (
        <p className="mt-2 text-n-600">관리자(LV3)는 그래도 올릴 수 있습니다. 올린 기록이 감사 로그에 남습니다.</p>
      )}
    </section>
  );
}
