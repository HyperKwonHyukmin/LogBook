import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { invalidateVocab } from '../../lib/vocab.js';
import { calls, mockApi } from '../../test/mockApi.js';
import VocabInput from './VocabInput.jsx';

const ATYPE = { kind: 'atype', other: '기타', terms: [
  { id: 1, value: '강도 평가', active: true, count: 3, synonyms: [] },
  { id: 2, value: 'FE 해석', active: true, count: 1, synonyms: [{ id: 10, value: 'FEM 해석' }] },
  { id: 3, value: '기타', active: true, count: 0, synonyms: [] },
] };
const ZONE = { kind: 'zone', other: '기타', terms: [
  { id: 5, value: '선수부', active: true, count: 0, synonyms: [{ id: 9, value: 'FWD' }] },
  { id: 6, value: '선미부', active: true, count: 0, synonyms: [] },
] };

function renderAs(ui, { admin = false } = {}) {
  return render(<AuthContext.Provider value={{ user: { employee_id: 'A1', is_admin: admin } }}>{ui}</AuthContext.Provider>);
}

beforeEach(() => invalidateVocab());

test('동의어를 치면 대표 용어가 후보로 뜨고 Enter 로 고른다', async () => {
  mockApi({ 'GET /api/vocab?kind=atype': ATYPE });
  const onChange = vi.fn();
  renderAs(<VocabInput kind="atype" label="해석 종류" value={null} onChange={onChange} />);
  const box = screen.getByRole('combobox', { name: '해석 종류' });
  await userEvent.click(box);
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
  await userEvent.type(box, 'fem');
  expect(screen.getByRole('option', { name: /FE 해석/ })).toHaveTextContent('FEM 해석 의 대표 용어');
  await userEvent.keyboard('{Enter}');
  expect(onChange).toHaveBeenCalledWith('FE 해석');
});

test('목록에 없으면 일반 사용자에게는 기타만 보인다', async () => {
  mockApi({ 'GET /api/vocab?kind=atype': ATYPE });
  const onChange = vi.fn();
  renderAs(<VocabInput kind="atype" label="해석 종류" value="강도 평가" onChange={onChange} />);
  const box = screen.getByRole('combobox', { name: '해석 종류' });
  await userEvent.click(box);
  await userEvent.type(box, '충돌 해석');
  expect(screen.getByText('목록에 없는 값입니다. 아래에서 고르세요.')).toBeInTheDocument();
  expect(screen.queryByText(/목록에 추가/)).toBeNull();
  await userEvent.click(screen.getByRole('option', { name: '기타' }));
  expect(onChange).toHaveBeenCalledWith('기타');
});

test('관리자는 목록에 없는 값을 그 자리에서 용어로 추가한다', async () => {
  const fetch = mockApi({
    'GET /api/vocab?kind=atype': ATYPE,
    'POST /api/vocab/terms': { id: 7, kind: 'atype', value: '충돌 해석', active: true },
  });
  const onChange = vi.fn();
  renderAs(<VocabInput kind="atype" label="해석 종류" value={null} onChange={onChange} />, { admin: true });
  const box = screen.getByRole('combobox', { name: '해석 종류' });
  await userEvent.click(box);
  await userEvent.type(box, '충돌 해석');
  await userEvent.click(screen.getByRole('option', { name: /‘충돌 해석’ 목록에 추가/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('충돌 해석'));
  const post = fetch.mock.calls.find(([u, i]) => u === '/api/vocab/terms' && i.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({ kind: 'atype', value: '충돌 해석' });
  expect(calls(fetch).filter((c) => c === 'GET /api/vocab?kind=atype').length).toBe(2); // 목록 다시 받기
});

test('구역 칩 — 고른 값은 후보에서 빠지고, 저장된 목록 밖 값도 보인다', async () => {
  mockApi({ 'GET /api/vocab?kind=zone': ZONE });
  const onChange = vi.fn();
  renderAs(<VocabInput multiple kind="zone" label="구역" values={['선수부', 'Hold 3']} onChange={onChange} />);
  expect(screen.getByText('Hold 3')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Hold 3').closest('span[title]')).toHaveAttribute('title', expect.stringMatching('목록 밖')));
  const box = screen.getByRole('combobox', { name: '구역' });
  await userEvent.click(box);
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['선미부']);
  await userEvent.click(screen.getByRole('option', { name: '선미부' }));
  expect(onChange).toHaveBeenCalledWith(['선수부', 'Hold 3', '선미부']);
  await userEvent.click(screen.getByRole('button', { name: 'Hold 3 빼기' }));
  expect(onChange).toHaveBeenLastCalledWith(['선수부']);
});

test('compact — 값만 보이다가 눌러서 고치고, Esc 로 닫는다', async () => {
  mockApi({ 'GET /api/vocab?kind=atype': ATYPE });
  renderAs(<VocabInput compact kind="atype" label="해석 종류" value="FE 해석" onChange={() => {}} />);
  expect(screen.getByText('FE 해석')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '해석 종류 고치기' }));
  expect(screen.getByRole('combobox', { name: '해석 종류' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('관리자도 Enter 만으로는 용어를 만들지 않는다 — 목록에 추가는 직접 고른다', async () => {
  const fetch = mockApi({ 'GET /api/vocab?kind=atype': ATYPE });
  const onChange = vi.fn();
  renderAs(<VocabInput kind="atype" label="해석 종류" value={null} onChange={onChange} />, { admin: true });
  const box = screen.getByRole('combobox', { name: '해석 종류' });
  await userEvent.click(box);
  await userEvent.type(box, '오타해석{Enter}');
  expect(onChange).not.toHaveBeenCalled();
  expect(calls(fetch)).not.toContain('POST /api/vocab/terms');
  expect(screen.getByRole('alert')).toHaveTextContent('목록에 추가');
});
