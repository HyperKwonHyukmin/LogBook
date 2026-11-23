import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi } from '../test/mockApi.js';
import PersonPage from './PersonPage.jsx';

const row = (id, title, roles, extra = {}) => ({ entry_id: id, title, roles, zones: ['선수부'], target: null, hulls: ['9999'],
  kinds: ['report'], confirmed_at: '2026-09-02T00:00:00', favorite: false, ...extra });

const RETIRED = {
  person: { id: 7, employee_id: null, name: '김퇴사', department: '구조시스템연구실', position: '책임', employed: false, source: 'manual' },
  in_roster: true, basis: 'assigned',
  counts: { assigned: 7, primary: 7, authored: 0, same_sets: false },
  traits: { zones: [{ value: '선수부', count: 7 }], targets: [], ship_kinds: [{ value: 'LNG', count: 3 }],
            ship_sizes: [], sols: [], programs: [], lifting: 0 },
  coworkers: [],
  knowledge: { conclusions: 6, caveats: 1, reviewed: 0, resolved_issues: 0 },
  handover: Array.from({ length: 6 }, (_, i) => ({ ...row(`E00000${i + 1}`, `검토 ${i + 1}`, ['primary']), conclusion: `결론 ${i + 1}`,
    caveats: i === 0 ? '하중 조합 3 은 빼고 볼 것' : null })),
  timeline: [{ month: '2026-09', entries: [row('E000001', '검토 1', ['primary'])] }],
};

const MIXED = {
  person: { id: 1, employee_id: 'A476854', name: '권작성', department: null, position: null, employed: true, source: 'wb' },
  in_roster: true, basis: 'assigned',
  counts: { assigned: 1, primary: 1, authored: 2, same_sets: false },
  traits: { zones: [], targets: [], ship_kinds: [], ship_sizes: [], sols: [], programs: [], lifting: 0 },
  coworkers: [{ id: 3, name: '나공동', employed: true, count: 1 }],
  knowledge: { conclusions: 0, caveats: 0, reviewed: 1, resolved_issues: 0 },
  handover: [],
  timeline: [{ month: '2026-07', entries: [row('E000003', '권 담당', ['author', 'primary']), row('E000004', '권 작성만', ['author'])] }],
};

function renderAt(url, map) {
  mockApi(map);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/p/:personKey" element={<PersonPage />} /></Routes>
    </MemoryRouter>,
  );
}

test('퇴사자 카드 — 남긴 결론과 주의점이 맨 위, 특성 분포, 순위 없음', async () => {
  renderAt('/p/7', { 'GET /api/people/7/profile': RETIRED });
  expect(await screen.findByRole('heading', { name: '김퇴사' })).toBeInTheDocument();
  expect(screen.getByText('퇴사')).toBeInTheDocument();   // 이름 옆 상태 칩
  const handover = screen.getByRole('region', { name: '남긴 결론과 주의점' });
  const list = screen.getByRole('region', { name: '자료 목록' });
  // 퇴사자 카드는 인수인계 묶음이 자료 목록보다 위
  expect(handover.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(handover).getByText('하중 조합 3 은 빼고 볼 것')).toBeInTheDocument();
  expect(within(handover).queryByText('결론 6')).toBeNull();   // 처음엔 5건만
  await userEvent.click(within(handover).getByRole('button', { name: '1건 더 보기' }));
  expect(within(handover).getByText('결론 6')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /선수부/ })).toHaveAttribute('href', '/?assignee=7&zone=%EC%84%A0%EC%88%98%EB%B6%80');
  expect(screen.getByRole('region', { name: '선종' })).toHaveTextContent('LNG');
  expect(screen.queryByRole('region', { name: '대상' })).toBeNull();          // 값이 없으면 숨김
  expect(screen.queryByRole('region', { name: '함께 일한 사람' })).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();                         // 작성한 자료가 없으면 탭 없음
  expect(screen.getByRole('link', { name: '담당 자료 검색' })).toHaveAttribute('href', '/?assignee=7');
  expect(screen.queryByText(/순위|등수/)).toBeNull();
});

