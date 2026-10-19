import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi } from '../../test/mockApi.js';
import HullPlmLookup from './HullPlmLookup.jsx';

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
