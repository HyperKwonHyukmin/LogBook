import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage, { windowsLogin } from './LoginPage.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

function renderPage(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>,
  );
}

/** 55 — /api/auth/options 만 따로 답하는 fetch. 나머지는 404. */
function mockOptions(options) {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/auth/options'
    ? { ok: true, status: 200, json: () => Promise.resolve(options) }
    : { ok: false, status: 404, json: () => Promise.resolve({ detail: 'not_found' }) })));
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
  const [url, init] = fetch.mock.calls.find(([u]) => u === '/api/auth/login');
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

describe('55 — Windows 계정 자동 로그인', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('145(사번 로그인 닫힘) — 들어오자마자 /auth/windows 로 한 번 가고, 사번 칸은 없다', async () => {
    const go = vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: true, employee_id_login: false });
    renderPage();
    expect(await screen.findByText('회사 PC 계정으로 들어갑니다')).toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('/');
    expect(screen.queryByLabelText('사번')).toBeNull();
  });

  test('로그인 뒤 원래 보던 화면(next)으로 돌아가게 넘긴다', async () => {
    const go = vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: true, employee_id_login: false });
    renderPage('/login?next=%2Fentries%2FE000001');
    await screen.findByText('회사 PC 계정으로 들어갑니다');
    expect(go).toHaveBeenCalledWith('/entries/E000001');
  });

  test('방금 실패했으면(?windows=) 다시 가지 않고 사유와 [Windows 계정으로 로그인] 단추를 보인다', async () => {
    const go = vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: true, employee_id_login: false });
    renderPage('/login?windows=windows_account_not_employee');
    expect(await screen.findByRole('alert')).toHaveTextContent('사번 계정(HHI\\사번)으로 로그인돼 있지 않습니다');
    expect(go).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Windows 계정으로 로그인' }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  test('WorkBench 쪽 사유(not_registered)도 같은 문구로 보인다', async () => {
    vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: true, employee_id_login: false });
    renderPage('/login?windows=not_registered');
    expect(await screen.findByRole('alert')).toHaveTextContent('WorkBench 에 가입된 사번이 아닙니다');
  });

  test('방금 로그아웃했으면 자동으로 다시 들어가지 않는다', async () => {
    const go = vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    sessionStorage.setItem('logbook_logout_reason', 'logged_out');
    mockOptions({ windows: true, employee_id_login: false });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Windows 계정으로 로그인' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('로그아웃했습니다.');
    expect(go).not.toHaveBeenCalled();
  });

  test('개발 PC(사번 로그인 열림)는 사번 칸도 함께 보인다', async () => {
    vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: true, employee_id_login: true });
    renderPage('/login?windows=unavailable');
    expect(await screen.findByRole('button', { name: 'Windows 계정으로 로그인' })).toBeInTheDocument();
    expect(screen.getByLabelText('사번')).toBeInTheDocument();
  });

  test('Windows 로그인을 못 쓰는 서버는 예전처럼 사번 화면', async () => {
    const go = vi.spyOn(windowsLogin, 'go').mockImplementation(() => {});
    mockOptions({ windows: false, employee_id_login: true });
    renderPage();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/options', expect.anything()));
    expect(screen.getByText('사번으로 들어갑니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Windows 계정으로 로그인' })).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });
});
