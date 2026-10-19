/** 화면 라벨 모음 — 같은 코드 값을 여러 화면이 같은 말로 보이게 한 곳에 둔다. */
import { LEVEL_ERRORS } from './levels.js';

export const ACTION_LABELS = {
  USER_REGISTER: '가입 신청', USER_APPROVE: '가입 승인', USER_REJECT: '가입 거절',
  USER_DISABLE: '계정 비활성화', USER_ENABLE: '계정 재활성화',
  USER_ADMIN_GRANT: '관리자 지정', USER_ADMIN_REVOKE: '관리자 해제', ADMIN_BOOTSTRAP: '관리자 초기 설정',
  BATCH_RECEIVED: '자료 받음', BATCH_CLAIM: '배치 가져감',
  ENTRY_UPDATE: '정보 수정', ENTRY_CONFIRM: '확정', ENTRY_FILES_ADDED: '파일 추가',
  ENTRY_FILES_REMOVED: '파일 삭제', ENTRY_FILES_RESTORED: '파일 되돌리기',   // 37
  ENTRY_TRASH: '휴지통으로', ENTRY_RESTORE: '복원', DRAFT_DISCARD: '초안 버림',
  TAG_ALIAS: '동의어 묶기', TAG_UNALIAS: '동의어 풀기', HULL_UPDATE: '호선 정보 수정', HULL_PLM: '선박 정보(PLM) 반영',
  TRASH_PURGE: '영구 삭제', JOB_RETRY: '작업 다시 시도',
  OPS_REEXTRACT: '본문 다시 추출', OPS_RECONVERT: 'BDF 다시 변환', OPS_BACKUP: '수동 백업',
  SOLVE_CHECK: '해석 검증 요청', OPS_SOLVE_CHECK: '해석 검증 일괄',
  VOCAB_SEED: '분류 목록 기본값', VOCAB_TERM_ADD: '분류 용어 추가', VOCAB_TERM_UPDATE: '분류 용어 수정',
  VOCAB_REORDER: '분류 순서 변경', VOCAB_MERGE: '분류 값 합치기', VOCAB_SYNONYM_REMOVE: '분류 동의어 빼기',
  VOCAB_NORMALIZE: '분류 값 일괄 정리',
  // 13 — 등급·공개 범위
  USER_ROLE: '등급 변경', MASTER_TRANSFER: 'Master 이양',
  // 15 — WorkBench 사용자 첫 로그인·LogBook 등급
  USER_JOIN: '처음 들어옴(LV1)', USER_LEVEL: '등급 변경',
  ENTRY_ACCESS: '공개 범위 변경', ENTRY_GRANT: '열람 허락', ENTRY_REVOKE: '열람 허락 회수',
  // 14 — 판 정리
  ENTRY_REVISIONS: '판 정리',
  // 17 — 완전 동일 BDF
  UPLOAD_DUPLICATE_BLOCKED: '동일 BDF 올리지 않음', UPLOAD_DUPLICATE_FORCED: '동일 BDF 그래도 올림',
  // 18 — WorkBench 연동(GMU 권상이 BDF 를 가져감)
  WB_EXPORT: 'WorkBench 로 보냄',
  WB_RULE_SET: 'WorkBench 연결 규칙 변경', WB_RULE_SEED: 'WorkBench 연결 규칙 기본값',
  // 20 — 자료 정비(제목 형식)
  ENTRY_RETITLE: '제목 형식 정비', ENTRY_RETITLE_REVERT: '제목 정비 되돌림',
  // 21 — 프로젝트(29 에서 없앰 — 옛 이력 표시용)·문서(보고서 종류 파일) 정보. 23 — 메뉴 이름 '보고서' → '문서'
  ENTRY_PROJECT: '프로젝트 변경', REPORT_META: '문서 분류 변경', REPORT_LINKS: '문서 모델 연결 변경',
};

/** 20 — 확정에 필요한 분류 칸(BDF 자료). 서버 required_missing·409 required_fields 의 missing 과 같은 이름. */
// 'hull' = 호선·'호선 없음(공용)'이 모두 없음
export const REQUIRED_LABELS = { hull: '호선(또는 공용)', zone: '구역', analysis_type: '해석 종류' };
export const requiredText = (missing) => (missing || []).map((k) => REQUIRED_LABELS[k] || k).join(', ');

/** 워커 작업 종류·상태(관리자 운영 화면). */
export const JOB_TYPE_LABELS = {
  extract_file: '문서 본문 추출', convert_model: 'BDF 변환', process_batch: '배치 처리', write_meta: '메타 파일 쓰기',
  solve_check: '해석 검증', revision_diff: '판 비교',
};
export const JOB_STATE_LABELS = { queued: '대기', running: '실행 중', done: '완료', failed: '실패' };

// 23 — 파일 종류 report 의 화면 이름은 '문서'(PDF·PPT·DOC·XLS — 보고서·발표자료·계산서 등). 값 'report' 는 그대로
export const KIND_LABELS = { model: 'BDF', result: '결과', report: '문서', drawing: '도면', other: '기타' };

