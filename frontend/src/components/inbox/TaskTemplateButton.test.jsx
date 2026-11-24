import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import TaskTemplateButton from './TaskTemplateButton.jsx';

test('과제 엑셀 양식을 받아 파일로 저장한다', async () => {
  mockApi({ 'GET /api/batches/task-template': { __blob: new Blob(['xlsx']) } });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { this.dataset.clicked = this.download; });
  render(<TaskTemplateButton />);
  await userEvent.click(screen.getByRole('button', { name: /과제 엑셀 양식/ }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.contexts[0].download).toBe(`과제엑셀_양식_${new Date().getFullYear()}.xlsx`);
  click.mockRestore();
});

test('받지 못하면 단추 글자로 알린다', async () => {
  mockApi({ 'GET /api/batches/task-template': { __status: 500 } });
  render(<TaskTemplateButton />);
  await userEvent.click(screen.getByRole('button', { name: /과제 엑셀 양식/ }));
  expect(await screen.findByRole('button', { name: /양식을 받지 못했습니다/ })).toBeInTheDocument();
});
