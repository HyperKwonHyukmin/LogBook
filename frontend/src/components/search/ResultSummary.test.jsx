import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ResultSummary from './ResultSummary.jsx';
import { FamilyBar, ModelLine, ReportLine } from './RowInsight.jsx';

const SUMMARY = {
  total: 38,
  // 42 — 해석 종류 분포는 없앴다(옛 응답에 있어도 그리지 않는다)
  analysis_type: [{ value: '강도 평가', count: 14 }],
  analysis_type_values: 1,
  hull: [{ value: '9002', count: 11 }, { value: '9001', count: 7 }, { value: '9003', count: 5 },
    { value: '9004', count: 3 }, { value: '9005', count: 2 }],
  hull_values: 6,
  solve: { pass: 21, fail: 3, error: 0, stale: 1, pending: 0, none: 14, no_model: 2 },
  model_size: { min: 1200, max: 50000, models: 36, buckets: [{ min: 0, max: 1000, count: 0 }, { min: 1000, max: 10000, count: 20 },
    { min: 10000, max: 50000, count: 15 }, { min: 50000, max: null, count: 1 }] },
};

test('요약 띠 — 호선 분포, 막대를 누르면 그 필터를 건다', async () => {
  const onFilter = vi.fn();
  render(<ResultSummary summary={SUMMARY} filters={{ hull: '9001' }} onFilter={onFilter} />);
  const region = screen.getByRole('region', { name: '결과 요약' });
  expect(region).toHaveTextContent('결과 38건 요약');
  expect(within(region).queryByRole('group', { name: '해석 종류 분포' })).toBeNull();
  expect(region).not.toHaveTextContent('강도 평가');
  const hulls = within(region).getByRole('group', { name: '호선 분포' });
  expect(within(hulls).getAllByRole('button')).toHaveLength(3);
  expect(hulls).toHaveTextContent('외 3');
  await userEvent.click(within(hulls).getByRole('button', { name: /9002/ }));
  expect(onFilter).toHaveBeenLastCalledWith('hull', '9002');
  // 걸린 값은 강조되고, 다시 누르면 그 값을 끈다(19 — 칸 안 값 켜고 끄기, 목록 모양 필터도 받는다)
  const on = within(region).getByRole('button', { name: /9001/ });
  expect(on).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(on);
  expect(onFilter).toHaveBeenLastCalledWith('hull', '9001');
  // 15 — 해석 시기 분포는 없앴다(옛 응답에 years 가 있어도 그리지 않는다)
  expect(within(region).queryByRole('group', { name: '해석 시기 분포' })).toBeNull();
  expect(region).not.toHaveTextContent('해석 시기');
  expect(region).toHaveTextContent('해석 가능 21');
  expect(region).toHaveTextContent('해석 불가 3');
  expect(region).toHaveTextContent('미검증 14');
  expect(region).toHaveTextContent('BDF 없음 2');
  expect(region).not.toHaveTextContent('확인 못 함');
  expect(region).toHaveTextContent('요소 1.2천~5만');
  expect(region).toHaveTextContent('1천~1만 20');
  expect(region).not.toHaveTextContent('1천 미만');
});

test('요약 띠는 접은 상태를 기억하고, 결과가 2건 미만이면 숨는다', async () => {
  const { unmount } = render(<ResultSummary summary={SUMMARY} onFilter={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /결과 38건 요약/ }));
  expect(screen.getByRole('button', { name: /결과 38건 요약/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('group', { name: '호선 분포' })).toBeNull();
  expect(localStorage.getItem('logbook.searchSummaryCollapsed.v1')).toBe('1');
  unmount();
  render(<ResultSummary summary={SUMMARY} onFilter={() => {}} />);
  expect(screen.getByRole('button', { name: /결과 38건 요약/ })).toHaveAttribute('aria-expanded', 'false');
});

test('결과 1건이면 요약 띠가 없다', () => {
  render(<ResultSummary summary={{ ...SUMMARY, total: 1 }} onFilter={() => {}} />);
  expect(screen.queryByRole('region', { name: '결과 요약' })).toBeNull();
});

const MODEL = { file_id: 7, elements: 12431, nodes: 9820, size: [24000, 18200, 9600], sol: '101', groups: 1,
  families: { beam: 8000, shell: 4000, rigid: 431, mass: 0, other: 0 }, solve: { state: 'pass', status: 'pass', error_types: [], stale: false } };

test('모델 한 줄 — 요소·구성 막대·노드·크기·SOL·검증·그룹', () => {
  render(<ModelLine model={MODEL} />);
  expect(screen.getByText('12,431').parentElement).toHaveTextContent('요소 12,431');
  expect(screen.getByText('요소 구성 보 8,000 · 쉘 4,000 · RBE 431')).toBeInTheDocument();
  expect(screen.getByText('24,000 × 18,200 × 9,600')).toHaveAttribute('title', expect.stringContaining('24.0 × 18.2 × 9.6 m'));
  expect(screen.getByText('해석 가능')).toBeInTheDocument();
  expect(screen.getByTitle('해석 검증이 센 연결 그룹 수')).toHaveTextContent('그룹 1');
});

test('모델 한 줄 — 검증 실패·미검증, 그룹 모름이면 뺀다', () => {
  const { rerender } = render(<ModelLine model={{ ...MODEL, groups: null, solve: { state: 'fail', status: 'fail', error_types: ['mechanism'], stale: false } }} />);
  expect(screen.getByText(/해석 불가/)).toHaveTextContent('해석 불가 · 구속 부족·메커니즘');
  expect(screen.queryByTitle('해석 검증이 센 연결 그룹 수')).toBeNull();
  rerender(<ModelLine model={{ ...MODEL, solve: { state: null, status: 'none', error_types: [], stale: false } }} />);
  expect(screen.getByText('미검증')).toBeInTheDocument();
  rerender(<ModelLine model={null} />);
  expect(screen.queryByText(/요소/)).toBeNull();
});

test('보고서 한 줄과 빈 막대', () => {
  render(<ReportLine report={{ file_id: 1, name: 'a.pdf', title: '선미부 국부 강도 검토', unit: 'page', count: 24, author: null }} />);
  expect(screen.getByText('「선미부 국부 강도 검토」')).toBeInTheDocument();
  expect(screen.getByText('24쪽')).toBeInTheDocument();
  const { container } = render(<FamilyBar families={{ beam: 0 }} />);
  expect(container).toBeEmptyDOMElement();
});
