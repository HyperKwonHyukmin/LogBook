/**
 * 해석 검증(06) — Nastran 이 실제로 도는 모델인지 확인한 결과를 화면 말로 바꾼다.
 * 미리보기 카드와 전체 화면 뷰어 '점검' 탭이 같은 규칙을 쓴다(순수 함수).
 */

/** 오류 유형 키 → 표시. fail(FATAL 분류)과 error(모델 결함이 아닌 실행 문제) 유형을 한 표에 둔다. */
export const SOLVE_TYPE_LABELS = {
  mechanism: '구속 부족·메커니즘',
  rbe_dependent_dup: 'RBE 종속 자유도 중복',
  undefined_ref: '정의 안 된 참조',
  card_format: '카드 형식 오류',
  property_value: '재료·속성 값 오류',
  bad_geometry: '요소 형상 불량',
  other: '기타 FATAL',
  nastran_missing: 'Nastran 없음',
  license: '라이선스 문제',
  timeout: '시간 초과',
  include_missing: 'INCLUDE 누락',
  no_f06: '결과 파일 없음',
};

/** 유형 키 → 표시. 'other' 는 그 유형 FATAL 의 코드를 붙인다(예: 기타 FATAL 4276). 모르는 키는 그대로. */
export function solveTypeLabel(key, fatals = []) {
  const label = SOLVE_TYPE_LABELS[key] || key || '';
  if (key !== 'other') return label;
  const code = (fatals || []).find((f) => f?.type === 'other' && f.code != null)?.code;
  return code != null ? `${label} ${code}` : label;
}

/** 검증 중인가(다시 확인할 가치가 있는가). */
export function isSolvePending(solve) {
  return solve?.state === 'queued' || solve?.state === 'running';
}

/** 결과가 나온 상태인가(자세히 볼 것이 있는가). */
export function hasSolveResult(solve) {
  return ['pass', 'fail', 'error'].includes(solve?.state);
}

/**
 * 배지 모양 { tone, text }. tone: none(미검증) | busy | ok | err | wait.
 * 검증 중이면 그것이 먼저다 — 다시 검증을 눌러 대기 중인 모델은 '다시 검증 필요' 가 아니라 '검증 중…'.
 * 그다음 stale(모델이 바뀌어 결과가 옛것)이 결과를 덮는다.
 */
export function solveBadge(solve) {
  const state = solve?.state ?? null;
  if (isSolvePending(solve)) return { tone: 'busy', text: '검증 중…' };
  if (state && solve.stale) return { tone: 'wait', text: '다시 검증 필요' };
  const types = solve?.error_types || [];
  const fatals = solve?.fatals || [];
  if (state === 'pass') {
    const w = solve.warning_count || 0;
    return { tone: 'ok', text: w > 0 ? `해석 가능 · 경고 ${w}` : '해석 가능' };
  }
  if (state === 'fail') {
    const first = types.length ? solveTypeLabel(types[0], fatals) : '';
    const more = types.length > 1 ? ` 외 ${types.length - 1}` : '';
    return { tone: 'err', text: first ? `해석 불가 · ${first}${more}` : '해석 불가' };
  }
  if (state === 'error') {
    const first = types.length ? solveTypeLabel(types[0], fatals) : '';
    return { tone: 'wait', text: first ? `확인 못 함 · ${first}` : '확인 못 함' };
  }
  return { tone: 'none', text: '미검증' };
}

/** 경계조건 설명 한 줄 — "그룹 N개 · 최하단 노드 M개 고정 · GRAV −Z". 수치가 없으면 ''. */
export function solveSummary(solve) {
  if (solve?.groups == null && solve?.spc_nodes == null) return '';
  const n = (v) => Number(v ?? 0).toLocaleString('ko-KR');
  return `그룹 ${n(solve.groups)}개 · 최하단 노드 ${n(solve.spc_nodes)}개 고정 · GRAV −Z`;
}

/** 소요 시간 — 60초 미만은 초, 이상은 분·초. 없으면 ''. */
export function formatElapsed(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '';
  const s = Math.round(Number(sec));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}
