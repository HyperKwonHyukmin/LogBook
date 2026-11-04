import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { likeWord } from '../../lib/similar.js';
import { modelConvertState } from '../../lib/inboxStatus.js';
import Button, { buttonClass } from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import { EntryLink } from '../preview/SameModel.jsx';

// 49 — '많이 비슷'(0.7) 이상만 확정 전에 보인다(선례 찾기 27 의 점수, lib/similar.js likeWord)
export const SIMILAR_MIN = 0.7;
const SHOWN = 3;
const DERIVED = /_(lifting|validation|edited)\.[^.]+$/i;

/** 초안의 대표 BDF — 변환이 끝난 것 중 Wire·검증·편집 산출물이 아닌 첫 BDF, 없으면 변환이 끝난 첫 BDF. */
export function mainModel(files) {
  const done = (files || []).filter((f) => f.kind === 'model' && modelConvertState(f) === 'done');
  return done.find((f) => !DERIVED.test(f.name)) || done[0] || null;
}

/**
 * 49 — 확정 전에 비슷한 기존 모델(확정 자료)을 보인다. 사람이 보고 같은 것이 없으면 새 자료로 확정하고,
 * 같은 모델의 새 판이면 그 자료에 추가한다. onFound(n) 으로 보인 건수를 카드에 알린다(확정 때 한 번 묻는다).
 */
export default function DraftSimilar({ entry, disabled, onMerge, onFound }) {
  const main = mainModel(entry.files);
  const fileId = entry.merge_into ? null : main?.id ?? null;   // 기존 자료에 추가하는 초안은 찾지 않는다
  const [state, setState] = useState({ fileId: null, rows: null });

  useEffect(() => {
    if (!fileId) return undefined;
    let alive = true;
    api(`/similar?file_id=${fileId}`)
      .then((d) => alive && setState({ fileId, rows: (d?.results || []).filter((r) => r.best >= SIMILAR_MIN).slice(0, SHOWN) }))
      .catch(() => alive && setState({ fileId, rows: [] }));   // 찾지 못해도 확정은 막지 않는다
    return () => { alive = false; };
  }, [fileId]);

  const rows = state.fileId === fileId ? state.rows : null;
  useEffect(() => { onFound?.(rows ? rows.length : 0); }, [rows, onFound]);
  if (!fileId) return null;
  if (rows === null) {
    return (
      <p className="mx-4 mb-4 flex items-center gap-1.5 text-meta text-n-600">
        <Spinner size={12} className="text-n-400" />비슷한 기존 모델을 찾는 중입니다.
      </p>
    );
  }
  if (!rows.length) {
    return <p className="mx-4 mb-4 text-meta text-n-600">비슷한 기존 모델이 없습니다. 확정하면 새 자료로 추가됩니다.</p>;
  }
  return (
    <section aria-label="비슷한 기존 모델" className="mx-4 mb-4 rounded-md bg-wait-bg px-3 py-2 text-meta text-n-800">
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium text-wait">비슷한 기존 모델 {rows.length}건: 같은 모델인지 확인한 뒤 확정하세요.</span>
        <Link to={`/similar?file=${fileId}`} className={buttonClass('ghost', 'sm')}>선례 찾기에서 자세히</Link>
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((r) => (
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
      </ul>
    </section>
  );
}
