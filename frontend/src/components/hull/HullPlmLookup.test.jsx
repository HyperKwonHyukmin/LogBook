import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi } from '../../test/mockApi.js';
import HullPlmLookup, { HullPlmSummary } from './HullPlmLookup.jsx';

const FOUND = { hull_no: '3370', ship_type: '174K LNG',
  plm: { status: 'found', ship_type_raw: '174K-LNG', main_engine: 'G70ME-C10.5-GA-EGRBP', ship_class: 'BV',
         delivery_date: '2025-02-28', delivered: true, checked_at: null } };

test('입력한 호선마다 PLM 선박 정보를 보여 준다(없는 호선은 오류 문구)', async () => {
  mockApi({ 'GET /api/hulls/3370/plm': FOUND, 'GET /api/hulls/9999/plm': { __status: 404, detail: 'ship_not_found' } });
  render(<HullPlmLookup hulls={['3370', '9999']} />);
  await userEvent.click(screen.getByRole('button', { name: '선박 정보 검색' }));
  const list = await screen.findByRole('list', { name: 'PLM 선박 정보' });
  const [found, missing] = within(list).getAllByRole('listitem');
  expect(found).toHaveTextContent('3370');
  expect(found).toHaveTextContent('174K LNG');
  expect(found).toHaveTextContent('G70ME-C10.5-GA-EGRBP');
  expect(found).toHaveTextContent('2025-02-28');
  expect(missing).toHaveTextContent('PLM 에 없는 호선 번호입니다.');
});

test('호선이 없으면 단추를 누를 수 없다', () => {
  render(<HullPlmLookup hulls={[]} />);
  expect(screen.getByRole('button', { name: '선박 정보 검색' })).toBeDisabled();
});

test('속성 칸 — 저장된 PLM 정보를 호선마다(조회 안 한 호선은 줄 없음)', () => {
  render(<HullPlmSummary hulls={[FOUND, { hull_no: '9999', ship_type: null, plm: { status: 'not_found' } },
    { hull_no: '1234', ship_type: null, plm: null }]} />);
  const items = within(screen.getByRole('list', { name: 'PLM 선박 정보' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('174K LNG');
  expect(items[0]).toHaveTextContent('BV');
  expect(items[1]).toHaveTextContent('9999PLM 에 없음');
});

test('속성 칸 — 조회한 호선이 없으면 아무것도 그리지 않는다', () => {
  const { container } = render(<HullPlmSummary hulls={[{ hull_no: '1234', plm: null }]} />);
  expect(container).toBeEmptyDOMElement();
});
