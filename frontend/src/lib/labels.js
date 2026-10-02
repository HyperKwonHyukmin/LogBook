/** 화면 라벨 모음 — 같은 코드 값을 여러 화면이 같은 말로 보이게 한 곳에 둔다. */
export const ACTION_LABELS = {
  USER_REGISTER: '가입 신청', USER_APPROVE: '가입 승인', USER_REJECT: '가입 거절',
  USER_DISABLE: '계정 비활성화', USER_ENABLE: '계정 재활성화',
  USER_ADMIN_GRANT: '관리자 지정', USER_ADMIN_REVOKE: '관리자 해제', ADMIN_BOOTSTRAP: '관리자 초기 설정',
  BATCH_RECEIVED: '자료 받음', BATCH_CLAIM: '배치 가져감',
  ENTRY_UPDATE: '정보 수정', ENTRY_CONFIRM: '확정', ENTRY_FILES_ADDED: '파일 추가',
  ENTRY_TRASH: '휴지통으로', ENTRY_RESTORE: '복원', DRAFT_DISCARD: '초안 버림',
  TAG_ALIAS: '동의어 묶기', TAG_UNALIAS: '동의어 풀기', HULL_UPDATE: '호선 정보 수정',
};

export const KIND_LABELS = { model: 'BDF', result: '결과', report: '보고서', drawing: '도면', other: '기타' };

export const BATCH_STATE_LABELS = {
  staged: '분석 중', processed: '정리 대기', failed: '처리 실패', done: '완료', uploading: '올리는 중',
};

export const EXCLUDE_REASON_LABELS = {
  drm: 'DRM 암호화. 탐색기로 00_Inbox 에 복사해 주세요',
  path_too_long: '경로가 너무 김',
};

export const ERROR_LABELS = {
  version_conflict: '다른 사람이 먼저 고쳤습니다. 최신 내용으로 다시 불러왔습니다.',
  not_uploader: '올린 사람만 할 수 있습니다.',
  storage_unreachable: '999_LogBook 공유 폴더에 연결할 수 없습니다.',
  storage_error_partial: '파일 이동 중 문제가 생겼습니다. 관리자에게 알려 주세요.',
  title_required: '제목을 입력해 주세요.',
  invalid_period: '해석 시기는 YYYY-MM 형식입니다.',
  target_not_confirmed: '합칠 대상 Entry 가 확정 상태가 아닙니다.',
  already_claimed: '이미 다른 사람이 가져갔습니다.',
  entry_trashed: '휴지통에 있는 자료입니다.',
  incomplete: '일부 파일이 끝까지 올라가지 않았습니다. 다시 올려 주세요.',
  invalid_path: '파일 경로에 쓸 수 없는 이름이 있습니다.',
  chunk_too_large: '한 번에 보낸 조각이 너무 큽니다.',
  not_uploading: '이미 끝났거나 취소된 올리기입니다.',
  upload_not_found: '올리기 기록을 찾을 수 없습니다. 처음부터 다시 올려 주세요.',
  no_files: '올릴 파일이 없습니다.',
  duplicate_path: '같은 경로의 파일이 두 번 들어 있습니다.',
  merge_into_id_only_for_draft: '기존 자료에 추가하기는 미확정 초안에서만 할 수 있습니다.',
  drm_encrypted: 'DRM 암호화 파일이라 올릴 수 없습니다. 탐색기로 00_Inbox 에 복사해 주세요.',
  link_invalid: '내려받기 링크가 만료됐습니다. 다시 눌러 주세요.',
  file_not_found: '파일을 찾을 수 없습니다.',
  file_missing: '공유 폴더에서 파일을 찾을 수 없습니다.',
  not_sheet: '엑셀 파일이 아닙니다.',
  too_large: '파일이 너무 커서 미리 볼 수 없습니다. 내려받아 열어 주세요.',
  unreadable: '파일을 열 수 없습니다(손상 또는 지원하지 않는 형식).',
  kind_mismatch: '같은 종류의 태그끼리만 묶을 수 있습니다.',
  same_tag: '자기 자신이나 자기 동의어에는 묶을 수 없습니다.',
  hull_not_found: '등록된 호선이 아닙니다.',
  invalid_hull: '호선은 숫자 4자리입니다.',
  entry_not_found: '자료를 찾을 수 없습니다.',
  model_not_ready: '아직 3D 변환이 끝나지 않았습니다.',
  model_missing: '3D 변환 결과를 찾을 수 없습니다. 관리자에게 재변환을 요청해 주세요.',
};

export function errorText(err, fallback = '요청을 처리하지 못했습니다.') {
  const code = typeof err?.detail === 'string' ? err.detail : err?.detail?.code;
  return ERROR_LABELS[code] || fallback;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const FACET_LABELS = { hull: '호선', ship_type: '선종', analysis_type: '해석 종류', zone: '구역',
  year: '연도', uploaded_by: '올린 사람', kind: '파일 종류' };

export const EXTRACT_LABELS = {
  queued: '본문 추출 대기 중', failed: '본문을 읽지 못했습니다',
  drm: 'DRM 암호화 파일이라 본문을 읽지 못했습니다', too_large: '파일이 커서 본문을 색인하지 않았습니다',
  trashed: '휴지통에 있는 자료입니다. 복원 후 볼 수 있습니다.',
};

/** BDF 3D 변환 상태(설계 §7.7). skipped 는 error 코드로 고른다. */
export const MODEL_STATE_LABELS = {
  queued: '3D 변환 대기 중',
  include: '같은 자료의 다른 BDF 가 INCLUDE 하는 파일입니다. 그 BDF 를 열어 보세요.',
  drm: 'DRM 암호화 파일이라 3D 로 바꾸지 못했습니다. 내려받아 열어 주세요.',
  too_large: '1GB 를 넘는 모델은 3D 변환을 하지 않습니다.',
  no_elements: '요소가 없는 BDF(재료·하중 등)라 3D 로 볼 것이 없습니다.',
  trashed: '휴지통에 있는 자료라 3D 변환을 하지 않았습니다.',
  failed_admin: '3D 로 바꾸지 못했습니다. 관리자에게 알려 주세요.',
  stale_queued: '다시 변환 대기 중 · 이전 결과를 보여 줍니다',
  stale_failed: '다시 변환하지 못했습니다 · 이전 결과를 보여 줍니다',
  slow: '변환이 오래 걸리고 있습니다.',
};

export const MATCH_LABELS = { entry_id: 'Entry 번호', hull: '호선', title: '제목', tag: '태그',
  analysis_type: '해석 종류', description: '설명', file: '파일명', body: '본문' };

/** ISO 시각 → 'YYYY-MM-DD HH:MM'. 없으면 '—'. */
export function formatDateTime(iso) {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}
