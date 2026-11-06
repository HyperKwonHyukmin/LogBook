import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiftingSetChip } from './WireChip.jsx';

// 2026-11-06 — 정리 대기 카드 머리: Module Unit 권상 자료의 Wire·결과 유무
describe('LiftingSetChip', () => {
  it('MU 자료가 아니면 아무것도 안 보인다', () => {
    const { container } = render(<LiftingSetChip lifting={{ needed: false, has_wire: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('Wire 없음 / Wire 포함 / Wire · 결과 포함', () => {
    const { rerender } = render(<LiftingSetChip lifting={{ needed: true, has_wire: false, has_result: false }} />);
    expect(screen.getByText('Wire 없음')).toBeInTheDocument();
    rerender(<LiftingSetChip lifting={{ needed: true, has_wire: true, has_result: false }} />);
    expect(screen.getByText('Wire 포함')).toBeInTheDocument();
    rerender(<LiftingSetChip lifting={{ needed: true, has_wire: true, has_result: true }} />);
    expect(screen.getByText('Wire · 결과 포함')).toBeInTheDocument();
  });
});
