import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../../lib/upload.js';
import GlobalDrop from './GlobalDrop.jsx';
import { UploadProvider } from '../inbox/UploadProvider.jsx';

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

  it('17 — 모두 동일 BDF 로 막히면 성공 토스트 없이 가운데 카드에 막힌 목록을 띄운다', async () => {
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

  it('52 — 다른 화면에 폴더를 놓아도 목록 창이 뜨고, op2·f06·mvw 는 체크가 풀려 있다(2026-11-05 목록 없이 올라간 일)', async () => {
    uploadBatch.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, status: 200, json: async () => (
      url === '/api/uploads/rules' ? { excluded_patterns: [], skip_by_default: ['.op2', '.f06', '.mvw'] } : { terms: [] }) })));
    const f = (rel) => { const x = new File(['G'], rel.split('/').pop()); Object.defineProperty(x, 'webkitRelativePath', { value: rel }); return x; };
    render(<UploadProvider><MemoryRouter initialEntries={['/']}><GlobalDrop storage={{ reachable: true }} /></MemoryRouter></UploadProvider>);
    act(() => { window.dispatchEvent(fileDrag('dragenter')); });
    const overlay = screen.getByText('여기에 놓아 올리기').closest('div').parentElement;
    await act(async () => {
      fireEvent.drop(overlay, { dataTransfer: { types: ['Files'], items: [], files: [
        f('closed_chock/a.bdf'), f('closed_chock/a.op2'), f('closed_chock/a.f06'), f('closed_chock/s.mvw')] } });
    });
    const dlg = await screen.findByRole('dialog', { name: /폴더 올리기/ });
    expect(within(dlg).getByRole('checkbox', { name: 'closed_chock/a.bdf 올리기' })).toBeChecked();
    for (const n of ['a.op2', 'a.f06', 's.mvw']) {
      expect(within(dlg).getByRole('checkbox', { name: `closed_chock/${n} 올리기` })).not.toBeChecked();
    }
    expect(uploadBatch).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole('button', { name: /올리기 \(1개\)/ }));
    await vi.waitFor(() => expect(uploadBatch).toHaveBeenCalledTimes(1));
    expect(uploadBatch.mock.calls[0][0].map((i) => i.relPath)).toEqual(['closed_chock/a.bdf']);
    // 기본은 '폴더 전체를 자료 1건' — 서버가 하위 폴더 호선으로 나누지 않게 분명히 보낸다
    expect(uploadBatch.mock.calls[0][1]).toMatchObject({ whole: true, splitTop: false });
  });

  it('52 — 올리는 중에는 화면 가운데 카드에 몇 % 인지 크게 보인다', async () => {
    let finish;
    uploadBatch.mockImplementation((items, { onProgress }) => new Promise((resolve) => {
      onProgress({ sent: 40, total: 100 });
      finish = () => resolve({ key: 'K', uploaded: 1, rejected: [], blocked: [], deferred: 0 });
    }));
    renderAt('/');
    act(() => { window.dispatchEvent(fileDrag('dragenter')); });
    const overlay = screen.getByText('여기에 놓아 올리기').closest('div').parentElement;
    await act(async () => {
      fireEvent.drop(overlay, { dataTransfer: { types: ['Files'], items: [], files: [new File(['G'], 'a.bdf')] } });
    });
    const card = await screen.findByRole('region', { name: '올리기 상황' });
    expect(card).toHaveTextContent('올리는 중');
    expect(card).toHaveTextContent('40%');
    await act(async () => { finish(); });
  });
});