test('담당과 작성이 다르면 탭으로 나눠 본다', async () => {
  renderAt('/p/A476854', { 'GET /api/people/by-employee/A476854/profile': MIXED });
  expect(await screen.findByRole('heading', { name: '권작성' })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: '자료 묶음' });
  expect(within(list).getByRole('link', { name: '권 담당' })).toBeInTheDocument();
  expect(within(list).queryByRole('link', { name: '권 작성만' })).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: /작성한 자료/ }));
  expect(within(list).getByRole('link', { name: '권 작성만' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '나공동' })).toHaveAttribute('href', '/p/3');
});

test('명부에 없는 작성자는 작성한 자료만 보인다는 안내', async () => {
  renderAt('/p/A670002', { 'GET /api/people/by-employee/A670002/profile': {
    ...MIXED, person: { ...MIXED.person, id: null, employee_id: 'A670002', name: '남작성', source: 'user' },
    in_roster: false, basis: 'authored', counts: { assigned: 0, primary: 0, authored: 1, same_sets: false }, coworkers: [],
    timeline: [{ month: '2026-09', entries: [row('E000005', '남 작성', ['author'])] }] } });
  expect(await screen.findByText(/명부에 없는 사람이라 작성한 자료만/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '작성 자료 검색' })).toHaveAttribute('href', '/?uploaded_by=A670002');
  expect(screen.getByRole('link', { name: '남 작성' })).toBeInTheDocument();
});

test('없는 사람', async () => {
  renderAt('/p/999', { 'GET /api/people/999/profile': { __status: 404, detail: 'person_not_found' } });
  expect(await screen.findByText('담당자를 찾지 못했습니다')).toBeInTheDocument();
});

const MANY = {
  ...RETIRED,
  person: { ...RETIRED.person, employed: true },
  counts: { assigned: 3, primary: 3, authored: 0, same_sets: false },
  traits: { ...RETIRED.traits, targets: [{ value: 'Manifold', count: 2 }, { value: 'PSD', count: 1 }] },
  handover: [],
  timeline: [
    { month: '2026-11', entries: [row('E000011', '매니폴드 1', ['primary'], { target: 'Manifold', hulls: ['3012'] }),
                                  row('E000012', 'PSD 1', ['primary'], { target: 'PSD', hulls: ['3020'] })] },
    { month: '2026-10', entries: [row('E000013', '매니폴드 2', ['primary'], { target: 'Manifold', hulls: ['3020'] })] },
  ],
};

test('명함 머리말 — 이니셜, 수치 한 줄, 자료로 본 주력 칩', async () => {
  renderAt('/p/7', { 'GET /api/people/7/profile': MANY });
  expect(await screen.findByRole('heading', { name: '김퇴사' })).toBeInTheDocument();
  expect(screen.getByText('다룬 호선')).toBeInTheDocument();          // 3012, 3020 → 2척
  const focus = screen.getByRole('group', { name: '자료로 본 주력' });
  expect(within(focus).getByRole('link', { name: /Manifold/ })).toHaveAttribute('href', '/?assignee=7&target=Manifold');
  expect(within(focus).getByText('LNG')).toBeInTheDocument();          // 선종은 링크 없이
  // 모든 행이 주 담당이면 행마다 쓰지 않는다
  expect(screen.queryByText('주 담당')).toBeNull();
});

test('기본은 대상별, 호선별과 월별로 바꿔 묶는다', async () => {
  renderAt('/p/7', { 'GET /api/people/7/profile': MANY });
  const list = await screen.findByRole('list', { name: '자료 묶음' });
  const heads = () => within(list).getAllByRole('heading').map((h) => h.textContent);
  expect(heads()).toEqual(['Manifold2', 'PSD1']);                     // 건수 많은 순
  expect(screen.queryByText(/확정한 달입니다/)).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: '호선별' }));
  expect(heads()).toEqual(['30202', '30121']);
  expect(within(list).getByRole('link', { name: '3020' })).toHaveAttribute('href', '/h/3020');
  await userEvent.click(screen.getByRole('radio', { name: '월별' }));
  expect(heads()).toEqual(['2026년 11월2', '2026년 10월1']);
  expect(screen.getByText(/확정한 달입니다/)).toBeInTheDocument();
});

test('퇴사자인데 남긴 결론이 없으면 채우는 법을 안내한다', async () => {
  renderAt('/p/7', { 'GET /api/people/7/profile': { ...RETIRED, handover: [] } });
  const sec = await screen.findByRole('region', { name: '남긴 결론과 주의점' });
  expect(sec).toHaveTextContent('결론 한 줄과 주의점을 남기면');
});
