import { render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import AccessPanel, { AccessBadge, AccessSelect } from './AccessPanel.jsx';
import { calls, mockApi } from '../../test/mockApi.js';

const BASE = { entry_id: 'E000001', status: 'confirmed', version: 3, uploaded_by: 'U1', access: 'normal', label: null };

/** 확인 대화상자에서 고른다(ok=true 면 확인 단추). */
async function answer(ok) {
  const dialog = await screen.findByRole('alertdialog');
  const buttons = within(dialog).getAllByRole('button');
  await userEvent.click(ok ? buttons[buttons.length - 1] : within(dialog).getByRole('button', { name: '취소' }));
}

test('배지 — 공유·블록에만, 일반은 그리지 않는다', () => {
  const { rerender } = render(<AccessBadge item={{ access: 'normal' }} />);
  expect(screen.queryByTestId('access-badge')).toBeNull();
  rerender(<AccessBadge item={{ access: 'shared', label: '공유' }} />);
  expect(screen.getByTestId('access-badge')).toHaveTextContent('공유');
  rerender(<AccessBadge item={{ access: 'blocked', label: '블록' }} />);
  expect(screen.getByTestId('access-badge')).toHaveTextContent('블록');
});

test('고르기 — 블록은 LV3(canBlock)에게만 선택지', () => {
  const { rerender } = render(<AccessSelect value="normal" onChange={() => {}} />);
  const values = () => screen.getAllByRole('option').map((o) => o.value);
  expect(values()).toEqual(['shared', 'normal']);
  rerender(<AccessSelect value="normal" onChange={() => {}} canBlock />);
  expect(values()).toEqual(['shared', 'normal', 'blocked']);
});

test('바꿀 권한이 없으면 현재 단계만 보이고 고르기·허락 목록은 없다', () => {
  render(<AccessPanel entry={{ ...BASE, access: 'blocked', can_manage_access: false }} />);
  expect(screen.getByText('블록')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '공개 범위' })).toBeNull();
  expect(screen.queryByText(/열람 허락/)).toBeNull();
});

test('블록된 자기 자료 — 이유 한 줄', () => {
  render(<AccessPanel entry={{ ...BASE, access: 'blocked', can_manage_access: false, can_edit: true }} />);
  expect(screen.getByText(/관리자가 블록한 자료입니다/)).toBeInTheDocument();
});

test('올린 사람은 공유로 바꾸고 확인한 뒤 적용한다(취소하면 보내지 않는다)', async () => {
  const onChanged = vi.fn();
  const fetch = mockApi({ 'PUT /api/entries/E000001/access': { ...BASE, access: 'shared' } });
  render(<AccessPanel entry={{ ...BASE, can_manage_access: true, grants: [] }} onChanged={onChanged} />);
  const select = screen.getByRole('combobox', { name: '공개 범위' });
  expect(within(select).queryByRole('option', { name: '블록' })).toBeNull();
  const apply = screen.getByRole('button', { name: '적용' });
  expect(apply).toBeDisabled();
  await userEvent.selectOptions(select, 'shared');
  await userEvent.click(apply);
  await answer(false);
  expect(calls(fetch)).not.toContain('PUT /api/entries/E000001/access');
  await userEvent.selectOptions(select, 'shared');
  await userEvent.click(screen.getByRole('button', { name: '적용' }));
  await answer(true);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const [, init] = fetch.mock.calls.find(([u, i]) => u === '/api/entries/E000001/access' && i.method === 'PUT');
  expect(JSON.parse(init.body)).toEqual({ access: 'shared', version: 3 });
});

test('관리자(can_block)는 블록을 고를 수 있다', async () => {
  const fetch = mockApi({ 'PUT /api/entries/E000001/access': { ...BASE, access: 'blocked' } });
  render(<AccessPanel entry={{ ...BASE, can_manage_access: true, can_block: true, grants: [] }} onChanged={vi.fn()} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '공개 범위' }), 'blocked');
  await userEvent.click(screen.getByRole('button', { name: '적용' }));
  await answer(true);
  await waitFor(() => expect(calls(fetch)).toContain('PUT /api/entries/E000001/access'));
});

