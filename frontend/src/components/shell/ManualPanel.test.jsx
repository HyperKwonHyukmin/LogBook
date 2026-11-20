import { applyWebLayout, WEB_LAYOUT_CSS } from './ManualPanel.jsx';

// 2026-11-20 — 패널 안 설명서는 폭과 상관없이 웹판(A4 쪽 틀을 푼 배치)으로 본다
test('설명서 문서에 웹판 배치를 한 번만 넣는다', () => {
  const doc = document.implementation.createHTMLDocument('manual');
  expect(applyWebLayout(doc)).toBe(true);
  expect(applyWebLayout(doc)).toBe(false);
  const styles = doc.head.querySelectorAll('style');
  expect(styles).toHaveLength(1);
  expect(styles[0].textContent).toBe(WEB_LAYOUT_CSS);
  expect(WEB_LAYOUT_CSS).toMatch(/\.page\.cover\{display:none/);   // 표지는 빼고
  expect(WEB_LAYOUT_CSS).toMatch(/\.page footer\{display:none/);   // 쪽 번호도 뺀다
  expect(applyWebLayout(null)).toBe(false);
});
