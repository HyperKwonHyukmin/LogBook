import { render, screen } from '@testing-library/react';
import RevisionBrief from './RevisionBrief.jsx';

test('판 요약 한 줄 — 없으면 그리지 않는다', () => {
  const { container, rerender } = render(<RevisionBrief brief={{ series: 1, files: 3, latest: 'R2' }} />);
  expect(screen.getByText('판 3개 · 최신 R2')).toBeInTheDocument();
  rerender(<RevisionBrief brief={null} />);
  expect(container).toBeEmptyDOMElement();
});
