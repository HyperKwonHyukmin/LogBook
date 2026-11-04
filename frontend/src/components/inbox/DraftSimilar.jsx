import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { WEAK, likeWord } from '../../lib/similar.js';
import { modelConvertState } from '../../lib/inboxStatus.js';
import Button, { buttonClass } from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { EntryLink } from '../preview/SameModel.jsx';

// 49 — 완전히 같지 않아도 '일부 비슷'(0.5) 이상이면 후보로 보인다(선례 찾기 27 의 점수, lib/similar.js)
export const SIMILAR_MIN = WEAK;
const SHOWN = 3;
const DERIVED = /_(lifting|validation|edited)\.[^.]+$/i;

/** 초안의 대표 BDF — 변환이 끝난 것 중 Wire·검증·편집 산출물이 아닌 첫 BDF, 없으면 변환이 끝난 첫 BDF. */
export function mainModel(files) {
  const done = (files || []).filter((f) => f.kind === 'model' && modelConvertState(f) === 'done');
  return done.find((f) => !DERIVED.test(f.name)) || done[0] || null;
}

/** 이 묶음에서 '이미 있는 BDF 와 똑같아' 받지 않은 BDF 가 들어 있는 기존 자료(자료마다 한 줄). */
export function sameEntries(blocked) {
  const out = new Map();
  for (const b of blocked || []) {
    for (const m of b.matches || []) {
      if (!out.has(m.entry_id)) out.set(m.entry_id, { ...m, blocked: b.name, lifting: !!b.lifting });
    }
  }
  return [...out.values()];
}

/** 비슷한 후보를 찾을 기준 BDF — 이 초안의 대표 BDF, 없으면(모두 막힘) 이미 있는 똑같은 BDF(Wire 모델이 아닌 것 먼저). */
function baseFileId(entry, same) {
  const main = mainModel(entry.files);
  if (main) return main.id;
  const pick = same.find((m) => !DERIVED.test(m.name)) || same[0];
  return pick?.file_id ?? null;
}

/**
 * 49 — 확정 전에 기존 모델과 견준다. ① 똑같은 BDF 가 이미 있어 받지 않았으면 그 자료(그 자료에 추가),
 * ② 완전히 같지 않아도 비슷한 후보(점수와 함께). 사람이 보고 같은 것이 없으면 새 자료로 확정한다.
 * onFound({ same, similar }) 로 보인 건수를 카드에 알린다(확정 때 한 번 묻는다).
 */
export default function DraftSimilar({ entry, disabled, onMerge, onFound }) {
  const same = entry.merge_into ? [] : sameEntries(entry.blocked_models);
  const fileId = entry.merge_into ? null : baseFileId(entry, same);   // 기존 자료에 추가하는 초안은 견주지 않는다
  const [state, setState] = useState({ fileId: null, rows: null });

  useEffect(() => {
    if (!fileId) return undefined;
    let alive = true;
    api(`/similar?file_id=${fileId}`)
      .then((d) => alive && setState({ fileId, rows: (d?.results || []).filter((r) => r.best >= SIMILAR_MIN) }))
      .catch(() => alive && setState({ fileId, rows: [] }));   // 찾지 못해도 확정은 막지 않는다
    return () => { alive = false; };
  }, [fileId]);

  const sameIds = new Set(same.map((m) => m.entry_id));
  const loaded = state.fileId === fileId ? state.rows : null;
  const rows = loaded ? loaded.filter((r) => !sameIds.has(r.lead.entry_id)).slice(0, SHOWN) : null;
  const similarCount = rows ? rows.length : 0;
  useEffect(() => { onFound?.({ same: same.length, similar: similarCount }); }, [same.length, similarCount, onFound]);

  if (!fileId && !same.length) return null;
  const searching = fileId && rows === null;
  if (!same.length && searching) {
    return (
      <p className="mx-4 mb-4 flex items-center gap-1.5 text-meta text-n-600">
        <Spinner size={12} className="text-n-400" />비슷한 기존 모델을 찾는 중입니다.
      </p>
    );
  }
  if (!same.length && !rows.length) {
    return <p className="mx-4 mb-4 text-meta text-n-600">비슷한 기존 모델이 없습니다. 확정하면 새 자료로 추가됩니다.</p>;
  }
  return (
    <section aria-label="기존 모델과 견주기" className="mx-4 mb-4 rounded-md bg-wait-bg px-3 py-2 text-meta text-n-800">
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium text-wait">기존 모델과 견주기: 같은 모델인지 확인한 뒤 확정하세요.</span>
        {fileId && <Link to={`/similar?file=${fileId}`} className={buttonClass('ghost', 'sm')}>선례 찾기에서 자세히</Link>}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {same.map((m) => (
          <li key={`same-${m.entry_id}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <EntryLink entryId={m.entry_id} className="shrink-0 font-mono font-medium text-brand hover:underline">{m.entry_id}</EntryLink>
            <span className="min-w-0 truncate">‘{m.entry_title}’</span>
            <span className="shrink-0 text-n-600">{m.name}</span>
            <span className="shrink-0 font-medium text-err">똑같은 BDF 가 이미 있음</span>
            <div className="flex-1" />
            {m.entry_status === 'confirmed' && (
              <Button variant="ghost" size="sm" disabled={disabled} aria-label={`${m.entry_id} 에 추가`}
                      onClick={() => onMerge(m.entry_id)}>그 자료에 추가</Button>
            )}
          </li>
        ))}
        {rows?.map((r) => (
          <li key={r.lead.file_id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <EntryLink entryId={r.lead.entry_id} className="shrink-0 font-mono font-medium text-brand hover:underline">{r.lead.entry_id}</EntryLink>
            <span className="min-w-0 truncate">‘{r.lead.title}’</span>
            <span className="shrink-0 text-n-600">{r.lead.file_name}</span>
            <span className="shrink-0 font-medium text-n-700">{likeWord(r.best)} {Math.round(r.best * 100)}%</span>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" disabled={disabled} aria-label={`${r.lead.entry_id} 에 새 판으로 추가`}
                    onClick={() => onMerge(r.lead.entry_id)}>새 판이면 이 자료에 추가</Button>
          </li>
        ))}
        {searching && (
          <li className="flex items-center gap-1.5 text-n-600"><Spinner size={12} className="text-n-400" />비슷한 후보를 찾는 중입니다.</li>
        )}
        {rows && !rows.length && <li className="text-n-600">그 밖에 비슷한 후보는 없습니다.</li>}
      </ul>
    </section>
  );
}
