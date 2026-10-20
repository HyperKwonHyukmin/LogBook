import { changedFields, editErrors, editValues, hasBdf, missingRequired, patchBody, sameEditable } from './entryEdit.js';

const E = { title: '제목', description: null, hulls: [{ hull_no: '9001' }, { hull_no: '9002' }], zones: ['선미부'],
  analysis_type: 'FE 해석', analysis_period: '2025-11', tags: [], version: 3, files: [] };   // 해석 시기(15)·해석 종류(42)는 쓰지 않는다

test('서버 값 → 고칠 값', () => {
  expect(editValues(E)).toEqual({ title: '제목', description: '', hulls: ['9001', '9002'], no_hull: false, zones: ['선미부'],
    target: '', tags: [] });
});

test('바뀐 칸만 PATCH 본문에 — 빈 글자는 null, 앞뒤 공백 무시, 호선은 순서도 본다', () => {
  const base = editValues(E);
  expect(changedFields(base, { ...base, title: ' 제목 ' })).toEqual([]);
  const draft = { ...base, title: '새 제목 ', analysis_period: '', hulls: ['9002', '9001'], tags: ['계류'] };
  // 15 — 해석 시기는 고칠 칸이 아니다(바꿔도 바뀐 칸·본문에 들지 않는다)
  expect(changedFields(base, draft)).toEqual(['title', 'hulls', 'tags']);
  expect(patchBody(base, draft)).toEqual({ title: '새 제목', hulls: ['9002', '9001'], tags: ['계류'] });
});

test('칸 검사', () => {
  const ok = editValues(E);
  expect(editErrors(ok)).toEqual({});
  expect(editErrors({ ...ok, title: '  ' })).toHaveProperty('title');
  expect(editErrors({ ...ok, analysis_period: '2025-1' })).toEqual({});   // 15 — 해석 시기는 검사하지 않는다
  expect(editErrors({ ...ok, hulls: ['12345'] })).toHaveProperty('hulls');
});

test('고칠 칸의 서버 값이 같은지(파일 추가로 version 만 바뀐 경우)', () => {
  expect(sameEditable(E, { ...E, version: 4, files: [{ id: 1 }] })).toBe(true);
  expect(sameEditable(E, { ...E, version: 4, title: '남이 고침' })).toBe(false);
});

test('20 — 호선 없음(공용)은 참/거짓 칸으로 바뀐 칸·본문에 든다, 호선과 함께면 칸 오류', () => {
  const base = editValues({ ...E, hulls: [] });
  expect(changedFields(base, { ...base, no_hull: true })).toEqual(['no_hull']);
  expect(patchBody(base, { ...base, no_hull: true })).toEqual({ no_hull: true });
  expect(patchBody({ ...base, no_hull: true }, base)).toEqual({ no_hull: false });
  expect(editErrors({ ...base, no_hull: true, hulls: ['9001'] })).toHaveProperty('hulls');
});

test('20 — 필수 분류(BDF 자료만, 서버 규칙과 같다) — 43 부터 호선(또는 공용)만, 구역·대상은 선택', () => {
  const v = editValues({ ...E, hulls: [], zones: [] });
  expect(missingRequired(v, true)).toEqual(['hull']);
  expect(missingRequired({ ...v, no_hull: true }, true)).toEqual([]);
  // 29 — 프로젝트는 없앴다: 예전 값이 있어도 호선 대신 인정하지 않는다
  expect(missingRequired({ ...v, project: '크레인 연구' }, true)).toEqual(['hull']);
  expect(missingRequired(v, false)).toEqual([]);
  expect(hasBdf({ files: [{ kind: 'report' }, { kind: 'model', location: 'trash' }] })).toBe(false);
  expect(hasBdf({ files: [{ kind: 'model', location: 'vault' }] })).toBe(true);
});
