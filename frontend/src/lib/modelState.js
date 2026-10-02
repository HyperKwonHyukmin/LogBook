/** BDF 3D 변환 상태 → 화면 안내(설계 §7.7). ModelPreview 와 전체 화면 뷰어가 같은 규칙을 쓴다. */
import { ERROR_LABELS, MODEL_STATE_LABELS } from './labels.js';

/** 변환 대기 중인가(다시 확인할 가치가 있는가). 이전 결과가 있어도 새 변환을 기다리는 중이면 참. */
export function isModelPending(summary) {
  return !!summary && (summary.state == null || summary.state === 'queued');
}

/**
 * 볼 수 없으면 { text, title?, busy? }, 볼 수 있으면 null.
 * file: 파일 메타(선택) — DRM 파일은 서버가 읽지 못하므로 상태와 무관하게 막는다.
 */
export function modelStateMessage(summary, file = null) {
  if (file?.drm_encrypted) return { text: MODEL_STATE_LABELS.drm };
  if (!summary) return null;
  // 다시 변환 대기·실패 중에도 서버는 이전 결과를 계속 내준다 — 그러면 그것을 보인다.
  if (summary.has_lbm) return null;
  if (isModelPending(summary)) return { text: MODEL_STATE_LABELS.queued, busy: true };
  if (summary.state === 'include') return { text: MODEL_STATE_LABELS.include };
  if (summary.state === 'skipped') return { text: MODEL_STATE_LABELS[summary.error] || MODEL_STATE_LABELS.failed_admin };
  // 실패 원문(파이썬 예외)은 화면에 쓰지 않고 title 로만 둔다.
  if (summary.state === 'failed') return { text: MODEL_STATE_LABELS.failed_admin, title: summary.error || undefined };
  return { text: ERROR_LABELS.model_missing };
}

/** 이전 결과를 보이는 중이면 그 사실을 알리는 한 줄(아니면 ''). */
export function modelStaleNote(summary) {
  if (!summary?.has_lbm) return '';
  if (isModelPending(summary)) return MODEL_STATE_LABELS.stale_queued;
  if (summary.state === 'failed') return MODEL_STATE_LABELS.stale_failed;
  return '';
}
