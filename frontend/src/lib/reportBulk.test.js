import { bulkResultText, bulkSummary, typeLabel } from './reportBulk.js';

test('분류 표시 — 빈 값은 미분류, 추정값은 (자동)', () => {
  expect(typeLabel({ document_type: '' })).toBe('미분류');
  expect(typeLabel({ document_type: '발표자료', document_type_auto: true })).toBe('발표자료(자동)');
});

test('확인 요약 — 지금 분류별 건수와 이미 같은 값(자동은 제외)', () => {
  const items = [
    { document_type: '' }, { document_type: '' }, { document_type: '발표자료' },
    { document_type: '발표자료', document_type_auto: true }, { document_type: '기타' },
  ];
  expect(bulkSummary(items, '발표자료')).toEqual({ change: 4, same: 1, from: '미분류 2건, 발표자료(자동) 1건, 기타 1건' });
  expect(bulkSummary([{ document_type: '기타' }], '기타')).toEqual({ change: 0, same: 1, from: '' });
});

test('결과 문구 — 변경 건수와 건너뜀 사유별 건수', () => {
  expect(bulkResultText({ updated: [{}, {}], skipped: [] })).toBe('문서 분류를 바꿨습니다 — 변경 2건');
  expect(bulkResultText({ updated: [{}], skipped: [
    { file_id: 1, reason: 'unchanged' }, { file_id: 2, reason: 'unchanged' }, { file_id: 3, reason: 'not_uploader' },
    { file_id: 4, reason: 'something_else' },
  ] })).toBe('변경 1건 · 건너뜀 4건(이미 같은 분류 2, 권한 없음 1, something_else 1)');
});
