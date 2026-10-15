import { Link, useInRouterContext } from 'react-router-dom';
import { Copy, Shapes } from 'lucide-react';

/**
 * 같은 BDF(12) — 내용 서명으로 찾은 '같은 모델'(동일 BDF)과 '같은 형상'(형상만 같고 속성·재료·하중이 다름).
 * 서버(entries/same_model.py)가 file.model.same_model·same_geometry(+ *_total)로 준다.
 * 변환이 끝나야 서명이 생기므로, 변환 전에는 아무것도 그리지 않는다(기존 '모델 확인 중' 표시가 그대로 보인다).
 */

export const DIFFER_LABELS = { property: '속성', material: '재료', load: '하중' };

export const differsText = (differs = []) => differs.map((d) => DIFFER_LABELS[d] || d).join('·');

/** 모델 요약에서 같은 BDF 정보만 꺼낸다 — 없으면 null. */
export function sameInfo(model) {
  if (!model) return null;
  const same = model.same_model || [];
  const shape = model.same_geometry || [];
  const sameTotal = model.same_model_total ?? same.length;
  const shapeTotal = model.same_geometry_total ?? shape.length;
  if (!sameTotal && !shapeTotal) return null;
  return { same, shape, sameTotal, shapeTotal };
}

/** 라우터 안이면 화면 전환 링크, 밖(단독 렌더)이면 일반 링크. */
export function EntryLink({ entryId, className, title, children }) {
  const inRouter = useInRouterContext();
  const to = `/e/${encodeURIComponent(entryId)}`;
  return inRouter
    ? <Link to={to} className={className} title={title}>{children}</Link>
    : <a href={to} className={className} title={title}>{children}</a>;
}

const refText = (r) => `${r.entry_id} ${r.name}`;
const more = (total, shown) => (total > shown ? ` 외 ${total - shown}` : '');

/** 정리 대기 카드 파일 줄의 칩 — 동일 BDF 는 주의 칩(링크), 형상만 같으면 옅은 정보 칩. */
export function SameModelChips({ model }) {
  const info = sameInfo(model);
  if (!info) return null;
  const { same, shape, sameTotal, shapeTotal } = info;
  if (sameTotal > 0 && same[0]) {
    const r = same[0];
    return (
      <EntryLink entryId={r.entry_id} title={same.map((x) => `${x.entry_id} / ${x.rel_path}`).join('\n')}
                 className="inline-flex min-w-0 max-w-[260px] shrink items-center gap-1 rounded-xs bg-wait-bg px-1.5 text-micro font-medium text-wait hover:underline">
        <Copy size={11} aria-hidden="true" className="shrink-0" />
        <span className="truncate">동일 BDF 있음: {refText(r)}{more(sameTotal, 1)}</span>
      </EntryLink>
    );
  }
  if (shapeTotal > 0 && shape[0]) {
    const r = shape[0];
    return (
      <EntryLink entryId={r.entry_id} title={shape.map((x) => `${x.entry_id} / ${x.rel_path} — ${differsText(x.differs)} 다름`).join('\n')}
                 className="inline-flex min-w-0 max-w-[260px] shrink items-center gap-1 rounded-xs bg-n-100 px-1.5 text-micro text-n-600 hover:underline">
        <Shapes size={11} aria-hidden="true" className="shrink-0" />
        <span className="truncate">같은 형상: {refText(r)}{more(shapeTotal, 1)}</span>
      </EntryLink>
    );
  }
  return null;
}

/** Entry 상세의 모델 영역 안내 — 동일 BDF(주의)와 같은 형상(정보) 목록. */
export function SameModelNotice({ model }) {
  const info = sameInfo(model);
  if (!info) return null;
  const { same, shape, sameTotal, shapeTotal } = info;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {sameTotal > 0 && (
        <section aria-label="동일 BDF" className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui">
          <p className="flex items-center gap-1.5 font-medium text-wait">
            <Copy size={14} aria-hidden="true" />동일 BDF 가 이미 있습니다
            <span className="font-mono font-normal">{sameTotal}</span>
          </p>
          <p className="mt-0.5 text-meta text-n-600">파일 이름은 달라도 형상·속성·재료·하중이 모두 같습니다.</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {same.map((r) => (
              <li key={r.file_id} className="flex min-w-0 items-center gap-2 text-meta">
                <EntryLink entryId={r.entry_id} className="shrink-0 font-mono font-medium text-brand hover:underline">{r.entry_id}</EntryLink>
                <span className="min-w-0 truncate text-n-700" title={r.rel_path}>{r.rel_path}</span>
                {r.entry_status === 'draft' && <span className="shrink-0 text-n-500">미확정</span>}
              </li>
            ))}
          </ul>
          {sameTotal > same.length && <p className="mt-1 text-meta text-n-500">외 {sameTotal - same.length}개</p>}
        </section>
      )}
      {shapeTotal > 0 && (
        <section aria-label="같은 형상" className="rounded-md border border-n-200 bg-n-50 px-3 py-2 text-ui">
          <p className="flex items-center gap-1.5 font-medium text-n-700">
            <Shapes size={14} aria-hidden="true" />같은 형상, 다른 조건
            <span className="font-mono font-normal text-n-500">{shapeTotal}</span>
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {shape.map((r) => (
              <li key={r.file_id} className="flex min-w-0 items-center gap-2 text-meta">
                <EntryLink entryId={r.entry_id} className="shrink-0 font-mono font-medium text-brand hover:underline">{r.entry_id}</EntryLink>
                <span className="min-w-0 truncate text-n-700" title={r.rel_path}>{r.rel_path}</span>
                <span className="shrink-0 text-n-600">{differsText(r.differs)} 다름</span>
                {r.entry_status === 'draft' && <span className="shrink-0 text-n-500">미확정</span>}
              </li>
            ))}
          </ul>
          {shapeTotal > shape.length && <p className="mt-1 text-meta text-n-500">외 {shapeTotal - shape.length}개</p>}
        </section>
      )}
    </div>
  );
}
