/**
 * Entry 상세 고치기(11) — [변경하기] 로 고칠 칸을 열고 [변경 완료] 에 한 번의 PATCH 로 저장한다.
 * 이 파일은 순수 함수만: 서버 Entry → 고칠 값, 바뀐 칸 고르기, 칸 검사.
 */

// 15 — 해석 시기(analysis_period)는 없앴다. 20 — '호선 없음(공용)'(no_hull, 참/거짓)
// 29 — 프로젝트(21)는 없앴다
// 38 — 대상 구조물(target, 하나·선택). 42 — 해석 종류(analysis_type)는 없앴다
export const EDIT_FIELDS = ['title', 'description', 'hulls', 'no_hull', 'zones', 'target', 'tags'];
const LIST_FIELDS = new Set(['hulls', 'zones', 'tags']);
const BOOL_FIELDS = new Set(['no_hull']);

/** 서버 Entry → 고칠 값(문자열은 '' 로, 목록은 배열로). */
export function editValues(entry) {
  return {
    title: entry?.title || '',
    description: entry?.description || '',
    hulls: (entry?.hulls || []).map((h) => (typeof h === 'string' ? h : h.hull_no)),
    no_hull: !!entry?.no_hull,
    zones: [...(entry?.zones || [])],
    target: entry?.target || '',
    tags: [...(entry?.tags || [])],
  };
}

const norm = (k, v) => {
  if (LIST_FIELDS.has(k)) return JSON.stringify(v || []);
  if (BOOL_FIELDS.has(k)) return v ? '1' : '';
  return String(v ?? '').trim();
};

/** 처음 값(base)과 다른 칸 이름들 — 호선은 순서도 본다(첫 호선이 대표 호선). */
export function changedFields(base, draft) {
  return EDIT_FIELDS.filter((k) => norm(k, base?.[k]) !== norm(k, draft?.[k]));
}

/** 바뀐 칸만 담은 PATCH 본문(빈 글자는 null, 제목은 다듬어서). version 은 부르는 쪽이 붙인다. */
export function patchBody(base, draft) {
  const body = {};
  for (const k of changedFields(base, draft)) {
    if (LIST_FIELDS.has(k)) body[k] = [...draft[k]];
    else if (BOOL_FIELDS.has(k)) body[k] = !!draft[k];
    else body[k] = String(draft[k] ?? '').trim() || null;
  }
  return body;
}

export const HULL_RE = /^\d{4}$/;

/** 칸 검사 — { 칸: 안내 } (문제없으면 빈 객체). */
export function editErrors(draft) {
  const errs = {};
  if (!String(draft?.title ?? '').trim()) errs.title = '제목을 입력해 주세요.';
  if ((draft?.hulls || []).some((h) => !HULL_RE.test(h))) errs.hulls = '호선은 숫자 4자리입니다.';
  else if (draft?.no_hull && (draft?.hulls || []).length) errs.hulls = "'호선 없음(공용)' 이면 호선을 비워 주세요.";
  return errs;
}

/**
 * 고치는 동안 다른 경로(파일 추가 등)로 Entry 를 다시 불러왔을 때 — 고칠 칸의 서버 값이 그대로면
 * 새 version 으로 갈아타도 남의 변경을 덮지 않는다. 칸 값이 바뀌었으면 false(완료 때 충돌로 알린다).
 */
export function sameEditable(a, b) {
  return changedFields(editValues(a), editValues(b)).length === 0;
}

/**
 * 20 — 확정에 필요한 분류 중 빠진 칸(BDF 자료만). 서버 quality.missing_fields 와 같은 규칙.
 * values: 고치는 값(editValues 모양), hasBdf: 이 자료에 BDF(kind=model) 파일이 있는가.
 */
export function missingRequired(values, hasBdf) {
  if (!hasBdf) return [];
  const out = [];
  if (!(values?.hulls || []).length && !values?.no_hull) out.push('hull');   // 43 — 구역·대상은 선택
  return out;
}

/** 이 자료에 BDF(모델 파일)가 있는가 — 휴지통 파일은 뺀다. */
export const hasBdf = (entry) => (entry?.files || []).some((f) => f.kind === 'model' && f.location !== 'trash');
