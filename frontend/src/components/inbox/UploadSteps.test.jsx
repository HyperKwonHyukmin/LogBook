import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UploadSteps, { stepState } from './UploadSteps.jsx';
import { UploadCenterCard } from './UploadZone.jsx';
import { mockApi } from '../../test/mockApi.js';

const up = (o = {}) => ({ busy: false, resumable: false, result: { key: 'K1', uploaded: 3 }, autoConfirm: false, attaching: false, ...o });

test('66 — 단계 계산: 올리는 중 1, 정리 중 2로 가는 중, 직접 확정이면 2(이동 단추), 바로 확정이 다 끝내면 3', () => {
  expect(stepState(up({ busy: true, result: null }), null)).toMatchObject({ current: 1, done: 0 });
  expect(stepState(up(), { state: 'staged' })).toMatchObject({ current: 2, done: 1, text: expect.stringMatching(/정리하는 중/) });
  const manual = stepState(up(), { state: 'processed', entries: [{}, {}] });
  expect(manual).toMatchObject({ current: 2, done: 1, go: true });
  expect(manual.text).toMatch(/지금 2단계.*초안 2건.*\[확정\].*3단계/);
  // 바로 확정 — 결과가 오기 전에는 아직 정리 중
  expect(stepState(up({ autoConfirm: true }), { state: 'processed', auto_confirm: true })).toMatchObject({ current: 2, done: 1 });
  expect(stepState(up({ autoConfirm: true }), { state: 'done', auto_confirm: true, auto_result: { confirmed: ['E1', 'E2'], kept: [] } }))
    .toMatchObject({ current: 3, done: 3, text: expect.stringMatching(/자료 2건/) });
  expect(stepState(up({ autoConfirm: true }), { state: 'processed', auto_confirm: true, auto_result: { confirmed: ['E1'], kept: [{ entry_id: 'E2' }] } }))
    .toMatchObject({ current: 2, go: true, text: expect.stringMatching(/1건은 확정.*초안 1건/) });
});

test('절차도는 끝난 단계에 체크, 지금 단계를 읽기 글자로 알린다(색만으로 말하지 않는다)', () => {
  render(<UploadSteps current={2} done={1} />);
  const steps = within(screen.getByRole('list', { name: '올리기 절차' })).getAllByRole('listitem');
  expect(steps[0]).toHaveTextContent('올리기(끝남)');
  expect(steps[1]).toHaveTextContent('분류 확인(지금)');
  expect(steps[1].querySelector('[aria-current="step"]')).not.toBeNull();
  expect(steps[2]).toHaveTextContent('3확정');
});

test('가운데 카드: 올리기가 끝나면 묶음을 따라가 2단계 안내와 [올리기와 확정으로 가기]를 보인다', async () => {
  mockApi({ 'GET /api/batches/K1': { key: 'K1', state: 'processed', entries: [{ entry_id: 'E9' }] } });
  render(<MemoryRouter initialEntries={['/']}><UploadCenterCard u={{ ...up(), phase: 'done', dismiss: () => {} }} /></MemoryRouter>);
  const box = screen.getByTestId('upload-steps');
  expect(await within(box).findByText(/지금 2단계/)).toBeInTheDocument();
  expect(within(box).getByRole('button', { name: '올리기와 확정으로 가기' })).toBeInTheDocument();
});

test('기존 자료에 파일 추가에는 절차도가 없다', () => {
  mockApi({});
  render(<MemoryRouter><UploadCenterCard u={{ ...up({ attaching: true }), phase: 'done', dismiss: () => {} }} /></MemoryRouter>);
  expect(screen.queryByTestId('upload-steps')).toBeNull();
});
