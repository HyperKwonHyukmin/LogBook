import { ACTION_LABELS, JOB_STATE_LABELS, JOB_TYPE_LABELS, errorText, formatDateTime } from './labels.js';

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

test('05 운영 동작·오류·작업 라벨', () => {
  expect(ACTION_LABELS.TRASH_PURGE).toBe('영구 삭제');
  expect(ACTION_LABELS.JOB_RETRY).toBe('작업 다시 시도');
  expect(ACTION_LABELS.OPS_REEXTRACT).toBe('본문 다시 추출');
  expect(ACTION_LABELS.OPS_RECONVERT).toBe('BDF 다시 변환');
  expect(ACTION_LABELS.OPS_BACKUP).toBe('수동 백업');
  for (const code of ['not_failed', 'not_trashed', 'backup_failed', 'admin_required']) {
    expect(errorText({ detail: code }, 'FALLBACK')).not.toBe('FALLBACK');
  }
  expect(errorText({ detail: { code: 'backup_failed', message: 'x' } })).toMatch('백업');
  expect(JOB_TYPE_LABELS).toEqual({ extract_file: '보고서 본문 추출', convert_model: 'BDF 변환',
    process_batch: '배치 처리', write_meta: '메타 파일 쓰기' });
  expect(JOB_STATE_LABELS).toEqual({ queued: '대기', running: '실행 중', done: '완료', failed: '실패' });
});
