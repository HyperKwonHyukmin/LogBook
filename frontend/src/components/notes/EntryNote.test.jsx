import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EntryNote from './EntryNote.jsx';

// 64 — 나의 메모: 마크다운 보기, 저장은 [저장] 단추, Ctrl+Enter, 칸을 벗어날 때. [취소]는 버린다.
function setup(initial = { body: '', updated_at: null }) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    const reply = method === 'PUT'
      ? { body: JSON.parse(init.body).body.trim(), updated_at: '2026-11-19T17:30:00' }
      : initial;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) });
  }));
  const utils = render(
    <MemoryRouter>
      <EntryNote entryId="E000222" />
      <button type="button">바깥</button>
    </MemoryRouter>,
  );
  const puts = () => calls.filter((c) => c.method === 'PUT');
  return { ...utils, puts };
}

test('빈 메모 → 쓰기, Ctrl+Enter 로 저장하고 마크다운으로 보인다', async () => {
  const { puts } = setup();
  await userEvent.click(await screen.findByRole('button', { name: /메모 쓰기/ }));
  const area = screen.getByRole('textbox', { name: '나의 메모 (마크다운)' });
  await userEvent.type(area, '## 경계조건{enter}**SPC** 123456');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(puts()[0].url).toBe('/api/entries/E000222/note');
  const view = await screen.findByTestId('note-view');
  expect(view.querySelector('h2')).toHaveTextContent('경계조건');
  expect(view.querySelector('strong')).toHaveTextContent('SPC');
  expect(screen.getByText('저장됨')).toBeInTheDocument();
});

test('[저장] 단추로 저장 — 단추를 누르러 칸을 벗어난 것은 두 번 저장하지 않는다', async () => {
  const { puts } = setup({ body: '처음', updated_at: '2026-11-19T10:00:00' });
  await userEvent.click(await screen.findByRole('button', { name: '메모 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '나의 메모 (마크다운)' }), ' 더함');
  await userEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(puts()[0].body).toEqual({ body: '처음 더함' });
});

test('칸을 벗어나면 저장, [취소]는 버린다', async () => {
  const { puts } = setup({ body: '처음', updated_at: '2026-11-19T10:00:00' });
  await userEvent.click(await screen.findByRole('button', { name: '메모 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '나의 메모 (마크다운)' }), ' 바깥으로');
  await userEvent.click(screen.getByRole('button', { name: '바깥' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(puts()[0].body).toEqual({ body: '처음 바깥으로' });

  await userEvent.click(await screen.findByRole('button', { name: '메모 고치기' }));
  await userEvent.type(screen.getByRole('textbox', { name: '나의 메모 (마크다운)' }), ' 버릴 글');
  await userEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(puts()).toHaveLength(1);
  expect(screen.getByTestId('note-view')).toHaveTextContent('처음 바깥으로');
});
