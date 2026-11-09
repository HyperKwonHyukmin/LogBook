import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { mockApi } from '../../test/mockApi.js';
import EntryPreviewPanel from './EntryPreviewPanel.jsx';

vi.mock('../preview/FilePreview.jsx', () => ({
  default: ({ file }) => <p>미리보기:{file.name}</p>,
  FileActions: () => null,
}));

const ENTRY = {
  entry_id: 'E000166', title: '3091 PSD', status: 'confirmed', hulls: [], zones: [], tags: [], favorite: false,
  files: [
    { id: 1, kind: 'report', name: 'r.pdf', size: 1, rel_path: 'r.pdf' },
    { id: 2, kind: 'other', name: 'm.inp', size: 1, rel_path: 'm.inp', model: { state: 'done', format_version: 2 } },
    { id: 3, kind: 'model', name: 'main.bdf', size: 1, rel_path: 'main.bdf', model: { state: 'done', format_version: 2 } },
  ],
};

function renderPanel(fileId = null) {
  mockApi({ 'GET /api/entries/E000166': ENTRY });
  render(<MemoryRouter><EntryPreviewPanel entryId="E000166" fileId={fileId} onClose={() => {}} /></MemoryRouter>);
}

test('기본 미리보기는 BDF, 목록은 BDF → INP → 보고서 순', async () => {
  renderPanel();
  expect(await screen.findByText('미리보기:main.bdf')).toBeInTheDocument();
  const names = within(screen.getByRole('list', { name: '파일' })).getAllByRole('button').map((b) => b.textContent);
  expect(names.map((t) => t.match(/main\.bdf|m\.inp|r\.pdf/)[0])).toEqual(['main.bdf', 'm.inp', 'r.pdf']);
});

test('검색이 가리킨 파일(fileId)이 있으면 그 파일을 먼저 보인다', async () => {
  renderPanel(1);
  expect(await screen.findByText('미리보기:r.pdf')).toBeInTheDocument();
});
