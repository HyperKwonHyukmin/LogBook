import { afterEach, beforeEach, vi } from 'vitest';
import { calls, mockApi } from '../test/mockApi.js';
import { UNSENT_KEY, flushPrefs, loadPrefs, resetPrefs, savePref, subscribePrefs } from './prefs.js';

beforeEach(() => { resetPrefs({ keepListeners: false }); });
afterEach(() => { vi.useRealTimers(); resetPrefs({ keepListeners: false }); });

test('서버 값을 받아 구독자에게 알린다(서버가 이긴다)', async () => {
  mockApi({ 'GET /api/me/prefs': { 'search.previewWidth': 640 } });
  const seen = [];
  subscribePrefs((k, v) => seen.push([k, v]));
  expect(await loadPrefs()).toEqual({ 'search.previewWidth': 640 });
  expect(seen).toEqual([['search.previewWidth', 640]]);
});

test('받아 오기에 실패해도 오류 없이 빈 값', async () => {
  mockApi({ 'GET /api/me/prefs': { __status: 500 } });
  expect(await loadPrefs()).toEqual({});
});

test('여러 번 바꿔도 마지막 값만 늦게 한 번 보낸다', async () => {
  vi.useFakeTimers();
  const fetch = mockApi({ 'PUT /api/me/prefs': (init) => JSON.parse(init.body) });
  savePref('search.previewWidth', 500);
  savePref('search.previewWidth', 520);
  savePref('search.previewWidth', 540);
  expect(calls(fetch)).toEqual([]);
  await vi.advanceTimersByTimeAsync(700);
  expect(calls(fetch)).toEqual(['PUT /api/me/prefs']);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ 'search.previewWidth': 540 });
  expect(localStorage.getItem(UNSENT_KEY)).toBeNull();   // 보냈으니 남은 것이 없다
});

test('보내지 못한 변경은 남겨 두고, 다음 시작 때 서버의 옛 값보다 이긴 뒤 다시 보낸다', async () => {
  mockApi({ 'PUT /api/me/prefs': { __status: 503 } });
  savePref('search.previewWidth', 700, { delay: 0 });
  await flushPrefs();
  expect(JSON.parse(localStorage.getItem(UNSENT_KEY))).toEqual({ 'search.previewWidth': 700 });

  // 새로 고침 뒤: 서버는 아직 옛 값(500)
  const fetch = mockApi({ 'GET /api/me/prefs': { 'search.previewWidth': 500 },
                          'PUT /api/me/prefs': (init) => JSON.parse(init.body) });
  const seen = [];
  subscribePrefs((k, v) => seen.push([k, v]));
  await loadPrefs();
  expect(seen).toEqual([]);   // 옛 서버 값으로 덮지 않는다
  await flushPrefs();
  expect(JSON.parse(fetch.mock.calls.find(([, i]) => i?.method === 'PUT')[1].body)).toEqual({ 'search.previewWidth': 700 });
  expect(localStorage.getItem(UNSENT_KEY)).toBeNull();
});

test('null 은 기본값으로 되돌리기(서버에서 지운다)', async () => {
  const fetch = mockApi({ 'PUT /api/me/prefs': {} });
  savePref('search.previewWidth', null);
  await flushPrefs();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ 'search.previewWidth': null });
});
