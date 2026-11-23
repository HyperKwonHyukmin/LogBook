import { hasModelView, isViewerOnly, previewRank } from './files.js';
import { modelConvertState } from './inboxStatus.js';

test('2026-11-23 — OptiStruct .fem 도 .inp 처럼 3D 로 보는 보기 전용 모델', () => {
  expect(isViewerOnly('3185_Case1.FEM') && isViewerOnly('a.inp')).toBe(true);
  expect(isViewerOnly('a.bdf')).toBe(false);
  expect(hasModelView({ kind: 'other', name: 'm.fem' })).toBe(true);
  expect(previewRank({ kind: 'other', name: 'm.fem', model: { state: 'done' } })).toBe(2);
  // 초안 카드의 3D 미리보기, 변환 대기 다시 부르기가 .fem 에도 따라온다
  expect(modelConvertState({ kind: 'other', name: 'm.fem', model: { state: 'done' } })).toBe('done');
  expect(modelConvertState({ kind: 'other', name: 'r.pdf', model: null })).toBeNull();
});
