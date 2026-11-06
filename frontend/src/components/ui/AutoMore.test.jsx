import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AutoMore from './AutoMore.jsx';

// jsdom 에는 IntersectionObserver 가 없다 — 끝이 보이는 순간을 손으로 알린다
let fire;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { fire = (on) => cb([{ isIntersecting: on }]); }
    observe() {}
    disconnect() {}
  });
});

test('목록 끝이 보이면 저절로 다음 쪽을 받는다', () => {
  const onMore = vi.fn();
  render(<AutoMore onMore={onMore} />);
  act(() => fire(true));
  expect(onMore).toHaveBeenCalledTimes(1);
  act(() => fire(false));
  expect(onMore).toHaveBeenCalledTimes(1);
});

test('불러오는 중·멈춤(오류)이면 받지 않고, 다 받은 뒤에도 끝이 보이면 이어서 받는다', () => {
  const onMore = vi.fn();
  const { rerender } = render(<AutoMore onMore={onMore} loading />);
  act(() => fire(true));
  expect(onMore).not.toHaveBeenCalled();
  rerender(<AutoMore onMore={onMore} />);              // 받기 끝, 끝은 여전히 보임(행이 적어 화면이 안 참)
  expect(onMore).toHaveBeenCalledTimes(1);
  rerender(<AutoMore onMore={onMore} paused />);       // 오류 — 되풀이해서 부르지 않는다
  rerender(<AutoMore onMore={onMore} paused />);
  expect(onMore).toHaveBeenCalledTimes(1);
});

test('단추는 손으로도 누를 수 있다', async () => {
  const onMore = vi.fn();
  render(<AutoMore onMore={onMore} />);
  await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
  expect(onMore).toHaveBeenCalledTimes(1);
});
