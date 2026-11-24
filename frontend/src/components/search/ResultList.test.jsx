import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ResultList, { contentKind, titleTail } from './ResultList.jsx';

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

test('제목 머리 빼기 — 둘째 줄과 겹치는 호선(공용), 구역, 대상만 앞에서부터, 구별자는 남긴다', () => {
  const it = (title, o = {}) => titleTail({ title, hulls: ['3503'], zones: ['기타'], target: 'Unit', ...o });
  expect(it('3503 · 기타 · Unit · M03 Upper stand')).toBe('M03 Upper stand');
  expect(it('공용 · 기타 · 의장품 · 9 함미 축전지', { hulls: [], no_hull: true, target: '의장품' })).toBe('9 함미 축전지');
  expect(it('3503 · 선미부 · Unit · m12')).toBe('선미부 · Unit · m12');   // 구역이 다르면 거기서 멈춘다
  expect(it('3503 · 기타 · Unit')).toBe('Unit');                        // 다 맞아도 한 토막은 남긴다
  expect(it('선미 구조 국부 강도')).toBe('선미 구조 국부 강도');         // 형식이 아닌 옛 제목은 그대로
  expect(it('공용 · 기타 · x', { hulls: [] })).toBe('공용 · 기타 · x');   // 공용이 아닌 자료의 '공용' 은 떼지 않는다
});

test('행 제목은 구별자만 보이고 전체 제목은 title, 오른쪽에 담당자(외 N, 퇴사는 행에 안 보임)와 0 이 아닌 파일 수만', () => {
  render(
    <MemoryRouter>
      <ResultList unit="entry" onSelect={() => {}} onOpen={() => {}}
                  items={[entry('E000222', counts(2, 0, { result: 1 }), { title: '3503 · 기타 · Unit · M03 Upper stand',
                    hulls: ['3503'], zones: ['기타'], target: 'Unit',
                    assignees: [{ name: '김미희', employed: false }, { name: '박준석', employed: true }] })]} />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'M03 Upper stand' });
  expect(link).toHaveAttribute('title', '3503 · 기타 · Unit · M03 Upper stand');
  const who = screen.getByTitle('담당자 김미희, 박준석');
  expect(who).toHaveTextContent('담당 김미희 외 1');
  expect(screen.queryByText(/퇴사/)).toBeNull();
  expect(screen.getByLabelText('파일 BDF 2, 결과 1')).toBeInTheDocument();
  expect(screen.queryByText(/도면/)).toBeNull();
});

test('2026-11-25 — .inp·.fem(보기 전용 모델)만 있어도 모델+문서, 파일 수 줄은 INP/FEM', () => {
  expect(contentKind(entry('f', counts(0, 1, { model_view: 1 })))).toBe('both');
  expect(contentKind(entry('g', counts(0, 0, { model_view: 2 })))).toBe('model');
  render(
    <MemoryRouter>
      <ResultList unit="entry" onSelect={() => {}} onOpen={() => {}} items={[entry('E000292', counts(0, 1, { model_view: 1 }))]} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId('content-kind')).toHaveTextContent('모델+문서');
  expect(screen.getByLabelText('파일 INP/FEM 1, 문서 1')).toBeInTheDocument();
});
