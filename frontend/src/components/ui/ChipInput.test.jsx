import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChipInput from './ChipInput.jsx';

test('Enter 로 칩을 더하고 × 로 뺀다, 검증 실패 값은 안내한다', async () => {
  const onChange = vi.fn();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })));
  const { rerender } = render(<ChipInput label="호선" kind="hull" values={['9999']} onChange={onChange}
                                         validate={(v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.'} />);
  const input = screen.getByRole('combobox', { name: '호선' });
  await userEvent.type(input, '99a{Enter}');
  expect(screen.getByRole('alert')).toHaveTextContent('호선은 숫자 4자리입니다.');
  await userEvent.clear(input);
  await userEvent.type(input, '9998{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(['9999', '9998']);
  rerender(<ChipInput label="호선" kind="hull" values={['9999']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: '9999 빼기' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test('입력하면 자동완성 후보를 보여 주고 고르면 칩이 된다', async () => {
  const onChange = vi.fn();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(['Engine Room']) })));
  render(<ChipInput label="구역" kind="zone" values={[]} onChange={onChange} />);
  await userEvent.type(screen.getByRole('combobox', { name: '구역' }), 'eng');
  await userEvent.click(await screen.findByRole('option', { name: 'Engine Room' }));
  expect(onChange).toHaveBeenLastCalledWith(['Engine Room']);
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/suggest?kind=zone&q=eng');
});

test('화살표로 후보를 옮겨 다니고 Enter 로 고른다, Escape 로 닫는다', async () => {
  const onChange = vi.fn();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(['Engine Room', 'Deck House']) })));
  render(<ChipInput label="구역" kind="zone" values={[]} onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: '구역' });
  await userEvent.type(input, 'e');
  await screen.findByRole('option', { name: 'Deck House' });
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  const active = screen.getByRole('option', { name: 'Deck House' });
  expect(input).toHaveAttribute('aria-activedescendant', active.id);
  expect(active).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowUp}');
  expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Engine Room' }).id);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(['Deck House']);

  await userEvent.type(input, 'e');
  await screen.findByRole('listbox');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('늦게 도착한 옛 질의의 후보가 새 후보를 덮지 않는다', async () => {
  const pending = {};
  vi.stubGlobal('fetch', vi.fn((url) => new Promise((resolve) => {
    pending[new URL(url, 'http://x').searchParams.get('q')] = (rows) => resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
  })));
  render(<ChipInput label="구역" kind="zone" values={[]} onChange={() => {}} />);
  const input = screen.getByRole('combobox', { name: '구역' });
  await userEvent.type(input, 'e');
  await vi.waitFor(() => expect(pending.e).toBeDefined());
  await userEvent.type(input, 'n');
  await vi.waitFor(() => expect(pending.en).toBeDefined());
  pending.en(['Engine Room']);
  await screen.findByRole('option', { name: 'Engine Room' });
  pending.e(['Everything']);
  await new Promise((r) => { setTimeout(r, 20); });
  expect(screen.queryByRole('option', { name: 'Everything' })).toBeNull();
  expect(screen.getByRole('option', { name: 'Engine Room' })).toBeInTheDocument();
});

test('공백이 든 값(Engine Room)도 이미 고른 값으로 알아 후보에서 뺀다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(['Engine Room', 'Deck House']) })));
  render(<ChipInput label="구역" kind="zone" values={['Engine Room']} onChange={() => {}} />);
  await userEvent.type(screen.getByRole('combobox', { name: '구역' }), 'e');
  await screen.findByRole('option', { name: 'Deck House' });
  expect(screen.queryByRole('option', { name: 'Engine Room' })).toBeNull();
});
