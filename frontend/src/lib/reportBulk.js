/**
 * 24 — 문서 여러 개의 문서 분류 한꺼번에 바꾸기(POST /api/reports/meta/bulk) 화면 계산.
 * 서버가 건마다 단건 저장과 같은 길로 처리하고 {updated, skipped:[{file_id, reason}]} 를 돌려준다.
 */

export const BULK_MAX = 200;   // 서버 report_catalog.MAX_BULK 와 같다
// 작업 바의 빠른 단추 — 가장 자주 바꾸는 두 값만(나머지는 목록에서 고른다)
export const QUICK_BULK_TYPES = ['해석 보고서', '발표자료'];

const REASON_LABELS = {
  unchanged: '이미 같은 분류',
  not_uploader: '권한 없음',
  read_only_role: '권한 없음',
  report_not_found: '찾을 수 없음',
  entry_not_found: '찾을 수 없음',
};

/** 문서 분류 표시 — 빈 값은 '미분류', 추정값은 '(자동)'. */
export function typeLabel(item) {
  const base = item.document_type || '미분류';
  return item.document_type_auto ? `${base}(자동)` : base;
}

/**
 * 적용 전 확인 문구. 고른 행들의 지금 분류별 건수와, 이미 같은 값이라 건너뛸 건수.
 * 추정값(자동)인 행은 같은 값이어도 저장해 확정되므로 건너뛰지 않는다(서버 규칙과 같다).
 */
export function bulkSummary(items, target) {
  const counts = new Map();
  let same = 0;
  for (const it of items) {
    if ((it.document_type || '') === (target || '') && !it.document_type_auto) { same += 1; continue; }
    const k = typeLabel(it);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const from = [...counts.entries()].map(([label, n]) => `${label} ${n}건`).join(', ');
  return { change: items.length - same, same, from };
}

/** 적용 결과 토스트 문구 — '변경 N건 · 건너뜀 M건(이미 같은 분류 2, 권한 없음 1)'. */
export function bulkResultText(result) {
  const updated = result?.updated?.length || 0;
  const skipped = result?.skipped || [];
  if (!skipped.length) return `문서 분류를 바꿨습니다 — 변경 ${updated}건`;
  const reasons = new Map();
  for (const s of skipped) {
    const label = REASON_LABELS[s.reason] || s.reason;
    reasons.set(label, (reasons.get(label) || 0) + 1);
  }
  const detail = [...reasons.entries()].map(([label, n]) => `${label} ${n}`).join(', ');
  return `변경 ${updated}건 · 건너뜀 ${skipped.length}건(${detail})`;
}
