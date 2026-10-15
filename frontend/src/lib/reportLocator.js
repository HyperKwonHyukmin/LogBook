/** 보고서 추출 위치를 파일 포맷 내부 경로 대신 읽을 수 있는 위치로 표시한다. */
export function reportLocatorLabel(locator = '') {
  const value = String(locator);
  let match = /^page:(\d+)(?::ocr)?(?::part:\d+)?$/.exec(value);
  if (match) return `${match[1]}쪽${value.includes(':ocr') ? ' · 이미지 본문' : ''}`;
  match = /^(?:slide|notes):(\d+)(?::notes)?(?::part:\d+)?$/.exec(value);
  if (match) return `슬라이드 ${match[1]}${value.startsWith('notes:') || value.includes(':notes') ? ' · 발표자 노트' : ''}`;
  match = /^sheet:(.*):row:(\d+)(?::part:\d+)?$/.exec(value);
  if (match) return `시트 ${match[1]} · ${match[2]}행`;
  if (value.startsWith('sheet:')) return `시트 ${value.slice(6)}`;
  match = /^(?:(header\d*|footer\d*|footnotes|endnotes|comments):)?paragraph:(\d+)(?::part:\d+)?$/.exec(value);
  if (match) {
    const part = match[1] || '';
    const name = part.startsWith('header') ? '머리말' : part.startsWith('footer') ? '꼬리말' : part === 'footnotes' ? '각주' : part === 'endnotes' ? '미주' : part === 'comments' ? '주석' : '본문';
    return `${name} · ${match[2]}번째 문단`;
  }
  match = /^word\/(.*)\.xml:paragraph:(\d+)(?::part:\d+)?$/.exec(value);
  if (match) {
    const part = match[1];
    const name = part.startsWith('header') ? '머리말' : part.startsWith('footer') ? '꼬리말' : part.startsWith('footnote') ? '각주' : part.startsWith('endnote') ? '미주' : part.startsWith('comment') ? '주석' : '본문';
    return `${name} · ${match[2]}번째 문단`;
  }
  if (value.startsWith('image:')) return '첨부 이미지의 글자';
  if (value.startsWith('xl/comments')) return '시트 주석';
  return '본문';
}
