import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

function renderPage() {
  return render(
    <MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>,
  );
}

function mockFetchOnce(status, body) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 300, status, json: () => Promise.resolve(body),
  }));
}

test.each([
  ['not_registered', 404, 'WorkBench 에 가입된 사번이 아닙니다'],
  ['wb_inactive', 403, '승인 대기 중이거나 비활성화된 계정'],
  ['wb_unavailable', 503, 'WorkBench 사용자 정보를 읽을 수 없어'],
  ['invalid_employee_id', 422, '사번 형식이 올바르지 않습니다'],
])('로그인 오류 %s 를 한국어로 보여 준다', async (detail, status, text) => {
  mockFetchOnce(status, { detail });
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100001');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
});

test('이름은 Hi-TESS LogBook, 가입 신청 탭은 없다(WorkBench 가입자만)', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  expect(screen.getByRole('region', { name: 'Hi-TESS LogBook' })).toHaveTextContent('Hi-TESS LogBook');
  expect(screen.getByText('구조해석 항해일지')).toBeInTheDocument();
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByLabelText('이름')).toBeNull();
  expect(screen.getByText(/WorkBench 에서 가입·승인된 사번/)).toBeInTheDocument();
});

test('사번 입력에 aria-required 가 있다(네이티브 required 는 쓰지 않는다)', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  const employeeIdInput = screen.getByLabelText('사번');
  expect(employeeIdInput).toHaveAttribute('aria-required', 'true');
  expect(employeeIdInput).not.toHaveAttribute('required');
});

test('기억된 사번을 미리 채운다', () => {
  localStorage.setItem('logbook_saved_employee_id', 'A476854');
  renderPage();
  expect(screen.getByLabelText('사번')).toHaveValue('A476854');
});

test('로그인은 /api/auth/login 으로 사번만 보낸다', async () => {
  mockFetchOnce(200, { token: 't', user: { employee_id: 'A100009', name: '박영수', level: 1 } });
  renderPage();
  await userEvent.clear(screen.getByLabelText('사번'));
  await userEvent.type(screen.getByLabelText('사번'), 'A100009');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/login');
  expect(JSON.parse(init.body)).toEqual({ employee_id: 'A100009' });
});

test('422 오류의 detail 이 문자열이 아니면 공통 입력값 확인 안내를 보여 준다', async () => {
  mockFetchOnce(422, { detail: [{ loc: ['body', 'employee_id'], msg: 'field required' }] });
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100010');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('입력값을 확인해 주세요.');
});

test('네트워크 오류면 서버 연결 실패 안내를 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100001');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.');
});

test('18 — WorkBench 로그아웃으로 끊겼으면 한 번 안내한다', () => {
  vi.stubGlobal('fetch', vi.fn());
  sessionStorage.setItem('logbook_logout_reason', 'wb_logout');
  renderPage();
  expect(screen.getByRole('status')).toHaveTextContent('WorkBench에서 로그아웃되어 LogBook도 로그아웃되었습니다.');
  expect(sessionStorage.getItem('logbook_logout_reason')).toBeNull();
  sessionStorage.clear();
});
