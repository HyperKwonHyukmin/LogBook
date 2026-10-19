import { Check, FileText, X } from 'lucide-react';
import { STRUCTURES, familySegments, familyText, formatSize, num, reportText, structureOf } from '../../lib/insight.js';
import { solveBadge } from '../../lib/solveCheck.js';

const TONE_TEXT = { ok: 'text-ok', err: 'text-err', wait: 'text-wait', busy: 'text-n-600', none: 'text-n-500' };
const Sep = () => <span aria-hidden="true" className="text-n-300">·</span>;

/** 요소 묶음 막대(72×6) — 남색 밝기 단계로 쌓는다. 글자 대안은 sr-only 글자·툴팁. */
export function FamilyBar({ families, className = 'w-[72px]' }) {
  const segs = familySegments(families);
  if (!segs.length) return null;
  const text = familyText(families);
  return (
    // 결과 행(role=option) 안에서는 역할이 지워지므로 글자 대안은 sr-only 글자로 둔다
    <span title={text} className={`inline-flex h-1.5 shrink-0 gap-px overflow-hidden rounded-full bg-n-100 ${className}`}>
      <span className="sr-only">{`요소 구성 ${text}`}</span>
      {segs.map((s) => <span key={s.key} aria-hidden="true" className={`h-full ${s.className}`} style={{ width: `${s.pct}%` }} />)}
    </span>
  );
}

/** 해석 검증 배지(06) — 아이콘 + 글자(색만으로 구분하지 않는다). */
export function SolveMark({ solve }) {
  const b = solveBadge(solve);
  const Icon = b.tone === 'ok' ? Check : b.tone === 'err' ? X : null;
  return (
    <span className={`inline-flex items-center gap-1 ${TONE_TEXT[b.tone] || 'text-n-500'}`}>
      {Icon && <Icon size={12} strokeWidth={2.25} aria-hidden="true" />}
      {b.text}
    </span>
  );
}

/**
 * 대표 모델 한 줄 — '요소 1,020 ▕막대▏ 노드 900 · 24,000 × 18,200 × 9,600 · SOL 101 · ✓ 해석 가능 · 그룹 1'.
 * 썸네일과 같은 BDF 다(서버가 같은 규칙으로 고른다).
 */
export function ModelLine({ model }) {
  if (!model) return null;
  const size = formatSize(model.size);
  const tail = [
    size && <span key="size" className="tnum" title={size.hint}>{size.text}</span>,
    model.sol && <span key="sol">SOL <span className="font-mono">{model.sol}</span></span>,
    <SolveMark key="solve" solve={model.solve} />,
    model.groups != null && <span key="groups" title="해석 검증이 센 연결 그룹 수">그룹 <span className="font-mono">{num(model.groups)}</span></span>,
  ].filter(Boolean);
  const structure = structureOf(model.families);
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-n-600">
      {/* 38 — 모델 구성(빔·판·판+보강재) — 자료 상세의 특성 줄과 같은 규칙 */}
      {structure && <span className="font-medium text-n-800">{STRUCTURES[structure]}</span>}
      <span className="tnum">요소 <span className="font-mono text-n-800">{num(model.elements)}</span></span>
      <FamilyBar families={model.families} />
      <span className="tnum">노드 <span className="font-mono text-n-800">{num(model.nodes)}</span></span>
      {tail.map((el, i) => <span key={i} className="inline-flex items-center gap-2"><Sep />{el}</span>)}
    </div>
  );
}

/** 대표 문서 한 줄 — '문서 「제목」 24쪽 · 작성자'. 검색어 발췌가 있으면 행이 발췌를 대신 보인다. */
export function ReportLine({ report }) {
  const r = reportText(report);
  if (!r) return null;
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-n-600" title={report.name}>
      <FileText size={12} aria-hidden="true" className="shrink-0 text-n-400" />
      <span className="shrink-0 text-n-500">문서</span>
      <span className={`min-w-0 truncate ${r.fromName ? 'text-n-600' : 'text-n-800'}`}>{r.fromName ? r.title : `「${r.title}」`}</span>
      {r.meta && <span className="shrink-0 tnum text-n-500">{r.meta}</span>}
    </div>
  );
}
