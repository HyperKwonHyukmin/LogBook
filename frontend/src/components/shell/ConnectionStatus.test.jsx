import { afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useStorageStatus } from './ConnectionStatus.jsx';

function Probe({ intervalMs }) {
  const storage = useStorageStatus(intervalMs);
  return <span>{storage.reachable ? 'ok' : 'down'}</span>;
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

afterEach(() => {
  setVisibility('visible');
  vi.useRealTimers();
});

function okResponse() {
  return { ok: true, status: 200, json: () => Promise.resolve({ storage: { reachable: true } }) };
}

test('탭이 백그라운드(hidden)면 주기적 확인을 건너뛴다', async () => {
  vi.useFakeTimers();
  setVisibility('hidden');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  render(<Probe intervalMs={1000} />);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).not.toHaveBeenCalled();
});

test('hidden 에서 visible 로 바뀌면 즉시 확인한다', async () => {
  setVisibility('hidden');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  render(<Probe intervalMs={30000} />);
  expect(fetch).not.toHaveBeenCalled();
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
});

test('탭이 보이는 상태면 평소대로 확인한다', async () => {
  setVisibility('visible');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  render(<Probe intervalMs={30000} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(await screen.findByText('ok')).toBeInTheDocument();
});
