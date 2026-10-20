import { AlertTriangle } from 'lucide-react';
import { requiredText } from '../../lib/labels.js';

/**
 * 20 — '보완 필요' 작은 표시: 확정된 BDF 자료에 필수 분류(호선, 구역 또는 대상)가 빠졌다.
 * 서버가 고칠 수 있는 사람(올린 사람·LV3)에게만 needs_fix 를 싣는다. 자료를 숨기거나 상태를 바꾸지 않는다.
 */
export default function NeedsFixBadge({ missing, className = '' }) {
  if (!missing?.length) return null;
  const text = requiredText(missing);
  return (
    <span title={`보완 필요 — 빠진 분류: ${text}`}
          className={`inline-flex shrink-0 items-center gap-1 rounded-xs bg-wait-bg px-1.5 text-micro font-medium text-wait ${className}`}>
      <AlertTriangle size={11} aria-hidden="true" />보완 필요 · {text}
    </span>
  );
}
