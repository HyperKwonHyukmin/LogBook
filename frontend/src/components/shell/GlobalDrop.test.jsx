import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import GlobalDrop from './GlobalDrop.jsx';

function fileDrag(type) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = { types: ['Files'], files: [] };
  return e;
}

function renderAt(path) {
  return render(<MemoryRouter initialEntries={[path]}><GlobalDrop storage={{ reachable: true }} /></MemoryRouter>);
}

describe('GlobalDrop', () => {
  it('검색 화면에서 파일을 끌고 들어오면 올리기 덮개를 띄운다', () => {
    renderAt('/');
    act(() => { window.dispatchEvent(fileDrag('dragenter')); });
    expect(screen.getByText('여기에 놓아 올리기')).toBeInTheDocument();
  });

  it('정리 대기·Entry 화면은 자기 올리기 칸을 쓰므로 덮개를 띄우지 않는다', () => {
    for (const path of ['/inbox', '/e/12']) {
      const { unmount } = renderAt(path);
      act(() => { window.dispatchEvent(fileDrag('dragenter')); });
      expect(screen.queryByText('여기에 놓아 올리기')).toBeNull();
      unmount();
    }
  });

  it('받는 곳이 없는 놓기는 막아 브라우저가 파일을 열지 않게 한다', () => {
    renderAt('/e/12');
    const over = fileDrag('dragover');
    const drop = fileDrag('drop');
    act(() => { window.dispatchEvent(over); window.dispatchEvent(drop); });
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });
});
