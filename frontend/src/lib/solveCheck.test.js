import {
  formatElapsed, hasSolveResult, isSolvePending, solveBadge, solveSummary, solveTypeLabel,
} from './solveCheck.js';

test('유형 라벨 — 기타 FATAL 은 코드를 붙인다', () => {
  expect(solveTypeLabel('mechanism')).toBe('구속 부족·메커니즘');
  expect(solveTypeLabel('no_f06')).toBe('결과 파일 없음');
  expect(solveTypeLabel('other', [{ code: 9050, type: 'mechanism' }, { code: 4276, type: 'other' }])).toBe('기타 FATAL 4276');
  expect(solveTypeLabel('other', [{ code: null, type: 'other' }])).toBe('기타 FATAL');
  expect(solveTypeLabel('new_kind')).toBe('new_kind');
});

test('배지 — 상태별 글자와 색', () => {
  expect(solveBadge(null)).toEqual({ tone: 'none', text: '미검증' });
  expect(solveBadge({ state: null })).toEqual({ tone: 'none', text: '미검증' });
  expect(solveBadge({ state: 'queued' })).toEqual({ tone: 'busy', text: '검증 중…' });
  expect(solveBadge({ state: 'running' }).text).toBe('검증 중…');
  expect(solveBadge({ state: 'pass', warning_count: 0 })).toEqual({ tone: 'ok', text: '해석 가능' });
  expect(solveBadge({ state: 'pass', warning_count: 3 }).text).toBe('해석 가능 · 경고 3');
  expect(solveBadge({ state: 'fail', error_types: ['mechanism'] })).toEqual({ tone: 'err', text: '해석 불가 · 구속 부족·메커니즘' });
  expect(solveBadge({ state: 'fail', error_types: ['rbe_dependent_dup', 'card_format', 'other'] }).text)
    .toBe('해석 불가 · RBE 종속 자유도 중복 외 2');
  expect(solveBadge({ state: 'fail', error_types: ['other'], fatals: [{ code: 4276, type: 'other', message: 'x' }] }).text)
    .toBe('해석 불가 · 기타 FATAL 4276');
  expect(solveBadge({ state: 'error', error_types: ['nastran_missing'] })).toEqual({ tone: 'wait', text: '확인 못 함 · Nastran 없음' });
  expect(solveBadge({ state: 'error', error_types: [] }).text).toBe('확인 못 함');
});

test('배지 — 모델이 바뀌었으면 다시 검증 필요, 단 검증 중이 먼저', () => {
  expect(solveBadge({ state: 'pass', stale: true })).toEqual({ tone: 'wait', text: '다시 검증 필요' });
  expect(solveBadge({ state: 'fail', error_types: ['mechanism'], stale: true }).text).toBe('다시 검증 필요');
  expect(solveBadge({ state: 'queued', stale: true }).text).toBe('검증 중…');
  expect(solveBadge({ state: null, stale: true }).text).toBe('미검증');
});

test('대기·결과 판정', () => {
  expect(isSolvePending({ state: 'queued' })).toBe(true);
  expect(isSolvePending({ state: 'running' })).toBe(true);
  expect(isSolvePending({ state: 'pass' })).toBe(false);
  expect(isSolvePending(null)).toBe(false);
  expect(hasSolveResult({ state: 'error' })).toBe(true);
  expect(hasSolveResult({ state: 'running' })).toBe(false);
});

test('경계조건 설명 한 줄과 소요 시간', () => {
  expect(solveSummary({ groups: 3, spc_nodes: 1240 })).toBe('그룹 3개 · 최하단 노드 1,240개 고정 · GRAV −Z');
  expect(solveSummary({ groups: null, spc_nodes: null })).toBe('');
  expect(solveSummary(null)).toBe('');
  expect(formatElapsed(12.4)).toBe('12초');
  expect(formatElapsed(125)).toBe('2분 5초');
  expect(formatElapsed(120)).toBe('2분');
  expect(formatElapsed(null)).toBe('');
});
