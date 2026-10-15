import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../../lib/upload.js';
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

  it('17 — 모두 동일 BDF 로 막히면 성공 토스트 없이 오른쪽 아래에 막힌 목록을 띄운다', async () => {
    uploadBatch.mockResolvedValue({ key: null, uploaded: 0, rejected: [], deferred: 0, blocked: [{
      name: 'copy.bdf', reason: 'duplicate_model', scope: 'existing', includes: [], total: 0, hidden: true, matches: [] }] });
    renderAt('/');
    act(() => { window.dispatchEvent(fileDrag('dragenter')); });
    const overlay = screen.getByText('여기에 놓아 올리기').closest('div').parentElement;
    await act(async () => {
      fireEvent.drop(overlay, { dataTransfer: { types: ['Files'], items: [], files: [new File(['G'], 'copy.bdf')] } });
    });
    expect(await screen.findByRole('region', { name: '올리지 않은 BDF' })).toHaveTextContent('권한이 없는 자료에 같은 BDF 가 이미 있습니다');
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
  });
});
