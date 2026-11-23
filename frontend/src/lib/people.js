/**
 * 67 — 담당자 프로필 카드 주소. 명부 번호가 있으면 /p/{번호}, 없으면 사번 /p/{사번}(명부에 없는 작성자도 카드가 있다).
 * 둘 다 없으면(사번 없는 손 입력 사람인데 번호도 없음 = 아직 명부에 안 들어감) null.
 */
export function profileHref(p) {
  if (!p) return null;
  if (p.id != null) return `/p/${p.id}`;
  if (p.person_id != null) return `/p/${p.person_id}`;
  if (p.employee_id) return `/p/${encodeURIComponent(p.employee_id)}`;
  return null;
}

/** /p/{key} → 카드 API 경로. 숫자면 명부 번호, 아니면 사번. */
export function profileApi(key) {
  const k = String(key || '').trim();
  return /^\d+$/.test(k) ? `/people/${k}/profile` : `/people/by-employee/${encodeURIComponent(k)}/profile`;
}

/** 자료 행의 역할 표시 — primary(주 담당), co(공동 담당), author(작성). */
export const ROLE_LABEL = { primary: '주 담당', co: '공동 담당', author: '작성' };
