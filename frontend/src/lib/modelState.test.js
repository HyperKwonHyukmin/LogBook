import { isModelPending, modelStaleNote, modelStateMessage } from './modelState.js';

test('볼 수 있으면 메시지가 없다', () => {
  expect(modelStateMessage({ state: 'done', has_lbm: true })).toBeNull();
  // 다시 변환 대기·실패여도 이전 결과가 있으면 그것을 보인다.
  expect(modelStateMessage({ state: 'queued', has_lbm: true })).toBeNull();
  expect(modelStateMessage({ state: 'failed', error: 'x', has_lbm: true })).toBeNull();
});

test('상태별 안내', () => {
  expect(modelStateMessage({ state: null })).toEqual({ text: '3D 변환 대기 중', busy: true });
  expect(modelStateMessage({ state: 'queued', has_lbm: false }).busy).toBe(true);
  expect(modelStateMessage({ state: 'include' }).text).toMatch(/다른 BDF 가 INCLUDE/);
  expect(modelStateMessage({ state: 'skipped', error: 'too_large' }).text).toMatch(/1GB/);
  expect(modelStateMessage({ state: 'skipped', error: 'no_elements' }).text).toMatch(/요소가 없는 BDF/);
  expect(modelStateMessage({ state: 'done', has_lbm: false }).text).toMatch(/재변환/);
});

test('실패는 원문 대신 안내, 원문은 title 로만', () => {
  expect(modelStateMessage({ state: 'failed', error: 'ValueError: 깨짐', has_lbm: false }))
    .toEqual({ text: '3D 로 바꾸지 못했습니다. 관리자에게 알려 주세요.', title: 'ValueError: 깨짐' });
});

test('DRM 파일은 상태와 무관하게 막는다', () => {
  expect(modelStateMessage({ state: 'done', has_lbm: true }, { drm_encrypted: true }).text).toMatch(/DRM/);
  expect(modelStateMessage(null, { drm_encrypted: true }).text).toMatch(/DRM/);
});

test('대기 판정과 이전 결과 안내', () => {
  expect(isModelPending({ state: null })).toBe(true);
  expect(isModelPending({ state: 'queued', has_lbm: true })).toBe(true);
  expect(isModelPending({ state: 'done', has_lbm: true })).toBe(false);
  expect(modelStaleNote({ state: 'queued', has_lbm: true })).toBe('다시 변환 대기 중 · 이전 결과를 보여 줍니다');
  expect(modelStaleNote({ state: 'failed', has_lbm: true })).toMatch(/이전 결과/);
  expect(modelStaleNote({ state: 'done', has_lbm: true })).toBe('');
});
