import {
  ACCESS_OPTIONS, accessLabel, accessOf, assignableLevels, canWriteLevel, canWriteShared, isAdminLevel, levelName,
  levelOf,
} from './levels.js';

test('실효 등급 — WorkBench 관리자는 저장값과 무관하게 LV3', () => {
  expect(levelOf(null)).toBe(0);
  expect(levelOf({ level: 2 })).toBe(2);
  expect(levelOf({ level: 1, wb_admin: true })).toBe(3);
  expect(levelOf({})).toBe(1);
  expect(levelOf({ level: 9 })).toBe(1);
  expect(levelName(2)).toBe('LV2 일반');
  expect(levelName(4)).toBe('');
});

test('쓰기 — 올리기는 LV1 이상, 공용 정보는 LV2 이상, 관리는 LV3', () => {
  expect(canWriteLevel({ level: 1 })).toBe(true);
  expect(canWriteShared({ level: 1 })).toBe(false);
  expect(canWriteShared({ level: 2 })).toBe(true);
  expect(isAdminLevel({ level: 2 })).toBe(false);
  expect(isAdminLevel({ level: 1, wb_admin: true })).toBe(true);
  expect(canWriteLevel(null)).toBe(false);
});

test('고를 수 있는 등급 — LV3 만, 자기 자신·WorkBench 관리자·비활성은 못 바꾼다', () => {
  const me = { employee_id: 'A', level: 3 };
  expect(assignableLevels(me, { employee_id: 'M', level: 2, wb_active: true })).toEqual([1, 2, 3]);
  expect(assignableLevels(me, me)).toEqual([]);
  expect(assignableLevels(me, { employee_id: 'W', wb_admin: true })).toEqual([]);
  expect(assignableLevels(me, { employee_id: 'D', wb_active: false })).toEqual([]);
  expect(assignableLevels({ employee_id: 'B', level: 2 }, { employee_id: 'M', level: 1 })).toEqual([]);
  expect(assignableLevels({ employee_id: 'W', level: 1, wb_admin: true }, { employee_id: 'M', level: 1 })).toEqual([1, 2, 3]);
});

test('공개 단계 — 일반은 배지 없음, 옛 값은 일반', () => {
  expect(ACCESS_OPTIONS.map((o) => o.value)).toEqual(['shared', 'normal', 'blocked']);
  expect(accessLabel({ access: 'normal' })).toBeNull();
  expect(accessLabel({ access: 'shared' })).toBe('공유');
  expect(accessLabel({ access: 'blocked', label: '블록' })).toBe('블록');
  expect(accessOf({ access: 'public' })).toBe('normal');
  expect(accessLabel({ access: 'private' })).toBeNull();
});