export const BATCH_STATE_LABELS = {
  staged: '분석 중', processed: '정리 대기', failed: '처리 실패', done: '완료', uploading: '올리는 중',
};

export const EXCLUDE_REASON_LABELS = {
  drm: 'DRM 암호화. 탐색기로 00_Inbox 에 복사해 주세요',
  path_too_long: '경로가 너무 김',
  // 17 — 완전 동일 BDF(같은 자료가 이미 있음)와 그 BDF 만 쓰던 INCLUDE 조각
  duplicate_model: '동일 BDF 가 이미 있음',
  duplicate_include: '올리지 않은 BDF 의 INCLUDE 파일',
};

export const ERROR_LABELS = {
  // 27 — 선례 찾기
  similar_base_not_found: '기준 BDF 를 찾지 못했습니다. 볼 수 없는 자료이거나 아직 변환되지 않았습니다.',
  bdf_too_large: 'BDF 가 32MB 를 넘어 이 화면에서 읽을 수 없습니다. 먼저 올려 확정한 뒤 자료 화면에서 찾아 주세요.',
  bdf_drm: '회사 DRM 으로 암호화된 파일이라 읽을 수 없습니다. 암호를 푼 파일을 넣어 주세요.',
  bdf_no_elements: '요소가 없는 BDF 입니다. INCLUDE 로 나뉜 모델이면 본 파일이 아니라 요소가 든 파일을 넣어 주세요.',
  bdf_model_error: 'BDF 를 모델로 읽지 못했습니다. 카드 형식을 확인해 주세요.',
  version_conflict: '다른 사람이 먼저 고쳤습니다. 최신 내용으로 다시 불러왔습니다.',
  not_uploader: '올린 사람만 할 수 있습니다.',
  storage_unreachable: '999_LogBook 공유 폴더에 연결할 수 없습니다.',
  storage_error_partial: '파일 이동 중 문제가 생겼습니다. 관리자에게 알려 주세요.',
  title_required: '제목을 입력해 주세요.',
  duplicate_model: '같은 BDF 가 이미 있어 확정하지 않았습니다.',
  target_not_confirmed: '합칠 대상 Entry 가 확정 상태가 아닙니다.',
  draft_attachments_pending: '추가 파일을 첨부 중입니다. 첨부가 끝난 뒤 다시 진행해 주세요.',
  attachment_target_changed: '자료 상태가 변경되었습니다. 정리 대기 목록을 다시 확인해 주세요.',
  attachment_target_not_draft: '이 자료는 이미 확정되었거나 정리 대기에서 제외되었습니다.',
  attachment_still_processing: '파일을 처리 중입니다. 잠시 뒤 상태를 다시 확인해 주세요.',
  already_claimed: '이미 다른 사람이 가져갔습니다.',
  entry_trashed: '휴지통에 있는 자료입니다.',
  // 37 — 파일 삭제·되돌리기
  last_file: '파일을 모두 뺄 수는 없습니다. 자료 전체를 지우려면 휴지통으로 보내 주세요.',
  file_not_in_vault: '공유 폴더에 없는 파일이라 뺄 수 없습니다.',
  entry_not_confirmed: '확정된 자료에서만 할 수 있습니다.',
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
  revisions_conflict: '다른 사람이 그 사이 판을 정리했습니다. 다시 열어 주세요.',
  revision_file_not_in_entry: '이 자료의 모델이 아닌 파일이 들어 있습니다.',
  revision_file_duplicated: '한 파일을 두 계열에 넣을 수 없습니다.',
  file_missing: '공유 폴더에서 파일을 찾을 수 없습니다.',
  not_sheet: '엑셀 파일이 아닙니다.',
  too_large: '파일이 너무 커서 미리 볼 수 없습니다. 내려받아 열어 주세요.',
  unreadable: '파일을 열 수 없습니다(손상 또는 지원하지 않는 형식).',
  kind_mismatch: '같은 종류의 태그끼리만 묶을 수 있습니다.',
  same_tag: '자기 자신이나 자기 동의어에는 묶을 수 없습니다.',
  hull_not_found: '등록된 호선이 아닙니다.',
  // 30 — 사내 PLM 선박 정보 조회
  ship_not_found: 'PLM 에 없는 호선 번호입니다.',
  invalid_ship_no: '호선 번호 형식이 아닙니다.',
  plm_not_configured: 'PLM 접속 정보가 설정되지 않았습니다. 관리자에게 알려 주세요.',
  plm_driver_missing: 'PLM 조회 드라이버(oracledb)가 설치되지 않았습니다. 관리자에게 알려 주세요.',
  plm_fetch_error: 'PLM 에 접속하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  invalid_hull: '호선은 숫자 4자리입니다.',
  entry_not_found: '자료를 찾을 수 없습니다.',
  model_not_ready: '아직 3D 변환이 끝나지 않았습니다.',
  model_missing: '3D 변환 결과를 찾을 수 없습니다. 관리자에게 재변환을 요청해 주세요.',
  not_failed: '이미 다시 시도 중이거나 끝난 작업입니다.',
  target_gone: '작업 대상 파일이 이미 영구 삭제되어 다시 시도할 수 없습니다.',
  not_trashed: '휴지통에 있는 자료가 아닙니다.',
  backup_failed: '백업하지 못했습니다.',
  admin_required: '관리자만 할 수 있습니다.',
  vocab_not_listed: '목록에 없는 값입니다. ‘기타’를 고르거나 관리자에게 용어 추가를 요청해 주세요.',
  vocab_exists: '이미 목록에 있는 용어입니다.',
  vocab_is_synonym: '다른 용어의 동의어로 등록된 값입니다.',
  vocab_is_term: '이미 목록의 용어입니다. 합칠 수 없습니다.',
  vocab_conflict: '다른 용어와 표기가 겹칩니다.',
  value_not_found: '데이터에서 그 값을 찾을 수 없습니다. 새로 고쳐 보세요.',
  term_not_found: '용어를 찾을 수 없습니다. 새로 고쳐 보세요.',
  invalid_order: '목록이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
  // 13 — 등급·공개 범위
  read_only_role: '로그인한 사용자만 할 수 있습니다.',
  master_required: 'Master 만 할 수 있습니다.',
  master_transfer_only: 'Master 는 이양으로만 바꿀 수 있습니다.',
  master_protected: 'Master 계정은 비활성화하거나 거절할 수 없습니다.',
  cannot_change_self: '자기 자신의 등급은 바꿀 수 없습니다.',
  invalid_role: '고를 수 없는 등급입니다.',
  grant_not_found: '이미 회수된 허락입니다.',
  user_not_found: '사용자를 찾을 수 없습니다.',
  merge_target_not_found: '그 번호의 자료를 찾을 수 없습니다.',
  use_access_endpoint: '공개 범위는 공개 범위 패널에서 바꿉니다.',
  // 18-b — WorkBench 연결 규칙
  zone_not_listed: '구역 목록에 없는 값입니다. 분류 목록의 구역에서 골라 주세요.',
  unknown_target: '알 수 없는 WorkBench 앱입니다.',
  too_many_values: '구역·태그는 각각 20개까지 정할 수 있습니다.',
  too_many_entries: '한 번에 확인할 수 있는 자료 수를 넘었습니다.',
  // 20 — 필수 분류·자료 정비
  required_fields: 'BDF 자료는 호선(또는 공용)·구역·해석 종류가 있어야 확정할 수 있습니다.',
  no_hull_with_hulls: "'호선 없음(공용)' 과 호선을 함께 넣을 수 없습니다.",
  nothing_to_revert: '되돌릴 제목 정비 기록이 없습니다.',
  title_changed_since: '정비 뒤에 제목이 다시 바뀌어 되돌리지 않았습니다.',
  // 21 — 문서 정보·모델 연결
  report_not_found: '문서를 찾을 수 없습니다.',
  report_catalog_conflict: '다른 곳에서 문서 정보가 바뀌었습니다. 다시 불러온 뒤 저장해 주세요.',
  model_not_found: '고른 모델을 볼 수 없거나 더 이상 쓸 수 없습니다.',
  invalid_document_type: '고를 수 없는 문서 분류입니다.',
  too_many_links: '모델은 50개까지 연결할 수 있습니다.',
  // 15 — LogBook 등급·WorkBench 사용자
  ...LEVEL_ERRORS,
};

