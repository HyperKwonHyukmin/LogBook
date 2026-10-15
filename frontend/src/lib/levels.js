/**
 * LogBook 등급(LV1~LV3)과 자료 공개 단계(15) — 화면 문구와 판단 한 곳.
 * 서버 규칙(backend/app/access.py · roles.py)과 같아야 한다. 화면은 버튼을 숨기거나 막을 뿐이고,
 * 실제 거부는 서버가 한다(공용 데이터 403 level2_required, 블록 403 level3_required, 볼 수 없는 자료 404).
 *
 * 사용자는 WorkBench 가입자다. 실효 등급 = WorkBench 관리자(wb_admin)면 3, 아니면 LogBook 에 저장한 등급.
 */

export const LEVELS = [1, 2, 3];

export const LEVEL_LABELS = { 1: '게스트', 2: '일반', 3: '관리자' };

/** 'LV2 일반' */
export const levelName = (lv) => (LEVEL_LABELS[lv] ? `LV${lv} ${LEVEL_LABELS[lv]}` : '');

/** 등급 설명(사용자 관리 도움말·선택지 설명). */
export const LEVEL_HELP = {
  1: '공유 자료와 열람을 허락받은 자료, 자기가 올린 자료만 봅니다. 올리고 자기 자료를 고치고 공유할 수 있습니다.',
  2: '공유·일반 자료를 모두 봅니다(관리자가 블록한 자료는 허락받았을 때만). 태그 동의어·호선 메모 같은 공용 정보를 고치고 해석 검증을 요청합니다.',
  3: '모든 자료를 보고 고칩니다. 자료 블록, 등급 지정, 분류 목록·운영을 관리합니다. WorkBench 관리자는 자동으로 LV3 입니다.',
};

/** 실효 등급 — WorkBench 관리자면 3. 로그인하지 않았으면 0. */
export function levelOf(user) {
  if (!user) return 0;
  if (user.wb_admin) return 3;
  return LEVELS.includes(user.level) ? user.level : 1;
}

export const isAdminLevel = (user) => levelOf(user) >= 3;
/** 올리기·자기 자료 수정 — 로그인한 누구나(LV1 이상). */
export const canWriteLevel = (user) => levelOf(user) >= 1;
/** 공용 정보(태그 동의어·호선 선종/메모)·남의 자료 해석 검증 — LV2 이상. */
export const canWriteShared = (user) => levelOf(user) >= 2;

/** 쓰기 자리에서 보는 이유 한 줄 — 15 부터는 로그인한 누구나 올리므로 실제로는 보이지 않는다(안전한 기본값). */
export const READ_ONLY_REASON = '로그인한 사용자만 올리고 고칠 수 있습니다.';

/** LV1 이 공용 정보 쓰기 자리에서 보는 이유 한 줄. */
export const SHARED_WRITE_REASON = 'LV1(게스트)은 공용 정보를 고칠 수 없습니다. 필요하면 관리자에게 등급 변경을 요청하세요.';

/**
 * 이 관리자가 대상 사용자에게 고를 수 있는 등급(빈 목록 = 바꿀 수 없음).
 * LV3 만, 자기 자신·WorkBench 관리자(자동 LV3)·WorkBench 비활성 사용자는 바꿀 수 없다.
 */
export function assignableLevels(me, target) {
  if (!isAdminLevel(me) || !target) return [];
  if (me && target.employee_id === me.employee_id) return [];
  if (target.wb_admin || target.wb_active === false) return [];
  return [...LEVELS];
}

// ---- 자료 공개 단계 ----

export const ACCESS_OPTIONS = [
  { value: 'shared', label: '공유', help: 'LV1(게스트)을 포함한 모든 사용자가 봅니다.' },
  { value: 'normal', label: '일반', help: 'LV2 이상과 올린 사람, 열람을 허락받은 사람이 봅니다.' },
  { value: 'blocked', label: '블록', help: '관리자(LV3)와 올린 사람, 관리자가 허락한 사람만 봅니다. 관리자만 지정·해제합니다.' },
];

export const accessOf = (item) => (item?.access === 'shared' || item?.access === 'blocked' ? item.access : 'normal');

/** 배지 문구 — 공유·블록만(일반은 기본이라 표시하지 않는다). */
export function accessLabel(item) {
  const a = accessOf(item);
  if (a === 'normal') return null;
  return item?.label || ACCESS_OPTIONS.find((o) => o.value === a).label;
}

/** 서버 오류 코드 → 문구(labels.js 의 errorText 가 쓴다). */
export const LEVEL_ERRORS = {
  level2_required: 'LV2(일반) 이상만 할 수 있습니다. LV1 은 자기가 올린 자료만 해석 검증을 요청할 수 있습니다.',
  level3_required: '블록 지정·해제와 블록된 자료의 공개 범위·열람 허락은 관리자(LV3)만 바꿀 수 있습니다.',
  wb_admin_locked: 'WorkBench 관리자는 LogBook 에서 자동으로 LV3 입니다(바꿀 수 없음).',
  wb_user_inactive: 'WorkBench 에서 활성 사용자가 아닙니다.',
  wb_unavailable: 'WorkBench 사용자 정보를 읽을 수 없습니다. 잠시 뒤 다시 시도하거나 관리자에게 알려 주세요.',
  wb_inactive: 'WorkBench 에서 비활성화된 계정입니다. WorkBench 관리자에게 문의하세요.',
  grant_user_inactive: 'WorkBench 에서 활성 사용자가 아니라 허락할 수 없습니다.',
  cannot_change_self: '자기 자신의 등급은 바꿀 수 없습니다.',
  invalid_level: '알 수 없는 등급입니다.',
  last_level3: '마지막 관리자(LV3)입니다. 다른 사람을 먼저 LV3 로 지정하세요.',
};
