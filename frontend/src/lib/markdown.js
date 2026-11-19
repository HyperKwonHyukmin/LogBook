import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * 64 — 나의 메모의 마크다운 → 안전한 HTML. GFM(표, 체크 목록, 취소선)과 줄바꿈 한 번 = 줄바꿈(breaks).
 * marked 는 HTML 을 그대로 통과시키므로 DOMPurify 로 거른다(스크립트, on* 속성, javascript: 주소 제거).
 * 링크는 새 탭(rel=noopener)으로 연다 — 메모 화면을 벗어나지 않게.
 */
const parser = marked.use({ gfm: true, breaks: true });

let hooked = false;
function hookLinks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function renderMarkdown(text) {
  if (!text) return '';
  hookLinks();
  const html = parser.parse(String(text), { async: false });
  // 체크 목록(- [ ])은 <input type=checkbox disabled> 로 나오므로 input 은 남긴다.
  // file: 은 공유 폴더 경로 링크(file://storage...)를 적을 수 있게 허용한다.
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
