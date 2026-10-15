import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import { STORAGE_KEY } from '../../lib/panelWidth.js';
import { loadPrefs, resetPrefs } from '../../lib/prefs.js';
import usePrefsSync from '../../lib/usePrefsSync.js';
import usePreviewWidth from './usePreviewWidth.jsx';

afterEach(() => { resetPrefs({ keepListeners: false }); window.innerWidth = 1024; });

function Probe() {
  const area = useRef(null);
  const reserved = useRef(null);
  const pane = usePreviewWidth({ areaRef: area, reservedRef: reserved, active: true });
  return (
    <div ref={area} style={{ width: 1600 }}>
      <span data-testid="w">{pane.width}</span>
    </div>
  );
}

test('창이 좁아 잘라 보여도 기억한 폭은 그대로다(10)', () => {
  localStorage.setItem(STORAGE_KEY, '900');
  const orig = window.innerWidth;
  render(<Probe />);
  // jsdom 은 clientWidth 가 0 이라 창 폭(innerWidth)으로 잰다 — 좁은 창에서는 잘라 보인다
  window.innerWidth = 1000;
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(Number(screen.getByTestId('w').textContent)).toBeLessThan(900);
  expect(localStorage.getItem(STORAGE_KEY)).toBe('900');
  window.innerWidth = 3000;
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(screen.getByTestId('w').textContent).toBe('900');
  window.innerWidth = orig;
});

test('서버 설정의 폭이 들어오면 그 폭을 쓰고 localStorage 사본도 맞춘다(10)', async () => {
  localStorage.setItem(STORAGE_KEY, '500');
  window.innerWidth = 3000;
  mockApi({ 'GET /api/me/prefs': { 'search.previewWidth': 720 } });
  render(<Probe />);
  expect(screen.getByTestId('w').textContent).toBe('500');
  await act(async () => { await loadPrefs(); });
  expect(screen.getByTestId('w').textContent).toBe('720');
  expect(localStorage.getItem(STORAGE_KEY)).toBe('720');
});

function Shell() { usePrefsSync('A100001'); return null; }

test('셸이 뜰 때 서버 설정을 받아 아직 열지 않은 화면의 사본(localStorage)에 옮긴다(10)', async () => {
  mockApi({ 'GET /api/me/prefs': { 'search.previewWidth': 666 } });
  render(<Shell />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(localStorage.getItem(STORAGE_KEY)).toBe('666');
});
