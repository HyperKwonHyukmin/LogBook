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
  ['not_registered', '등록되지 않은 사번입니다'],
  ['pending_approval', '관리자 승인을 기다리는 중입니다'],
  ['account_disabled', '비활성화된 계정입니다'],
])('로그인 오류 %s 를 한국어로 보여 준다', async (detail, text) => {
  mockFetchOnce(detail === 'not_registered' ? 404 : 403, { detail });
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100001');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
});

test('필수 입력 필드에 aria-required 가 있다(네이티브 required 는 쓰지 않는다)', async () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  const employeeIdInput = screen.getByLabelText('사번');
  expect(employeeIdInput).toHaveAttribute('aria-required', 'true');
  expect(employeeIdInput).not.toHaveAttribute('required');
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  const nameInput = screen.getByLabelText('이름');
  expect(nameInput).toHaveAttribute('aria-required', 'true');
  expect(nameInput).not.toHaveAttribute('required');
});

test('기억된 사번을 미리 채운다', () => {
  localStorage.setItem('logbook_saved_employee_id', 'A476854');
  renderPage();
  expect(screen.getByLabelText('사번')).toHaveValue('A476854');
});

test('가입 신청이 성공하면 승인 대기 안내를 보여 준다', async () => {
  mockFetchOnce(201, { employee_id: 'A100009', status: 'pending' });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A100009');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('status')).toHaveTextContent('관리자 승인 후');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/register');
  expect(JSON.parse(init.body)).toMatchObject({ employee_id: 'A100009', name: '박영수' });
});

test('가입 신청 성공 후 로그인 탭으로 전환되고 사번이 남아 있다', async () => {
  mockFetchOnce(201, { employee_id: 'A100009', status: 'pending' });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A100009');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  await screen.findByRole('status');
  expect(screen.getByRole('tab', { name: '로그인' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('사번')).toHaveValue('A100009');
  expect(screen.getByRole('status')).toHaveTextContent('관리자 승인 후');
});

test('사번 형식 오류 메시지를 보여 준다', async () => {
  mockFetchOnce(422, { detail: 'invalid_employee_id' });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'bad-id');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('사번 형식이 올바르지 않습니다');
});

test('중복 가입 신청 메시지를 보여 준다', async () => {
  mockFetchOnce(409, { detail: 'already_registered' });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A476854');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 가입 신청된 사번입니다');
});

test('422 오류의 detail 이 문자열이 아니면 공통 입력값 확인 안내를 보여 준다', async () => {
  mockFetchOnce(422, { detail: [{ loc: ['body', 'name'], msg: 'field required' }] });
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A100010');
  await userEvent.type(screen.getByLabelText('이름'), '박영수');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('입력값을 확인해 주세요.');
});

test('네트워크 오류면 서버 연결 실패 안내를 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  renderPage();
  await userEvent.type(screen.getByLabelText('사번'), 'A100001');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.');
});

test('가입 신청에서 이름이 비어 있으면 요청 없이 안내만 한다', async () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  await userEvent.click(screen.getByRole('tab', { name: '가입 신청' }));
  await userEvent.type(screen.getByLabelText('사번'), 'A100011');
  await userEvent.click(screen.getByRole('button', { name: '가입 신청' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이름을 입력해 주세요.');
  expect(fetch).not.toHaveBeenCalled();
});

test('탭이 완전한 WAI-ARIA 구조를 갖는다', () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  const tablist = screen.getByRole('tablist', { name: '로그인 방식' });
  expect(tablist).toBeInTheDocument();
  const loginTab = screen.getByRole('tab', { name: '로그인' });
  const registerTab = screen.getByRole('tab', { name: '가입 신청' });
  const panel = screen.getByRole('tabpanel');
  expect(panel).toHaveAttribute('id', 'auth-panel');
  expect(loginTab).toHaveAttribute('aria-controls', 'auth-panel');
  expect(registerTab).toHaveAttribute('aria-controls', 'auth-panel');
  expect(panel).toHaveAttribute('aria-labelledby', loginTab.id);
  expect(loginTab).toHaveAttribute('tabIndex', '0');
  expect(registerTab).toHaveAttribute('tabIndex', '-1');
});

test('화살표 키로 탭을 전환하고 포커스를 옮긴다', async () => {
  vi.stubGlobal('fetch', vi.fn());
  renderPage();
  const loginTab = screen.getByRole('tab', { name: '로그인' });
  const registerTab = screen.getByRole('tab', { name: '가입 신청' });
  loginTab.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(registerTab).toHaveFocus();
  expect(registerTab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', registerTab.id);
  await userEvent.keyboard('{ArrowLeft}');
  expect(loginTab).toHaveFocus();
  expect(loginTab).toHaveAttribute('aria-selected', 'true');
});
