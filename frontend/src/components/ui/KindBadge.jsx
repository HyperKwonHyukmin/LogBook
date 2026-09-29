import { KIND_LABELS } from '../../lib/labels.js';

const STYLES = {
  model: 'bg-indigo-50 text-indigo-800', result: 'bg-violet-50 text-violet-800',
  report: 'bg-red-50 text-red-800', drawing: 'bg-emerald-50 text-emerald-800', other: 'bg-zinc-100 text-zinc-700',
};
const EXT_STYLES = { '.pdf': 'bg-red-50 text-red-800', '.pptx': 'bg-orange-50 text-orange-800', '.ppt': 'bg-orange-50 text-orange-800',
                     '.xlsx': 'bg-green-50 text-green-800', '.xls': 'bg-green-50 text-green-800' };

export default function KindBadge({ kind, name = '' }) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const label = kind === 'report' && EXT_STYLES[ext] ? ext.slice(1).toUpperCase() : KIND_LABELS[kind] || kind;
  const cls = (kind === 'report' && EXT_STYLES[ext]) || STYLES[kind] || STYLES.other;
  return <span className={`inline-flex h-5 min-w-10 items-center justify-center rounded px-1.5 font-mono text-[11px] font-semibold ${cls}`}>{label}</span>;
}
