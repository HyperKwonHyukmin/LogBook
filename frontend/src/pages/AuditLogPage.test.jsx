import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditLogPage from './AuditLogPage.jsx';

test('로딩 중에는 기록 없음 안내가 나타나지 않는다', async () => {
  let resolveGet;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveGet = resolve; })));
  render(<AuditLogPage />);
  expect(screen.queryByText('아직 기록이 없습니다.')).not.toBeInTheDocument();
  resolveGet({ ok: true, status: 200, json: () => Promise.resolve([]) });
  expect(await screen.findByText('아직 기록이 없습니다.')).toBeInTheDocument();
});

test('기록을 불러오면 목록으로 보여 준다', async () => {
  const ROW = { id: 1, at: '2026-09-29T09:00:00', employee_id: 'A476854', action: 'USER_APPROVE', target: { type: 'user', id: 'A100002' } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([ROW]) }));
  render(<AuditLogPage />);
  expect(await screen.findByText('가입 승인')).toBeInTheDocument();
});

test('올리기 관련 동작도 한국어 라벨로 보인다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
    { id: 1, at: '2026-09-29T12:33:04', employee_id: 'A476854', action: 'ENTRY_CONFIRM', target: { type: 'entry', id: 'E000001' } },
    { id: 2, at: '2026-09-29T12:33:05', employee_id: 'A476854', action: 'DRAFT_DISCARD', target: { type: 'entry', id: 'E000002' } },
  ]) })));
  render(<AuditLogPage />);
  expect(await screen.findByText('확정')).toBeInTheDocument();
  expect(screen.getByText('초안 버림')).toBeInTheDocument();
});
