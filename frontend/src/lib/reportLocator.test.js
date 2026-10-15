import { reportLocatorLabel } from './reportLocator.js';

test.each([
  ['page:12:ocr:part:2', '12쪽 · 이미지 본문'],
  ['slide:4:notes', '슬라이드 4 · 발표자 노트'],
  ['sheet:강도:row:5010:part:2', '시트 강도 · 5010행'],
  ['word/document.xml:paragraph:14', '본문 · 14번째 문단'],
  ['word/header1.xml:paragraph:2', '머리말 · 2번째 문단'],
  ['word/footnotes.xml:paragraph:3', '각주 · 3번째 문단'],
  ['paragraph:14:part:2', '본문 · 14번째 문단'],
  ['header1:paragraph:2', '머리말 · 2번째 문단'],
  ['footer2:paragraph:3', '꼬리말 · 3번째 문단'],
  ['footnotes:paragraph:4:part:3', '각주 · 4번째 문단'],
  ['endnotes:paragraph:5', '미주 · 5번째 문단'],
  ['comments:paragraph:6', '주석 · 6번째 문단'],
  ['image:word/media/image1.png', '첨부 이미지의 글자'],
  ['xl/comments/comment1.xml', '시트 주석'],
  ['unexpected/internal/path', '본문'],
])('위치 %s를 읽기 쉽게 표시한다', (source, label) => expect(reportLocatorLabel(source)).toBe(label));
