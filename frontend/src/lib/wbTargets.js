/**
 * 18-b — WorkBench 앱별 보내기 제한(분류 규칙: 구역·태그) 화면 쪽 저장소.
 *
 * - 규칙 목록(GET /api/wb-targets)은 창 하나에서 한 번만 받는다.
 * - Entry 별 판정(POST /api/wb-targets/{target}/eligible)은 같은 틱에 요청된 Entry 번호를 모아 한 번에 묻고,
 *   Entry 번호마다 결과를 기억한다 — 파일 트리에 BDF 가 여러 줄이어도 Entry 하나에 요청 하나.
 * - 판정 요청이 실패하면 버튼을 **켜 둔다**(fail-open). 서버(/api/integration/.../content?target=)가 같은 규칙으로
 *   다시 막고, 그때 WorkBench 가 LogBook 사유를 토스트로 보여 주므로 잘못 보내지는 일은 없다.
 *   반대로 닫아 두면 일시적인 네트워크 문제로 정상 모델까지 보낼 수 없게 된다.
 * - Entry 의 구역·태그가 바뀌면 invalidateWbEligibility(entryId) — 그 Entry 의 버튼들이 다시 묻는다.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const MAX_BATCH = 200;   // 서버 wb_targets.MAX_ELIGIBLE_IDS

let targetsPromise = null;
const verdicts = new Map();   // `${target}|${ENTRY}` → Promise<{ok, reason}>
const queue = new Map();      // target → Map(ENTRY → resolve)
let timer = null;
const listeners = new Set();

const norm = (id) => String(id || '').trim().toUpperCase();

/** 대상 목록 [{target, label, zones, tags, condition, reason}] — 실패하면 다음 호출이 다시 받는다. */
export function loadWbTargets() {
  if (!targetsPromise) {
    targetsPromise = api('/wb-targets');
    targetsPromise.catch(() => { targetsPromise = null; });
  }
  return targetsPromise;
}

/** 한 대상의 규칙(없으면 null). */
export async function loadWbTarget(target) {
  const list = await loadWbTargets();
  return (Array.isArray(list) ? list : []).find((t) => t.target === target) || null;
}

export const ruleIsEmpty = (rule) => !rule || (!(rule.zones?.length) && !(rule.tags?.length));

/** 좁은 자리용 짧은 안내 — 태그만 있으면 '태그 필요', 구역만 '구역 필요', 둘 다 '분류 필요'. */
export function needText(rule) {
  if (ruleIsEmpty(rule)) return '';
  if (rule.tags?.length && !rule.zones?.length) return '태그 필요';
  if (rule.zones?.length && !rule.tags?.length) return '구역 필요';
  return '분류 필요';
}

function flush() {
  timer = null;
  const work = [...queue.entries()];
  queue.clear();
  for (const [target, waiting] of work) {
    const ids = [...waiting.keys()];
    for (let i = 0; i < ids.length; i += MAX_BATCH) {
      const chunk = ids.slice(i, i + MAX_BATCH);
      api(`/wb-targets/${encodeURIComponent(target)}/eligible`, { method: 'POST', body: { entry_ids: chunk } })
        .then((res) => {
          for (const id of chunk) {
            const v = res?.[id];
            // 결과에 없는 번호(볼 수 없는 Entry)는 막지 않는다 — 판단은 서버가 보낼 때 한다
            waiting.get(id)({ ok: v ? v.ok !== false : true, reason: v?.reason || null });
          }
        })
        .catch(() => {
          for (const id of chunk) {
            verdicts.delete(`${target}|${id}`);   // 다음에 다시 묻는다
            waiting.get(id)({ ok: true, reason: null, failed: true });
          }
        });
    }
  }
}

/** 한 Entry 의 판정 {ok, reason}. 같은 틱의 요청은 대상별로 모아 한 번에 보낸다. */
export function getEligibility(target, entryId) {
  const id = norm(entryId);
  const k = `${target}|${id}`;
  if (!verdicts.has(k)) {
    verdicts.set(k, new Promise((resolve) => {
      if (!queue.has(target)) queue.set(target, new Map());
      queue.get(target).set(id, resolve);
      if (!timer) timer = setTimeout(flush, 0);
    }));
  }
  return verdicts.get(k);
}

