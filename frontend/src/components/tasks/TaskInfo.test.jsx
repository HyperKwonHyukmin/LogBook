import { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFields, TaskSummary } from './TaskInfo.jsx';
import { TASK_FIELDS } from '../../lib/entryEdit.js';

const empty = Object.fromEntries(TASK_FIELDS.map((k) => [k, '']));

function Harness({ initial, onValue }) {
  const [v, setV] = useState(initial);
  return <TaskFields value={v} onChange={(n) => { setV(n); onValue(n); }} />;
}

test('68 — 비어 있으면 접힌 채, 펼치면 선택지를 읽고 칸을 고친다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve({ categories: ['안전', 'RCA'], departments: ['운항관제부'] }) })));
  const onValue = vi.fn();
  render(<Harness initial={empty} onValue={onValue} />);
  expect(screen.queryByLabelText('과제의뢰서 NO.')).toBeNull();
  await userEvent.click(screen.getByText('과제 정보'));
  await userEvent.type(screen.getByLabelText('과제의뢰서 NO.'), 'A-1');
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Category' }), 'RCA');
  expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ request_no: 'A-1', category: 'RCA' }));
  vi.unstubAllGlobals();
});

test('68 — 값이 있으면 펼친 채로 열고(선택지를 못 읽어도 기본 Category), 읽기 화면은 값 있는 칸만', () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  render(<TaskFields value={{ ...empty, request_no: 'A-1', category: '안전' }} onChange={() => {}} />);
  expect(screen.getByLabelText('과제의뢰서 NO.')).toHaveValue('A-1');
  expect(within(screen.getByRole('combobox', { name: 'Category' })).getByRole('option', { name: '안전' })).toBeInTheDocument();
  vi.unstubAllGlobals();
  render(<TaskSummary task={{ request_no: 'A-1', purpose: '신제품 개발' }} />);
  const sec = screen.getByRole('region', { name: '과제 정보' });
  expect(sec).toHaveTextContent('과제의뢰서 NO.A-1');
  expect(sec).toHaveTextContent('목적신제품 개발');
  expect(sec).not.toHaveTextContent('Category');
});
