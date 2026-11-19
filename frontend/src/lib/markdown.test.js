import { renderMarkdown } from './markdown.js';

test('마크다운 기본 문법과 GFM(표, 체크 목록), 한 줄 바꿈도 줄바꿈', () => {
  const html = renderMarkdown('## 경계조건\n**SPC** 123456\n둘째 줄\n\n- [x] 갑판\n- [ ] 선저\n\n| 하중 | 값 |\n|---|---|\n| 권상 | 90 t |');
  expect(html).toContain('<h2>경계조건</h2>');
  expect(html).toContain('<strong>SPC</strong> 123456<br>둘째 줄');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('<table>');
});

test('위험한 내용은 지우고 링크는 새 탭', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[나쁜](javascript:alert(3))\n\n[좋은](https://a.b/c)');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://a.b/c"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(renderMarkdown('')).toBe('');
});
