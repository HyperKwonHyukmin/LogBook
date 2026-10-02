import { KIND_LABELS } from '../../lib/labels.js';

/** 확장자 → 배지 색. 글자는 라틴 확장자(PDF, PPTX …)라 한글 글꼴 문제가 없다. */
const EXT_TONE = {
  pdf: 'pdf', ppt: 'ppt', pptx: 'ppt', xls: 'xls', xlsx: 'xls', xlsm: 'xls', csv: 'xls',
  bdf: 'bdf', dat: 'bdf', nas: 'bdf', f06: 'res', op2: 'res', h5: 'res', doc: 'doc', docx: 'doc',
};
const KIND_TONE = { model: 'bdf', result: 'res', report: 'doc', drawing: 'xls', other: null };
const TONES = {
  pdf: 'bg-k-pdf-bg text-k-pdf', ppt: 'bg-k-ppt-bg text-k-ppt', xls: 'bg-k-xls-bg text-k-xls',
  bdf: 'bg-k-bdf-bg text-k-bdf', res: 'bg-k-res-bg text-k-res', doc: 'bg-k-doc-bg text-k-doc',
};
const NEUTRAL = 'bg-n-100 text-n-600';

/**
 * 파일 종류 배지. 파일 이름이 있으면 확장자(라틴 대문자)를 보이고,
 * 종류만 알 때(Entry 행)는 종류 라벨을 sans 로 보인다. 모노 글꼴은 쓰지 않는다.
 */
export default function KindBadge({ kind, name = '' }) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const label = ext && ext.length <= 5 ? ext.toUpperCase() : KIND_LABELS[kind] || kind;
  const tone = TONES[EXT_TONE[ext] || KIND_TONE[kind]] || NEUTRAL;
  return (
    <span className={`inline-flex h-[18px] min-w-9 shrink-0 items-center justify-center rounded-xs px-1.5 text-micro font-semibold tracking-[0.02em] ${tone}`}>
      {label}
    </span>
  );
}
