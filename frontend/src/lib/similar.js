/**
 * 선례 찾기(27) — API 가 준 특징·항목별 점수를 화면 말로 바꾸는 순수 함수.
 * 숫자 점수보다 '같은 점 · 다른 점'을 앞에 둔다(엔지니어는 차이로 판단한다).
 */

export const PART_LABELS = { size: '크기', scale: '규모·촘촘함', mix: '구성', sec: '단면', tag: '분류' };

/** 점수(0~1) → 말. */
export function likeWord(total) {
  if (total >= 0.9) return '거의 같음';
  if (total >= 0.7) return '많이 비슷';
  if (total >= 0.5) return '일부 비슷';
  return '참고만';
}

export const WEAK = 0.5;

const num = (v) => (Math.abs(v) >= 10 ? Math.round(v).toLocaleString('ko-KR') : String(+v.toFixed(1)));

/** [L, W, H] m → '22 × 7.7 × 1.5 m'. */
export const sizeText = (dims) => `${(dims || []).map(num).join(' × ')} m`;
/** 가장 긴 변 — 썸네일 모서리 표기. */
export const longest = (dims) => `${num(Math.max(...(dims || [0])))} m`;

export function mixText(mix) {
  const [beam, shell] = mix || [0, 0];
  if (beam >= 0.7) return `보 위주(보 ${Math.round(beam * 100)}%)`;
  if (shell >= 0.5) return `쉘 위주(쉘 ${Math.round(shell * 100)}%)`;
  return `보 ${Math.round(beam * 100)}% · 쉘 ${Math.round(shell * 100)}%`;
}

/** 같은 점·다른 점(각각 최대 3개). base·other = API 의 특징(dims·elems·mix·sections·zone(s)·atype). */
export function compareLines(base, other, score) {
  const same = [];
  const diff = [];
  const raw = score.raw || {};
  if (score.shape) same.push('형상 같음(같은 설계)');
  if (raw.size >= 0.6) same.push('크기 비슷'); else diff.push(`크기 ${sizeText(other.dims)}`);
  const r = other.elems / base.elems;
  if (r > 1.6 || r < 0.62) {
    diff.push(`요소 ${r > 1 ? `${r.toFixed(1)}배` : `1/${(1 / r).toFixed(1)}`} (${other.elems.toLocaleString('ko-KR')}개)`);
  } else {
    same.push('요소 수 비슷');
  }
  if (raw.mix >= 0.85) same.push(mixText(other.mix).replace(/\(.*\)/, '')); else diff.push(mixText(other.mix));
  const shared = score.same_sections || [];
  if (shared.length) same.push(`단면 ${shared.length}개 같음`);
  const onlyOther = (other.sections || []).filter((s) => !(base.sections || []).includes(s));
  if (onlyOther.length) diff.push(`단면 ${onlyOther.length}개 다름${onlyOther.length <= 2 ? ` (${onlyOther.join(', ')})` : ''}`);
  if (base.zone && !(other.zones || []).includes(base.zone)) diff.push(`구역 ${(other.zones || []).join(', ') || '없음'}`);
  if (base.atype && other.atype && base.atype !== other.atype) diff.push(`해석 ${other.atype}`);
  return { same: same.slice(0, 3), diff: diff.slice(0, 3) };
}

/** 단면 합집합 — [{label, where: 'both'|'base'|'other'}], 이름 순. */
export function sectionUnion(base, other) {
  const a = new Set(base.sections || []);
  const b = new Set(other.sections || []);
  return [...new Set([...a, ...b])].sort().map((label) => ({
    label, where: a.has(label) && b.has(label) ? 'both' : a.has(label) ? 'base' : 'other',
  }));
}

/** 정렬 — like(닮은 순, API 순서 그대로) | pass(검증 통과 → 문서 있음 → 닮은 순). */
export function orderResults(results, mode) {
  if (mode !== 'pass') return results;
  const rank = (r) => (r.lead.solve === 'pass' ? 0 : 1) * 2 + (r.lead.reports ? 0 : 1);
  return [...results].sort((a, b) => rank(a) - rank(b) || b.best - a.best);
}

/** 고른 BDF 가 업로드 상한을 넘는가(서버도 같은 상한으로 막는다). */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** 제목 머리의 호선(이름 규칙 20: '호선 · 구역 · 해석 종류 · 구별자')이 옆 호선 칩과 같으면 뺀다. */
export function titleWithoutHull(title, hulls) {
  const [head, ...rest] = String(title || '').split(' · ');
  return rest.length && (hulls || []).includes(head) ? rest.join(' · ') : title;
}
