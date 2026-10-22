import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { calls, mockApi } from '../test/mockApi.js';
import { useAddFilesWatch } from './useAddFilesWatch.js';

afterEach(() => { vi.useRealTimers(); });

test('응답을 기다리는 사이 reset 하면 그 응답은 버리고 폴링도 되살아나지 않는다', async () => {
  vi.useFakeTimers();
  let release;
  const fetch = mockApi({
    'GET /api/batches/A': () => new Promise((r) => { release = r; }),
  });
  const onMerged = vi.fn();
  const { result } = renderHook(() => useAddFilesWatch({ onMerged }));
  act(() => { result.current.start('A'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls(fetch)).toEqual(['GET /api/batches/A']);
  // 자료 B 로 옮겨 감(EntryPage 의 adder.reset) — 그 뒤에 A 의 응답이 돌아온다
  act(() => { result.current.reset(); });
  await act(async () => { release({ state: 'running', queue: {} }); await vi.advanceTimersByTimeAsync(10000); });
  expect(result.current.watch).toEqual({ state: 'idle' });
  expect(calls(fetch)).toEqual(['GET /api/batches/A']);
  expect(onMerged).not.toHaveBeenCalled();
});

test('일시 오류 한 번은 다시 묻고, 이어서 합쳐지면 done', async () => {
  vi.useFakeTimers();
  let n = 0;
  mockApi({
    'GET /api/batches/A': () => {
      n += 1;
      return n === 1 ? { __status: 503, detail: 'x' } : { state: 'done', excluded: [] };
    },
  });
  const onMerged = vi.fn();
  const { result } = renderHook(() => useAddFilesWatch({ onMerged }));
  act(() => { result.current.start('A'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.watch.state).toBe('working');
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.watch.state).toBe('done');
  expect(onMerged).toHaveBeenCalledTimes(1);
});

test('일시 오류가 이어지거나 4xx 면 실패로 알린다', async () => {
  vi.useFakeTimers();
  mockApi({ 'GET /api/batches/A': { __status: 503, detail: 'x' }, 'GET /api/batches/B': { __status: 404, detail: 'x' } });
  const { result } = renderHook(() => useAddFilesWatch({ onMerged: () => {} }));
  act(() => { result.current.start('A'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(result.current.watch.state).toBe('failed');
  act(() => { result.current.start('B'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.watch.state).toBe('failed');
});
