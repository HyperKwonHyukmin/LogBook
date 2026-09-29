import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { calls, mockApi } from '../../test/mockApi.js';
import FilePreview from './FilePreview.jsx';

const base = { size: 2048, kind: 'report', rel_path: 'x', extract: null };

test('PDF 는 inline 링크를 iframe 으로 보인다', async () => {
  mockApi({ 'POST /api/files/1/link?inline=true': { url: '/api/files/1/content?t=a&inline=1' } });
  render(<FilePreview file={{ ...base, id: 1, name: 'r.pdf' }} />);
  const frame = await screen.findByTitle('PDF 미리보기');
  expect(frame).toHaveAttribute('src', '/api/files/1/content?t=a&inline=1');
});

test('PPTX 는 슬라이드별 제목·본문·노트와 요약 카드를 보인다', async () => {
  const summary = { unit: 'slide', count: 2, title: '계류 검토', author: '홍길동', created: '2026-09-01',
    headings: ['표지', '결론'], cover: '표지 글', slide_titles: ['표지', ''] };
  mockApi({ 'GET /api/files/2/text': { state: 'done', summary, chunks: [
    { locator: 'slide:1', text: '9999 계류' }, { locator: 'notes:1', text: '노트 글' }, { locator: 'slide:2', text: '결론 본문' }] } });
  render(<FilePreview file={{ ...base, id: 2, name: 'r.pptx', extract: { state: 'done', summary } }} />);
  expect(await screen.findByText('9999 계류')).toBeInTheDocument();
  expect(screen.getByText('노트 글')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '슬라이드 2' })).toBeInTheDocument();
  expect(screen.getByText('슬라이드 2장')).toBeInTheDocument();
  expect(screen.getByText('홍길동')).toBeInTheDocument();
});

test('XLSX 는 시트 탭을 바꿔 표를 보인다', async () => {
  const fetch = mockApi({
    'GET /api/files/3/sheet': { sheets: ['응력', '요약'], name: '응력', rows: [['부재', 'MPa'], ['L100', '12']], truncated: true },
    'GET /api/files/3/sheet?name=%EC%9A%94%EC%95%BD': { sheets: ['응력', '요약'], name: '요약', rows: [['OK']], truncated: false },
  });
  render(<FilePreview file={{ ...base, id: 3, name: 's.xlsx' }} />);
  expect(await screen.findByText('L100')).toBeInTheDocument();
  expect(screen.getByText(/앞 200행만/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '요약' }));
  expect(await screen.findByText('OK')).toBeInTheDocument();
  expect(calls(fetch)).toContain('GET /api/files/3/sheet?name=%EC%9A%94%EC%95%BD');
});

test('DRM 으로 건너뛴 파일은 사유를 보이고, 지원 안 하는 형식은 안내한다', async () => {
  mockApi({});
  const { rerender } = render(<FilePreview file={{ ...base, id: 4, name: 'r.docx', extract: { state: 'skipped', error: 'drm' } }} />);
  expect(screen.getByText(/DRM 암호화 파일이라/)).toBeInTheDocument();
  rerender(<FilePreview file={{ ...base, id: 5, name: 'm.bdf', kind: 'model' }} />);
  expect(screen.getByText(/미리보기를 지원하지 않습니다/)).toBeInTheDocument();
});

test('경로 복사', async () => {
  mockApi({});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
  render(<FilePreview file={{ ...base, id: 6, name: 'm.bdf', kind: 'model', rel_path: 'a/m.bdf' }} vaultUnc={'\\\\srv\\E1'} />);
  await userEvent.click(screen.getByRole('button', { name: '경로 복사' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('\\\\srv\\E1\\files\\a\\m.bdf');
  expect(await screen.findByRole('status')).toHaveTextContent('경로를 복사했습니다');
});

test('내려받기 버튼은 링크를 받아 연다', async () => {
  const fetch = mockApi({ 'POST /api/files/7/link': { url: '/api/files/7/content?t=z' } });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<FilePreview file={{ ...base, id: 7, name: 'm.bdf', kind: 'model' }} />);
  await userEvent.click(screen.getByRole('button', { name: '내려받기' }));
  expect(calls(fetch)).toContain('POST /api/files/7/link');
  expect(click).toHaveBeenCalled();
});

test('휴지통의 파일은 미리보기·내려받기·경로 복사를 숨기고 안내한다', () => {
  const fetch = mockApi({});
  render(<FilePreview file={{ ...base, id: 8, name: 'r.pdf', location: 'trash' }} vaultUnc={'\\srv\E1'} />);
  expect(screen.getByText('휴지통에 있는 자료입니다. 복원 후 볼 수 있습니다.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '내려받기' })).toBeNull();
  expect(screen.queryByRole('button', { name: '경로 복사' })).toBeNull();
  expect(screen.queryByTitle('PDF 미리보기')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test('trashed prop 으로도 휴지통 안내를 보인다', () => {
  mockApi({});
  render(<FilePreview file={{ ...base, id: 9, name: 'm.bdf', kind: 'model' }} trashed />);
  expect(screen.getByText(/복원 후 볼 수 있습니다/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '내려받기' })).toBeNull();
});

test('파일 주소가 아닌 링크는 iframe 에 넣지 않는다', async () => {
  mockApi({ 'POST /api/files/1/link?inline=true': { url: 'javascript:alert(1)' } });
  render(<FilePreview file={{ ...base, id: 1, name: 'r.pdf' }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('미리보기를 불러오지 못했습니다');
  expect(screen.queryByTitle('PDF 미리보기')).toBeNull();
});

test('시트를 불러오다 실패해도 시트 탭은 남아 다시 고를 수 있다', async () => {
  mockApi({
    'GET /api/files/3/sheet': { sheets: ['응력', '요약'], name: '응력', rows: [['L100']], truncated: false },
    'GET /api/files/3/sheet?name=%EC%9A%94%EC%95%BD': { __status: 422, detail: 'unreadable' },
    'GET /api/files/3/sheet?name=%EC%9D%91%EB%A0%A5': { sheets: ['응력', '요약'], name: '응력', rows: [['L100']], truncated: false },
  });
  render(<FilePreview file={{ ...base, id: 3, name: 's.xlsx' }} />);
  await screen.findByText('L100');
  await userEvent.click(screen.getByRole('tab', { name: '요약' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('파일을 열 수 없습니다');
  await userEvent.click(screen.getByRole('tab', { name: '응력' }));
  expect(await screen.findByText('L100')).toBeInTheDocument();
});
