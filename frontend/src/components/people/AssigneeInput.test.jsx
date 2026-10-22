import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssigneeInput, { AssigneeList } from './AssigneeInput.jsx';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { calls, mockApi } from '../../test/mockApi.js';

const KIM = { id: 3, employee_id: null, name: '김퇴사', department: '선체설계부', position: '수석', employed: false, source: 'manual' };
const LEE = { id: null, employee_id: 'N1', name: '이구조', department: '구조설계부', position: null, employed: true, source: 'wb' };

function Harness({ initial = [], level = 2, onValues }) {
  const [v, setV] = useState(initial);
  return (
    <AuthContext.Provider value={{ user: { employee_id: 'U1', level } }}>
      <AssigneeInput values={v} onChange={(x) => { setV(x); onValues?.(x); }} />
    </AuthContext.Provider>
  );
}

test('찾아서 넣기 — WorkBench 사용자와 명부를 함께 보여 주고, 고른 사람은 목록에', async () => {
  mockApi({ 'GET /api/people?q=': { rows: [KIM, LEE], wb_unavailable: false } });
  let last = null;
  render(<Harness onValues={(x) => { last = x; }} />);
  await userEvent.click(screen.getByRole('textbox', { name: '담당자 찾기' }));
  const option = await screen.findByRole('button', { name: /이구조/ });
  expect(option).toHaveTextContent('WorkBench');
  expect(screen.getByRole('button', { name: /김퇴사/ })).toHaveTextContent('퇴사');
  await userEvent.click(option);
  expect(last).toEqual([LEE]);
  expect(screen.getByRole('list', { name: '담당자 목록' })).toHaveTextContent('이구조');
});

test('직접 입력 — 명부에 만들고 넣는다(재직 체크 해제 = 퇴사)', async () => {
  const fetch = mockApi({
    'GET /api/people?q=': { rows: [], wb_unavailable: true },
    'POST /api/people': (init) => ({ ...JSON.parse(init.body), id: 9, employee_id: null, source: 'manual' }),
  });
  let last = null;
  render(<Harness onValues={(x) => { last = x; }} />);
  await userEvent.click(screen.getByRole('textbox', { name: '담당자 찾기' }));
  expect(await screen.findByText(/WorkBench 사용자 표를 읽지 못해/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '찾는 사람이 없으면 직접 입력' }));
  await userEvent.type(screen.getByRole('textbox', { name: '이름' }), '박옛');
  await userEvent.type(screen.getByRole('textbox', { name: '부서' }), '의장설계부');
  await userEvent.click(screen.getByRole('checkbox', { name: '재직 중' }));
  await userEvent.click(screen.getByRole('button', { name: '만들어 넣기' }));
  await waitFor(() => expect(last).toHaveLength(1));
  expect(last[0]).toMatchObject({ id: 9, name: '박옛', department: '의장설계부', position: null, employed: false });
  expect(calls(fetch)).toContain('POST /api/people');
});

test('명부 고치기는 LV2 이상 — 바로 저장하고 목록 값을 바꾼다', async () => {
  mockApi({ 'PATCH /api/people/3': (init) => ({ ...KIM, ...JSON.parse(init.body) }) });
  let last = null;
  const { unmount } = render(<Harness initial={[KIM]} onValues={(x) => { last = x; }} />);
  await userEvent.click(screen.getByRole('button', { name: '김퇴사 명부 고치기' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '재직 중' }));
  await userEvent.click(screen.getByRole('button', { name: '명부 저장' }));
  await waitFor(() => expect(last?.[0].employed).toBe(true));
  unmount();
  render(<Harness initial={[KIM]} level={1} />);
  expect(screen.queryByRole('button', { name: '김퇴사 명부 고치기' })).toBeNull();
});

test('읽기 목록 — 퇴사 표시와 주 담당자, 이름은 검색 링크', () => {
  render(<MemoryRouter><AssigneeList people={[LEE, KIM]} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: '이구조' })).toHaveAttribute('href', '/?q=%EC%9D%B4%EA%B5%AC%EC%A1%B0');
  expect(screen.getByText('주')).toBeInTheDocument();
  expect(screen.getByText('퇴사')).toBeInTheDocument();
  expect(screen.getByText('선체설계부 · 수석')).toBeInTheDocument();
  // 46 — 명부에 있는 사람은 담당자 필터로(같은 이름도 가른다)
  expect(screen.getByRole('link', { name: '김퇴사' })).toHaveAttribute('href', '/?assignee=3');
});
