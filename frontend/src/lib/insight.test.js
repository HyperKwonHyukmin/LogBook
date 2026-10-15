import { barPct, bucketLabel, compact, familySegments, familyText, formatSize, reportText } from './insight.js';

test('요소 묶음 막대 조각과 글자 대안', () => {
  const fam = { beam: 700, shell: 300, rigid: 0, mass: 0, other: 0 };
  const segs = familySegments(fam);
  expect(segs.map((s) => [s.key, s.pct])).toEqual([['beam', 70], ['shell', 30]]);
  expect(familyText({ ...fam, rigid: 20 })).toBe('보 700 · 쉘 300 · RBE 20');
  expect(familySegments({ beam: 0 })).toEqual([]);
  expect(familySegments(null)).toEqual([]);
});

test('크기는 모델 좌표 그대로, mm 추정 환산은 툴팁에만', () => {
  expect(formatSize([24000, 18200.4, 9600])).toEqual({ text: '24,000 × 18,200 × 9,600',
    hint: 'mm 로 보면 24.0 × 18.2 × 9.6 m (BDF 에는 단위가 없습니다)' });
  expect(formatSize([24, 18, 9]).hint).toBe('BDF 에는 단위가 없습니다');
  expect(formatSize(null)).toBeNull();
  expect(formatSize([1, 2])).toBeNull();
});

test('보고서 한 줄 — 제목·쪽수·작성자, 제목이 없으면 파일 이름', () => {
  expect(reportText({ title: '선미 검토', unit: 'page', count: 24, author: '홍길동', name: 'a.pdf' }))
    .toEqual({ title: '선미 검토', meta: '24쪽 · 홍길동', fromName: false });
  expect(reportText({ title: null, unit: 'slide', count: 12, name: 'b.pptx' }))
    .toEqual({ title: 'b.pptx', meta: '슬라이드 12장', fromName: true });
  expect(reportText(null)).toBeNull();
});

test('짧은 수치·구간 이름·막대 길이', () => {
  expect(compact(950)).toBe('950');
  expect(compact(1234)).toBe('1.2천');
  expect(compact(12431)).toBe('1.2만');
  expect(bucketLabel({ min: 0, max: 1000 })).toBe('1천 미만');
  expect(bucketLabel({ min: 1000, max: 10000 })).toBe('1천~1만');
  expect(bucketLabel({ min: 50000, max: null })).toBe('5만 이상');
  expect(barPct(1, 100)).toBe(4);
  expect(barPct(0, 100)).toBe(0);
  expect(barPct(50, 100)).toBe(50);
});
