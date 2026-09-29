import { act, renderHook, waitFor } from '@testing-library/react';
import { mockApi } from '../test/mockApi.js';
import { useEntry } from './useEntry.js';

const ENTRY = { entry_id: 'E000001', status: 'confirmed', title: '계류 검토', version: 3 };

test('앞 저장이 실패해도 다음 저장은 이어서 나가고, 응답의 version 을 쓴다', async () => {
  let n = 0;
  const fetch = mockApi({
    'GET /api/entries/E000001': ENTRY,
    'PATCH /api/entries/E000001': (init) => {
      n += 1;
      if (n === 1) return { __status: 500, detail: 'x' };
      return { ...ENTRY, ...JSON.parse(init.body), version: 3 + n };
    },
  });
  const { result } = renderHook(() => useEntry('E000001'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let first; let second; let third;
  await act(async () => {
    // 한꺼번에 세 번 저장 — 첫 번째는 실패한다.
    first = result.current.save({ title: 'a' });
    second = result.current.save({ title: 'b' });
    third = result.current.save({ title: 'c' });
    await Promise.all([first, second, third]);
  });
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  expect(await third).toBe(true);
  const bodies = fetch.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(i.body));
  expect(bodies).toEqual([{ title: 'a', version: 3 }, { title: 'b', version: 3 }, { title: 'c', version: 5 }]);
  expect(result.current.entry.title).toBe('c');
  expect(result.current.error).toBe('');
});

test('다른 Entry 로 옮겨 간 뒤 온 옛 저장 응답은 쓰지 않고, 새 Entry 는 새 줄로 저장한다', async () => {
  let release;
  const fetch = mockApi({
    'GET /api/entries/E000001': ENTRY,
    'GET /api/entries/E000002': { ...ENTRY, entry_id: 'E000002', title: '두 번째', version: 7 },
    'PATCH /api/entries/E000001': () => new Promise((r) => { release = () => r({ ...ENTRY, title: '옛 저장', version: 4 }); }),
    'PATCH /api/entries/E000002': (init) => ({ ...ENTRY, entry_id: 'E000002', ...JSON.parse(init.body), version: 8 }),
  });
  const { result, rerender } = renderHook(({ id }) => useEntry(id), { initialProps: { id: 'E000001' } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let old;
  act(() => { old = result.current.save({ title: '옛 저장' }); });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  rerender({ id: 'E000002' });
  await waitFor(() => expect(result.current.entry?.entry_id).toBe('E000002'));
  // 앞 Entry 의 저장이 아직 안 끝났어도 새 Entry 의 저장은 바로 나간다.
  await act(async () => { await result.current.save({ title: '새 저장' }); });
  const body = JSON.parse(fetch.mock.calls.find(([u, i]) => u === '/api/entries/E000002' && i?.method === 'PATCH')[1].body);
  expect(body).toEqual({ title: '새 저장', version: 7 });
  await act(async () => { release(); await old; });
  expect(result.current.entry.entry_id).toBe('E000002');
  expect(result.current.entry.title).toBe('새 저장');
});

test('버전 충돌이면 conflict 를 돌려주고 최신으로 다시 불러온다', async () => {
  let n = 0;
  mockApi({
    'GET /api/entries/E000001': () => (++n === 1 ? ENTRY : { ...ENTRY, title: '남의 것', version: 9 }),
    'PATCH /api/entries/E000001': { __status: 409, detail: 'version_conflict' },
  });
  const { result } = renderHook(() => useEntry('E000001'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let r;
  await act(async () => { r = await result.current.save({ title: 'x' }); });
  expect(r).toBe('conflict');
  expect(result.current.entry.title).toBe('남의 것');
});
