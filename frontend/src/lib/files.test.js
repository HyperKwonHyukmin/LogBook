import { vi } from 'vitest';
import { mockApi } from '../test/mockApi.js';
import { copyText, fileLink, uncPath } from './files.js';

test('UNC 경로를 만든다', () => {
  expect(uncPath('\\\\srv\\999_LogBook\\10_Vault\\2026\\E000001', 'a/b c.pdf'))
    .toBe('\\\\srv\\999_LogBook\\10_Vault\\2026\\E000001\\files\\a\\b c.pdf');
  expect(uncPath(null, 'a.pdf')).toBe('');
});

test('내려받기 링크를 받는다', async () => {
  mockApi({ 'POST /api/files/7/link?inline=true': { url: '/api/files/7/content?t=x&inline=1' } });
  expect(await fileLink(7, { inline: true })).toBe('/api/files/7/content?t=x&inline=1');
});

test('clipboard 가 없으면 execCommand 로 복사한다', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
  document.execCommand = vi.fn(() => true);
  expect(await copyText('\\\\srv\\a')).toBe(true);
  expect(document.execCommand).toHaveBeenCalledWith('copy');
});
