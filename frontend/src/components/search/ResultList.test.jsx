import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ResultList, { contentKind } from './ResultList.jsx';

const counts = (model, report, o = {}) => ({ model, report, drawing: 0, result: 0, other: 0, ...o });
const entry = (id, kc, o = {}) => ({ entry_id: id, title: `${id} 제목`, status: 'confirmed', hulls: [], zones: [], tags: [],
  kinds: [], kind_counts: kc, posted_at: '2026-11-01T09:00:00', ...o });

test('구성 판정 — 모델과 문서, 모델만, 문서만, 둘 다 없음, 수가 없는 옛 응답', () => {
  expect(contentKind(entry('a', counts(2, 1)))).toBe('both');
  expect(contentKind(entry('b', counts(1, 0)))).toBe('model');
  expect(contentKind(entry('c', counts(0, 3)))).toBe('report');
  expect(contentKind(entry('d', counts(0, 0, { drawing: 2 })))).toBeNull();
  expect(contentKind(entry('e', undefined, { kinds: ['report', 'model'] }))).toBe('both');
});

test('행마다 구성 배지와 자료 번호 복사 단추 — 복사해도 행이 선택되지 않는다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const onSelect = vi.fn();
  render(
    <MemoryRouter>
      <ResultList unit="entry" onSelect={onSelect} onOpen={() => {}}
                  items={[entry('E000233', counts(2, 1)), entry('E000234', counts(1, 0)), entry('E000235', counts(0, 1)),
                          entry('E000236', counts(0, 0, { drawing: 1 }))]} />
    </MemoryRouter>,
  );
  expect(screen.getAllByTestId('content-kind').map((b) => b.textContent)).toEqual(['모델+문서', '모델만', '문서만']);
  const btn = screen.getByRole('button', { name: '자료 번호 E000233 복사' });
  await userEvent.click(btn);
  expect(writeText).toHaveBeenCalledWith('E000233');
  expect(onSelect).not.toHaveBeenCalled();
  expect(within(btn.parentElement).getByText('E000233')).toBeInTheDocument();
});
