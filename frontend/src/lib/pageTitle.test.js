import { APP_NAME, pageTitle } from './pageTitle.js';

test('화면마다 탭 제목이 다르다', () => {
  expect(pageTitle('/')).toBe(`검색 - ${APP_NAME}`);
  expect(pageTitle('/inbox')).toBe(`올리기와 확정 - ${APP_NAME}`);
  expect(pageTitle('/h/3515')).toBe(`3515 호선 - ${APP_NAME}`);
  expect(pageTitle('/e/E000019')).toBe(`E000019 - ${APP_NAME}`);
  expect(pageTitle('/e/E000019', '3515 sidepassage')).toBe(`3515 sidepassage - ${APP_NAME}`);
  expect(pageTitle('/admin/users')).toBe(`관리 - ${APP_NAME}`);
  expect(pageTitle('/graph/')).toBe(`관계 지도 - ${APP_NAME}`);
  expect(pageTitle('/없는화면')).toBe(APP_NAME);
});
