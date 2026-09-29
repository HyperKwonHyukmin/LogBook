import { ACTION_LABELS, errorText, formatDateTime } from './labels.js';

test('업로드·정리 API 오류 코드를 한국어로 보여 준다', () => {
  const codes = ['incomplete', 'invalid_path', 'chunk_too_large', 'not_uploading', 'upload_not_found',
    'no_files', 'duplicate_path', 'merge_into_id_only_for_draft', 'drm_encrypted'];
  for (const code of codes) {
    expect(errorText({ detail: code }, 'FALLBACK')).not.toBe('FALLBACK');
    expect(errorText({ detail: { code } }, 'FALLBACK')).not.toBe('FALLBACK');
  }
  expect(errorText({ detail: 'unknown_code' }, 'FALLBACK')).toBe('FALLBACK');
});

test('03 오류·동작 라벨과 날짜 표시', () => {
  expect(errorText({ detail: 'link_invalid' })).toMatch('링크');
  expect(errorText({ detail: 'hull_not_found' })).toMatch('호선');
  expect(ACTION_LABELS.TAG_ALIAS).toBe('동의어 묶기');
  expect(formatDateTime('2026-09-29T12:33:05')).toBe('2026-09-29 12:33');
  expect(formatDateTime(null)).toBe('—');
});
