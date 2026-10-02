import { act, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { calls, mockApi } from '../../test/mockApi.js';
import ModelThumb, { thumbTesting } from './ModelThumb.jsx';

let urls = 0;
beforeEach(() => {
  thumbTesting.reset();
  urls = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:${(urls += 1)}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

const png = { __blob: new Blob(['png']) };
const img = (container) => container.querySelector('img');

test('같은 파일·같은 변환 키는 한 번만 받고, 키가 바뀌면 다시 받는다', async () => {
  const fetch = mockApi({ 'GET /api/files/1/thumb.png': png });
  const a = render(<ModelThumb fileId={1} modelKey="k1" />);
  await waitFor(() => expect(img(a.container)).toBeTruthy());
  a.unmount();
  const b = render(<ModelThumb fileId={1} modelKey="k1" />);
  expect(img(b.container)).toHaveAttribute('src', 'blob:1');
  b.unmount();
  const c = render(<ModelThumb fileId={1} modelKey="k2" />);
  await waitFor(() => expect(img(c.container)).toHaveAttribute('src', 'blob:2'));
  expect(calls(fetch).filter((x) => x.endsWith('thumb.png'))).toHaveLength(2);
});

test('키가 없으면 마운트 사이에 캐시하지 않고, 떼면 URL 을 해제한다', async () => {
  const fetch = mockApi({ 'GET /api/files/2/thumb.png': png });
  const a = render(<ModelThumb fileId={2} />);
  await waitFor(() => expect(img(a.container)).toBeTruthy());
  a.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  const b = render(<ModelThumb fileId={2} />);
  await waitFor(() => expect(img(b.container)).toBeTruthy());
  expect(calls(fetch)).toHaveLength(2);
});

test('실패한 썸네일은 같은 세션에서 다시 요청하지 않는다', async () => {
  const fetch = mockApi({ 'GET /api/files/3/thumb.png': { __status: 404, detail: 'model_not_ready' } });
  const a = render(<ModelThumb fileId={3} modelKey="k" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  a.unmount();
  const b = render(<ModelThumb fileId={3} modelKey="k" />);
  await act(async () => { await Promise.resolve(); });
  expect(img(b.container)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('캐시가 넘쳐도 화면에 붙어 있는 썸네일의 URL 은 해제하지 않는다', async () => {
  thumbTesting.reset({ limit: 1 });
  mockApi({ 'GET /api/files/4/thumb.png': png, 'GET /api/files/5/thumb.png': png });
  const a = render(<ModelThumb fileId={4} modelKey="k" />);
  await waitFor(() => expect(img(a.container)).toHaveAttribute('src', 'blob:1'));
  const b = render(<ModelThumb fileId={5} modelKey="k" />);
  await waitFor(() => expect(img(b.container)).toHaveAttribute('src', 'blob:2'));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  // 쓰는 곳이 없어지면 그때 오래된 것부터 해제한다.
  a.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:2');
});

test('동시에 받는 썸네일은 4개까지', async () => {
  const waiting = [];
  const fetch = mockApi(Object.fromEntries([10, 11, 12, 13, 14, 15].map((id) => [
    `GET /api/files/${id}/thumb.png`, () => new Promise((resolve) => { waiting.push(() => resolve(png)); }),
  ])));
  const views = [10, 11, 12, 13, 14, 15].map((id) => render(<ModelThumb fileId={id} modelKey="k" />));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  await act(async () => { waiting.shift()(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
  await act(async () => { while (waiting.length) waiting.shift()(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  await act(async () => { while (waiting.length) waiting.shift()(); });
  views.forEach((v) => v.unmount());
});

test('IntersectionObserver 가 있으면 보일 때만 받는다', async () => {
  let fire;
  class IO {
    constructor(cb) { fire = () => cb([{ isIntersecting: true }]); }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', IO);
  const fetch = mockApi({ 'GET /api/files/20/thumb.png': png });
  const { container } = render(<ModelThumb fileId={20} modelKey="k" />);
  await act(async () => { await Promise.resolve(); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { fire(); });
  await waitFor(() => expect(img(container)).toBeTruthy());
});
