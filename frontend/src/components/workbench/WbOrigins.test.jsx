import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import WbOrigins from './WbOrigins.jsx';

// 39 — WorkBench 해석 출처
const ORIGIN = { analysis_id: 123, label: 'WB #123', program: 'GroupModuleUnit', owner: 'B390001',
  created_at: '2026-10-19T09:00:00', files: [1, 2], matched: [{ file_id: 1, role: 'input', name: 'model.bdf' }] };

test('번호·프로그램·해석자·일시와 WB 산출물과 같은 파일을 보이고, 번호를 복사한다', async () => {
  const onCopy = vi.fn();
  render(<WbOrigins origins={[ORIGIN]} files={[{ id: 1, name: 'm.bdf' }]} onCopy={onCopy} />);
  expect(screen.getByText('WB #123')).toBeInTheDocument();
  expect(screen.getByText('GroupModuleUnit · 해석 B390001 · 2026-10-19')).toBeInTheDocument();
  expect(screen.getByText(/WB 산출물과 같음 — m\.bdf/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'WB #123 복사' }));
  expect(onCopy).toHaveBeenCalledWith('WB #123');
});

test('출처가 없으면 그리지 않는다(서버 키가 꺼져 있으면 wb_origins 자체가 없다)', () => {
  const { container } = render(<WbOrigins origins={undefined} files={[]} onCopy={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