export function subscribeWbEligibility(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Entry 의 분류가 바뀌었다 — 그 Entry 의 판정을 버리고 버튼들에 다시 묻게 한다. 인자가 없으면 전부. */
export function invalidateWbEligibility(entryId) {
  if (entryId == null) verdicts.clear();
  else {
    const id = norm(entryId);
    for (const k of [...verdicts.keys()]) if (k.endsWith(`|${id}`)) verdicts.delete(k);
  }
  for (const fn of [...listeners]) fn(entryId == null ? null : norm(entryId));
}

/** 관리자가 규칙을 바꿨다 — 규칙 목록과 모든 판정을 버린다. */
export function invalidateWbTargets() {
  targetsPromise = null;
  invalidateWbEligibility();
}

/** 테스트용 — 저장소를 비운다. */
export function resetWbTargetsForTests() {
  targetsPromise = null;
  verdicts.clear();
  queue.clear();
  clearTimeout(timer);
  timer = null;
  listeners.clear();
}

/**
 * 보내기 버튼용 판정 훅. enabled=false 면 아무것도 묻지 않는다.
 * 돌려주는 값: {loading, ok, reason, need}. 규칙이 없는 대상은 묻지 않고 바로 ok.
 * Entry 에 속하지 않은 파일(entryId 없음)은 규칙이 있으면 보낼 수 없다(서버와 같은 규칙).
 */
export function useWbEligibility(target, entryId, enabled = true) {
  const [state, setState] = useState({ loading: true, ok: false, reason: null, need: '' });
  const [rev, setRev] = useState(0);
  const id = norm(entryId);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeWbEligibility((changed) => { if (changed == null || changed === id) setRev((n) => n + 1); });
  }, [enabled, id]);

  useEffect(() => {
    if (!enabled || !target) return undefined;
    let alive = true;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    (async () => {
      let rule;
      try {
        rule = await loadWbTarget(target);
      } catch {
        if (alive) setState({ loading: false, ok: true, reason: null, need: '' });   // fail-open(위 설명)
        return;
      }
      if (ruleIsEmpty(rule)) { if (alive) setState({ loading: false, ok: true, reason: null, need: '' }); return; }
      const need = needText(rule);
      if (!id) { if (alive) setState({ loading: false, ok: false, reason: rule.reason, need }); return; }
      const v = await getEligibility(target, id);
      if (alive) setState({ loading: false, ok: v.ok, reason: v.ok ? null : (v.reason || rule.reason), need });
    })();
    return () => { alive = false; };
  }, [enabled, target, id, rev]);

  return state;
}

// ---- 선택 모드의 자동 검색 필터 ----
// 19 — 검색 필터는 한 칸에 값 여러 개(같은 칸 안은 OR)를 받지만 칸끼리는 AND 다(lib/search FILTER_KEYS: zone=·tag=).
// 규칙은 '구역 A 또는 태그 B' 처럼 칸을 넘는 OR 이라 그대로 옮길 수 없다 — 한 칸(태그 우선, 태그가 없으면 구역)에
// 그 칸의 규칙 값 전부를 OR 로 켜고, 다른 칸 조건은 띠에서 안내한다.

/** 창이 열린 뒤 자동 필터를 이미 한 번 적용했다는 표시(sessionStorage) — 사용자가 끄면 다시 강제하지 않는다. */
export const WB_FILTER_APPLIED_KEY = 'logbook_wb_filter_applied';

const KEY_LABEL = { tag: '태그', zone: '구역' };
const quoteAll = (values) => values.map((v) => `'${v}'`).join(' 또는 ');

/**
 * 규칙 → 켤 검색 필터 {key:'tag'|'zone', values:[…], label, others:[라벨]}. 규칙이 비면 null.
 * label = "태그 'Truss' 또는 'Frame'", others = 다른 칸의 조건 라벨(["구역 '선수부'"]).
 */
export function ruleFilter(rule) {
  if (ruleIsEmpty(rule)) return null;
  const tags = rule.tags || [];
  const zones = rule.zones || [];
  const [key, values, otherKey, otherValues] = tags.length ? ['tag', tags, 'zone', zones] : ['zone', zones, 'tag', tags];
  return { key, values: [...values], label: `${KEY_LABEL[key]} ${quoteAll(values)}`,
    others: otherValues.map((v) => `${KEY_LABEL[otherKey]} '${v}'`) };
}

export function filterApplied() {
  try { return globalThis.sessionStorage?.getItem(WB_FILTER_APPLIED_KEY) === '1'; } catch { return true; }
}

export function markFilterApplied() {
  try { globalThis.sessionStorage?.setItem(WB_FILTER_APPLIED_KEY, '1'); } catch { /* 저장소가 막히면 한 번만 못 지킬 뿐 */ }
}
