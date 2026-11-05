import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchCard from './BatchCard.jsx';

const base = { key: 'K', source: 'web', original_name: '모델 묶음', uploader: 'A100001', received_at: '2026-10-06T09:00:00',
  excluded: [], error: null, entries: [] };
const queue = { worker_alive: true, job_state: 'running', ahead: 0, busy_with: [], attempts: 1, last_error: null };
const draw = (batch) => render(<BatchCard batch={batch} me="A100001" isAdmin={false} onChanged={() => {}} onClaim={() => {}} />);

test('분석 중 — 지금 단계 n/N 한 줄, 펼치면 처리 단계와 이유', async () => {
  draw({ ...base, state: 'staged', queue, progress: { step: 'files', done: 3, total: 12 } });
  // 눈에 띄는 진행 패널 — 제목·지금 하는 일·단계·n/N 만큼 찬 진행 막대
  const panel = screen.getByRole('status', { name: '정리 진행' });
  expect(panel).toHaveTextContent('정리하는 중입니다');
  expect(panel).toHaveTextContent('파일 확인 중 3/12');
  expect(within(panel).getByRole('list', { name: '처리 단계' }).querySelector('[aria-current="step"]')).toHaveTextContent('파일마다 확인');
  expect(within(panel).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.round(((1 + 3 / 12) / 4) * 100)));
  await userEvent.click(screen.getByText('무엇을 하나요?'));
  const steps = within(screen.getByText('무엇을 하나요?').closest('details')).getByRole('list');
  expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
  expect(within(steps).getByText('파일마다 확인').closest('li')).toHaveAttribute('aria-current', 'step');
  expect(within(steps).getByText(/지문\(SHA-256\)/)).toBeInTheDocument();
  expect(screen.getByText(/초안\(미확정 자료\)/)).toBeInTheDocument();
});

test('분석 중 — 아직 시작 전이면 기다리는 중으로, 흐르는 막대', () => {
  draw({ ...base, state: 'staged', queue: { ...queue, job_state: 'queued', ahead: 2 }, progress: null });
  const panel = screen.getByRole('status', { name: '정리 진행' });
  expect(panel).toHaveTextContent('정리를 기다리는 중입니다');
  expect(panel).toHaveTextContent('앞의 배치 2개를 먼저 처리하고 있습니다');
  expect(within(panel).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
});

test('분석 중 — 워커가 꺼져 있으면 눈에 띄게 알린다', () => {
  draw({ ...base, state: 'staged', queue: { ...queue, job_state: 'queued', worker_alive: false }, progress: null });
  expect(screen.getByRole('status')).toHaveTextContent('처리 프로그램(워커)이 꺼져 있어 기다리는 중입니다. 관리자에게 알려 주세요.');
});

test('정리 대기 — 왜 기다리는지, BDF 변환 상태, 초안마다 확인할 것', async () => {
  const draft = { entry_id: 'E000010', status: 'draft', title: '', version: 1, hulls: [], zones: [], hull_evidence: [],
    suggested_entry: null, merge_into: null, uploaded_by: 'A100001',
    files: [
      { id: 1, rel_path: 'a.bdf', name: 'a.bdf', kind: 'model', size: 10, drm_encrypted: false, model: { state: 'queued', running: true } },
      { id: 2, rel_path: 'b.bdf', name: 'b.bdf', kind: 'model', size: 10, drm_encrypted: false, model: { state: 'done' } },
      { id: 3, rel_path: 'r.pdf', name: 'r.pdf', kind: 'report', size: 10, drm_encrypted: false, model: null },
    ] };
  draw({ ...base, state: 'processed', entries: [draft] });
  expect(screen.getByText(/초안/, { selector: 'span' })).toHaveTextContent('초안 1개 · 확인 후 확정하세요');
  expect(screen.getByTitle('BDF 3D 변환 상태')).toHaveTextContent('BDF 변환 중 1 · 준비됨 1');
  await userEvent.click(screen.getByText('왜 기다리나요?'));
  expect(screen.getByText(/서버가 폴더·파일 이름으로/)).toBeInTheDocument();
  expect(screen.getByText(/10_Vault/)).toBeInTheDocument();
  expect(screen.getByText(/BDF 3D 변환은 확정과 따로/)).toBeInTheDocument();
  const card = screen.getByRole('article', { name: /E000010/ });
  const checks = within(card).getByLabelText('확인할 것');
  expect(checks).toHaveTextContent('제목 없음: 확정하려면 필요합니다');
  expect(checks).toHaveTextContent('호선 없음');
  expect(within(card).getByText('3D 변환 중')).toBeInTheDocument();
  expect(within(card).getByText('3D 준비됨')).toBeInTheDocument();
});

test('52 — [이 묶음 모두 확정]: 물어야 하는 초안은 건너뛰고 나머지를 차례로 확정한다', async () => {
  const posted = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (init.method === 'POST') posted.push(url);
    const body = url.includes('/confirm') ? { ok: true } : [];
    return { ok: true, status: 200, json: () => Promise.resolve(body) };
  }));
  const draft = (id, title, extra = {}) => ({ entry_id: id, status: 'draft', title, version: 1, hulls: [], zones: [],
    hull_evidence: [], suggested_entry: null, merge_into: null, uploaded_by: 'A100001', files: [], ...extra });
  const onChanged = vi.fn();
  render(<BatchCard batch={{ ...base, state: 'processed', entries: [
    draft('E000011', 'closed chock'), draft('E000012', 'manifold support'), draft('E000013', ''),
  ] }} me="A100001" isAdmin={false} onChanged={onChanged} onClaim={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: '이 묶음 모두 확정' }));
  const dlg = await screen.findByRole('alertdialog');
  expect(dlg).toHaveTextContent('초안 2건을 확정할까요?');
  expect(dlg).toHaveTextContent('E000013(제목 없음)');
  await userEvent.click(within(dlg).getByRole('button', { name: '2건 확정' }));
  expect(await screen.findByText(/2건을 확정했습니다/)).toBeInTheDocument();
  expect(posted).toEqual(['/api/entries/E000011/confirm', '/api/entries/E000012/confirm']);
  expect(onChanged).toHaveBeenCalled();
});

test('52 — 초안이 하나면 묶음 확정 단추가 없다', () => {
  draw({ ...base, state: 'processed', entries: [{ entry_id: 'E1', status: 'draft', title: 't', version: 1, hulls: [], zones: [],
    hull_evidence: [], suggested_entry: null, merge_into: null, uploaded_by: 'A100001', files: [] }] });
  expect(screen.queryByRole('button', { name: '이 묶음 모두 확정' })).toBeNull();
});