test('공유 자료에는 허락 목록이 없다(누구나 본다)', () => {
  render(<AccessPanel entry={{ ...BASE, access: 'shared', can_manage_access: true, grants: [] }} />);
  expect(screen.queryByText(/열람 허락/)).toBeNull();
});

test('열람 허락 — 효력 없는 허락 표시, 누르면 가입자 목록, 부서로 좁혀 여러 명 체크해 한 번에 허락, 회수', async () => {
  const entry = { ...BASE, can_manage_access: true,
    grants: [{ employee_id: 'M1', name: '김열람', department: '구조설계부', level: 1, effective: true },
             { employee_id: 'G1', name: '박떠남', level: 2, effective: false }] };
  const onChanged = vi.fn();
  const everyone = [{ employee_id: 'V1', name: '이게스트', department: '구조설계부', level: 1 },
                    { employee_id: 'V2', name: '최일반', department: '의장설계부', level: 2 },
                    { employee_id: 'M1', name: '김열람', department: '구조설계부', level: 1 },
                    { employee_id: 'A1', name: '이관리', level: 3 },
                    { employee_id: 'U1', name: '올린이', level: 2 }];
  const fetch = mockApi({
    'GET /api/users/lookup?q=': everyone,
    'GET /api/users/lookup?q=%EC%9D%98%EC%9E%A5': [everyone[1]],
    'POST /api/entries/E000001/grants': { grants: [], added: ['V1', 'V2'] },
    'DELETE /api/entries/E000001/grants/M1': { grants: [] },
  });
  render(<AccessPanel entry={entry} onChanged={onChanged} />);
  const list = screen.getByRole('list', { name: '열람 허락 목록' });
  expect(within(list).getByText('효력 없음')).toBeInTheDocument();
  expect(within(list).getByText('LV1 게스트')).toBeInTheDocument();
  expect(within(list).getByText(/구조설계부/)).toBeInTheDocument();            // 허락받은 사람의 부서
  const box = screen.getByRole('textbox', { name: '열람 허락할 사람 찾기' });
  await userEvent.click(box);                                                  // 누르면 가입자 전체
  const cands = await screen.findByRole('list', { name: '허락할 사람 후보' });
  await within(cands).findByText('이게스트');
  expect(within(cands).getByRole('checkbox', { name: '김열람 고르기' })).toBeChecked();   // 이미 허락 — 잠김
  expect(within(cands).getByRole('checkbox', { name: '김열람 고르기' })).toBeDisabled();
  expect(within(cands).getByRole('checkbox', { name: '이관리 고르기' })).toBeDisabled();  // LV3 는 이미 본다
  expect(within(cands).getByRole('checkbox', { name: '올린이 고르기' })).toBeDisabled();  // 올린 사람
  await userEvent.click(within(cands).getByRole('checkbox', { name: '이게스트 고르기' }));
  await userEvent.type(box, '의장');                                            // 부서로 좁혀도 고른 사람은 남는다
  await userEvent.click(await screen.findByRole('checkbox', { name: '최일반 고르기' }));
  await userEvent.click(screen.getByRole('button', { name: '2명 허락' }));
  await waitFor(() => expect(calls(fetch)).toContain('POST /api/entries/E000001/grants'));
  const post = fetch.mock.calls.find(([u, i]) => i?.method === 'POST' && u === '/api/entries/E000001/grants');
  expect(JSON.parse(post[1].body)).toEqual({ employee_ids: ['V1', 'V2'] });
  await userEvent.click(screen.getByRole('button', { name: '김열람 허락 회수' }));
  await waitFor(() => expect(calls(fetch)).toContain('DELETE /api/entries/E000001/grants/M1'));
  expect(onChanged).toHaveBeenCalledTimes(2);
});
