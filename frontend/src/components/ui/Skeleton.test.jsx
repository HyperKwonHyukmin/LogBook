import { act, render, screen } from '@testing-library/react';
import { RowsSkeleton } from './Skeleton.jsx';

// 2026-11-19 — Update 로 서버가 다시 뜨는 동안 회색 줄만 보였다. 오래 걸리면 무엇을 기다리는지 한 줄로 알린다.
test('slowNote 는 slowAfter 뒤에만 보이고, 주지 않으면 없다', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<RowsSkeleton slowNote="서버 응답을 기다리는 중" slowAfter={5000} />);
    expect(screen.queryByText('서버 응답을 기다리는 중')).toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('서버 응답을 기다리는 중')).toBeInTheDocument();
    rerender(<RowsSkeleton />);
    expect(screen.queryByText('서버 응답을 기다리는 중')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
