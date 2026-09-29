import { errorText } from './labels.js';

test('업로드·정리 API 오류 코드를 한국어로 보여 준다', () => {
  const codes = ['incomplete', 'invalid_path', 'chunk_too_large', 'not_uploading', 'upload_not_found',
    'no_files', 'duplicate_path', 'merge_into_id_only_for_draft', 'drm_encrypted'];
  for (const code of codes) {
    expect(errorText({ detail: code }, 'FALLBACK')).not.toBe('FALLBACK');
    expect(errorText({ detail: { code } }, 'FALLBACK')).not.toBe('FALLBACK');
  }
  expect(errorText({ detail: 'unknown_code' }, 'FALLBACK')).toBe('FALLBACK');
});