export function errorText(err, fallback = '요청을 처리하지 못했습니다.') {
  const code = typeof err?.detail === 'string' ? err.detail : err?.detail?.code;
  if (code === 'required_fields' && err.detail?.missing?.length) {
    return `BDF 자료는 호선(또는 공용)·구역·해석 종류가 있어야 확정할 수 있습니다 — 빠진 칸: ${requiredText(err.detail.missing)}`;
  }
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

// 15 — '해석 연도'(year)는 해석 시기와 함께 없앴다
export const FACET_LABELS = { hull: '호선', ship_type: '선종', analysis_type: '해석 종류', zone: '구역', target: '대상',
  tag: '태그', uploaded_by: '올린 사람', kind: '파일 종류' };

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
  analysis_type: '해석 종류', target: '대상', description: '설명', file: '파일명', body: '본문',
  wb_origin: 'WorkBench 해석',   // 39 — 'WB #123' 검색
  document_type: '문서 분류' };   // 21

// 23 — 문서 분류 목록과 빠른 구분(보고서/발표자료/기타) 묶음은 프런트에 사본을 두지 않는다 — 서버(models.REPORT_DOCUMENT_TYPES·
// report_catalog.DOCUMENT_TYPE_GROUPS)가 GET /api/reports 의 document_type_options·document_type_groups 로 내려준다.
/** 21 — 자료 소속(호선·공용에서 파생 — 서버 report_catalog.scope_of). 29 — '독립 프로젝트'는 없앴다. */
export const SCOPE_LABELS = { hull: '호선 관련', reference: '공통 참고자료', unclassified: '미분류' };

/** ISO 시각 → 'YYYY-MM-DD HH:MM'. 없으면 '—'. */
export function formatDateTime(iso) {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}
