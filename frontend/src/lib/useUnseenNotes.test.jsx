import { act, renderHook, waitFor } from '@testing-library/react';
import { mockApi } from '../test/mockApi.js';
import { writeSeen } from './updateNotes.js';
import { useUnseenNotes } from './useUnseenNotes.js';

test('안내 화면이 본 기록을 쓰면 계정 메뉴의 새 글 수가 바로 줄어든다', async () => {
  localStorage.clear();
  localStorage.setItem('logbook_update_notes_seen', 'b');
  mockApi({ 'GET /api/update-notes': { items: [{ id: 'c', date: '2026-11-24' }, { id: 'b', date: '2026-11-02' }] } });
  const { result } = renderHook(() => useUnseenNotes());
  await waitFor(() => expect(result.current).toBe(1));
  act(() => writeSeen('c'));
  expect(result.current).toBe(0);
});

test('목록을 못 받으면 0', async () => {
  localStorage.clear();
  mockApi({ 'GET /api/update-notes': { __status: 500 } });
  const { result } = renderHook(() => useUnseenNotes());
  await new Promise((r) => setTimeout(r, 10));
  expect(result.current).toBe(0);
});
